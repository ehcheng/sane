import { prisma } from "@/server/db/prisma";
import { getConfig } from "@/server/config";
import { checkRedisHealth } from "@/lib/redis-health";
import logger from "@/lib/logger";
import { errorMessage } from "@/lib/error-message";
import { aggregateBriefDeliveries } from "@/lib/brief-stats";
import type { HeartbeatSection, HeartbeatStatRow } from "@/server/email/templates/admin-heartbeat";
import { executeDiagnosticRun, countSeverities } from "./diagnostic-checks";

const TAG = "admin-heartbeat";

/**
 * Daily admin report job.
 * Gathers system-wide aggregate stats, runs diagnostic checks,
 * and sends a single combined email to all admins.
 */
export async function processAdminHeartbeat(): Promise<void> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  logger.info(TAG, "Generating daily admin report...");

  // ------------------------------------------------------------------
  // 1. Gather heartbeat stats + run diagnostics in parallel
  // ------------------------------------------------------------------

  const [heartbeatData, diagnosticFindings] = await Promise.all([
    gatherHeartbeatStats(now, oneDayAgo),
    executeDiagnosticRun(TAG),
  ]);

  const { sections, errors, config } = heartbeatData;
  const diagCounts = countSeverities(diagnosticFindings);
  const hasCritical = diagCounts.critical > 0;

  // ------------------------------------------------------------------
  // 2. Send to admin(s)
  // ------------------------------------------------------------------

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: { email: true },
  });

  if (admins.length === 0) {
    logger.warn(TAG, "No admin users found, skipping daily report email");
    return;
  }

  const dateRange = `${oneDayAgo.toISOString().slice(0, 10)} to ${now.toISOString().slice(0, 10)}`;
  const headingText = hasCritical ? "Action Required" : "All Systems Normal";

  try {
    const { render } = await import("@react-email/components");
    const { AdminHeartbeat } = await import("@/server/email/templates/admin-heartbeat");
    const { getResend, getEmailConfig, throttleSend } = await import("@/server/email/sender");

    const { fromAddress, brandName } = await getEmailConfig();
    const appUrl = config.appUrl ?? process.env.NEXTAUTH_URL ?? "";
    const insightsUrl = `${appUrl}/admin/insights`;

    const nonOkFindings = diagnosticFindings
      .filter((f): f is typeof f & { severity: "critical" | "warning" | "info" } => f.severity !== "ok")
      .map((f) => ({
        severity: f.severity,
        title: f.title,
        affectedUserCount: f.affectedUsers.length,
      }));

    const html = await render(
      AdminHeartbeat({
        brandName,
        dateRange,
        headingText,
        sections,
        errors,
        diagnosticCounts: { critical: diagCounts.critical, warning: diagCounts.warning, info: diagCounts.info },
        diagnosticFindings: nonOkFindings,
        insightsUrl,
      }),
    );

    const resend = await getResend();
    const adminEmails = admins.map((a) => a.email);

    const subject = hasCritical
      ? `[${brandName}] Daily Report: Action Required [CRITICAL]`
      : `[${brandName}] Daily Report: All Systems Normal`;

    await throttleSend();
    const { error } = await resend.emails.send({
      from: fromAddress,
      to: adminEmails,
      subject,
      html,
    });

    if (error) {
      logger.error(TAG, `Failed to send daily report email: ${error.message}`);
      return;
    }

    logger.info(TAG, `Daily report email sent to ${adminEmails.length} admin(s)`);
  } catch (err) {
    logger.error(TAG, `Daily report email failed: ${errorMessage(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Heartbeat stats gathering (extracted from the old processAdminHeartbeat)
// ---------------------------------------------------------------------------

async function gatherHeartbeatStats(now: Date, oneDayAgo: Date) {
  const [
    totalUsers,
    warningUsers,
    deactivatedUsers,
    activeConnections,
    emailsLast24h,
    forwardedLast24h,
    dailyBriefs,
    weeklyBriefs,
    feedbackLast24h,
    openAlerts,
    openAlertCount,
    redisHealth,
    config,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { accountStatus: "WARNING" } }),
    prisma.user.count({ where: { accountStatus: "DEACTIVATED" } }),
    prisma.emailConnection.count({ where: { status: "ACTIVE" } }),
    prisma.processedEmail.count({ where: { createdAt: { gte: oneDayAgo } } }),
    prisma.processedEmail.count({ where: { createdAt: { gte: oneDayAgo }, forwarded: true } }),
    prisma.briefDelivery.findMany({
      where: { briefType: "daily", createdAt: { gte: oneDayAgo } },
      select: { status: true, deliveryStatus: true },
    }),
    prisma.briefDelivery.findMany({
      where: { briefType: "weekly", createdAt: { gte: oneDayAgo } },
      select: { status: true, deliveryStatus: true },
    }),
    prisma.processedEmail.count({
      where: { createdAt: { gte: oneDayAgo }, userFeedback: { not: null } },
    }),
    prisma.adminAlert.findMany({
      where: { resolvedAt: null },
      select: { type: true, severity: true, title: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.adminAlert.count({ where: { resolvedAt: null } }),
    checkRedisHealth().catch(() => null),
    getConfig(),
  ]);

  const dailyStats = aggregateBriefDeliveries(dailyBriefs);
  const weeklyStats = aggregateBriefDeliveries(weeklyBriefs);

  const avgProcessed = totalUsers > 0 ? (emailsLast24h / totalUsers).toFixed(1) : "0";
  const avgForwarded = totalUsers > 0 ? (forwardedLast24h / totalUsers).toFixed(1) : "0";

  let dbStatus = "ok";
  let dbLatencyMs = 0;
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - start;
  } catch {
    dbStatus = "error";
  }

  // ------------------------------------------------------------------
  // Build sections
  // ------------------------------------------------------------------

  const sections: HeartbeatSection[] = [];

  sections.push({
    title: "Users & Connections",
    rows: [
      { label: "Total users", value: String(totalUsers) },
      { label: "Warning (inactive)", value: String(warningUsers), highlight: warningUsers > 0 ? "yellow" as const : undefined },
      { label: "Deactivated", value: String(deactivatedUsers), highlight: deactivatedUsers > 0 ? "red" as const : undefined },
      { label: "Active Gmail connections", value: String(activeConnections) },
      {
        label: "Monitoring",
        value: config.isMonitoringEnabled ? "Enabled" : "DISABLED",
        highlight: config.isMonitoringEnabled ? "green" : "red",
      },
    ],
  });

  sections.push({
    title: "Email Processing (24h)",
    rows: [
      { label: "Emails processed", value: String(emailsLast24h) },
      { label: "Emails forwarded", value: String(forwardedLast24h) },
      { label: "Avg processed/user", value: avgProcessed },
      { label: "Avg forwarded/user", value: avgForwarded },
      { label: "Feedback received", value: String(feedbackLast24h) },
    ],
  });

  // Daily Briefs (24h)
  const dailyRows: HeartbeatStatRow[] = [
    { label: "Expected", value: String(dailyStats.total) },
    { label: "Sent", value: String(dailyStats.sent) },
    { label: "Skipped (no content)", value: String(dailyStats.skipped) },
  ];
  if (dailyStats.failed > 0) {
    dailyRows.push({ label: "Failed", value: String(dailyStats.failed), highlight: "red" });
  } else {
    dailyRows.push({ label: "Failed", value: "0" });
  }
  dailyRows.push({
    label: "Delivered",
    value: dailyStats.sent > 0 ? `${dailyStats.delivered}/${dailyStats.sent}` : "0",
    highlight: dailyStats.sent > 0 && dailyStats.delivered < dailyStats.sent ? "yellow" : undefined,
  });
  if (dailyStats.bounced > 0) {
    dailyRows.push({ label: "Bounced", value: String(dailyStats.bounced), highlight: "red" });
  }
  sections.push({ title: "Daily Briefs (24h)", rows: dailyRows });

  // Weekly Briefs (24h)
  const weeklyRows: HeartbeatStatRow[] = [
    { label: "Expected", value: String(weeklyStats.total) },
    { label: "Sent", value: String(weeklyStats.sent) },
    { label: "Skipped (no content)", value: String(weeklyStats.skipped) },
  ];
  if (weeklyStats.failed > 0) {
    weeklyRows.push({ label: "Failed", value: String(weeklyStats.failed), highlight: "red" });
  } else {
    weeklyRows.push({ label: "Failed", value: "0" });
  }
  weeklyRows.push({
    label: "Delivered",
    value: weeklyStats.sent > 0 ? `${weeklyStats.delivered}/${weeklyStats.sent}` : "0",
    highlight: weeklyStats.sent > 0 && weeklyStats.delivered < weeklyStats.sent ? "yellow" : undefined,
  });
  if (weeklyStats.bounced > 0) {
    weeklyRows.push({ label: "Bounced", value: String(weeklyStats.bounced), highlight: "red" });
  }
  sections.push({ title: "Weekly Briefs (24h)", rows: weeklyRows });

  // System Health
  const redisStatus = redisHealth?.redis?.status ?? "unknown";
  const workerStatus = redisHealth?.worker?.status ?? "unknown";
  sections.push({
    title: "System Health",
    rows: [
      {
        label: "Database",
        value: dbStatus === "ok" ? `OK (${dbLatencyMs}ms)` : "ERROR",
        highlight: dbStatus === "ok" ? "green" : "red",
      },
      {
        label: "Redis",
        value: redisStatus === "ok" ? `OK (${redisHealth?.redis?.latencyMs ?? "?"}ms)` : redisStatus.toUpperCase(),
        highlight: redisStatus === "ok" ? "green" : "red",
      },
      {
        label: "Worker",
        value: workerStatus === "ok" ? "OK" : workerStatus.toUpperCase(),
        highlight: workerStatus === "ok" ? "green" : workerStatus === "stale" ? "yellow" : "red",
      },
      {
        label: "AI Provider",
        value: config.aiProvider ? `${config.aiProvider} / ${config.aiModel}` : "Not configured",
        highlight: config.aiProvider ? undefined : "yellow",
      },
    ],
  });

  // Open Alerts
  if (openAlertCount > 0) {
    const alertTitle = openAlertCount > openAlerts.length
      ? `Open Alerts (${openAlertCount}, showing latest ${openAlerts.length})`
      : `Open Alerts (${openAlertCount})`;
    sections.push({
      title: alertTitle,
      rows: openAlerts.map((a) => {
        const ts = new Date(a.createdAt).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
        return {
          label: `[${a.severity.toUpperCase()}] ${a.type}`,
          value: `${a.title} (${ts})`,
          highlight: a.severity === "critical" ? "red" as const : a.severity === "warning" ? "yellow" as const : undefined,
        };
      }),
    });
  }

  // Collect error strings
  const errors: string[] = [];
  if (dailyStats.failed > 0) errors.push(`${dailyStats.failed} daily brief(s) failed to send`);
  if (weeklyStats.failed > 0) errors.push(`${weeklyStats.failed} weekly brief(s) failed to send`);
  if (dailyStats.bounced > 0) errors.push(`${dailyStats.bounced} daily brief(s) bounced`);
  if (weeklyStats.bounced > 0) errors.push(`${weeklyStats.bounced} weekly brief(s) bounced`);
  if (dailyStats.pending > 0) errors.push(`${dailyStats.pending} daily brief(s) stuck in pending (job may have crashed)`);
  if (weeklyStats.pending > 0) errors.push(`${weeklyStats.pending} weekly brief(s) stuck in pending (job may have crashed)`);
  if (dbStatus !== "ok") errors.push("Database health check failed");
  if (redisStatus !== "ok") errors.push(`Redis status: ${redisStatus}`);
  if (workerStatus !== "ok") errors.push(`Worker status: ${workerStatus}`);
  if (!config.isMonitoringEnabled) errors.push("Global monitoring is DISABLED");

  return { sections, errors, config };
}
