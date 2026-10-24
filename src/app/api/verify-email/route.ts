import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import logger from "@/lib/logger";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/error-message";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter("verify-email", {
  windowMs: 60 * 1000,
  maxRequests: 30,
});

/**
 * GET /api/verify-email?token=<token>
 *
 * Consumes a verification token and updates the appropriate record:
 * - identifier "email:<userId>" → sets User.emailVerified
 * - identifier "fwd:<forwardingAddressId>" → sets ForwardingAddress.verifiedAt + isActive
 *
 * Redirects to a page with success/error status.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const { allowed, retryAfterMs } = limiter.check(ip);
  if (!allowed) {
    return new NextResponse("Too many requests. Please try again later.", {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
    });
  }

  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return redirectWithStatus(request, "error", "Missing verification token.");
  }

  try {
    // Dynamic import to avoid top-level crypto in Next.js bundle
    const { consumeVerificationToken } = await import(
      "@/lib/verification-token"
    );

    const result = await consumeVerificationToken(token);

    if (!result) {
      return redirectWithStatus(
        request,
        "error",
        "This verification link has expired or already been used."
      );
    }

    const { identifier } = result;

    if (identifier.startsWith("email:")) {
      const userId = identifier.slice("email:".length);
      const user = await prisma.user.update({
        where: { id: userId },
        data: { emailVerified: new Date() },
        select: { email: true },
      });

      // Auto-verify any forwarding addresses that match the login email
      const { hashEmail } = await import("@/lib/pii-encryption");
      const emailHash = await hashEmail(user.email);
      await prisma.forwardingAddress.updateMany({
        where: { userId, emailHash, verifiedAt: null },
        data: { verifiedAt: new Date(), isActive: true },
      });

      return redirectWithStatus(
        request,
        "success",
        "Your email has been verified."
      );
    }

    if (identifier.startsWith("email-change:")) {
      const userId = identifier.slice("email-change:".length);
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { pendingEmail: true },
      });
      if (!user?.pendingEmail) {
        return redirectWithStatus(request, "error", "No pending email change found.");
      }
      try {
        await prisma.user.update({
          where: { id: userId },
          data: { email: user.pendingEmail, pendingEmail: null, emailVerified: new Date() },
        });
      } catch (error: unknown) {
        if (error instanceof Error && "code" in error && (error as { code: string }).code === "P2002") {
          await prisma.user.update({ where: { id: userId }, data: { pendingEmail: null } });
          return redirectWithStatus(request, "error", "This email address is already in use.");
        }
        throw error;
      }
      return redirectWithStatus(request, "success", "Your email address has been updated.");
    }

    if (identifier.startsWith("fwd:")) {
      // Format: "fwd:<userId>:<addressId>" (new) or "fwd:<addressId>" (legacy).
      // TODO: Remove legacy single-segment format after 2026-06-01 (tokens expire in 24h,
      // so any legacy tokens will have expired well before then).
      const parts = identifier.slice("fwd:".length).split(":");
      const addressId = parts.length >= 2 ? parts[1] : parts[0];
      const ownerUserId = parts.length >= 2 ? parts[0] : null;

      // Verify ownership: the forwarding address must belong to the token's userId
      const whereClause = ownerUserId
        ? { id: addressId, userId: ownerUserId }
        : { id: addressId };

      const updated = await prisma.forwardingAddress.updateMany({
        where: whereClause,
        data: { verifiedAt: new Date(), isActive: true },
      });

      if (updated.count === 0) {
        return redirectWithStatus(
          request,
          "error",
          "Forwarding address not found or does not belong to this account."
        );
      }

      return redirectWithStatus(
        request,
        "success",
        "Your forwarding address has been verified and activated."
      );
    }

    return redirectWithStatus(
      request,
      "error",
      "Unknown verification type."
    );
  } catch (error) {
    logger.error("verify-email", "Verification failed", {
      error: errorMessage(error),
    });
    return redirectWithStatus(
      request,
      "error",
      "Something went wrong. Please try again."
    );
  }
}

async function redirectWithStatus(
  _request: NextRequest,
  status: "success" | "error",
  message: string
): Promise<NextResponse> {
  const config = await prisma.systemConfig.findUnique({
    where: { id: "singleton" },
    select: { appUrl: true },
  });
  const baseUrl = config?.appUrl || process.env.NEXTAUTH_URL || "http://localhost:3000";
  const url = new URL("/verify-result", baseUrl);
  url.searchParams.set("status", status);
  url.searchParams.set("message", message);
  return NextResponse.redirect(url);
}
