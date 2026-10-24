import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { prisma } from "@/server/db/prisma";
import { createSenderRuleSchema, FIELD_LIMITS } from "@/lib/validators";

const SUGGESTION_THRESHOLD = 3;

export const senderRulesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return prisma.senderRule.findMany({
      where: { userId: ctx.userId },
      orderBy: { createdAt: "desc" },
    });
  }),

  suggestions: protectedProcedure.query(async ({ ctx }) => {
    // Find senders where the user has given 3+ consistent negative feedback,
    // excluding senders that already have a rule.
    const rows = await prisma.$queryRaw<
      Array<{ fromAddress: string; userFeedback: string; cnt: bigint }>
    >`
      SELECT pe."fromAddress", pe."userFeedback", COUNT(*)::bigint as cnt
      FROM "ProcessedEmail" pe
      WHERE pe."userId" = ${ctx.userId}
        AND pe."userFeedback" IN ('wrong_skip', 'wrong_forward')
        AND NOT EXISTS (
          SELECT 1 FROM "SenderRule" sr
          WHERE sr."userId" = pe."userId"
            AND sr."senderEmail" = LOWER(pe."fromAddress")
        )
      GROUP BY pe."fromAddress", pe."userFeedback"
      HAVING COUNT(*) >= ${SUGGESTION_THRESHOLD}
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `;

    return rows.map((r) => ({
      senderEmail: r.fromAddress,
      suggestedAction: r.userFeedback === "wrong_skip" ? "ALWAYS_FORWARD" as const : "NEVER_FORWARD" as const,
      feedbackCount: Number(r.cnt),
    }));
  }),

  create: protectedProcedure
    .input(createSenderRuleSchema)
    .mutation(async ({ ctx, input }) => {
      const count = await prisma.senderRule.count({
        where: { userId: ctx.userId },
      });
      if (count >= FIELD_LIMITS.senderRulesCount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You can have at most ${FIELD_LIMITS.senderRulesCount} sender rules`,
        });
      }

      // Upsert: if rule exists for this sender, update action
      return prisma.senderRule.upsert({
        where: {
          userId_senderEmail: {
            userId: ctx.userId,
            senderEmail: input.senderEmail.toLowerCase(),
          },
        },
        create: {
          userId: ctx.userId,
          senderEmail: input.senderEmail.toLowerCase(),
          action: input.action,
        },
        update: {
          action: input.action,
        },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await prisma.senderRule.delete({
        where: { id: input.id, userId: ctx.userId },
      });
      return { success: true };
    }),
});
