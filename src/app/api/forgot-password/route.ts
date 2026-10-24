import { NextResponse } from "next/server";
import { z } from "zod";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";
import logger from "@/lib/logger";

const TAG = "forgot-password";

const limiter = createRateLimiter("forgot-password", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 3,
});

const schema = z.object({
  email: z.string().email(),
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const { allowed, retryAfterMs } = limiter.check(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
      }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { message: "If an account exists with that email, we've sent a reset link." },
      { status: 200 }
    );
  }

  const { email } = parsed.data;

  try {
    // Dynamic imports to avoid bundling Node.js built-ins in the server bundle
    const { prisma } = await import("@/server/db/prisma");

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, email: true, passwordHash: true },
    });

    // Only proceed for users with a password (skip OAuth-only accounts)
    if (user?.passwordHash) {
      const { createVerificationToken } = await import("@/lib/verification-token");
      const token = await createVerificationToken(`pwd:${user.id}`);

      const { sendVerificationEmail } = await import("@/server/email/sender");
      await sendVerificationEmail({
        to: user.email!,
        type: "password-reset",
        token,
      });

      logger.info(TAG, `Password reset email sent for user ${user.id}`);
    } else {
      logger.debug(TAG, `No eligible account found for ${email}`);
    }
  } catch (err) {
    logger.error(TAG, `Error processing forgot-password: ${err}`);
  }

  // Always return same response regardless of email existence
  return NextResponse.json({
    message: "If an account exists with that email, we've sent a reset link.",
  });
}
