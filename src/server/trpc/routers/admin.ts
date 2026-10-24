import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../trpc";
import { prisma } from "@/server/db/prisma";
import { invalidateProviderCache } from "@/server/ai/provider-cache";
import { invalidateConfigCache } from "@/server/config";
import { getReactivationData } from "@/server/lifecycle-helpers";
import { DEFAULTS } from "../../../../app.config.defaults";
import { aggregateBriefDeliveries } from "@/lib/brief-stats";

// Default token costs per million tokens (USD) by provider
const DEFAULT_TOKEN_COSTS: Record<string, { input: number; output: number }> = {
  openai: { input: 2.0, output: 8.0 },       // gpt-4.1
  anthropic: { input: 3.0, output: 15.0 },    // claude-sonnet-4-5
  grok: { input: 3.0, output: 15.0 },         // grok-3
  gemini: { input: 0.75, output: 3.75 },      // gemini-3.8-flash (promo rate, doubles Jan 2027)
};

/** Check if support data consent is active (not expired). */
function isConsentActive(user: { supportDataConsent: boolean; supportDataConsentExpiresAt: Date | null } | null): boolean {
  if (!user?.supportDataConsent) return false;
  if (user.supportDataConsentExpiresAt && user.supportDataConsentExpiresAt < new Date()) return false;
  return true;
}

/** Build CSV from decrypted AI call log entries */
function buildCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = ["id", "createdAt", "userId", "action", "provider", "model", "success", "durationMs", "inputTokens", "outputTokens", "errorType", "errorMessage", "prompt", "response", "metadata"];
  const escape = (val: unknown): string => {
    const s = val == null ? "" : typeof val === "object" ? JSON.stringify(val) : String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

function buildDateRangeFilter(dateFrom?: string, dateTo?: string): Record<string, Date> | undefined {
  if (!dateFrom && !dateTo) return undefined;
  const range: Record<string, Date> = {};
  if (dateFrom) range.gte = new Date(dateFrom);
  if (dateTo) {
    const end = new Date(dateTo);
    end.setDate(end.getDate() + 1);
    range.lt = end;
  }
  return range;
}

function parseSourceEmails(raw: string | null): Array<{ subject: string; fromName: string | null; fromAddress: string }> {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function decryptChildName(nameEncrypted: Buffer | null, decryptFn: (buf: Buffer) => string): string {
  if (!nameEncrypted) return "Unknown";
  try { return decryptFn(Buffer.from(nameEncrypted)); } catch { return "Unknown"; }
}

type CapturedEmail = { subject: string; fromName: string | null; fromAddress: string; body: string | null; bodyHtml: string | null };

function parseSnapshotEmails(data: {
  emails?: CapturedEmail[];
  emailSubject?: string | null;
  emailFromAddress?: string | null;
  emailFromName?: string | null;
  emailBody?: string | null;
  emailBodyHtml?: string | null;
}): CapturedEmail[] {
  if (data.emails && data.emails.length > 0) return data.emails;
  if (data.emailSubject) {
    return [{
      subject: data.emailSubject,
      fromName: data.emailFromName ?? null,
      fromAddress: data.emailFromAddress ?? "",
      body: data.emailBody ?? null,
      bodyHtml: data.emailBodyHtml ?? null,
    }];
  }
  return [];
}

async function getAiCallLogIdsWithFeedback(hasFeedback: boolean): Promise<string[]> {
  // Single SQL JOIN instead of loading both tables into memory
  if (hasFeedback) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT al."id"
      FROM "AICallLog" al
      INNER JOIN "ProcessedEmail" pe
        ON pe."userId" = al."userId"
        AND pe."externalMessageId" = al."metadata"->>'externalMessageId'
      WHERE al."action" = 'email-analysis'
        AND al."metadata" IS NOT NULL
        AND pe."userFeedback" IS NOT NULL
    `;
    return rows.map((r) => r.id);
  } else {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT al."id"
      FROM "AICallLog" al
      WHERE al."action" = 'email-analysis'
        AND al."metadata" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "ProcessedEmail" pe
          WHERE pe."userId" = al."userId"
            AND pe."externalMessageId" = al."metadata"->>'externalMessageId'
            AND pe."userFeedback" IS NOT NULL
        )
    `;
    return rows.map((r) => r.id);
  }
}

export const adminRouter = router({
  // ---- App URL ----

  appUrlConfig: adminProcedure.query(async () => {
    const config = await prisma.systemConfig.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    return { appUrl: config.appUrl };
  }),

  setAppUrlConfig: adminProcedure
    .input(z.object({ appUrl: z.string().url() }))
    .mutation(async ({ input }) => {
      const appUrl = input.appUrl.replace(/\/+$/, ""); // strip trailing slash
      await prisma.systemConfig.update({
        where: { id: "singleton" },
        data: { appUrl },
      });
      invalidateConfigCache();
      return { success: true };
    }),

  clearAppUrl: adminProcedure.mutation(async () => {
    await prisma.systemConfig.update({
      where: { id: "singleton" },
      data: { appUrl: null },
    });
    invalidateConfigCache();
    return { success: true };
  }),

  // ---- Branding ----

  brandingConfig: adminProcedure.query(async () => {
    const config = await prisma.systemConfig.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    return {
      brandName: config.brandName,
      brandTagline: config.brandTagline,
    };
  }),

  setBrandingConfig: adminProcedure
    .input(
      z.object({
        brandName: z.string().min(1).max(100),
        brandTagline: z.string().max(200),
      })
    )
    .mutation(async ({ input }) => {
      await prisma.systemConfig.update({
        where: { id: "singleton" },
        data: input,
      });
      invalidateConfigCache();
      return { success: true };
    }),

  users: adminProcedure.query(async () => {
    const users = await prisma.user.findMany({
      where: { role: "USER" },
      select: {
        id: true,
        name: true,
        email: true,
        pendingEmail: true,
        isMonitoringEnabled: true,
        debugToolsEnabled: true,
        accountStatus: true,
        lastActiveAt: true,
        lastCalendarAccessAt: true,
        inactivityNotifiedAt: true,
        lifecycleEmailsSent: true,
        deactivatedAt: true,
        createdAt: true,
        emailConnection: {
          select: {
            status: true,
            provider: true,
            emailAddress: true,
            lastPolledAt: true,
          },
        },
        householdId: true,
        household: {
          select: {
            primaryUserId: true,
            primaryUser: { select: { id: true, name: true } },
          },
        },
        ownedHousehold: {
          select: {
            members: { select: { id: true, name: true } },
          },
        },
        _count: {
          select: {
            children: true,
            processedEmails: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Stats use live ProcessedEmail table + DailyStats rollups for historical data.
    // DailyStats delivered/bounced counts can be stale (webhooks may not have fired
    // before the retention cleanup rolled up the records), so those use live-only.
    const [forwardedCounts, skippedCounts, attachmentSums, deliveredCounts, bouncedCounts, historicalStats, lastProcessedDates] = await Promise.all([
      prisma.processedEmail.groupBy({
        by: ["userId"],
        where: { forwarded: true },
        _count: true,
      }),
      prisma.processedEmail.groupBy({
        by: ["userId"],
        where: { aiDecision: false },
        _count: true,
      }),
      prisma.processedEmail.groupBy({
        by: ["userId"],
        _sum: { attachmentCount: true },
      }),
      prisma.processedEmail.groupBy({
        by: ["userId"],
        where: { deliveryStatus: "delivered" },
        _count: true,
      }),
      prisma.processedEmail.groupBy({
        by: ["userId"],
        where: { deliveryStatus: { in: ["bounced", "complained"] } },
        _count: true,
      }),
      prisma.processedEmailDailyStats.groupBy({
        by: ["userId"],
        _sum: {
          emailCount: true,
          forwardedCount: true,
          skippedCount: true,
          attachmentCount: true,
        },
      }),
      prisma.processedEmail.groupBy({
        by: ["userId"],
        _max: { createdAt: true },
      }),
    ]);

    const forwardedMap = new Map(
      forwardedCounts.map((r) => [r.userId, r._count])
    );
    const skippedMap = new Map(
      skippedCounts.map((r) => [r.userId, r._count])
    );
    const attachmentMap = new Map(
      attachmentSums.map((r) => [r.userId, r._sum.attachmentCount ?? 0])
    );
    const deliveredMap = new Map(
      deliveredCounts.map((r) => [r.userId, r._count])
    );
    const bouncedMap = new Map(
      bouncedCounts.map((r) => [r.userId, r._count])
    );
    const historicalMap = new Map(
      historicalStats.map((r) => [r.userId, {
        emailCount: r._sum.emailCount ?? 0,
        forwardedCount: r._sum.forwardedCount ?? 0,
        skippedCount: r._sum.skippedCount ?? 0,
        attachmentCount: r._sum.attachmentCount ?? 0,
      }])
    );
    const lastProcessedMap = new Map(
      lastProcessedDates.map((r) => [r.userId, r._max.createdAt])
    );
    const userProcessedMap = new Map(
      users.map((u) => [u.id, u._count.processedEmails])
    );

    return users.map((user) => {
      const effectiveId = user.household?.primaryUserId ?? user.id;
      const isMember = !!user.householdId && effectiveId !== user.id;
      const isPrimary = !!user.ownedHousehold;
      const hist = historicalMap.get(effectiveId);

      return {
        ...user,
        _count: {
          ...user._count,
          processedEmails: (isMember
            ? (userProcessedMap.get(effectiveId) ?? 0)
            : user._count.processedEmails
          ) + (hist?.emailCount ?? 0),
        },
        forwardedCount: (forwardedMap.get(effectiveId) ?? 0) + (hist?.forwardedCount ?? 0),
        skippedCount: (skippedMap.get(effectiveId) ?? 0) + (hist?.skippedCount ?? 0),
        attachmentCount: (attachmentMap.get(effectiveId) ?? 0) + (hist?.attachmentCount ?? 0),
        // Delivered/bounced: live table only (DailyStats has stale delivery data)
        deliveredCount: deliveredMap.get(effectiveId) ?? 0,
        bouncedCount: bouncedMap.get(effectiveId) ?? 0,
        lastProcessedEmailAt: lastProcessedMap.get(effectiveId) ?? null,
        householdRole: isPrimary ? "primary" as const : isMember ? "member" as const : null,
        householdPrimaryName: isMember ? (user.household?.primaryUser?.name ?? null) : null,
        householdMemberNames: isPrimary
          ? user.ownedHousehold!.members.filter((m) => m.id !== user.id).map((m) => m.name ?? m.id)
          : null,
      };
    });
  }),

  tokenUsage: adminProcedure
    .input(z.object({ days: z.number().min(1).max(365).default(30) }))
    .query(async ({ input }) => {
      // UNION ALL: live ProcessedEmail records + rolled-up DailyStats, then re-aggregate
      const rows = await prisma.$queryRaw<
        {
          day: Date;
          tokens_input: bigint;
          tokens_output: bigint;
          email_count: bigint;
          attachment_count: bigint;
        }[]
      >`
        SELECT
          day,
          SUM(tokens_input) AS tokens_input,
          SUM(tokens_output) AS tokens_output,
          SUM(email_count) AS email_count,
          SUM(attachment_count) AS attachment_count
        FROM (
          SELECT
            DATE_TRUNC('day', "createdAt")::date AS day,
            SUM("aiTokensInput") AS tokens_input,
            SUM("aiTokensOutput") AS tokens_output,
            COUNT(*) AS email_count,
            SUM("attachmentCount") AS attachment_count
          FROM "ProcessedEmail"
          WHERE "createdAt" >= NOW() - INTERVAL '1 day' * ${input.days}
          GROUP BY DATE_TRUNC('day', "createdAt")::date

          UNION ALL

          SELECT
            "date" AS day,
            SUM("tokensInput") AS tokens_input,
            SUM("tokensOutput") AS tokens_output,
            SUM("emailCount") AS email_count,
            SUM("attachmentCount") AS attachment_count
          FROM "ProcessedEmailDailyStats"
          WHERE "date" >= (NOW() - INTERVAL '1 day' * ${input.days})::date
          GROUP BY "date"
        ) combined
        GROUP BY day
        ORDER BY day DESC
      `;

      return rows.map((row) => ({
        day: row.day.toISOString().slice(0, 10),
        tokensInput: Number(row.tokens_input),
        tokensOutput: Number(row.tokens_output),
        emailCount: Number(row.email_count),
        attachmentCount: Number(row.attachment_count),
      }));
    }),

  resetUserPassword: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        newPassword: z.string().min(12, "Password must be at least 12 characters"),
      })
    )
    .mutation(async ({ input }) => {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, role: true },
      });

      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
      }
      if (user.role !== "USER") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot reset password for admin accounts." });
      }

      const bcrypt = await import("bcryptjs");
      const newHash = await bcrypt.hash(input.newPassword, 12);
      await prisma.user.update({
        where: { id: input.userId },
        data: { passwordHash: newHash },
      });

      return { success: true };
    }),

  changeUserEmail: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        newEmail: z.string().email(),
      })
    )
    .mutation(async ({ input }) => {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, role: true, email: true },
      });

      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
      }
      if (user.role !== "USER") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot change email for admin accounts via user management." });
      }

      if (input.newEmail.toLowerCase() === user.email.toLowerCase()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "New email is the same as the current email." });
      }

      const existing = await prisma.user.findFirst({
        where: { email: { equals: input.newEmail, mode: "insensitive" } },
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "This email address is already in use." });
      }

      await prisma.user.update({
        where: { id: input.userId },
        data: { pendingEmail: input.newEmail },
      });

      const { createVerificationToken } = await import("@/lib/verification-token");
      const { sendVerificationEmail } = await import("@/server/email/sender");
      const token = await createVerificationToken(`email-change:${input.userId}`);
      await sendVerificationEmail({ to: input.newEmail, type: "email-change", token });

      return { success: true };
    }),

  deleteUser: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, role: true },
      });

      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
      }
      if (user.role !== "USER") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete admin accounts." });
      }

      // Revoke Gmail token with Google before cascade-deleting (best-effort)
      const connection = await prisma.emailConnection.findUnique({
        where: { userId: input.userId },
        select: { accessTokenEncrypted: true, refreshTokenEncrypted: true },
      });
      if (connection) {
        try {
          const { decryptTokens, revokeGoogleToken } = await import("@/server/gmail/token-manager");
          const { refreshToken } = decryptTokens(connection);
          await revokeGoogleToken(refreshToken);
        } catch {
          // Revocation failure should not block account deletion
        }
      }

      await prisma.user.delete({ where: { id: input.userId } });
      return { success: true };
    }),

  setUserMonitoring: adminProcedure
    .input(z.object({ userId: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      return prisma.user.update({
        where: { id: input.userId },
        data: { isMonitoringEnabled: input.enabled },
        select: { id: true, isMonitoringEnabled: true },
      });
    }),

  setUserDebugTools: adminProcedure
    .input(z.object({ userId: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      return prisma.user.update({
        where: { id: input.userId },
        data: { debugToolsEnabled: input.enabled },
        select: { id: true, debugToolsEnabled: true },
      });
    }),

  adminReactivateUser: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const user = await prisma.user.update({
        where: { id: input.userId },
        data: getReactivationData(),
        select: { id: true, email: true, accountStatus: true },
      });

      // Send reactivation notice (fire-and-forget)
      import("@/server/email/sender")
        .then(({ sendReactivationNotice }) =>
          sendReactivationNotice({ to: user.email })
        )
        .catch((err) => {
          console.error(`Failed to send reactivation notice to ${user.email}:`, err);
        });

      return { id: user.id, accountStatus: user.accountStatus };
    }),

  adminDeactivateUser: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await prisma.user.update({
        where: { id: input.userId },
        data: {
          accountStatus: "DEACTIVATED",
          deactivatedAt: new Date(),
          isMonitoringEnabled: false,
        },
        select: { id: true, accountStatus: true },
      });

      // Disconnect Gmail connection
      await prisma.emailConnection.updateMany({
        where: { userId: input.userId },
        data: { status: "DISCONNECTED" },
      });

      return { success: true };
    }),

  adminBackfill: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const connection = await prisma.emailConnection.findUnique({
        where: { userId: input.userId },
        select: { id: true, status: true },
      });
      if (!connection) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "User has no email connection." });
      }
      if (connection.status !== "ACTIVE") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "User's email connection is not active." });
      }

      // Idempotent: skip if a backfill is already active
      const { emailQueue, connection: redisConn } = await import("@/worker/queue");
      const { backfillRedisKey, BACKFILL_KEY_TTL } = await import("@/worker/jobs/process-user-emails");

      const existingJobId = await redisConn.get(backfillRedisKey(input.userId));
      if (existingJobId) {
        const existingJob = await emailQueue.getJob(existingJobId);
        if (existingJob) {
          const state = await existingJob.getState();
          if (state === "active" || state === "waiting" || state === "delayed") {
            return { success: true, jobId: existingJobId, alreadyRunning: true };
          }
        }
      }

      const job = await emailQueue.add("backfill-user-emails", {
        userId: input.userId,
        connectionId: connection.id,
        isBackfill: true,
      }, { priority: 10 });

      await redisConn.set(backfillRedisKey(input.userId), job.id!, "EX", BACKFILL_KEY_TTL);

      return { success: true, jobId: job.id, alreadyRunning: false };
    }),

  clearAndBackfill: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      // Verify user exists and has a Gmail connection
      const connection = await prisma.emailConnection.findUnique({
        where: { userId: input.userId },
        select: { id: true, status: true },
      });
      if (!connection) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "User has no email connection." });
      }
      if (connection.status !== "ACTIVE") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "User's email connection is not active." });
      }

      // Clear all processed data
      await prisma.$transaction([
        prisma.extractedEvent.deleteMany({ where: { userId: input.userId } }),
        prisma.processedEmail.deleteMany({ where: { userId: input.userId } }),
        prisma.processedEmailDailyStats.deleteMany({ where: { userId: input.userId } }),
        prisma.emailConnection.updateMany({
          where: { userId: input.userId },
          data: { syncCursor: null, lastPolledAt: null },
        }),
      ]);

      // Queue backfill job
      const { emailQueue, connection: redisConn } = await import("@/worker/queue");
      const { backfillRedisKey, BACKFILL_KEY_TTL } = await import("@/worker/jobs/process-user-emails");

      const job = await emailQueue.add("backfill-user-emails", {
        userId: input.userId,
        connectionId: connection.id,
        isBackfill: true,
      }, { priority: 10 });

      await redisConn.set(backfillRedisKey(input.userId), job.id!, "EX", BACKFILL_KEY_TTL);

      return { success: true, jobId: job.id };
    }),

  adminCancelBackfill: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const { requestBackfillCancel } = await import("@/worker/jobs/process-user-emails");
      await requestBackfillCancel(input.userId);
      return { success: true };
    }),

  globalConfig: adminProcedure.query(async () => {
    const config = await prisma.systemConfig.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    return {
      isMonitoringEnabled: config.isMonitoringEnabled,
      recentActivityLimit: config.recentActivityLimit,
      lifecycleEnforcementEnabled: config.lifecycleEnforcementEnabled,
      updatedAt: config.updatedAt,
    };
  }),

  setGlobalMonitoring: adminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const updated = await prisma.systemConfig.update({
        where: { id: "singleton" },
        data: { isMonitoringEnabled: input.enabled },
        select: { isMonitoringEnabled: true, updatedAt: true },
      });
      invalidateConfigCache();
      return updated;
    }),

  setLifecycleEnforcement: adminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const updated = await prisma.systemConfig.update({
        where: { id: "singleton" },
        data: { lifecycleEnforcementEnabled: input.enabled },
        select: { lifecycleEnforcementEnabled: true, updatedAt: true },
      });
      invalidateConfigCache();
      return updated;
    }),

  setRecentActivityLimit: adminProcedure
    .input(z.object({ limit: z.number().int().min(10).max(500) }))
    .mutation(async ({ input }) => {
      await prisma.systemConfig.update({
        where: { id: "singleton" },
        data: { recentActivityLimit: input.limit },
      });
      invalidateConfigCache();
      return { success: true };
    }),

  aiConfig: adminProcedure.query(async () => {
    const config = await prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: {
        aiProvider: true,
        aiModel: true,
        aiVisionModel: true,
        aiApiKeyEncrypted: true,
        updatedAt: true,
      },
    });
    return {
      provider: config?.aiProvider ?? null,
      model: config?.aiModel ?? null,
      visionModel: config?.aiVisionModel ?? null,
      hasApiKey: config?.aiApiKeyEncrypted != null,
      updatedAt: config?.updatedAt ?? null,
    };
  }),

  setAIConfig: adminProcedure
    .input(
      z.object({
        provider: z.enum(["openai", "anthropic", "grok", "gemini"]),
        model: z.string().min(1).max(100),
        apiKey: z.string().min(1).max(500).optional(),
        visionModel: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ input }) => {
      // If no API key provided, verify one already exists in DB
      const existing = await prisma.systemConfig.findUnique({
        where: { id: "singleton" },
        select: {
          aiApiKeyEncrypted: true,
          tokenCostInputPerMillion: true,
          tokenCostOutputPerMillion: true,
        },
      });
      if (!input.apiKey && !existing?.aiApiKeyEncrypted) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "API key is required when no key is currently configured." });
      }

      const data: Record<string, unknown> = {
        aiProvider: input.provider,
        aiModel: input.model,
        aiVisionModel: input.visionModel?.trim() || null,
      };
      if (input.apiKey) {
        const { encrypt } = await import("@/lib/encryption");
        data.aiApiKeyEncrypted = encrypt(input.apiKey);
      }

      // Auto-seed token costs if they haven't been manually configured
      const costsNotSet =
        existing?.tokenCostInputPerMillion == null &&
        existing?.tokenCostOutputPerMillion == null;
      if (costsNotSet) {
        const defaults = DEFAULT_TOKEN_COSTS[input.provider];
        if (defaults) {
          data.tokenCostInputPerMillion = defaults.input;
          data.tokenCostOutputPerMillion = defaults.output;
        }
      }

      await prisma.systemConfig.update({
        where: { id: "singleton" },
        data,
      });
      invalidateProviderCache();
      invalidateConfigCache();
      return { success: true };
    }),

  clearAIConfig: adminProcedure.mutation(async () => {
    await prisma.systemConfig.update({
      where: { id: "singleton" },
      data: {
        aiProvider: null,
        aiModel: null,
        aiVisionModel: null,
        aiApiKeyEncrypted: null,
      },
    });
    invalidateProviderCache();
    invalidateConfigCache();
    return { success: true };
  }),

  testAIConfig: adminProcedure.mutation(async () => {
    // Fetch saved config first so we can report it even on failure
    const config = await prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { aiProvider: true, aiModel: true, aiApiKeyEncrypted: true },
    });
    const providerName = config?.aiProvider ?? null;
    const modelName = config?.aiModel ?? null;
    const hasKey = config?.aiApiKeyEncrypted != null;

    if (!providerName || !modelName || !hasKey) {
      return {
        success: false as const,
        provider: providerName,
        model: modelName,
        hasKey,
        error: "AI provider is not fully configured. Set a provider, model, and API key first.",
      };
    }

    try {
      const { getAIProvider } = await import("@/server/ai/provider");
      const provider = await getAIProvider();
      const result = await provider.generateText("Reply with the word OK.");
      return {
        success: true as const,
        provider: providerName,
        model: modelName,
        hasKey,
        text: result.text,
        latencyMs: result.latencyMs,
        tokensInput: result.tokensInput,
        tokensOutput: result.tokensOutput,
      };
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // Extract HTTP status if present (common in provider SDK errors)
      const statusMatch = raw.match(/status(?:\s+code)?[:\s]+(\d{3})/i);
      const status = statusMatch ? statusMatch[1] : null;
      return {
        success: false as const,
        provider: providerName,
        model: modelName,
        hasKey,
        error: raw,
        httpStatus: status,
      };
    }
  }),

  // ---- Token Cost Estimation ----

  tokenCostConfig: adminProcedure.query(async () => {
    const config = await prisma.systemConfig.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    return {
      inputCostPerMillion: config.tokenCostInputPerMillion,
      outputCostPerMillion: config.tokenCostOutputPerMillion,
    };
  }),

  setTokenCostConfig: adminProcedure
    .input(
      z.object({
        inputCostPerMillion: z.number().min(0).max(1000),
        outputCostPerMillion: z.number().min(0).max(1000),
      })
    )
    .mutation(async ({ input }) => {
      await prisma.systemConfig.update({
        where: { id: "singleton" },
        data: {
          tokenCostInputPerMillion: input.inputCostPerMillion,
          tokenCostOutputPerMillion: input.outputCostPerMillion,
        },
      });
      invalidateConfigCache();
      return { success: true };
    }),

  // ---- Worker / Scheduler ----

  workerConfig: adminProcedure.query(async () => {
    const config = await prisma.systemConfig.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    return {
      pollIntervalMinutes: config.pollIntervalMinutes,
      activeHoursStart: config.activeHoursStart,
      activeHoursEnd: config.activeHoursEnd,
      timezone: config.timezone,
      dailyBriefEventDays: config.dailyBriefEventDays,
      aiConcurrency: config.aiConcurrency,
    };
  }),

  setWorkerConfig: adminProcedure
    .input(
      z.object({
        pollIntervalMinutes: z.number().int().min(1).max(1440),
        activeHoursStart: z.number().int().min(0).max(23),
        activeHoursEnd: z.number().int().min(1).max(24),
        timezone: z.string().min(1).max(100),
        dailyBriefEventDays: z.number().int().min(1).max(14),
        aiConcurrency: z.number().int().min(1).max(10),
      })
    )
    .mutation(async ({ input }) => {
      await prisma.systemConfig.update({
        where: { id: "singleton" },
        data: input,
      });
      invalidateConfigCache();
      return { success: true };
    }),

  // ---- AI Prompt Instructions ----

  promptConfig: adminProcedure.query(async () => {
    const config = await prisma.systemConfig.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    return {
      raw: {
        aiSystemInstruction: config.aiSystemInstruction,
        aiRelevanceInstruction: config.aiRelevanceInstruction,
        aiSummaryInstructionConcise: config.aiSummaryInstructionConcise,
        aiResponseFormatInstruction: config.aiResponseFormatInstruction,
        aiNoSendInstruction: config.aiNoSendInstruction,
        aiEventExtractionInstruction: config.aiEventExtractionInstruction,
        aiBriefSummaryInstruction: config.aiBriefSummaryInstruction,
      },
      defaults: {
        aiSystemInstruction: DEFAULTS.aiSystemInstruction,
        aiRelevanceInstruction: DEFAULTS.aiRelevanceInstruction,
        aiSummaryInstructionConcise: DEFAULTS.aiSummaryInstructionConcise,
        aiResponseFormatInstruction: DEFAULTS.aiResponseFormatInstruction,
        aiNoSendInstruction: DEFAULTS.aiNoSendInstruction,
        aiEventExtractionInstruction: DEFAULTS.aiEventExtractionInstruction,
        aiBriefSummaryInstruction: DEFAULTS.aiBriefSummaryInstruction,
      },
    };
  }),

  setPromptConfig: adminProcedure
    .input(
      z.object({
        aiSystemInstruction: z.string().min(1).max(2000).nullable(),
        aiRelevanceInstruction: z.string().min(1).max(2000).nullable(),
        aiSummaryInstructionConcise: z.string().min(1).max(2000).nullable(),
        aiResponseFormatInstruction: z.string().min(1).max(2000).nullable(),
        aiNoSendInstruction: z.string().min(1).max(2000).nullable(),
        aiEventExtractionInstruction: z.string().min(1).max(2000).nullable(),
        aiBriefSummaryInstruction: z.string().min(1).max(2000).nullable(),
      })
    )
    .mutation(async ({ input }) => {
      await prisma.systemConfig.update({
        where: { id: "singleton" },
        data: input,
      });
      invalidateConfigCache();
      return { success: true };
    }),

  // ---- Email Forwarding (Resend) ----

  resendConfig: adminProcedure.query(async () => {
    const config = await prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: {
        resendFromAddress: true,
        resendApiKeyEncrypted: true,
        resendWebhookSecret: true,
        resendWebhookEnabled: true,
      },
    });
    return {
      fromAddress: config?.resendFromAddress ?? null,
      hasApiKey: config?.resendApiKeyEncrypted != null,
      hasWebhookSecret: !!config?.resendWebhookSecret,
      webhookEnabled: config?.resendWebhookEnabled ?? true,
    };
  }),

  setResendConfig: adminProcedure
    .input(
      z.object({
        fromAddress: z.string().min(1).max(200).refine(
          (v) => {
            // Accept "Name <email>" or bare email
            const match = v.match(/<([^>]+)>$/);
            const email = match ? match[1] : v;
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
          },
          { message: "Must be a valid email or 'Name <email>' format" }
        ),
        apiKey: z.string().min(1).max(500).optional(),
        webhookSecret: z.string().max(500).optional(),
        webhookEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (!input.apiKey) {
        const existing = await prisma.systemConfig.findUnique({
          where: { id: "singleton" },
          select: { resendApiKeyEncrypted: true },
        });
        if (!existing?.resendApiKeyEncrypted) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Resend API key is required when no key is currently configured." });
        }
      }

      const data: Record<string, unknown> = {
        resendFromAddress: input.fromAddress,
      };
      if (input.apiKey) {
        const { encrypt } = await import("@/lib/encryption");
        data.resendApiKeyEncrypted = encrypt(input.apiKey);
      }
      if (input.webhookSecret !== undefined) {
        data.resendWebhookSecret = input.webhookSecret || null;
      }
      if (input.webhookEnabled !== undefined) {
        data.resendWebhookEnabled = input.webhookEnabled;
      }

      await prisma.systemConfig.update({
        where: { id: "singleton" },
        data,
      });
      invalidateConfigCache();
      return { success: true };
    }),

  // ---- Email Footer ----

  emailFooterConfig: adminProcedure.query(async () => {
    const config = await prisma.systemConfig.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    return {
      enabled: config.emailFooterEnabled,
      text: config.emailFooterText ?? "",
    };
  }),

  setEmailFooterConfig: adminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        text: z.string().max(2000),
      })
    )
    .mutation(async ({ input }) => {
      await prisma.systemConfig.update({
        where: { id: "singleton" },
        data: {
          emailFooterEnabled: input.enabled,
          emailFooterText: input.text || null,
        },
      });
      invalidateConfigCache();
      return { success: true };
    }),

  // ---- Signup Access Code ----

  signupCodeConfig: adminProcedure.query(async () => {
    const config = await prisma.systemConfig.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    return {
      enabled: config.signupCodeEnabled,
      code: config.signupCode ?? "",
    };
  }),

  setSignupCodeConfig: adminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        code: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (input.enabled && (!input.code || input.code.trim().length === 0)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "An access code is required when enabling signup gating." });
      }
      await prisma.systemConfig.update({
        where: { id: "singleton" },
        data: {
          signupCodeEnabled: input.enabled,
          signupCode: input.code?.trim() || null,
        },
      });
      invalidateConfigCache();
      return { success: true };
    }),

  // ---- Data Retention ----

  retentionConfig: adminProcedure.query(async () => {
    const config = await prisma.systemConfig.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    return {
      dataRetentionDays: config.dataRetentionDays,
      eventRetentionDays: config.eventRetentionDays,
      feedbackSnapshotRetentionDays: config.feedbackSnapshotRetentionDays,
    };
  }),

  setRetentionConfig: adminProcedure
    .input(z.object({
      dataRetentionDays: z.number().int().min(7).max(365),
      eventRetentionDays: z.number().int().min(7).max(365),
      feedbackSnapshotRetentionDays: z.number().int().min(7).max(365),
    }))
    .mutation(async ({ input }) => {
      await prisma.systemConfig.update({
        where: { id: "singleton" },
        data: {
          dataRetentionDays: input.dataRetentionDays,
          eventRetentionDays: input.eventRetentionDays,
          feedbackSnapshotRetentionDays: input.feedbackSnapshotRetentionDays,
        },
      });
      invalidateConfigCache();
      return { success: true };
    }),

  // ---- Admin Alerts ----

  activeAlerts: adminProcedure.query(async () => {
    return prisma.adminAlert.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: "desc" },
    });
  }),

  alertHistory: adminProcedure
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        type: z.enum(["worker_stale", "ai_error", "resend_failure", "gmail_quota"]).optional(),
      })
    )
    .query(async ({ input }) => {
      const where: Record<string, unknown> = {};
      if (input.type) where.type = input.type;

      if (input.cursor) {
        const cursorRow = await prisma.adminAlert.findUnique({
          where: { id: input.cursor },
          select: { createdAt: true },
        });
        if (cursorRow) {
          where.createdAt = { lt: cursorRow.createdAt };
        }
      }

      const rows = await prisma.adminAlert.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 26,
      });

      const hasMore = rows.length > 25;
      const items = hasMore ? rows.slice(0, 25) : rows;

      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
      };
    }),

  resolveAlert: adminProcedure
    .input(z.object({ alertId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await prisma.adminAlert.update({
        where: { id: input.alertId },
        data: { resolvedAt: new Date() },
      });
      return { success: true };
    }),

  resolveAllAlerts: adminProcedure.mutation(async () => {
    const active = await prisma.adminAlert.findMany({
      where: { resolvedAt: null },
      select: { id: true },
    });
    if (active.length === 0) return { resolved: 0 };
    // Resolve sequentially with unique timestamps to avoid (dedupKey, resolvedAt) collision
    const base = Date.now();
    for (let i = 0; i < active.length; i++) {
      await prisma.adminAlert.update({
        where: { id: active[i]!.id },
        data: { resolvedAt: new Date(base + i) },
      });
    }
    return { resolved: active.length };
  }),

  // ---- System Status ----

  systemStatus: adminProcedure.query(async () => {
    const logger = (await import("@/lib/logger")).default;
    const TAG = "admin.systemStatus";
    const overallStart = Date.now();
    const IORedis = (await import("ioredis")).default;
    const { Queue } = await import("bullmq");

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      return {
        redis: { status: "error" as const, latencyMs: 0, error: "REDIS_URL not set" },
        worker: { status: "unknown" as const, lastHeartbeat: null },
        queue: null,
        database: { status: "error" as const, latencyMs: 0 },
        recentFailed: [],
      };
    }

    let client: InstanceType<typeof IORedis> | null = null;
    let queue: InstanceType<typeof Queue> | null = null;

    // DB health check (runs in parallel with Redis)
    const dbPromise = (async () => {
      const dbStart = Date.now();
      try {
        await prisma.$queryRaw`SELECT 1`;
        const dbLatency = Date.now() - dbStart;
        logger.debug(TAG, `DB ping: ${dbLatency}ms`);
        return { status: "ok" as const, latencyMs: dbLatency };
      } catch {
        logger.debug(TAG, `DB ping failed after ${Date.now() - dbStart}ms`);
        return { status: "error" as const, latencyMs: Date.now() - dbStart };
      }
    })();

    try {
      const parsedUrl = new URL(redisUrl);
      client = new IORedis({
        host: parsedUrl.hostname,
        port: parseInt(parsedUrl.port) || 6379,
        username: parsedUrl.username || undefined,
        password: parsedUrl.password || undefined,
        family: 0, // dual-stack: IPv4 + IPv6 (required for Railway private networking)
        connectTimeout: 2000,
        commandTimeout: 1000,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
        lazyConnect: true,
      });

      const redisStart = Date.now();
      await client.connect();
      const connectMs = Date.now() - redisStart;
      logger.debug(TAG, `Redis connect: ${connectMs}ms`);

      await client.ping();
      const latencyMs = Date.now() - redisStart;
      logger.debug(TAG, `Redis ping (including connect): ${latencyMs}ms`);

      // Worker heartbeat, stale if older than 2x poll interval
      const heartbeatStart = Date.now();
      const heartbeat = await client.get("worker:heartbeat");
      let workerStatus: "ok" | "stale" | "unknown" = "unknown";
      if (heartbeat) {
        const config = await prisma.systemConfig.findUniqueOrThrow({
          where: { id: "singleton" },
          select: { pollIntervalMinutes: true },
        });
        const staleThresholdMs = config.pollIntervalMinutes * 60 * 1000 * 2;
        const age = Date.now() - new Date(heartbeat).getTime();
        workerStatus = age > staleThresholdMs ? "stale" : "ok";
      }
      logger.debug(TAG, `Heartbeat check: ${Date.now() - heartbeatStart}ms, status=${workerStatus}`);

      // Side-effect: create/resolve worker stale alerts
      try {
        const { createAlert, resolveAlerts } = await import("@/server/alerts/create-alert");
        if (workerStatus === "stale") {
          await createAlert({
            type: "worker_stale",
            severity: "critical",
            title: "Worker heartbeat stale",
            message: `Worker has not sent a heartbeat recently. Last: ${heartbeat ?? "never"}`,
            dedupKey: "worker_stale:singleton",
          });
        } else if (workerStatus === "ok") {
          await resolveAlerts("worker_stale");
        }
      } catch { /* alert side-effect must not break status query */ }

      // Queue stats via BullMQ
      const queueStart = Date.now();
      queue = new Queue("email-processing", {
        connection: {
          host: client.options.host ?? "localhost",
          port: client.options.port ?? 6379,
          password: client.options.password,
          db: client.options.db ?? 0,
          maxRetriesPerRequest: null,
        },
      });
      const counts = await queue.getJobCounts(
        "waiting",
        "active",
        "completed",
        "failed",
        "delayed"
      );
      logger.debug(TAG, `Queue stats: ${Date.now() - queueStart}ms`);

      // Recent failed jobs
      const failedStart = Date.now();
      const failedJobs = await queue.getFailed(0, 4);
      const recentFailed = failedJobs.map((job) => ({
        id: job.id,
        name: job.name,
        failedAt: job.finishedOn
          ? new Date(job.finishedOn).toISOString()
          : null,
        error: job.failedReason?.slice(0, 200) ?? null,
      }));
      logger.debug(TAG, `Failed jobs: ${Date.now() - failedStart}ms`);

      const database = await dbPromise;
      const totalMs = Date.now() - overallStart;
      if (totalMs > 3000) {
        logger.warn(TAG, `Slow status check: ${totalMs}ms total (redis=${latencyMs}ms, db=${database.latencyMs}ms, queue=${Date.now() - queueStart}ms)`);
      } else {
        logger.debug(TAG, `Status check complete: ${totalMs}ms`);
      }

      return {
        redis: { status: "ok" as const, latencyMs },
        worker: { status: workerStatus, lastHeartbeat: heartbeat },
        queue: counts,
        database,
        recentFailed,
      };
    } catch (err) {
      const database = await dbPromise;
      const totalMs = Date.now() - overallStart;
      logger.warn(TAG, `Status check failed after ${totalMs}ms: ${err instanceof Error ? err.message : String(err)}`);
      return {
        redis: {
          status: "error" as const,
          latencyMs: 0,
          error: err instanceof Error ? err.message : String(err),
        },
        worker: { status: "unknown" as const, lastHeartbeat: null },
        queue: null,
        database,
        recentFailed: [],
      };
    } finally {
      if (queue) await queue.close().catch(() => {});
      if (client) client.disconnect();
    }
  }),

  dismissFailedJob: adminProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const IORedis = (await import("ioredis")).default;
      const { Queue } = await import("bullmq");

      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "REDIS_URL not configured." });

      const parsedUrl = new URL(redisUrl);
      const queue = new Queue("email-processing", {
        connection: {
          host: parsedUrl.hostname,
          port: parseInt(parsedUrl.port) || 6379,
          username: parsedUrl.username || undefined,
          password: parsedUrl.password || undefined,
          family: 0,
          maxRetriesPerRequest: null,
        },
      });

      try {
        const job = await queue.getJob(input.jobId);
        if (job) await job.remove();
        return { success: true };
      } finally {
        await queue.close().catch(() => {});
      }
    }),

  // ---- Feedback Stats ----

  feedbackStats: adminProcedure.query(async () => {
    const [
      total, correct, wrongForward, wrongSkip,
      eventTotal, eventCorrect, eventWrongEvent, totalEvents,
      formTotal, formBug, formFeature, formUsability, formEmailQuality, formGeneral,
    ] = await Promise.all([
      prisma.processedEmail.count({
        where: { userFeedback: { not: null } },
      }),
      prisma.processedEmail.count({
        where: { userFeedback: "correct" },
      }),
      prisma.processedEmail.count({
        where: { userFeedback: "wrong_forward" },
      }),
      prisma.processedEmail.count({
        where: { userFeedback: "wrong_skip" },
      }),
      prisma.extractedEvent.count({
        where: { userFeedback: { not: null } },
      }),
      prisma.extractedEvent.count({
        where: { userFeedback: "correct" },
      }),
      prisma.extractedEvent.count({
        where: { userFeedback: "wrong_event" },
      }),
      prisma.extractedEvent.count(),
      prisma.userFeedback.count(),
      prisma.userFeedback.count({ where: { category: "BUG" } }),
      prisma.userFeedback.count({ where: { category: "FEATURE_REQUEST" } }),
      prisma.userFeedback.count({ where: { category: "USABILITY" } }),
      prisma.userFeedback.count({ where: { category: "EMAIL_QUALITY" } }),
      prisma.userFeedback.count({ where: { category: "GENERAL" } }),
    ]);

    const totalProcessed = await prisma.processedEmail.count();
    const feedbackRate = totalProcessed > 0 ? (total / totalProcessed) * 100 : 0;
    const eventFeedbackRate = totalEvents > 0 ? (eventTotal / totalEvents) * 100 : 0;

    return {
      total,
      correct,
      wrongForward,
      wrongSkip,
      feedbackRate: Math.round(feedbackRate * 10) / 10,
      totalProcessed,
      eventTotal,
      eventCorrect,
      eventWrongEvent,
      eventFeedbackRate: Math.round(eventFeedbackRate * 10) / 10,
      totalEvents,
      formTotal,
      formBug,
      formFeature,
      formUsability,
      formEmailQuality,
      formGeneral,
    };
  }),

  // ---- Sender Rule Stats ----

  senderRuleStats: adminProcedure.query(async () => {
    const [totalRules, alwaysForward, neverForward, usersWithRules] = await Promise.all([
      prisma.senderRule.count(),
      prisma.senderRule.count({ where: { action: "ALWAYS_FORWARD" } }),
      prisma.senderRule.count({ where: { action: "NEVER_FORWARD" } }),
      prisma.senderRule.groupBy({ by: ["userId"], _count: true }).then((g) => g.length),
    ]);

    return {
      totalRules,
      alwaysForward,
      neverForward,
      usersWithRules,
    };
  }),

  // ---- Email Processing Log ----

  emailLog: adminProcedure
    .input(
      z.object({
        cursor: z.number().int().min(0).optional(),
        userId: z.string().uuid().optional(),
        decision: z.enum(["all", "forwarded", "skipped"]).default("all"),
        errorStatus: z.enum(["all", "has_error", "no_error"]).default("all"),
        feedback: z.enum(["all", "any", "correct", "wrong_forward", "wrong_skip", "none"]).default("all"),
        dateFrom: z.string().date().optional(),
        dateTo: z.string().date().optional(),
        search: z.string().max(200).optional(),
        sortBy: z.enum(["createdAt", "receivedAt", "subject", "fromAddress", "user", "tokens", "latency"]).default("createdAt"),
        sortDir: z.enum(["asc", "desc"]).default("desc"),
      })
    )
    .query(async ({ input }) => {
      // Build WHERE using AND array to avoid top-level OR conflicts
      const conditions: Record<string, unknown>[] = [];

      if (input.userId) conditions.push({ userId: input.userId });

      if (input.decision === "forwarded") conditions.push({ forwarded: true });
      else if (input.decision === "skipped") conditions.push({ aiDecision: false });

      if (input.errorStatus === "has_error") {
        conditions.push({
          OR: [
            { processingError: { not: null } },
            { deliveryError: { not: null } },
            { deliveryStatus: { in: ["bounced", "complained"] } },
          ],
        });
      } else if (input.errorStatus === "no_error") {
        conditions.push({ processingError: null });
        conditions.push({ deliveryError: null });
        conditions.push({ deliveryStatus: { notIn: ["bounced", "complained"] } });
      }

      if (input.feedback === "any") {
        conditions.push({ userFeedback: { not: null } });
      } else if (input.feedback === "none") {
        conditions.push({ userFeedback: null });
      } else if (input.feedback !== "all") {
        conditions.push({ userFeedback: input.feedback });
      }

      const dateRange = buildDateRangeFilter(input.dateFrom, input.dateTo);
      if (dateRange) conditions.push({ createdAt: dateRange });

      if (input.search && input.search.trim()) {
        const term = input.search.trim();
        conditions.push({
          OR: [
            { subject: { contains: term, mode: "insensitive" } },
            { fromAddress: { contains: term, mode: "insensitive" } },
            { fromName: { contains: term, mode: "insensitive" } },
            { user: { name: { contains: term, mode: "insensitive" } } },
          ],
        });
      }

      const where = conditions.length > 0 ? { AND: conditions } : {};

      // Build dynamic orderBy
      const dir = input.sortDir;
      const sortFieldMap: Record<string, Record<string, unknown>> = {
        createdAt: { createdAt: dir },
        receivedAt: { receivedAt: dir },
        subject: { subject: dir },
        fromAddress: { fromAddress: dir },
        user: { user: { name: dir } },
        tokens: { aiTokensInput: dir },
        latency: { aiLatencyMs: dir },
      };
      const orderBy = [sortFieldMap[input.sortBy], { id: "asc" as const }];

      const offset = input.cursor ?? 0;
      const rows = await prisma.processedEmail.findMany({
        where,
        select: {
          id: true,
          userId: true,
          externalMessageId: true,
          fromAddress: true,
          fromName: true,
          subject: true,
          aiSubject: true,
          aiSummary: true,
          aiDecision: true,
          aiRelevant: true,
          aiProvider: true,
          aiModel: true,
          aiTokensInput: true,
          aiTokensOutput: true,
          aiLatencyMs: true,
          aiReasoning: true,
          aiLinks: true,
          topicSlug: true,
          forwarded: true,
          isManualForward: true,
          isBackfill: true,
          isDuplicateSlug: true,
          skipForwardReason: true,
          forwardedAt: true,
          resendMessageId: true,
          deliveryStatus: true,
          deliveryError: true,
          deliveryUpdatedAt: true,
          processingError: true,
          userFeedback: true,
          userFeedbackReason: true,
          userFeedbackAt: true,
          attachmentCount: true,
          imageCount: true,
          receivedAt: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
        orderBy,
        skip: offset,
        take: 26, // 25 + 1 to detect hasMore
      });

      const hasMore = rows.length > 25;
      const items = hasMore ? rows.slice(0, 25) : rows;

      return {
        items,
        nextCursor: hasMore ? offset + 25 : undefined,
      };
    }),

  // ---- Feedback Records ----

  feedbackRecords: adminProcedure
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        feedbackValue: z
          .enum(["all", "correct", "wrong_forward", "wrong_skip"])
          .default("all"),
        userId: z.string().uuid().optional(),
        dateFrom: z.string().date().optional(),
        dateTo: z.string().date().optional(),
      })
    )
    .query(async ({ input }) => {
      const where: Record<string, unknown> = {
        userFeedback: { not: null },
      };

      if (input.userId) where.userId = input.userId;

      if (input.feedbackValue !== "all") {
        where.userFeedback = input.feedbackValue;
      }

      const dateRange = buildDateRangeFilter(input.dateFrom, input.dateTo);
      if (dateRange) where.userFeedbackAt = dateRange;

      if (input.cursor) {
        const cursorRow = await prisma.processedEmail.findUnique({
          where: { id: input.cursor },
          select: { userFeedbackAt: true },
        });
        if (cursorRow?.userFeedbackAt) {
          where.userFeedbackAt = { lt: cursorRow.userFeedbackAt };
        }
      }

      const rows = await prisma.processedEmail.findMany({
        where,
        select: {
          id: true,
          userId: true,
          fromAddress: true,
          fromName: true,
          subject: true,
          aiDecision: true,
          aiRelevant: true,
          aiReasoning: true,
          aiProvider: true,
          aiModel: true,
          aiTokensInput: true,
          aiTokensOutput: true,
          aiLatencyMs: true,
          userFeedback: true,
          userFeedbackReason: true,
          userFeedbackAt: true,
          forwarded: true,
          isManualForward: true,
          isDuplicateSlug: true,
          skipForwardReason: true,
          deliveryStatus: true,
          deliveryError: true,
          processingError: true,
          attachmentCount: true,
          imageCount: true,
          receivedAt: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
        orderBy: { userFeedbackAt: "desc" },
        take: 26,
      });

      const hasMore = rows.length > 25;
      const items = hasMore ? rows.slice(0, 25) : rows;

      // Batch-check FeedbackSnapshot existence
      const ids = items.map((r) => r.id);
      const snapshots = await prisma.feedbackSnapshot.findMany({
        where: { processedEmailId: { in: ids } },
        select: { processedEmailId: true },
      });
      const snapshotSet = new Set(snapshots.map((s) => s.processedEmailId));

      return {
        items: items.map((row) => ({
          ...row,
          hasSnapshot: snapshotSet.has(row.id),
        })),
        nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
      };
    }),

  // ---- Feedback Snapshot Detail ----

  feedbackSnapshotDetail: adminProcedure
    .input(z.object({ processedEmailId: z.string().uuid() }))
    .query(async ({ input }) => {
      const snapshot = await prisma.feedbackSnapshot.findFirst({
        where: { processedEmailId: input.processedEmailId },
        select: { encryptedData: true },
      });
      if (!snapshot) return null;

      const { decrypt } = await import("@/lib/encryption");
      const json = decrypt(Buffer.from(snapshot.encryptedData));
      const data = JSON.parse(json) as {
        subject?: string;
        fromAddress?: string;
        fromName?: string;
        body?: string | null;
        bodyHtml?: string | null;
        aiDecision?: boolean;
        aiSummary?: string | null;
        aiSubject?: string | null;
        aiReasoning?: string | null;
        feedbackValue?: string;
      };

      return {
        subject: data.subject ?? null,
        fromAddress: data.fromAddress ?? null,
        fromName: data.fromName ?? null,
        body: data.body ?? null,
        bodyHtml: data.bodyHtml ?? null,
        aiSummary: data.aiSummary ?? null,
        aiSubject: data.aiSubject ?? null,
        aiReasoning: data.aiReasoning ?? null,
      };
    }),

  // ---- Feedback Emails Export (JSON) ----

  feedbackEmailsExport: adminProcedure
    .input(
      z.object({
        feedbackValue: z
          .enum(["all", "correct", "wrong_forward", "wrong_skip"])
          .default("all"),
        userId: z.string().uuid().optional(),
        dateFrom: z.string().date().optional(),
        dateTo: z.string().date().optional(),
      })
    )
    .query(async ({ input }) => {
      const where: Record<string, unknown> = {
        userFeedback: { not: null },
      };

      if (input.userId) where.userId = input.userId;
      if (input.feedbackValue !== "all") {
        where.userFeedback = input.feedbackValue;
      }

      const dateRange = buildDateRangeFilter(input.dateFrom, input.dateTo);
      if (dateRange) where.userFeedbackAt = dateRange;

      const rows = await prisma.processedEmail.findMany({
        where,
        select: {
          id: true,
          fromAddress: true,
          fromName: true,
          subject: true,
          aiDecision: true,
          aiRelevant: true,
          aiReasoning: true,
          aiSummary: true,
          aiProvider: true,
          aiModel: true,
          forwarded: true,
          userFeedback: true,
          userFeedbackReason: true,
          userFeedbackAt: true,
          receivedAt: true,
          user: { select: { name: true } },
        },
        orderBy: { userFeedbackAt: "desc" },
        take: 500,
      });

      // Batch-fetch snapshots and decrypt
      const ids = rows.map((r) => r.id);
      const snapshots = await prisma.feedbackSnapshot.findMany({
        where: { processedEmailId: { in: ids } },
        select: { processedEmailId: true, encryptedData: true },
      });

      const { decrypt } = await import("@/lib/encryption");
      const snapshotMap = new Map<
        string,
        { body: string | null; bodyHtml: string | null }
      >();
      for (const snap of snapshots) {
        if (!snap.processedEmailId) continue;
        try {
          const json = decrypt(Buffer.from(snap.encryptedData));
          const data = JSON.parse(json) as {
            body?: string | null;
            bodyHtml?: string | null;
          };
          snapshotMap.set(snap.processedEmailId, {
            body: data.body ?? null,
            bodyHtml: data.bodyHtml ?? null,
          });
        } catch {
          snapshotMap.set(snap.processedEmailId, {
            body: null,
            bodyHtml: null,
          });
        }
      }

      return rows.map((row) => ({
        id: row.id,
        receivedAt: row.receivedAt,
        feedbackAt: row.userFeedbackAt,
        user: row.user?.name ?? "Unknown",
        from: row.fromName
          ? `${row.fromName} <${row.fromAddress}>`
          : row.fromAddress,
        subject: row.subject,
        aiDecision: row.aiDecision,
        aiRelevant: row.aiRelevant,
        forwarded: row.forwarded,
        feedback: row.userFeedback,
        feedbackReason: row.userFeedbackReason,
        aiSummary: row.aiSummary,
        aiReasoning: row.aiReasoning,
        aiModel: row.aiModel,
        aiProvider: row.aiProvider,
        snapshot: snapshotMap.get(row.id) ?? null,
      }));
    }),

  // ---- Event Feedback Records ----

  eventFeedbackRecords: adminProcedure
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        feedbackValue: z
          .enum(["all", "correct", "wrong_event"])
          .default("all"),
        userId: z.string().uuid().optional(),
        dateFrom: z.string().date().optional(),
        dateTo: z.string().date().optional(),
      })
    )
    .query(async ({ input }) => {
      const where: Record<string, unknown> = {
        userFeedback: { not: null },
      };

      if (input.userId) where.userId = input.userId;

      if (input.feedbackValue !== "all") {
        where.userFeedback = input.feedbackValue;
      }

      const dateRange = buildDateRangeFilter(input.dateFrom, input.dateTo);
      if (dateRange) where.userFeedbackAt = dateRange;

      if (input.cursor) {
        const cursorRow = await prisma.extractedEvent.findUnique({
          where: { id: input.cursor },
          select: { userFeedbackAt: true },
        });
        if (cursorRow?.userFeedbackAt) {
          where.userFeedbackAt = { lt: cursorRow.userFeedbackAt };
        }
      }

      const rows = await prisma.extractedEvent.findMany({
        where,
        select: {
          id: true,
          userId: true,
          title: true,
          eventDate: true,
          allDay: true,
          isTodo: true,
          location: true,
          details: true,
          sourceEmails: true,
          processedEmailId: true,
          processedEmail: {
            select: {
              aiDecision: true,
              aiRelevant: true,
              aiReasoning: true,
              forwarded: true,
              isManualForward: true,
              isDuplicateSlug: true,
              skipForwardReason: true,
            },
          },
          userFeedback: true,
          userFeedbackReason: true,
          userFeedbackAt: true,
          createdAt: true,
          children: { select: { id: true, nameEncrypted: true } },
          user: { select: { name: true, email: true } },
        },
        orderBy: { userFeedbackAt: "desc" },
        take: 26,
      });

      const hasMore = rows.length > 25;
      const items = hasMore ? rows.slice(0, 25) : rows;

      // Batch-check FeedbackSnapshot existence
      const ids = items.map((r) => r.id);
      const snapshots = await prisma.feedbackSnapshot.findMany({
        where: { extractedEventId: { in: ids } },
        select: { extractedEventId: true },
      });
      const snapshotSet = new Set(snapshots.map((s) => s.extractedEventId));

      // Decrypt child names
      const { decrypt } = await import("@/lib/encryption");

      return {
        items: items.map((row) => ({
          ...row,
          sourceEmails: parseSourceEmails(row.sourceEmails),
          children: row.children.map((c) => decryptChildName(c.nameEncrypted, decrypt)),
          hasSnapshot: snapshotSet.has(row.id),
        })),
        nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
      };
    }),

  eventFeedbackSnapshotDetail: adminProcedure
    .input(z.object({ extractedEventId: z.string().uuid() }))
    .query(async ({ input }) => {
      const snapshot = await prisma.feedbackSnapshot.findFirst({
        where: { extractedEventId: input.extractedEventId },
        select: { encryptedData: true },
      });
      if (!snapshot) return null;

      const { decrypt } = await import("@/lib/encryption");
      const json = decrypt(Buffer.from(snapshot.encryptedData));
      const data = JSON.parse(json) as {
        title?: string;
        eventDate?: string;
        allDay?: boolean;
        location?: string | null;
        details?: string | null;
        sourceEmails?: string | null;
        children?: string[];
        feedbackValue?: string;
        feedbackReason?: string | null;
        emails?: CapturedEmail[];
        emailSubject?: string | null;
        emailFromAddress?: string | null;
        emailFromName?: string | null;
        emailBody?: string | null;
        emailBodyHtml?: string | null;
      };

      return {
        title: data.title ?? null,
        eventDate: data.eventDate ?? null,
        allDay: data.allDay ?? true,
        location: data.location ?? null,
        details: data.details ?? null,
        sourceEmails: parseSourceEmails(data.sourceEmails ?? null),
        children: data.children ?? [],
        feedbackValue: data.feedbackValue ?? null,
        feedbackReason: data.feedbackReason ?? null,
        emails: parseSnapshotEmails(data),
      };
    }),

  eventFeedbackExport: adminProcedure
    .input(
      z.object({
        feedbackValue: z
          .enum(["all", "correct", "wrong_event"])
          .default("all"),
        userId: z.string().uuid().optional(),
        dateFrom: z.string().date().optional(),
        dateTo: z.string().date().optional(),
      })
    )
    .query(async ({ input }) => {
      const where: Record<string, unknown> = {
        userFeedback: { not: null },
      };

      if (input.userId) where.userId = input.userId;
      if (input.feedbackValue !== "all") {
        where.userFeedback = input.feedbackValue;
      }

      const dateRange = buildDateRangeFilter(input.dateFrom, input.dateTo);
      if (dateRange) where.userFeedbackAt = dateRange;

      const rows = await prisma.extractedEvent.findMany({
        where,
        select: {
          id: true,
          title: true,
          eventDate: true,
          allDay: true,
          isTodo: true,
          location: true,
          details: true,
          sourceEmails: true,
          userFeedback: true,
          userFeedbackReason: true,
          userFeedbackAt: true,
          createdAt: true,
          children: { select: { id: true, nameEncrypted: true } },
          user: { select: { name: true } },
        },
        orderBy: { userFeedbackAt: "desc" },
        take: 500,
      });

      // Batch-fetch snapshots and decrypt email content
      const ids = rows.map((r) => r.id);
      const snapshots = await prisma.feedbackSnapshot.findMany({
        where: { extractedEventId: { in: ids } },
        select: { extractedEventId: true, encryptedData: true },
      });

      const { decrypt } = await import("@/lib/encryption");

      const snapshotMap = new Map<string, CapturedEmail[]>();
      for (const snap of snapshots) {
        if (!snap.extractedEventId) continue;
        try {
          const json = decrypt(Buffer.from(snap.encryptedData));
          const data = JSON.parse(json);
          snapshotMap.set(snap.extractedEventId, parseSnapshotEmails(data));
        } catch {
          snapshotMap.set(snap.extractedEventId, []);
        }
      }

      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        eventDate: row.eventDate,
        allDay: row.allDay,
        location: row.location,
        details: row.details,
        sourceEmails: parseSourceEmails(row.sourceEmails),
        feedback: row.userFeedback,
        feedbackReason: row.userFeedbackReason,
        feedbackAt: row.userFeedbackAt,
        createdAt: row.createdAt,
        user: row.user?.name ?? "Unknown",
        children: row.children.map((c) => decryptChildName(c.nameEncrypted, decrypt)),
        emails: snapshotMap.get(row.id) ?? [],
      }));
    }),

  // ---- User Feedback (app-level) ----

  userFeedbackList: adminProcedure
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        category: z
          .enum(["all", "BUG", "FEATURE_REQUEST", "USABILITY", "EMAIL_QUALITY", "GENERAL"])
          .default("all"),
        dateFrom: z.string().date().optional(),
        dateTo: z.string().date().optional(),
      })
    )
    .query(async ({ input }) => {
      const where: Record<string, unknown> = {};

      if (input.category !== "all") where.category = input.category;

      const dateRange = buildDateRangeFilter(input.dateFrom, input.dateTo);
      if (dateRange) where.createdAt = dateRange;

      if (input.cursor) {
        const cursorRow = await prisma.userFeedback.findUnique({
          where: { id: input.cursor },
          select: { createdAt: true },
        });
        if (cursorRow) {
          where.createdAt = {
            ...(typeof where.createdAt === "object"
              ? (where.createdAt as Record<string, Date>)
              : {}),
            lt: cursorRow.createdAt,
          };
        }
      }

      const rows = await prisma.userFeedback.findMany({
        where,
        select: {
          id: true,
          category: true,
          subject: true,
          message: true,
          page: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 26,
      });

      const hasMore = rows.length > 25;
      const items = hasMore ? rows.slice(0, 25) : rows;

      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
      };
    }),

  userFeedbackExport: adminProcedure
    .input(
      z.object({
        category: z
          .enum(["all", "BUG", "FEATURE_REQUEST", "USABILITY", "EMAIL_QUALITY", "GENERAL"])
          .default("all"),
        dateFrom: z.string().date().optional(),
        dateTo: z.string().date().optional(),
      })
    )
    .query(async ({ input }) => {
      const where: Record<string, unknown> = {};

      if (input.category !== "all") where.category = input.category;

      const dateRange = buildDateRangeFilter(input.dateFrom, input.dateTo);
      if (dateRange) where.createdAt = dateRange;

      const rows = await prisma.userFeedback.findMany({
        where,
        select: {
          category: true,
          subject: true,
          message: true,
          page: true,
          createdAt: true,
          user: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      });

      return rows.map((r) => ({
        category: r.category,
        subject: r.subject,
        message: r.message,
        page: r.page,
        date: r.createdAt.toISOString().slice(0, 10),
        user: r.user.name,
      }));
    }),

  // ---- Force Forward Email ----

  adminForceForward: adminProcedure
    .input(z.object({ emailId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const email = await prisma.processedEmail.findUnique({
        where: { id: input.emailId },
        select: { id: true, forwarded: true, userId: true, externalMessageId: true },
      });
      if (!email) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Email not found." });
      }

      const { emailQueue } = await import("@/worker/queue");
      await emailQueue.add("manual-forward", {
        userId: email.userId,
        processedEmailId: input.emailId,
        externalMessageId: email.externalMessageId,
      });

      return { success: true, alreadyForwarded: email.forwarded };
    }),

  adminForceBrief: adminProcedure
    .input(z.object({
      userId: z.string().uuid(),
      briefType: z.enum(["daily", "weekly"]),
    }))
    .mutation(async ({ input }) => {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });

      const { emailQueue } = await import("@/worker/queue");
      await emailQueue.add("force-brief", {
        userId: input.userId,
        briefType: input.briefType,
      });

      return { success: true };
    }),

  // ---- Simulate Reauth Backfill (admin, any user) ----

  adminSimulateReauth: adminProcedure
    .input(z.object({
      userId: z.string().uuid(),
      gapDays: z.number().int().min(1).max(30).default(5),
    }))
    .mutation(async ({ input }) => {
      const { queueSimulatedReauthBackfill } = await import("@/lib/simulate-reauth");
      await queueSimulatedReauthBackfill(input.userId, input.gapDays);
      return { success: true, gapDays: input.gapDays };
    }),

  // ---- User Detail (lazy-loaded per-user stats for accordion) ----

  userDetail: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ input }) => {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Single query for settings + household membership (same user row)
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: {
          individualForwardingEnabled: true,
          dailyBriefEnabled: true,
          weeklyBriefEnabled: true,
          briefScope: true,
          brutalMode: true,
          timezone: true,
          emailAccountType: true,
          createdAt: true,
          householdId: true,
          household: { select: { primaryUserId: true, primaryUser: { select: { name: true } } } },
          ownedHousehold: { select: { members: { select: { id: true, name: true } } } },
        },
      });
      const effectiveId = user.household?.primaryUserId ?? input.userId;
      const isMember = !!user.householdId && effectiveId !== input.userId;

      const [
        connection,
        forwardedLive,
        delivered,
        bounced,
        historicalStats,
        dailyBriefs,
        weeklyBriefs,
        eventsTotal,
        feedbackCount,
        processedLast24h,
        processedLast7d,
        forwardedLast24h,
        forwardedLast7d,
      ] = await Promise.all([
        prisma.emailConnection.findUnique({
          where: { userId: input.userId },
          select: { status: true, lastPolledAt: true, syncCursor: true, emailAddress: true },
        }),
        // Forwarded: live + historical (safe to combine, not webhook-dependent)
        prisma.processedEmail.count({ where: { userId: effectiveId, forwarded: true } }),
        // Delivered/bounced: live only (DailyStats has stale delivery data)
        prisma.processedEmail.count({ where: { userId: effectiveId, deliveryStatus: "delivered" } }),
        prisma.processedEmail.count({ where: { userId: effectiveId, deliveryStatus: { in: ["bounced", "complained"] } } }),
        prisma.processedEmailDailyStats.aggregate({
          where: { userId: effectiveId },
          _sum: { forwardedCount: true },
        }),
        prisma.briefDelivery.findMany({
          where: { userId: effectiveId, briefType: "daily" },
          select: { status: true, deliveryStatus: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
        prisma.briefDelivery.findMany({
          where: { userId: effectiveId, briefType: "weekly" },
          select: { status: true, deliveryStatus: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.extractedEvent.count({ where: { userId: effectiveId } }),
        prisma.processedEmail.count({ where: { userId: effectiveId, userFeedback: { not: null } } }),
        prisma.processedEmail.count({ where: { userId: effectiveId, createdAt: { gte: oneDayAgo } } }),
        prisma.processedEmail.count({ where: { userId: effectiveId, createdAt: { gte: sevenDaysAgo } } }),
        prisma.processedEmail.count({ where: { userId: effectiveId, forwarded: true, createdAt: { gte: oneDayAgo } } }),
        prisma.processedEmail.count({ where: { userId: effectiveId, forwarded: true, createdAt: { gte: sevenDaysAgo } } }),
      ]);

      return {
        settings: {
          individualForwardingEnabled: user.individualForwardingEnabled,
          dailyBriefEnabled: user.dailyBriefEnabled,
          weeklyBriefEnabled: user.weeklyBriefEnabled,
          briefScope: user.briefScope,
          brutalMode: user.brutalMode,
          timezone: user.timezone,
          emailAccountType: user.emailAccountType,
          createdAt: user.createdAt,
        },
        connection: connection ? {
          status: connection.status,
          lastPolledAt: connection.lastPolledAt,
          hasSyncCursor: !!connection.syncCursor,
        } : null,
        emails: {
          forwarded: forwardedLive + (historicalStats._sum.forwardedCount ?? 0),
          delivered,
          bounced,
          processedLast24h,
          processedLast7d,
          forwardedLast24h,
          forwardedLast7d,
        },
        briefs: {
          daily: aggregateBriefDeliveries(dailyBriefs),
          weekly: aggregateBriefDeliveries(weeklyBriefs),
        },
        eventsTotal,
        feedbackCount,
        isHouseholdStats: isMember,
        householdPrimaryName: isMember ? (user.household?.primaryUser?.name ?? null) : null,
        householdMemberNames: user.ownedHousehold
          ? user.ownedHousehold.members.filter((m) => m.id !== input.userId).map((m) => m.name ?? m.id)
          : null,
      };
    }),

  // ---- Display Features ----

  displayFeaturesConfig: adminProcedure.query(async () => {
    const config = await prisma.systemConfig.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    return {
      showEmailSummaryInEvents: config.showEmailSummaryInEvents,
    };
  }),

  setDisplayFeaturesConfig: adminProcedure
    .input(z.object({ showEmailSummaryInEvents: z.boolean() }))
    .mutation(async ({ input }) => {
      await prisma.systemConfig.update({
        where: { id: "singleton" },
        data: input,
      });
      invalidateConfigCache();
      return { success: true };
    }),

  // ---- Debug & Logging ----

  debugConfig: adminProcedure.query(async () => {
    const config = await prisma.systemConfig.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    return {
      debugMode: config.debugMode,
      showDebugUI: config.showDebugUI,
      logDir: config.logDir,
    };
  }),

  setDebugConfig: adminProcedure
    .input(
      z.object({
        debugMode: z.boolean(),
        showDebugUI: z.boolean(),
        logDir: z.string().min(1).max(200),
      })
    )
    .mutation(async ({ input }) => {
      await prisma.systemConfig.update({
        where: { id: "singleton" },
        data: input,
      });
      invalidateConfigCache();
      return { success: true };
    }),

  // ---- Broadcast Message ----

  broadcastConfig: adminProcedure.query(async () => {
    const config = await prisma.systemConfig.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    return {
      broadcastMessage: config.broadcastMessage,
      broadcastActive: config.broadcastActive,
      broadcastEndsAt: config.broadcastEndsAt,
    };
  }),

  setBroadcast: adminProcedure
    .input(
      z.object({
        message: z.string().min(1).max(500),
        endsAt: z.string().datetime(),
      })
    )
    .mutation(async ({ input }) => {
      await prisma.systemConfig.update({
        where: { id: "singleton" },
        data: {
          broadcastMessage: input.message,
          broadcastActive: true,
          broadcastEndsAt: new Date(input.endsAt),
        },
      });
      return { success: true };
    }),

  clearBroadcast: adminProcedure.mutation(async () => {
    await prisma.systemConfig.update({
      where: { id: "singleton" },
      data: {
        broadcastActive: false,
        broadcastMessage: null,
        broadcastEndsAt: null,
      },
    });
    return { success: true };
  }),

  // ---- Brief Delivery Report ----

  briefReport: adminProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).optional() }).optional())
    .query(async ({ input }) => {
      const days = input?.days ?? 7;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const deliveries = await prisma.briefDelivery.findMany({
        where: { createdAt: { gte: since } },
        select: {
          briefType: true,
          status: true,
          deliveryStatus: true,
          recipientCount: true,
          createdAt: true,
          error: true,
          user: { select: { email: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      // Aggregate by date + briefType
      const dayMap = new Map<string, {
        date: string;
        briefType: string;
        expected: number;
        sent: number;
        skipped: number;
        failed: number;
        pending: number;
        delivered: number;
        bounced: number;
        errors: string[];
      }>();

      for (const d of deliveries) {
        const dateKey = d.createdAt.toISOString().slice(0, 10);
        const key = `${dateKey}:${d.briefType}`;

        if (!dayMap.has(key)) {
          dayMap.set(key, {
            date: dateKey,
            briefType: d.briefType,
            expected: 0,
            sent: 0,
            skipped: 0,
            failed: 0,
            pending: 0,
            delivered: 0,
            bounced: 0,
            errors: [],
          });
        }

        const agg = dayMap.get(key)!;
        agg.expected++;

        if (d.status === "sent") {
          agg.sent++;
          if (d.deliveryStatus === "delivered") agg.delivered++;
          else if (d.deliveryStatus === "bounced" || d.deliveryStatus === "complained") agg.bounced++;
        } else if (d.status === "skipped") {
          agg.skipped++;
        } else if (d.status === "failed") {
          agg.failed++;
          if (d.error) agg.errors.push(`${d.user.email}: ${d.error.slice(0, 100)}`);
        } else if (d.status === "pending") {
          agg.pending++;
        }
      }

      // Sort by date descending
      const rows = Array.from(dayMap.values()).sort((a, b) => {
        const cmp = b.date.localeCompare(a.date);
        return cmp !== 0 ? cmp : a.briefType.localeCompare(b.briefType);
      });

      return { rows, since: since.toISOString() };
    }),

  // ---- AI Call Logs ----

  aiCallLogs: adminProcedure
    .input(z.object({
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
      userId: z.string().uuid().optional(),
      action: z.string().optional(),
      success: z.boolean().optional(),
      hasFeedback: z.boolean().optional(),
      cursor: z.string().uuid().nullish(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const filteredLogIds = input.hasFeedback !== undefined
        ? await getAiCallLogIdsWithFeedback(input.hasFeedback)
        : null;

      const where: Record<string, unknown> = {};
      if (input.startDate || input.endDate) {
        where.createdAt = {
          ...(input.startDate ? { gte: new Date(input.startDate) } : {}),
          ...(input.endDate ? { lte: new Date(input.endDate) } : {}),
        };
      }
      if (input.userId) where.userId = input.userId;
      if (input.action) where.action = input.action;
      if (input.success !== undefined) where.success = input.success;
      if (filteredLogIds !== null) where.id = { in: filteredLogIds };

      const logs = await prisma.aICallLog.findMany({
        where,
        select: {
          id: true,
          userId: true,
          action: true,
          provider: true,
          model: true,
          success: true,
          durationMs: true,
          inputTokens: true,
          outputTokens: true,
          errorType: true,
          errorMessage: true,
          metadata: true,
          createdAt: true,
          user: { select: { name: true, email: true, supportDataConsent: true, supportDataConsentExpiresAt: true } },
        },
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });

      const hasMore = logs.length > input.limit;
      const items = hasMore ? logs.slice(0, input.limit) : logs;

      return {
        items: items.map((item) => ({
          ...item,
          consentGranted: isConsentActive(item.user),
          user: item.user ? { name: item.user.name, email: item.user.email } : null,
        })),
        nextCursor: hasMore ? items[items.length - 1].id : null,
      };
    }),

  aiCallLogDetail: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const log = await prisma.aICallLog.findUniqueOrThrow({
        where: { id: input.id },
        select: {
          id: true,
          userId: true,
          action: true,
          provider: true,
          model: true,
          success: true,
          durationMs: true,
          inputTokens: true,
          outputTokens: true,
          errorType: true,
          errorMessage: true,
          promptEncrypted: true,
          responseEncrypted: true,
          metadata: true,
          createdAt: true,
          user: { select: { name: true, email: true, supportDataConsent: true, supportDataConsentExpiresAt: true } },
        },
      });

      const { decrypt } = await import("@/lib/encryption");
      const prompt = decrypt(log.promptEncrypted);
      const response = log.responseEncrypted ? decrypt(log.responseEncrypted) : null;

      const consentGranted = isConsentActive(log.user);
      const meta = log.metadata as Record<string, unknown> | null;
      const externalMessageId = meta?.externalMessageId as string | undefined;

      // Look up linked ProcessedEmail data if consent is granted and we have a message ID
      let linkedEmail: {
        subject: string;
        fromAddress: string;
        fromName: string | null;
        aiSummary: string | null;
        aiReasoning: string | null;
        userFeedback: string | null;
      } | null = null;

      if (externalMessageId && log.userId) {
        if (consentGranted) {
          const pe = await prisma.processedEmail.findUnique({
            where: { userId_externalMessageId: { userId: log.userId, externalMessageId } },
            select: {
              subject: true,
              fromAddress: true,
              fromName: true,
              aiSummary: true,
              aiReasoning: true,
              userFeedback: true,
            },
          });
          if (pe) {
            linkedEmail = pe;
          }
        } else {
          linkedEmail = {
            subject: "[consent not granted]",
            fromAddress: "[consent not granted]",
            fromName: null,
            aiSummary: "[consent not granted]",
            aiReasoning: "[consent not granted]",
            userFeedback: null,
          };
        }
      }

      return {
        ...log,
        promptEncrypted: undefined,
        responseEncrypted: undefined,
        prompt,
        response,
        consentGranted,
        linkedEmail,
        user: log.user ? { name: log.user.name, email: log.user.email } : null,
      };
    }),

  aiCallLogLinkedEmail: adminProcedure
    .input(z.object({ aiCallLogId: z.string().uuid() }))
    .query(async ({ input }) => {
      const log = await prisma.aICallLog.findUniqueOrThrow({
        where: { id: input.aiCallLogId },
        select: {
          userId: true,
          metadata: true,
          user: { select: { supportDataConsent: true, supportDataConsentExpiresAt: true } },
        },
      });

      if (!isConsentActive(log.user)) {
        return { error: "consent_not_granted" as const };
      }

      const meta = log.metadata as Record<string, unknown> | null;
      const externalMessageId = meta?.externalMessageId as string | undefined;
      if (!externalMessageId || !log.userId) {
        return { error: "no_message_id" as const };
      }

      // Get ProcessedEmail metadata from our DB
      const email = await prisma.processedEmail.findUnique({
        where: { userId_externalMessageId: { userId: log.userId, externalMessageId } },
        select: {
          id: true,
          externalMessageId: true,
          fromAddress: true,
          fromName: true,
          subject: true,
          receivedAt: true,
          aiDecision: true,
          aiRelevant: true,
          aiSummary: true,
          aiSubject: true,
          aiProvider: true,
          aiModel: true,
          aiTokensInput: true,
          aiTokensOutput: true,
          aiLatencyMs: true,
          aiReasoning: true,
          aiLinks: true,
          attachmentCount: true,
          imageCount: true,
          forwarded: true,
          isManualForward: true,
          isBackfill: true,
          isDuplicateSlug: true,
          skipForwardReason: true,
          forwardedAt: true,
          deliveryStatus: true,
          deliveryError: true,
          userFeedback: true,
          userFeedbackReason: true,
          userFeedbackAt: true,
          topicSlug: true,
          createdAt: true,
        },
      });

      // Try to fetch actual email content from Gmail
      let body: string | null = null;
      let bodyHtml: string | null = null;
      let fetchedSubject: string | null = null;
      let fetchedFrom: string | null = null;
      let fetchedFromName: string | null = null;
      let fetchError: string | null = null;
      try {
        const connection = await prisma.emailConnection.findUnique({
          where: { userId: log.userId! },
          select: { id: true, status: true, provider: true },
        });
        if (connection && connection.status === "ACTIVE") {
          const { getValidAccessToken } = await import("@/server/email-providers/token-manager");
          const { createEmailClient } = await import("@/server/email-providers");
          const accessToken = await getValidAccessToken(connection.id);
          const emailClient = createEmailClient(connection.provider, accessToken, log.userId!);
          const message = await emailClient.getMessageContent(externalMessageId);
          body = message.body;
          bodyHtml = message.bodyHtml;
          fetchedSubject = message.subject;
          fetchedFrom = message.from;
          fetchedFromName = message.fromName;
        } else {
          fetchError = connection ? "Connection is not active" : "No email connection";
        }
      } catch (err) {
        fetchError = err instanceof Error ? err.message : String(err);
      }

      return { email: email ?? undefined, body, bodyHtml, fetchedSubject, fetchedFrom, fetchedFromName, fetchError };
    }),

  aiCallLogExport: adminProcedure
    .input(z.object({
      startDate: z.string().datetime(),
      endDate: z.string().datetime(),
      userId: z.string().uuid().optional(),
      action: z.string().optional(),
      success: z.boolean().optional(),
      hasFeedback: z.boolean().optional(),
      format: z.enum(["csv", "json"]),
    }))
    .mutation(async ({ input }) => {
      const filteredLogIds = input.hasFeedback !== undefined
        ? await getAiCallLogIdsWithFeedback(input.hasFeedback)
        : null;

      const where: Record<string, unknown> = {
        createdAt: {
          gte: new Date(input.startDate),
          lte: new Date(input.endDate),
        },
      };
      if (input.userId) where.userId = input.userId;
      if (input.action) where.action = input.action;
      if (input.success !== undefined) where.success = input.success;
      if (filteredLogIds !== null) where.id = { in: filteredLogIds };

      // Count first to decide delivery method
      const count = await prisma.aICallLog.count({ where });
      const MAX_INLINE = 500;

      if (count === 0) {
        return { delivery: "empty" as const, count: 0 };
      }

      // Fetch all matching logs
      const logs = await prisma.aICallLog.findMany({
        where,
        select: {
          id: true,
          userId: true,
          action: true,
          provider: true,
          model: true,
          success: true,
          durationMs: true,
          inputTokens: true,
          outputTokens: true,
          errorType: true,
          errorMessage: true,
          promptEncrypted: true,
          responseEncrypted: true,
          metadata: true,
          createdAt: true,
          user: { select: { supportDataConsent: true, supportDataConsentExpiresAt: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 5000, // hard cap
      });

      // Batch-load linked ProcessedEmail data for consented users
      const consentedMessageKeys = logs
        .filter((log) => isConsentActive(log.user) && log.userId)
        .map((log) => {
          const meta = log.metadata as Record<string, unknown> | null;
          return { userId: log.userId!, externalMessageId: meta?.externalMessageId as string | undefined };
        })
        .filter((k): k is { userId: string; externalMessageId: string } => !!k.externalMessageId);

      const linkedEmails = consentedMessageKeys.length > 0
        ? await prisma.processedEmail.findMany({
            where: {
              OR: consentedMessageKeys.map((k) => ({
                userId: k.userId,
                externalMessageId: k.externalMessageId,
              })),
            },
            select: {
              userId: true,
              externalMessageId: true,
              subject: true,
              fromAddress: true,
              fromName: true,
              aiSummary: true,
              userFeedback: true,
            },
          })
        : [];
      const linkedMap = new Map(
        linkedEmails.map((e) => [`${e.userId}:${e.externalMessageId}`, e])
      );

      // Decrypt all entries and attach linked data
      const { decrypt } = await import("@/lib/encryption");
      const decrypted = logs.map((log) => {
        const meta = log.metadata as Record<string, unknown> | null;
        const extId = meta?.externalMessageId as string | undefined;
        const consented = isConsentActive(log.user);
        const linked = (consented && log.userId && extId)
          ? linkedMap.get(`${log.userId}:${extId}`) ?? null
          : null;

        return {
          id: log.id,
          userId: log.userId,
          action: log.action,
          provider: log.provider,
          model: log.model,
          success: log.success,
          durationMs: log.durationMs,
          inputTokens: log.inputTokens,
          outputTokens: log.outputTokens,
          errorType: log.errorType,
          errorMessage: log.errorMessage,
          prompt: decrypt(log.promptEncrypted),
          response: log.responseEncrypted ? decrypt(log.responseEncrypted) : null,
          metadata: log.metadata,
          createdAt: log.createdAt.toISOString(),
          consentGranted: consented,
          linkedSubject: linked ? linked.subject : (extId ? "[consent not granted]" : null),
          linkedFrom: linked ? (linked.fromName ? `${linked.fromName} <${linked.fromAddress}>` : linked.fromAddress) : (extId ? "[consent not granted]" : null),
          linkedSummary: linked ? linked.aiSummary : (extId ? "[consent not granted]" : null),
          linkedFeedback: linked?.userFeedback ?? null,
        };
      });

      if (count <= MAX_INLINE) {
        // Small enough to return inline
        if (input.format === "json") {
          return { delivery: "inline" as const, count, data: JSON.stringify(decrypted, null, 2), format: "json" as const };
        }
        // CSV
        const csv = buildCsv(decrypted);
        return { delivery: "inline" as const, count, data: csv, format: "csv" as const };
      }

      // Too large: email to admins
      const admins = await prisma.user.findMany({
        where: { role: "ADMIN" },
        select: { email: true },
      });

      if (admins.length === 0) {
        return { delivery: "error" as const, count, message: "No admin emails found" };
      }

      const { getResend, getEmailConfig, throttleSend } = await import("@/server/email/sender");
      const { fromAddress, brandName } = await getEmailConfig();
      const resend = await getResend();

      const content = input.format === "json"
        ? JSON.stringify(decrypted, null, 2)
        : buildCsv(decrypted);
      const filename = `ai-call-logs-${input.startDate.slice(0, 10)}-to-${input.endDate.slice(0, 10)}.${input.format}`;

      await throttleSend();
      const { error } = await resend.emails.send({
        from: fromAddress,
        to: admins.map((a) => a.email),
        subject: `[${brandName}] AI Call Log Export (${count} records)`,
        html: `<p>Attached is the AI call log export you requested.</p><p>${count} records from ${input.startDate.slice(0, 10)} to ${input.endDate.slice(0, 10)}.</p>`,
        attachments: [{
          filename,
          content: Buffer.from(content, "utf-8"),
        }],
      });

      if (error) {
        return { delivery: "error" as const, count, message: `Email send failed: ${error.message}` };
      }

      return { delivery: "emailed" as const, count };
    }),

  // ---- Diagnostics ----

  diagnosticRuns: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ input }) => {
      const runs = await prisma.diagnosticRun.findMany({
        orderBy: { createdAt: "desc" },
        take: input.limit,
        select: {
          id: true,
          status: true,
          findingCount: true,
          okCount: true,
          criticalCount: true,
          warningCount: true,
          infoCount: true,
          durationMs: true,
          createdAt: true,
        },
      });
      return runs;
    }),

  diagnosticFindings: adminProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ input }) => {
      const findings = await prisma.diagnosticFinding.findMany({
        where: { runId: input.runId },
        select: {
          id: true,
          severity: true,
          category: true,
          title: true,
          description: true,
          affectedUsers: true,
          metrics: true,
          detectedAt: true,
        },
      });
      return findings;
    }),

  diagnosticContextFile: adminProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ input }) => {
      const run = await prisma.diagnosticRun.findUniqueOrThrow({
        where: { id: input.runId },
        select: { contextFile: true, createdAt: true },
      });
      return { content: run.contextFile, createdAt: run.createdAt };
    }),

  triggerDiagnostics: adminProcedure
    .mutation(async () => {
      // Check for an already-running diagnostic
      const running = await prisma.diagnosticRun.findFirst({
        where: { status: "running" },
        select: { id: true },
      });
      if (running) {
        return { success: true, runId: running.id, alreadyRunning: true };
      }

      const { emailQueue } = await import("@/worker/queue");
      await emailQueue.add("daily-diagnostics", {});
      return { success: true, runId: null, alreadyRunning: false };
    }),

  diagnosticStatus: adminProcedure
    .query(async () => {
      // Last completed run
      const lastCompleted = await prisma.diagnosticRun.findFirst({
        where: { status: "completed" },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true, findingCount: true, criticalCount: true, warningCount: true, infoCount: true },
      });

      // Currently running?
      const running = await prisma.diagnosticRun.findFirst({
        where: { status: "running" },
        select: { id: true, createdAt: true },
      });

      // Recent run streak (last 7 days): count distinct days with a completed run
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentRuns = await prisma.diagnosticRun.findMany({
        where: { status: "completed", createdAt: { gte: sevenDaysAgo } },
        select: { createdAt: true },
      });
      const distinctDays = new Set(
        recentRuns.map((r) => r.createdAt.toISOString().slice(0, 10)),
      );
      const recentRunCount = distinctDays.size;

      return {
        lastCompleted: lastCompleted
          ? {
              id: lastCompleted.id,
              createdAt: lastCompleted.createdAt,
              findingCount: lastCompleted.findingCount,
              criticalCount: lastCompleted.criticalCount,
              warningCount: lastCompleted.warningCount,
              infoCount: lastCompleted.infoCount,
            }
          : null,
        isRunning: !!running,
        runningId: running?.id ?? null,
        runningSince: running?.createdAt ?? null,
        recentRunCount,
      };
    }),
});
