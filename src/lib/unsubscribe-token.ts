import { signToken, verifyToken } from "./hmac-token";

interface UnsubscribePayload {
  userId: string;
}

const PURPOSE = "unsubscribe";

export function createUnsubscribeToken(userId: string): string {
  return signToken<UnsubscribePayload>({ userId }, undefined, PURPOSE);
}

export function verifyUnsubscribeToken(
  token: string
): (UnsubscribePayload & { exp: number }) | null {
  return verifyToken<UnsubscribePayload>(token, PURPOSE);
}
