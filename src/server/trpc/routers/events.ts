import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { prisma } from "@/server/db/prisma";
import { submitEventFeedbackSchema } from "@/lib/validators";

import { Prisma } from "@prisma/client";

/** Rethrow Prisma "record not found" (P2025) as a tRPC NOT_FOUND error. */
function notFoundGuard(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
  }
  throw err;
}

/** Verify all childIds belong to the authenticated user. Throws BAD_REQUEST if not. */
async function validateChildOwnership(childIds: string[], userId: string): Promise<void> {
  const ownedCount = await prisma.child.count({
    where: { id: { in: childIds }, userId },
  });
  if (ownedCount !== childIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid child selection" });
  }
}

/**
 * Decrypt child names in event records.
 * Only requires nameEncrypted — avoids loading all encrypted child fields.
 */
async function decryptEventChildren<
  T extends { children: Array<{ id: string; nameEncrypted: Buffer }>; },
>(events: T[]): Promise<Array<Omit<T, "children"> & { children: Array<{ id: string; name: string }> }>> {
  const { decrypt } = await import("@/lib/encryption");
  const nameCache = new Map<string, string>();

  return events.map((event) => {
    const children = event.children.map((c) => {
      let name = nameCache.get(c.id);
      if (!name) {
        name = decrypt(c.nameEncrypted);
        nameCache.set(c.id, name);
      }
      return { id: c.id, name };
    });
    const { children: _, ...rest } = event;
    return { ...rest, children } as Omit<T, "children"> & { children: Array<{ id: string; name: string }> };
  });
}

export const eventsRouter = router({
  getCalendarFeedUrl: protectedProcedure.query(async ({ ctx }) => {
    // Each household member has their own calendar token
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.authUserId },
      select: { calendarToken: true },
    });
    if (!user.calendarToken) return null;

    const config = await prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { appUrl: true },
    });
    const baseUrl = config?.appUrl ?? process.env.NEXTAUTH_URL ?? "";
    return `${baseUrl}/api/calendar/${user.calendarToken}`;
  }),

  generateCalendarToken: protectedProcedure.mutation(async ({ ctx }) => {
    const { randomUUID } = await import("crypto");
    const token = randomUUID();
    await prisma.user.update({
      where: { id: ctx.authUserId },
      data: { calendarToken: token },
    });

    const config = await prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { appUrl: true },
    });
    const baseUrl = config?.appUrl ?? process.env.NEXTAUTH_URL ?? "";
    return `${baseUrl}/api/calendar/${token}`;
  }),

  revokeCalendarToken: protectedProcedure.mutation(async ({ ctx }) => {
    await prisma.user.update({
      where: { id: ctx.authUserId },
      data: { calendarToken: null },
    });
    return { success: true };
  }),

  list: protectedProcedure
    .input(
      z.object({
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
        childId: z.string().uuid().optional(),
        actionableOnly: z.boolean().optional(),
        cursor: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const PAGE_SIZE = 50;
      const where: Record<string, unknown> = {
        userId: ctx.userId,
        deletedAt: null,
        eventDate: {
          gte: new Date(input.startDate),
          lte: new Date(input.endDate),
        },
        // Only show events from relevant emails (or manually created)
        OR: [
          { processedEmailId: null },
          input.actionableOnly
            ? { actionable: true }
            : { processedEmail: { aiRelevant: true } },
        ],
      };
      if (input.childId) where.children = { some: { id: input.childId } };

      const items = await prisma.extractedEvent.findMany({
        where,
        orderBy: { eventDate: "asc" },
        take: PAGE_SIZE + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: {
          children: { select: { id: true, nameEncrypted: true } },
          processedEmail: { select: { forwarded: true, aiSummary: true, aiLinks: true, fromAddress: true, fromName: true, subject: true } },
        },
      });

      let nextCursor: string | undefined;
      if (items.length > PAGE_SIZE) {
        items.pop();
        nextCursor = items[items.length - 1].id;
      }

      const decryptedItems = await decryptEventChildren(items);

      // On first page, check if any relevant-but-not-actionable events exist
      // so the UI can hide the actionable toggle when it would have no effect.
      let hasNonActionable: boolean | undefined;
      if (!input.cursor) {
        const nonActionableCount = await prisma.extractedEvent.count({
          where: {
            userId: ctx.userId,
            deletedAt: null,
            eventDate: {
              gte: new Date(input.startDate),
              lte: new Date(input.endDate),
            },
            processedEmailId: { not: null },
            processedEmail: { aiRelevant: true },
            actionable: false,
            ...(input.childId ? { children: { some: { id: input.childId } } } : {}),
          },
          take: 1,
        });
        hasNonActionable = nonActionableCount > 0;
      }

      return { items: decryptedItems, nextCursor, hasNonActionable };
    }),

  /**
   * Agenda view query: returns events grouped for a date range plus
   * carry-forward items (incomplete TODOs from the past 7 days).
   */
  agenda: protectedProcedure
    .input(
      z.object({
        from: z.string().datetime(),
        to: z.string().datetime(),
        childIds: z.array(z.string().uuid()).optional(),
        showCompleted: z.boolean().optional().default(true),
        actionableOnly: z.boolean().optional().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const fromDate = new Date(input.from);
      const toDate = new Date(input.to);

      const childFilter = input.childIds?.length
        ? { children: { some: { id: { in: input.childIds } } } }
        : {};
      const completedFilter = input.showCompleted ? {} : { isDone: false };

      // Carry-forward: incomplete TODOs from the past 14 days (before `from`)
      const cutoff = new Date(fromDate);
      cutoff.setDate(cutoff.getDate() - 14);

      const [events, carryForward] = await Promise.all([
        prisma.extractedEvent.findMany({
          where: {
            userId: ctx.userId,
            deletedAt: null,
            eventDate: { gte: fromDate, lte: toDate },
            OR: [
              { processedEmailId: null },
              input.actionableOnly
                ? { actionable: true }
                : { processedEmail: { aiRelevant: true } },
            ],
            ...childFilter,
            ...completedFilter,
          },
          orderBy: { eventDate: "asc" },
          include: {
            children: { select: { id: true, nameEncrypted: true } },
            processedEmail: {
              select: {
                forwarded: true,
                aiSummary: true,
                aiLinks: true,
                fromAddress: true,
                fromName: true,
                subject: true,
                receivedAt: true,
              },
            },
          },
        }),
        prisma.extractedEvent.findMany({
          where: {
            userId: ctx.userId,
            deletedAt: null,
            eventDate: { gte: cutoff, lt: fromDate },
            isTodo: true,
            isDone: false,
            ...childFilter,
          },
          orderBy: { eventDate: "asc" },
          include: {
            children: { select: { id: true, nameEncrypted: true } },
            processedEmail: {
              select: {
                forwarded: true,
                aiSummary: true,
                aiLinks: true,
                fromAddress: true,
                fromName: true,
                subject: true,
                receivedAt: true,
              },
            },
          },
        }),
      ]);

      const decryptedEvents = await decryptEventChildren(events);
      const decryptedCarryForward = await decryptEventChildren(carryForward);

      // Transform to agenda view shape
      const mapEvent = (e: (typeof decryptedEvents)[number]) => {
        // aiSummary is a plain text string (may contain bullet prefixes).
        // Pass it through as-is; the client parses bullets from the text.
        const summary: string | null = e.processedEmail?.aiSummary ?? null;
        let links: Array<{ url: string; label: string }> | null = null;
        if (e.processedEmail?.aiLinks) {
          try { links = JSON.parse(e.processedEmail.aiLinks); } catch { /* skip */ }
        }

        return {
          id: e.id,
          title: e.title,
          location: e.location,
          details: e.details,
          startsAt: e.eventDate.toISOString(),
          endsAt: e.endDate?.toISOString() ?? null,
          allDay: e.allDay,
          isTodo: e.isTodo,
          isDone: e.isDone,
          doneAt: e.doneAt?.toISOString() ?? null,
          actionable: e.actionable,
          aiGenerated: e.processedEmailId !== null,
          children: e.children,
          summary,
          links,
          source: e.processedEmail
            ? {
                subject: e.processedEmail.subject,
                sender: e.processedEmail.fromName || e.processedEmail.fromAddress,
                receivedAt: e.processedEmail.receivedAt?.toISOString() ?? e.createdAt.toISOString(),
              }
            : null,
          feedback: e.userFeedback,
        };
      };

      return {
        events: decryptedEvents.map(mapEvent),
        carryForward: decryptedCarryForward.map(mapEvent),
        carryForwardCount: decryptedCarryForward.length,
      };
    }),

  /** Last email sync time for the sync indicator. */
  syncStatus: protectedProcedure.query(async ({ ctx }) => {
    const latest = await prisma.processedEmail.findFirst({
      where: { userId: ctx.userId },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    });
    return { lastSyncAt: latest?.receivedAt?.toISOString() ?? null };
  }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(300),
        eventDate: z.string().datetime(),
        endDate: z.string().datetime().optional().nullable(),
        allDay: z.boolean().default(true),
        isTodo: z.boolean().default(false),
        location: z.string().max(300).optional(),
        details: z.string().max(1000).optional(),
        childIds: z.array(z.string().uuid()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.childIds?.length) {
        await validateChildOwnership(input.childIds, ctx.userId);
      }
      return prisma.extractedEvent.create({
        data: {
          userId: ctx.userId,
          title: input.title,
          eventDate: new Date(input.eventDate),
          endDate: input.endDate ? new Date(input.endDate) : null,
          allDay: input.allDay,
          isTodo: input.isTodo,
          location: input.location ?? null,
          details: input.details ?? null,
          ...(input.childIds?.length
            ? { children: { connect: input.childIds.map((id) => ({ id })) } }
            : {}),
        },
      });
    }),

  upcoming: protectedProcedure
    .input(
      z
        .object({
          days: z.number().int().min(1).max(365).default(30),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 30;
      const now = new Date();
      const end = new Date();
      end.setUTCDate(end.getUTCDate() + days);

      const items = await prisma.extractedEvent.findMany({
        where: {
          userId: ctx.userId,
          deletedAt: null,
          eventDate: { gte: now, lte: end },
          OR: [
            { processedEmailId: null },
            { processedEmail: { aiRelevant: true } },
          ],
        },
        orderBy: { eventDate: "asc" },
        take: 50,
        include: {
          children: { select: { id: true, nameEncrypted: true } },
          processedEmail: { select: { forwarded: true, aiSummary: true, aiLinks: true, fromAddress: true, fromName: true, subject: true } },
        },
      });

      return decryptEventChildren(items);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(300).optional(),
        eventDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional().nullable(),
        allDay: z.boolean().optional(),
        isTodo: z.boolean().optional(),
        location: z.string().max(300).optional().nullable(),
        details: z.string().max(1000).optional().nullable(),
        childIds: z.array(z.string().uuid()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, eventDate, endDate, childIds, ...data } = input;
      if (childIds?.length) {
        await validateChildOwnership(childIds, ctx.userId);
      }
      return prisma.extractedEvent.update({
        where: { id, userId: ctx.userId, deletedAt: null },
        data: {
          ...data,
          ...(eventDate ? { eventDate: new Date(eventDate) } : {}),
          ...(endDate !== undefined ? { endDate: endDate ? new Date(endDate) : null } : {}),
          ...(childIds !== undefined
            ? { children: { set: childIds.map((cid) => ({ id: cid })) } }
            : {}),
        },
      }).catch(notFoundGuard);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await prisma.extractedEvent.update({
        where: { id: input.id, userId: ctx.userId, deletedAt: null },
        data: { deletedAt: new Date() },
      }).catch(notFoundGuard);
      return { success: true };
    }),

  submitEventFeedback: protectedProcedure
    .input(submitEventFeedbackSchema)
    .mutation(async ({ ctx, input }) => {
      const event = await prisma.extractedEvent.findUnique({
        where: { id: input.eventId, userId: ctx.userId, deletedAt: null },
        select: { id: true },
      });
      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      }
      await prisma.extractedEvent.update({
        where: { id: input.eventId },
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
      return { success: true, feedbackTrainingConsent: user.feedbackTrainingConsent };
    }),

  clearEventFeedback: protectedProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const event = await prisma.extractedEvent.findUnique({
        where: { id: input.eventId, userId: ctx.userId, deletedAt: null },
        select: { id: true },
      });
      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      }
      await prisma.extractedEvent.update({
        where: { id: input.eventId },
        data: {
          userFeedback: null,
          userFeedbackReason: null,
          userFeedbackAt: null,
        },
      });
      return { success: true };
    }),

  markDone: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Look up the acting user's display name for attribution.
      // Use the authenticated user's own name (not the first parent)
      // so household partners get correct attribution.
      const actingUser = await prisma.user.findUniqueOrThrow({
        where: { id: ctx.authUserId },
        select: { name: true },
      });

      return prisma.extractedEvent.update({
        where: { id: input.id, userId: ctx.userId, deletedAt: null },
        data: {
          isDone: true,
          doneAt: new Date(),
          doneByName: actingUser.name,
        },
        select: { id: true, isDone: true, doneAt: true, doneByName: true },
      }).catch(notFoundGuard);
    }),

  unmarkDone: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return prisma.extractedEvent.update({
        where: { id: input.id, userId: ctx.userId, deletedAt: null },
        data: {
          isDone: false,
          doneAt: null,
          doneByName: null,
        },
        select: { id: true, isDone: true, doneAt: true, doneByName: true },
      }).catch(notFoundGuard);
    }),

  captureEventFeedbackSnapshot: protectedProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const event = await prisma.extractedEvent.findUnique({
        where: { id: input.eventId, userId: ctx.userId, deletedAt: null },
        select: {
          id: true,
          processedEmailId: true,
          title: true,
          eventDate: true,
          allDay: true,
          isTodo: true,
          location: true,
          details: true,
          sourceEmails: true,
          userFeedback: true,
          userFeedbackReason: true,
          children: { select: { id: true, nameEncrypted: true } },
        },
      });
      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      }
      if (!event.userFeedback) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No feedback submitted for this event" });
      }

      // Check if snapshot already exists for this event
      const existing = await prisma.feedbackSnapshot.findFirst({
        where: { userId: ctx.userId, extractedEventId: event.id },
      });
      if (existing) {
        return { success: true, alreadyCaptured: true };
      }

      // Decrypt child names for the snapshot
      const { decrypt, encrypt } = await import("@/lib/encryption");
      const childNames = event.children.map((c) => decrypt(c.nameEncrypted));

      // Collect all processedEmailIds from the sourceEmails JSON
      type SourceEmailEntry = { processedEmailId?: string; subject: string; fromName: string | null; fromAddress: string };
      let sourceEntries: SourceEmailEntry[] = [];
      if (event.sourceEmails) {
        try { sourceEntries = JSON.parse(event.sourceEmails); } catch { /* ignore */ }
      }
      // Fallback: if sourceEmails is empty but processedEmailId exists, use it
      const allEmailIds = new Set<string>();
      for (const e of sourceEntries) {
        if (e.processedEmailId) allEmailIds.add(e.processedEmailId);
      }
      if (event.processedEmailId) allEmailIds.add(event.processedEmailId);

      // Fetch all source email bodies from Gmail
      type CapturedEmail = {
        subject: string;
        fromName: string | null;
        fromAddress: string;
        body: string | null;
        bodyHtml: string | null;
      };
      const capturedEmails: CapturedEmail[] = [];

      if (allEmailIds.size > 0) {
        try {
          const emailRows = await prisma.processedEmail.findMany({
            where: { id: { in: Array.from(allEmailIds) } },
            select: { id: true, subject: true, fromAddress: true, fromName: true, externalMessageId: true },
          });

          // Try to get Gmail access for body fetching
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let gmail: any = null;
          try {
            const connection = await prisma.emailConnection.findUnique({
              where: { userId: ctx.userId },
              select: { id: true },
            });
            if (connection) {
              const { getValidAccessToken } = await import("@/server/email-providers/token-manager");
              const accessToken = await getValidAccessToken(connection.id);
              const { getGmailClient } = await import("@/server/gmail/client");
              gmail = getGmailClient(accessToken);
            }
          } catch {
            // Gmail auth failed — continue without bodies
          }

          const { getMessageContent } = await import("@/server/gmail/client");

          for (const emailRow of emailRows) {
            let body: string | null = null;
            let bodyHtml: string | null = null;
            if (gmail) {
              try {
                const message = await getMessageContent(gmail, emailRow.externalMessageId);
                body = message.body;
                bodyHtml = message.bodyHtml;
              } catch {
                // Individual fetch failed — continue without this body
              }
            }
            capturedEmails.push({
              subject: emailRow.subject,
              fromName: emailRow.fromName,
              fromAddress: emailRow.fromAddress,
              body,
              bodyHtml,
            });
          }
        } catch {
          // DB lookup failed — continue without email content
        }
      }

      const blob = JSON.stringify({
        title: event.title,
        eventDate: event.eventDate.toISOString(),
        allDay: event.allDay,
        isTodo: event.isTodo,
        location: event.location,
        details: event.details,
        sourceEmails: event.sourceEmails,
        children: childNames,
        feedbackValue: event.userFeedback,
        feedbackReason: event.userFeedbackReason,
        emails: capturedEmails,
      });

      const encryptedData = encrypt(blob);

      await prisma.feedbackSnapshot.create({
        data: {
          userId: ctx.userId,
          extractedEventId: event.id,
          feedbackValue: event.userFeedback,
          encryptedData,
        },
      });

      return { success: true, alreadyCaptured: false };
    }),
});
