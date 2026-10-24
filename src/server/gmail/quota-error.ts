/**
 * Gmail API quota-related error classes.
 * Thrown by the retry wrapper in client.ts, caught in process-user-emails.ts.
 */

/** 429 — per-second rate limit, retries exhausted. Re-throw for BullMQ backoff. */
export class GmailRateLimitError extends Error {
  constructor(
    public readonly userId: string,
    public readonly retryAfterMs?: number,
  ) {
    super(`Gmail rate limit (429) for user ${userId}, retries exhausted`);
    this.name = "GmailRateLimitError";
  }
}

/** 403 rateLimitExceeded — daily quota gone. Pause user until tomorrow. */
export class GmailQuotaExhaustedError extends Error {
  constructor(public readonly userId: string) {
    super(`Gmail daily quota exhausted for user ${userId}`);
    this.name = "GmailQuotaExhaustedError";
  }
}
