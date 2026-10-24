import IORedis from "ioredis";
import { getConfig } from "@/server/config";
import logger from "@/lib/logger";

export interface RedisHealthResult {
  redis: { status: "ok" | "error"; latencyMs: number; error?: string };
  worker: {
    status: "ok" | "stale" | "unknown";
    lastHeartbeat: string | null;
  };
}

const HEARTBEAT_KEY = "worker:heartbeat";
const TAG = "redis-health";

/**
 * Short-lived Redis connection to check health + worker heartbeat.
 * Connects, PINGs, reads heartbeat key, disconnects immediately.
 */
export async function checkRedisHealth(): Promise<RedisHealthResult> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return {
      redis: { status: "error", latencyMs: 0, error: "REDIS_URL not set" },
      worker: { status: "unknown", lastHeartbeat: null },
    };
  }

  let client: IORedis | null = null;
  try {
    const parsedUrl = new URL(redisUrl);
    client = new IORedis({
      host: parsedUrl.hostname,
      port: parseInt(parsedUrl.port) || 6379,
      username: parsedUrl.username || undefined,
      password: parsedUrl.password || undefined,
      family: 0, // dual-stack: IPv4 + IPv6 (required for Railway private networking)
      connectTimeout: 2000,
      commandTimeout: 1000,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null, // no retries
      lazyConnect: true,
    });

    const start = Date.now();
    await client.connect();
    const connectMs = Date.now() - start;
    logger.debug(TAG, `Redis connect: ${connectMs}ms`);

    await client.ping();
    const latencyMs = Date.now() - start;
    logger.debug(TAG, `Redis ping (including connect): ${latencyMs}ms`);

    // Read worker heartbeat, stale if older than 2x poll interval
    const heartbeat = await client.get(HEARTBEAT_KEY);
    let workerStatus: "ok" | "stale" | "unknown" = "unknown";
    if (heartbeat) {
      const config = await getConfig();
      const staleThresholdMs = config.pollIntervalMinutes * 60 * 1000 * 2;
      const age = Date.now() - new Date(heartbeat).getTime();
      workerStatus = age > staleThresholdMs ? "stale" : "ok";
      logger.debug(TAG, `Heartbeat age: ${Math.round(age / 1000)}s, threshold: ${Math.round(staleThresholdMs / 1000)}s, status: ${workerStatus}`);
    } else {
      logger.debug(TAG, "No heartbeat key found");
    }

    return {
      redis: { status: "ok", latencyMs },
      worker: { status: workerStatus, lastHeartbeat: heartbeat },
    };
  } catch (err) {
    logger.debug(TAG, `Redis health check failed: ${err instanceof Error ? err.message : String(err)}`);
    return {
      redis: {
        status: "error",
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      },
      worker: { status: "unknown", lastHeartbeat: null },
    };
  } finally {
    if (client) {
      client.disconnect();
    }
  }
}
