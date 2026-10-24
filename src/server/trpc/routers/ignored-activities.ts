import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { prisma } from "@/server/db/prisma";
import { ignoredActivitySchema, FIELD_LIMITS } from "@/lib/validators";

export const ignoredActivitiesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return prisma.ignoredActivity.findMany({
      where: { userId: ctx.userId },
      orderBy: { createdAt: "asc" },
    });
  }),

  create: protectedProcedure
    .input(ignoredActivitySchema)
    .mutation(async ({ ctx, input }) => {
      const count = await prisma.ignoredActivity.count({
        where: { userId: ctx.userId },
      });
      if (count >= FIELD_LIMITS.ignoredActivitiesCount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You can have at most ${FIELD_LIMITS.ignoredActivitiesCount} ignored activities`,
        });
      }
      return prisma.ignoredActivity.create({
        data: {
          ...input,
          userId: ctx.userId,
        },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await prisma.ignoredActivity.delete({
        where: { id: input.id, userId: ctx.userId },
      });
      return { success: true };
    }),
});
