import { prisma } from "@/server/db/prisma";
import { getConfig } from "@/server/config";
import { checkRedisHealth } from "@/lib/redis-health";
import logger from "@/lib/logger";
import { errorMessage } from "@/lib/error-message";
import { logAICall } from "@/lib/ai-call-logger";

const TAG = "diagnostic-checks";

// ---------------------------------------------------------------------------
// Category context: code paths and investigation steps for the context file
// ---------------------------------------------------------------------------

export const CATEGORY_CONTEXT: Record<string, { codePaths: string[]; steps: string[] }> = {
  brief_gap: {
    codePaths: [
      "`src/worker/jobs/send-brief.ts` (brief scheduling, sendUserBrief)",
      "`src/worker/index.ts` (send-weekly-digest repeatable job)",
      "`prisma/schema.prisma` (BriefDelivery model)",
    ],
    steps: [
      "Query BriefDelivery for affected users: check status, error, createdAt",
      "Verify send-weekly-digest repeatable job is registered (check BullMQ dashboard or worker logs)",
      "Check if users have forwarding addresses configured (briefs skip if none)",
      "Check worker logs around expected brief send time for errors",
    ],
  },
  stale_connection: {
    codePaths: [
      "`src/worker/jobs/poll-scheduler.ts` (enqueues process-user-emails for active users)",
      "`src/worker/jobs/process-user-emails.ts` (fetches Gmail, runs AI)",
      "`src/server/email-providers/gmail/client.ts` (Gmail API client)",
      "`src/server/gmail/quota-tracker.ts` (quota pausing)",
    ],
    steps: [
      "Check EmailConnection.lastPolledAt for affected users",
      "Look for process-user-emails errors in worker logs",
      "Check if users are quota-paused (getPausedUsers)",
      "Verify Gmail tokens are not expired (ConnectionStatus != NEEDS_REAUTH)",
    ],
  },
  ai_failure_spike: {
    codePaths: [
      "`src/server/ai/provider.ts` (OpenAI/Gemini/Grok provider)",
      "`src/server/ai/anthropic-provider.ts` (Anthropic provider)",
      "`src/server/ai/response-parser.ts` (parses structured AI JSON response)",
      "`src/lib/ai-call-logger.ts` (audit logging)",
    ],
    steps: [
      "Query AICallLog for recent failures: group by errorType to identify pattern",
      "Check if AI provider API key is valid (Admin > Settings)",
      "Look for rate-limit errors (provider throttling)",
      "Check if model name changed or is unavailable",
    ],
  },
  bounce_spike: {
    codePaths: [
      "`src/server/email/sender.ts` (Resend email sending)",
      "`src/app/api/webhooks/resend/route.ts` (delivery status webhooks)",
      "`prisma/schema.prisma` (ProcessedEmail.deliveryStatus, BriefDelivery.deliveryStatus)",
    ],
    steps: [
      "Check Resend dashboard for bounce details",
      "Query ProcessedEmail WHERE deliveryStatus='bounced' for affected addresses",
      "Verify forwarding addresses are valid and verified",
      "Check if Resend domain/sender verification is still active",
    ],
  },
  pending_brief: {
    codePaths: [
      "`src/worker/jobs/send-brief.ts` (brief sending logic)",
      "`src/worker/jobs/flush-queued-brief.ts` (queued brief processing)",
      "`src/app/api/webhooks/resend/route.ts` (delivery webhook updates)",
    ],
    steps: [
      "Check if Resend webhooks are configured and reachable",
      "Verify resendWebhookEnabled is true in SystemConfig",
      "Check worker logs for send-brief errors around the affected timestamps",
      "Query BriefDelivery for resendMessageId to correlate with Resend dashboard",
    ],
  },
  gmail_quota: {
    codePaths: [
      "`src/server/gmail/quota-tracker.ts` (in-memory quota tracking)",
      "`src/server/email-providers/gmail/client.ts` (Gmail API calls)",
      "`src/worker/jobs/poll-scheduler.ts` (skips paused users)",
    ],
    steps: [
      "This is informational: paused users auto-resume at midnight UTC",
      "If recurring, consider reducing poll frequency or email volume",
      "Check if specific users consistently hit quota (high email volume accounts)",
    ],
  },
  ai_latency: {
    codePaths: [
      "`src/server/ai/provider.ts` (AI provider call timing)",
      "`src/server/ai/anthropic-provider.ts` (Anthropic provider timing)",
      "`src/lib/ai-call-logger.ts` (durationMs logged per call)",
    ],
    steps: [
      "Query AICallLog: compare avg durationMs by action type",
      "Check if latency spike correlates with token count increase (longer prompts)",
      "Check AI provider status page for service degradation",
      "Consider if model was recently changed to a larger/slower one",
    ],
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Finding {
  severity: "critical" | "warning" | "info" | "ok";
  category: string;
  title: string;
  description: string;
  affectedUsers: Array<{ id: string; name: string; email: string }>;
  metrics: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// Diagnostic checks
// ---------------------------------------------------------------------------

export async function checkBriefGaps(): Promise<Finding[]> {
  const findings: Finding[] = [];
  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Only check users who should actually be receiving briefs:
  // user monitoring on, active Gmail connection, and system monitoring on
  const config = await getConfig();
  if (!config.isMonitoringEnabled) {
    return [{
      severity: "ok",
      category: "brief_gap",
      title: "System monitoring disabled",
      description: "Global monitoring is off, so no briefs are expected to be sent.",
      affectedUsers: [],
      metrics: {},
    }];
  }

  const activeUserFilter = {
    isMonitoringEnabled: true,
    role: "USER" as const,
    emailConnection: { status: "ACTIVE" as const },
  };

  // Daily brief gaps
  const dailyEnabledUsers = await prisma.user.findMany({
    where: { dailyBriefEnabled: true, ...activeUserFilter },
    select: { id: true, name: true, email: true },
  });

  if (dailyEnabledUsers.length > 0) {
    const recentDailyByUser = await prisma.briefDelivery.groupBy({
      by: ["userId"],
      where: {
        briefType: "daily",
        status: "sent",
        createdAt: { gte: threeDaysAgo },
      },
    });
    const usersWithDailyBrief = new Set(recentDailyByUser.map((r) => r.userId));
    const missingDaily = dailyEnabledUsers.filter((u) => !usersWithDailyBrief.has(u.id));

    if (missingDaily.length > 0) {
      const ratio = missingDaily.length / dailyEnabledUsers.length;
      findings.push({
        severity: ratio > 0.5 ? "critical" : "warning",
        category: "brief_gap",
        title: `${missingDaily.length} user(s) missing daily briefs for 3+ days`,
        description: `${missingDaily.length} of ${dailyEnabledUsers.length} eligible users (monitoring on, Gmail connected) have not received a daily brief in the last 3 days.`,
        affectedUsers: missingDaily.map((u) => ({ id: u.id, name: u.name, email: u.email })),
        metrics: {
          enabledCount: dailyEnabledUsers.length,
          missingCount: missingDaily.length,
          missingRatio: Math.round(ratio * 100) + "%",
          windowDays: 3,
          briefType: "daily",
        },
      });
    }
  }

  // Weekly brief gaps
  const weeklyEnabledUsers = await prisma.user.findMany({
    where: { weeklyBriefEnabled: true, ...activeUserFilter },
    select: { id: true, name: true, email: true },
  });

  if (weeklyEnabledUsers.length > 0) {
    const recentWeeklyByUser = await prisma.briefDelivery.groupBy({
      by: ["userId"],
      where: {
        briefType: "weekly",
        status: "sent",
        createdAt: { gte: sevenDaysAgo },
      },
    });
    const usersWithWeeklyBrief = new Set(recentWeeklyByUser.map((r) => r.userId));
    const missingWeekly = weeklyEnabledUsers.filter((u) => !usersWithWeeklyBrief.has(u.id));

    if (missingWeekly.length > 0) {
      const ratio = missingWeekly.length / weeklyEnabledUsers.length;
      findings.push({
        severity: ratio > 0.5 ? "critical" : "warning",
        category: "brief_gap",
        title: `${missingWeekly.length} user(s) missing weekly briefs for 7+ days`,
        description: `${missingWeekly.length} of ${weeklyEnabledUsers.length} eligible users (monitoring on, Gmail connected) have not received a weekly brief in the last 7 days.`,
        affectedUsers: missingWeekly.map((u) => ({ id: u.id, name: u.name, email: u.email })),
        metrics: {
          enabledCount: weeklyEnabledUsers.length,
          missingCount: missingWeekly.length,
          missingRatio: Math.round(ratio * 100) + "%",
          windowDays: 7,
          briefType: "weekly",
        },
      });
    }
  }

  // If no problems found, emit an OK
  if (findings.length === 0) {
    const dailyCount = dailyEnabledUsers.length;
    const weeklyCount = weeklyEnabledUsers.length;
    findings.push({
      severity: "ok",
      category: "brief_gap",
      title: "All briefs delivering on schedule",
      description: `${dailyCount} daily and ${weeklyCount} weekly eligible user(s) are all receiving briefs on schedule.`,
      affectedUsers: [],
      metrics: { dailyEligible: dailyCount, weeklyEligible: weeklyCount },
    });
  }

  return findings;
}

export async function checkStaleConnections(): Promise<Finding[]> {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  const activeConnections = await prisma.emailConnection.findMany({
    where: { status: "ACTIVE", user: { role: "USER" } },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });

  if (activeConnections.length === 0) {
    return [{
      severity: "ok",
      category: "stale_connection",
      title: "No active connections to check",
      description: "No active Gmail connections found.",
      affectedUsers: [],
      metrics: { activeConnections: 0 },
    }];
  }

  const recentEmailsByUser = await prisma.processedEmail.groupBy({
    by: ["userId"],
    where: { createdAt: { gte: threeDaysAgo } },
  });
  const usersWithRecentEmails = new Set(recentEmailsByUser.map((r) => r.userId));

  const stale = activeConnections.filter((c) => !usersWithRecentEmails.has(c.userId));

  if (stale.length === 0) {
    return [{
      severity: "ok",
      category: "stale_connection",
      title: "All connections active and processing",
      description: `All ${activeConnections.length} active Gmail connection(s) have processed emails in the last 3 days.`,
      affectedUsers: [],
      metrics: { activeConnections: activeConnections.length },
    }];
  }

  const ratio = stale.length / activeConnections.length;
  return [{
    severity: ratio > 0.5 ? "critical" : "warning",
    category: "stale_connection",
    title: `${stale.length} active connection(s) with no emails in 3 days`,
    description: `${stale.length} of ${activeConnections.length} active Gmail connections have not produced any processed emails in the last 3 days. These users may not be receiving monitoring.`,
    affectedUsers: stale.map((c) => ({ id: c.userId, name: c.user.name, email: c.user.email })),
    metrics: {
      activeConnections: activeConnections.length,
      staleCount: stale.length,
      staleRatio: Math.round(ratio * 100) + "%",
      windowDays: 3,
    },
  }];
}

export async function checkAiFailureSpike(): Promise<Finding[]> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [recent, baseline] = await Promise.all([
    prisma.aICallLog.groupBy({
      by: ["success"],
      where: { createdAt: { gte: oneDayAgo } },
      _count: true,
    }),
    prisma.aICallLog.groupBy({
      by: ["success"],
      where: { createdAt: { gte: sevenDaysAgo } },
      _count: true,
    }),
  ]);

  const recentTotal = recent.reduce((sum, r) => sum + r._count, 0);
  const recentFails = recent.find((r) => r.success === false)?._count ?? 0;
  const baselineTotal = baseline.reduce((sum, r) => sum + r._count, 0);
  const baselineFails = baseline.find((r) => r.success === false)?._count ?? 0;

  if (recentTotal < 5) {
    return [{
      severity: "ok",
      category: "ai_failure_spike",
      title: "AI failure rate normal (insufficient data)",
      description: `Only ${recentTotal} AI call(s) in the last 24 hours. Not enough data to evaluate.`,
      affectedUsers: [],
      metrics: { recentTotal },
    }];
  }

  const recentRate = recentFails / recentTotal;
  const baselineRate = baselineTotal > 0 ? baselineFails / baselineTotal : 0;
  const recentPct = Math.round(recentRate * 100);
  const baselinePct = Math.round(baselineRate * 100);

  const severity: Finding["severity"] =
    recentRate > 0.2 ? "critical" :
    recentRate > 0.1 || (baselineRate > 0 && recentRate > baselineRate * 2) ? "warning" :
    "ok";

  const title = severity === "critical"
    ? `AI failure rate at ${recentPct}% (24h)`
    : severity === "warning"
    ? `AI failure rate elevated at ${recentPct}% (24h)`
    : "AI failure rate normal";

  const suffix = severity === "ok" ? "Within normal range." : `7-day baseline: ${baselinePct}%.`;

  return [{
    severity,
    category: "ai_failure_spike",
    title,
    description: `${recentFails} of ${recentTotal} AI calls failed in the last 24 hours (${recentPct}%). ${suffix}`,
    affectedUsers: [],
    metrics: {
      recentFailures: recentFails,
      recentTotal,
      recentRate: recentPct + "%",
      baselineRate: baselinePct + "%",
    },
  }];
}

export async function checkBounceSpike(): Promise<Finding[]> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [recentForwarded, recentBounced, baselineForwarded, baselineBounced] = await Promise.all([
    prisma.processedEmail.count({ where: { forwarded: true, createdAt: { gte: oneDayAgo } } }),
    prisma.processedEmail.count({ where: { forwarded: true, deliveryStatus: "bounced", createdAt: { gte: oneDayAgo } } }),
    prisma.processedEmail.count({ where: { forwarded: true, createdAt: { gte: sevenDaysAgo } } }),
    prisma.processedEmail.count({ where: { forwarded: true, deliveryStatus: "bounced", createdAt: { gte: sevenDaysAgo } } }),
  ]);

  if (recentForwarded < 5) {
    return [{
      severity: "ok",
      category: "bounce_spike",
      title: "Email bounce rate normal (insufficient data)",
      description: `Only ${recentForwarded} forwarded email(s) in the last 24 hours. Not enough data to evaluate.`,
      affectedUsers: [],
      metrics: { recentForwarded },
    }];
  }

  const recentRate = recentBounced / recentForwarded;
  const baselineRate = baselineForwarded > 0 ? baselineBounced / baselineForwarded : 0;
  const recentPct = Math.round(recentRate * 100);
  const baselinePct = Math.round(baselineRate * 100);

  const severity: Finding["severity"] =
    recentRate > 0.1 ? "critical" :
    (baselineRate > 0 && recentRate > baselineRate * 2) ? "warning" :
    "ok";

  const title = severity === "critical"
    ? `Email bounce rate at ${recentPct}% (24h)`
    : severity === "warning"
    ? `Email bounce rate elevated at ${recentPct}% (24h)`
    : "Email bounce rate normal";

  const description = severity === "critical"
    ? `${recentBounced} of ${recentForwarded} forwarded emails bounced in the last 24 hours. 7-day baseline: ${baselinePct}%.`
    : severity === "warning"
    ? `${recentBounced} of ${recentForwarded} forwarded emails bounced in the last 24 hours (2x+ above 7-day baseline of ${baselinePct}%).`
    : `${recentBounced} of ${recentForwarded} forwarded emails bounced in the last 24 hours (${recentPct}%). Within normal range.`;

  return [{
    severity,
    category: "bounce_spike",
    title,
    description,
    affectedUsers: [],
    metrics: {
      recentBounced,
      recentForwarded,
      recentRate: recentPct + "%",
      baselineRate: baselinePct + "%",
    },
  }];
}

export async function checkPendingBriefs(): Promise<Finding[]> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Check if any briefs have been sent recently
  const recentBriefCount = await prisma.briefDelivery.count({
    where: { status: "sent", createdAt: { gte: sevenDaysAgo } },
  });

  if (recentBriefCount === 0) {
    return [{
      severity: "ok",
      category: "pending_brief",
      title: "No briefs sent recently",
      description: "No brief deliveries in the last 7 days. This check is not applicable.",
      affectedUsers: [],
      metrics: { recentBriefs: 0 },
    }];
  }

  const stuckBriefs = await prisma.briefDelivery.findMany({
    where: {
      status: "sent",
      deliveryStatus: "pending",
      createdAt: { lt: oneDayAgo },
    },
    select: {
      id: true,
      briefType: true,
      createdAt: true,
      userId: true,
      user: { select: { name: true, email: true } },
    },
    take: 50,
  });

  if (stuckBriefs.length === 0) {
    return [{
      severity: "ok",
      category: "pending_brief",
      title: "No stuck brief deliveries",
      description: `All ${recentBriefCount} recent brief(s) have received delivery status updates within 24 hours.`,
      affectedUsers: [],
      metrics: { recentBriefs: recentBriefCount },
    }];
  }

  const uniqueUsers = new Map<string, { id: string; name: string; email: string }>();
  for (const b of stuckBriefs) {
    if (!uniqueUsers.has(b.userId)) {
      uniqueUsers.set(b.userId, { id: b.userId, name: b.user.name, email: b.user.email });
    }
  }

  return [{
    severity: "warning",
    category: "pending_brief",
    title: `${stuckBriefs.length} brief delivery(s) stuck in pending for 24h+`,
    description: `${stuckBriefs.length} BriefDelivery records have status=sent but deliveryStatus=pending for over 24 hours. This may indicate Resend webhooks are not being received.`,
    affectedUsers: Array.from(uniqueUsers.values()),
    metrics: {
      stuckCount: stuckBriefs.length,
      uniqueUsers: uniqueUsers.size,
    },
  }];
}

export async function checkGmailQuota(): Promise<Finding[]> {
  const { getPausedUsers } = await import("@/server/gmail/quota-tracker");
  const paused = getPausedUsers();

  if (paused.length === 0) {
    return [{
      severity: "ok",
      category: "gmail_quota",
      title: "No users quota-paused",
      description: "No users are currently paused due to Gmail API quota limits.",
      affectedUsers: [],
      metrics: {},
    }];
  }

  // Look up user details
  const userIds = paused.map((p) => p.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  return [{
    severity: "info",
    category: "gmail_quota",
    title: `${paused.length} user(s) paused due to Gmail API quota`,
    description: `${paused.length} user(s) hit their daily Gmail API quota and are temporarily paused. They will auto-resume at midnight UTC.`,
    affectedUsers: paused.map((p) => {
      const u = userMap.get(p.userId);
      return { id: p.userId, name: u?.name ?? "Unknown", email: u?.email ?? "unknown" };
    }),
    metrics: {
      pausedCount: paused.length,
      ...Object.fromEntries(paused.map((p) => [`pausedUntil_${p.userId.slice(0, 8)}`, p.pausedUntil.toISOString()])),
    },
  }];
}

export async function checkAiLatency(): Promise<Finding[]> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [recentAvg, baselineAvg] = await Promise.all([
    prisma.aICallLog.aggregate({
      _avg: { durationMs: true },
      _count: true,
      where: { createdAt: { gte: oneDayAgo }, success: true },
    }),
    prisma.aICallLog.aggregate({
      _avg: { durationMs: true },
      _count: true,
      where: { createdAt: { gte: sevenDaysAgo }, success: true },
    }),
  ]);

  const recentMs = recentAvg._avg.durationMs;
  const baselineMs = baselineAvg._avg.durationMs;

  if (!recentMs || !baselineMs || recentAvg._count < 5) {
    return [{
      severity: "ok",
      category: "ai_latency",
      title: "AI response times normal (insufficient data)",
      description: `Only ${recentAvg._count} successful AI call(s) in the last 24 hours. Not enough data to evaluate latency trends.`,
      affectedUsers: [],
      metrics: { recentCalls: recentAvg._count },
    }];
  }

  const ratio = recentMs / baselineMs;
  const ratioStr = ratio.toFixed(1) + "x";

  const severity: Finding["severity"] =
    ratio >= 5 ? "critical" :
    ratio >= 3 ? "warning" :
    "ok";

  const title = severity === "ok"
    ? "AI response times normal"
    : `AI latency ${ratioStr} above baseline`;

  const desc = `Average AI call duration (24h): ${Math.round(recentMs)}ms vs 7-day baseline of ${Math.round(baselineMs)}ms (${ratioStr}).`;

  return [{
    severity,
    category: "ai_latency",
    title,
    description: severity === "ok" ? `${desc} Within normal range.` : desc,
    affectedUsers: [],
    metrics: {
      recentAvgMs: Math.round(recentMs),
      baselineAvgMs: Math.round(baselineMs),
      ratio: ratioStr,
      recentCalls: recentAvg._count,
    },
  }];
}

// ---------------------------------------------------------------------------
// Context file generation
// ---------------------------------------------------------------------------

export async function generateContextFile(
  findings: Finding[],
  runId: string,
): Promise<string> {
  const now = new Date();
  const config = await getConfig();
  const redisHealth = await checkRedisHealth().catch(() => null);

  const [totalUsers, activeConnections, emailsProcessed24h] = await Promise.all([
    prisma.user.count(),
    prisma.emailConnection.count({ where: { status: "ACTIVE" } }),
    prisma.processedEmail.count({
      where: { createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
    }),
  ]);

  const workerStatus = redisHealth?.worker?.status ?? "unknown";
  const workerHeartbeat = redisHealth?.worker?.lastHeartbeat ?? "unknown";

  const lines: string[] = [];
  lines.push(`# SANE Diagnostic Report: ${now.toISOString().slice(0, 10)}`);
  lines.push(`Run ID: ${runId}`);
  lines.push(`Generated: ${now.toISOString()}`);
  lines.push("");
  lines.push("## Instructions");
  lines.push("You are analyzing diagnostic findings from the SANE application (Next.js/tRPC/Prisma/BullMQ).");
  lines.push("Each finding includes the category, affected data, and relevant code paths.");
  lines.push("Investigate each finding, identify root causes, and propose fixes.");
  lines.push("Start by reading the project memory at .claude/projects/.../memory/MEMORY.md and memory/architecture.md for codebase context.");
  lines.push("");
  lines.push("## System State");
  lines.push(`- Users: ${totalUsers} total, ${activeConnections} active Gmail connections`);
  lines.push(`- Emails processed (24h): ${emailsProcessed24h}`);
  lines.push(`- AI provider: ${config.aiProvider ?? "not configured"}/${config.aiModel ?? "none"}`);
  lines.push(`- Worker: ${workerStatus}, last heartbeat ${workerHeartbeat}`);
  lines.push(`- Monitoring: ${config.isMonitoringEnabled ? "enabled" : "disabled"}`);

  const okFindings = findings.filter((f) => f.severity === "ok");
  const problemFindings = findings.filter((f) => f.severity !== "ok");

  // Passing checks summary
  if (okFindings.length > 0) {
    lines.push("");
    lines.push("## Passing Checks");
    for (const f of okFindings) {
      lines.push(`- **${f.category}**: ${f.title}`);
    }
  }

  if (problemFindings.length === 0) {
    lines.push("");
    lines.push("## Findings");
    lines.push("No anomalies detected. All checks passed.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("## Findings");

  for (const finding of problemFindings) {
    lines.push("");
    lines.push(`### [${finding.severity.toUpperCase()}] ${finding.title}`);
    lines.push(`Category: ${finding.category}`);
    lines.push(`Detected: ${now.toISOString()}`);
    lines.push("");
    lines.push(finding.description);

    if (finding.affectedUsers.length > 0) {
      lines.push("");
      lines.push("**Affected Users:**");
      lines.push("| ID | Name | Email |");
      lines.push("|----|------|-------|");
      for (const u of finding.affectedUsers) {
        lines.push(`| ${u.id.slice(0, 8)}... | ${u.name} | ${u.email} |`);
      }
    }

    if (Object.keys(finding.metrics).length > 0) {
      lines.push("");
      lines.push("**Metrics:**");
      lines.push("| Metric | Value |");
      lines.push("|--------|-------|");
      for (const [key, value] of Object.entries(finding.metrics)) {
        lines.push(`| ${key} | ${value} |`);
      }
    }

    const ctx = CATEGORY_CONTEXT[finding.category];
    if (ctx) {
      lines.push("");
      lines.push("**Code Paths:**");
      for (const p of ctx.codePaths) {
        lines.push(`- ${p}`);
      }
      lines.push("");
      lines.push("**Investigation Steps:**");
      for (let i = 0; i < ctx.steps.length; i++) {
        lines.push(`${i + 1}. ${ctx.steps[i]}`);
      }
    }

    lines.push("");
    lines.push("---");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Run all diagnostic checks and return findings
// ---------------------------------------------------------------------------

export async function runAllDiagnosticChecks(): Promise<Finding[]> {
  const results = await Promise.allSettled([
    checkStaleConnections(),
    checkGmailQuota(),
    checkAiFailureSpike(),
    checkAiLatency(),
    checkBounceSpike(),
    checkBriefGaps(),
    checkPendingBriefs(),
  ]);

  const checkNames = [
    "stale_connection", "gmail_quota", "ai_failure_spike",
    "ai_latency", "bounce_spike", "brief_gap", "pending_brief",
  ];

  const allFindings: Finding[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      allFindings.push(...result.value);
    } else {
      logger.error(TAG, `Check ${checkNames[i]} failed: ${errorMessage(result.reason)}`);
    }
  }

  return allFindings;
}

// ---------------------------------------------------------------------------
// Severity counting helper
// ---------------------------------------------------------------------------

export function countSeverities(findings: Finding[]) {
  let ok = 0, critical = 0, warning = 0, info = 0;
  for (const f of findings) {
    if (f.severity === "ok") ok++;
    else if (f.severity === "critical") critical++;
    else if (f.severity === "warning") warning++;
    else if (f.severity === "info") info++;
  }
  return { ok, critical, warning, info };
}

// ---------------------------------------------------------------------------
// Execute a full diagnostic run with DB audit trail + AICallLog
// ---------------------------------------------------------------------------

export async function executeDiagnosticRun(
  tag: string,
  options?: { rethrow?: boolean },
): Promise<Finding[]> {
  const startTime = Date.now();
  const run = await prisma.diagnosticRun.create({
    data: { status: "running" },
  });

  try {
    const allFindings = await runAllDiagnosticChecks();

    if (allFindings.length > 0) {
      await prisma.diagnosticFinding.createMany({
        data: allFindings.map((f) => ({
          runId: run.id,
          severity: f.severity,
          category: f.category,
          title: f.title,
          description: f.description,
          affectedUsers: f.affectedUsers,
          metrics: f.metrics,
        })),
      });
    }

    const contextFile = await generateContextFile(allFindings, run.id);
    const counts = countSeverities(allFindings);

    const durationMs = Date.now() - startTime;
    await prisma.diagnosticRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        findingCount: allFindings.length,
        okCount: counts.ok,
        criticalCount: counts.critical,
        warningCount: counts.warning,
        infoCount: counts.info,
        durationMs,
        contextFile,
      },
    });

    logger.info(tag, `Diagnostics: ${allFindings.length} finding(s) (${counts.ok} ok, ${counts.critical} critical, ${counts.warning} warning, ${counts.info} info) in ${durationMs}ms`);

    logAICall({
      userId: null,
      action: "daily-diagnostics",
      provider: "system",
      model: "diagnostics",
      success: true,
      durationMs,
      inputTokens: 0,
      outputTokens: 0,
      prompt: `Diagnostics run (${tag}): ${allFindings.length} check(s) executed`,
      response: JSON.stringify({
        runId: run.id,
        findings: allFindings.filter((f) => f.severity !== "ok").map((f) => ({
          severity: f.severity,
          category: f.category,
          title: f.title,
        })),
      }),
      metadata: { runId: run.id, findingCount: allFindings.length, ...counts },
    });

    return allFindings;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    await prisma.diagnosticRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        error: errorMessage(err),
        durationMs,
      },
    });

    logAICall({
      userId: null,
      action: "daily-diagnostics",
      provider: "system",
      model: "diagnostics",
      success: false,
      durationMs,
      inputTokens: 0,
      outputTokens: 0,
      prompt: `Diagnostics run failed (${tag})`,
      response: null,
      errorType: "provider-error",
      errorMessage: errorMessage(err).slice(0, 2000),
      metadata: { runId: run.id },
    });

    logger.error(tag, `Diagnostics failed: ${errorMessage(err)}`);
    if (options?.rethrow) throw err;
    return [];
  }
}
