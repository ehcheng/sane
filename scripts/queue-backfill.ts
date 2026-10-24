import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const prisma = new PrismaClient();
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const emailQueue = new Queue("email-processing", { connection });

async function main() {
  const targetEmail = process.argv[2];
  if (!targetEmail) {
    console.error("Usage: npx tsx scripts/queue-backfill.ts <email>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email: targetEmail },
    select: { id: true, email: true },
  });
  if (!user) {
    console.log("User not found:", targetEmail);
    process.exit(1);
  }

  const conn = await prisma.emailConnection.findUnique({
    where: { userId: user.id },
    select: { id: true, status: true, emailAddress: true },
  });
  if (!conn) {
    console.log("No Gmail connection for user");
    process.exit(1);
  }
  if (conn.status !== "ACTIVE") {
    console.log("Gmail connection not active:", conn.status);
    process.exit(1);
  }

  console.log(`User: ${user.email} (${user.id})`);
  console.log(`Email: ${conn.emailAddress} (${conn.id})`);

  const job = await emailQueue.add("backfill-user-emails", {
    userId: user.id,
    connectionId: conn.id,
    isBackfill: true,
  });
  console.log("Backfill job queued:", job.id);

  await emailQueue.close();
  await connection.quit();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
