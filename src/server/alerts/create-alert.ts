import { prisma } from "@/server/db/prisma";
import logger from "@/lib/logger";
import { errorMessage } from "@/lib/error-message";

const TAG = "alerts";

type AlertType = "worker_stale" | "ai_error" | "resend_failure" | "gmail_quota" | "job_permanently_failed";
type Severity = "info" | "warning" | "critical";

interface CreateAlertInput {
  type: AlertType;
  severity: Severity;
  title: string;
  message: string;
  dedupKey: string;
}

/**
 * Creates an admin alert with deduplication.
 *
 * - If an open alert with the same dedupKey exists and was created within
 *   the cooldown window → skips (returns existing).
 * - If an open alert exists but is older than cooldown → creates a new one
 *   (allows re-alerting for persistent issues).
 * - If no open alert exists → creates a new one.
 */
export async function createAlert(input: CreateAlertInput) {
  try {
    // Read cooldown from SystemConfig
    const config = await prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { alertCooldownMinutes: true },
    });
    const cooldownMs = (config?.alertCooldownMinutes ?? 30) * 60 * 1000;

    // Check for existing open alert with same dedupKey
    const existing = await prisma.adminAlert.findFirst({
      where: {
        dedupKey: input.dedupKey,
        resolvedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      const age = Date.now() - existing.createdAt.getTime();
      if (age < cooldownMs) {
        logger.debug(TAG, `Alert deduped: ${input.dedupKey} (${Math.round(age / 60000)}m old)`);
        return existing;
      }
      // Older than cooldown — resolve the stale one, create fresh
      await prisma.adminAlert.update({
        where: { id: existing.id },
        data: { resolvedAt: new Date() },
      });
    }

    const alert = await prisma.adminAlert.create({
      data: {
        type: input.type,
        severity: input.severity,
        title: input.title,
        message: input.message,
        dedupKey: input.dedupKey,
      },
    });

    logger.info(TAG, `Alert created: [${input.severity}] ${input.type} — ${input.title}`);
    return alert;
  } catch (error) {
    // Alert creation must never break the caller
    logger.error(TAG, `Failed to create alert: ${errorMessage(error)}`);
    return null;
  }
}

/**
 * Bulk-resolves open alerts matching the given type and optional dedupKey prefix.
 */
export async function resolveAlerts(type: AlertType, dedupKeyPrefix?: string) {
  try {
    const where: Record<string, unknown> = {
      type,
      resolvedAt: null,
    };
    if (dedupKeyPrefix) {
      where.dedupKey = { startsWith: dedupKeyPrefix };
    }

    const result = await prisma.adminAlert.updateMany({
      where,
      data: { resolvedAt: new Date() },
    });

    if (result.count > 0) {
      logger.info(TAG, `Resolved ${result.count} ${type} alert(s)${dedupKeyPrefix ? ` (prefix: ${dedupKeyPrefix})` : ""}`);
    }
    return result.count;
  } catch (error) {
    logger.error(TAG, `Failed to resolve alerts: ${errorMessage(error)}`);
    return 0;
  }
}
