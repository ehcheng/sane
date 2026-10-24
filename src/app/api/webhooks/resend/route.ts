export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/server/db/prisma";
import logger from "@/lib/logger";

const TAG = "resend-webhook";

const EVENT_STATUS_MAP: Record<string, string> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivery_delayed": "delayed",
  "email.opened": "opened",
};

async function getWebhookConfig(): Promise<{ secret: string | null; enabled: boolean }> {
  const config = await prisma.systemConfig.findUnique({
    where: { id: "singleton" },
    select: { resendWebhookSecret: true, resendWebhookEnabled: true },
  });
  return {
    secret: config?.resendWebhookSecret ?? null,
    enabled: config?.resendWebhookEnabled ?? true,
  };
}

/**
 * Verify Resend webhook signature using Svix format.
 * Resend signs webhooks as: HMAC-SHA256(secret, "${svix_id}.${svix_timestamp}.${body}")
 * The secret is stored as "whsec_<base64key>" — strip the prefix and base64-decode.
 * The svix-signature header contains space-delimited "v1,<base64sig>" entries.
 */
function verifySvixSignature(
  body: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string
): boolean {
  // Strip "whsec_" prefix if present, then base64-decode the key
  const secretBytes = Buffer.from(
    secret.startsWith("whsec_") ? secret.slice(6) : secret,
    "base64"
  );

  // Signed content: "${svix_id}.${svix_timestamp}.${body}"
  const signedContent = `${svixId}.${svixTimestamp}.${body}`;
  const expected = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");

  // svix-signature can contain multiple signatures, e.g. "v1,abc123 v1,def456"
  const signatures = svixSignature.split(" ");
  for (const sig of signatures) {
    const [version, value] = sig.split(",", 2);
    if (version !== "v1" || !value) continue;

    if (expected.length !== value.length) continue;
    if (
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(value))
    ) {
      return true;
    }
  }

  return false;
}

/** Reject timestamps older than 5 minutes to prevent replay attacks */
const TIMESTAMP_TOLERANCE_S = 300;

export async function POST(request: NextRequest) {
  const { secret, enabled } = await getWebhookConfig();

  if (!enabled) {
    return NextResponse.json({ received: true, disabled: true });
  }

  // Read raw body for signature verification
  const rawBody = await request.text();

  // Verify webhook signature
  if (!secret) {
    logger.warn(TAG, "Webhook secret not configured — rejecting request. Set it in Admin > Settings.");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const svixId = request.headers.get("svix-id") ?? "";
  const svixTimestamp = request.headers.get("svix-timestamp") ?? "";
  const svixSignature = request.headers.get("svix-signature") ?? "";

  if (!svixId || !svixTimestamp || !svixSignature) {
    logger.warn(TAG, "Missing svix headers");
    return NextResponse.json({ error: "Missing signature headers" }, { status: 401 });
  }

  // Reject stale timestamps
  const ts = parseInt(svixTimestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(ts) || Math.abs(now - ts) > TIMESTAMP_TOLERANCE_S) {
    logger.warn(TAG, "Webhook timestamp too old or invalid", { svixTimestamp });
    return NextResponse.json({ error: "Invalid timestamp" }, { status: 401 });
  }

  if (!verifySvixSignature(rawBody, svixId, svixTimestamp, svixSignature, secret)) {
    logger.warn(TAG, "Invalid webhook signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { type: string; data: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    logger.warn(TAG, "Malformed webhook payload");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const deliveryStatus = EVENT_STATUS_MAP[event.type];
  if (!deliveryStatus) {
    // Unrecognized event type — acknowledge without processing
    logger.debug(TAG, `Ignoring event type: ${event.type}`);
    return NextResponse.json({ received: true });
  }

  const emailId = event.data?.email_id as string | undefined;
  if (!emailId) {
    logger.warn(TAG, "Webhook missing email_id", { type: event.type });
    return NextResponse.json({ error: "Missing email_id" }, { status: 400 });
  }

  // Update ProcessedEmail by resendMessageId
  const updateData: Record<string, unknown> = {
    deliveryStatus,
    deliveryUpdatedAt: new Date(),
  };

  // Capture bounce/complaint reason if available
  if (deliveryStatus === "bounced" || deliveryStatus === "complained") {
    const bounce = event.data?.bounce as Record<string, unknown> | undefined;
    const complaint = event.data?.complaint as Record<string, unknown> | undefined;
    const reason =
      (bounce?.message as string) ??
      (complaint?.message as string) ??
      (event.data?.reason as string) ??
      null;
    if (reason) {
      updateData.deliveryError = String(reason).slice(0, 500);
    }
  }

  try {
    // Run both updates in parallel
    const [result, briefResult] = await Promise.all([
      prisma.processedEmail.updateMany({
        where: { resendMessageId: emailId },
        data: updateData,
      }),
      prisma.briefDelivery.updateMany({
        where: { resendMessageId: emailId },
        data: {
          deliveryStatus,
          deliveryUpdatedAt: new Date(),
        },
      }),
    ]);

    if (deliveryStatus === "bounced" || deliveryStatus === "complained") {
      logger.warn(TAG, `Email ${deliveryStatus}: ${updateData.deliveryError ?? "no reason"}`, {
        emailId,
        deliveryStatus,
        deliveryError: updateData.deliveryError,
        updated: result.count,
        briefUpdated: briefResult.count,
      });
    } else {
      logger.info(TAG, `Processed ${event.type}`, {
        emailId,
        deliveryStatus,
        updated: result.count,
        briefUpdated: briefResult.count,
      });
    }

    // Track activity on delivery/open events (fire-and-forget).
    if (
      result.count > 0 &&
      (deliveryStatus === "delivered" || deliveryStatus === "opened")
    ) {
      // Resolve userId in the background to avoid blocking the webhook response
      prisma.processedEmail
        .findFirst({
          where: { resendMessageId: emailId },
          select: { userId: true },
        })
        .then((pe) => {
          if (pe?.userId) {
            return prisma.user.update({
              where: { id: pe.userId },
              data: { lastActiveAt: new Date() },
            });
          }
        })
        .catch(() => {});
    }
  } catch (err) {
    logger.error(TAG, `DB update failed for ${emailId}: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "DB update failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
