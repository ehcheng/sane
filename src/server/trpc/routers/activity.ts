import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { prisma } from "@/server/db/prisma";
import { getConfig } from "@/server/config";
import { submitFeedbackSchema } from "@/lib/validators";

const PAGE_SIZE = 10;

/** Build a Prisma where clause from common email filter inputs. */
function buildEmailFilterWhere(
  userId: string,
  input: { sender?: string; keyword?: string; startDate?: string; endDate?: string },
): Record<string, unknown> {
  const where: Record<string, unknown> = { userId };

  if (input.sender) {
    where.OR = [
      { fromAddress: { contains: input.sender, mode: "insensitive" } },
      { fromName: { contains: input.sender, mode: "insensitive" } },
    ];
  }
  if (input.keyword) {
    const kw = input.keyword;
    if (where.OR) {
      where.AND = [
        { OR: where.OR as Array<Record<string, unknown>> },
        {
          OR: [
            { subject: { contains: kw, mode: "insensitive" } },
            { aiSummary: { contains: kw, mode: "insensitive" } },
          ],
        },
      ];
      delete where.OR;
    } else {
      where.OR = [
        { subject: { contains: kw, mode: "insensitive" } },
        { aiSummary: { contains: kw, mode: "insensitive" } },
      ];
    }
  }

  if (input.startDate || input.endDate) {
    const dateFilter: Record<string, Date> = {};
    if (input.startDate) dateFilter.gte = new Date(input.startDate);
    if (input.endDate) dateFilter.lte = new Date(input.endDate);
    where.receivedAt = dateFilter;
  }

  return where;
}

export const activityRouter = router({
  recent: protectedProcedure
    .input(
      z
        .object({
          cursor: z.string().uuid().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const config = await getConfig();
      const totalLimit = config.recentActivityLimit;

      const items = await prisma.processedEmail.findMany({
        where: { userId: ctx.userId },
        orderBy: { createdAt: "desc" },
        take: PAGE_SIZE + 1,
        ...(input?.cursor
          ? { cursor: { id: input.cursor }, skip: 1 }
          : {}),
        select: {
          id: true,
          fromAddress: true,
          fromName: true,
          subject: true,
          aiDecision: true,
          aiRelevant: true,
          aiSummary: true,
          aiLinks: true,
          aiReasoning: true,
          aiProvider: true,
          forwarded: true,
          isManualForward: true,
          isDuplicateSlug: true,
          deliveryStatus: true,
          deliveryError: true,
          attachmentCount: true,
          imageCount: true,
          userFeedback: true,
          userFeedbackReason: true,
          topicSlug: true,
          receivedAt: true,
          createdAt: true,
        },
      });

      let nextCursor: string | undefined;
      if (items.length > PAGE_SIZE) {
        items.pop();
        nextCursor = items[items.length - 1].id;
      }

      return { items, nextCursor, totalLimit };
    }),

  filtered: protectedProcedure
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        sender: z.string().max(320).optional(),
        keyword: z.string().max(200).optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const baseWhere = buildEmailFilterWhere(ctx.userId, input);

      const items = await prisma.processedEmail.findMany({
        where: baseWhere,
        orderBy: { receivedAt: "desc" },
        take: PAGE_SIZE + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          fromAddress: true,
          fromName: true,
          subject: true,
          aiDecision: true,
          aiRelevant: true,
          aiSummary: true,
          aiLinks: true,
          aiReasoning: true,
          aiProvider: true,
          forwarded: true,
          isManualForward: true,
          isDuplicateSlug: true,
          deliveryStatus: true,
          deliveryError: true,
          attachmentCount: true,
          imageCount: true,
          userFeedback: true,
          userFeedbackReason: true,
          topicSlug: true,
          receivedAt: true,
          createdAt: true,
        },
      });

      let nextCursor: string | undefined;
      if (items.length > PAGE_SIZE) {
        items.pop();
        nextCursor = items[items.length - 1].id;
      }

      // Stats from base filters (sender + keyword + date) excluding decision tab,
      // so the actionable/FYI breakdown is always a meaningful split of the total.
      const [total, actionable] = await Promise.all([
        prisma.processedEmail.count({ where: baseWhere }),
        prisma.processedEmail.count({ where: { ...baseWhere, aiDecision: true } }),
      ]);

      return { items, nextCursor, stats: { total, forwarded: actionable, other: total - actionable } };
    }),

  exportCsv: protectedProcedure
    .input(
      z.object({
        sender: z.string().max(320).optional(),
        keyword: z.string().max(200).optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const where = buildEmailFilterWhere(ctx.userId, input);

      const emails = await prisma.processedEmail.findMany({
        where,
        orderBy: { receivedAt: "desc" },
        take: 1000,
        select: {
          fromAddress: true,
          fromName: true,
          subject: true,
          aiDecision: true,
          aiSummary: true,
          aiLinks: true,
          forwarded: true,
          deliveryStatus: true,
          userFeedback: true,
          createdAt: true,
        },
      });

      const header = "Date,From,Subject,Decision,Forwarded,Delivery,Feedback,Summary";
      const rows = emails.map((e) => {
        const escape = (s: string | null) =>
          s ? `"${s.replace(/"/g, '""')}"` : "";
        return [
          new Date(e.createdAt).toISOString(),
          escape(e.fromName ? `${e.fromName} <${e.fromAddress}>` : e.fromAddress),
          escape(e.subject),
          e.aiDecision ? "Forward" : "Skip",
          e.forwarded ? "Yes" : "No",
          e.deliveryStatus ?? "",
          e.userFeedback ?? "",
          escape(e.aiSummary),
        ].join(",");
      });

      return header + "\n" + rows.join("\n");
    }),

  manualForward: protectedProcedure
    .input(z.object({ emailId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const email = await prisma.processedEmail.findUnique({
        where: { id: input.emailId, userId: ctx.userId },
        select: { id: true, forwarded: true, externalMessageId: true },
      });
      if (!email) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Email not found",
        });
      }

      // Queue a manual-forward job (allowed even for already-forwarded emails)
      const { emailQueue } = await import("@/worker/queue");
      await emailQueue.add("manual-forward", {
        userId: ctx.userId,
        processedEmailId: input.emailId,
        externalMessageId: email.externalMessageId,
      });

      return { success: true };
    }),

  submitFeedback: protectedProcedure
    .input(submitFeedbackSchema)
    .mutation(async ({ ctx, input }) => {
      const email = await prisma.processedEmail.findUnique({
        where: { id: input.emailId, userId: ctx.userId },
        select: { id: true, fromAddress: true },
      });
      if (!email) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Email not found",
        });
      }
      await prisma.processedEmail.update({
        where: { id: input.emailId },
        data: {
          userFeedback: input.feedback,
          userFeedbackReason: input.reason?.trim() || null,
          userFeedbackAt: new Date(),
        },
      });
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: ctx.userId },
        select: { feedbackTrainingConsent: true },
      });

      // Check if this sender now meets the suggestion threshold
      let suggestion: {
        senderEmail: string;
        suggestedAction: "ALWAYS_FORWARD" | "NEVER_FORWARD";
        feedbackCount: number;
      } | null = null;

      if (input.feedback === "wrong_skip" || input.feedback === "wrong_forward") {
        const senderEmail = email.fromAddress.toLowerCase();
        // Only suggest if no rule exists yet
        const existingRule = await prisma.senderRule.findUnique({
          where: { userId_senderEmail: { userId: ctx.userId, senderEmail } },
        });
        if (!existingRule) {
          const count = await prisma.processedEmail.count({
            where: {
              userId: ctx.userId,
              fromAddress: { equals: email.fromAddress, mode: "insensitive" },
              userFeedback: input.feedback,
            },
          });
          if (count >= 3) {
            suggestion = {
              senderEmail,
              suggestedAction: input.feedback === "wrong_skip" ? "ALWAYS_FORWARD" : "NEVER_FORWARD",
              feedbackCount: count,
            };
          }
        }
      }

      return { success: true, feedbackTrainingConsent: user.feedbackTrainingConsent, suggestion };
    }),

  clearFeedback: protectedProcedure
    .input(z.object({ emailId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const email = await prisma.processedEmail.findUnique({
        where: { id: input.emailId, userId: ctx.userId },
        select: { id: true },
      });
      if (!email) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Email not found",
        });
      }
      await prisma.processedEmail.update({
        where: { id: input.emailId },
        data: {
          userFeedback: null,
          userFeedbackReason: null,
          userFeedbackAt: null,
        },
      });
      return { success: true };
    }),

  lifetimeStats: protectedProcedure.query(async ({ ctx }) => {
    const [liveTotal, liveActionable, liveForwarded] = await Promise.all([
      prisma.processedEmail.count({ where: { userId: ctx.userId } }),
      prisma.processedEmail.count({ where: { userId: ctx.userId, aiDecision: true } }),
      prisma.processedEmail.count({ where: { userId: ctx.userId, forwarded: true } }),
    ]);

    const historical = await prisma.processedEmailDailyStats.aggregate({
      where: { userId: ctx.userId },
      _sum: { emailCount: true, forwardedCount: true, skippedCount: true },
    });

    const histTotal = historical._sum.emailCount ?? 0;
    const histForwarded = historical._sum.forwardedCount ?? 0;
    const histSkipped = historical._sum.skippedCount ?? 0;

    return {
      processed: liveTotal + histTotal,
      actionable: liveActionable + (histTotal - histSkipped),
      forwarded: liveForwarded + histForwarded,
    };
  }),

  captureFeedbackSnapshot: protectedProcedure
    .input(z.object({ emailId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const email = await prisma.processedEmail.findUnique({
        where: { id: input.emailId, userId: ctx.userId },
        select: {
          id: true,
          subject: true,
          fromAddress: true,
          fromName: true,
          aiDecision: true,
          aiSummary: true,
          aiLinks: true,
          aiSubject: true,
          aiReasoning: true,
          externalMessageId: true,
          userFeedback: true,
        },
      });
      if (!email) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Email not found",
        });
      }
      if (!email.userFeedback) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No feedback submitted for this email",
        });
      }

      // Check if snapshot already exists for this email
      const existing = await prisma.feedbackSnapshot.findFirst({
        where: { userId: ctx.userId, processedEmailId: email.id },
      });
      if (existing) {
        return { success: true, alreadyCaptured: true };
      }

      // Try to fetch email body from Gmail
      let body: string | null = null;
      let bodyHtml: string | null = null;
      try {
        const connection = await prisma.emailConnection.findUnique({
          where: { userId: ctx.userId },
          select: { id: true },
        });
        if (connection) {
          const { getValidAccessToken } = await import("@/server/email-providers/token-manager");
          const accessToken = await getValidAccessToken(connection.id);
          const { getGmailClient, getMessageContent } = await import("@/server/gmail/client");
          const gmail = getGmailClient(accessToken);
          const message = await getMessageContent(gmail, email.externalMessageId);
          body = message.body;
          bodyHtml = message.bodyHtml;
        }
      } catch {
        // Gmail fetch failed (expired token, deleted email) — continue without body
      }

      // Build and encrypt the snapshot blob
      const blob = JSON.stringify({
        subject: email.subject,
        fromAddress: email.fromAddress,
        fromName: email.fromName,
        body,
        bodyHtml,
        aiDecision: email.aiDecision,
        aiSummary: email.aiSummary,
        aiSubject: email.aiSubject,
        aiReasoning: email.aiReasoning,
        feedbackValue: email.userFeedback,
      });

      const { encrypt } = await import("@/lib/encryption");
      const encryptedData = encrypt(blob);

      await prisma.feedbackSnapshot.create({
        data: {
          userId: ctx.userId,
          processedEmailId: email.id,
          feedbackValue: email.userFeedback,
          encryptedData,
        },
      });

      return { success: true, alreadyCaptured: false };
    }),

  /** Fetch events extracted from a specific email. */
  eventsForEmail: protectedProcedure
    .input(z.object({ emailId: z.string() }))
    .query(async ({ ctx, input }) => {
      const events = await prisma.extractedEvent.findMany({
        where: {
          userId: ctx.userId,
          deletedAt: null,
          OR: [
            // Direct link: event was first extracted from this email
            { processedEmailId: input.emailId },
            // Merged: email contributed to an event via deduplication
            { sourceEmails: { contains: input.emailId } },
          ],
        },
        select: {
          id: true,
          title: true,
          eventDate: true,
          allDay: true,
          isTodo: true,
          actionable: true,
          location: true,
        },
        orderBy: { eventDate: "asc" },
      });
      return events;
    }),
});
