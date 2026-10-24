import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { prisma } from "@/server/db/prisma";
import { createParentSchema, updateParentSchema } from "@/lib/validators";

export const parentsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return prisma.parent.findMany({
      where: { userId: ctx.userId },
      orderBy: { displayOrder: "asc" },
    });
  }),

  create: protectedProcedure
    .input(createParentSchema)
    .mutation(async ({ ctx, input }) => {
      const maxOrder = await prisma.parent.aggregate({
        where: { userId: ctx.userId },
        _max: { displayOrder: true },
      });
      return prisma.parent.create({
        data: {
          ...input,
          userId: ctx.userId,
          displayOrder: (maxOrder._max.displayOrder ?? -1) + 1,
        },
      });
    }),

  update: protectedProcedure
    .input(updateParentSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return prisma.parent.update({
        where: { id, userId: ctx.userId },
        data,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [, remaining] = await prisma.$transaction([
        prisma.parent.delete({
          where: { id: input.id, userId: ctx.userId },
        }),
        prisma.parent.count({
          where: { userId: ctx.userId },
        }),
      ]);

      const monitoringPaused = remaining === 0;
      if (monitoringPaused) {
        await prisma.user.update({
          where: { id: ctx.userId },
          data: { isMonitoringEnabled: false },
        });
      }

      return { success: true, monitoringPaused };
    }),

  reorder: protectedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      await prisma.$transaction(
        input.ids.map((id, index) =>
          prisma.parent.update({
            where: { id, userId: ctx.userId },
            data: { displayOrder: index },
          })
        )
      );
      return { success: true };
    }),
});
