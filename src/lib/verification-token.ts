import crypto from "crypto";
import { prisma } from "@/server/db/prisma";

const TOKEN_EXPIRY_HOURS = 1;

/**
 * Create a verification token for the given identifier.
 * Any existing token for the same identifier is deleted first (invalidates old links).
 */
export async function createVerificationToken(
  identifier: string
): Promise<string> {
  await prisma.verificationToken.deleteMany({ where: { identifier } });

  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  await prisma.verificationToken.create({
    data: { identifier, token, expires },
  });

  return token;
}

/**
 * Validate a verification token without consuming it.
 * Returns the identifier if valid, null if expired or not found.
 * Cleans up expired tokens if encountered.
 */
export async function validateVerificationToken(
  token: string
): Promise<{ identifier: string } | null> {
  const record = await prisma.verificationToken.findUnique({
    where: { token },
  });

  if (!record || record.expires < new Date()) {
    if (record) {
      await prisma.verificationToken.delete({ where: { token } });
    }
    return null;
  }

  return { identifier: record.identifier };
}

/**
 * Consume a verification token (single-use).
 * Returns the identifier if valid, null if expired or not found.
 */
export async function consumeVerificationToken(
  token: string
): Promise<{ identifier: string } | null> {
  const record = await prisma.verificationToken.findUnique({
    where: { token },
  });

  if (!record || record.expires < new Date()) {
    if (record) {
      await prisma.verificationToken.delete({ where: { token } });
    }
    return null;
  }

  await prisma.verificationToken.delete({ where: { token } });
  return { identifier: record.identifier };
}
