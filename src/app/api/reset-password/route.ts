import { NextResponse } from "next/server";
import { z } from "zod";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";
import logger from "@/lib/logger";

const TAG = "reset-password";

const limiter = createRateLimiter("reset-password", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
});

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(12, "Password must be at least 12 characters").max(128, "Password must be at most 128 characters"),
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
      { error: parsed.error.errors[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const { token, password } = parsed.data;

  try {
    const { consumeVerificationToken } = await import("@/lib/verification-token");
    const result = await consumeVerificationToken(token);

    if (!result || !result.identifier.startsWith("pwd:")) {
      return NextResponse.json(
        { error: "This reset link is invalid or has expired. Please request a new one." },
        { status: 400 }
      );
    }

    const userId = result.identifier.slice("pwd:".length);

    const bcrypt = await import("bcryptjs");
    const passwordHash = await bcrypt.hash(password, 12);

    const { prisma } = await import("@/server/db/prisma");
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    logger.info(TAG, `Password reset successfully for user ${userId}`);

    return NextResponse.json({
      message: "Your password has been reset. You can now sign in.",
    });
  } catch (err) {
    logger.error(TAG, `Error resetting password: ${err}`);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
