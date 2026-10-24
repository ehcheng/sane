import { NextResponse } from "next/server";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter("validate-reset-token", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
});

export async function GET(request: Request) {
  const { allowed, retryAfterMs } = limiter.check(getClientIp(request));
  if (!allowed) {
    return NextResponse.json(
      { valid: false, error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
      }
    );
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ valid: false }, { status: 400 });
  }

  const { validateVerificationToken } = await import("@/lib/verification-token");
  const result = await validateVerificationToken(token);

  if (!result || !result.identifier.startsWith("pwd:")) {
    return NextResponse.json({ valid: false }, { status: 400 });
  }

  return NextResponse.json({ valid: true });
}
