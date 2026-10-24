"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  ChevronDown,
  ChevronRight,
  Play,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { downloadBlob, relativeTime } from "@/lib/utils";
import { fmtTime } from "@/components/admin/feedback-helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityBadge(severity: string) {
  switch (severity) {
    case "ok":
      return <Badge className="bg-green-500 hover:bg-green-600 text-white">OK</Badge>;
    case "critical":
      return <Badge variant="destructive">Critical</Badge>;
    case "warning":
      return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-white">Warning</Badge>;
    case "info":
      return <Badge variant="secondary">Info</Badge>;
    default:
      return <Badge variant="outline">{severity}</Badge>;
  }
}

// ---------------------------------------------------------------------------
// Heartbeat status card
// ---------------------------------------------------------------------------

function DiagnosticStatusCard() {
  const utils = trpc.useUtils();

  const { data: status, isLoading } = trpc.admin.diagnosticStatus.useQuery(undefined, {
    refetchInterval: (query) => {
      // Poll every 3s while a run is in progress, otherwise every 60s
      return query.state.data?.isRunning ? 3_000 : 60_000;
    },
  });

  const trigger = trpc.admin.triggerDiagnostics.useMutation({
    onSuccess(result) {
      if (result.alreadyRunning) {
        toast({ title: "A diagnostic run is already in progress." });
      } else {
        toast({ title: "Diagnostic run started." });
      }
      utils.admin.diagnosticStatus.invalidate();
      // Also refetch runs table after a delay to pick up the new run
      setTimeout(() => utils.admin.diagnosticRuns.invalidate(), 2_000);
    },
    onError() {
      toast({ title: "Failed to start diagnostic run.", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">Loading status...</p>
        </CardContent>
      </Card>
    );
  }

  if (!status) return null;

  const lastRun = status.lastCompleted;
  const isOverdue = lastRun
    ? Date.now() - new Date(lastRun.createdAt).getTime() > 36 * 60 * 60 * 1000 // > 36h
    : false;

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          {/* Last run info */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {status.isRunning ? (
              <Loader2 className="h-5 w-5 text-blue-500 animate-spin shrink-0" />
            ) : isOverdue ? (
              <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0" />
            ) : lastRun ? (
              <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
            ) : (
              <Clock className="h-5 w-5 text-muted-foreground shrink-0" />
            )}

            <div className="min-w-0">
              {status.isRunning ? (
                <p className="text-sm font-medium">
                  Diagnostic run in progress
                  {status.runningSince && (
                    <span className="text-muted-foreground font-normal">
                      {" "}(started {relativeTime(status.runningSince)})
                    </span>
                  )}
                </p>
              ) : lastRun ? (
                <>
                  <p className="text-sm font-medium">
                    Last run: {relativeTime(lastRun.createdAt)}
                    {isOverdue && (
                      <span className="text-yellow-600 ml-2">(overdue)</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtTime(lastRun.createdAt)}
                    {lastRun.findingCount > 0
                      ? ` · ${lastRun.findingCount} finding(s): ${lastRun.criticalCount} critical, ${lastRun.warningCount} warning, ${lastRun.infoCount} info`
                      : " · All clear"}
                  </p>
                </>
              ) : (
                <p className="text-sm font-medium">
                  No diagnostic runs yet
                </p>
              )}
            </div>
          </div>

          {/* Streak + Run Now */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right hidden sm:block">
              <p className="text-xs text-muted-foreground">7-day runs</p>
              <p className="text-sm font-semibold">{status.recentRunCount}/7</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={status.isRunning || trigger.isPending}
              onClick={() => trigger.mutate()}
            >
              {status.isRunning || trigger.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-1.5" />
              )}
              Run Now
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Findings panel (expanded row)
// ---------------------------------------------------------------------------

function FindingsPanel({ runId }: { runId: string }) {
  const { data: findings, isLoading } = trpc.admin.diagnosticFindings.useQuery(
    { runId },
    { refetchOnWindowFocus: false },
  );

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading findings...</p>;
  if (!findings || findings.length === 0) {
    return <p className="text-sm text-muted-foreground p-4">No findings for this run.</p>;
  }

  // Pipeline order: data in → processing → data out
  const categoryOrder: Record<string, number> = {
    stale_connection: 0,
    gmail_quota: 1,
    ai_failure_spike: 2,
    ai_latency: 3,
    bounce_spike: 4,
    brief_gap: 5,
    pending_brief: 6,
  };
  const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };

  const issues = findings.filter((f) => f.severity !== "ok");
  const passing = [...findings.filter((f) => f.severity === "ok")].sort(
    (a, b) => (categoryOrder[a.category] ?? 99) - (categoryOrder[b.category] ?? 99),
  );

  // Sort issues: by pipeline stage, then severity within same category
  const sortedIssues = [...issues].sort(
    (a, b) =>
      (categoryOrder[a.category] ?? 99) - (categoryOrder[b.category] ?? 99) ||
      (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2),
  );

  return (
    <div className="space-y-4 p-4 bg-muted/30 rounded-b-lg">
      {/* Issues */}
      {sortedIssues.map((f) => {
        const affectedUsers = f.affectedUsers as Array<{ id: string; name: string; email: string }>;
        const metrics = f.metrics as Record<string, string | number>;

        return (
          <div key={f.id} className="rounded-lg border bg-background p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {severityBadge(f.severity)}
              <Badge variant="outline" className="text-xs">{f.category}</Badge>
              <span className="font-medium text-sm">{f.title}</span>
            </div>
            <p className="text-sm text-muted-foreground">{f.description}</p>

            {affectedUsers.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Affected Users ({affectedUsers.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {affectedUsers.slice(0, 10).map((u) => (
                    <Badge key={u.id} variant="outline" className="text-xs">
                      {u.name}
                    </Badge>
                  ))}
                  {affectedUsers.length > 10 && (
                    <Badge variant="outline" className="text-xs">
                      +{affectedUsers.length - 10} more
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {Object.keys(metrics).length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Object.entries(metrics).map(([key, value]) => (
                  <div key={key} className="text-xs">
                    <span className="text-muted-foreground">{key}: </span>
                    <span className="font-medium">{String(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Passing checks */}
      {passing.length > 0 && (
        <div className="rounded-lg border bg-background p-4">
          <p className="text-xs font-medium text-muted-foreground mb-3">
            Passing Checks ({passing.length})
          </p>
          <div className="space-y-2">
            {passing.map((f) => (
              <div key={f.id} className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                <div>
                  <span className="text-sm font-medium">{f.title}</span>
                  <p className="text-xs text-muted-foreground">{f.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function InsightsPage() {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const { data: runs, isLoading } = trpc.admin.diagnosticRuns.useQuery(
    { limit: 20 },
    {
      refetchOnWindowFocus: false,
      refetchInterval: 30_000,
    },
  );

  const utils = trpc.useUtils();

  async function handleDownload(runId: string) {
    try {
      const result = await utils.admin.diagnosticContextFile.fetch({ runId });
      const content = result.content;
      if (!content) {
        toast({ title: "No context file available for this run." });
        return;
      }
      downloadBlob(
        content,
        `diagnostic-${new Date(result.createdAt).toISOString().slice(0, 10)}.md`,
        "text/markdown",
      );
    } catch {
      toast({ title: "Failed to download context file.", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Diagnostics</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Automated anomaly detection. Download context files for Claude Code analysis.
        </p>
      </div>

      {/* Status + Run Now */}
      <DiagnosticStatusCard />

      {/* Run history */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Run History</h2>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading diagnostic runs...</p>
        ) : !runs || runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No diagnostic runs yet. Click "Run Now" above or wait for the first automated run.
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Critical</TableHead>
                  <TableHead className="text-center">Warning</TableHead>
                  <TableHead className="text-center">Info</TableHead>
                  <TableHead className="text-center">OK</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => {
                  const isExpanded = expandedRunId === run.id;
                  return (
                    <React.Fragment key={run.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                      >
                        <TableCell>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{fmtTime(run.createdAt)}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              run.status === "completed"
                                ? "secondary"
                                : run.status === "failed"
                                ? "destructive"
                                : "outline"
                            }
                          >
                            {run.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {run.criticalCount > 0 ? (
                            <span className="text-red-600 font-bold">{run.criticalCount}</span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {run.warningCount > 0 ? (
                            <span className="text-yellow-600 font-bold">{run.warningCount}</span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {run.infoCount > 0 ? (
                            <span className="text-blue-600 font-bold">{run.infoCount}</span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {run.okCount > 0 ? (
                            <span className="text-green-600 font-bold">{run.okCount}</span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : "-"}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(run.id);
                            }}
                            title="Download context file"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={9} className="p-0">
                            <FindingsPanel runId={run.id} />
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
