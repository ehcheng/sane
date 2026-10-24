import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { ZodError } from "zod";
import { prisma } from "@/server/db/prisma";
import { signUpSchema } from "@/lib/validators";
import { errorMessage } from "@/lib/error-message";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";
import logger from "@/lib/logger";

const limiter = createRateLimiter("signup", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
});

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
    const parsed = signUpSchema.parse(body);
    const name = parsed.name;
    const email = parsed.email.toLowerCase();
    const password = parsed.password;
    const accessCode = parsed.accessCode;

    // Validate access code if signup gating is enabled
    const config = await prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { signupCodeEnabled: true, signupCode: true },
    });
    if (config?.signupCodeEnabled) {
      if (!accessCode || !config.signupCode) {
        return NextResponse.json(
          { error: "Invalid or missing access code" },
          { status: 403 }
        );
      }
      const { timingSafeEqual } = await import("crypto");
      const a = Buffer.from(accessCode.trim());
      const b = Buffer.from(config.signupCode);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return NextResponse.json(
          { error: "Invalid or missing access code" },
          { status: 403 }
        );
      }
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Unable to create account. If you already have one, try signing in." },
        { status: 400 }
      );
    }

    const passwordHash = await hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
      },
    });

    // Send verification email (best-effort, don't block signup)
    try {
      const { createVerificationToken } = await import("@/lib/verification-token");
      const { sendVerificationEmail } = await import("@/server/email/sender");
      const token = await createVerificationToken(`email:${user.id}`);
      await sendVerificationEmail({ to: email, type: "signup", token });
    } catch (err) {
      logger.error("signup", "Failed to send verification email", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Check if there's a pending household invite for this email.
    // Don't auto-join: let the user decide via an interstitial.
    let hasPendingInvite = false;
    try {
      const invite = await prisma.householdInvite.findFirst({
        where: {
          email: { equals: email, mode: "insensitive" },
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      hasPendingInvite = !!invite;
    } catch {
      // Non-critical: if check fails, user goes through normal setup
    }

    return NextResponse.json(
      { user: { id: user.id, email: user.email, name: user.name }, hasPendingInvite },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ZodError) {
      const firstIssue = error.issues[0];
      return NextResponse.json(
        { error: firstIssue?.message ?? "Invalid input" },
        { status: 400 }
      );
    }
    logger.error("signup", "Signup failed", {
      error: errorMessage(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
