import { prisma } from "@/server/db/prisma";
import { getConfig } from "@/server/config";
import logger from "@/lib/logger";
import { countSchoolDays } from "@/lib/school-year";
import { INACTIVITY_THRESHOLD_DAYS, DEACTIVATION_WINDOW_DAYS } from "@/lib/constants";
import {
  sendInactivityWarning,
  sendDeactivationNotice,
  sendHouseholdDeactivationNotice,
  sendReactivationNotice,
} from "@/server/email/sender";

const TAG = "user-lifecycle";

/**
 * Reminder email schedule: send when this many calendar days have elapsed
 * since inactivityNotifiedAt. Each entry maps to a lifecycleEmailsSent value.
 *
 * 0 days = initial warning (14 days remaining)  -> emailsSent becomes 1
 * 7 days = second warning  (7 days remaining)   -> emailsSent becomes 2
 * 13 days = final warning  (1 day remaining)    -> emailsSent becomes 3
 * 14 days = deactivation                        -> emailsSent becomes 4
 */
const REMINDER_SCHEDULE = [
  { daysSinceWarning: 0, daysRemaining: 14, emailsSent: 1 },
  { daysSinceWarning: 7, daysRemaining: 7, emailsSent: 2 },
  { daysSinceWarning: 13, daysRemaining: 1, emailsSent: 3 },
];

/**
 * Daily lifecycle job: tracks user activity and optionally transitions
 * users through ACTIVE -> WARNING -> DEACTIVATED.
 *
 * Activity tracking and admin reporting always run regardless of the
 * enforcement toggle. User-visible effects (state transitions, emails,
 * UI warnings) only occur when lifecycleEnforcementEnabled is true.
 */
export async function processUserLifecycle(): Promise<void> {
  const config = await getConfig();
  const enforcing = config.lifecycleEnforcementEnabled;
  const now = new Date();

  const users = await prisma.user.findMany({
    where: {
      accountStatus: { in: ["ACTIVE", "WARNING"] },
      role: "USER",
    },
    select: {
      id: true,
      name: true,
      email: true,
      accountStatus: true,
      lastActiveAt: true,
      lastCalendarAccessAt: true,
      inactivityNotifiedAt: true,
      lifecycleEmailsSent: true,
      createdAt: true,
      householdId: true,
      household: {
        select: {
          primaryUserId: true,
          members: { select: { id: true, email: true } },
        },
      },
    },
  });

  // Bulk-fetch the most recent processed email per user to include as an
  // activity signal. 90-day cutoff avoids a full table scan while still
  // capturing any genuinely active user. Include household primaries so
  // members can inherit their primary's email processing activity.
  const userIds = users.map((u) => u.id);
  const primaryIds = users
    .map((u) => u.household?.primaryUserId)
    .filter((id): id is string => !!id && !userIds.includes(id));
  const allLookupIds = [...userIds, ...primaryIds];
  const recentCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const lastProcessedRows = allLookupIds.length > 0
    ? await prisma.processedEmail.groupBy({
        by: ["userId"],
        where: { userId: { in: allLookupIds }, createdAt: { gte: recentCutoff } },
        _max: { createdAt: true },
      })
    : [];
  const lastProcessedMap = new Map(
    lastProcessedRows.map((r) => [r.userId, r._max.createdAt]),
  );

  let warned = 0;
  let reactivated = 0;
  let deactivated = 0;
  let reminders = 0;
  let inactiveCount = 0;

  for (const user of users) {
    try {
      // Compute the most recent activity across all signals.
      // For household members, email processing is keyed to the primary's
      // userId, so check both the member's and primary's processed dates.
      const effectiveId = user.household?.primaryUserId ?? user.id;
      const activityDates = [
        user.lastActiveAt,
        user.lastCalendarAccessAt,
        lastProcessedMap.get(user.id) ?? null,
        effectiveId !== user.id ? (lastProcessedMap.get(effectiveId) ?? null) : null,
      ].filter((d): d is Date => d !== null);
      const latestActivity = activityDates.length > 0
        ? new Date(Math.max(...activityDates.map((d) => d.getTime())))
        : null;

      if (user.accountStatus === "ACTIVE") {
        const lastActive = latestActivity ?? user.createdAt;
        const schoolDays = countSchoolDays(lastActive, now);

        if (schoolDays >= INACTIVITY_THRESHOLD_DAYS) {
          inactiveCount++;

          if (!enforcing) {
            logger.debug(TAG, `User ${user.id} has ${schoolDays} inactive school days (enforcement disabled, no action)`);
            continue;
          }

          // Transition to WARNING, send initial warning email
          const deactivationDate = formatDeactivationDate(now, DEACTIVATION_WINDOW_DAYS);

          await prisma.user.update({
            where: { id: user.id },
            data: {
              accountStatus: "WARNING",
              inactivityNotifiedAt: now,
              lifecycleEmailsSent: 1,
            },
          });

          await safeSendWarning(user.email, DEACTIVATION_WINDOW_DAYS, deactivationDate);
          warned++;
          logger.info(TAG, `User ${user.id} moved to WARNING (${schoolDays} school days inactive)`);
        }
      } else if (user.accountStatus === "WARNING") {
        // If enforcement was turned off, reset WARNING users back to ACTIVE
        if (!enforcing) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              accountStatus: "ACTIVE",
              inactivityNotifiedAt: null,
              lifecycleEmailsSent: 0,
            },
          });
          reactivated++;
          logger.info(TAG, `User ${user.id} reset to ACTIVE (enforcement disabled)`);
          continue;
        }

        // Check if user became active since the warning was issued
        if (
          latestActivity &&
          user.inactivityNotifiedAt &&
          latestActivity > user.inactivityNotifiedAt
        ) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              accountStatus: "ACTIVE",
              inactivityNotifiedAt: null,
              lifecycleEmailsSent: 0,
            },
          });
          reactivated++;
          logger.info(TAG, `User ${user.id} returned to ACTIVE (activity detected after warning)`);

          try {
            await sendReactivationNotice({ to: user.email });
          } catch (err) {
            logger.error(TAG, `Failed to send reactivation notice to ${user.email}: ${err instanceof Error ? err.message : String(err)}`);
          }
          continue;
        }

        // Calculate calendar days since warning
        const warnedAt = user.inactivityNotifiedAt ?? now;
        const daysSinceWarning = calendarDaysBetween(warnedAt, now);

        // Check if it's time to deactivate
        if (daysSinceWarning >= DEACTIVATION_WINDOW_DAYS) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              accountStatus: "DEACTIVATED",
              deactivatedAt: now,
              isMonitoringEnabled: false,
              lifecycleEmailsSent: 4,
            },
          });

          await prisma.emailConnection.updateMany({
            where: { userId: user.id },
            data: { status: "DISCONNECTED" },
          });

          try {
            await sendDeactivationNotice({ to: user.email });
          } catch (err) {
            logger.error(TAG, `Failed to send deactivation email to ${user.email}: ${err instanceof Error ? err.message : String(err)}`);
          }

          // Notify household partners when the primary is deactivated
          if (user.householdId && user.household?.primaryUserId === user.id && user.household.members) {
            const partners = user.household.members.filter((m) => m.id !== user.id);
            for (const partner of partners) {
              try {
                await sendHouseholdDeactivationNotice({
                  to: partner.email,
                  ownerName: user.name,
                });
              } catch (err) {
                logger.error(TAG, `Failed to notify household partner ${partner.email}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          }

          deactivated++;
          logger.info(TAG, `User ${user.id} DEACTIVATED (${daysSinceWarning} calendar days after warning)`);
          continue;
        }

        // Check for reminder emails
        for (const stage of REMINDER_SCHEDULE) {
          if (daysSinceWarning >= stage.daysSinceWarning && user.lifecycleEmailsSent < stage.emailsSent) {
            const deactivationDate = formatDeactivationDate(warnedAt, DEACTIVATION_WINDOW_DAYS);

            await prisma.user.update({
              where: { id: user.id },
              data: { lifecycleEmailsSent: stage.emailsSent },
            });

            await safeSendWarning(user.email, stage.daysRemaining, deactivationDate);
            reminders++;
            logger.info(TAG, `User ${user.id} sent ${stage.daysRemaining}-day reminder`);
            break; // Only send one reminder per cycle
          }
        }
      }
    } catch (err) {
      logger.error(TAG, `Error processing lifecycle for user ${user.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  logger.info(
    TAG,
    `Lifecycle check complete: ${users.length} users checked, ` +
    `${inactiveCount} inactive (30d+), ${warned} warned, ${reminders} reminders sent, ` +
    `${reactivated} reactivated, ${deactivated} deactivated` +
    (enforcing ? "" : " (enforcement disabled)")
  );
}

/** Count calendar days between two dates (ignoring time of day). */
function calendarDaysBetween(from: Date, to: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const fromDay = Math.floor(from.getTime() / msPerDay);
  const toDay = Math.floor(to.getTime() / msPerDay);
  return Math.max(0, toDay - fromDay);
}

/** Format the estimated deactivation date for display in emails. */
function formatDeactivationDate(warnedAt: Date, windowDays: number): string {
  const deactivationDate = new Date(warnedAt);
  deactivationDate.setUTCDate(deactivationDate.getUTCDate() + windowDays);
  return deactivationDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Send a warning email, swallowing errors to avoid blocking the lifecycle loop. */
async function safeSendWarning(email: string, daysRemaining: number, deactivationDate: string): Promise<void> {
  try {
    await sendInactivityWarning({ to: email, daysRemaining, deactivationDate });
  } catch (err) {
    logger.error(TAG, `Failed to send warning email to ${email}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
