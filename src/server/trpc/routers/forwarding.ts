import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { prisma } from "@/server/db/prisma";
import {
  createForwardingAddressSchema,
  updateForwardingAddressSchema,
} from "@/lib/validators";
import { createRateLimiter } from "@/lib/rate-limit";
import logger from "@/lib/logger";

const verifyResendLimiter = createRateLimiter("fwd-verify-resend", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 3,
});

const testEmailLimiter = createRateLimiter("fwd-test-email", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 3,
});

export const forwardingRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    // Show all household members' forwarding addresses (or just own for solo users)
    const records = await prisma.forwardingAddress.findMany({
      where: ctx.householdId
        ? { user: { householdId: ctx.householdId } }
        : { userId: ctx.authUserId },
      orderBy: { createdAt: "asc" },
    });

    const { decryptForwardingRecord } = await import("@/lib/pii-encryption");
    const decrypted = await Promise.all(records.map((r) => decryptForwardingRecord(r)));
    return decrypted.map((r) => ({
      ...r,
      ownedByMe: r.userId === ctx.authUserId,
    }));
  }),

  create: protectedProcedure
    .input(createForwardingAddressSchema)
    .mutation(async ({ ctx, input }) => {
      const { encryptForwardingFields, hashEmail } = await import("@/lib/pii-encryption");
      const encrypted = await encryptForwardingFields(input);
      const emailHash = await hashEmail(input.email);

      // Upsert to prevent duplicates (e.g. wizard auto-add on page reload)
      const address = await prisma.forwardingAddress.upsert({
        where: {
          userId_emailHash: {
            userId: ctx.authUserId,
            emailHash,
          },
        },
        update: {},
        create: {
          ...encrypted,
          label: input.label,
          userId: ctx.authUserId,
          isActive: false,
        },
      });

      // If the forwarding email matches the login email, skip separate verification.
      // - Already verified login → auto-verify forwarding immediately.
      // - Not yet verified (wizard flow) → the login verification will auto-verify
      //   matching forwarding addresses when it completes (see verify-email route).
      if (!address.verifiedAt) {
        const user = await prisma.user.findUniqueOrThrow({
          where: { id: ctx.authUserId },
          select: { email: true, emailVerified: true },
        });
        const emailsMatch = user.email.toLowerCase() === input.email.toLowerCase();

        if (emailsMatch && user.emailVerified) {
          // Login email already verified → auto-verify forwarding now
          const updated = await prisma.forwardingAddress.update({
            where: { id: address.id },
            data: { verifiedAt: new Date(), isActive: true },
          });
          const { decryptForwardingRecord } = await import("@/lib/pii-encryption");
          return decryptForwardingRecord(updated);
        }

        if (!emailsMatch) {
          // Different email → send separate verification
          try {
            const { createVerificationToken } = await import("@/lib/verification-token");
            const { sendVerificationEmail } = await import("@/server/email/sender");
            const token = await createVerificationToken(`fwd:${ctx.authUserId}:${address.id}`);
            await sendVerificationEmail({ to: input.email, type: "forwarding", token });
          } catch (err) {
            logger.error("forwarding", "Failed to send verification email", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        // emailsMatch && !emailVerified → no email sent; login verification handles it
      }

      const { decryptForwardingRecord } = await import("@/lib/pii-encryption");
      return decryptForwardingRecord(address);
    }),

  update: protectedProcedure
    .input(updateForwardingAddressSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      // If email is changing, reset verification and deactivate
      if (data.email) {
        const existing = await prisma.forwardingAddress.findUnique({
          where: { id, userId: ctx.authUserId },
        });

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Forwarding address not found." });
        }

        const { decryptForwardingRecord, encryptForwardingFields, hashEmail } = await import("@/lib/pii-encryption");
        const decrypted = await decryptForwardingRecord(existing);

        if (decrypted.email !== data.email) {
          const encrypted = await encryptForwardingFields({
            email: data.email,
            name: data.name !== undefined ? data.name : decrypted.name,
          });
          const newEmailHash = await hashEmail(data.email);
          const address = await prisma.forwardingAddress.update({
            where: { id, userId: ctx.authUserId },
            data: {
              ...encrypted,
              emailHash: newEmailHash,
              label: data.label,
              isActive: data.isActive,
              verifiedAt: null,
            },
          });

          try {
            const { createVerificationToken } = await import("@/lib/verification-token");
            const { sendVerificationEmail } = await import("@/server/email/sender");
            const token = await createVerificationToken(`fwd:${ctx.authUserId}:${address.id}`);
            await sendVerificationEmail({ to: data.email, type: "forwarding", token });
          } catch (err) {
            console.error("Failed to send forwarding verification email:", err);
          }

          return decryptForwardingRecord(address);
        }
      }

      // Non-email update (name, label, isActive)
      const updateData: Record<string, unknown> = {};
      if (data.label !== undefined) updateData.label = data.label;
      if (data.isActive !== undefined) updateData.isActive = data.isActive;
      if (data.name !== undefined) {
        const { encryptForwardingFields } = await import("@/lib/pii-encryption");
        // Only encrypt name — keep email as-is
        const { encrypt } = await import("@/lib/encryption");
        updateData.nameEncrypted = data.name ? encrypt(data.name) : null;
      }

      const record = await prisma.forwardingAddress.update({
        where: { id, userId: ctx.authUserId },
        data: updateData,
      });
      const { decryptForwardingRecord } = await import("@/lib/pii-encryption");
      return decryptForwardingRecord(record);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Transaction: delete + count atomically, then conditionally pause
      const [, remaining] = await prisma.$transaction([
        prisma.forwardingAddress.delete({
          where: { id: input.id, userId: ctx.authUserId },
        }),
        prisma.forwardingAddress.count({
          where: { userId: ctx.authUserId },
        }),
      ]);

      const monitoringPaused = remaining === 0;
      if (monitoringPaused) {
        await prisma.user.update({
          where: { id: ctx.authUserId },
          data: { isMonitoringEnabled: false },
        });

        try {
          const { sendMonitoringStoppedEmail } = await import("@/server/email/sender");
          sendMonitoringStoppedEmail({ userId: ctx.authUserId }).catch((err) => {
            logger.error("forwarding", "Failed to send monitoring-stopped email", {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        } catch (err) {
          logger.error("forwarding", "Failed to import email sender", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return { success: true, monitoringPaused };
    }),

  resendVerification: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { allowed } = verifyResendLimiter.check(ctx.authUserId);
      if (!allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many requests. Please wait before resending.",
        });
      }

      const address = await prisma.forwardingAddress.findUnique({
        where: { id: input.id, userId: ctx.authUserId },
      });

      if (!address) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Forwarding address not found.",
        });
      }

      const { decryptForwardingRecord } = await import("@/lib/pii-encryption");
      const decrypted = await decryptForwardingRecord(address);

      const { createVerificationToken } = await import("@/lib/verification-token");
      const { sendVerificationEmail } = await import("@/server/email/sender");
      const token = await createVerificationToken(`fwd:${ctx.authUserId}:${address.id}`);
      await sendVerificationEmail({ to: decrypted.email, type: "forwarding", token });

      return { sent: true };
    }),

  sendTestEmail: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { allowed } = testEmailLimiter.check(ctx.authUserId);
      if (!allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many test emails. Please wait before sending another.",
        });
      }

      const address = await prisma.forwardingAddress.findUnique({
        where: { id: input.id, userId: ctx.authUserId },
      });

      if (!address) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Forwarding address not found.",
        });
      }

      const { decryptForwardingRecord } = await import("@/lib/pii-encryption");
      const decrypted = await decryptForwardingRecord(address);

      const { sendTestEmail } = await import("@/server/email/sender");
      await sendTestEmail({ to: decrypted.email, name: decrypted.name });

      return { sent: true };
    }),
});
