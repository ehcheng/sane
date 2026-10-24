import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { checkRedisHealth } from "@/lib/redis-health";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const TAG = "health";

export async function GET() {
  try {
    logger.debug(TAG, "Health check request received");
    const timestamp = new Date().toISOString();
    const overallStart = Date.now();

    // Run DB and Redis checks in parallel
    const [dbResult, redisResult] = await Promise.allSettled([
      (async () => {
        const start = Date.now();
        await prisma.$queryRaw`SELECT 1`;
        const latencyMs = Date.now() - start;
        logger.debug(TAG, `DB ping: ${latencyMs}ms`);
        return { status: "ok" as const, latencyMs };
      })(),
      checkRedisHealth(),
    ]);

    const database =
      dbResult.status === "fulfilled"
        ? dbResult.value
        : { status: "error" as const, latencyMs: 0 };

    const redis =
      redisResult.status === "fulfilled"
        ? redisResult.value.redis
        : { status: "error" as const, latencyMs: 0 };

    const worker =
      redisResult.status === "fulfilled"
        ? redisResult.value.worker
        : { status: "unknown" as const, lastHeartbeat: null };

    // Top-level status: degraded if DB or Redis is unreachable
    const topLevel =
      database.status === "error" || redis.status === "error"
        ? "degraded"
        : "ok";

    const body = {
      status: topLevel,
      timestamp,
      checks: {
        database: { status: database.status, latencyMs: database.latencyMs },
        redis: { status: redis.status, latencyMs: redis.latencyMs },
        worker: { status: worker.status, lastHeartbeat: worker.lastHeartbeat },
      },
    };

    logger.debug(TAG, `Health check complete in ${Date.now() - overallStart}ms`, {
      status: topLevel,
      dbMs: database.latencyMs,
      redisMs: redis.latencyMs,
      workerStatus: worker.status,
    });
    // Always return 200 for Railway healthcheck liveness.
    // Dependency status is in the response body for monitoring.
    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    logger.error(TAG, `Health check crashed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json(
      { status: "error", timestamp: new Date().toISOString() },
      { status: 200 }
    );
  }
}
