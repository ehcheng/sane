export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";
import logger from "@/lib/logger";

const TAG = "contact-form";

const limiter = createRateLimiter("contact-form", {
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
});

const schema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  message: z.string().min(1).max(5000),
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
      { error: "Please fill in all fields correctly." },
      { status: 400 }
    );
  }

  try {
    const { sendContactFormEmail } = await import("@/server/email/sender");
    await sendContactFormEmail(parsed.data);
    logger.info(TAG, `Contact form submitted by ${parsed.data.email}`);
  } catch (err) {
    logger.error(TAG, `Error sending contact form email: ${err}`);
  }

  // Always return success to avoid leaking whether the email was sent
  return NextResponse.json({ success: true });
}
