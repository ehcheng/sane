import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter("unsubscribe", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
});

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const { allowed } = limiter.check(ip);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ valid: false, error: "Missing token" }, { status: 400 });
  }

  // Dynamic import to avoid top-level crypto in Next.js server bundle
  const { verifyUnsubscribeToken } = await import("@/lib/unsubscribe-token");
  const payload = verifyUnsubscribeToken(token);
  if (!payload) {
    return NextResponse.json({ valid: false, error: "Invalid or expired token" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, individualForwardingEnabled: true },
  });

  if (!user) {
    return NextResponse.json({ valid: false, error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    valid: true,
    alreadyUnsubscribed: !user.individualForwardingEnabled,
  });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const { allowed } = limiter.check(ip);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  const { token } = body;
  if (!token) {
    return NextResponse.json({ success: false, error: "Missing token" }, { status: 400 });
  }

  const { verifyUnsubscribeToken } = await import("@/lib/unsubscribe-token");
  const payload = verifyUnsubscribeToken(token);
  if (!payload) {
    return NextResponse.json({ success: false, error: "Invalid or expired token" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, individualForwardingEnabled: true },
  });

  if (!user) {
    return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
  }

  // Only disable + notify if not already unsubscribed
  if (user.individualForwardingEnabled) {
    await prisma.user.update({
      where: { id: payload.userId },
      data: { individualForwardingEnabled: false },
    });

    // Notify account holder (fire-and-forget — don't block the response)
    import("@/server/email/sender").then(async ({ sendUnsubscribeNotification }) => {
      try {
        const config = await prisma.systemConfig.findUnique({
          where: { id: "singleton" },
          select: { appUrl: true },
        });
        const baseUrl = config?.appUrl || process.env.NEXTAUTH_URL || "";
        await sendUnsubscribeNotification({
          userEmail: user.email,
          settingsUrl: `${baseUrl}/settings`,
        });
      } catch (err) {
        console.error("Failed to send unsubscribe notification:", err);
      }
    }).catch(() => { /* import failure must not surface as unhandled rejection */ });
  }

  return NextResponse.json({ success: true });
}
