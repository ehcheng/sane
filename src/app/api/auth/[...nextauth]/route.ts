import { NextRequest, NextResponse } from "next/server";
import { handlers } from "@/server/auth";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";

const limiter = createRateLimiter("nextauth-login", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
});

export const { GET } = handlers;

export async function POST(request: NextRequest) {
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

  return handlers.POST(request);
}
