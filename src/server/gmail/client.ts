import { google, gmail_v1 } from "googleapis";
import logger from "@/lib/logger";
import { GmailRateLimitError, GmailQuotaExhaustedError } from "./quota-error";
import { recordUsage, QUOTA_COSTS } from "./quota-tracker";

const TAG = "gmail-client";

// ---------------------------------------------------------------------------
// Gmail API retry wrapper with quota tracking
// ---------------------------------------------------------------------------

type QuotaOperation = keyof typeof QUOTA_COSTS;

/**
 * Wraps a Gmail API call with:
 * - Quota unit tracking on success
 * - 429 exponential backoff (up to 3 retries)
 * - 403 rateLimitExceeded detection → GmailQuotaExhaustedError
 */
async function withGmailRetry<T>(
  userId: string | undefined,
  operation: QuotaOperation,
  fn: () => Promise<T>,
): Promise<T> {
  const maxRetries = 3;
  const baseDelayMs = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      if (userId) {
        recordUsage(userId, QUOTA_COSTS[operation]);
      }
      return result;
    } catch (error: unknown) {
      const status = getErrorStatus(error);
      const reason = getErrorReason(error);

      // 403 with rateLimitExceeded = daily quota gone
      if (status === 403 && reason === "rateLimitExceeded" && userId) {
        throw new GmailQuotaExhaustedError(userId);
      }

      // 429 = per-second rate limit — retry with backoff
      if (status === 429) {
        if (attempt >= maxRetries) {
          if (userId) {
            throw new GmailRateLimitError(userId, getRetryAfterMs(error));
          }
          throw error;
        }
        const retryAfter = getRetryAfterMs(error);
        const delay = retryAfter ?? baseDelayMs * Math.pow(2, attempt);
        logger.info(
          TAG,
          `429 rate limit on ${operation}${userId ? ` user=${userId}` : ""}, retry ${attempt + 1}/${maxRetries} in ${delay}ms`
        );
        await sleep(delay);
        continue;
      }

      // Any other error — re-throw immediately
      throw error;
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error("withGmailRetry: unexpected exit");
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null) {
    const e = error as Record<string, unknown>;
    if (typeof e.status === "number") return e.status;
    if (typeof e.code === "number") return e.code;
  }
  return undefined;
}

function getErrorReason(error: unknown): string | undefined {
  try {
    const e = error as Record<string, unknown>;
    const response = e.response as Record<string, unknown> | undefined;
    const data = response?.data as Record<string, unknown> | undefined;
    const errObj = data?.error as Record<string, unknown> | undefined;
    const errors = errObj?.errors as Array<Record<string, unknown>> | undefined;
    if (errors?.[0]?.reason && typeof errors[0].reason === "string") {
      return errors[0].reason;
    }
  } catch {
    // Duck-typing failed — no reason available
  }
  return undefined;
}

function getRetryAfterMs(error: unknown): number | undefined {
  try {
    const e = error as Record<string, unknown>;
    const response = e.response as Record<string, unknown> | undefined;
    const headers = response?.headers as Record<string, string> | undefined;
    const retryAfter = headers?.["retry-after"];
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) return seconds * 1000;
    }
  } catch {
    // No retry-after header
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GmailMessage {
  id: string;
  from: string;
  fromName: string | null;
  subject: string;
  body: string;
  bodyHtml: string | null;
  receivedAt: Date;
  attachmentParts: AttachmentPart[];
}

export interface AttachmentPart {
  mimeType: string;
  filename: string;
  sizeEstimate: number;
  /** Inline base64url data (present for small parts) */
  data?: string;
  /** Gmail attachment ID (present for large parts that need a separate fetch) */
  attachmentId?: string;
  /** Content-Disposition: "attachment" or "inline" */
  disposition: "attachment" | "inline";
}

export interface FetchOptions {
  /** Override default labelIds (["INBOX"]). Pass [] to search all labels. */
  labelIds?: string[];
  /** Extra Gmail search query to prepend (e.g. "from:school.edu") */
  extraQuery?: string;
}

export interface MessageRef {
  id: string;
  threadId: string;
}

/**
 * Creates an authenticated Gmail API v1 client.
 */
export function getGmailClient(accessToken: string): gmail_v1.Gmail {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth });
}

/**
 * Fetches new message references since a given historyId.
 * If no historyId is provided, lists messages from the last 24 hours.
 */
export async function fetchNewMessages(
  gmail: gmail_v1.Gmail,
  historyId?: string,
  userId?: string,
  options?: FetchOptions,
): Promise<MessageRef[]> {
  if (historyId) {
    logger.debug(TAG, `fetchNewMessages via history, startHistoryId=${historyId}`);
    return fetchViaHistory(gmail, historyId, userId, options);
  }
  logger.debug(TAG, "fetchNewMessages via recent (no historyId, fetching last 24h)");
  return fetchRecent(gmail, userId, options);
}

async function fetchViaHistory(
  gmail: gmail_v1.Gmail,
  historyId: string,
  userId?: string,
  options?: FetchOptions,
): Promise<MessageRef[]> {
  const messageRefs: MessageRef[] = [];
  let pageToken: string | undefined;
  let pageCount = 0;

  // history.list uses singular `labelId`; omit entirely when searching all labels
  const effectiveLabels = options?.labelIds ?? ["INBOX"];
  const labelId = effectiveLabels.length > 0 ? effectiveLabels[0] : undefined;

  do {
    const res = await withGmailRetry(userId, "history.list", () =>
      gmail.users.history.list({
        userId: "me",
        startHistoryId: historyId,
        historyTypes: ["messageAdded"],
        ...(labelId ? { labelId } : {}),
        pageToken,
      })
    );

    pageCount++;
    const histories = res.data.history ?? [];
    for (const history of histories) {
      const added = history.messagesAdded ?? [];
      for (const item of added) {
        if (item.message?.id && item.message?.threadId) {
          messageRefs.push({
            id: item.message.id,
            threadId: item.message.threadId,
          });
        }
      }
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  // Deduplicate by message ID
  const seen = new Set<string>();
  const deduped = messageRefs.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  logger.debug(
    TAG,
    `history.list: ${pageCount} page(s), ${messageRefs.length} raw refs, ${deduped.length} after dedup`
  );
  return deduped;
}

async function fetchRecent(gmail: gmail_v1.Gmail, userId?: string, options?: FetchOptions): Promise<MessageRef[]> {
  const oneDayAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
  const baseQuery = `after:${oneDayAgo}`;
  const query = options?.extraQuery ? `${options.extraQuery} ${baseQuery}` : baseQuery;
  const effectiveLabels = options?.labelIds ?? ["INBOX"];

  logger.debug(TAG, `messages.list query="${query}" labels=${JSON.stringify(effectiveLabels)}`);

  const messageRefs: MessageRef[] = [];
  let pageToken: string | undefined;

  do {
    const res = await withGmailRetry(userId, "messages.list", () =>
      gmail.users.messages.list({
        userId: "me",
        q: query,
        ...(effectiveLabels.length > 0 ? { labelIds: effectiveLabels } : {}),
        pageToken,
      })
    );

    const messages = res.data.messages ?? [];
    for (const msg of messages) {
      if (msg.id && msg.threadId) {
        messageRefs.push({ id: msg.id, threadId: msg.threadId });
      }
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  logger.debug(TAG, `messages.list returned ${messageRefs.length} message(s)`);
  return messageRefs;
}

/**
 * Fetches recent inbox messages within the last `maxAgeDays` days,
 * capped at `maxCount`. Used for historical backfill to seed events.
 */
export async function fetchRecentMessages(
  gmail: gmail_v1.Gmail,
  maxCount: number,
  maxAgeDays: number,
  userId?: string,
  options?: FetchOptions,
): Promise<MessageRef[]> {
  const afterTimestamp = Math.floor(
    (Date.now() - maxAgeDays * 86400000) / 1000
  );
  const baseQuery = `after:${afterTimestamp}`;
  const query = options?.extraQuery ? `${options.extraQuery} ${baseQuery}` : baseQuery;
  const effectiveLabels = options?.labelIds ?? ["INBOX"];

  logger.debug(TAG, `fetchRecentMessages: maxCount=${maxCount} maxAgeDays=${maxAgeDays} query="${query}" labels=${JSON.stringify(effectiveLabels)}`);

  const res = await withGmailRetry(userId, "messages.list", () =>
    gmail.users.messages.list({
      userId: "me",
      maxResults: maxCount,
      ...(effectiveLabels.length > 0 ? { labelIds: effectiveLabels } : {}),
      q: query,
    })
  );

  const messages = res.data.messages ?? [];
  const refs: MessageRef[] = [];
  for (const msg of messages) {
    if (msg.id && msg.threadId) {
      refs.push({ id: msg.id, threadId: msg.threadId });
    }
  }

  logger.debug(TAG, `fetchRecentMessages: got ${refs.length} message(s)`);
  return refs;
}

/**
 * Fetches the N most recent messages, regardless of historyId.
 * Used for forced re-processing / debug testing.
 */
export async function fetchLatestMessages(
  gmail: gmail_v1.Gmail,
  count: number,
  userId?: string,
  options?: FetchOptions,
): Promise<MessageRef[]> {
  const effectiveLabels = options?.labelIds ?? ["INBOX"];
  logger.debug(TAG, `fetchLatestMessages: fetching newest ${count} message(s) labels=${JSON.stringify(effectiveLabels)}${options?.extraQuery ? ` query="${options.extraQuery}"` : ""}`);

  const res = await withGmailRetry(userId, "messages.list", () =>
    gmail.users.messages.list({
      userId: "me",
      maxResults: count,
      ...(effectiveLabels.length > 0 ? { labelIds: effectiveLabels } : {}),
      ...(options?.extraQuery ? { q: options.extraQuery } : {}),
    })
  );

  const messages = res.data.messages ?? [];
  const refs: MessageRef[] = [];
  for (const msg of messages) {
    if (msg.id && msg.threadId) {
      refs.push({ id: msg.id, threadId: msg.threadId });
    }
  }

  logger.debug(TAG, `fetchLatestMessages: got ${refs.length} message(s)`);
  return refs;
}

/**
 * Fetches the full content of a single Gmail message and extracts
 * structured fields: from, fromName, subject, body, receivedAt.
 */
export async function getMessageContent(
  gmail: gmail_v1.Gmail,
  messageId: string,
  userId?: string,
): Promise<GmailMessage> {
  logger.debug(TAG, `messages.get id=${messageId} format=full`);

  const res = await withGmailRetry(userId, "messages.get", () =>
    gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    })
  );

  const headers = res.data.payload?.headers ?? [];
  const getHeader = (name: string): string =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ??
    "";

  const fromRaw = getHeader("From");
  const { name: fromName, email: fromEmail } = parseFromHeader(fromRaw);

  const subject = getHeader("Subject");
  const { html, text } = extractBodyParts(res.data.payload ?? {});
  const receivedAt = new Date(parseInt(res.data.internalDate ?? "0", 10));
  const attachmentParts = extractAttachmentParts(res.data.payload ?? {});

  logger.debug(
    TAG,
    `Message ${messageId}: from="${fromEmail}" subject="${subject}" body=${text.length} chars html=${!!html} attachments=${attachmentParts.length}`
  );

  return {
    id: messageId,
    from: fromEmail,
    fromName,
    subject,
    body: text,
    bodyHtml: html,
    receivedAt,
    attachmentParts,
  };
}

/**
 * Gets the authenticated user's Gmail email address.
 */
export async function getProfile(gmail: gmail_v1.Gmail, userId?: string): Promise<string> {
  const res = await withGmailRetry(userId, "users.getProfile", () =>
    gmail.users.getProfile({ userId: "me" })
  );
  return res.data.emailAddress ?? "";
}

/**
 * Fetches attachment data for a large attachment by its attachmentId.
 * Returns the raw bytes as a Buffer.
 */
export async function fetchAttachmentData(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string,
  userId?: string,
): Promise<Buffer> {
  const res = await withGmailRetry(userId, "attachments.get", () =>
    gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    })
  );

  const data = res.data.data;
  if (!data) {
    throw new Error(`Empty attachment data for attachmentId=${attachmentId}`);
  }

  // Gmail returns base64url-encoded data
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64");
}

// ---------------------------------------------------------------------------
// Supported MIME types for attachment extraction
// ---------------------------------------------------------------------------

const SUPPORTED_DOC_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
]);

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/tiff",
]);

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_IMAGES = 5;
const INLINE_IMAGE_MIN_SIZE = 10 * 1024; // 10KB — skip tiny inline images (tracking pixels, logos)

/**
 * Recursively walks a MIME tree and collects supported attachment parts.
 * Applies filtering: skips small inline images (tracking pixels),
 * caps at MAX_IMAGES images and MAX_IMAGE_SIZE per attachment.
 */
function extractAttachmentParts(
  payload: gmail_v1.Schema$MessagePart
): AttachmentPart[] {
  const parts: AttachmentPart[] = [];
  collectAttachmentParts(payload, parts);
  return parts;
}

function collectAttachmentParts(
  part: gmail_v1.Schema$MessagePart,
  result: AttachmentPart[]
): void {
  const mimeType = (part.mimeType ?? "").toLowerCase();
  const filename = part.filename ?? "";
  const disposition = getDisposition(part);
  const sizeEstimate = part.body?.size ?? 0;

  const isDoc = SUPPORTED_DOC_TYPES.has(mimeType);
  const isImage = SUPPORTED_IMAGE_TYPES.has(mimeType);

  if ((isDoc || isImage) && filename) {
    // Filter: skip small inline images (tracking pixels, decorative logos)
    if (isImage && disposition === "inline" && sizeEstimate < INLINE_IMAGE_MIN_SIZE) {
      logger.debug(TAG, `Skipping small inline image: ${filename} (${sizeEstimate} bytes)`);
    } else if (isImage && sizeEstimate > MAX_IMAGE_SIZE) {
      logger.debug(TAG, `Skipping oversized image: ${filename} (${sizeEstimate} bytes)`);
    } else if (isImage && countImages(result) >= MAX_IMAGES) {
      logger.debug(TAG, `Skipping image (cap reached): ${filename}`);
    } else {
      result.push({
        mimeType,
        filename,
        sizeEstimate,
        data: part.body?.data ?? undefined,
        attachmentId: part.body?.attachmentId ?? undefined,
        disposition,
      });
    }
  }

  // Recurse into child parts
  for (const child of part.parts ?? []) {
    collectAttachmentParts(child, result);
  }
}

function getDisposition(part: gmail_v1.Schema$MessagePart): "attachment" | "inline" {
  const headers = part.headers ?? [];
  const cdHeader = headers.find(
    (h) => h.name?.toLowerCase() === "content-disposition"
  );
  if (cdHeader?.value?.toLowerCase().startsWith("attachment")) {
    return "attachment";
  }
  return "inline";
}

function countImages(parts: AttachmentPart[]): number {
  return parts.filter((p) => SUPPORTED_IMAGE_TYPES.has(p.mimeType)).length;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parses a From header like "John Doe <john@example.com>" into name and email.
 */
export function parseFromHeader(raw: string): {
  name: string | null;
  email: string;
} {
  const match = raw.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    // Strip surrounding quotes from the name portion
    const name = match[1].replace(/^["']|["']$/g, "").trim();
    return { name: name || null, email: match[2] };
  }
  // Plain email address with no display name
  return { name: null, email: raw.trim() };
}

/**
 * Extracts both plain text and HTML body parts from a Gmail payload.
 * Returns plain text for AI analysis and raw HTML for email forwarding.
 */
function extractBodyParts(
  payload: gmail_v1.Schema$MessagePart
): { html: string | null; text: string } {
  const plainData = findPart(payload, "text/plain");
  const htmlData = findPart(payload, "text/html");

  const plainText = plainData ? decodeBase64Url(plainData) : null;
  const htmlText = htmlData ? decodeBase64Url(htmlData) : null;

  // Text for AI: prefer plain text, fall back to stripped HTML
  const text = plainText ?? (htmlText ? stripHtml(htmlText) : "");
  // HTML for forwarding: use the raw HTML part if available
  const html = htmlText ?? null;

  return { html, text };
}

/**
 * Extracts the message body from a Gmail payload.
 * Prefers text/plain; falls back to text/html with tags stripped.
 */
function extractBody(
  payload: gmail_v1.Schema$MessagePart
): string {
  // Try to find text/plain first, then text/html
  const plain = findPart(payload, "text/plain");
  if (plain) {
    return decodeBase64Url(plain);
  }

  const html = findPart(payload, "text/html");
  if (html) {
    return stripHtml(decodeBase64Url(html));
  }

  return "";
}

/**
 * Recursively searches the MIME tree for a part matching the given mimeType.
 * Returns the base64url-encoded body data if found.
 */
function findPart(
  part: gmail_v1.Schema$MessagePart,
  mimeType: string
): string | null {
  if (part.mimeType === mimeType && part.body?.data) {
    return part.body.data;
  }

  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }

  return null;
}

/**
 * Decodes a base64url-encoded string into UTF-8 text.
 */
function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

/**
 * Strips HTML tags and decodes common HTML entities.
 * This is a simple approach suitable for email body extraction.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
