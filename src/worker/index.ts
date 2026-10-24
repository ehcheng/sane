import { validateEnv } from "@/lib/env-check";
validateEnv("worker");

import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN && process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}

import { Worker, Job } from "bullmq";
import { z } from "zod";
import { connection } from "./queue";
import { emailQueue } from "./queue";
import { processPollScheduler } from "./jobs/poll-scheduler";
import { processUserEmails, activeLockKeys } from "./jobs/process-user-emails";
import { processManualForward } from "./jobs/manual-forward";
import { processDataRetentionCleanup } from "./jobs/data-retention-cleanup";
import { processSendBrief, sendUserBrief } from "./jobs/send-brief";
import { processFlushQueuedBrief } from "./jobs/flush-queued-brief";
import { processAdminHeartbeat } from "./jobs/admin-heartbeat";
import { processManualDiagnostics } from "./jobs/manual-diagnostics";
import { processUserLifecycle } from "./jobs/user-lifecycle";
import { prisma } from "@/server/db/prisma";
import { getConfig } from "@/server/config";
import logger, { printCounters } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Job data schemas — validate payloads before processing
// ---------------------------------------------------------------------------

const processUserEmailsSchema = z.object({
  userId: z.string().uuid(),
  connectionId: z.string().uuid(),
  forceCount: z.number().int().positive().optional(),
  isBackfill: z.boolean().optional(),
  isReauth: z.boolean().optional(),
});

const manualForwardSchema = z.object({
  userId: z.string().uuid(),
  processedEmailId: z.string().uuid(),
  externalMessageId: z.string().min(1),
});

const flushQueuedBriefSchema = z.object({
  userId: z.string().uuid(),
});

const forceBriefSchema = z.object({
  userId: z.string().uuid(),
  briefType: z.enum(["daily", "weekly"]),
  briefTitle: z.string().min(1).max(100).optional(),
  windowHours: z.number().int().min(1).max(720).optional(),
});

const TAG = "worker";

async function processForceBrief(job: Job): Promise<void> {
  const { userId, briefType, briefTitle, windowHours } = forceBriefSchema.parse(job.data);
  const config = await getConfig();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      timezone: true,
      briefScope: true,
      dailyBriefEnabled: true,
      weeklyBriefEnabled: true,
      dailyBriefHour: true,
      weeklyBriefDay: true,
      weeklyBriefHour: true,
      lastDailyBriefSentAt: true,
      lastWeeklyBriefSentAt: true,
      household: { select: { primaryUserId: true } },
    },
  });

  const briefUser = { ...user, effectiveUserId: user.household?.primaryUserId ?? user.id };
  await sendUserBrief(briefUser, briefType, new Date(), config.dailyBriefEventDays, { force: true, briefTitle, windowHours });
  logger.info(TAG, `Force-sent ${briefType} brief for user=${userId}${briefTitle ? ` (title="${briefTitle}")` : ""}`);
}
const HEARTBEAT_KEY = "worker:heartbeat";
let heartbeatTtl = 1800; // default 30min, updated from config on startup

function updateHeartbeat(): void {
  const ts = new Date().toISOString();
  connection.set(HEARTBEAT_KEY, ts, "EX", heartbeatTtl)
    .then(() => logger.debug(TAG, `Heartbeat updated: ${ts} (TTL=${heartbeatTtl}s)`))
    .catch((err) => logger.error(TAG, `Failed to update heartbeat: ${err}`));
}

// ---------------------------------------------------------------------------
// Job router
// ---------------------------------------------------------------------------

async function processJob(job: Job): Promise<void> {
  switch (job.name) {
    case "poll-scheduler":
      await processPollScheduler();
      break;
    case "process-user-emails":
    case "backfill-user-emails":
      processUserEmailsSchema.parse(job.data);
      await processUserEmails(job);
      break;
    case "manual-forward":
      manualForwardSchema.parse(job.data);
      await processManualForward(job);
      break;
    case "data-retention-cleanup":
      await processDataRetentionCleanup();
      break;
    case "send-weekly-digest":
      await processSendBrief();
      break;
    case "flush-queued-brief":
      flushQueuedBriefSchema.parse(job.data);
      await processFlushQueuedBrief(job);
      break;
    case "force-brief":
      await processForceBrief(job);
      break;
    case "admin-heartbeat":
      await processAdminHeartbeat();
      break;
    case "daily-diagnostics":
      await processManualDiagnostics();
      break;
    case "user-lifecycle":
      await processUserLifecycle();
      break;
    default:
      logger.error(TAG, `Unknown job name: ${job.name}`);
  }
}

// ---------------------------------------------------------------------------
// Worker setup
// ---------------------------------------------------------------------------

const worker = new Worker("email-processing", processJob, {
  connection,
  concurrency: 5,
  lockDuration: 300_000, // 5 minutes: prevents stalled-job false positives on long AI calls
});

worker.on("active", (job: Job) => {
  logger.debug(TAG, `Job ${job.name} (${job.id}) started`);
  updateHeartbeat();
});

worker.on("completed", (job: Job) => {
  logger.debug(TAG, `Job ${job.name} (${job.id}) completed`);
  printCounters(TAG);
  updateHeartbeat();
});

worker.on("failed", async (job: Job | undefined, error: Error) => {
  logger.error(
    TAG,
    `Job ${job?.name ?? "unknown"} (${job?.id ?? "?"}) failed: ${error.message}`
  );

  // Alert on permanently failed jobs (all retries exhausted)
  if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
    try {
      const { createAlert } = await import("@/server/alerts/create-alert");
      await createAlert({
        type: "job_permanently_failed",
        severity: "critical",
        title: `Job permanently failed: ${job.name}`,
        message: `Job ${job.name} (${job.id}) exhausted all ${job.attemptsMade} attempts. Last error: ${error.message.slice(0, 500)}`,
        dedupKey: `job_failed:${job.name}:${job.id}`,
      });
    } catch { /* alert creation must not break worker */ }
  }
});

worker.on("error", (error: Error) => {
  logger.error(TAG, `Worker error: ${error.message}`);
});

// Redis connection observability (handlers live here, not queue.ts,
// because queue.ts is also imported by the web server for enqueuing)
connection.on("error", (err) => logger.error("redis", `Connection error: ${err.message}`));
connection.on("reconnecting", (ms: number) => logger.warn("redis", `Reconnecting in ${ms}ms...`));
connection.on("close", () => logger.debug("redis", "Connection closed"));
connection.on("ready", () => logger.info("redis", "Connected"));

// ---------------------------------------------------------------------------
// Register repeatable poll-scheduler job
// ---------------------------------------------------------------------------

async function setupRepeatableJobs(): Promise<void> {
  const config = await getConfig();
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;

  // Priority: lower = higher priority. Lightweight jobs run ahead of heavy
  // email processing jobs when all 5 worker slots are occupied.
  const repeatableJobs: Array<{ name: string; everyMs: number; priority: number }> = [
    { name: "poll-scheduler", everyMs: config.pollIntervalMinutes * 60 * 1000, priority: 1 },
    { name: "send-weekly-digest", everyMs: HOUR_MS, priority: 2 },
    { name: "user-lifecycle", everyMs: DAY_MS, priority: 2 },
    { name: "admin-heartbeat", everyMs: DAY_MS, priority: 3 },
    { name: "data-retention-cleanup", everyMs: DAY_MS, priority: 4 },
  ];

  const managedNames = new Set(repeatableJobs.map((j) => j.name));

  // Remove any stale repeatable jobs first to avoid duplicates
  const existingRepeatables = await emailQueue.getRepeatableJobs();
  for (const job of existingRepeatables) {
    if (managedNames.has(job.name)) {
      await emailQueue.removeRepeatableByKey(job.key);
    }
  }

  // Register all repeatable jobs with priority
  for (const { name, everyMs, priority } of repeatableJobs) {
    await emailQueue.add(name, {}, { repeat: { every: everyMs }, priority });
  }

  const nextRunMs = config.pollIntervalMinutes * 60 * 1000;
  const nextRun = new Date(Date.now() + nextRunMs);
  logger.info(
    TAG,
    `Registered poll-scheduler every ${config.pollIntervalMinutes}m (next ~${nextRun.toISOString()}), data-retention-cleanup every 24h, send-weekly-digest every 1h, admin-heartbeat every 24h, user-lifecycle every 24h`
  );
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  logger.info(TAG, `Received ${signal}. Shutting down gracefully...`);

  // Force-exit after 25s — must be under RAILWAY_DEPLOYMENT_DRAINING_SECONDS (30s).
  // Don't attempt another graceful close here; internal state may be corrupted
  // (especially after uncaughtException).
  const timer = setTimeout(() => {
    logger.error(TAG, "Shutdown timeout reached. Forcing exit.");
    process.exit(1);
  }, 25_000);
  timer.unref(); // Don't keep process alive just for the timer

  // Happy path: wait for in-progress jobs to finish
  logger.debug(TAG, "Waiting for in-progress jobs to finish...");
  await worker.close();
  logger.debug(TAG, "Worker closed");

  // Release any per-user locks still held so the next deploy doesn't hit stale locks
  if (activeLockKeys.size > 0) {
    logger.info(TAG, `Releasing ${activeLockKeys.size} active user lock(s)...`);
    await Promise.allSettled(
      Array.from(activeLockKeys).map((key) => connection.del(key))
    );
    activeLockKeys.clear();
    logger.debug(TAG, "All user locks released");
  }

  logger.debug(TAG, "Disconnecting Redis...");
  await connection.quit();

  logger.debug(TAG, "Disconnecting Prisma...");
  await prisma.$disconnect();

  clearTimeout(timer);

  printCounters(TAG);
  logger.info(TAG, "Shutdown complete");
  process.exit(0);
}

let shuttingDown = false;

process.on("SIGTERM", () => {
  if (!shuttingDown) { shuttingDown = true; shutdown("SIGTERM"); }
});
process.on("SIGINT", () => {
  if (!shuttingDown) { shuttingDown = true; shutdown("SIGINT"); }
});

process.on("uncaughtException", (err) => {
  logger.error(TAG, `Uncaught exception: ${err.message}`, {
    stack: err.stack ?? "no stack",
  });
  Sentry.captureException(err);
  if (!shuttingDown) {
    shuttingDown = true;
    shutdown("uncaughtException").catch(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error(TAG, `Unhandled rejection: ${msg}`, {
    stack: stack ?? "no stack",
  });
  Sentry.captureException(reason instanceof Error ? reason : new Error(msg));
  if (!shuttingDown) {
    shuttingDown = true;
    shutdown("unhandledRejection").catch(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

(async () => {
  const config = await getConfig();
  logger.setDebugOverride(config.debugMode);
  logger.info(TAG, "Starting email-processing worker...");
  logger.info(TAG, `Config: poll=${config.pollIntervalMinutes}m, active=${config.activeHoursStart}:00-${config.activeHoursEnd}:00 (default-tz=${config.timezone}), debug=${config.debugMode}`);

  try {
    // TTL = 2x poll interval so heartbeat outlives the gap between jobs
    heartbeatTtl = config.pollIntervalMinutes * 60 * 2;
    await setupRepeatableJobs();
    updateHeartbeat();
    logger.info(TAG, "Worker is ready and listening for jobs");
  } catch (error) {
    logger.error(TAG, `Failed to set up repeatable jobs: ${error}`);
    process.exit(1);
  }
})();
