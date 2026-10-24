"use client";

import { useState } from "react";
import { relativeTime } from "@/lib/utils";
import { fmtTime } from "@/components/admin/feedback-helpers";
import { trpc } from "@/lib/trpc";
import { toast } from "@/components/ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";

// ---------------------------------------------------------------------------
// Status dot helper
// ---------------------------------------------------------------------------

function StatusDot({ color }: { color: "green" | "red" | "yellow" | "gray" }) {
  const cls: Record<string, string> = {
    green: "bg-green-500",
    red: "bg-red-500",
    yellow: "bg-yellow-500",
    gray: "bg-gray-400",
  };
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${cls[color]}`}
      aria-hidden
    />
  );
}

function dotColor(status: string): "green" | "red" | "yellow" | "gray" {
  switch (status) {
    case "ok":
      return "green";
    case "error":
      return "red";
    case "stale":
      return "yellow";
    default:
      return "gray";
  }
}

// ---------------------------------------------------------------------------
// Failed Job Row
// ---------------------------------------------------------------------------

function FailedJobRow({ job }: { job: { id: string | undefined; name: string; failedAt: string | null; error: string | null } }) {
  const [errorExpanded, setErrorExpanded] = useState(false);
  const utils = trpc.useUtils();
  const dismiss = trpc.admin.dismissFailedJob.useMutation({
    onSuccess: () => utils.admin.systemStatus.invalidate(),
  });

  return (
    <div className="rounded border border-red-200 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950">
      <div className="flex items-start gap-2">
        <span className="font-mono font-medium">{job.name}</span>
        {job.failedAt && (
          <span className="whitespace-nowrap text-muted-foreground" title={job.failedAt}>
            {fmtTime(job.failedAt)} ({relativeTime(job.failedAt)})
          </span>
        )}
        {job.id && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-5 shrink-0 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => dismiss.mutate({ jobId: job.id! })}
            disabled={dismiss.isPending}
          >
            {dismiss.isPending ? "..." : "Dismiss"}
          </Button>
        )}
      </div>
      {job.error && (
        <button
          className="mt-1 w-full text-left"
          onClick={() => setErrorExpanded(!errorExpanded)}
        >
          <p className={`text-xs text-red-600 dark:text-red-400 ${errorExpanded ? "whitespace-pre-wrap" : "line-clamp-1"}`}>
            {job.error}
          </p>
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alert Banner
// ---------------------------------------------------------------------------

function AlertRow({ alert, onDismiss, dismissPending }: {
  alert: { id: string; severity: string; title: string; message: string; createdAt: string | Date };
  onDismiss: () => void;
  dismissPending: boolean;
}) {
  const [msgExpanded, setMsgExpanded] = useState(false);
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded border p-2 text-sm ${
        alert.severity === "critical"
          ? "border-red-200 bg-white dark:border-red-900 dark:bg-red-950/50"
          : alert.severity === "warning"
          ? "border-amber-200 bg-white dark:border-amber-900 dark:bg-amber-950/50"
          : "border-blue-200 bg-white dark:border-blue-900 dark:bg-blue-950/50"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              alert.severity === "critical"
                ? "bg-red-500"
                : alert.severity === "warning"
                ? "bg-amber-500"
                : "bg-blue-500"
            }`}
          />
          <span className="font-medium">{alert.title}</span>
          <span className="text-xs text-muted-foreground">
            {relativeTime(alert.createdAt)}
          </span>
        </div>
        <button
          className="mt-0.5 w-full text-left"
          onClick={() => setMsgExpanded(!msgExpanded)}
        >
          <p className={`text-xs text-muted-foreground ${msgExpanded ? "whitespace-pre-wrap break-all" : "line-clamp-1"}`}>
            {alert.message}
          </p>
        </button>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 h-7 text-xs"
        onClick={onDismiss}
        disabled={dismissPending}
      >
        Dismiss
      </Button>
    </div>
  );
}

function AlertBanner() {
  const [expanded, setExpanded] = useState(false);
  const utils = trpc.useUtils();
  const alerts = trpc.admin.activeAlerts.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const resolveAlert = trpc.admin.resolveAlert.useMutation({
    onSuccess: () => utils.admin.activeAlerts.invalidate(),
    onError: (err) => toast({ title: "Failed to dismiss alert", description: err.message, variant: "destructive" }),
  });
  const resolveAll = trpc.admin.resolveAllAlerts.useMutation({
    onSuccess: () => {
      utils.admin.activeAlerts.invalidate();
      toast({ title: "All alerts dismissed" });
    },
    onError: (err) => toast({ title: "Failed to dismiss alerts", description: err.message, variant: "destructive" }),
  });

  if (!alerts.data || alerts.data.length === 0) return null;

  const criticalAlerts = alerts.data.filter((a) => a.severity === "critical");
  const warningAlerts = alerts.data.filter((a) => a.severity === "warning");
  const infoAlerts = alerts.data.filter((a) => a.severity === "info");

  const hasCritical = criticalAlerts.length > 0;
  const borderColor = hasCritical
    ? "border-red-500 bg-red-50 dark:bg-red-950/30"
    : "border-amber-500 bg-amber-50 dark:bg-amber-950/30";
  const iconColor = hasCritical ? "text-red-600" : "text-amber-600";

  const visibleCount = 3;
  const visibleAlerts = expanded
    ? alerts.data
    : alerts.data.slice(0, visibleCount);
  const hiddenCount = alerts.data.length - visibleCount;

  return (
    <div className={`rounded-lg border-2 ${borderColor} p-4 space-y-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-lg ${iconColor}`} aria-hidden>
            {hasCritical ? "\u26A0" : "\u26A0"}
          </span>
          <span className="font-semibold text-sm">
            {criticalAlerts.length > 0 && (
              <span className="text-red-600 dark:text-red-400">
                {criticalAlerts.length} critical
              </span>
            )}
            {criticalAlerts.length > 0 && warningAlerts.length > 0 && ", "}
            {warningAlerts.length > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                {warningAlerts.length} warning{warningAlerts.length !== 1 ? "s" : ""}
              </span>
            )}
            {(criticalAlerts.length > 0 || warningAlerts.length > 0) && infoAlerts.length > 0 && ", "}
            {infoAlerts.length > 0 && (
              <span className="text-blue-600 dark:text-blue-400">
                {infoAlerts.length} info
              </span>
            )}
          </span>
        </div>
        {alerts.data.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => resolveAll.mutate()}
            disabled={resolveAll.isPending}
          >
            Dismiss All
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {visibleAlerts.map((alert) => (
          <AlertRow
            key={alert.id}
            alert={alert}
            onDismiss={() => resolveAlert.mutate({ alertId: alert.id })}
            dismissPending={resolveAlert.isPending}
          />
        ))}
      </div>

      {hiddenCount > 0 && (
        <button
          className="text-xs text-muted-foreground underline hover:no-underline"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// System Status Card
// ---------------------------------------------------------------------------

function MetricValue({
  loading,
  error,
  children,
}: {
  loading: boolean;
  error: boolean;
  children: React.ReactNode;
}) {
  if (loading) {
    return <div className="mx-auto mt-1 h-5 w-10 animate-pulse rounded bg-muted" />;
  }
  if (error) {
    return <div className="text-lg font-semibold text-muted-foreground">...</div>;
  }
  return <>{children}</>;
}

function SystemStatusCard() {
  const systemStatus = trpc.admin.systemStatus.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const data = systemStatus.data;
  const loading = systemStatus.isLoading;
  const error = systemStatus.isError;

  /** Resolve a status dot color for a given service status string. */
  const serviceDot = (color: "green" | "red" | "yellow" | "gray") =>
    loading || error || !data ? "gray" : color;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>System Status</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() => systemStatus.refetch()}
          disabled={systemStatus.isRefetching}
        >
          {systemStatus.isRefetching ? "Refreshing..." : "Refresh"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Services row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-md border p-3 text-center text-xs">
          <div>
            <div className="font-medium text-muted-foreground flex items-center justify-center gap-1">
              <StatusDot color={serviceDot(dotColor(data?.database?.status ?? "unknown"))} />
              Database
            </div>
            <MetricValue loading={loading} error={error}>
              <div className="text-lg font-semibold">
                {data?.database?.status === "ok" ? `${data.database.latencyMs}ms` : data?.database?.status ?? "..."}
              </div>
            </MetricValue>
          </div>
          <div>
            <div className="font-medium text-muted-foreground flex items-center justify-center gap-1">
              <StatusDot color={serviceDot(dotColor(data?.redis?.status ?? "unknown"))} />
              Redis
            </div>
            <MetricValue loading={loading} error={error}>
              <div className="text-lg font-semibold">
                {data?.redis.status === "ok" ? `${data.redis.latencyMs}ms` : data?.redis.status ?? "..."}
              </div>
            </MetricValue>
          </div>
          <div>
            <div className="font-medium text-muted-foreground flex items-center justify-center gap-1">
              <StatusDot color={serviceDot(dotColor(data?.worker?.status ?? "unknown"))} />
              Worker
            </div>
            <MetricValue loading={loading} error={error}>
              <div className="text-lg font-semibold">{data ? relativeTime(data.worker.lastHeartbeat) : "..."}</div>
            </MetricValue>
          </div>
          <div>
            <div className="font-medium text-muted-foreground flex items-center justify-center gap-1">
              <StatusDot color={serviceDot(data?.queue ? data.queue.failed > 0 ? "yellow" : "green" : "gray")} />
              Queue
            </div>
            <MetricValue loading={loading} error={error}>
              <div className="text-lg font-semibold">{data?.queue ? "ok" : "n/a"}</div>
            </MetricValue>
          </div>
        </div>

        {/* Queue metrics row */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 rounded-md border p-3 text-center text-xs">
          <div>
            <div className="font-medium text-muted-foreground">Waiting</div>
            <MetricValue loading={loading} error={error}>
              <div className="text-lg font-semibold">{data?.queue?.waiting ?? "..."}</div>
            </MetricValue>
          </div>
          <div>
            <div className="font-medium text-muted-foreground">Active</div>
            <MetricValue loading={loading} error={error}>
              <div className="text-lg font-semibold">{data?.queue?.active ?? "..."}</div>
            </MetricValue>
          </div>
          <div>
            <div className="font-medium text-muted-foreground flex items-center justify-center gap-1">
              Delayed
              <TooltipProvider delayDuration={500}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-muted-foreground/40 text-[9px] leading-none text-muted-foreground/60">
                      i
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    Delayed jobs are scheduled to run in the future. This typically includes poll timers, one per user with active monitoring. A small number here is normal and expected.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <MetricValue loading={loading} error={error}>
              <div className="text-lg font-semibold">{data?.queue?.delayed ?? "..."}</div>
            </MetricValue>
          </div>
          <div>
            <div className="font-medium text-muted-foreground">Completed</div>
            <MetricValue loading={loading} error={error}>
              <div className="text-lg font-semibold">{data?.queue?.completed.toLocaleString() ?? "..."}</div>
            </MetricValue>
          </div>
          <div>
            <div className="font-medium text-muted-foreground">Failed</div>
            <MetricValue loading={loading} error={error}>
              <div className={`text-lg font-semibold ${data?.queue && data.queue.failed > 0 ? "text-red-500" : ""}`}>
                {data?.queue?.failed ?? "..."}
              </div>
            </MetricValue>
          </div>
        </div>

        {/* Error note */}
        {error && (
          <p className="text-xs text-red-500">
            Status check failed. Retrying...
          </p>
        )}

        {/* Recent failed jobs */}
        {data && data.recentFailed.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-sm font-medium text-red-500">Recent Failed Jobs</h4>
            <div className="space-y-1 text-xs">
              {data.recentFailed.map((job) => (
                <FailedJobRow key={job.id} job={job} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FeedbackAndRulesCards() {
  const feedbackStats = trpc.admin.feedbackStats.useQuery();
  const senderRuleStats = trpc.admin.senderRuleStats.useQuery();

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">AI Feedback</CardTitle>
        </CardHeader>
        <CardContent>
          {feedbackStats.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : feedbackStats.data ? (
            <div className="space-y-4 text-sm">
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Email AI</h4>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Feedback rate</span>
                    <span className="font-medium">{feedbackStats.data.feedbackRate}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-medium">{feedbackStats.data.total}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-green-600">Correct</span>
                    <span className="font-medium">{feedbackStats.data.correct}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-red-600">Wrong forward</span>
                    <span className="font-medium">{feedbackStats.data.wrongForward}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-red-600">Wrong skip</span>
                    <span className="font-medium">{feedbackStats.data.wrongSkip}</span>
                  </div>
                </div>
              </div>
              <div className="border-t pt-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Event AI</h4>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Feedback rate</span>
                    <span className="font-medium">{feedbackStats.data.eventFeedbackRate}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-medium">{feedbackStats.data.eventTotal}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-green-600">Correct</span>
                    <span className="font-medium">{feedbackStats.data.eventCorrect}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-red-600">Wrong event</span>
                    <span className="font-medium">{feedbackStats.data.eventWrongEvent}</span>
                  </div>
                </div>
              </div>
              {feedbackStats.data.formTotal > 0 && (
                <div className="border-t pt-3">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Form Feedback</h4>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total</span>
                      <span className="font-medium">{feedbackStats.data.formTotal}</span>
                    </div>
                    {feedbackStats.data.formBug > 0 && (
                      <div className="flex justify-between">
                        <span className="text-red-600">Bug</span>
                        <span className="font-medium">{feedbackStats.data.formBug}</span>
                      </div>
                    )}
                    {feedbackStats.data.formFeature > 0 && (
                      <div className="flex justify-between">
                        <span className="text-blue-600">Feature request</span>
                        <span className="font-medium">{feedbackStats.data.formFeature}</span>
                      </div>
                    )}
                    {feedbackStats.data.formUsability > 0 && (
                      <div className="flex justify-between">
                        <span className="text-amber-600">Usability</span>
                        <span className="font-medium">{feedbackStats.data.formUsability}</span>
                      </div>
                    )}
                    {feedbackStats.data.formEmailQuality > 0 && (
                      <div className="flex justify-between">
                        <span className="text-purple-600">Email quality</span>
                        <span className="font-medium">{feedbackStats.data.formEmailQuality}</span>
                      </div>
                    )}
                    {feedbackStats.data.formGeneral > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">General</span>
                        <span className="font-medium">{feedbackStats.data.formGeneral}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Sender Rules</CardTitle>
        </CardHeader>
        <CardContent>
          {senderRuleStats.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : senderRuleStats.data ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total rules</span>
                <span className="font-medium">{senderRuleStats.data.totalRules}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Always forward</span>
                <span className="font-medium">{senderRuleStats.data.alwaysForward}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Never forward</span>
                <span className="font-medium">{senderRuleStats.data.neverForward}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Users with rules</span>
                <span className="font-medium">{senderRuleStats.data.usersWithRules}</span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brief Delivery Report
// ---------------------------------------------------------------------------

function BriefDeliveryCard() {
  const report = trpc.admin.briefReport.useQuery({ days: 7 });

  if (!report.data || report.data.rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Brief Delivery Report</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {report.isLoading ? "Loading..." : "No brief deliveries in the last 7 days."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const { rows } = report.data;
  const hasIssues = rows.some((r) => r.failed > 0 || r.pending > 0 || (r.sent > 0 && r.bounced > 0));

  return (
    <Card className={hasIssues ? "border-red-500" : ""}>
      <CardHeader>
        <CardTitle>Brief Delivery Report (7 Days)</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-center">Expected</TableHead>
              <TableHead className="text-center">Sent</TableHead>
              <TableHead className="text-center">Skipped</TableHead>
              <TableHead className="text-center">Failed</TableHead>
              <TableHead className="text-center">Pending</TableHead>
              <TableHead className="text-center">Delivered</TableHead>
              <TableHead className="text-center">Bounced</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const rowHasIssue = row.failed > 0 || row.bounced > 0 || row.pending > 0;
              const pendingDelivery = row.sent > 0 && row.delivered < row.sent && row.bounced === 0;
              return (
                <TableRow key={`${row.date}:${row.briefType}`}>
                  <TableCell className="font-medium">{row.date}</TableCell>
                  <TableCell>
                    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                      row.briefType === "daily"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                        : "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                    }`}>
                      {row.briefType}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">{row.expected}</TableCell>
                  <TableCell className="text-center">{row.sent}</TableCell>
                  <TableCell className="text-center text-muted-foreground">{row.skipped}</TableCell>
                  <TableCell className={`text-center ${row.failed > 0 ? "text-red-600 font-bold" : ""}`}>
                    {row.failed}
                  </TableCell>
                  <TableCell className={`text-center ${row.pending > 0 ? "text-amber-600 font-bold" : ""}`}>
                    {row.pending}
                  </TableCell>
                  <TableCell className={`text-center ${
                    pendingDelivery ? "text-yellow-600" : row.delivered > 0 ? "text-green-600" : ""
                  }`}>
                    {row.delivered}
                    {pendingDelivery && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        /{row.sent}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className={`text-center ${row.bounced > 0 ? "text-red-600 font-bold" : ""}`}>
                    {row.bounced}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {rows.some((r) => r.errors.length > 0) && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={9} className="text-xs text-red-600">
                  {rows
                    .filter((r) => r.errors.length > 0)
                    .flatMap((r) => r.errors.map((e) => `[${r.date} ${r.briefType}] ${e}`))
                    .slice(0, 5)
                    .join(" | ")}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </CardContent>
    </Card>
  );
}

export default function AdminDashboardPage() {
  const globalConfig = trpc.admin.globalConfig.useQuery();
  const users = trpc.admin.users.useQuery();
  const tokenUsage = trpc.admin.tokenUsage.useQuery({ days: 30 });
  const tokenCosts = trpc.admin.tokenCostConfig.useQuery();
  const utils = trpc.useUtils();

  const totalUsers = users.data?.length ?? 0;
  const activeGmail = users.data?.filter((u) => u.emailConnection?.status === "ACTIVE").length ?? 0;
  // Skip household members to avoid double-counting (members share the primary's stats)
  const nonMembers = users.data?.filter((u) => u.householdRole !== "member") ?? [];
  const totalProcessed = nonMembers.reduce((sum, u) => sum + u._count.processedEmails, 0);
  const totalForwarded = nonMembers.reduce((sum, u) => sum + u.forwardedCount, 0);
  const totalAttachments = nonMembers.reduce((sum, u) => sum + u.attachmentCount, 0);
  const totalDelivered = nonMembers.reduce((sum, u) => sum + u.deliveredCount, 0);
  const totalBounced = nonMembers.reduce((sum, u) => sum + u.bouncedCount, 0);

  const tokenTotals = tokenUsage.data?.reduce(
    (acc, row) => ({
      tokensInput: acc.tokensInput + row.tokensInput,
      tokensOutput: acc.tokensOutput + row.tokensOutput,
      emailCount: acc.emailCount + row.emailCount,
      attachmentCount: acc.attachmentCount + row.attachmentCount,
    }),
    { tokensInput: 0, tokensOutput: 0, emailCount: 0, attachmentCount: 0 }
  ) ?? { tokensInput: 0, tokensOutput: 0, emailCount: 0, attachmentCount: 0 };

  const inputRate = tokenCosts.data?.inputCostPerMillion ?? null;
  const outputRate = tokenCosts.data?.outputCostPerMillion ?? null;
  const costsConfigured = inputRate != null && outputRate != null;

  function estimateCost(tokensIn: number, tokensOut: number): string | null {
    if (!costsConfigured) return null;
    const cost = (tokensIn / 1_000_000) * inputRate! + (tokensOut / 1_000_000) * outputRate!;
    return `$${cost.toFixed(2)}`;
  }

  const totalEstCost = costsConfigured
    ? estimateCost(tokenTotals.tokensInput, tokenTotals.tokensOutput)
    : null;

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Overview</h1>

      {/* Alert Banner */}
      <AlertBanner />

      {/* Monitoring disabled warning (toggle is now in Settings > System) */}
      {globalConfig.data && !globalConfig.data.isMonitoringEnabled && (
        <Card className="border-red-500">
          <CardContent className="py-3">
            <p className="text-sm font-medium text-red-600">
              Monitoring is disabled system-wide. Enable it in Settings &gt; System.
            </p>
          </CardContent>
        </Card>
      )}

      {/* System Status */}
      <SystemStatusCard />

      {/* Summary Stats */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2 rounded-md border p-3 text-center text-xs">
        <div>
          <div className="font-medium text-muted-foreground">Users</div>
          <div className="text-lg font-semibold">{totalUsers}</div>
        </div>
        <div>
          <div className="font-medium text-muted-foreground">Gmail Active</div>
          <div className="text-lg font-semibold">{activeGmail}</div>
        </div>
        <div>
          <div className="font-medium text-muted-foreground">Processed</div>
          <div className="text-lg font-semibold">{totalProcessed}</div>
        </div>
        <div>
          <div className="font-medium text-muted-foreground">Forwarded</div>
          <div className="text-lg font-semibold">{totalForwarded}</div>
        </div>
        <div>
          <div className="font-medium text-muted-foreground">Delivered</div>
          <div className="text-lg font-semibold">{totalDelivered}</div>
        </div>
        <div>
          <div className="font-medium text-muted-foreground">Bounced</div>
          <div className={`text-lg font-semibold ${totalBounced > 0 ? "text-red-600 dark:text-red-400" : ""}`}>
            {totalBounced}
          </div>
        </div>
        <div>
          <div className="font-medium text-muted-foreground">Attachments</div>
          <div className="text-lg font-semibold">{totalAttachments}</div>
        </div>
        {costsConfigured && (
          <div>
            <div className="font-medium text-muted-foreground">Est. Cost (30d)</div>
            <div className="text-lg font-semibold">{totalEstCost}</div>
          </div>
        )}
      </div>

      {/* Feedback & Sender Rules */}
      <FeedbackAndRulesCards />

      {/* Brief Delivery Report */}
      <BriefDeliveryCard />

      {/* Token Usage Table */}
      <Card>
        <CardHeader>
          <CardTitle>Token Usage (Last 30 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          {tokenUsage.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : tokenUsage.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Input Tokens</TableHead>
                  <TableHead className="text-right">Output Tokens</TableHead>
                  <TableHead className="text-right">Emails</TableHead>
                  <TableHead className="text-right">Attachments</TableHead>
                  <TableHead className="text-right">Est. Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokenUsage.data?.map((row) => (
                  <TableRow key={row.day}>
                    <TableCell>{row.day}</TableCell>
                    <TableCell className="text-right">
                      {row.tokensInput.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.tokensOutput.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.emailCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.attachmentCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {estimateCost(row.tokensInput, row.tokensOutput) ?? "\u2014"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-bold">Total</TableCell>
                  <TableCell className="text-right font-bold">
                    {tokenTotals.tokensInput.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {tokenTotals.tokensOutput.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {tokenTotals.emailCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {tokenTotals.attachmentCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {totalEstCost ?? "\u2014"}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
          {!costsConfigured && tokenUsage.data && tokenUsage.data.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Configure token costs in Settings &gt; AI to see estimated costs.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
