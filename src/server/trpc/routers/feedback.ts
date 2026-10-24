import { router, protectedProcedure } from "../trpc";
import { prisma } from "@/server/db/prisma";
import { submitUserFeedbackSchema, FEEDBACK_CATEGORIES } from "@/lib/validators";
import logger from "@/lib/logger";

const TAG = "feedback-router";

// Read version at module load (server-side only)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const appVersion: string = require("../../../../package.json").version;

export const feedbackRouter = router({
  submit: protectedProcedure
    .input(submitUserFeedbackSchema)
    .mutation(async ({ ctx, input }) => {
      const record = await prisma.userFeedback.create({
        data: {
          userId: ctx.userId,
          category: input.category,
          subject: input.subject,
          message: input.message,
          page: input.page ?? null,
          appVersion,
        },
      });

      // Fetch user info for the email notification
      const user = await prisma.user.findUnique({
        where: { id: ctx.userId },
        select: { name: true, email: true },
      });

      // Send email to admin (best-effort, don't fail the mutation)
      try {
        const { sendFeedbackNotification } = await import(
          "@/server/email/sender"
        );
        const categoryLabel =
          FEEDBACK_CATEGORIES.find((c) => c.value === input.category)?.label ??
          input.category;
        await sendFeedbackNotification({
          userName: user?.name ?? "Unknown",
          userEmail: user?.email ?? "unknown",
          category: categoryLabel,
          subject: input.subject,
          message: input.message,
          page: input.page ?? null,
          appVersion,
        });
      } catch (err) {
        logger.error(TAG, "Failed to send feedback notification email", {
          error: err instanceof Error ? err.message : String(err),
          feedbackId: record.id,
        });
      }

      return { success: true, id: record.id };
    }),
});
