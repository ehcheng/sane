import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { prisma } from "@/server/db/prisma";
import { isDomainExcluded } from "@/config/excluded-sender-domains";
import { createRateLimiter } from "@/lib/rate-limit";
import { getConfig } from "@/server/config";

const senderScanLimiter = createRateLimiter("sender-scan", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 3,
});

export const emailRouter = router({
  connectionStatus: protectedProcedure.query(async ({ ctx }) => {
    const connection = await prisma.emailConnection.findUnique({
      where: { userId: ctx.authUserId },
      select: {
        id: true,
        provider: true,
        emailAddress: true,
        status: true,
        lastPolledAt: true,
        createdAt: true,
      },
    });
    return connection;
  }),

  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    const connection = await prisma.emailConnection.findUnique({
      where: { userId: ctx.authUserId },
      select: { accessTokenEncrypted: true, refreshTokenEncrypted: true },
    });
    if (connection) {
      // Revoke token with Google before deleting locally (best-effort)
      const { decryptTokens } = await import("@/server/gmail/token-manager");
      const { revokeGoogleToken } = await import("@/server/gmail/token-manager");
      try {
        const { refreshToken } = decryptTokens(connection);
        await revokeGoogleToken(refreshToken);
      } catch {
        // Decryption or revocation failure should not block disconnect
      }
    }
    await prisma.emailConnection.deleteMany({
      where: { userId: ctx.authUserId },
    });
    return { success: true };
  }),

  simulateReauthBackfill: protectedProcedure
    .input(z.object({ gapDays: z.number().int().min(1).max(30).default(5) }))
    .mutation(async ({ ctx, input }) => {
    // Only allow in debug mode
    const config = await prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { showDebugUI: true },
    });
    if (!config?.showDebugUI) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Debug UI is not enabled" });
    }

    const { queueSimulatedReauthBackfill } = await import("@/lib/simulate-reauth");
    await queueSimulatedReauthBackfill(ctx.authUserId, input.gapDays);
    return { success: true, gapDays: input.gapDays };
  }),

  backfill: protectedProcedure.mutation(async ({ ctx }) => {
    const connection = await prisma.emailConnection.findUnique({
      where: { userId: ctx.authUserId },
      select: { id: true, status: true, lastPolledAt: true },
    });

    if (!connection || connection.status !== "ACTIVE") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No active email connection" });
    }

    const { emailQueue, connection: redisConn } = await import("@/worker/queue");
    const { backfillRedisKey, BACKFILL_KEY_TTL } = await import("@/worker/jobs/process-user-emails");

    // Prevent duplicate: check if a backfill is already running/queued
    const existingJobId = await redisConn.get(backfillRedisKey(ctx.authUserId));
    if (existingJobId) {
      const existingJob = await emailQueue.getJob(existingJobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === "active" || state === "waiting" || state === "delayed") {
          return { jobId: existingJobId, enqueuedAt: new Date().toISOString(), alreadyRunning: true };
        }
      }
    }

    // Cooldown: prevent rapid repeated backfills
    if (
      connection.lastPolledAt &&
      Date.now() - connection.lastPolledAt.getTime() < 60_000
    ) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Please wait at least 60 seconds between backfill requests" });
    }

    const job = await emailQueue.add("backfill-user-emails", {
      userId: ctx.authUserId,
      connectionId: connection.id,
      isBackfill: true,
    });

    // Set Redis key immediately so concurrent calls see it
    await redisConn.set(backfillRedisKey(ctx.authUserId), job.id!, "EX", BACKFILL_KEY_TTL);

    return { jobId: job.id, enqueuedAt: new Date().toISOString() };
  }),

  pollNow: protectedProcedure
    .input(
      z.object({ forceCount: z.number().int().min(1).max(10).optional() }).optional()
    )
    .mutation(async ({ ctx, input }) => {
      const connection = await prisma.emailConnection.findUnique({
        where: { userId: ctx.authUserId },
        select: { id: true, status: true, lastPolledAt: true },
      });

      if (!connection || connection.status !== "ACTIVE") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No active email connection" });
      }

      if (
        connection.lastPolledAt &&
        Date.now() - connection.lastPolledAt.getTime() < 30_000
      ) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Please wait at least 30 seconds between checks" });
      }

      // forceCount is a debug feature: only honor it when debug UI is enabled
      let forceCount: number | undefined;
      if (input?.forceCount) {
        const config = await getConfig();
        if (config.showDebugUI) {
          forceCount = input.forceCount;
        }
      }

      // Lazy import to avoid creating a Redis connection at module load
      const { emailQueue } = await import("@/worker/queue");
      const job = await emailQueue.add("process-user-emails", {
        userId: ctx.authUserId,
        connectionId: connection.id,
        ...(forceCount ? { forceCount } : {}),
      });

      return { jobId: job.id, enqueuedAt: new Date().toISOString() };
    }),

  fetchRecentSenders: protectedProcedure
    .input(z.object({ days: z.number().int().min(7).max(180).optional() }).optional())
    .query(async ({ ctx, input }) => {
    const { allowed } = senderScanLimiter.check(ctx.authUserId);
    if (!allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Sender scanning is limited to 3 times per 15 minutes.",
      });
    }

    const connection = await prisma.emailConnection.findUnique({
      where: { userId: ctx.authUserId },
      select: { id: true, status: true, provider: true },
    });

    if (!connection || connection.status !== "ACTIVE") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No active email connection",
      });
    }

    // Currently only Gmail supports sender scanning
    if (connection.provider !== "GMAIL") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Sender scanning is currently only supported for Gmail",
      });
    }

    // Dynamic imports to avoid Node.js built-in issues in Next.js server bundle
    const { getValidAccessToken } = await import("@/server/email-providers/token-manager");
    const { getGmailClient, parseFromHeader } = await import("@/server/gmail/client");

    const accessToken = await getValidAccessToken(connection.id);
    const gmail = getGmailClient(accessToken);

    // Scale message limit with time window — longer lookback needs more
    // messages since the user may have a high-volume inbox.
    // Quota cost: ~5 units per messages.list page + 5 per messages.get
    // Capped at 500 to prevent long-running requests
    const days = input?.days ?? 30;
    const after = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    const MAX_MESSAGES = Math.min(days <= 30 ? 500 : days <= 90 ? 750 : 1000, 1000);
    const messageIds: string[] = [];
    let pageToken: string | undefined;

    while (messageIds.length < MAX_MESSAGES) {
      const listRes = await gmail.users.messages.list({
        userId: "me",
        q: `-in:spam -in:trash after:${after}`,
        maxResults: Math.min(500, MAX_MESSAGES - messageIds.length),
        ...(pageToken ? { pageToken } : {}),
      });

      const ids = (listRes.data.messages ?? []).map((m) => m.id!).filter(Boolean);
      messageIds.push(...ids);

      pageToken = listRes.data.nextPageToken ?? undefined;
      if (!pageToken || ids.length === 0) break;
    }

    if (messageIds.length === 0) {
      return { domains: [] };
    }

    // Fetch From headers in parallel batches of 25
    const BATCH_SIZE = 25;
    const domainMap = new Map<string, Set<string>>(); // domain → set of sender names

    for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
      const batch = messageIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((id) =>
          gmail.users.messages.get({
            userId: "me",
            id,
            format: "metadata",
            metadataHeaders: ["From"],
          })
        )
      );

      for (const res of results) {
        const fromHeader = res.data.payload?.headers?.find(
          (h) => h.name?.toLowerCase() === "from"
        )?.value;
        if (!fromHeader) continue;

        const { name, email } = parseFromHeader(fromHeader);
        const domain = email.split("@")[1]?.toLowerCase();
        if (!domain || isDomainExcluded(domain)) continue;

        if (!domainMap.has(domain)) {
          domainMap.set(domain, new Set());
        }
        if (name) {
          domainMap.get(domain)!.add(name);
        }
      }
    }

    // Sort alphabetically by domain
    const domains = Array.from(domainMap.entries())
      .map(([domain, names]) => ({
        domain,
        senderNames: Array.from(names).slice(0, 5), // cap display names
      }))
      .sort((a, b) => a.domain.localeCompare(b.domain));

    return { domains };
  }),

  cancelBackfill: protectedProcedure.mutation(async ({ ctx }) => {
    const { requestBackfillCancel } = await import("@/worker/jobs/process-user-emails");
    try {
      await requestBackfillCancel(ctx.authUserId);
    } catch (err) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: err instanceof Error ? err.message : "Failed to cancel backfill",
      });
    }
    return { success: true };
  }),

  backfillStatus: protectedProcedure.query(async ({ ctx }) => {
    const { emailQueue, connection: redisConn } = await import("@/worker/queue");
    const { backfillRedisKey, backfillCancelKey } = await import("@/worker/jobs/process-user-emails");

    // 1. Check Redis for active backfill job ID
    const jobId = await redisConn.get(backfillRedisKey(ctx.authUserId));

    if (jobId) {
      const job = await emailQueue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        const progress = (job.progress ?? {}) as Record<string, unknown>;

        if (state === "completed") {
          // Check if the job ended via cancellation
          if (progress.phase === "cancelled") {
            return { status: "cancelled" as const, progress };
          }
          return { status: "completed" as const, progress };
        }
        if (state === "failed") {
          return {
            status: "failed" as const,
            progress,
            error: job.failedReason ?? "Unknown error",
          };
        }

        // active, waiting, delayed: check if cancel signal is pending
        const cancelPending = await redisConn.get(backfillCancelKey(ctx.authUserId));
        if (cancelPending) {
          return { status: "cancelling" as const, progress };
        }

        return { status: "active" as const, progress };
      }
    }

    // 2. No active job — check if a backfill has ever completed
    const hasBackfilled = await prisma.processedEmail.findFirst({
      where: { userId: ctx.authUserId, isBackfill: true },
      select: { id: true },
    });

    return {
      status: (hasBackfilled ? "completed" : "idle") as "completed" | "idle",
      progress: {},
    };
  }),

  triggerBackfill: protectedProcedure.mutation(async ({ ctx }) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.authUserId },
      select: { emailAccountType: true },
    });

    if (user.emailAccountType !== "SHARED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Trigger backfill is only for shared inbox users",
      });
    }

    const connection = await prisma.emailConnection.findUnique({
      where: { userId: ctx.authUserId },
      select: { id: true, status: true },
    });

    if (!connection || connection.status !== "ACTIVE") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No active email connection",
      });
    }

    // Check that user has at least one allowed sender
    const senderCount = await prisma.allowedSender.count({
      where: { userId: ctx.authUserId },
    });
    if (senderCount === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Add at least one allowed sender before triggering backfill",
      });
    }

    // Guard against duplicate backfills — check if any backfilled emails exist
    const hasBackfilled = await prisma.processedEmail.findFirst({
      where: { userId: ctx.authUserId, isBackfill: true },
      select: { id: true },
    });
    if (hasBackfilled) {
      return { alreadyBackfilled: true };
    }

    const { emailQueue } = await import("@/worker/queue");
    const job = await emailQueue.add(
      "backfill-user-emails",
      {
        userId: ctx.authUserId,
        connectionId: connection.id,
        isBackfill: true,
      },
      { delay: 2000 }
    );

    return { alreadyBackfilled: false, jobId: job.id };
  }),
});
