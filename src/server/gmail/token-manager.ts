import { google } from "googleapis";
import { encrypt, decrypt } from "@/lib/encryption";
import { prisma } from "@/server/db/prisma";
import logger from "@/lib/logger";
import { errorMessage } from "@/lib/error-message";

const TAG = "token-manager";

// ---------------------------------------------------------------------------
// Token encryption / decryption
// ---------------------------------------------------------------------------

export function encryptTokens(
  accessToken: string,
  refreshToken: string
): { accessTokenEncrypted: Buffer; refreshTokenEncrypted: Buffer } {
  return {
    accessTokenEncrypted: encrypt(accessToken),
    refreshTokenEncrypted: encrypt(refreshToken),
  };
}

export function decryptTokens(connection: {
  accessTokenEncrypted: Buffer;
  refreshTokenEncrypted: Buffer;
}): { accessToken: string; refreshToken: string } {
  return {
    accessToken: decrypt(connection.accessTokenEncrypted),
    refreshToken: decrypt(connection.refreshTokenEncrypted),
  };
}

// ---------------------------------------------------------------------------
// OAuth2 client helper
// ---------------------------------------------------------------------------

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
}

// ---------------------------------------------------------------------------
// Token revocation
// ---------------------------------------------------------------------------

/**
 * Revokes a Google OAuth token so it can no longer be used.
 * Best-effort: logs a warning on failure but does not throw,
 * since the local token is being deleted regardless.
 */
export async function revokeGoogleToken(token: string): Promise<void> {
  const oauth2 = getOAuth2Client();
  try {
    await oauth2.revokeToken(token);
    logger.info(TAG, "Google OAuth token revoked successfully");
  } catch (err) {
    logger.warn(TAG, `Failed to revoke Google OAuth token (best-effort): ${errorMessage(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/**
 * Uses the Google OAuth2 client to exchange a refresh token for a new
 * access token. Returns the new access token and its expiration time.
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await oauth2.refreshAccessToken();

  if (!credentials.access_token) {
    throw new Error("Failed to obtain new access token from Google");
  }

  const expiresAt = credentials.expiry_date
    ? new Date(credentials.expiry_date)
    : new Date(Date.now() + 3600 * 1000); // default 1 hour

  return {
    accessToken: credentials.access_token,
    expiresAt,
  };
}

// ---------------------------------------------------------------------------
// High-level accessor
// ---------------------------------------------------------------------------

/**
 * Returns a valid access token for the given EmailConnection.
 *
 * - If the token has not expired, decrypts and returns it directly.
 * - If the token has expired, refreshes it, persists the new encrypted
 *   token and expiry to the database, and returns the new token.
 * - If the refresh fails (e.g., revoked consent), marks the connection
 *   as NEEDS_REAUTH and throws.
 */
export async function getValidAccessToken(
  connectionId: string
): Promise<string> {
  const connection = await prisma.emailConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });

  let accessToken: string;
  let refreshToken: string;
  try {
    ({ accessToken, refreshToken } = decryptTokens(connection));
  } catch (err) {
    // Decryption failure (e.g. rotated ENCRYPTION_KEY) — mark as NEEDS_REAUTH
    await prisma.emailConnection.update({
      where: { id: connectionId },
      data: { status: "NEEDS_REAUTH" },
    });
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(TAG, `Token decryption failed for connection=${connectionId}, marked NEEDS_REAUTH: ${msg}`);
    throw new Error(`Token decryption failed for connection ${connectionId}. Marked NEEDS_REAUTH.`);
  }

  // Add a 60-second buffer so we don't use a token that's about to expire
  const isExpired =
    connection.tokenExpiresAt.getTime() < Date.now() + 60 * 1000;

  logger.debug(
    TAG,
    `Token check for connection=${connectionId}: expired=${isExpired}, expiresAt=${connection.tokenExpiresAt.toISOString()}`
  );

  if (!isExpired) {
    return accessToken;
  }

  // Token is expired -- attempt refresh
  logger.debug(TAG, `Refreshing token for connection=${connectionId}`);
  try {
    const refreshed = await refreshAccessToken(refreshToken);
    const encrypted = encryptTokens(refreshed.accessToken, refreshToken);

    await prisma.emailConnection.update({
      where: { id: connectionId },
      data: {
        accessTokenEncrypted: encrypted.accessTokenEncrypted,
        tokenExpiresAt: refreshed.expiresAt,
      },
    });

    logger.debug(
      TAG,
      `Token refreshed for connection=${connectionId}, new expiresAt=${refreshed.expiresAt.toISOString()}`
    );
    return refreshed.accessToken;
  } catch (error) {
    // Refresh failed -- mark connection so the user knows to re-auth
    await prisma.emailConnection.update({
      where: { id: connectionId },
      data: { status: "NEEDS_REAUTH" },
    });

    const errorMsg = errorMessage(error);
    logger.error(
      TAG,
      `Token refresh failed for connection=${connectionId}. Marked NEEDS_REAUTH. Error: ${errorMsg}`
    );

    // Send reauth notification email + pause monitoring (once per reauth event)
    if (!connection.reauthNotifiedAt) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: connection.userId },
          select: { email: true },
        });

        if (user?.email) {
          // Pause monitoring and record notification timestamp atomically
          await Promise.all([
            prisma.user.update({
              where: { id: connection.userId },
              data: { isMonitoringEnabled: false },
            }),
            prisma.emailConnection.update({
              where: { id: connectionId },
              data: { reauthNotifiedAt: new Date() },
            }),
          ]);

          const { sendReauthEmail } = await import("@/server/email/sender");
          await sendReauthEmail({
            to: user.email,
            emailAddress: connection.emailAddress,
          });

          logger.info(
            TAG,
            `Sent reauth notification to ${user.email} for connection=${connectionId}, monitoring paused`
          );
        }
      } catch (notifyError) {
        // Notification failure must not break the token flow
        logger.error(
          TAG,
          `Failed to send reauth notification for connection=${connectionId}: ${notifyError instanceof Error ? notifyError.message : String(notifyError)}`
        );
      }
    }

    throw new Error(
      `Gmail token refresh failed for connection ${connectionId}. ` +
        `Connection marked as NEEDS_REAUTH. ` +
        `Original error: ${errorMessage(error)}`
    );
  }
}
