import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { prisma } from "@/server/db/prisma";
import { createChildSchema, updateChildSchema } from "@/lib/validators";
import { buildAnalysisPrompt } from "@/server/ai/prompt-builder";

export const childrenRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const records = await prisma.child.findMany({
      where: { userId: ctx.userId },
      orderBy: { displayOrder: "asc" },
    });
    const { decryptChildRecord } = await import("@/lib/pii-encryption");
    return Promise.all(records.map((r) => decryptChildRecord(r)));
  }),

  create: protectedProcedure
    .input(createChildSchema)
    .mutation(async ({ ctx, input }) => {
      const { encryptChildFields } = await import("@/lib/pii-encryption");
      const encrypted = await encryptChildFields(input);
      const maxOrder = await prisma.child.aggregate({
        where: { userId: ctx.userId },
        _max: { displayOrder: true },
      });
      const record = await prisma.child.create({
        data: {
          ...encrypted,
          pronouns: input.pronouns ?? null,
          userId: ctx.userId,
          displayOrder: (maxOrder._max.displayOrder ?? -1) + 1,
        },
      });
      const { decryptChildRecord } = await import("@/lib/pii-encryption");
      return decryptChildRecord(record);
    }),

  update: protectedProcedure
    .input(updateChildSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const { encryptChildFields } = await import("@/lib/pii-encryption");
      // Provide defaults for partial update: fetch existing then overlay
      const existing = await prisma.child.findUniqueOrThrow({
        where: { id, userId: ctx.userId },
      });
      const { decryptChildRecord } = await import("@/lib/pii-encryption");
      const decrypted = await decryptChildRecord(existing);
      const merged = {
        name: data.name ?? decrypted.name,
        grade: data.grade ?? decrypted.grade,
        className: data.className !== undefined ? data.className : decrypted.className,
        teachers: data.teachers ?? decrypted.teachers,
        additionalInfo: data.additionalInfo !== undefined ? data.additionalInfo : decrypted.additionalInfo,
      };
      const mergedPronouns = data.pronouns !== undefined ? data.pronouns : decrypted.pronouns;
      const encrypted = await encryptChildFields(merged);
      const record = await prisma.child.update({
        where: { id, userId: ctx.userId },
        data: { ...encrypted, pronouns: mergedPronouns ?? null },
      });
      return decryptChildRecord(record);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [, remaining] = await prisma.$transaction([
        prisma.child.delete({
          where: { id: input.id, userId: ctx.userId },
        }),
        prisma.child.count({
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

  previewPrompt: protectedProcedure
    .input(z.object({ childId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [childRecord, parents, ignoredActivities, priorityActivities] = await Promise.all([
        prisma.child.findFirst({
          where: { id: input.childId, userId: ctx.userId },
        }),
        prisma.parent.findMany({
          where: { userId: ctx.userId },
          select: { name: true, relationship: true },
        }),
        prisma.ignoredActivity.findMany({
          where: { userId: ctx.userId },
          select: { name: true },
        }),
        prisma.priorityActivity.findMany({
          where: { userId: ctx.userId },
          select: { name: true },
        }),
      ]);
      if (!childRecord) throw new TRPCError({ code: "NOT_FOUND", message: "Child not found" });

      const { decryptChildRecord } = await import("@/lib/pii-encryption");
      const child = await decryptChildRecord(childRecord);

      return await buildAnalysisPrompt({
        parents,
        children: [child],
        priorityActivities: priorityActivities.map((a) => a.name),
        ignoredActivities: ignoredActivities.map((a) => a.name),
        email: {
          from: "school@example.com",
          subject: "(sample email subject)",
          body: "(sample email body — this is a placeholder to preview the prompt structure)",
        },
      });
    }),

  reorder: protectedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      await prisma.$transaction(
        input.ids.map((id, index) =>
          prisma.child.update({
            where: { id, userId: ctx.userId },
            data: { displayOrder: index },
          })
        )
      );
      return { success: true };
    }),
});
