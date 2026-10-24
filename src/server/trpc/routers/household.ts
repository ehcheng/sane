import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, householdOwnerProcedure } from "../trpc";
import { prisma } from "@/server/db/prisma";

export const householdRouter = router({
  /** Decline a pending invite (deletes it) */
  declineInvite: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: ctx.authUserId },
        select: { email: true },
      });

      const invite = await prisma.householdInvite.findFirst({
        where: {
          token: input.token,
          email: { equals: user.email, mode: "insensitive" },
          acceptedAt: null,
        },
      });
      if (!invite) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found." });
      }

      await prisma.householdInvite.delete({ where: { id: invite.id } });
      return { success: true };
    }),

  /** Get current household status for the logged-in user */
  status: protectedProcedure.query(async ({ ctx }) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.authUserId },
      select: {
        email: true,
        householdId: true,
        household: {
          select: {
            id: true,
            primaryUserId: true,
            createdAt: true,
            members: {
              select: { id: true, name: true, email: true },
            },
            invites: {
              where: { acceptedAt: null, expiresAt: { gt: new Date() } },
              select: { id: true, email: true, createdAt: true, expiresAt: true },
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });

    if (!user.householdId || !user.household) {
      // Check for a pending invite addressed to this user
      const invite = await prisma.householdInvite.findFirst({
        where: {
          email: { equals: user.email, mode: "insensitive" },
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: {
          token: true,
          household: { select: { primaryUser: { select: { name: true } } } },
        },
      });

      return {
        inHousehold: false as const,
        pendingInvite: invite
          ? { token: invite.token, inviterName: invite.household.primaryUser.name }
          : null,
      };
    }

    return {
      inHousehold: true as const,
      pendingInvite: null,
      isPrimary: user.household.primaryUserId === ctx.authUserId,
      household: {
        id: user.household.id,
        primaryUserId: user.household.primaryUserId,
        createdAt: user.household.createdAt,
        members: user.household.members,
        pendingInvites: user.household.invites,
      },
    };
  }),

  /** Create a new household with the current user as primary */
  create: protectedProcedure.mutation(async ({ ctx }) => {
    // Check user is not already in a household
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.authUserId },
      select: { householdId: true },
    });
    if (user.householdId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "You are already in a household.",
      });
    }

    const household = await prisma.household.create({
      data: {
        primaryUserId: ctx.authUserId,
        members: { connect: { id: ctx.authUserId } },
      },
    });

    return { householdId: household.id };
  }),

  /** Invite a partner by email. Sends an invite email with HMAC token. */
  invite: householdOwnerProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.household.members.length >= 6) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Households are limited to 6 members." });
      }

      const existingInvite = await prisma.householdInvite.findFirst({
        where: {
          householdId: ctx.household.id,
          email: { equals: input.email, mode: "insensitive" },
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (existingInvite) {
        throw new TRPCError({ code: "CONFLICT", message: "An invite is already pending for this email." });
      }

      const { signToken } = await import("@/lib/hmac-token");
      const token = signToken(
        { householdId: ctx.household.id, email: input.email.toLowerCase() },
        7,
        "household-invite"
      );

      const invite = await prisma.householdInvite.create({
        data: {
          householdId: ctx.household.id,
          email: input.email.toLowerCase(),
          token,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      const { sendHouseholdInviteEmail } = await import("@/server/email/sender");
      await sendHouseholdInviteEmail({
        to: input.email.toLowerCase(),
        inviterName: ctx.ownerName,
        token,
      });

      return { inviteId: invite.id };
    }),

  /** Resend a pending invite with a fresh token and expiry */
  resendInvite: householdOwnerProcedure
    .input(z.object({ inviteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const invite = await prisma.householdInvite.findUnique({
        where: { id: input.inviteId, householdId: ctx.household.id },
        select: { id: true, email: true, householdId: true, acceptedAt: true },
      });
      if (!invite) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found." });
      }
      if (invite.acceptedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invite already accepted." });
      }

      const { signToken } = await import("@/lib/hmac-token");
      const token = signToken(
        { householdId: invite.householdId, email: invite.email },
        7,
        "household-invite"
      );

      await prisma.householdInvite.update({
        where: { id: invite.id },
        data: { token, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      });

      const { sendHouseholdInviteEmail } = await import("@/server/email/sender");
      await sendHouseholdInviteEmail({
        to: invite.email,
        inviterName: ctx.ownerName,
        token,
      });

      return { success: true };
    }),

  /** Cancel a pending invite */
  cancelInvite: householdOwnerProcedure
    .input(z.object({ inviteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { count } = await prisma.householdInvite.deleteMany({
        where: { id: input.inviteId, householdId: ctx.household.id },
      });
      if (!count) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found." });
      }
      return { success: true };
    }),

  /**
   * Accept a household invite. Deletes the partner's standalone data
   * (events, children, parents, emails, etc.) and links them to the household.
   */
  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify the HMAC token
      const { verifyToken } = await import("@/lib/hmac-token");
      const payload = verifyToken<{ householdId: string; email: string }>(input.token, "household-invite");
      if (!payload) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired invite link." });
      }

      // Verify the invite record exists and is not already accepted
      const invite = await prisma.householdInvite.findFirst({
        where: {
          householdId: payload.householdId,
          email: { equals: payload.email, mode: "insensitive" },
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (!invite) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invite not found or already accepted." });
      }

      const joiningUser = await prisma.user.findUniqueOrThrow({
        where: { id: ctx.authUserId },
        select: { id: true, email: true, householdId: true },
      });

      if (joiningUser.householdId) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You are already in a household. Leave your current household first.",
        });
      }

      // Delete the joining user's standalone data in a transaction.
      // Intentionally preserved:
      //   - EmailConnection: process-user-emails.ts resolves effectiveUserId
      //     via household, so the member's inbox processes into the primary's pool.
      //   - ForwardingAddress: per-user delivery destinations for briefs.
      //   - calendarToken: now resolves to household events via effectiveUserId.
      await prisma.$transaction([
        prisma.extractedEvent.deleteMany({ where: { userId: joiningUser.id } }),
        prisma.processedEmail.deleteMany({ where: { userId: joiningUser.id } }),
        prisma.child.deleteMany({ where: { userId: joiningUser.id } }),
        prisma.parent.deleteMany({ where: { userId: joiningUser.id } }),
        prisma.ignoredActivity.deleteMany({ where: { userId: joiningUser.id } }),
        prisma.priorityActivity.deleteMany({ where: { userId: joiningUser.id } }),
        prisma.senderRule.deleteMany({ where: { userId: joiningUser.id } }),
        prisma.allowedSender.deleteMany({ where: { userId: joiningUser.id } }),
        prisma.feedbackSnapshot.deleteMany({ where: { userId: joiningUser.id } }),
        prisma.userFeedback.deleteMany({ where: { userId: joiningUser.id } }),
        prisma.briefDelivery.deleteMany({ where: { userId: joiningUser.id } }),
        prisma.processedEmailDailyStats.deleteMany({ where: { userId: joiningUser.id } }),
        // Mark invite as accepted and link user to household
        prisma.householdInvite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        }),
        prisma.user.update({
          where: { id: joiningUser.id },
          data: { householdId: payload.householdId },
        }),
      ]);

      return { success: true, householdId: payload.householdId };
    }),

  /** Primary removes a member from the household */
  removeMember: householdOwnerProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.authUserId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot remove yourself. Use Stop Sharing instead." });
      }

      const member = await prisma.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { name: true, email: true },
      });

      await prisma.user.update({
        where: { id: input.userId },
        data: { householdId: null, wizardStep: 0, completedTours: "[]" },
      });

      const { sendHouseholdDepartureEmail } = await import("@/server/email/sender");
      await Promise.allSettled([
        sendHouseholdDepartureEmail({
          to: member.email,
          recipientName: member.name,
          departedName: member.name,
          reason: "removed",
        }),
        sendHouseholdDepartureEmail({
          to: ctx.ownerEmail,
          recipientName: ctx.ownerName,
          departedName: member.name,
          reason: "removed",
        }),
      ]);

      return { success: true };
    }),

  /** Partner leaves the household. They start fresh as solo. */
  leave: protectedProcedure.mutation(async ({ ctx }) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.authUserId },
      select: {
        name: true,
        email: true,
        householdId: true,
        household: { select: { primaryUserId: true } },
      },
    });

    if (!user.householdId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "You are not in a household." });
    }

    if (user.household?.primaryUserId === ctx.authUserId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The household owner cannot leave. Use dissolve instead.",
      });
    }

    // Fetch owner for notification
    const owner = await prisma.user.findUniqueOrThrow({
      where: { id: user.household!.primaryUserId },
      select: { name: true, email: true },
    });

    await prisma.user.update({
      where: { id: ctx.authUserId },
      data: { householdId: null, wizardStep: 0, completedTours: "[]" },
    });

    // Notify both parties (best-effort)
    const { sendHouseholdDepartureEmail } = await import("@/server/email/sender");
    await Promise.allSettled([
      sendHouseholdDepartureEmail({
        to: user.email,
        recipientName: user.name,
        departedName: user.name,
        reason: "left",
      }),
      sendHouseholdDepartureEmail({
        to: owner.email,
        recipientName: owner.name,
        departedName: user.name,
        reason: "left",
      }),
    ]);

    return { success: true };
  }),

  /** Primary stops sharing. All partners are unlinked and notified. */
  dissolve: householdOwnerProcedure.mutation(async ({ ctx }) => {
    const nonOwnerMembers = ctx.household.members.filter((m) => m.id !== ctx.authUserId);

    await prisma.$transaction([
      // Primary keeps their data and wizard state
      prisma.user.update({
        where: { id: ctx.authUserId },
        data: { householdId: null },
      }),
      // Non-primary members reset to setup wizard
      prisma.user.updateMany({
        where: { householdId: ctx.household.id, id: { not: ctx.authUserId } },
        data: { householdId: null, wizardStep: 0, completedTours: "[]" },
      }),
      prisma.householdInvite.deleteMany({
        where: { householdId: ctx.household.id },
      }),
      prisma.household.delete({
        where: { id: ctx.household.id },
      }),
    ]);

    // Notify disconnected members (best-effort)
    if (nonOwnerMembers.length > 0) {
      const { sendHouseholdDepartureEmail } = await import("@/server/email/sender");
      await Promise.allSettled(
        nonOwnerMembers.map((member) =>
          sendHouseholdDepartureEmail({
            to: member.email,
            recipientName: member.name,
            departedName: member.name,
            reason: "dissolved",
          })
        )
      );
    }

    return { success: true };
  }),
});
