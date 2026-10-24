import { NextRequest, NextResponse } from "next/server";
import { verifySenderRuleToken } from "@/lib/sender-rule-token";
import { prisma } from "@/server/db/prisma";
import { FIELD_LIMITS } from "@/lib/validators";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter("sender-rule", {
  windowMs: 60 * 1000,
  maxRequests: 30,
});

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const { allowed, retryAfterMs } = limiter.check(ip);
  if (!allowed) {
    return htmlResponse("Too many requests. Please try again later.", 429);
  }

  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return htmlResponse("Missing token.", 400);
  }

  const payload = verifySenderRuleToken(token);
  if (!payload) {
    return htmlResponse(
      "This link has expired or is invalid. You can manage sender rules from your dashboard.",
      400
    );
  }

  try {
    // Verify the email exists and belongs to the user
    const email = await prisma.processedEmail.findUnique({
      where: { id: payload.emailId, userId: payload.userId },
      select: { id: true },
    });

    if (!email) {
      return htmlResponse("Email not found.", 404);
    }

    // Check sender rule limit
    const count = await prisma.senderRule.count({
      where: { userId: payload.userId },
    });
    if (count >= FIELD_LIMITS.senderRulesCount) {
      return htmlResponse(
        `You've reached the maximum of ${FIELD_LIMITS.senderRulesCount} sender rules. Remove a rule from your dashboard to add new ones.`,
        400
      );
    }

    // Upsert the sender rule
    await prisma.senderRule.upsert({
      where: {
        userId_senderEmail: {
          userId: payload.userId,
          senderEmail: payload.senderEmail.toLowerCase(),
        },
      },
      create: {
        userId: payload.userId,
        senderEmail: payload.senderEmail.toLowerCase(),
        action: payload.action,
      },
      update: {
        action: payload.action,
      },
    });

    const actionLabel =
      payload.action === "ALWAYS_FORWARD"
        ? "always forwarded"
        : "blocked";

    return htmlResponse(
      `Done! Emails from <strong>${escapeHtml(payload.senderEmail)}</strong> will now be ${actionLabel}. You can change this anytime from your dashboard.`,
      200
    );
  } catch {
    return htmlResponse("Something went wrong. Please try again later.", 500);
  }
}

function htmlResponse(message: string, status: number): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sender Rule — SANE</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0;
      background: #fafafa; color: #1a1a2e;
    }
    .card {
      background: white; border-radius: 12px; padding: 32px 40px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1); max-width: 400px;
      text-align: center;
    }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { font-size: 14px; color: #6b7280; margin: 0; line-height: 1.5; }
    p strong { color: #1a1a2e; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${status === 200 ? "Sender Rule Created" : "Error"}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
