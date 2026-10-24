import { Job } from "bullmq";
import { prisma } from "@/server/db/prisma";
import { getValidAccessToken } from "@/server/email-providers/token-manager";
import { createEmailClient } from "@/server/email-providers";
import { sendForwardedEmail } from "@/server/email/sender";
import logger from "@/lib/logger";
import { errorMessage } from "@/lib/error-message";

const TAG = "manual-forward";

interface ManualForwardData {
  userId: string;
  processedEmailId: string;
  externalMessageId: string;
}

/**
 * Manually forwards a previously-skipped email.
 * Re-fetches original body from Gmail, uses the already-stored AI summary.
 */
export async function processManualForward(
  job: Job<ManualForwardData>
): Promise<void> {
  const { userId, processedEmailId, externalMessageId } = job.data;

  logger.info(TAG, `user=${userId} Manual forward for email=${processedEmailId}`);

  const processedEmail = await prisma.processedEmail.findUnique({
    where: { id: processedEmailId, userId },
    select: {
      id: true,
      forwarded: true,
      deliveryStatus: true,
      aiSummary: true,
      aiSubject: true,
      aiLinks: true,
      topicSlug: true,
      subject: true,
      fromAddress: true,
    },
  });

  if (!processedEmail) {
    logger.error(TAG, `user=${userId} ProcessedEmail ${processedEmailId} not found`);
    return;
  }

  // Idempotency guard: skip if a previous attempt already delivered successfully
  if (processedEmail.forwarded && processedEmail.deliveryStatus === "pending") {
    logger.info(TAG, `user=${userId} Email ${processedEmailId} already forwarded (delivery pending), skipping retry`);
    return;
  }

  const wasAlreadyForwarded = processedEmail.forwarded;

  // Get email connection
  const connection = await prisma.emailConnection.findUnique({
    where: { userId },
    select: { id: true, status: true, provider: true },
  });

  if (!connection || connection.status !== "ACTIVE") {
    logger.error(TAG, `user=${userId} No active email connection for manual forward`);
    await prisma.processedEmail.update({
      where: { id: processedEmailId },
      data: { processingError: "Email not connected — cannot fetch original email" },
    });
    return;
  }

  try {
    const accessToken = await getValidAccessToken(connection.id);
    const emailClient = createEmailClient(connection.provider, accessToken, userId);
    const message = await emailClient.getMessageContent(externalMessageId);

    // Get forwarding addresses (decrypt PII)
    const { decryptForwardingRecord } = await import("@/lib/pii-encryption");
    const fwdRecords = await prisma.forwardingAddress.findMany({
      where: { userId, isActive: true },
    });
    const forwardingAddresses = await Promise.all(
      fwdRecords.map((r) => decryptForwardingRecord(r))
    );

    if (forwardingAddresses.length === 0) {
      logger.info(TAG, `user=${userId} No active forwarding addresses`);
      await prisma.processedEmail.update({
        where: { id: processedEmailId },
        data: { processingError: "No active forwarding addresses" },
      });
      return;
    }

    // Parse stored AI links
    const { aiLinkSchema } = await import("@/lib/validators");
    let links: Array<{ url: string; label: string }> | undefined;
    if (processedEmail.aiLinks) {
      try {
        const parsed = JSON.parse(processedEmail.aiLinks as string);
        const user = await prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { showLinksInSummary: true },
        });
        if (user.showLinksInSummary && Array.isArray(parsed)) {
          links = parsed.filter((l: unknown) => aiLinkSchema.safeParse(l).success);
        }
      } catch {
        // Ignore malformed links
      }
    }

    // Get child names for subject prefix (decrypt PII)
    const { decryptChildRecord } = await import("@/lib/pii-encryption");
    const childRecords = await prisma.child.findMany({
      where: { userId },
    });
    const children = await Promise.all(
      childRecords.map((r) => decryptChildRecord(r))
    );

    // Query related emails by topicSlug for context
    const relatedEmails = processedEmail.topicSlug
      ? await prisma.processedEmail.findMany({
          where: { userId, topicSlug: processedEmail.topicSlug, id: { not: processedEmailId } },
          select: { subject: true, receivedAt: true },
          orderBy: { receivedAt: 'desc' },
          take: 5,
        })
      : [];

    // Fetch forwardable attachment data
    const { fetchForwardableAttachments } = await import("@/worker/jobs/attachment-forward");
    const attachmentResult = await fetchForwardableAttachments(emailClient.rawClient as import("googleapis").gmail_v1.Gmail, externalMessageId, message.attachmentParts, userId);

    const { resendMessageId } = await sendForwardedEmail({
      to: forwardingAddresses.map((a) => ({ email: a.email, name: a.name })),
      subject: processedEmail.aiSubject ?? processedEmail.subject,
      summary: processedEmail.aiSummary ?? "Manually forwarded email",
      originalFrom: message.from,
      originalSubject: message.subject,
      originalBody: message.body,
      originalBodyHtml: message.bodyHtml,
      attachmentNames: message.attachmentParts
        .filter((p) => p.disposition === "attachment")
        .map((p) => p.filename),
      attachments: attachmentResult.attachments,
      attachmentsOversized: attachmentResult.oversized,
      messageUrl: emailClient.getMessageUrl(externalMessageId),
      childNames: children.map((c) => c.name),
      emailId: processedEmailId,
      userId,
      isManualForward: true,
      relatedEmails: relatedEmails.length > 0 ? relatedEmails : undefined,
      links,
    });

    await prisma.processedEmail.update({
      where: { id: processedEmailId },
      data: {
        forwarded: true,
        // Only mark as manual forward if it wasn't already forwarded;
        // re-forwarding an already-forwarded email keeps its original status.
        ...(!wasAlreadyForwarded ? { isManualForward: true } : {}),
        forwardedAt: new Date(),
        resendMessageId: resendMessageId ?? null,
        deliveryStatus: "pending",
      },
    });

    logger.info(
      TAG,
      `user=${userId} Manually forwarded email ${processedEmailId} to ${forwardingAddresses.length} address(es)`
    );
  } catch (error) {
    const errMsg = errorMessage(error);
    logger.error(TAG, `user=${userId} Manual forward failed: ${errMsg}`);
    await prisma.processedEmail.update({
      where: { id: processedEmailId },
      data: {
        processingError: `Manual forward failed: ${errMsg}`,
        deliveryStatus: "failed",
      },
    });
  }
}
