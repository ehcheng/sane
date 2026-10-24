import { prisma } from "@/server/db/prisma";
import { emailQueue } from "../queue";
import { getConfig } from "@/server/config";
import { isUserPaused } from "@/server/gmail/quota-tracker";
import logger from "@/lib/logger";

const TAG = "poll-scheduler";

/**
 * Checks whether the current hour in the user's timezone falls within
 * the configured active hours window.
 */
function isUserInActiveHours(
  timezone: string,
  activeHoursStart: number,
  activeHoursEnd: number
): boolean {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: timezone,
  });
  const currentHour = parseInt(formatter.format(now), 10);
  return currentHour >= activeHoursStart && currentHour < activeHoursEnd;
}

/**
 * Poll scheduler job: runs on a repeatable cron schedule.
 *
 * - Queries all users with an ACTIVE Gmail connection.
 * - Filters each user by their local timezone active hours.
 * - Enqueues a "process-user-emails" job for each eligible user,
 *   staggered by 2 seconds to avoid a thundering herd.
 */
export async function processPollScheduler(): Promise<void> {
  const config = await getConfig();

  // Check global monitoring kill switch
  const globalConfig = await prisma.systemConfig.findUnique({
    where: { id: "singleton" },
  });
  if (globalConfig && !globalConfig.isMonitoringEnabled) {
    logger.info(TAG, "Global monitoring is disabled. Skipping all users.");
    return;
  }

  logger.info(TAG, "Fetching users with active email connections");

  const activeConnections = await prisma.emailConnection.findMany({
    where: {
      status: "ACTIVE",
      user: {
        isMonitoringEnabled: true,
        emailVerified: { not: null },
        accountStatus: { not: "DEACTIVATED" },
      },
    },
    select: {
      id: true,
      userId: true,
      user: { select: { timezone: true } },
    },
  });

  // Count connections skipped due to monitoring being disabled or email unverified
  const totalActive = await prisma.emailConnection.count({
    where: { status: "ACTIVE" },
  });
  const skippedCount = totalActive - activeConnections.length;

  logger.info(
    TAG,
    `Found ${activeConnections.length} active connection(s)` +
      (skippedCount > 0 ? `, skipped ${skippedCount} (monitoring disabled or email unverified)` : "")
  );

  let enqueuedCount = 0;
  let outsideHoursCount = 0;
  for (let i = 0; i < activeConnections.length; i++) {
    const conn = activeConnections[i];

    // Skip users paused due to email quota exhaustion
    if (isUserPaused(conn.userId)) {
      logger.debug(TAG, `Email quota paused — skipping user=${conn.userId}`);
      continue;
    }

    // Skip users outside their local active hours
    const userTz = conn.user.timezone || config.timezone;
    if (!isUserInActiveHours(userTz, config.activeHoursStart, config.activeHoursEnd)) {
      logger.debug(TAG, `Outside active hours (${userTz}) — skipping user=${conn.userId}`);
      outsideHoursCount++;
      continue;
    }

    const delayMs = enqueuedCount * 2000;
    await emailQueue.add(
      "process-user-emails",
      { userId: conn.userId, connectionId: conn.id },
      {
        delay: delayMs,
        priority: 1,
      }
    );
    logger.debug(
      TAG,
      `Enqueued process-user-emails for user=${conn.userId} connection=${conn.id} delay=${delayMs}ms`
    );
    enqueuedCount++;
  }

  const nextPollTime = new Date(
    Date.now() + config.pollIntervalMinutes * 60 * 1000
  );
  const pausedCount = activeConnections.length - enqueuedCount - outsideHoursCount;
  const parts = [`Enqueued ${enqueuedCount} job(s)`];
  if (pausedCount > 0) parts.push(`${pausedCount} quota-paused`);
  if (outsideHoursCount > 0) parts.push(`${outsideHoursCount} outside-hours`);
  parts.push(`Next poll ~${nextPollTime.toISOString()}`);
  logger.info(TAG, parts.join(", "));
}
