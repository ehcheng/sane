import { Job } from "bullmq";
import { prisma } from "@/server/db/prisma";
import { sendBrief } from "@/server/email/sender";
import { connection as redisConnection } from "@/worker/queue";
import logger from "@/lib/logger";
import { errorMessage } from "@/lib/error-message";

const TAG = "flush-queued-brief";
const flushLockKey = (userId: string) => `flush-brief-lock:${userId}`;
const FLUSH_LOCK_TTL = 120; // 2 minutes

interface FlushQueuedBriefData {
  userId: string;
}

/**
 * One-shot job: sends all queued (unforwarded actionable) emails for a user
 * as a single brief, then marks them as forwarded.
 *
 * Triggered when a user switches from DAILY_BRIEF / WEEKLY_BRIEF → INDIVIDUAL
 * and chooses "Forward Now".
 */
export async function processFlushQueuedBrief(
  job: Job<FlushQueuedBriefData>
): Promise<void> {
  const { userId } = job.data;

  logger.info(TAG, `user=${userId} Flushing queued brief emails`);

  // Prevent concurrent flush for same user (e.g., double-click)
  const lockKey = flushLockKey(userId);
  const acquired = await redisConnection.set(lockKey, job.id ?? "unknown", "EX", FLUSH_LOCK_TTL, "NX");
  if (!acquired) {
    logger.info(TAG, `user=${userId} Flush already in progress, skipping`);
    return;
  }

  try {
    await _doFlush(job, userId);
  } finally {
    await redisConnection.del(lockKey);
  }
}

async function _doFlush(job: Job<FlushQueuedBriefData>, userId: string): Promise<void> {
  const queuedEmails = await prisma.processedEmail.findMany({
    where: {
      userId,
      aiDecision: true,
      forwarded: false,
      deliveryStatus: { not: "manually_skipped" },
    },
    select: {
      id: true,
      fromAddress: true,
      fromName: true,
      subject: true,
      aiSubject: true,
      aiSummary: true,
      receivedAt: true,
      attachmentCount: true,
    },
    orderBy: { receivedAt: "asc" },
  });

  if (queuedEmails.length === 0) {
    logger.info(TAG, `user=${userId} No queued emails to flush`);
    return;
  }

  // Get child names — decrypt PII
  const { decryptChildRecord } = await import("@/lib/pii-encryption");
  const childRecords = await prisma.child.findMany({
    where: { userId },
    orderBy: { displayOrder: "asc" },
  });
  const children = await Promise.all(childRecords.map((r) => decryptChildRecord(r)));
  const childNames = children.map((c) => c.name);

  // Get active verified forwarding addresses — decrypt PII
  const { decryptForwardingRecord } = await import("@/lib/pii-encryption");
  const fwdRecords = await prisma.forwardingAddress.findMany({
    where: {
      userId,
      isActive: true,
      verifiedAt: { not: null },
    },
  });
  const addresses = await Promise.all(fwdRecords.map((r) => decryptForwardingRecord(r)));

  if (addresses.length === 0) {
    logger.info(TAG, `user=${userId} No active forwarding addresses, skipping flush`);
    return;
  }

  // Get user timezone
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timezone: true },
  });

  const now = new Date();
  const earliest = queuedEmails[0].receivedAt;

  const stats = {
    processed: queuedEmails.length,
    forwarded: queuedEmails.length,
    skipped: 0,
    attachments: queuedEmails.reduce((sum, e) => sum + e.attachmentCount, 0),
  };

  const forwardedEmails = queuedEmails.map((e) => ({
    from: e.fromName ? `${e.fromName} <${e.fromAddress}>` : e.fromAddress,
    receivedAt: e.receivedAt,
    subject: e.aiSubject || e.subject,
    summary: e.aiSummary,
  }));

  try {
    await sendBrief({
      to: addresses,
      childNames,
      timezone: user.timezone,
      periodStart: earliest,
      periodEnd: now,
      stats,
      forwardedEmails,
      briefTitle: "Your Queued Emails",
      userId,
    });

    // Mark all as forwarded
    const emailIds = queuedEmails.map((e) => e.id);
    await prisma.processedEmail.updateMany({
      where: { id: { in: emailIds } },
      data: {
        forwarded: true,
        forwardedAt: now,
        deliveryStatus: "pending",
      },
    });

    logger.info(TAG, `user=${userId} Flushed ${queuedEmails.length} queued emails as brief`);
  } catch (error) {
    const errMsg = errorMessage(error);
    logger.error(TAG, `user=${userId} Flush failed: ${errMsg}`);
    throw error; // Re-throw so BullMQ can retry
  }
}
