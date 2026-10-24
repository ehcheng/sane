import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { z, ZodError } from "zod";
import { prisma } from "@/server/db/prisma";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/error-message";
import { markSetupComplete } from "@/lib/setup-check";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter("setup-admin", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
});

const setupAdminSchema = z.object({
  email: z.string().email("Invalid email address").max(320),
  password: z.string().min(12, "Password must be at least 12 characters").max(128, "Password must be at most 128 characters"),
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
    const { email, password } = setupAdminSchema.parse(body);
    const normalizedEmail = email.toLowerCase();
    const passwordHash = await hash(password, 12);

    // Atomic: check no users exist AND create admin in one transaction
    const user = await prisma.$transaction(async (tx) => {
      const count = await tx.user.count({ take: 1 });
      if (count > 0) {
        return null;
      }
      return tx.user.create({
        data: {
          name: "Admin",
          email: normalizedEmail,
          passwordHash,
          role: "ADMIN",
          wizardStep: 99,
          emailVerified: new Date(),
        },
      });
    });

    if (!user) {
      return NextResponse.json(
        { error: "An admin account already exists." },
        { status: 403 }
      );
    }

    markSetupComplete();
    logger.info("setup-admin", "First admin account created", {
      userId: user.id,
      email: user.email,
    });

    return NextResponse.json(
      { user: { id: user.id, email: user.email } },
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
    logger.error("setup-admin", "Setup admin failed", {
      error: errorMessage(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
