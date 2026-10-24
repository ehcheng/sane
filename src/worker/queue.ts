import { Queue } from "bullmq";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  throw new Error("REDIS_URL environment variable is required");
}

const parsedUrl = new URL(REDIS_URL);
export const connection = new IORedis({
  host: parsedUrl.hostname,
  port: parseInt(parsedUrl.port) || 6379,
  username: parsedUrl.username || undefined,
  password: parsedUrl.password || undefined,
  family: 0, // dual-stack: IPv4 + IPv6 (required for Railway private networking)
  maxRetriesPerRequest: null, // Required by BullMQ
});

export const emailQueue = new Queue("email-processing", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 604800, count: 5000 },
  },
});
