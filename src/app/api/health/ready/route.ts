import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { checkRedisHealth } from "@/lib/redis-health";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/ready
 *
 * Readiness probe: returns 503 when DB or Redis is unreachable.
 * Use this for external monitoring and alerting.
 * (The main /api/health endpoint always returns 200 for Railway liveness.)
 *
 * Note: checkRedisHealth creates a short-lived connection per call.
 * This is acceptable for monitoring intervals of 10s+ but not for
 * sub-second polling. The liveness endpoint has the same behavior.
 */
export async function GET() {
  const [dbResult, redisResult] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    checkRedisHealth(),
  ]);

  const dbOk = dbResult.status === "fulfilled";
  const redisOk =
    redisResult.status === "fulfilled" &&
    redisResult.value.redis.status === "ok";

  // Worker status is informational (doesn't affect HTTP status code),
  // but included so external monitors can alert on stale workers.
  const workerStatus =
    redisResult.status === "fulfilled"
      ? redisResult.value.worker.status
      : "unknown";

  const status = dbOk && redisOk ? "ok" : "unavailable";
  const httpStatus = status === "ok" ? 200 : 503;

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      database: dbOk ? "ok" : "error",
      redis: redisOk ? "ok" : "error",
      worker: workerStatus,
    },
    { status: httpStatus }
  );
}
