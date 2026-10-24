/**
 * Shared logic for simulating a re-auth backfill.
 * Used by both the admin router (for any user) and the email router (for own user).
 */
import { prisma } from "@/server/db/prisma";

/** Delay before the backfill job starts (ms) */
const REAUTH_BACKFILL_DELAY_MS = 2000;

export async function queueSimulatedReauthBackfill(
  userId: string,
  gapDays: number,
): Promise<{ connectionId: string }> {
  const connection = await prisma.emailConnection.findUnique({
    where: { userId },
    select: { id: true, status: true },
  });
  if (!connection) throw new Error("No email connection found for this user.");
  if (connection.status !== "ACTIVE") throw new Error("Connection is not active.");

  // Backdate lastPolledAt to simulate a gap, then queue a re-auth backfill
  await prisma.emailConnection.update({
    where: { id: connection.id },
    data: {
      lastPolledAt: new Date(Date.now() - gapDays * 24 * 60 * 60 * 1000),
    },
  });

  const { emailQueue } = await import("@/worker/queue");
  await emailQueue.add("backfill-user-emails", {
    userId,
    connectionId: connection.id,
    isBackfill: true,
    isReauth: true,
  }, { delay: REAUTH_BACKFILL_DELAY_MS });

  return { connectionId: connection.id };
}
