import logger from "@/lib/logger";

const TAG = "gmail-quota";

/** Gmail API unit costs per operation. */
export const QUOTA_COSTS = {
  "history.list": 2,
  "messages.list": 5,
  "messages.get": 5,
  "users.getProfile": 1,
  "attachments.get": 5,
} as const;

const DAILY_LIMIT = 25_000;
const WARNING_THRESHOLD = 0.80;

interface UsageEntry {
  unitsUsed: number;
  /** ISO date string (YYYY-MM-DD) for auto-reset on day change. */
  date: string;
}

/** In-memory per-user daily quota usage. Resets on worker restart (conservative). */
const quotaMap = new Map<string, UsageEntry>();

/** Per-user pause-until timestamp. Checked by poll scheduler. */
const pausedUntil = new Map<string, Date>();

/** Tracks whether we already sent a notification email for this pause event. */
const notifiedThisPause = new Set<string>();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function getOrCreate(userId: string): UsageEntry {
  const d = today();
  const entry = quotaMap.get(userId);
  if (entry && entry.date === d) return entry;
  // New day or first access — reset
  const fresh: UsageEntry = { unitsUsed: 0, date: d };
  quotaMap.set(userId, fresh);
  return fresh;
}

/** Record API usage for a user. */
export function recordUsage(userId: string, units: number): void {
  const entry = getOrCreate(userId);
  entry.unitsUsed += units;
}

/** Get current daily usage stats. */
export function getUsage(userId: string): {
  used: number;
  remaining: number;
  warningReached: boolean;
} {
  const entry = getOrCreate(userId);
  const remaining = Math.max(0, DAILY_LIMIT - entry.unitsUsed);
  return {
    used: entry.unitsUsed,
    remaining,
    warningReached: entry.unitsUsed >= DAILY_LIMIT * WARNING_THRESHOLD,
  };
}

/** Check if a user is currently paused due to quota exhaustion. */
export function isUserPaused(userId: string): boolean {
  const until = pausedUntil.get(userId);
  if (!until) return false;
  if (Date.now() >= until.getTime()) {
    // Pause expired — clean up
    pausedUntil.delete(userId);
    notifiedThisPause.delete(userId);
    logger.info(TAG, `user=${userId} Quota pause expired, resuming`);
    return false;
  }
  return true;
}

/** Pause a user until midnight UTC (next day reset). */
export function pauseUser(userId: string): void {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  pausedUntil.set(userId, tomorrow);
  logger.info(TAG, `user=${userId} Paused until ${tomorrow.toISOString()}`);
}

/** Returns all users currently paused due to quota exhaustion. */
export function getPausedUsers(): Array<{ userId: string; pausedUntil: Date }> {
  const result: Array<{ userId: string; pausedUntil: Date }> = [];
  pausedUntil.forEach((until, userId) => {
    if (Date.now() < until.getTime()) {
      result.push({ userId, pausedUntil: until });
    }
  });
  return result;
}

/**
 * Check whether we already sent a quota-paused notification for the current
 * pause event. Returns true if already notified, false if this is the first call.
 * Marks as notified on first call returning false.
 */
export function markNotified(userId: string): boolean {
  if (notifiedThisPause.has(userId)) return true;
  notifiedThisPause.add(userId);
  return false;
}
