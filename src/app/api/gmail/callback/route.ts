import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { google } from "googleapis";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";
import { encryptTokens } from "@/server/email-providers/token-manager";
import { getGmailClient, getProfile } from "@/server/gmail/client";
import { sanitizeReturnTo } from "@/lib/url-validation";
import logger from "@/lib/logger";

/** Build a redirect URL appending query params to a returnTo path. */
function buildRedirect(baseUrl: string, returnTo: string, params: Record<string, string>): string {
  const sep = returnTo.includes("?") ? "&" : "?";
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `${baseUrl}${returnTo}${sep}${qs}`;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");
  // Use NEXTAUTH_URL as the canonical base URL for redirects.
  // request.nextUrl.origin reflects the local server (e.g. https://localhost:3000)
  // which may differ from the external hostname the user is browsing on.
  const baseUrl = process.env.NEXTAUTH_URL || request.nextUrl.origin;
  const fallback = "/setup?step=1";

  // Google returned an error (e.g., user denied consent)
  if (error) {
    return NextResponse.redirect(
      buildRedirect(baseUrl, fallback, { error })
    );
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(
      buildRedirect(baseUrl, fallback, { error: "Missing authorization code or state" })
    );
  }

  // Decode and verify HMAC-signed state
  let stateUserId: string;
  let returnTo = fallback;
  try {
    const outer = JSON.parse(
      Buffer.from(stateParam, "base64").toString("utf8")
    );
    const { payload, signature } = outer;
    if (!payload || !signature) {
      return NextResponse.redirect(
        buildRedirect(baseUrl, fallback, { error: "Invalid state parameter" })
      );
    }
    // Verify HMAC signature
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) throw new Error("NEXTAUTH_SECRET is required");
    const expected = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
    if (
      expected.length !== signature.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    ) {
      return NextResponse.redirect(
        buildRedirect(baseUrl, fallback, { error: "Invalid state signature" })
      );
    }
    const decoded = JSON.parse(payload);
    stateUserId = decoded.userId;
    if (decoded.returnTo) returnTo = sanitizeReturnTo(decoded.returnTo, fallback);
  } catch {
    return NextResponse.redirect(
      buildRedirect(baseUrl, fallback, { error: "Invalid state parameter" })
    );
  }

  // Verify session matches the userId from state
  const session = await auth();
  if (!session?.user?.id || session.user.id !== stateUserId) {
    return NextResponse.redirect(
      buildRedirect(baseUrl, returnTo, { error: "Session mismatch" })
    );
  }

  try {
    // Exchange authorization code for tokens
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      return NextResponse.redirect(
        buildRedirect(baseUrl, returnTo, { error: "Failed to obtain tokens from Google" })
      );
    }

    // Verify the user granted the gmail.readonly scope (granular consent
    // lets users uncheck individual permissions).
    const grantedScopes = tokens.scope?.split(" ") ?? [];
    if (!grantedScopes.includes("https://www.googleapis.com/auth/gmail.readonly")) {
      return NextResponse.redirect(
        buildRedirect(baseUrl, returnTo, {
          error: "Email read permission is required. Please reconnect and check the \"View your email\" box when Google asks.",
        })
      );
    }

    // Get the Gmail address from the user's profile
    const gmail = getGmailClient(tokens.access_token);
    const gmailAddress = await getProfile(gmail);

    if (!gmailAddress) {
      return NextResponse.redirect(
        buildRedirect(baseUrl, returnTo, { error: "Could not retrieve Gmail address" })
      );
    }

    // Encrypt tokens for storage
    const encrypted = encryptTokens(tokens.access_token, tokens.refresh_token);

    const tokenExpiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 3600 * 1000);

    // Detect re-auth: an existing connection means this is a reconnect, not first-time setup.
    // Batched with the upsert in a single transaction to avoid an extra round trip.
    const [existingConnection, upsertedConnection] = await prisma.$transaction([
      prisma.emailConnection.findUnique({
        where: { userId: session.user.id },
        select: { id: true },
      }),
      prisma.emailConnection.upsert({
        where: { userId: session.user.id },
        create: {
          userId: session.user.id,
          provider: "GMAIL",
          emailAddress: gmailAddress,
          accessTokenEncrypted: encrypted.accessTokenEncrypted,
          refreshTokenEncrypted: encrypted.refreshTokenEncrypted,
          tokenExpiresAt,
          status: "ACTIVE",
        },
        update: {
          provider: "GMAIL",
          emailAddress: gmailAddress,
          accessTokenEncrypted: encrypted.accessTokenEncrypted,
          refreshTokenEncrypted: encrypted.refreshTokenEncrypted,
          tokenExpiresAt,
          status: "ACTIVE",
          syncCursor: null,
          lastPolledAt: null,
          reauthNotifiedAt: null,
        },
        select: { id: true },
      }),
    ]);
    const isReauth = !!existingConnection;

    // Re-enable monitoring after successful reconnect
    await prisma.user.update({
      where: { id: session.user.id },
      data: { isMonitoringEnabled: true },
    });

    // Queue a backfill job to seed events from recent historical emails.
    // SHARED users defer backfill until the sender picker is completed
    // (otherwise every email gets filtered out with zero AllowedSender entries).
    try {
      const userForBackfill = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { emailAccountType: true },
      });
      if (userForBackfill?.emailAccountType !== "SHARED") {
        const { emailQueue } = await import("@/worker/queue");
        await emailQueue.add("backfill-user-emails", {
          userId: session.user.id,
          connectionId: upsertedConnection.id,
          isBackfill: true,
          isReauth: isReauth,
        }, { delay: 5000 });
        logger.info("gmail-callback", `Queued backfill job for user=${session.user.id}${isReauth ? " (re-auth)" : ""}`);
      } else {
        logger.info("gmail-callback", `Skipped backfill for SHARED user=${session.user.id} — deferred until sender picker`);
      }
    } catch (backfillErr) {
      // Non-fatal — don't block the redirect
      logger.error(
        "gmail-callback",
        `Failed to queue backfill: ${backfillErr instanceof Error ? backfillErr.message : String(backfillErr)}`
      );
    }

    return NextResponse.redirect(
      buildRedirect(baseUrl, returnTo, { success: "true" })
    );
  } catch (err) {
    logger.error("gmail-callback", "OAuth callback error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.redirect(
      buildRedirect(baseUrl, returnTo, { error: "An error occurred during Gmail connection" })
    );
  }
}
