import { NextRequest, NextResponse } from "next/server";
import { verifyFeedbackToken } from "@/lib/feedback-token";
import { prisma } from "@/server/db/prisma";
import { feedbackValueSchema } from "@/lib/validators";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter("feedback", {
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
    return htmlResponse("Missing feedback token.", 400);
  }

  const payload = verifyFeedbackToken(token);
  if (!payload) {
    return htmlResponse(
      "This feedback link has expired or is invalid. You can still provide feedback from your dashboard.",
      400
    );
  }

  // Validate feedback value
  const parsed = feedbackValueSchema.safeParse(payload.feedback);
  if (!parsed.success) {
    return htmlResponse("Invalid feedback value.", 400);
  }

  try {
    // Verify the email exists and belongs to the user
    const email = await prisma.processedEmail.findUnique({
      where: { id: payload.emailId, userId: payload.userId },
      select: { id: true, userFeedback: true },
    });

    if (!email) {
      return htmlResponse("Email not found.", 404);
    }

    // Idempotent: skip update if feedback is already set to this value
    if (email.userFeedback !== parsed.data) {
      await prisma.processedEmail.update({
        where: { id: payload.emailId },
        data: {
          userFeedback: parsed.data,
          userFeedbackAt: new Date(),
        },
      });
    }
  } catch {
    return htmlResponse("Something went wrong. Please try again later.", 500);
  }

  const message =
    parsed.data === "correct"
      ? "Thanks! We're glad this was helpful."
      : "Thanks for letting us know. We'll use your feedback to improve.";

  return htmlResponse(message, 200);
}

function htmlResponse(message: string, status: number): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Feedback — SANE</title>
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
    p { font-size: 14px; color: #6b7280; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${status === 200 ? "Feedback Received" : "Error"}</h1>
    <p>${escapeHtml(message)}</p>
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
