import { Resend } from "resend";
import { render } from "@react-email/components";
import { ForwardedEmail } from "./templates/forwarded-email";
import { VerificationEmail } from "./templates/verification-email";
import { TestEmail } from "./templates/test-email";
import { ReauthEmail } from "./templates/reauth-email";
import { QuotaPausedEmail } from "./templates/quota-paused-email";
import { WeeklyDigest } from "./templates/weekly-digest";
import { DailyBrief } from "./templates/daily-brief";
import { MonitoringStartedEmail } from "./templates/monitoring-started-email";
import { MonitoringStoppedEmail } from "./templates/monitoring-stopped-email";
import { InactivityWarningEmail } from "./templates/inactivity-warning-email";
import { DeactivationEmail } from "./templates/deactivation-email";
import { HouseholdDeactivationEmail } from "./templates/household-deactivation-email";
import { ReactivationEmail } from "./templates/reactivation-email";
import { sanitizeEmailHtml } from "./sanitize";
import { prisma } from "@/server/db/prisma";
import { getConfig } from "@/server/config";
import logger from "@/lib/logger";

const TAG = "email-sender";

interface SendForwardedEmailParams {
  to: Array<{ email: string; name?: string | null }>;
  subject: string;
  summary: string;
  originalFrom: string;
  originalSubject: string;
  originalBody: string;
  originalBodyHtml?: string | null;
  childNames: string[];
  attachmentNames?: string[];
  attachments?: Array<{ filename: string; content: Buffer }>;
  attachmentsOversized?: boolean;
  messageUrl?: string;
  emailId?: string;
  userId?: string;
  isManualForward?: boolean;
  relatedEmails?: Array<{ subject: string; receivedAt: Date }>;
  links?: Array<{ url: string; label: string }>;
}

// Cache the Resend instance; invalidated when key changes
let resendInstance: Resend | null = null;
let resendKeyHash: string | null = null;

/**
 * Send throttle to stay under Resend's 2 req/sec rate limit.
 * Uses a promise chain (mutex) so concurrent callers queue up rather than
 * racing on the shared timestamp. Ensures at least 1000ms between sends
 * for safe margin against clock drift and server-side measurement.
 */
const SEND_INTERVAL_MS = 1000;
let lastSendTime = 0;
let throttleChain: Promise<void> = Promise.resolve();

export function throttleSend(): Promise<void> {
  throttleChain = throttleChain.then(async () => {
    const now = Date.now();
    const elapsed = now - lastSendTime;
    if (elapsed < SEND_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, SEND_INTERVAL_MS - elapsed));
    }
    lastSendTime = Date.now();
  });
  return throttleChain;
}


/** Returns a Resend instance with automatic send throttling (2 req/sec limit). */
export async function getResend(): Promise<Resend> {
  const config = await prisma.systemConfig.findUnique({
    where: { id: "singleton" },
    select: { resendApiKeyEncrypted: true },
  });

  if (config?.resendApiKeyEncrypted) {
    // DB-stored encrypted key
    const keyId = config.resendApiKeyEncrypted.toString("base64").slice(0, 16);
    if (resendInstance && resendKeyHash === keyId) return resendInstance;

    const { decrypt } = await import("@/lib/encryption");
    const apiKey = decrypt(config.resendApiKeyEncrypted);
    resendInstance = new Resend(apiKey);
    resendKeyHash = keyId;
    return resendInstance;
  }

  // Fallback to env (deprecated — migrate to Admin > Settings)
  const envKey = process.env.RESEND_API_KEY;
  if (envKey) {
    logger.warn("resend", "Using RESEND_API_KEY from env — this fallback is deprecated. Set the API key in Admin > Settings instead.");
    if (resendInstance && resendKeyHash === "env") return resendInstance;
    resendInstance = new Resend(envKey);
    resendKeyHash = "env";
    return resendInstance;
  }

  throw new Error(
    "No Resend API key configured. Set one via Admin > Settings."
  );
}

export async function getEmailConfig(): Promise<{ fromAddress: string; footerText: string | null; brandName: string }> {
  const config = await getConfig();

  const footerText = config.emailFooterEnabled && config.emailFooterText
    ? config.emailFooterText
    : null;

  if (config.resendFromAddress) return { fromAddress: config.resendFromAddress, footerText, brandName: config.brandName };

  // Fallback to env
  const envAddr = process.env.RESEND_FROM_ADDRESS;
  if (envAddr) return { fromAddress: envAddr, footerText, brandName: config.brandName };

  throw new Error(
    "No from address configured. Set one via Admin > Settings."
  );
}

async function getAppUrl(): Promise<string> {
  const config = await getConfig();
  if (config.appUrl) return config.appUrl;
  const envUrl = process.env.NEXTAUTH_URL;
  if (envUrl) return envUrl;
  throw new Error(
    "No app URL configured. Set one via Admin > Settings or NEXTAUTH_URL env var."
  );
}

export async function sendForwardedEmail(
  params: SendForwardedEmailParams
): Promise<{ resendMessageId?: string }> {
  const { to, subject, summary, originalFrom, originalSubject, originalBody, originalBodyHtml, childNames, attachmentNames, attachments, attachmentsOversized, messageUrl, emailId, userId, isManualForward, relatedEmails, links } =
    params;

  const sanitizedHtml = originalBodyHtml ? sanitizeEmailHtml(originalBodyHtml) : null;

  const [{ fromAddress, footerText, brandName }, baseUrl] = await Promise.all([
    getEmailConfig(),
    getAppUrl(),
  ]);
  const settingsUrl = `${baseUrl}/settings`;

  const formattedTo = to.map((r) =>
    r.name ? `${r.name} <${r.email}>` : r.email
  );

  // Build prefix from child first names, e.g. "[Emma]" or "[Emma, Liam]"
  const firstNames = childNames.map((n) => n.split(/\s+/)[0]);
  const prefix = firstNames.length > 0
    ? `[${firstNames.join(", ")}]`
    : "[PS]";

  // Generate unsubscribe URL if userId provided
  let unsubscribeUrl: string | null = null;
  let unsubscribeToken: string | null = null;
  if (userId) {
    const { createUnsubscribeToken } = await import("@/lib/unsubscribe-token");
    unsubscribeToken = createUnsubscribeToken(userId);
    unsubscribeUrl = `${baseUrl}/unsubscribe?token=${unsubscribeToken}`;
  }

  // Generate feedback URLs if emailId + userId provided
  let feedbackCorrectUrl: string | null = null;
  let feedbackWrongUrl: string | null = null;
  let alwaysForwardUrl: string | null = null;
  let neverForwardUrl: string | null = null;
  if (emailId && userId) {
    const { createFeedbackToken } = await import("@/lib/feedback-token");
    const correctToken = createFeedbackToken(emailId, userId, "correct");
    const wrongToken = createFeedbackToken(emailId, userId, "wrong_forward");
    feedbackCorrectUrl = `${baseUrl}/api/feedback?token=${correctToken}`;
    feedbackWrongUrl = `${baseUrl}/api/feedback?token=${wrongToken}`;

    // Generate sender rule URLs
    const { createSenderRuleToken } = await import("@/lib/sender-rule-token");
    const senderEmail = originalFrom.toLowerCase();
    const alwaysToken = createSenderRuleToken(emailId, userId, senderEmail, "ALWAYS_FORWARD");
    const neverToken = createSenderRuleToken(emailId, userId, senderEmail, "NEVER_FORWARD");
    alwaysForwardUrl = `${baseUrl}/api/sender-rule?token=${alwaysToken}`;
    neverForwardUrl = `${baseUrl}/api/sender-rule?token=${neverToken}`;
  }

  logger.debug(TAG, `Sending to=[${formattedTo.join(", ")}] subject="${prefix} ${subject}"`);

  const html = await render(
    ForwardedEmail({
      summary,
      subject,
      originalFrom,
      originalSubject,
      originalBody,
      originalBodyHtml: sanitizedHtml,
      childNames,
      attachmentNames,
      attachmentsIncluded: (attachments?.length ?? 0) > 0,
      attachmentsOversized,
      messageUrl,
      footerText,
      brandName,
      settingsUrl,
      feedbackCorrectUrl,
      feedbackWrongUrl,
      isManualForward,
      alwaysForwardUrl,
      neverForwardUrl,
      senderEmail: originalFrom,
      unsubscribeUrl: unsubscribeUrl ?? undefined,
      relatedEmails: relatedEmails?.map((e) => ({
        subject: e.subject,
        receivedAt: e.receivedAt.toISOString(),
      })),
      links,
    })
  );

  const resend = await getResend();

  await throttleSend();
  const { data, error } = await resend.emails.send({
    from: fromAddress,
    to: formattedTo,
    subject: `${prefix} ${subject}`.replace(/[\r\n]+/g, " "),
    html,
    ...(attachments && attachments.length > 0
      ? { attachments: attachments.map((a) => ({ filename: sanitizeFilename(a.filename), content: a.content })) }
      : {}),
    ...(unsubscribeToken
      ? {
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
  });

  if (error) {
    logger.error(TAG, `Resend API error: ${error.message}`);
    throw new Error(`Failed to send forwarded email via Resend: ${error.message}`);
  }

  const resendMessageId = data?.id;
  logger.debug(TAG, `Successfully sent to ${to.length} recipient(s)`, { resendMessageId });
  return { resendMessageId };
}

interface SendVerificationEmailParams {
  to: string;
  type: "signup" | "forwarding" | "password-reset" | "email-change";
  token: string;
}

export async function sendVerificationEmail(
  params: SendVerificationEmailParams
): Promise<void> {
  const { to, type, token } = params;

  const baseUrl = await getAppUrl();

  const verifyUrl =
    type === "password-reset"
      ? `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`
      : `${baseUrl}/api/verify-email?token=${encodeURIComponent(token)}`;

  const { fromAddress, brandName } = await getEmailConfig();

  const subjectMap: Record<string, string> = {
    signup: `Verify your email — ${brandName}`,
    forwarding: `Verify your forwarding address — ${brandName}`,
    "password-reset": `Reset your password — ${brandName}`,
    "email-change": `Confirm your new email — ${brandName}`,
  };
  const subjectLine = subjectMap[type]!;

  logger.debug(TAG, `Sending verification email (${type}) to=${to}`);

  const html = await render(
    VerificationEmail({ type, verifyUrl, brandName })
  );

  const resend = await getResend();

  await throttleSend();
  const { error } = await resend.emails.send({
    from: fromAddress,
    to,
    subject: subjectLine,
    html,
  });

  if (error) {
    logger.error(TAG, `Resend API error (verification): ${error.message}`);
    throw new Error(
      `Failed to send verification email via Resend: ${error.message}`
    );
  }

  logger.debug(TAG, `Verification email sent to ${to}`);
}

interface SendTestEmailParams {
  to: string;
  name?: string | null;
}

export async function sendTestEmail(
  params: SendTestEmailParams
): Promise<void> {
  const { to, name } = params;

  const { fromAddress, brandName } = await getEmailConfig();

  const formattedTo = name ? `${name} <${to}>` : to;

  logger.debug(TAG, `Sending test email to=${formattedTo}`);

  const html = await render(TestEmail({ brandName }));

  const resend = await getResend();

  await throttleSend();
  const { error } = await resend.emails.send({
    from: fromAddress,
    to: formattedTo,
    subject: `Test email — ${brandName}`,
    html,
  });

  if (error) {
    logger.error(TAG, `Resend API error (test): ${error.message}`);
    throw new Error(`Failed to send test email via Resend: ${error.message}`);
  }

  logger.debug(TAG, `Test email sent to ${to}`);
}

interface SendReauthEmailParams {
  to: string;
  emailAddress: string;
}

export async function sendReauthEmail(
  params: SendReauthEmailParams
): Promise<void> {
  const { to, emailAddress } = params;

  const baseUrl = await getAppUrl();
  const reconnectUrl = `${baseUrl}/settings`;
  const { fromAddress, brandName } = await getEmailConfig();

  logger.debug(TAG, `Sending reauth notification to=${to} for email=${emailAddress}`);

  const html = await render(
    ReauthEmail({ reconnectUrl, emailAddress, brandName })
  );

  const resend = await getResend();

  await throttleSend();
  const { error } = await resend.emails.send({
    from: fromAddress,
    to,
    subject: `Action required: Reconnect your email — ${brandName}`,
    html,
  });

  if (error) {
    logger.error(TAG, `Resend API error (reauth): ${error.message}`);
    throw new Error(`Failed to send reauth email via Resend: ${error.message}`);
  }

  logger.debug(TAG, `Reauth notification email sent to ${to}`);
}

interface SendQuotaPausedEmailParams {
  to: string;
  emailAddress: string;
}

export async function sendQuotaPausedEmail(
  params: SendQuotaPausedEmailParams
): Promise<void> {
  const { to, emailAddress } = params;

  const baseUrl = await getAppUrl();
  const dashboardUrl = `${baseUrl}/events`;
  const { fromAddress, brandName } = await getEmailConfig();

  logger.debug(TAG, `Sending quota-paused notification to=${to} for email=${emailAddress}`);

  const html = await render(
    QuotaPausedEmail({ dashboardUrl, emailAddress, brandName })
  );

  const resend = await getResend();

  await throttleSend();
  const { error } = await resend.emails.send({
    from: fromAddress,
    to,
    subject: `Email monitoring paused — ${brandName}`,
    html,
  });

  if (error) {
    logger.error(TAG, `Resend API error (quota-paused): ${error.message}`);
    throw new Error(`Failed to send quota-paused email via Resend: ${error.message}`);
  }

  logger.debug(TAG, `Quota-paused notification email sent to ${to}`);
}

interface SendBriefParams {
  to: Array<{ email: string; name?: string | null }>;
  childNames: string[];
  timezone: string;
  periodStart: Date;
  periodEnd: Date;
  stats?: {
    processed: number;
    forwarded: number;
    skipped: number;
    attachments: number;
  };
  forwardedEmails: Array<{
    from: string;
    receivedAt: Date;
    subject: string;
    summary: string | null;
    groupCount?: number;
  }>;
  briefTitle?: string;
  upcomingEvents?: Array<{
    date: string;
    title: string;
    childName?: string;
    location?: string;
  }>;
  eventsHeading?: string;
  aiSummary?: string | null;
  summaryHeading?: string;  // "Week in Review" for weekly, default "SUMMARY" for daily
  /** Monday of the upcoming school week (weekly brief only, for subject line) */
  upcomingSchoolWeekStart?: Date;
  userId?: string;
}

export async function sendBrief(
  params: SendBriefParams
): Promise<{ resendMessageId?: string }> {
  const { to, childNames, timezone, periodStart, periodEnd, forwardedEmails, briefTitle = "Weekly Digest", upcomingEvents, eventsHeading, aiSummary, summaryHeading } = params;

  const { fromAddress, footerText, brandName } = await getEmailConfig();

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: timezone,
  });
  const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });

  const periodStartStr = dateFormatter.format(periodStart);
  const periodEndStr = dateFormatter.format(periodEnd);

  // Format the sent-at timestamp for the brief header
  const sentAt = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(periodEnd);

  const formattedEmails = forwardedEmails.map((email) => ({
    from: email.from,
    date: dateTimeFormatter.format(email.receivedAt),
    subject: email.subject,
    summary: email.summary ?? "",
    groupCount: email.groupCount,
  }));

  const baseUrl = await getAppUrl();
  const settingsUrl = `${baseUrl}/settings`;
  const dashboardUrl = `${baseUrl}/events`;

  // Generate unsubscribe URL if userId provided
  let briefUnsubscribeUrl: string | undefined;
  if (params.userId) {
    const { createUnsubscribeToken } = await import("@/lib/unsubscribe-token");
    const token = createUnsubscribeToken(params.userId);
    briefUnsubscribeUrl = `${baseUrl}/unsubscribe?token=${token}`;
  }

  const formattedTo = to.map((r) =>
    r.name ? `${r.name} <${r.email}>` : r.email
  );

  // Weekly: "Weekly Brief — Week of Feb 17" (the upcoming school week)
  // Daily: "Daily Brief — Feb 15" (today's date)
  // Fallback if periodStart ≠ periodEnd: "Brief: Feb 8–Feb 15"
  let subject: string;
  if (briefTitle === "Weekly Brief" && params.upcomingSchoolWeekStart) {
    const weekOfStr = dateFormatter.format(params.upcomingSchoolWeekStart);
    subject = `${briefTitle} \u2014 Week of ${weekOfStr}`;
  } else if (briefTitle === "Daily Brief") {
    const dayOfWeek = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: timezone,
    }).format(periodEnd);
    subject = `${briefTitle} \u2014 ${dayOfWeek}, ${periodEndStr}`;
  } else if (periodStartStr === periodEndStr) {
    subject = `${briefTitle} \u2014 ${periodEndStr}`;
  } else {
    subject = `${briefTitle}: ${periodStartStr}\u2013${periodEndStr}`;
  }

  logger.debug(TAG, `Sending ${briefTitle.toLowerCase()} to=[${formattedTo.join(", ")}] subject="${subject}"`);

  const html = await render(
    WeeklyDigest({
      brandName,
      childNames,
      periodStart: periodStartStr,
      periodEnd: periodEndStr,
      stats: params.stats,
      forwardedEmails: formattedEmails,
      settingsUrl,
      dashboardUrl,
      footerText,
      briefTitle,
      upcomingEvents,
      eventsHeading,
      aiSummary,
      sentAt,
      summaryHeading,
      unsubscribeUrl: briefUnsubscribeUrl,
    })
  );

  const resend = await getResend();

  await throttleSend();
  const { data, error } = await resend.emails.send({
    from: fromAddress,
    to: formattedTo,
    subject,
    html,
    ...(briefUnsubscribeUrl
      ? {
          headers: {
            "List-Unsubscribe": `<${briefUnsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
  });

  if (error) {
    logger.error(TAG, `Resend API error (brief): ${error.message}`);
    throw new Error(`Failed to send ${briefTitle.toLowerCase()} via Resend: ${error.message}`);
  }

  const resendMessageId = data?.id;
  logger.debug(TAG, `${briefTitle} sent to ${to.length} recipient(s)`, { resendMessageId });
  return { resendMessageId };
}

interface SendDailyBriefParams {
  to: Array<{ email: string; name?: string | null }>;
  childNames: string[];
  timezone: string;
  periodEnd: Date;
  todayEvents: Array<{
    title: string;
    childName?: string;
    location?: string;
    time?: string;
  }>;
  upcomingEvents: Array<{
    date: string;
    title: string;
    childName?: string;
    location?: string;
  }>;
  recentEmails: Array<{
    from: string;
    subject: string;
    summary?: string;
    groupCount?: number;
  }>;
  userId?: string;
}

export async function sendDailyBrief(
  params: SendDailyBriefParams
): Promise<{ resendMessageId?: string }> {
  const { to, childNames, timezone, periodEnd, todayEvents, upcomingEvents, recentEmails } = params;

  const { fromAddress, footerText, brandName } = await getEmailConfig();
  const baseUrl = await getAppUrl();
  const settingsUrl = `${baseUrl}/settings`;
  const dashboardUrl = `${baseUrl}/events`;

  // Generate unsubscribe URL if userId provided
  let dailyUnsubscribeUrl: string | undefined;
  if (params.userId) {
    const { createUnsubscribeToken } = await import("@/lib/unsubscribe-token");
    const token = createUnsubscribeToken(params.userId);
    dailyUnsubscribeUrl = `${baseUrl}/unsubscribe?token=${token}`;
  }

  const formattedTo = to.map((r) =>
    r.name ? `${r.name} <${r.email}>` : r.email
  );

  // Format "Mon, Feb 17" for template header and subject line
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: timezone,
  });
  const dayOfWeek = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: timezone,
  }).format(periodEnd);
  const sentAt = `${dayOfWeek}, ${dateFormatter.format(periodEnd)}`;
  const subject = `Daily Brief \u2014 ${sentAt}`;

  logger.debug(TAG, `Sending daily brief to=[${formattedTo.join(", ")}] subject="${subject}"`);

  const html = await render(
    DailyBrief({
      brandName,
      childNames,
      sentAt,
      todayEvents,
      upcomingEvents,
      recentEmails,
      settingsUrl,
      dashboardUrl,
      footerText,
      unsubscribeUrl: dailyUnsubscribeUrl,
    })
  );

  const resend = await getResend();

  await throttleSend();
  const { data, error } = await resend.emails.send({
    from: fromAddress,
    to: formattedTo,
    subject,
    html,
    ...(dailyUnsubscribeUrl
      ? {
          headers: {
            "List-Unsubscribe": `<${dailyUnsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
  });

  if (error) {
    logger.error(TAG, `Resend API error (daily brief): ${error.message}`);
    throw new Error(`Failed to send daily brief via Resend: ${error.message}`);
  }

  const resendMessageId = data?.id;
  logger.debug(TAG, `Daily brief sent to ${to.length} recipient(s)`, { resendMessageId });
  return { resendMessageId };
}

interface SendFeedbackNotificationParams {
  userName: string;
  userEmail: string;
  category: string;
  subject: string;
  message: string;
  page: string | null;
  appVersion?: string | null;
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[\x00-\x1f]/g, "")       // control chars & null bytes
    .replace(/[/\\:]/g, "_")            // path separators
    .slice(0, 255)                       // max length
    || "attachment";                     // fallback if empty
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendFeedbackNotification(
  params: SendFeedbackNotificationParams
): Promise<void> {
  const {
    userName: rawUserName,
    userEmail: rawUserEmail,
    category: rawCategory,
    subject: rawSubject,
    message: rawMessage,
    page: rawPage,
    appVersion: rawAppVersion,
  } = params;

  const userName = escapeHtml(rawUserName);
  const userEmail = escapeHtml(rawUserEmail);
  const category = escapeHtml(rawCategory);
  const subject = escapeHtml(rawSubject);
  const message = escapeHtml(rawMessage);
  const page = rawPage ? escapeHtml(rawPage) : null;
  const version = rawAppVersion ? escapeHtml(rawAppVersion) : null;

  // Find all admin emails
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: { email: true },
  });

  if (admins.length === 0) {
    logger.warn(TAG, "No admin users found — skipping feedback notification email");
    return;
  }

  const { fromAddress, brandName } = await getEmailConfig();
  const resend = await getResend();

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <style>
    body { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    @media only screen and (max-width: 480px) {
      .fb-container { width: 100% !important; padding: 0 !important; }
      .fb-section { padding-left: 16px !important; padding-right: 16px !important; }
      .fb-heading { font-size: 20px !important; }
      .fb-td { font-size: 15px !important; padding: 10px 14px !important; display: block !important; width: 100% !important; }
      .fb-label { font-weight: 600 !important; border-bottom: none !important; padding-bottom: 2px !important; }
      .fb-value { border-bottom: 1px solid #eee !important; padding-top: 0 !important; }
      .fb-message { font-size: 15px !important; padding: 14px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f6f6f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;">
  <div class="fb-container" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <div class="fb-section" style="padding: 20px;">
      <h2 class="fb-heading" style="color: #1a1a2e; font-size: 18px; font-weight: 700; margin: 0 0 16px 0;">New User Feedback &mdash; ${brandName}</h2>
      <table style="border-collapse: collapse; width: 100%; margin: 0 0 16px 0;">
        <tr>
          <td class="fb-td fb-label" style="padding: 10px 12px; font-weight: 600; color: #555; font-size: 14px; border-bottom: 1px solid #eee; white-space: nowrap;">From</td>
          <td class="fb-td fb-value" style="padding: 10px 12px; font-size: 14px; color: #1f2937; border-bottom: 1px solid #eee;">${userName} (${userEmail})</td>
        </tr>
        <tr>
          <td class="fb-td fb-label" style="padding: 10px 12px; font-weight: 600; color: #555; font-size: 14px; border-bottom: 1px solid #eee; white-space: nowrap;">Category</td>
          <td class="fb-td fb-value" style="padding: 10px 12px; font-size: 14px; color: #1f2937; border-bottom: 1px solid #eee;">${category}</td>
        </tr>
        <tr>
          <td class="fb-td fb-label" style="padding: 10px 12px; font-weight: 600; color: #555; font-size: 14px; border-bottom: 1px solid #eee; white-space: nowrap;">Subject</td>
          <td class="fb-td fb-value" style="padding: 10px 12px; font-size: 14px; color: #1f2937; border-bottom: 1px solid #eee;">${subject}</td>
        </tr>
        ${page ? `<tr>
          <td class="fb-td fb-label" style="padding: 10px 12px; font-weight: 600; color: #555; font-size: 14px; border-bottom: 1px solid #eee; white-space: nowrap;">Page</td>
          <td class="fb-td fb-value" style="padding: 10px 12px; font-size: 14px; color: #1f2937; border-bottom: 1px solid #eee;">${page}</td>
        </tr>` : ""}
        ${version ? `<tr>
          <td class="fb-td fb-label" style="padding: 10px 12px; font-weight: 600; color: #555; font-size: 14px; border-bottom: 1px solid #eee; white-space: nowrap;">Version</td>
          <td class="fb-td fb-value" style="padding: 10px 12px; font-size: 14px; color: #1f2937; border-bottom: 1px solid #eee;">${version}</td>
        </tr>` : ""}
      </table>
      <div class="fb-message" style="padding: 16px; background: #f8fafc; border-radius: 8px; white-space: pre-wrap; font-size: 15px; line-height: 1.6; color: #374151; word-break: break-word;">${message}</div>
    </div>
  </div>
</body>
</html>`;

  const adminEmails = admins.map((a) => a.email);

  logger.debug(TAG, `Sending feedback notification to ${adminEmails.length} admin(s)`);

  await throttleSend();
  const { error } = await resend.emails.send({
    from: fromAddress,
    to: adminEmails,
    subject: `[${brandName} Feedback] ${category}: ${subject}`,
    html,
  });

  if (error) {
    logger.error(TAG, `Resend API error (feedback notification): ${error.message}`);
    throw new Error(`Failed to send feedback notification: ${error.message}`);
  }

  logger.debug(TAG, `Feedback notification sent to ${adminEmails.length} admin(s)`);
}

export async function sendMonitoringStartedEmail(params: {
  userId: string;
}): Promise<void> {
  const { userId } = params;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      email: true,
      individualForwardingEnabled: true,
      dailyBriefEnabled: true,
      weeklyBriefEnabled: true,
      emailAccountType: true,
    },
  });

  // Build human-readable delivery description
  const deliveryDescription: string[] = [];
  if (user.individualForwardingEnabled) {
    deliveryDescription.push("Individual forwards of actionable emails as they arrive");
  }
  if (user.dailyBriefEnabled) {
    deliveryDescription.push("Daily brief each morning");
  }
  if (user.weeklyBriefEnabled) {
    deliveryDescription.push("Weekly brief on weekends");
  }
  if (deliveryDescription.length === 0) {
    deliveryDescription.push("No delivery methods are currently enabled — visit Settings to configure");
  }

  // Collect unique recipient emails: login email + active verified forwarding addresses
  const forwardingAddresses = await prisma.forwardingAddress.findMany({
    where: { userId, isActive: true, verifiedAt: { not: null } },
  });
  const { decryptForwardingRecord } = await import("@/lib/pii-encryption");

  const recipientSet = new Set<string>();
  recipientSet.add(user.email.toLowerCase());
  for (const addr of forwardingAddresses) {
    const decrypted = await decryptForwardingRecord(addr);
    recipientSet.add(decrypted.email.toLowerCase());
  }

  const [{ fromAddress, brandName }, baseUrl] = await Promise.all([
    getEmailConfig(),
    getAppUrl(),
  ]);
  const settingsUrl = `${baseUrl}/settings`;

  const html = await render(
    MonitoringStartedEmail({ brandName, settingsUrl, deliveryDescription })
  );

  const resend = await getResend();

  for (const recipient of Array.from(recipientSet)) {
    try {
      await throttleSend();
      const { error } = await resend.emails.send({
        from: fromAddress,
        to: recipient,
        subject: `Monitoring is active — ${brandName}`,
        html,
      });
      if (error) {
        logger.error(TAG, `Resend API error (monitoring-started to ${recipient}): ${error.message}`);
      }
    } catch (err) {
      logger.error(TAG, `Failed to send monitoring-started email to ${recipient}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.debug(TAG, `Monitoring-started email sent to ${recipientSet.size} recipient(s)`);
}

export async function sendMonitoringStoppedEmail(params: {
  userId: string;
}): Promise<void> {
  const { userId } = params;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true },
  });

  // Collect unique recipient emails: login email + active verified forwarding addresses
  const forwardingAddresses = await prisma.forwardingAddress.findMany({
    where: { userId, isActive: true, verifiedAt: { not: null } },
  });
  const { decryptForwardingRecord } = await import("@/lib/pii-encryption");

  const recipientSet = new Set<string>();
  recipientSet.add(user.email.toLowerCase());
  for (const addr of forwardingAddresses) {
    const decrypted = await decryptForwardingRecord(addr);
    recipientSet.add(decrypted.email.toLowerCase());
  }

  const [{ fromAddress, brandName }, baseUrl] = await Promise.all([
    getEmailConfig(),
    getAppUrl(),
  ]);
  const settingsUrl = `${baseUrl}/settings`;

  const html = await render(
    MonitoringStoppedEmail({ brandName, settingsUrl })
  );

  const resend = await getResend();

  for (const recipient of Array.from(recipientSet)) {
    try {
      await throttleSend();
      const { error } = await resend.emails.send({
        from: fromAddress,
        to: recipient,
        subject: `Monitoring paused — ${brandName}`,
        html,
      });
      if (error) {
        logger.error(TAG, `Resend API error (monitoring-stopped to ${recipient}): ${error.message}`);
      }
    } catch (err) {
      logger.error(TAG, `Failed to send monitoring-stopped email to ${recipient}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.debug(TAG, `Monitoring-stopped email sent to ${recipientSet.size} recipient(s)`);
}

export async function sendUnsubscribeNotification(params: {
  userEmail: string;
  settingsUrl: string;
}): Promise<void> {
  const { userEmail, settingsUrl } = params;
  const { fromAddress, brandName } = await getEmailConfig();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f6f6f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <div style="padding: 20px;">
      <h2 style="color: #1a1a2e; font-size: 18px; font-weight: 700; margin: 0 0 16px 0;">Individual forwarding has been disabled</h2>
      <p style="font-size: 15px; line-height: 1.6; color: #374151; margin: 0 0 12px 0;">A forwarding recipient used the unsubscribe link in a forwarded email. As a result, <strong>individual email forwarding</strong> has been turned off for your account.</p>
      <p style="font-size: 15px; line-height: 1.6; color: #374151; margin: 0 0 12px 0;">Daily and weekly briefs are not affected.</p>
      <p style="font-size: 15px; line-height: 1.6; color: #374151; margin: 0 0 0 0;">You can re-enable forwarding anytime from <a href="${settingsUrl}" style="color: #0066cc; text-decoration: underline;">Settings</a>.</p>
    </div>
  </div>
</body>
</html>`;

  const resend = await getResend();

  await throttleSend();
  const { error } = await resend.emails.send({
    from: fromAddress,
    to: userEmail,
    subject: `Individual forwarding disabled — ${brandName}`,
    html,
  });

  if (error) {
    logger.error(TAG, `Resend API error (unsubscribe notification): ${error.message}`);
    throw new Error(`Failed to send unsubscribe notification: ${error.message}`);
  }

  logger.debug(TAG, `Unsubscribe notification sent to ${userEmail}`);
}

interface SendContactFormEmailParams {
  name: string;
  email: string;
  message: string;
}

export async function sendContactFormEmail(
  params: SendContactFormEmailParams
): Promise<void> {
  const {
    name: rawName,
    email: rawEmail,
    message: rawMessage,
  } = params;

  const name = escapeHtml(rawName);
  const email = escapeHtml(rawEmail);
  const message = escapeHtml(rawMessage);

  const { fromAddress, brandName } = await getEmailConfig();
  const resend = await getResend();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <style>
    body { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    @media only screen and (max-width: 480px) {
      .ct-container { width: 100% !important; padding: 0 !important; }
      .ct-section { padding-left: 16px !important; padding-right: 16px !important; }
      .ct-heading { font-size: 20px !important; }
      .ct-td { font-size: 15px !important; padding: 10px 14px !important; display: block !important; width: 100% !important; }
      .ct-label { font-weight: 600 !important; border-bottom: none !important; padding-bottom: 2px !important; }
      .ct-value { border-bottom: 1px solid #eee !important; padding-top: 0 !important; }
      .ct-message { font-size: 15px !important; padding: 14px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f6f6f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;">
  <div class="ct-container" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <div class="ct-section" style="padding: 20px;">
      <h2 class="ct-heading" style="color: #1a1a2e; font-size: 18px; font-weight: 700; margin: 0 0 16px 0;">Contact Form Submission &mdash; ${brandName}</h2>
      <table style="border-collapse: collapse; width: 100%; margin: 0 0 16px 0;">
        <tr>
          <td class="ct-td ct-label" style="padding: 10px 12px; font-weight: 600; color: #555; font-size: 14px; border-bottom: 1px solid #eee; white-space: nowrap;">Name</td>
          <td class="ct-td ct-value" style="padding: 10px 12px; font-size: 14px; color: #1f2937; border-bottom: 1px solid #eee;">${name}</td>
        </tr>
        <tr>
          <td class="ct-td ct-label" style="padding: 10px 12px; font-weight: 600; color: #555; font-size: 14px; border-bottom: 1px solid #eee; white-space: nowrap;">Email</td>
          <td class="ct-td ct-value" style="padding: 10px 12px; font-size: 14px; color: #1f2937; border-bottom: 1px solid #eee;">${email}</td>
        </tr>
      </table>
      <div class="ct-message" style="padding: 16px; background: #f8fafc; border-radius: 8px; white-space: pre-wrap; font-size: 15px; line-height: 1.6; color: #374151; word-break: break-word;">${message}</div>
    </div>
  </div>
</body>
</html>`;

  logger.debug(TAG, `Sending contact form email from ${rawEmail}`);

  await throttleSend();
  const { error } = await resend.emails.send({
    from: fromAddress,
    to: "contact@example.com",
    replyTo: rawEmail,
    subject: `[${brandName} Contact] from ${rawName}`.replace(/[\r\n]+/g, " "),
    html,
  });

  if (error) {
    logger.error(TAG, `Resend API error (contact form): ${error.message}`);
    throw new Error(`Failed to send contact form email: ${error.message}`);
  }

  logger.debug(TAG, `Contact form email sent from ${rawEmail}`);
}

// ---------------------------------------------------------------------------
// Household invite email
// ---------------------------------------------------------------------------

interface SendHouseholdInviteEmailParams {
  to: string;
  inviterName: string;
  token: string;
}

export async function sendHouseholdInviteEmail(
  params: SendHouseholdInviteEmailParams
): Promise<void> {
  const { to, inviterName, token } = params;
  const baseUrl = await getAppUrl();
  const acceptUrl = `${baseUrl}/api/household/accept?token=${encodeURIComponent(token)}`;

  const { fromAddress, brandName } = await getEmailConfig();
  const { HouseholdInviteEmail } = await import("./templates/household-invite");

  const html = await render(HouseholdInviteEmail({ inviterName, acceptUrl, brandName }));

  const resend = await getResend();
  await throttleSend();
  const { error } = await resend.emails.send({
    from: fromAddress,
    to,
    subject: `${inviterName} invited you to join their household on ${brandName}`,
    html,
  });

  if (error) {
    logger.error(TAG, `Resend API error (household invite): ${error.message}`);
    throw new Error(`Failed to send household invite email: ${error.message}`);
  }

  logger.debug(TAG, `Household invite email sent to ${to}`);
}

// ---------------------------------------------------------------------------
// Household departure notification
// ---------------------------------------------------------------------------

interface SendHouseholdDepartureEmailParams {
  to: string;
  recipientName: string;
  departedName: string;
  reason: "removed" | "left" | "dissolved";
}

export async function sendHouseholdDepartureEmail(
  params: SendHouseholdDepartureEmailParams
): Promise<void> {
  const { to, recipientName, departedName, reason } = params;
  const { fromAddress, brandName } = await getEmailConfig();
  const { HouseholdDepartureEmail } = await import("./templates/household-departure");

  const html = await render(
    HouseholdDepartureEmail({ reason, departedName, recipientName, brandName })
  );

  const subjectMap: Record<string, string> = {
    removed: `You have been disconnected from shared monitoring on ${brandName}`,
    left: `${departedName} has disconnected from shared monitoring on ${brandName}`,
    dissolved: `Shared monitoring has ended on ${brandName}`,
  };
  const subject = subjectMap[reason];

  const resend = await getResend();
  await throttleSend();
  const { error } = await resend.emails.send({ from: fromAddress, to, subject, html });

  if (error) {
    logger.error(TAG, `Resend API error (household departure): ${error.message}`);
    throw new Error(`Failed to send household departure email: ${error.message}`);
  }

  logger.debug(TAG, `Household departure email sent to ${to}`);
}

// ---------------------------------------------------------------------------
// Lifecycle emails
// ---------------------------------------------------------------------------

interface SendInactivityWarningParams {
  to: string;
  daysRemaining: number;
  deactivationDate: string;
}

export async function sendInactivityWarning(
  params: SendInactivityWarningParams
): Promise<void> {
  const { to, daysRemaining, deactivationDate } = params;

  const baseUrl = await getAppUrl();
  const loginUrl = `${baseUrl}/login`;
  const { fromAddress, brandName } = await getEmailConfig();

  logger.debug(TAG, `Sending inactivity warning to=${to} (${daysRemaining} days remaining)`);

  const html = await render(
    InactivityWarningEmail({ loginUrl, daysRemaining, deactivationDate, brandName })
  );

  const daysLabel = daysRemaining <= 1 ? "tomorrow" : `in ${daysRemaining} days`;
  const resend = await getResend();
  await throttleSend();
  const { error } = await resend.emails.send({
    from: fromAddress,
    to,
    subject: `Your ${brandName} account will be deactivated ${daysLabel}`,
    html,
  });

  if (error) {
    logger.error(TAG, `Resend API error (inactivity warning): ${error.message}`);
    throw new Error(`Failed to send inactivity warning: ${error.message}`);
  }

  logger.debug(TAG, `Inactivity warning sent to ${to}`);
}

interface SendDeactivationNoticeParams {
  to: string;
}

export async function sendDeactivationNotice(
  params: SendDeactivationNoticeParams
): Promise<void> {
  const { to } = params;

  const baseUrl = await getAppUrl();
  const reactivateUrl = `${baseUrl}/reactivate`;
  const { fromAddress, brandName } = await getEmailConfig();

  logger.debug(TAG, `Sending deactivation notice to=${to}`);

  const html = await render(
    DeactivationEmail({ reactivateUrl, brandName })
  );

  const resend = await getResend();
  await throttleSend();
  const { error } = await resend.emails.send({
    from: fromAddress,
    to,
    subject: `Your ${brandName} account has been deactivated`,
    html,
  });

  if (error) {
    logger.error(TAG, `Resend API error (deactivation notice): ${error.message}`);
    throw new Error(`Failed to send deactivation notice: ${error.message}`);
  }

  logger.debug(TAG, `Deactivation notice sent to ${to}`);
}

interface SendHouseholdDeactivationParams {
  to: string;
  ownerName: string;
}

export async function sendHouseholdDeactivationNotice(
  params: SendHouseholdDeactivationParams
): Promise<void> {
  const { to, ownerName } = params;

  const baseUrl = await getAppUrl();
  const loginUrl = `${baseUrl}/login`;
  const { fromAddress, brandName } = await getEmailConfig();

  logger.debug(TAG, `Sending household deactivation notice to=${to}`);

  const html = await render(
    HouseholdDeactivationEmail({ ownerName, loginUrl, brandName })
  );

  const resend = await getResend();
  await throttleSend();
  const { error } = await resend.emails.send({
    from: fromAddress,
    to,
    subject: `Your ${brandName} household monitoring has been paused`,
    html,
  });

  if (error) {
    logger.error(TAG, `Resend API error (household deactivation): ${error.message}`);
    throw new Error(`Failed to send household deactivation notice: ${error.message}`);
  }

  logger.debug(TAG, `Household deactivation notice sent to ${to}`);
}

interface SendReactivationNoticeParams {
  to: string;
}

export async function sendReactivationNotice(
  params: SendReactivationNoticeParams
): Promise<void> {
  const { to } = params;

  const baseUrl = await getAppUrl();
  const loginUrl = `${baseUrl}/login`;
  const { fromAddress, brandName } = await getEmailConfig();

  logger.debug(TAG, `Sending reactivation notice to=${to}`);

  const html = await render(
    ReactivationEmail({ loginUrl, brandName })
  );

  const resend = await getResend();
  await throttleSend();
  const { error } = await resend.emails.send({
    from: fromAddress,
    to,
    subject: `Welcome back! Your ${brandName} account is active again`,
    html,
  });

  if (error) {
    logger.error(TAG, `Resend API error (reactivation notice): ${error.message}`);
    throw new Error(`Failed to send reactivation notice: ${error.message}`);
  }

  logger.debug(TAG, `Reactivation notice sent to ${to}`);
}

/** @deprecated Use sendBrief instead */
export const sendWeeklyDigest = sendBrief;
