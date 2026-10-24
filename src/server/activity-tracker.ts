import { prisma } from "@/server/db/prisma";

const ACTIVITY_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

/** Fire-and-forget activity tracking, throttled to at most once per hour. */
export function trackActivity(userId: string, lastActiveAt: Date | null): void {
  if (!lastActiveAt || Date.now() - lastActiveAt.getTime() > ACTIVITY_THROTTLE_MS) {
    prisma.user
      .update({ where: { id: userId }, data: { lastActiveAt: new Date() } })
      .catch(() => {});
  }
}
