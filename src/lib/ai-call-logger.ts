/**
 * AI Call Logger: records every AI provider transaction for audit, analysis, and debugging.
 * Prompt and response content is encrypted at rest (AES-256-GCM) since it contains PII.
 * Metadata fields remain plaintext for queryability.
 */
import { prisma } from "@/server/db/prisma";
import type { Prisma } from "@prisma/client";
import logger from "@/lib/logger";

const TAG = "ai-call-logger";

/**
 * Strip raw email/attachment content from a prompt before logging.
 * Replaces <untrusted_email>...</untrusted_email> blocks with placeholders
 * using the provided refs (positionally matched).
 * Replaces <untrusted_attachment>...</untrusted_attachment> blocks with [ATTACHMENT_CONTENT].
 */
export function stripEmailContent(prompt: string, refs: string[] = []): string {
  let refIdx = 0;
  let result = prompt.replace(
    /<untrusted_email>[\s\S]*?<\/untrusted_email>/g,
    () => {
      const ref = refs[refIdx] ?? "unknown";
      refIdx++;
      return `[EMAIL_CONTENT: ${ref}]`;
    },
  );
  result = result.replace(
    /<untrusted_attachment>[\s\S]*?<\/untrusted_attachment>/g,
    "[ATTACHMENT_CONTENT]",
  );
  return result;
}

export type AICallAction =
  | "email-analysis"
  | "event-dedup"
  | "event-merge"
  | "daily-brief-summary"
  | "weekly-brief-summary"
  | "daily-diagnostics";

export interface AICallLogEntry {
  userId: string | null;
  action: AICallAction;
  provider: string;
  model: string;
  success: boolean;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  prompt: string;
  response: string | null;
  errorType?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Log an AI call to the database. Best-effort: never throws, never blocks the caller.
 * Encryption is done inline using dynamic import to avoid top-level crypto in Next.js bundle.
 */
export function logAICall(entry: AICallLogEntry): void {
  // Fire-and-forget: don't await, don't block the caller
  writeLog(entry).catch((err) => {
    logger.error(TAG, `Failed to write AI call log: ${err instanceof Error ? err.message : String(err)}`);
  });
}

async function writeLog(entry: AICallLogEntry): Promise<void> {
  const { encrypt } = await import("@/lib/encryption");

  const promptEncrypted = encrypt(entry.prompt);
  const responseEncrypted = entry.response != null ? encrypt(entry.response) : null;

  await prisma.aICallLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      provider: entry.provider,
      model: entry.model,
      success: entry.success,
      durationMs: entry.durationMs,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      errorType: entry.errorType ?? null,
      errorMessage: entry.errorMessage ?? null,
      promptEncrypted,
      responseEncrypted,
      metadata: entry.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
