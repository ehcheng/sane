import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, deactivatedAllowedProcedure, publicProcedure } from "../trpc";
import { prisma } from "@/server/db/prisma";
import { emailFilterModeSchema, briefScopeEnum, changePasswordSchema, changeEmailSchema } from "@/lib/validators";
import { createRateLimiter } from "@/lib/rate-limit";
import { getConfig, invalidateConfigCache } from "@/server/config";
import { getReactivationData } from "@/server/lifecycle-helpers";
import logger from "@/lib/logger";

const TAG = "user-router";

/** Throws FORBIDDEN if the caller is a household partner (not the owner). */
function requireOwner(ctx: { authUserId: string; isHouseholdOwner: boolean }) {
  if (!ctx.isHouseholdOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the household owner can change this setting." });
  }
}

const verifyResendLimiter = createRateLimiter("verify-resend", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 3,
});

const changePasswordLimiter = createRateLimiter("change-password", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
});

const changeEmailLimiter = createRateLimiter("change-email", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 3,
});

export const userRouter = router({
  me: deactivatedAllowedProcedure.query(async ({ ctx }) => {
    // Per-user fields (always from the authenticated user's own record)
    const perUserSelect = {
      id: true,
      email: true,
      pendingEmail: true,
      name: true,
      role: true,
      emailVerified: true,
      wizardStep: true,
      feedbackTrainingConsent: true,
      supportDataConsent: true,
      supportDataConsentExpiresAt: true,
      completedTours: true,
      timezone: true,
      createdAt: true,
      accountStatus: true,
      deactivatedAt: true,
      // Delivery preferences (per-user)
      individualForwardingEnabled: true,
      dailyBriefEnabled: true,
      weeklyBriefEnabled: true,
      // UI preferences (per-user)
      defaultEventsView: true,
      actionableEventsOnly: true,
    } as const;

    // Shared household settings (from the effective/primary user)
    const sharedSelect = {
      isMonitoringEnabled: true,
      forwardingMode: true,
      emailFilterMode: true,
      showLinksInSummary: true,
      emailAccountType: true,
      brutalMode: true,
    } as const;

    const isPartner = ctx.authUserId !== ctx.userId;

    if (isPartner) {
      // Two queries: own identity + household shared settings
      const [ownUser, sharedUser] = await Promise.all([
        prisma.user.findUniqueOrThrow({
          where: { id: ctx.authUserId },
          select: perUserSelect,
        }),
        prisma.user.findUniqueOrThrow({
          where: { id: ctx.userId },
          select: sharedSelect,
        }),
      ]);

      // Auto-revoke expired support data consent
      if (ownUser.supportDataConsent && ownUser.supportDataConsentExpiresAt && ownUser.supportDataConsentExpiresAt < new Date()) {
        await prisma.user.update({
          where: { id: ctx.authUserId },
          data: { supportDataConsent: false, supportDataConsentExpiresAt: null },
        });
        ownUser.supportDataConsent = false;
        ownUser.supportDataConsentExpiresAt = null;
      }

      return { ...sharedUser, ...ownUser, isHouseholdOwner: false };
    }

    // Solo user or household primary: single query
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      select: { ...perUserSelect, ...sharedSelect },
    });

    if (user.supportDataConsent && user.supportDataConsentExpiresAt && user.supportDataConsentExpiresAt < new Date()) {
      await prisma.user.update({
        where: { id: ctx.userId },
        data: { supportDataConsent: false, supportDataConsentExpiresAt: null },
      });
      user.supportDataConsent = false;
      user.supportDataConsentExpiresAt = null;
    }

    // Solo users and household owners can manage all shared settings
    return { ...user, isHouseholdOwner: true };
  }),

  /** Lightweight status check for the global status indicator dot. */
  statusSummary: protectedProcedure.query(async ({ ctx }) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      select: { wizardStep: true },
    });
    const [parentCount, childCount, forwardingCount] = await Promise.all([
      prisma.parent.count({ where: { userId: ctx.userId } }),
      prisma.child.count({ where: { userId: ctx.userId } }),
      prisma.forwardingAddress.count({ where: { userId: ctx.userId } }),
    ]);
    return {
      wizardComplete: user.wizardStep >= 3,
      hasRequiredConfig: parentCount > 0 && childCount > 0 && forwardingCount > 0,
    };
  }),

  updateWizardStep: protectedProcedure
    .input(z.object({ step: z.number().min(0).max(3) }))
    .mutation(async ({ ctx, input }) => {
      return prisma.user.update({
        where: { id: ctx.authUserId },
        data: { wizardStep: input.step },
        select: { wizardStep: true },
      });
    }),

  /** Debug: clear all processed emails, events, and stats (without resetting wizard) */
  clearData: protectedProcedure.mutation(async ({ ctx }) => {
    await prisma.$transaction([
      prisma.extractedEvent.deleteMany({ where: { userId: ctx.userId } }),
      prisma.processedEmail.deleteMany({ where: { userId: ctx.userId } }),
      prisma.processedEmailDailyStats.deleteMany({ where: { userId: ctx.userId } }),
      prisma.emailConnection.updateMany({
        where: { userId: ctx.userId },
        data: { syncCursor: null, lastPolledAt: null },
      }),
    ]);
    return { success: true };
  }),

  /** Debug: reset wizard + clear all processed emails, events, and stats */
  resetWizardWithCleanup: protectedProcedure.mutation(async ({ ctx }) => {
    await prisma.$transaction([
      prisma.extractedEvent.deleteMany({ where: { userId: ctx.userId } }),
      prisma.processedEmail.deleteMany({ where: { userId: ctx.userId } }),
      prisma.processedEmailDailyStats.deleteMany({ where: { userId: ctx.userId } }),
      prisma.user.update({
        where: { id: ctx.userId },
        data: { wizardStep: 0, completedTours: "[]" },
      }),
      // Clear syncCursor + lastPolledAt so the next backfill starts fresh
      // without hitting the 60s cooldown
      prisma.emailConnection.updateMany({
        where: { userId: ctx.userId },
        data: { syncCursor: null, lastPolledAt: null },
      }),
    ]);
    return { success: true };
  }),

  updateProfile: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      return prisma.user.update({
        where: { id: ctx.authUserId },
        data: { name: input.name },
        select: { id: true, name: true, email: true },
      });
    }),

  setMonitoringEnabled: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      requireOwner(ctx);
      if (input.enabled) {
        const user = await prisma.user.findUniqueOrThrow({
          where: { id: ctx.userId },
          select: { emailAccountType: true, emailFilterMode: true },
        });
        if (
          user.emailAccountType === "SHARED" &&
          user.emailFilterMode === "ALLOWED_ONLY"
        ) {
          const senderCount = await prisma.allowedSender.count({
            where: { userId: ctx.userId },
          });
          if (senderCount === 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Add at least one allowed sender before enabling monitoring for a shared inbox.",
            });
          }
        }
      }

      const result = await prisma.user.update({
        where: { id: ctx.userId },
        data: { isMonitoringEnabled: input.enabled },
        select: { isMonitoringEnabled: true },
      });

      // Fire-and-forget notification email
      try {
        const sender = await import("@/server/email/sender");
        const sendFn = input.enabled
          ? sender.sendMonitoringStartedEmail
          : sender.sendMonitoringStoppedEmail;
        sendFn({ userId: ctx.userId }).catch((err) => {
          console.error("Failed to send monitoring notification email:", err);
        });
      } catch (err) {
        console.error("Failed to import email sender:", err);
      }

      return result;
    }),

  updateDefaultEventsView: protectedProcedure
    .input(z.object({ defaultEventsView: z.enum(["agenda", "month"]) }))
    .mutation(async ({ ctx, input }) => {
      return prisma.user.update({
        where: { id: ctx.authUserId },
        data: { defaultEventsView: input.defaultEventsView },
        select: { defaultEventsView: true },
      });
    }),

  updateActionableEventsOnly: protectedProcedure
    .input(z.object({ actionableEventsOnly: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      return prisma.user.update({
        where: { id: ctx.authUserId },
        data: { actionableEventsOnly: input.actionableEventsOnly },
        select: { actionableEventsOnly: true },
      });
    }),

  completeTour: protectedProcedure
    .input(z.object({ tourId: z.enum(["events", "emails", "settings"]) }))
    .mutation(async ({ ctx, input }) => {
      // Atomic update + return in a single query.
      // Avoids read-then-write race when two tours complete concurrently.
      const [result] = await prisma.$queryRaw<[{ completedTours: string }]>`
        UPDATE "User"
        SET "completedTours" = (
          CASE
            WHEN jsonb_exists("completedTours"::jsonb, ${input.tourId}) THEN "completedTours"
            ELSE ("completedTours"::jsonb || ${JSON.stringify([input.tourId])}::jsonb)::text
          END
        ),
        "updatedAt" = NOW()
        WHERE "id" = ${ctx.authUserId}
        RETURNING "completedTours"
      `;
      return { completedTours: result.completedTours };
    }),

  resetTours: protectedProcedure.mutation(async ({ ctx }) => {
    return prisma.user.update({
      where: { id: ctx.authUserId },
      data: { completedTours: "[]" },
      select: { completedTours: true },
    });
  }),

  updateEmailFilterMode: protectedProcedure
    .input(z.object({ emailFilterMode: emailFilterModeSchema }))
    .mutation(async ({ ctx, input }) => {
      requireOwner(ctx);
      return prisma.user.update({
        where: { id: ctx.userId },
        data: { emailFilterMode: input.emailFilterMode },
        select: { emailFilterMode: true },
      });
    }),

  updateEmailAccountType: protectedProcedure
    .input(z.object({ emailAccountType: z.enum(["DEDICATED", "SHARED"]) }))
    .mutation(async ({ ctx, input }) => {
      requireOwner(ctx);
      const data: Record<string, unknown> = {
        emailAccountType: input.emailAccountType,
      };

      // Set delivery defaults based on account type
      if (input.emailAccountType === "SHARED") {
        // No individual forwarding, both briefs, sender filtering
        data.individualForwardingEnabled = false;
        data.dailyBriefEnabled = true;
        data.weeklyBriefEnabled = true;
        data.emailFilterMode = "ALLOWED_ONLY";

        // Pause monitoring if no allowed senders configured yet
        const senderCount = await prisma.allowedSender.count({
          where: { userId: ctx.userId },
        });
        if (senderCount === 0) {
          data.isMonitoringEnabled = false;
        }
      } else {
        // Individual forwarding + both briefs, no sender filtering
        data.individualForwardingEnabled = true;
        data.dailyBriefEnabled = true;
        data.weeklyBriefEnabled = true;
        data.emailFilterMode = "ALL";
      }

      return prisma.user.update({
        where: { id: ctx.userId },
        data,
        select: {
          emailAccountType: true,
          individualForwardingEnabled: true,
          dailyBriefEnabled: true,
          weeklyBriefEnabled: true,
          emailFilterMode: true,
        },
      });
    }),

  setFeedbackTrainingConsent: protectedProcedure
    .input(z.object({ consent: z.enum(["granted", "denied"]) }))
    .mutation(async ({ ctx, input }) => {
      return prisma.user.update({
        where: { id: ctx.authUserId },
        data: { feedbackTrainingConsent: input.consent },
        select: { feedbackTrainingConsent: true },
      });
    }),

  setSupportDataConsent: protectedProcedure
    .input(z.object({
      consent: z.boolean(),
      hours: z.number().int().min(1).max(168).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const data = input.consent
        ? {
            supportDataConsent: true,
            supportDataConsentExpiresAt: input.hours
              ? new Date(Date.now() + input.hours * 60 * 60 * 1000)
              : null,
          }
        : { supportDataConsent: false, supportDataConsentExpiresAt: null };

      return prisma.user.update({
        where: { id: ctx.authUserId },
        data,
        select: { supportDataConsent: true, supportDataConsentExpiresAt: true },
      });
    }),

  brandInfo: publicProcedure.query(async () => {
    try {
      const config = await getConfig();
      return {
        brandName: config.brandName,
        brandTagline: config.brandTagline,
      };
    } catch {
      return { brandName: "SANE", brandTagline: "School Alerts, Notices & Essentials" };
    }
  }),

  globalMonitoringStatus: protectedProcedure.query(async ({ ctx }) => {
    try {
      const [config, user] = await Promise.all([
        getConfig(),
        prisma.user.findUnique({
          where: { id: ctx.userId },
          select: { debugToolsEnabled: true },
        }),
      ]);

      // Lazy deactivation: if broadcast has expired, clear it and invalidate cache
      let broadcastMessage: string | null = null;
      if (config.broadcastActive && config.broadcastMessage) {
        if (config.broadcastEndsAt && config.broadcastEndsAt <= new Date()) {
          await prisma.systemConfig.update({
            where: { id: "singleton" },
            data: { broadcastActive: false, broadcastMessage: null, broadcastEndsAt: null },
          });
          invalidateConfigCache();
        } else {
          broadcastMessage = config.broadcastMessage;
        }
      }

      return {
        isGlobalMonitoringEnabled: config.isMonitoringEnabled,
        showDebugUI: config.showDebugUI || (user?.debugToolsEnabled ?? false),
        brandName: config.brandName,
        brandTagline: config.brandTagline,
        broadcastMessage,
        accountStatus: (ctx as { accountStatus: string }).accountStatus ?? "ACTIVE",
        primaryDeactivated: (ctx as { primaryDeactivated: boolean }).primaryDeactivated ?? false,
        lifecycleEnforcementEnabled: config.lifecycleEnforcementEnabled,
        showEmailSummaryInEvents: config.showEmailSummaryInEvents,
      };
    } catch (err) {
      logger.error(TAG, `globalMonitoringStatus failed: ${err instanceof Error ? err.message : String(err)}`);
      return {
        isGlobalMonitoringEnabled: true,
        showDebugUI: false,
        brandName: "SANE",
        brandTagline: "School Alerts, Notices & Essentials",
        broadcastMessage: null,
        accountStatus: "ACTIVE" as const,
        primaryDeactivated: false,
        lifecycleEnforcementEnabled: false,
        showEmailSummaryInEvents: false,
      };
    }
  }),

  resendVerification: protectedProcedure.mutation(async ({ ctx }) => {
    const { allowed } = verifyResendLimiter.check(ctx.authUserId);
    if (!allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many requests. Please wait before resending.",
      });
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.authUserId },
      select: { email: true },
    });

    const { createVerificationToken } = await import("@/lib/verification-token");
    const { sendVerificationEmail } = await import("@/server/email/sender");
    const token = await createVerificationToken(`email:${ctx.authUserId}`);
    await sendVerificationEmail({ to: user.email, type: "signup", token });

    return { sent: true };
  }),

  reverifyEmail: protectedProcedure.mutation(async ({ ctx }) => {
    const { allowed } = verifyResendLimiter.check(ctx.authUserId);
    if (!allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many requests. Please wait before resending.",
      });
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.authUserId },
      select: { email: true },
    });

    // Clear verified status and send new verification
    await prisma.user.update({
      where: { id: ctx.authUserId },
      data: { emailVerified: null },
    });

    const { createVerificationToken } = await import("@/lib/verification-token");
    const { sendVerificationEmail } = await import("@/server/email/sender");
    const token = await createVerificationToken(`email:${ctx.authUserId}`);
    await sendVerificationEmail({ to: user.email, type: "signup", token });

    return { sent: true };
  }),

  getForwardingSettings: protectedProcedure.query(async ({ ctx }) => {
    const isPartner = ctx.authUserId !== ctx.userId;

    // Per-user delivery preferences (from the authenticated user's own record)
    const perUserSelect = {
      individualForwardingEnabled: true,
      dailyBriefEnabled: true,
      weeklyBriefEnabled: true,
      briefScope: true,
      dailyBriefHour: true,
      weeklyBriefDay: true,
      weeklyBriefHour: true,
      timezone: true,
      lastDailyBriefSentAt: true,
      lastWeeklyBriefSentAt: true,
    } as const;

    // Shared content settings (from the household primary)
    const sharedSelect = {
      showLinksInSummary: true,
      brutalMode: true,
    } as const;

    if (isPartner) {
      const [perUser, shared] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: ctx.authUserId }, select: perUserSelect }),
        prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: sharedSelect }),
      ]);
      return { ...shared, ...perUser };
    }

    return prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      select: { ...perUserSelect, ...sharedSelect },
    });
  }),

  updateForwardingSettings: protectedProcedure
    .input(
      z.object({
        individualForwardingEnabled: z.boolean().optional(),
        dailyBriefEnabled: z.boolean().optional(),
        weeklyBriefEnabled: z.boolean().optional(),
        briefScope: briefScopeEnum.optional(),
        dailyBriefHour: z.number().min(6).max(21).optional(),
        weeklyBriefDay: z.number().refine((d) => [0, 5, 6].includes(d), {
          message: "Weekly brief can only be sent on Friday, Saturday, or Sunday",
        }).optional(),
        weeklyBriefHour: z.number().min(6).max(21).optional(),
        timezone: z.string().min(1).optional().refine(
          (tz) => {
            if (!tz) return true;
            try {
              Intl.DateTimeFormat(undefined, { timeZone: tz });
              return true;
            } catch {
              return false;
            }
          },
          { message: "Invalid timezone" }
        ),
        showLinksInSummary: z.boolean().optional(),
        brutalMode: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Hard-block individual forwarding for shared inbox accounts
      if (input.individualForwardingEnabled === true) {
        const user = await prisma.user.findUniqueOrThrow({
          where: { id: ctx.userId },
          select: { emailAccountType: true },
        });
        if (user.emailAccountType === "SHARED") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Individual forwarding is not available for shared inbox accounts",
          });
        }
      }

      // Destructure shared vs per-user fields for type safety.
      // Shared fields require owner permission.
      const { showLinksInSummary, brutalMode, ...perUserInput } = input;

      const perUserData = Object.fromEntries(
        Object.entries(perUserInput).filter(([, v]) => v !== undefined)
      );
      const sharedData = Object.fromEntries(
        Object.entries({ showLinksInSummary, brutalMode }).filter(([, v]) => v !== undefined)
      );

      if (Object.keys(sharedData).length > 0) {
        requireOwner(ctx);
      }

      const updates: Promise<unknown>[] = [];
      if (Object.keys(perUserData).length > 0) {
        updates.push(prisma.user.update({ where: { id: ctx.authUserId }, data: perUserData }));
      }
      if (Object.keys(sharedData).length > 0) {
        updates.push(prisma.user.update({ where: { id: ctx.userId }, data: sharedData }));
      }
      await Promise.all(updates);

      // Return merged current state
      const isPartner = ctx.authUserId !== ctx.userId;
      if (isPartner) {
        const [perUser, shared] = await Promise.all([
          prisma.user.findUniqueOrThrow({
            where: { id: ctx.authUserId },
            select: {
              individualForwardingEnabled: true, dailyBriefEnabled: true,
              weeklyBriefEnabled: true, briefScope: true, dailyBriefHour: true,
              weeklyBriefDay: true, weeklyBriefHour: true, timezone: true,
            },
          }),
          prisma.user.findUniqueOrThrow({
            where: { id: ctx.userId },
            select: { showLinksInSummary: true, brutalMode: true },
          }),
        ]);
        return { ...shared, ...perUser };
      }
      return prisma.user.findUniqueOrThrow({
        where: { id: ctx.userId },
        select: {
          individualForwardingEnabled: true, dailyBriefEnabled: true,
          weeklyBriefEnabled: true, briefScope: true, dailyBriefHour: true,
          weeklyBriefDay: true, weeklyBriefHour: true, timezone: true,
          showLinksInSummary: true, brutalMode: true,
        },
      });
    }),

  forceBrief: protectedProcedure
    .input(z.object({ briefType: z.enum(["daily", "weekly"]) }))
    .mutation(async ({ ctx, input }) => {
      const { emailQueue } = await import("@/worker/queue");
      await emailQueue.add("force-brief", {
        userId: ctx.userId,
        briefType: input.briefType,
      });
      return { queued: true };
    }),

  changePassword: protectedProcedure
    .input(changePasswordSchema)
    .mutation(async ({ ctx, input }) => {
      const { allowed } = changePasswordLimiter.check(ctx.authUserId);
      if (!allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many attempts. Please wait before trying again.",
        });
      }

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: ctx.authUserId },
        select: { passwordHash: true },
      });

      if (!user.passwordHash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No password set on this account.",
        });
      }

      const bcrypt = await import("bcryptjs");
      const isValid = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!isValid) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Current password is incorrect.",
        });
      }

      const newHash = await bcrypt.hash(input.newPassword, 12);
      await prisma.user.update({
        where: { id: ctx.authUserId },
        data: { passwordHash: newHash },
      });

      return { success: true };
    }),

  changeEmail: protectedProcedure
    .input(changeEmailSchema)
    .mutation(async ({ ctx, input }) => {
      const { allowed } = changeEmailLimiter.check(ctx.authUserId);
      if (!allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many attempts. Please wait before trying again.",
        });
      }

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: ctx.authUserId },
        select: { passwordHash: true, email: true },
      });

      if (!user.passwordHash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No password set on this account.",
        });
      }

      const bcrypt = await import("bcryptjs");
      const isValid = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!isValid) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Current password is incorrect.",
        });
      }

      const normalizedNew = input.newEmail.toLowerCase();
      if (normalizedNew === user.email.toLowerCase()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "New email is the same as your current email.",
        });
      }

      const existing = await prisma.user.findFirst({
        where: { email: { equals: input.newEmail, mode: "insensitive" } },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This email address is already in use.",
        });
      }

      await prisma.user.update({
        where: { id: ctx.authUserId },
        data: { pendingEmail: input.newEmail },
      });

      const { createVerificationToken } = await import("@/lib/verification-token");
      const { sendVerificationEmail } = await import("@/server/email/sender");
      const token = await createVerificationToken(`email-change:${ctx.authUserId}`);
      await sendVerificationEmail({ to: input.newEmail, type: "email-change", token });

      return { sent: true };
    }),

  cancelEmailChange: protectedProcedure.mutation(async ({ ctx }) => {
    await prisma.user.update({
      where: { id: ctx.authUserId },
      data: { pendingEmail: null },
    });
    await prisma.verificationToken.deleteMany({
      where: { identifier: `email-change:${ctx.authUserId}` },
    });
    return { success: true };
  }),

  exportMyData: protectedProcedure.query(async ({ ctx }) => {
    const { decryptChildRecord, decryptForwardingRecord } = await import("@/lib/pii-encryption");

    // Fetch all user-owned data in parallel
    const [user, children, parents, forwardingAddresses, connection, senderRules, allowedSenders, ignoredActivities, priorityActivities, processedEmails, events, briefDeliveries, feedback] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: ctx.userId },
        select: {
          id: true, email: true, name: true, createdAt: true,
          timezone: true, emailFilterMode: true, emailAccountType: true,
          individualForwardingEnabled: true, dailyBriefEnabled: true, weeklyBriefEnabled: true,
          briefScope: true, dailyBriefHour: true, weeklyBriefDay: true, weeklyBriefHour: true,
          brutalMode: true, showLinksInSummary: true, actionableEventsOnly: true,
          feedbackTrainingConsent: true, supportDataConsent: true,
        },
      }),
      prisma.child.findMany({ where: { userId: ctx.userId }, orderBy: { displayOrder: "asc" } }),
      prisma.parent.findMany({
        where: { userId: ctx.userId },
        select: { id: true, name: true, relationship: true, displayOrder: true, createdAt: true },
        orderBy: { displayOrder: "asc" },
      }),
      prisma.forwardingAddress.findMany({ where: { userId: ctx.userId } }),
      prisma.emailConnection.findUnique({
        where: { userId: ctx.userId },
        select: { provider: true, emailAddress: true, status: true, createdAt: true },
      }),
      prisma.senderRule.findMany({
        where: { userId: ctx.userId },
        select: { senderEmail: true, action: true, createdAt: true },
      }),
      prisma.allowedSender.findMany({
        where: { userId: ctx.userId },
        select: { pattern: true, createdAt: true },
      }),
      prisma.ignoredActivity.findMany({
        where: { userId: ctx.userId },
        select: { name: true, createdAt: true },
      }),
      prisma.priorityActivity.findMany({
        where: { userId: ctx.userId },
        select: { name: true, createdAt: true },
      }),
      prisma.processedEmail.findMany({
        where: { userId: ctx.userId },
        select: {
          fromAddress: true, fromName: true, subject: true, receivedAt: true,
          aiDecision: true, aiRelevant: true, aiSummary: true, aiSubject: true,
          forwarded: true, skipForwardReason: true, topicSlug: true, createdAt: true,
        },
        orderBy: { receivedAt: "desc" },
        take: 5000,
      }),
      prisma.extractedEvent.findMany({
        where: { userId: ctx.userId },
        select: {
          title: true, eventDate: true, allDay: true, isTodo: true,
          location: true, details: true, actionable: true, createdAt: true,
          children: { select: { id: true } },
        },
        orderBy: { eventDate: "desc" },
        take: 5000,
      }),
      prisma.briefDelivery.findMany({
        where: { userId: ctx.userId },
        select: { briefType: true, status: true, recipientCount: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 2000,
      }),
      prisma.userFeedback.findMany({
        where: { userId: ctx.userId },
        select: { category: true, subject: true, message: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // Decrypt PII fields
    const decryptedChildren = await Promise.all(children.map(async (c) => {
      const d = await decryptChildRecord(c);
      return {
        name: d.name, grade: d.grade, className: d.className,
        teachers: d.teachers, additionalInfo: d.additionalInfo,
        pronouns: c.pronouns, displayOrder: c.displayOrder, createdAt: c.createdAt,
      };
    }));

    const decryptedForwarding = await Promise.all(forwardingAddresses.map(async (f) => {
      const d = await decryptForwardingRecord(f);
      return {
        email: d.email, name: d.name, label: f.label,
        isActive: f.isActive, verifiedAt: f.verifiedAt, createdAt: f.createdAt,
      };
    }));

    // Build child ID-to-name map for events
    const childIdToName = new Map<string, string>();
    for (const c of children) {
      const d = await decryptChildRecord(c);
      childIdToName.set(c.id, d.name);
    }

    const eventsWithChildren = events.map((e) => ({
      ...e,
      children: e.children.map((c) => childIdToName.get(c.id) ?? "unknown"),
    }));

    return {
      exportedAt: new Date().toISOString(),
      account: user,
      family: { parents, children: decryptedChildren },
      emailConnection: connection,
      forwardingAddresses: decryptedForwarding,
      filters: { senderRules, allowedSenders, ignoredActivities, priorityActivities },
      processedEmails: { data: processedEmails, truncated: processedEmails.length >= 5000 },
      events: { data: eventsWithChildren, truncated: events.length >= 5000 },
      briefDeliveries: { data: briefDeliveries, truncated: briefDeliveries.length >= 2000 },
      feedback,
    };
  }),

  deleteAccount: protectedProcedure
    .input(z.object({ password: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: ctx.authUserId },
        select: { passwordHash: true },
      });

      if (!user.passwordHash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Account does not use password authentication.",
        });
      }

      const { compare } = await import("bcryptjs");
      const valid = await compare(input.password, user.passwordHash);
      if (!valid) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Incorrect password.",
        });
      }

      // Revoke Gmail token with Google before cascade-deleting (best-effort)
      const connection = await prisma.emailConnection.findUnique({
        where: { userId: ctx.authUserId },
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

      await prisma.user.delete({
        where: { id: ctx.authUserId },
      });
      return { success: true };
    }),

  reactivate: deactivatedAllowedProcedure.mutation(async ({ ctx }) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.authUserId },
      select: { accountStatus: true },
    });

    if (user.accountStatus !== "DEACTIVATED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Account is not deactivated.",
      });
    }

    await prisma.user.update({
      where: { id: ctx.authUserId },
      data: getReactivationData(),
    });

    return { success: true };
  }),
});
