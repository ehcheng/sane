import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/server/db/prisma";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";
import logger from "@/lib/logger";
import { errorMessage } from "@/lib/error-message";

const limiter = createRateLimiter("check-access-code", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
});

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function POST(request: Request) {
  const { allowed, retryAfterMs } = limiter.check(getClientIp(request));
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
      }
    );
  }

  try {
    const body = await request.json();
    const code = typeof body.code === "string" ? body.code.trim() : "";

    if (!code) {
      return NextResponse.json({ valid: false });
    }

    const config = await prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { signupCodeEnabled: true, signupCode: true },
    });

    if (!config?.signupCodeEnabled) {
      // Gating not enabled — any code is "valid"
      return NextResponse.json({ valid: true });
    }

    const valid = timingSafeCompare(config.signupCode ?? "", code);
    return NextResponse.json({ valid });
  } catch (error) {
    logger.error("check-access-code", "Access code check failed", {
      error: errorMessage(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
