import { Job } from "bullmq";
import { prisma } from "@/server/db/prisma";
import { getValidAccessToken } from "@/server/email-providers/token-manager";
import { createEmailClient, type FetchOptions } from "@/server/email-providers";
import { GmailRateLimitError, GmailQuotaExhaustedError } from "@/server/gmail/quota-error";
import { pauseUser, getUsage, markNotified } from "@/server/gmail/quota-tracker";
import { getAIProvider } from "@/server/ai/provider";
import { buildAnalysisPrompt } from "@/server/ai/prompt-builder";
import { sendForwardedEmail } from "@/server/email/sender";
import { logAICall, stripEmailContent } from "@/lib/ai-call-logger";
import logger, {
  countProcessed,
  countForwarded,
  countSkipped,
  printCounters,
} from "@/lib/logger";
import { errorMessage } from "@/lib/error-message";
import { getConfig } from "@/server/config";
import { connection as redisConnection, emailQueue } from "@/worker/queue";

/** Redis key for the active backfill job ID for a user (10min TTL) */
export const backfillRedisKey = (userId: string) => `backfill:active:${userId}`;
export const BACKFILL_KEY_TTL = 600; // 10 minutes

/** Redis key to signal backfill cancellation for a user (120s TTL) */
export const backfillCancelKey = (userId: string) => `backfill:cancel:${userId}`;
export const CANCEL_KEY_TTL = 120; // 2 minutes

/** Max hours a re-auth catch-up brief can cover (6 days = 7 calendar dates in display) */
const REAUTH_MAX_WINDOW_HOURS = 6 * 24; // 6 days back = 7 calendar dates
/** Min hours a re-auth catch-up brief covers (even for short gaps) */
const REAUTH_MIN_WINDOW_HOURS = 24;
/** Delay before queuing the catch-up brief after backfill (ms) */
const REAUTH_BRIEF_DELAY_MS = 5000;

/**
 * Validates that a cancellable backfill exists for the user and sets
 * the Redis cancel signal. Throws if no active backfill is found.
 */
export async function requestBackfillCancel(userId: string): Promise<void> {
  const jobId = await redisConnection.get(backfillRedisKey(userId));
  if (!jobId) throw new Error("No active backfill to cancel");
  const job = await emailQueue.getJob(jobId);
  if (!job) throw new Error("Backfill job not found");
  const state = await job.getState();
  if (state !== "active" && state !== "waiting" && state !== "delayed") {
    throw new Error("Backfill is not running");
  }
  await redisConnection.set(backfillCancelKey(userId), "1", "EX", CANCEL_KEY_TTL);
}

/** Redis key for per-user processing lock (prevents concurrent jobs for same user) */
const userLockKey = (userId: string) => `user-lock:${userId}`;
const USER_LOCK_TTL = 180; // 3 minutes — auto-expires if worker crashes

/** Max times a job will re-queue itself when blocked by a per-user lock */
const MAX_LOCK_RETRIES = 10;

const TAG = "process-user-emails";

/**
 * Set of lock keys currently held by this process. Populated on acquire,
 * cleared on release. Used by graceful-shutdown to clean up stale locks
 * so Railway re-deploys don't leave 3-minute dead-zones.
 */
export const activeLockKeys = new Set<string>();


interface ProcessUserEmailsData {
  userId: string;
  connectionId: string;
  forceCount?: number;
  isBackfill?: boolean;
  isReauth?: boolean;
}

/**
 * Main email processing job.
 *
 * For a single user:
 * 1. Obtains a valid Gmail access token (returns early on NEEDS_REAUTH).
 * 2. Fetches new messages since the last known historyId (or last 24h).
 * 3. For each message, deduplicates, analyses via AI, records the result,
 *    and optionally forwards to the user's forwarding addresses.
 * 4. Updates the EmailConnection with the latest sync cursor and poll time.
 */
export async function processUserEmails(
  job: Job<ProcessUserEmailsData>
): Promise<void> {
  const { userId: jobUserId, connectionId, forceCount, isBackfill, isReauth } = job.data;

  // Resolve effectiveUserId: if the user is in a household, data is stored
  // under the household primary's ID so both parents share one pool.
  const dbUser = await prisma.user.findUnique({
    where: { id: jobUserId },
    select: { householdId: true, household: { select: { primaryUserId: true } } },
  });
  const userId = dbUser?.household?.primaryUserId ?? jobUserId;

  logger.info(
    TAG,
    `user=${jobUserId}${userId !== jobUserId ? ` (household→${userId})` : ""} Starting email processing${forceCount ? ` (force=${forceCount})` : ""}${isBackfill ? " (backfill)" : ""}${isReauth ? " (re-auth)" : ""}`
  );

  // Per-user mutex: lock on the effective userId so household members
  // don't process concurrently into the same data pool.
  const lockKey = userLockKey(userId);
  logger.debug(TAG, `user=${userId} Acquiring lock key=${lockKey}`);
  const acquired = await redisConnection.set(lockKey, job.id ?? "unknown", "EX", USER_LOCK_TTL, "NX");
  if (!acquired) {
    const retryCount = (job.data as { _lockRetry?: number })._lockRetry ?? 0;
    if (retryCount >= MAX_LOCK_RETRIES) {
      logger.error(TAG, `user=${userId} Lock contention exceeded ${MAX_LOCK_RETRIES} retries. Dropping job to prevent livelock.`);
      return;
    }
    logger.info(TAG, `user=${userId} Another job is already running. Re-queuing with 30s delay (attempt ${retryCount + 1}/${MAX_LOCK_RETRIES}).`);
    await emailQueue.add(job.name, { ...job.data, _lockRetry: retryCount + 1 }, { delay: 30_000, priority: job.opts?.priority });
    return;
  }
  activeLockKeys.add(lockKey);

  // Load AI concurrency for parallel processing
  const { aiConcurrency } = await getConfig();
  const verbose = (msg: string) => { logger.debug(TAG, msg); };

  // Backfill progress helpers
  const reportProgress = async (data: {
    phase: "connecting" | "fetching" | "analyzing" | "complete" | "cancelled" | "error";
    current: number;
    total: number;
    message: string;
    eventsFound: number;
    emailsRelevant: number;
  }) => {
    if (!isBackfill) return;
    await job.updateProgress(data);
  };

  // Backfill running counters (declared outside try for access in catch)
  let backfillEventsFound = 0;
  let backfillEmailsRelevant = 0;

  // Set Redis backfill key so the frontend can find this job
  if (isBackfill && job.id) {
    await redisConnection.set(backfillRedisKey(userId), job.id, "EX", BACKFILL_KEY_TTL);
  }

  try {
    // -----------------------------------------------------------------------
    // 1. Get valid access token
    // -----------------------------------------------------------------------
    logger.debug(TAG, `user=${userId} Acquiring access token for connection=${connectionId}`);
    await reportProgress({
      phase: "connecting", current: 0, total: 0,
      message: "Connecting to email...", eventsFound: 0, emailsRelevant: 0,
    });

    let accessToken: string;
    try {
      accessToken = await getValidAccessToken(connectionId);
    } catch (error) {
      const message =
        errorMessage(error);
      if (message.includes("NEEDS_REAUTH")) {
        logger.info(
          TAG,
          `user=${userId} Connection needs re-authorization. Skipping.`
        );
        return;
      }
      throw error;
    }

    // -----------------------------------------------------------------------
    // 1b. Verify user has required setup configured
    //     Backfill only requires children (runs before parents/forwarding).
    // -----------------------------------------------------------------------
    if (isBackfill) {
      const childCount = await prisma.child.count({ where: { userId } });
      if (childCount === 0) {
        logger.info(TAG, `user=${userId} Backfill skipping — no children configured`);
        return;
      }
    } else {
      const [parentCount, childCount, fwdCount] = await Promise.all([
        prisma.parent.count({ where: { userId } }),
        prisma.child.count({ where: { userId } }),
        prisma.forwardingAddress.count({ where: { userId, isActive: true } }),
      ]);
      if (parentCount === 0 || childCount === 0 || fwdCount === 0) {
        logger.info(
          TAG,
          `user=${userId} Skipping — missing setup: ${parentCount} parents, ${childCount} children, ${fwdCount} active forwarding addresses`
        );
        return;
      }
    }

    // -----------------------------------------------------------------------
    // 2. Create email provider client
    // -----------------------------------------------------------------------
    const connMeta = await prisma.emailConnection.findUniqueOrThrow({
      where: { id: connectionId },
      select: { provider: true, lastPolledAt: true, syncCursor: true },
    });
    const emailClient = createEmailClient(connMeta.provider, accessToken, userId);

    // -----------------------------------------------------------------------
    // 2b. Pre-load email source filter (needed both for fetch options + per-message filtering)
    // -----------------------------------------------------------------------
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        emailFilterMode: true,
        individualForwardingEnabled: true,
        timezone: true,
        showLinksInSummary: true,
        brutalMode: true,
      },
    });
    const allowedPatterns =
      user.emailFilterMode === "ALLOWED_ONLY"
        ? (
            await prisma.allowedSender.findMany({
              where: { userId },
              select: { pattern: true },
            })
          ).map((a) => a.pattern)
        : null;

    // Build fetch options for SHARED/ALLOWED_ONLY accounts — don't restrict to INBOX,
    // use Gmail's from: query to find emails in any label (custom filters, auto-archive).
    let fetchOptions: FetchOptions = {};
    if (allowedPatterns && allowedPatterns.length > 0) {
      const fromQuery = buildSenderQuery(allowedPatterns);
      fetchOptions = { labelIds: [], extraQuery: fromQuery };
      logger.debug(TAG, `user=${userId} ALLOWED_ONLY fetch: labels=ALL query="${fromQuery}"`);
    }

    // -----------------------------------------------------------------------
    // 3. Fetch new messages
    // -----------------------------------------------------------------------
    // syncCursor already loaded in connMeta above (merged query)
    logger.debug(
      TAG,
      `user=${userId} Current syncCursor=${connMeta.syncCursor ?? "none"}`
    );

    // On first poll (no syncCursor), seed the cursor from the provider.
    // New messages will be processed starting from the next poll.
    // Backfill doesn't use syncCursor, so skip this gate.
    if (!connMeta.syncCursor && !forceCount && !isBackfill) {
      const seedCursor = await emailClient.getCurrentSyncCursor();
      if (seedCursor) {
        await prisma.emailConnection.update({
          where: { id: connectionId },
          data: { syncCursor: seedCursor, lastPolledAt: new Date() },
        });
        logger.info(
          TAG,
          `user=${userId} First poll — seeded syncCursor=${seedCursor}. Will process new messages from next poll.`
        );
      }
      return;
    }

    const gmailFetchStart = Date.now();
    const messageRefs = isBackfill
      ? await emailClient.fetchRecentMessages(50, 14, fetchOptions)
      : forceCount
        ? await emailClient.fetchLatestMessages(forceCount, fetchOptions)
        : await emailClient.fetchNewMessages(connMeta.syncCursor ?? undefined, fetchOptions);
    logger.debug(TAG, `user=${userId} Gmail fetch took ${Date.now() - gmailFetchStart}ms`);

    logger.info(
      TAG,
      `user=${userId} Found ${messageRefs.length} message(s) to process${forceCount ? " (forced)" : ""}${isBackfill ? " (backfill)" : ""}`
    );

    await reportProgress({
      phase: "fetching", current: 0, total: messageRefs.length,
      message: `Found ${messageRefs.length} email${messageRefs.length === 1 ? "" : "s"} to scan...`,
      eventsFound: 0, emailsRelevant: 0,
    });

    // -----------------------------------------------------------------------
    // 4. Pre-load user context (constant for the duration of this job)
    // -----------------------------------------------------------------------
    const { decryptChildRecord, decryptForwardingRecord } = await import("@/lib/pii-encryption");
    const [parents, childRecords, ignoredActivities, priorityActivities, senderRules, fwdRecords, recentSlugs] = await Promise.all([
      prisma.parent.findMany({
        where: { userId },
        select: { name: true, relationship: true },
      }),
      prisma.child.findMany({
        where: { userId },
      }),
      prisma.ignoredActivity.findMany({
        where: { userId },
        select: { name: true },
      }),
      prisma.priorityActivity.findMany({
        where: { userId },
        select: { name: true },
      }),
      prisma.senderRule.findMany({
        where: { userId },
        select: { senderEmail: true, action: true },
      }),
      // Fetch active forwarding addresses from all household members (or just this user)
      prisma.forwardingAddress.findMany({
        where: {
          isActive: true,
          user: dbUser?.householdId
            ? { householdId: dbUser.householdId }
            : { id: userId },
        },
      }),
      // Recent topic slugs for AI consistency (last 60 days)
      prisma.processedEmail.findMany({
        where: { userId, topicSlug: { not: null }, createdAt: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) } },
        select: { topicSlug: true },
        distinct: ['topicSlug'],
      }),
    ]);

    const children = await Promise.all(childRecords.map((r) => decryptChildRecord(r)));
    const forwardingAddresses = await Promise.all(fwdRecords.map((r) => decryptForwardingRecord(r)));
    const senderRuleMap = new Map(senderRules.map((r) => [r.senderEmail, r.action]));
    const knownSlugs = new Set(recentSlugs.map(r => r.topicSlug!));
    const aiProvider = await getAIProvider();

    logger.debug(
      TAG,
      `user=${userId} Context loaded: ${parents.length} parent(s), ${children.length} child(ren), ` +
      `${priorityActivities.length} priority / ${ignoredActivities.length} ignored activity(ies), ` +
      `${senderRules.length} sender rule(s), ${forwardingAddresses.length} active forwarding address(es)`
    );

    // -----------------------------------------------------------------------
    // 5. Process messages (parallel batches of aiConcurrency)
    // -----------------------------------------------------------------------
    if (aiConcurrency > 1) {
      logger.info(TAG, `user=${userId} Processing ${messageRefs.length} message(s) with concurrency=${aiConcurrency}`);
    }
    let processedCount = 0;

    await reportProgress({
      phase: "analyzing", current: 0, total: messageRefs.length,
      message: `Analyzing ${messageRefs.length} email${messageRefs.length === 1 ? "" : "s"}...`,
      eventsFound: 0, emailsRelevant: 0,
    });

    // Pre-load existing events for dedup (avoids N+1 queries inside the event loop).
    // Keyed by day string (YYYY-MM-DD) for fast lookup. Refreshed before each batch
    // to pick up events created by previous batches.
    // Bounded to 90 days to avoid loading thousands of old events for long-lived users.
    const EVENT_CACHE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

    const loadEventsByDay = async () => {
      const cutoff = new Date(Date.now() - EVENT_CACHE_WINDOW_MS);
      const events = await prisma.extractedEvent.findMany({
        where: { userId, eventDate: { gte: cutoff } },
        select: { id: true, title: true, eventDate: true, endDate: true, allDay: true, location: true, details: true, sourceEmails: true, actionable: true, deletedAt: true },
      });
      const map = new Map<string, typeof events>();
      for (const e of events) {
        const day = e.eventDate.toISOString().slice(0, 10);
        const arr = map.get(day);
        if (arr) arr.push(e);
        else map.set(day, [e]);
      }
      return map;
    };
    let eventsByDay = await loadEventsByDay();

    // Track AI failures across messages. If the threshold is reached, abort
    // remaining messages to avoid wasting API calls. The job completes
    // normally (unprocessed messages have no ProcessedEmail record and will
    // be re-attempted on the next poll cycle). Within a concurrent batch,
    // the counter reflects interleaved results, not strict sequential order.
    const AI_FAIL_THRESHOLD = 2;
    let consecutiveAIFailures = 0;
    let abortedEarly = false;

    for (let batchStart = 0; batchStart < messageRefs.length; batchStart += aiConcurrency) {
      const batch = messageRefs.slice(batchStart, batchStart + aiConcurrency);

      // Refresh the event cache between batches so events created by the
      // previous batch are visible for dedup in the next batch.
      if (batchStart > 0) {
        eventsByDay = await loadEventsByDay();
      }

      // If the provider appears down, abort the remaining batches.
      // Do NOT advance the sync cursor so these messages are retried next poll.
      if (consecutiveAIFailures >= AI_FAIL_THRESHOLD) {
        logger.warn(TAG, `user=${userId} Aborting remaining ${messageRefs.length - batchStart} messages after ${consecutiveAIFailures} consecutive AI failures`);
        abortedEarly = true;
        break;
      }

      const results = await Promise.allSettled(
        batch.map(async (ref, batchIdx) => {
          const refIdx = batchStart + batchIdx;
          let message: Awaited<ReturnType<typeof emailClient.getMessageContent>> | undefined;
          let aiCallAttempted = false;
          try {
        // 4a. Check dedup (skip in force mode — delete old record if exists)
        //     Backfill uses normal dedup (skip existing).
        if (forceCount && !isBackfill) {
          const existing = await prisma.processedEmail.findUnique({
            where: {
              userId_externalMessageId: { userId, externalMessageId: ref.id },
            },
            select: { id: true },
          });
          if (existing) {
            await prisma.processedEmail.delete({
              where: { id: existing.id },
            });
            logger.debug(
              TAG,
              `user=${userId} Message ${ref.id}: deleted previous record (force mode)`
            );
          }
        } else {
          const existing = await prisma.processedEmail.findUnique({
            where: {
              userId_externalMessageId: {
                userId,
                externalMessageId: ref.id,
              },
            },
            select: { id: true },
          });

          if (existing) {
            logger.debug(
              TAG,
              `user=${userId} Message ${ref.id} already processed. Skipping.`
            );
            return;
          }
        }

        // 4b. Get full message content
        message = await emailClient.getMessageContent(ref.id);

        logger.debug(
          TAG,
          `user=${userId} Message ${ref.id}: from="${message.from}" subject="${message.subject}"`
        );

        // 4b1. Check email source filter
        if (allowedPatterns !== null) {
          const senderEmail = message.from.toLowerCase();
          const atIdx = senderEmail.lastIndexOf("@");
          const senderDomain = atIdx >= 0 ? senderEmail.slice(atIdx) : "";
          // Check exact email, exact @domain, and parent domains
          // e.g. @email.umbrellaacademy.edu matches allowed pattern @umbrellaacademy.edu
          let matched = allowedPatterns.includes(senderEmail) ||
            allowedPatterns.includes(senderDomain);
          if (!matched && senderDomain) {
            const domainParts = senderDomain.slice(1).split("."); // strip leading @
            for (let i = 1; i < domainParts.length - 1 && !matched; i++) {
              matched = allowedPatterns.includes("@" + domainParts.slice(i).join("."));
            }
          }
          if (!matched) {
            logger.debug(
              TAG,
              `user=${userId} Message ${ref.id}: filtered — sender ${message.from} not in allowed list`
            );
            return;
          }
        }

        // 4b2. Extract attachments (doc text + image count)
        let attachmentCount = 0;
        let imageCount = 0;
        let docTexts: Awaited<ReturnType<typeof import("@/server/attachments")["extractAttachments"]>>["docTexts"] = [];
        let extractedImages: Awaited<ReturnType<typeof import("@/server/attachments")["extractAttachments"]>>["images"] = [];
        let pdfAttachments: Awaited<ReturnType<typeof import("@/server/attachments")["extractAttachments"]>>["pdfAttachments"] = [];
        if (message.attachmentParts.length > 0) {
          try {
            const { extractAttachments } = await import("@/server/attachments");
            const attachmentResult = await extractAttachments(emailClient.rawClient as import("googleapis").gmail_v1.Gmail, ref.id, message.attachmentParts);
            attachmentCount = attachmentResult.totalAttachmentCount;
            imageCount = attachmentResult.imageCount;
            docTexts = attachmentResult.docTexts;
            extractedImages = attachmentResult.images;
            pdfAttachments = attachmentResult.pdfAttachments;

            if (attachmentResult.errors.length > 0) {
              logger.info(
                TAG,
                `user=${userId} Message ${ref.id}: ${attachmentResult.errors.length} attachment error(s)`
              );
            }
          } catch (error) {
            const msg = errorMessage(error);
            logger.error(TAG, `user=${userId} Message ${ref.id}: attachment extraction failed: ${msg}`);
            // Continue with text-only analysis
          }
        }

        // 4b3. Check sender rules before AI (lookup from pre-loaded map)
        const senderRuleAction = senderRuleMap.get(message.from.toLowerCase());

        if (senderRuleAction === "NEVER_FORWARD") {
          logger.info(
            TAG,
            `user=${userId} Message ${ref.id}: NEVER_FORWARD rule for ${message.from} — skipping AI`
          );
          await prisma.processedEmail.create({
            data: {
              userId,
              externalMessageId: ref.id,
              fromAddress: message.from,
              fromName: message.fromName,
              subject: message.subject,
              receivedAt: message.receivedAt,
              aiDecision: false,
              aiProvider: "rule",
              aiModel: "sender-rule",
              aiTokensInput: 0,
              aiTokensOutput: 0,
              aiLatencyMs: 0,
              aiReasoning: `Sender rule: never forward emails from ${message.from}`,
              attachmentCount,
              imageCount,
              ...(isBackfill ? { isBackfill: true } : {}),
            },
          });
          countSkipped();
          return;
        }

        // (Progress reported per-batch after Promise.allSettled, not per-message)

        // 4c. Determine native PDF mode (aiProvider pre-loaded above loop)
        const useNativePdfs = aiProvider.providerName === "gemini" && pdfAttachments.length > 0;

        if (useNativePdfs) {
          logger.debug(
            TAG,
            `user=${userId} Message ${ref.id}: native PDF mode (${pdfAttachments.length} PDF(s) via Gemini)`
          );
        }

        // 4d. Build AI prompt
        // Strip forwarding/reply prefixes so AI extracts consistent event titles
        const cleanSubject = message.subject.replace(/^(?:(?:fwd?|re):\s*)+/i, "");
        if (cleanSubject !== message.subject) {
          verbose(`user=${userId} msg=${ref.id} subject cleaned: "${message.subject}" → "${cleanSubject}"`);
        }
        const prompt = await buildAnalysisPrompt({
          parents,
          children,
          priorityActivities: priorityActivities.map((a) => a.name),
          ignoredActivities: ignoredActivities.map((a) => a.name),
          timezone: user.timezone,
          email: {
            from: message.from,
            subject: cleanSubject,
            body: message.body,
            receivedAt: message.receivedAt,
          },
          docTexts: docTexts.length > 0 ? docTexts : undefined,
          imageCount: imageCount > 0 ? imageCount : undefined,
          nativePdfMode: useNativePdfs,
          existingTopicSlugs: knownSlugs.size > 0 ? Array.from(knownSlugs).slice(0, 100) : undefined,
          extractLinks: user.showLinksInSummary,
          brutalMode: user.brutalMode,
        });

        // 4e. Call AI provider (vision model if images present + configured)
        const pdfArgs = useNativePdfs ? pdfAttachments : undefined;

        const callAI = async () => {
          if (extractedImages.length > 0) {
            const { getVisionProvider } = await import("@/server/ai/provider");
            const visionProvider = await getVisionProvider();
            if (visionProvider) {
              logger.debug(
                TAG,
                `user=${userId} Message ${ref.id}: using vision model for ${extractedImages.length} image(s)`
              );
              return visionProvider.analyzeEmail(prompt, extractedImages, pdfArgs);
            }
            logger.debug(
              TAG,
              `user=${userId} Message ${ref.id}: no vision model configured, using text model`
            );
          }
          return aiProvider.analyzeEmail(prompt, undefined, pdfArgs);
        }

        let analysis;
        let retriedAfterError: string | null = null;
        aiCallAttempted = true;
        try {
          analysis = await callAI();
        } catch (firstErr) {
          // Retry once after 3s backoff for transient failures (truncated JSON, timeouts)
          const firstMsg = errorMessage(firstErr);
          logger.warn(TAG, `user=${userId} msg=${ref.id} AI call failed, retrying in 3s: ${firstMsg}`);
          await new Promise((r) => setTimeout(r, 3000));
          try {
            analysis = await callAI();
            retriedAfterError = firstMsg;
            logger.info(TAG, `user=${userId} msg=${ref.id} AI retry succeeded`);
          } catch (retryErr) {
            // Attach first error context for the outer catch to log
            const retryMsg = errorMessage(retryErr);
            throw new Error(`AI failed after retry. First: ${firstMsg}. Retry: ${retryMsg}`);
          }
        }

        // AI call succeeded: reset the consecutive failure counter
        consecutiveAIFailures = 0;

        logAICall({
          userId,
          action: "email-analysis",
          provider: analysis.provider,
          model: analysis.model,
          success: true,
          durationMs: analysis.latencyMs,
          inputTokens: analysis.tokensInput,
          outputTokens: analysis.tokensOutput,
          prompt: stripEmailContent(prompt, [ref.id]),
          response: JSON.stringify({
            relevant: analysis.relevant,
            send: analysis.send,
            subject: analysis.subject,
            summary: analysis.summary,
            children: analysis.children,
            reasoning: analysis.reasoning,
            events: analysis.events,
            links: analysis.links,
            topicSlug: analysis.topicSlug,
          }),
          metadata: {
            externalMessageId: ref.id,
            ...(retriedAfterError ? { retriedAfterError } : {}),
          },
        });

        verbose(`user=${userId} msg=${ref.id} AI analysis: relevant=${analysis.relevant}, send=${analysis.send}, events=${analysis.events?.length ?? 0}, children=${(analysis.children ?? []).join(",") || "none"}, provider=${analysis.provider}/${analysis.model}, tokens=${analysis.tokensInput}+${analysis.tokensOutput}, latency=${analysis.latencyMs}ms`);
        if (analysis.events?.length) {
          for (const ev of analysis.events) {
            verbose(`user=${userId} msg=${ref.id}   event: "${ev.title}" date=${ev.date} endDate=${ev.endDate ?? "none"} allDay=${ev.allDay ?? true} location=${ev.location ?? "none"} child=${ev.childName ?? "none"} details=${ev.details?.slice(0, 100) ?? "none"}`);
          }
        }

        // 4e2. Apply ALWAYS_FORWARD sender rule override
        if (senderRuleAction === "ALWAYS_FORWARD" && !analysis.send) {
          logger.info(
            TAG,
            `user=${userId} Message ${ref.id}: ALWAYS_FORWARD rule overriding AI decision`
          );
          analysis = {
            ...analysis,
            send: true,
            relevant: true,
            reasoning: `Sender rule: always forward emails from ${message.from}. AI reasoning: ${analysis.reasoning ?? "N/A"}`,
          };
        }

        const n = countProcessed();

        // 4f. Create ProcessedEmail record
        const processedEmail = await prisma.processedEmail.create({
          data: {
            userId,
            externalMessageId: ref.id,
            fromAddress: message.from,
            fromName: message.fromName,
            subject: message.subject,
            receivedAt: message.receivedAt,
            aiDecision: analysis.send,
            aiRelevant: analysis.relevant,
            aiSummary: analysis.summary ?? null,
            aiSubject: analysis.subject ?? null,
            aiProvider: analysis.provider,
            aiModel: analysis.model,
            aiTokensInput: analysis.tokensInput,
            aiTokensOutput: analysis.tokensOutput,
            aiLatencyMs: analysis.latencyMs,
            aiReasoning: analysis.reasoning ?? null,
            aiLinks: analysis.links ? JSON.stringify(analysis.links) : null,
            topicSlug: analysis.topicSlug ?? null,
            attachmentCount,
            imageCount,
            ...(isBackfill ? { isBackfill: true } : {}),
          },
        });

        // Track new slug for same-batch siblings
        if (analysis.topicSlug) {
          knownSlugs.add(analysis.topicSlug);
        }

        // Track backfill counters
        if (analysis.relevant) backfillEmailsRelevant++;

        // 4f2. Store extracted events (only for relevant emails)
        if (analysis.events?.length && analysis.relevant) {
          // Exact match map + case-insensitive fallback map
          const childNameToId = new Map(children.map((c) => [c.name, c.id]));
          const childNameLowerToId = new Map(children.map((c) => [c.name.toLowerCase(), c.id]));

          /** Resolve an AI-returned name to a child ID (exact first, case-insensitive fallback) */
          const resolveChildId = (name: string): string | undefined => {
            const exact = childNameToId.get(name);
            if (exact) return exact;
            const fuzzy = childNameLowerToId.get(name.toLowerCase());
            if (fuzzy) {
              logger.debug(TAG, `user=${userId} Child name fuzzy match: AI="${name}" → DB child ${fuzzy}`);
            } else {
              logger.debug(TAG, `user=${userId} Child name unmatched: AI="${name}" (known: ${Array.from(childNameToId.keys()).join(", ")})`);
            }
            return fuzzy;
          };

          // Resolve top-level analysis.children to IDs for fallback
          const analysisChildIds = (analysis.children ?? [])
            .map((name) => resolveChildId(name))
            .filter((id): id is string => !!id);
          const validEvents = analysis.events.filter(
            (e) => (e.isTodo) || !isNaN(new Date(e.date).getTime())
          );
          let createdCount = 0;
          for (const ev of validEvents) {
            const isTodo = ev.isTodo ?? false;
            let eventDate: Date;
            let effectiveAllDay: boolean;
            if (isTodo) {
              // To-do items use the email's received date, always all-day
              eventDate = message.receivedAt;
              effectiveAllDay = true;
            } else {
              eventDate = (ev.allDay ?? true)
                ? new Date(ev.date.slice(0, 10) + "T12:00:00Z")
                : new Date(ev.date);
              effectiveAllDay = ev.allDay ?? true;
            }
            // Parse endDate for timed events (all-day/todo events have no end time)
            let endDate: Date | null = null;
            if (!effectiveAllDay && !isTodo && ev.endDate) {
              const parsed = new Date(ev.endDate);
              if (!isNaN(parsed.getTime()) && parsed.getTime() > eventDate.getTime()) {
                endDate = parsed;
              }
            }
            // Use parsed eventDate for day window (avoids timezone-format mismatch)
            const dayStr = eventDate.toISOString().slice(0, 10);

            // Find same-day events for dedup (from pre-loaded cache)
            const sameDayEvents = eventsByDay.get(dayStr) ?? [];
            verbose(`user=${userId} msg=${ref.id} dedup: incoming="${ev.title}" on ${dayStr}, ${sameDayEvents.length} existing event(s) on same day`);
            if (sameDayEvents.length > 0) {
              for (const e of sameDayEvents) {
                verbose(`user=${userId} msg=${ref.id} dedup:   existing: "${e.title}" (id=${e.id})`);
              }
            }

            // Fast path: exact title match (case-insensitive)
            let bestMatch: (typeof sameDayEvents)[0] | null = null;
            const incomingTitle = ev.title.slice(0, 300);
            for (const existing of sameDayEvents) {
              if (existing.title.toLowerCase() === incomingTitle.toLowerCase()) {
                bestMatch = existing;
                verbose(`user=${userId} msg=${ref.id} dedup: fast-path exact title match → "${existing.title}" (id=${existing.id})`);
                break;
              }
            }

            // AI dedup: ask the model to identify semantic matches
            if (!bestMatch && sameDayEvents.length === 0) {
              verbose(`user=${userId} msg=${ref.id} dedup: no existing events on ${dayStr}, skipping dedup`);
            }
            if (!bestMatch && sameDayEvents.length > 0) {
              const fmtEvent = (e: { title: string; eventDate: Date; endDate?: Date | null; allDay: boolean; location: string | null; details: string | null }) => {
                const parts = [`"${e.title}"`];
                if (!e.allDay) {
                  const timeStr = e.endDate
                    ? `${e.eventDate.toISOString().slice(11, 16)}-${e.endDate.toISOString().slice(11, 16)} UTC`
                    : `at ${e.eventDate.toISOString().slice(11, 16)} UTC`;
                  parts.push(timeStr);
                } else parts.push("all day");
                if (e.location) parts.push(`@ ${e.location}`);
                if (e.details) parts.push(`— ${e.details.slice(0, 200)}`);
                return parts.join(" | ");
              };
              const existingList = sameDayEvents.map((e, i) => `${i + 1}. ${fmtEvent(e)}`).join("\n");
              const incomingFmt = fmtEvent({
                title: incomingTitle,
                eventDate,
                endDate,
                allDay: effectiveAllDay,
                location: ev.location?.slice(0, 300) ?? null,
                details: ev.details?.slice(0, 200) ?? null,
              });
              const dedupPrompt =
                `You are deduplicating calendar events. Given this new event and existing events on the same day, determine if the new event is the same as any existing one (just worded differently, with extra detail like a grade level or room number, or from a forwarded copy of the same email).\n\n` +
                `New event: ${incomingFmt}\n\nExisting events:\n${existingList}\n\n` +
                `Reply with ONLY the number (1, 2, etc.) of the matching existing event, or "none" if it is a genuinely different event. Do not explain.`;
              verbose(`user=${userId} msg=${ref.id} dedup: no fast-path match, calling AI dedup (${sameDayEvents.length} candidates)`);
              verbose(`user=${userId} msg=${ref.id} dedup AI prompt:\n${dedupPrompt}`);
              try {
                const result = await aiProvider.generateText(dedupPrompt);
                logAICall({
                  userId,
                  action: "event-dedup",
                  provider: aiProvider.providerName,
                  model: result.tokensInput > 0 ? aiProvider.providerName : "unknown",
                  success: true,
                  durationMs: result.latencyMs,
                  inputTokens: result.tokensInput,
                  outputTokens: result.tokensOutput,
                  prompt: dedupPrompt,
                  response: result.text,
                  metadata: { externalMessageId: ref.id, eventTitle: incomingTitle },
                });
                const answer = result.text.trim().toLowerCase();
                verbose(`user=${userId} msg=${ref.id} dedup AI response: raw="${result.text.trim()}" parsed="${answer}" (${result.tokensInput}+${result.tokensOutput} tokens)`);
                if (answer !== "none") {
                  const idx = parseInt(answer, 10) - 1;
                  if (idx >= 0 && idx < sameDayEvents.length) {
                    bestMatch = sameDayEvents[idx];
                    verbose(`user=${userId} msg=${ref.id} dedup AI: matched index ${idx} → "${bestMatch.title}" (id=${bestMatch.id})`);
                  } else {
                    verbose(`user=${userId} msg=${ref.id} dedup AI: answer "${answer}" out of range (0-${sameDayEvents.length - 1}), treating as no match`);
                  }
                }
                logger.debug(TAG, `user=${userId} AI dedup: "${incomingTitle}" → ${bestMatch ? `match "${bestMatch.title}"` : "none"} (${result.tokensInput + result.tokensOutput} tokens)`);
              } catch (err) {
                logger.warn(TAG, `user=${userId} AI dedup call failed, skipping: ${err instanceof Error ? err.message : err}`);
              }
            }

            // Source email entry for this processed email
            const sourceEntry = {
              processedEmailId: processedEmail.id,
              subject: message.subject,
              fromName: message.fromName ?? null,
              fromAddress: message.from,
            };

            if (bestMatch?.deletedAt) {
              verbose(`user=${userId} msg=${ref.id} dedup: matched soft-deleted event "${bestMatch.title}" (id=${bestMatch.id}), skipping`);
              continue;
            }

            if (bestMatch) {
              verbose(`user=${userId} msg=${ref.id} merge: "${incomingTitle}" matched → "${bestMatch.title}" (id=${bestMatch.id})`);
              const mergeChildIds = ev.childName
                ? [resolveChildId(ev.childName)].filter((id): id is string => !!id)
                : analysisChildIds;

              // Merge details: AI-powered dedup when both sides have differing content
              const incomingDetails = ev.details?.slice(0, 1000) ?? null;
              let mergedDetails: string | null | undefined;
              if (!bestMatch.details && incomingDetails) {
                mergedDetails = incomingDetails;
                verbose(`user=${userId} msg=${ref.id} merge details: existing=null, using incoming`);
              } else if (bestMatch.details && !incomingDetails) {
                verbose(`user=${userId} msg=${ref.id} merge details: incoming=null, keeping existing`);
              } else if (bestMatch.details && incomingDetails && bestMatch.details.trim() === incomingDetails.trim()) {
                verbose(`user=${userId} msg=${ref.id} merge details: identical (trimmed), skipping`);
              } else if (bestMatch.details && incomingDetails && bestMatch.details.trim() !== incomingDetails.trim()) {
                verbose(`user=${userId} msg=${ref.id} merge details: both differ, calling AI merge`);
                verbose(`user=${userId} msg=${ref.id} merge details existing: ${bestMatch.details.slice(0, 200)}`);
                verbose(`user=${userId} msg=${ref.id} merge details incoming: ${incomingDetails.slice(0, 200)}`);
                try {
                  const mergePrompt =
                    `Merge these two descriptions of the same calendar event into one consolidated list. ` +
                    `Deduplicate overlapping info, keep all unique details. Output only the merged text, no preamble.\n\n` +
                    `Description A:\n${bestMatch.details}\n\nDescription B:\n${incomingDetails}`;
                  verbose(`user=${userId} msg=${ref.id} merge AI prompt:\n${mergePrompt}`);
                  const mergeResult = await aiProvider.generateText(mergePrompt);
                  logAICall({
                    userId,
                    action: "event-merge",
                    provider: aiProvider.providerName,
                    model: aiProvider.providerName,
                    success: true,
                    durationMs: mergeResult.latencyMs,
                    inputTokens: mergeResult.tokensInput,
                    outputTokens: mergeResult.tokensOutput,
                    prompt: mergePrompt,
                    response: mergeResult.text,
                    metadata: { externalMessageId: ref.id, eventTitle: bestMatch.title },
                  });
                  mergedDetails = mergeResult.text.trim().slice(0, 1000);
                  verbose(`user=${userId} msg=${ref.id} merge AI result (${mergeResult.tokensInput}+${mergeResult.tokensOutput} tokens): ${mergedDetails.slice(0, 200)}`);
                  logger.debug(TAG, `user=${userId} AI details merge for "${bestMatch.title}" (${mergeResult.tokensInput + mergeResult.tokensOutput} tokens)`);
                } catch (err) {
                  logger.warn(TAG, `user=${userId} AI details merge failed, falling back to concatenation: ${err instanceof Error ? err.message : err}`);
                  mergedDetails = (bestMatch.details + "\n" + incomingDetails).slice(0, 1000);
                }
              }

              // Append source email if not already present (dedup by processedEmailId or subject+fromAddress)
              let existingSources: Array<{ processedEmailId?: string; subject: string; fromName: string | null; fromAddress: string }> = [];
              try { existingSources = bestMatch.sourceEmails ? JSON.parse(bestMatch.sourceEmails) : []; } catch { /* ignore */ }
              const alreadyTracked = existingSources.some(
                (s) => s.processedEmailId === sourceEntry.processedEmailId || (s.subject === sourceEntry.subject && s.fromAddress === sourceEntry.fromAddress)
              );
              verbose(`user=${userId} msg=${ref.id} source tracking: ${existingSources.length} existing source(s), new="${sourceEntry.subject}" from=${sourceEntry.fromAddress}, alreadyTracked=${alreadyTracked}`);

              const updateData: Record<string, unknown> = {};
              if (mergeChildIds.length > 0) {
                updateData.children = { connect: mergeChildIds.map((id) => ({ id })) };
              }
              if (bestMatch.location == null && ev.location) {
                updateData.location = ev.location.slice(0, 300);
              }
              // Title upgrade: prefer longer (more descriptive) title
              if (incomingTitle.length > bestMatch.title.length) {
                updateData.title = incomingTitle;
                verbose(`user=${userId} msg=${ref.id} merge: title upgrade "${bestMatch.title}" → "${incomingTitle}" (${bestMatch.title.length} → ${incomingTitle.length} chars)`);
              }
              if (mergedDetails !== undefined) {
                updateData.details = mergedDetails;
              }
              if (!alreadyTracked) {
                updateData.sourceEmails = JSON.stringify([...existingSources, sourceEntry]);
              }
              // Merge endDate: incoming wins if present, otherwise keep existing
              if (endDate) {
                updateData.endDate = endDate;
              }
              // OR the actionable flag — once any source email is actionable, event stays actionable
              if (analysis.send && !bestMatch.actionable) {
                updateData.actionable = true;
              }

              const updateFields = Object.keys(updateData).filter((k) => k !== "children");
              verbose(`user=${userId} msg=${ref.id} merge: updating fields=[${updateFields.join(",")}]${mergeChildIds.length > 0 ? ` +children=[${mergeChildIds.join(",")}]` : ""}`);

              if (Object.keys(updateData).length > 0) {
                await prisma.extractedEvent.update({
                  where: { id: bestMatch.id },
                  data: updateData,
                });
                logger.info(TAG, `user=${userId} Event merge: "${incomingTitle}" → existing "${bestMatch.title}" on ${ev.date}`);
              } else {
                verbose(`user=${userId} msg=${ref.id} merge: no fields to update, pure dedup`);
                logger.debug(TAG, `user=${userId} Event dedup: "${incomingTitle}" on ${ev.date}`);
              }
              continue;
            }

            // No match — create new event
            verbose(`user=${userId} msg=${ref.id} create: new event "${incomingTitle}" on ${dayStr} (allDay=${effectiveAllDay}, isTodo=${isTodo}, location=${ev.location ?? "none"})`);
            const connectIds = ev.childName
              ? [resolveChildId(ev.childName)].filter((id): id is string => !!id)
              : analysisChildIds;
            await prisma.extractedEvent.create({
              data: {
                userId,
                processedEmailId: processedEmail.id,
                title: incomingTitle,
                eventDate,
                endDate,
                allDay: effectiveAllDay,
                isTodo,
                actionable: analysis.send,
                location: ev.location?.slice(0, 300) ?? null,
                details: ev.details?.slice(0, 1000) ?? null,
                sourceEmails: JSON.stringify([sourceEntry]),
                ...(connectIds.length > 0
                  ? { children: { connect: connectIds.map((id) => ({ id })) } }
                  : {}),
              },
            });
            createdCount++;
          }
          if (createdCount > 0) {
            backfillEventsFound += createdCount;
            logger.debug(
              TAG,
              `user=${userId} Message ${ref.id}: stored ${createdCount} event(s) (${validEvents.length - createdCount} deduped)`
            );
          }
        }

        logger.info(
          TAG,
          `user=${userId} Message ${ref.id}: send=${analysis.send} [#${n} this session]`
        );

        // 4f3. Check for duplicate topic slug (same slug already forwarded in last 24h)
        let isDuplicateSlug = false;
        if (analysis.send && analysis.topicSlug) {
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const existingForward = await prisma.processedEmail.findFirst({
            where: {
              userId,
              topicSlug: analysis.topicSlug,
              aiDecision: true,
              forwarded: true,
              id: { not: processedEmail.id },
              createdAt: { gte: oneDayAgo },
            },
            select: { id: true },
          });
          if (existingForward) {
            isDuplicateSlug = true;
            await prisma.processedEmail.update({
              where: { id: processedEmail.id },
              data: { isDuplicateSlug: true },
            });
            logger.info(
              TAG,
              `user=${userId} Message ${ref.id}: duplicate topic slug "${analysis.topicSlug}" — skipping forward`
            );
          }
        }

        // 4g. If AI says send=true, forward to user's active addresses
        //     When individualForwardingEnabled=false, skip immediate forwarding —
        //     briefs query by createdAt window and pick up these emails independently.
        //     Backfill never forwards. Duplicate slugs skip forwarding.
        if (analysis.send && !isBackfill && !isDuplicateSlug) {
          if (!user.individualForwardingEnabled) {
            logger.info(
              TAG,
              `user=${userId} Message ${ref.id}: skipping individual forward (disabled)`
            );
            await prisma.processedEmail.update({
              where: { id: processedEmail.id },
              data: { skipForwardReason: "FORWARDING_DISABLED" },
            });
          } else if (forwardingAddresses.length > 0) {
            logger.debug(
              TAG,
              `user=${userId} Forwarding: html=${!!message.bodyHtml} subject="${message.subject}"`
            );

            // Fetch forwardable attachment data
            const { fetchForwardableAttachments } = await import("@/worker/jobs/attachment-forward");
            const attachmentResult = await fetchForwardableAttachments(emailClient.rawClient as import("googleapis").gmail_v1.Gmail, ref.id, message.attachmentParts, userId);

            // Query related emails by topicSlug for context
            const relatedEmails = analysis.topicSlug
              ? await prisma.processedEmail.findMany({
                  where: { userId, topicSlug: analysis.topicSlug, id: { not: processedEmail.id } },
                  select: { subject: true, receivedAt: true },
                  orderBy: { receivedAt: 'desc' },
                  take: 5,
                })
              : [];

            try {
              const { resendMessageId } = await sendForwardedEmail({
                to: forwardingAddresses.map((a) => ({ email: a.email, name: a.name })),
                subject: analysis.subject ?? message.subject,
                summary: analysis.summary ?? "",
                originalFrom: message.from,
                originalSubject: message.subject,
                originalBody: message.body,
                originalBodyHtml: message.bodyHtml,
                attachmentNames: message.attachmentParts
                  .filter((p) => p.disposition === "attachment")
                  .map((p) => p.filename),
                attachments: attachmentResult.attachments,
                attachmentsOversized: attachmentResult.oversized,
                messageUrl: emailClient.getMessageUrl(ref.id),
                relatedEmails: relatedEmails.length > 0 ? relatedEmails : undefined,
                childNames: (() => {
                  const allNames = children.map((c) => c.name);
                  const allLower = new Set(allNames.map((n) => n.toLowerCase()));
                  // Match AI names back to DB names (case-insensitive)
                  const matched = (analysis.children ?? [])
                    .filter((n) => allLower.has(n.toLowerCase()))
                    .map((n) => allNames.find((db) => db.toLowerCase() === n.toLowerCase())!)
                    .filter(Boolean);
                  return matched.length > 0 ? matched : allNames;
                })(),
                emailId: processedEmail.id,
                userId,
                links: user.showLinksInSummary && analysis.links ? analysis.links : undefined,
              });

              // 4h. Update ProcessedEmail with forwarded status + resend message ID
              await prisma.processedEmail.update({
                where: { id: processedEmail.id },
                data: {
                  forwarded: true,
                  forwardedAt: new Date(),
                  resendMessageId: resendMessageId ?? null,
                  deliveryStatus: "pending",
                },
              });

              countForwarded();
              logger.info(
                TAG,
                `user=${userId} Message ${ref.id}: Forwarded to ${forwardingAddresses.length} address(es)`,
                { resendMessageId }
              );
            } catch (forwardErr) {
              const errMsg = errorMessage(forwardErr);
              logger.error(
                TAG,
                `user=${userId} Message ${ref.id}: Forwarding failed: ${errMsg}`
              );
              await prisma.processedEmail.update({
                where: { id: processedEmail.id },
                data: {
                  processingError: `Forwarding failed: ${errMsg}`,
                  deliveryStatus: "failed",
                },
              });

              // Alert on Resend delivery failure
              try {
                const { createAlert } = await import("@/server/alerts/create-alert");
                await createAlert({
                  type: "resend_failure",
                  severity: "critical",
                  title: "Email forwarding failed",
                  message: `User ${userId}: ${errMsg.slice(0, 500)}`,
                  dedupKey: `resend_failure:${userId}`,
                });
              } catch { /* alert creation must not break processing */ }
            }
          } else {
            logger.info(
              TAG,
              `user=${userId} Message ${ref.id}: AI said send, but no active forwarding addresses`
            );
            await prisma.processedEmail.update({
              where: { id: processedEmail.id },
              data: { skipForwardReason: "NO_ADDRESSES" },
            });
          }
        } else {
          if (analysis.send && isBackfill) {
            await prisma.processedEmail.update({
              where: { id: processedEmail.id },
              data: { skipForwardReason: "BACKFILL" },
            });
          }
          countSkipped();
        }

      } catch (error) {
        const errorMsg = errorMessage(error);
        logger.error(
          TAG,
          `user=${userId} Error processing message ${ref.id}: ${errorMsg}`
        );

        // Only log an AICallLog if we actually attempted the AI call.
        // Pre-AI failures (Gmail fetch, attachment extraction) are logged
        // as warnings, not as AI call failures.
        if (aiCallAttempted) {
          consecutiveAIFailures++;

          const errType = errorMsg.includes("truncated") ? "truncated"
            : errorMsg.includes("valid JSON") ? "invalid-json"
            : errorMsg.includes("rate") ? "rate-limit"
            : errorMsg.includes("timeout") || errorMsg.includes("ETIMEDOUT") ? "timeout"
            : "provider-error";
          logAICall({
            userId,
            action: "email-analysis",
            provider: aiProvider.providerName,
            model: aiProvider.modelName,
            success: false,
            durationMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            prompt: `[error during processing of message ${ref.id}]`,
            response: null,
            errorType: errType,
            errorMessage: errorMsg.slice(0, 2000),
            metadata: { externalMessageId: ref.id, retriedAndFailed: errorMsg.includes("after retry") },
          });

          // AI failures are transient: skip creating a ProcessedEmail record
          // so the message is re-attempted on the next poll cycle.
        } else {
          logger.warn(TAG, `user=${userId} Pre-AI failure for message ${ref.id} (not logged as AI call): ${errorMsg}`);

          // Pre-AI failures (e.g., attachment extraction) are permanent:
          // create a partial record so the message is not re-attempted.
          if (message) {
            try {
              await prisma.processedEmail.create({
                data: {
                  userId,
                  externalMessageId: ref.id,
                  fromAddress: message.from,
                  fromName: message.fromName,
                  subject: message.subject,
                  receivedAt: message.receivedAt,
                  aiDecision: false,
                  aiRelevant: false,
                  aiProvider: aiProvider.providerName,
                  aiModel: aiProvider.modelName,
                  aiTokensInput: 0,
                  aiTokensOutput: 0,
                  aiLatencyMs: 0,
                  processingError: errorMsg.slice(0, 2000),
                  ...(isBackfill ? { isBackfill: true } : {}),
                },
              });
              logger.info(TAG, `user=${userId} Created partial ProcessedEmail for failed message ${ref.id}`);
            } catch (peErr) {
              logger.debug(TAG, `user=${userId} Could not create partial ProcessedEmail for ${ref.id}: ${errorMessage(peErr)}`);
            }
          }
        }

        // Alert on AI-related errors
        try {
          const { createAlert } = await import("@/server/alerts/create-alert");
          await createAlert({
            type: "ai_error",
            severity: "warning",
            title: "AI processing error",
            message: `User ${userId}, message ${ref.id}: ${errorMsg.slice(0, 500)}`,
            dedupKey: `ai_error:${userId}`,
          });
        } catch { /* alert creation must not break processing */ }
      } finally {
        // Increment per-message so the progress bar updates as each email completes
        processedCount++;
        if (isBackfill) {
          await reportProgress({
            phase: "analyzing", current: processedCount, total: messageRefs.length,
            message: `Analyzed ${processedCount} of ${messageRefs.length} emails...`,
            eventsFound: backfillEventsFound, emailsRelevant: backfillEmailsRelevant,
          }).catch(() => {}); // don't let progress reporting break processing
        }
      }
        })
      );

      // Log any rejected promises (shouldn't happen since inner try/catch handles errors)
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "rejected") {
          logger.error(TAG, `user=${userId} Unexpected rejection for message ${batch[i].id}: ${errorMessage(r.reason)}`);
        }
      }

      // Extend BullMQ lock between batches to prevent stalled-job false positives
      // on large backfills that exceed the 5-minute lock duration.
      try {
        await job.extendLock(job.token!, 300_000);
      } catch {
        // Lock extension can fail if the job was already moved; non-fatal
      }

      if (isBackfill) {
        // Check for cancellation signal between batches
        const cancelled = await redisConnection.get(backfillCancelKey(userId));
        if (cancelled) {
          await redisConnection.del(backfillCancelKey(userId));
          logger.info(TAG, `user=${userId} Backfill cancelled after ${processedCount}/${messageRefs.length} emails`);
          await reportProgress({
            phase: "cancelled", current: processedCount, total: messageRefs.length,
            message: `Cancelled. Processed ${processedCount} of ${messageRefs.length} emails, found ${backfillEventsFound} event${backfillEventsFound === 1 ? "" : "s"}.`,
            eventsFound: backfillEventsFound, emailsRelevant: backfillEmailsRelevant,
          });
          return; // exits to finally block for cleanup
        }
      }
    }

    // -----------------------------------------------------------------------
    // 5. Update EmailConnection with new sync cursor and lastPolledAt
    //    Backfill skips this — let normal polling manage the cursor.
    //    Aborted jobs skip the cursor update so unprocessed messages are
    //    re-fetched on the next poll (but still update lastPolledAt so the
    //    scheduler doesn't immediately re-queue).
    // -----------------------------------------------------------------------
    if (!isBackfill) {
      const newSyncCursor = abortedEarly
        ? null
        : await emailClient.getCurrentSyncCursor();

      await prisma.emailConnection.update({
        where: { id: connectionId },
        data: {
          ...(newSyncCursor ? { syncCursor: newSyncCursor } : {}),
          lastPolledAt: new Date(),
        },
      });

      logger.info(
        TAG,
        `user=${userId} Completed. Processed ${messageRefs.length} message(s). syncCursor=${newSyncCursor ?? "unchanged"}`
      );
    } else {
      // Report completion progress
      await reportProgress({
        phase: "complete", current: messageRefs.length, total: messageRefs.length,
        message: `Done! Found ${backfillEventsFound} event${backfillEventsFound === 1 ? "" : "s"} from ${backfillEmailsRelevant} relevant email${backfillEmailsRelevant === 1 ? "" : "s"}`,
        eventsFound: backfillEventsFound, emailsRelevant: backfillEmailsRelevant,
      });

      // Seed sync cursor after backfill so the first regular poll can immediately
      // do incremental processing instead of wasting a cycle just to seed it.
      const currentConn = await prisma.emailConnection.findUniqueOrThrow({
        where: { id: connectionId },
        select: { syncCursor: true },
      });
      if (!currentConn.syncCursor) {
        const seedCursor = await emailClient.getCurrentSyncCursor();
        if (seedCursor) {
          await prisma.emailConnection.update({
            where: { id: connectionId },
            data: { syncCursor: seedCursor, lastPolledAt: new Date() },
          });
          logger.info(
            TAG,
            `user=${userId} Backfill completed. Processed ${messageRefs.length} message(s). Seeded syncCursor=${seedCursor}.`
          );
        } else {
          logger.info(
            TAG,
            `user=${userId} Backfill completed. Processed ${messageRefs.length} message(s). syncCursor unchanged.`
          );
        }
      } else {
        logger.info(
          TAG,
          `user=${userId} Backfill completed. Processed ${messageRefs.length} message(s). syncCursor already set.`
        );
      }

      // After a re-auth backfill, queue a weekly-style catch-up brief
      // with AI summary and events covering the actual gap period.
      if (isReauth) {
        try {
          // Compute window from the (backdated) lastPolledAt captured at job start
          const gapMs = connMeta.lastPolledAt
            ? Date.now() - connMeta.lastPolledAt.getTime()
            : REAUTH_MAX_WINDOW_HOURS * 60 * 60 * 1000;
          const windowHours = Math.min(REAUTH_MAX_WINDOW_HOURS, Math.max(REAUTH_MIN_WINDOW_HOURS, Math.ceil(gapMs / (60 * 60 * 1000))));
          await emailQueue.add("force-brief", {
            userId,
            briefType: "weekly",
            briefTitle: "Recent Brief",
            windowHours,
          }, { delay: REAUTH_BRIEF_DELAY_MS });
          logger.info(TAG, `user=${userId} Queued catch-up brief after re-auth backfill (window=${windowHours}h)`);
        } catch (err) {
          logger.error(TAG, `user=${userId} Failed to queue catch-up brief: ${errorMessage(err)}`);
        }
      }
    }
    printCounters(TAG);
    // -----------------------------------------------------------------------
    // 6. Post-processing: check quota warning threshold
    // -----------------------------------------------------------------------
    const usage = getUsage(userId);
    if (usage.warningReached) {
      try {
        const { createAlert } = await import("@/server/alerts/create-alert");
        await createAlert({
          type: "gmail_quota",
          severity: "warning",
          title: "Gmail API quota approaching limit",
          message: `User ${userId}: ${usage.used}/${usage.used + usage.remaining} units used (${Math.round((usage.used / (usage.used + usage.remaining)) * 100)}%)`,
          dedupKey: `gmail_quota_warning:${userId}`,
        });
      } catch { /* alert creation must not break processing */ }
    }
  } catch (error) {
    // Report error progress for backfill
    await reportProgress({
      phase: "error", current: 0, total: 0,
      message: errorMessage(error),
      eventsFound: backfillEventsFound, emailsRelevant: backfillEmailsRelevant,
    }).catch(() => {}); // don't let progress reporting break error handling

    // Handle Gmail quota errors separately from general failures
    if (error instanceof GmailQuotaExhaustedError) {
      logger.error(TAG, `user=${userId} Gmail daily quota exhausted — pausing until midnight`);
      pauseUser(userId);

      // Create critical admin alert
      try {
        const { createAlert } = await import("@/server/alerts/create-alert");
        await createAlert({
          type: "gmail_quota",
          severity: "critical",
          title: "Gmail daily quota exhausted",
          message: `User ${userId}: daily API quota exhausted. Monitoring paused until midnight UTC.`,
          dedupKey: `gmail_quota_exhausted:${userId}`,
        });
      } catch { /* alert creation must not break processing */ }

      // Send user notification email (once per pause event)
      if (!markNotified(userId)) {
        try {
          const [userRecord, emailConn] = await Promise.all([
            prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
            prisma.emailConnection.findUnique({ where: { id: connectionId }, select: { emailAddress: true } }),
          ]);
          if (userRecord?.email && emailConn?.emailAddress) {
            const { sendQuotaPausedEmail } = await import("@/server/email/sender");
            await sendQuotaPausedEmail({
              to: userRecord.email,
              emailAddress: emailConn.emailAddress,
            });
          }
        } catch (notifyErr) {
          logger.error(TAG, `user=${userId} Failed to send quota-paused notification: ${errorMessage(notifyErr)}`);
        }
      }

      return; // Don't retry — quota resets tomorrow
    }

    if (error instanceof GmailRateLimitError) {
      logger.error(TAG, `user=${userId} Gmail rate limit — re-throwing for BullMQ retry`);
      throw error; // BullMQ exponential backoff will handle this
    }

    logger.error(
      TAG,
      `user=${userId} Fatal error: ${errorMessage(error)}`
    );
    throw error; // Re-throw so BullMQ can retry
  } finally {
    // Release per-user lock
    logger.debug(TAG, `user=${userId} Releasing lock key=${lockKey}`);
    activeLockKeys.delete(lockKey);
    await redisConnection.del(lockKey).catch(() => {});
    // Backfill Redis key is NOT deleted here: let the TTL (10min) expire
    // naturally so polling clients can still read the terminal job state
    // (cancelled, completed, failed) before the key disappears.
  }
}

/**
 * Builds a Gmail `from:` search query from allowed sender patterns.
 * Multiple patterns are OR'd using Gmail's `{...}` syntax.
 * Leading `@` is stripped so `@school.edu` becomes `from:school.edu`.
 */
function buildSenderQuery(patterns: string[]): string {
  const clauses = patterns.map((p) => `from:${p.replace(/^@/, "")}`);
  return clauses.length === 1 ? clauses[0] : `{${clauses.join(" ")}}`;
}
