/**
 * Gmail implementation of EmailProviderClient.
 *
 * Wraps the existing src/server/gmail/client.ts functions in a class
 * that implements the provider-agnostic interface.
 */

import type { gmail_v1 } from "googleapis";
import type {
  EmailProviderClient,
  EmailMessage,
  FetchOptions,
  MessageRef,
} from "../types";
import {
  getGmailClient,
  fetchNewMessages,
  fetchRecentMessages,
  fetchLatestMessages,
  getMessageContent,
  getProfile,
  fetchAttachmentData,
} from "@/server/gmail/client";

export class GmailProviderClient implements EmailProviderClient {
  private gmail: gmail_v1.Gmail;
  private userId?: string;

  constructor(accessToken: string, userId?: string) {
    this.gmail = getGmailClient(accessToken);
    this.userId = userId;
  }

  /** Expose the raw Gmail API client for provider-specific operations (e.g. attachment forwarding). */
  get rawClient(): gmail_v1.Gmail {
    return this.gmail;
  }

  async fetchNewMessages(syncCursor?: string, options?: FetchOptions): Promise<MessageRef[]> {
    return fetchNewMessages(this.gmail, syncCursor, this.userId, options);
  }

  async fetchRecentMessages(maxCount: number, maxAgeDays: number, options?: FetchOptions): Promise<MessageRef[]> {
    return fetchRecentMessages(this.gmail, maxCount, maxAgeDays, this.userId, options);
  }

  async fetchLatestMessages(count: number, options?: FetchOptions): Promise<MessageRef[]> {
    return fetchLatestMessages(this.gmail, count, this.userId, options);
  }

  async getMessageContent(messageId: string): Promise<EmailMessage> {
    return getMessageContent(this.gmail, messageId, this.userId);
  }

  async getProfile(): Promise<string> {
    return getProfile(this.gmail, this.userId);
  }

  async getCurrentSyncCursor(): Promise<string | undefined> {
    const res = await this.gmail.users.getProfile({ userId: "me" });
    return res.data.historyId ?? undefined;
  }

  async fetchAttachmentData(messageId: string, attachmentId: string): Promise<Buffer> {
    return fetchAttachmentData(this.gmail, messageId, attachmentId, this.userId);
  }

  getMessageUrl(messageId: string): string {
    return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
  }
}
