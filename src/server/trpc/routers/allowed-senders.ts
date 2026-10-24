import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { prisma } from "@/server/db/prisma";
import { createAllowedSenderSchema, FIELD_LIMITS } from "@/lib/validators";

export const allowedSendersRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return prisma.allowedSender.findMany({
      where: { userId: ctx.userId },
      orderBy: { createdAt: "desc" },
    });
  }),

  create: protectedProcedure
    .input(createAllowedSenderSchema)
    .mutation(async ({ ctx, input }) => {
      const count = await prisma.allowedSender.count({
        where: { userId: ctx.userId },
      });
      if (count >= FIELD_LIMITS.allowedSendersCount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You can have at most ${FIELD_LIMITS.allowedSendersCount} allowed senders`,
        });
      }

      const normalized = input.pattern.toLowerCase().trim();

      return prisma.allowedSender.upsert({
        where: {
          userId_pattern: {
            userId: ctx.userId,
            pattern: normalized,
          },
        },
        create: {
          userId: ctx.userId,
          pattern: normalized,
        },
        update: {},
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await prisma.allowedSender.delete({
        where: { id: input.id, userId: ctx.userId },
      });
      return { success: true };
    }),
});
