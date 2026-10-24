import { prisma } from "@/server/db/prisma";
import { getConfig } from "@/server/config";
import logger from "@/lib/logger";

const TAG = "data-retention-cleanup";
const BATCH_SIZE = 1000;

/**
 * Daily cleanup job:
 * 1. Rolls up ProcessedEmail records older than retention period into ProcessedEmailDailyStats
 * 2. Batch-deletes the rolled-up records
 *
 * Idempotent: ON CONFLICT upsert means re-running after a crash overwrites
 * the same aggregated values, then deletes.
 */
export async function processDataRetentionCleanup(): Promise<void> {
  const config = await getConfig();
  const retentionDays = Math.max(config.dataRetentionDays, 7);

  // Compute cutoff aligned to midnight UTC
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);

  logger.info(TAG, `Starting cleanup: retention=${retentionDays}d, cutoff=${cutoff.toISOString()}`);

  // Count records to process
  const totalCount = await prisma.processedEmail.count({
    where: { createdAt: { lt: cutoff } },
  });

  if (totalCount === 0) {
    logger.info(TAG, "No records older than cutoff — nothing to do");
    return;
  }

  logger.info(TAG, `Found ${totalCount} records to roll up and delete`);

  // Step 1: Rollup via raw SQL — INSERT ... ON CONFLICT DO UPDATE
  const rollupResult = await prisma.$executeRaw`
    INSERT INTO "ProcessedEmailDailyStats" (
      "id", "userId", "date",
      "emailCount", "forwardedCount", "skippedCount",
      "deliveredCount", "bouncedCount",
      "tokensInput", "tokensOutput",
      "attachmentCount", "imageCount",
      "createdAt"
    )
    SELECT
      gen_random_uuid(),
      "userId",
      DATE_TRUNC('day', "createdAt")::date AS "date",
      COUNT(*)::int AS "emailCount",
      COUNT(*) FILTER (WHERE "forwarded" = true)::int AS "forwardedCount",
      COUNT(*) FILTER (WHERE "aiDecision" = false)::int AS "skippedCount",
      COUNT(*) FILTER (WHERE "deliveryStatus" = 'delivered')::int AS "deliveredCount",
      COUNT(*) FILTER (WHERE "deliveryStatus" IN ('bounced', 'complained'))::int AS "bouncedCount",
      COALESCE(SUM("aiTokensInput"), 0)::int AS "tokensInput",
      COALESCE(SUM("aiTokensOutput"), 0)::int AS "tokensOutput",
      COALESCE(SUM("attachmentCount"), 0)::int AS "attachmentCount",
      COALESCE(SUM("imageCount"), 0)::int AS "imageCount",
      NOW()
    FROM "ProcessedEmail"
    WHERE "createdAt" < ${cutoff}
    GROUP BY "userId", DATE_TRUNC('day', "createdAt")::date
    ON CONFLICT ("userId", "date") DO UPDATE SET
      "emailCount"      = EXCLUDED."emailCount",
      "forwardedCount"  = EXCLUDED."forwardedCount",
      "skippedCount"    = EXCLUDED."skippedCount",
      "deliveredCount"  = EXCLUDED."deliveredCount",
      "bouncedCount"    = EXCLUDED."bouncedCount",
      "tokensInput"     = EXCLUDED."tokensInput",
      "tokensOutput"    = EXCLUDED."tokensOutput",
      "attachmentCount" = EXCLUDED."attachmentCount",
      "imageCount"      = EXCLUDED."imageCount",
      "createdAt"       = NOW()
  `;

  logger.info(TAG, `Rollup complete: ${rollupResult} rows upserted`);

  // Step 2: Batch delete old records
  let totalDeleted = 0;
  let batchDeleted: number;

  do {
    // Delete in batches using a subquery on IDs to avoid long locks
    batchDeleted = await prisma.$executeRaw`
      DELETE FROM "ProcessedEmail"
      WHERE "id" IN (
        SELECT "id" FROM "ProcessedEmail"
        WHERE "createdAt" < ${cutoff}
        LIMIT ${BATCH_SIZE}
      )
    `;
    totalDeleted += batchDeleted;

    if (batchDeleted > 0) {
      logger.debug(TAG, `Deleted batch of ${batchDeleted} (total: ${totalDeleted})`);
    }
  } while (batchDeleted >= BATCH_SIZE);

  logger.info(TAG, `Cleanup complete: rolled up and deleted ${totalDeleted} records`);

  // Steps 3-6: Prune old records from secondary tables
  const pruneTargets: Array<{
    label: string;
    days: number;
    delete: (cutoff: Date) => Promise<{ count: number }>;
  }> = [
    {
      label: "event(s)",
      days: Math.max(config.eventRetentionDays, 7),
      delete: async (c) => {
        let total = 0;
        let batch: number;
        do {
          batch = await prisma.$executeRaw`
            DELETE FROM "ExtractedEvent"
            WHERE "id" IN (
              SELECT "id" FROM "ExtractedEvent"
              WHERE "eventDate" < ${c}
              LIMIT ${BATCH_SIZE}
            )
          `;
          total += batch;
        } while (batch >= BATCH_SIZE);
        return { count: total };
      },
    },
    {
      label: "feedback snapshot(s)",
      days: Math.max(config.feedbackSnapshotRetentionDays, 7),
      delete: (c) => prisma.feedbackSnapshot.deleteMany({ where: { createdAt: { lt: c } } }),
    },
    {
      label: "AI call log(s)",
      days: Math.max(config.aiCallLogRetentionDays, 7),
      delete: (c) => prisma.aICallLog.deleteMany({ where: { createdAt: { lt: c } } }),
    },
    {
      label: "diagnostic run(s)",
      days: Math.max(config.aiCallLogRetentionDays, 7),
      delete: (c) => prisma.diagnosticRun.deleteMany({ where: { createdAt: { lt: c } } }),
    },
  ];

  for (const target of pruneTargets) {
    const pruneCutoff = new Date();
    pruneCutoff.setUTCDate(pruneCutoff.getUTCDate() - target.days);
    const result = await target.delete(pruneCutoff);
    if (result.count > 0) {
      logger.info(TAG, `Pruned ${result.count} ${target.label} older than ${target.days}d`);
    }
  }
}
