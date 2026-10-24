import { signToken, verifyToken } from "./hmac-token";

interface SenderRulePayload {
  emailId: string;
  userId: string;
  senderEmail: string;
  action: "ALWAYS_FORWARD" | "NEVER_FORWARD";
}

const PURPOSE = "sender-rule";

export function createSenderRuleToken(
  emailId: string,
  userId: string,
  senderEmail: string,
  action: "ALWAYS_FORWARD" | "NEVER_FORWARD"
): string {
  return signToken<SenderRulePayload>({ emailId, userId, senderEmail, action }, undefined, PURPOSE);
}

export function verifySenderRuleToken(
  token: string
): (SenderRulePayload & { exp: number }) | null {
  return verifyToken<SenderRulePayload>(token, PURPOSE);
}
