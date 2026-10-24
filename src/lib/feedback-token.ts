import { signToken, verifyToken } from "./hmac-token";

interface FeedbackPayload {
  emailId: string;
  userId: string;
  feedback: string;
}

const PURPOSE = "feedback";

export function createFeedbackToken(
  emailId: string,
  userId: string,
  feedback: string
): string {
  return signToken<FeedbackPayload>({ emailId, userId, feedback }, undefined, PURPOSE);
}

export function verifyFeedbackToken(
  token: string
): (FeedbackPayload & { exp: number }) | null {
  return verifyToken<FeedbackPayload>(token, PURPOSE);
}
