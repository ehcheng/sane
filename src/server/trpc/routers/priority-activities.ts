import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { prisma } from "@/server/db/prisma";
import { priorityActivitySchema, FIELD_LIMITS } from "@/lib/validators";

export const priorityActivitiesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return prisma.priorityActivity.findMany({
      where: { userId: ctx.userId },
      orderBy: { createdAt: "asc" },
    });
  }),

  create: protectedProcedure
    .input(priorityActivitySchema)
    .mutation(async ({ ctx, input }) => {
      const count = await prisma.priorityActivity.count({
        where: { userId: ctx.userId },
      });
      if (count >= FIELD_LIMITS.priorityActivitiesCount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You can have at most ${FIELD_LIMITS.priorityActivitiesCount} priority activities`,
        });
      }
      return prisma.priorityActivity.create({
        data: {
          ...input,
          userId: ctx.userId,
        },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await prisma.priorityActivity.delete({
        where: { id: input.id, userId: ctx.userId },
      });
      return { success: true };
    }),
});
