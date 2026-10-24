import crypto from "crypto";

const DEFAULT_EXPIRY_DAYS = 30;

function getSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for signed tokens");
  return secret;
}

/**
 * Creates an HMAC-signed, base64url-encoded token from the given payload.
 * Automatically adds an `exp` timestamp.
 *
 * The optional `purpose` prefix is prepended to the HMAC input so tokens
 * signed for different purposes cannot be cross-verified even though they
 * share the same signing key.
 */
export function signToken<T extends object>(
  payload: T,
  expiryDays = DEFAULT_EXPIRY_DAYS,
  purpose?: string
): string {
  const withExp = { ...payload, exp: Date.now() + expiryDays * 24 * 60 * 60 * 1000 };
  const payloadStr = JSON.stringify(withExp);

  const hmacInput = purpose ? `${purpose}:${payloadStr}` : payloadStr;
  const signature = crypto
    .createHmac("sha256", getSecret())
    .update(hmacInput)
    .digest("hex");

  return Buffer.from(
    JSON.stringify({ payload: payloadStr, signature, ...(purpose ? { purpose } : {}) })
  ).toString("base64url");
}

/**
 * Verifies and decodes an HMAC-signed token.
 * Returns the payload if valid, or null if invalid/expired/tampered.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyToken<T>(token: string, expectedPurpose?: string): (T & { exp: number }) | null {
  try {
    const decoded = JSON.parse(
      Buffer.from(token, "base64url").toString("utf8")
    );
    const { payload: payloadStr, signature, purpose } = decoded;
    if (!payloadStr || !signature) return null;

    const hmacInput = purpose ? `${purpose}:${payloadStr}` : payloadStr;
    const expected = crypto
      .createHmac("sha256", getSecret())
      .update(hmacInput)
      .digest("hex");

    if (
      expected.length !== signature.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    ) {
      return null;
    }

    // Reject if caller expects a specific purpose and the token doesn't match
    if (expectedPurpose && purpose !== expectedPurpose) return null;

    const payload = JSON.parse(payloadStr);
    if (Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}
