/**
 * Provider-agnostic email interfaces.
 *
 * Gmail and Outlook (future) clients both implement EmailProviderClient.
 * The worker pipeline uses these interfaces instead of provider-specific APIs.
 */

export interface AttachmentPart {
  mimeType: string;
  filename: string;
  sizeEstimate: number;
  /** Inline base64url data (present for small parts) */
  data?: string;
  /** Provider-specific attachment ID (present for large parts that need a separate fetch) */
  attachmentId?: string;
  /** Content-Disposition: "attachment" or "inline" */
  disposition: "attachment" | "inline";
}

export interface EmailMessage {
  id: string;
  from: string;
  fromName: string | null;
  subject: string;
  body: string;
  bodyHtml: string | null;
  receivedAt: Date;
  attachmentParts: AttachmentPart[];
}

export interface FetchOptions {
  /** Override default label/folder (e.g. ["INBOX"] for Gmail). Pass [] to search all. */
  labelIds?: string[];
  /** Extra search query to prepend (provider-specific syntax). */
  extraQuery?: string;
}

export interface MessageRef {
  id: string;
  threadId: string;
}

/**
 * Provider-agnostic email client interface.
 * Implemented by GmailProviderClient (and OutlookProviderClient in the future).
 */
export interface EmailProviderClient {
  /** Fetch new message refs since the given sync cursor. */
  fetchNewMessages(syncCursor?: string, options?: FetchOptions): Promise<MessageRef[]>;

  /** Fetch recent messages within the given time window (for backfill). */
  fetchRecentMessages(maxCount: number, maxAgeDays: number, options?: FetchOptions): Promise<MessageRef[]>;

  /** Fetch the N most recent messages (for debug/force mode). */
  fetchLatestMessages(count: number, options?: FetchOptions): Promise<MessageRef[]>;

  /** Fetch full content for a single message. */
  getMessageContent(messageId: string): Promise<EmailMessage>;

  /** Get the authenticated user's email address. */
  getProfile(): Promise<string>;

  /** Get the current sync cursor (e.g. Gmail historyId) from the provider. */
  getCurrentSyncCursor(): Promise<string | undefined>;

  /** Fetch raw attachment data by provider-specific attachment ID. */
  fetchAttachmentData(messageId: string, attachmentId: string): Promise<Buffer>;

  /** Generate a deep link URL to view the message in the provider's web UI. */
  getMessageUrl(messageId: string): string;

  /** The underlying provider-specific client (for attachment forwarding etc.) */
  readonly rawClient: unknown;
}
