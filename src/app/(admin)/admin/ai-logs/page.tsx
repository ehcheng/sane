"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Download } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { downloadBlob } from "@/lib/utils";

const ACTION_OPTIONS = [
  { value: "all", label: "All Actions" },
  { value: "email-analysis", label: "Email Analysis" },
  { value: "event-dedup", label: "Event Dedup" },
  { value: "event-merge", label: "Event Merge" },
  { value: "daily-brief-summary", label: "Daily Brief" },
  { value: "weekly-brief-summary", label: "Weekly Brief" },
  { value: "daily-diagnostics", label: "Diagnostics" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "success", label: "Success" },
  { value: "failure", label: "Failures" },
];

const FEEDBACK_OPTIONS = [
  { value: "all", label: "All" },
  { value: "with", label: "Has Feedback" },
  { value: "without", label: "No Feedback" },
];

function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function defaultEndDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AILogsPage() {
  const [action, setAction] = useState("all");
  const [status, setStatus] = useState("failure");
  const [feedback, setFeedback] = useState("all");
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<"csv" | "json">("json");

  const queryInput = useMemo(() => ({
    startDate: new Date(startDate + "T00:00:00Z").toISOString(),
    endDate: new Date(endDate + "T23:59:59Z").toISOString(),
    action: action === "all" ? undefined : action,
    success: status === "all" ? undefined : status === "success",
    hasFeedback: feedback === "all" ? undefined : feedback === "with",
    limit: 50,
  }), [startDate, endDate, action, status, feedback]);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.admin.aiCallLogs.useInfiniteQuery(queryInput, {
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      refetchOnWindowFocus: false,
    });

  const allItems = data?.pages.flatMap((p) => p.items) ?? [];

  // Detail dialog
  const { data: detail, isLoading: detailLoading } = trpc.admin.aiCallLogDetail.useQuery(
    { id: selectedId! },
    { enabled: !!selectedId, refetchOnWindowFocus: false },
  );

  // Keyboard navigation in detail dialog (arrow keys)
  const navigateDetail = useCallback((direction: 1 | -1) => {
    if (!selectedId) return;
    const idx = allItems.findIndex((item) => item.id === selectedId);
    if (idx === -1) return;
    const nextIdx = idx + direction;
    if (nextIdx >= 0 && nextIdx < allItems.length) {
      setSelectedId(allItems[nextIdx].id);
    }
  }, [selectedId, allItems]);

  useEffect(() => {
    if (!selectedId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        navigateDetail(1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        navigateDetail(-1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedId, navigateDetail]);

  // Export mutation
  const exportMutation = trpc.admin.aiCallLogExport.useMutation({
    onSuccess(result) {
      if (result.delivery === "empty") {
        toast({ title: "No records found for the selected range." });
      } else if (result.delivery === "inline") {
        const mimeType = result.format === "json" ? "application/json" : "text/csv";
        downloadBlob(result.data!, `ai-call-logs.${result.format}`, mimeType);
        toast({ title: `Downloaded ${result.count} records.` });
      } else if (result.delivery === "emailed") {
        toast({ title: `Export emailed to admins (${result.count} records).` });
      } else if (result.delivery === "error") {
        toast({ title: `Export failed: ${result.message}`, variant: "destructive" });
      }
    },
    onError(err) {
      toast({ title: `Export error: ${err.message}`, variant: "destructive" });
    },
  });

  // Stats summary
  const totalShown = allItems.length;
  const failureCount = allItems.filter((i) => !i.success).length;
  const totalTokens = allItems.reduce((sum, i) => sum + i.inputTokens + i.outputTokens, 0);
  const avgLatency = totalShown > 0
    ? Math.round(allItems.reduce((sum, i) => sum + i.durationMs, 0) / totalShown)
    : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">AI Call Logs</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <Label className="text-xs text-muted-foreground">Start Date</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">End Date</Label>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Action</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACTION_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Feedback</Label>
          <Select value={feedback} onValueChange={setFeedback}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FEEDBACK_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Export Format</Label>
          <Select value={exportFormat} onValueChange={(v) => setExportFormat(v as "csv" | "json")}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="json">JSON</SelectItem>
              <SelectItem value="csv">CSV</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={exportMutation.isPending}
          className="h-9 text-xs"
          onClick={() => {
            const { limit: _, ...filters } = queryInput;
            exportMutation.mutate({ ...filters, format: exportFormat });
          }}
        >
          <Download className="mr-1 h-3.5 w-3.5" />
          {exportMutation.isPending ? "Exporting..." : `Export ${exportFormat.toUpperCase()}`}
        </Button>
      </div>

      {/* Stats bar */}
      <div className="flex gap-6 text-sm text-muted-foreground">
        <span>Showing: <strong className="text-foreground">{totalShown}</strong></span>
        <span>Failures: <strong className={failureCount > 0 ? "text-red-600" : "text-foreground"}>{failureCount}</strong></span>
        <span>Tokens: <strong className="text-foreground">{totalTokens.toLocaleString()}</strong></span>
        <span>Avg Latency: <strong className="text-foreground">{avgLatency}ms</strong></span>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Time</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-right">Latency</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead>User</TableHead>
              <TableHead className="text-center">Consent</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : allItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No AI call logs found for the selected filters.
                </TableCell>
              </TableRow>
            ) : (
              allItems.map((item) => (
                <TableRow
                  key={item.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedId(item.id)}
                >
                  <TableCell className="text-xs font-mono whitespace-nowrap">
                    {new Date(item.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {item.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{item.provider}/{item.model}</TableCell>
                  <TableCell className="text-center">
                    {item.success ? (
                      (item.metadata as Record<string, unknown> | null)?.retriedAfterError ? (
                        <span className="text-yellow-600 text-xs font-medium">RETRY OK</span>
                      ) : (
                        <span className="text-green-600 text-xs font-medium">OK</span>
                      )
                    ) : (
                      (item.metadata as Record<string, unknown> | null)?.retriedAndFailed ? (
                        <span className="text-orange-600 text-xs font-medium">RETRY FAIL</span>
                      ) : (
                        <span className="text-red-600 text-xs font-medium">FAIL</span>
                      )
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono">{item.durationMs}ms</TableCell>
                  <TableCell className="text-right text-sm font-mono">
                    {item.inputTokens + item.outputTokens}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground truncate max-w-32">
                    {item.user?.name ?? item.userId ?? "-"}
                  </TableCell>
                  <TableCell className="text-center">
                    {item.consentGranted ? (
                      <span className="text-green-600 text-xs">Yes</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">No</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-red-600 truncate max-w-48">
                    {item.errorType ? `${item.errorType}: ${item.errorMessage?.slice(0, 80) ?? ""}` : ""}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            {isFetchingNextPage ? "Loading..." : "Load More"}
          </Button>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>AI Call Detail</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <p className="text-muted-foreground py-4">Loading...</p>
          ) : detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Action:</span>{" "}
                  <Badge variant="outline">{detail.action}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  {detail.success ? (
                    <span className="text-green-600 font-medium">Success</span>
                  ) : (
                    <span className="text-red-600 font-medium">Failed</span>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">Provider:</span>{" "}
                  {detail.provider}/{detail.model}
                </div>
                <div>
                  <span className="text-muted-foreground">Latency:</span>{" "}
                  {detail.durationMs}ms
                </div>
                <div>
                  <span className="text-muted-foreground">Tokens In:</span>{" "}
                  {detail.inputTokens}
                </div>
                <div>
                  <span className="text-muted-foreground">Tokens Out:</span>{" "}
                  {detail.outputTokens}
                </div>
                <div>
                  <span className="text-muted-foreground">User:</span>{" "}
                  {detail.user?.name ?? detail.userId ?? "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">Consent:</span>{" "}
                  {detail.consentGranted ? (
                    <span className="text-green-600 font-medium">Granted</span>
                  ) : (
                    <span className="text-muted-foreground">Not granted</span>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">Time:</span>{" "}
                  {new Date(detail.createdAt).toLocaleString()}
                </div>
                <div className="col-span-2 md:col-span-4">
                  <span className="text-muted-foreground">ID:</span>{" "}
                  <span className="font-mono text-xs select-all">{detail.id}</span>
                </div>
              </div>

              {detail.errorType && (
                <div className="rounded bg-red-50 dark:bg-red-950/30 p-3 text-sm">
                  <strong className="text-red-600">Error ({detail.errorType}):</strong>{" "}
                  <span className="text-red-800 dark:text-red-400">{detail.errorMessage}</span>
                  {(detail.metadata as Record<string, unknown> | null)?.retriedAndFailed ? (
                    <div className="mt-1 text-orange-700 dark:text-orange-400 text-xs">Both first attempt and retry failed.</div>
                  ) : null}
                </div>
              )}

              {detail.success && (detail.metadata as Record<string, unknown> | null)?.retriedAfterError ? (
                <div className="rounded bg-yellow-50 dark:bg-yellow-950/30 p-3 text-sm">
                  <strong className="text-yellow-700 dark:text-yellow-400">Retry OK:</strong>{" "}
                  <span className="text-yellow-800 dark:text-yellow-300">First attempt failed with: {String((detail.metadata as Record<string, unknown>).retriedAfterError)}. Succeeded on retry.</span>
                </div>
              ) : null}

              {detail.linkedEmail && (
                detail.consentGranted ? (
                  <div className="rounded bg-blue-50 dark:bg-blue-950/30 p-3 text-sm space-y-1">
                    <h4 className="font-medium text-blue-800 dark:text-blue-300">Linked Email</h4>
                    <div><span className="text-muted-foreground">Subject:</span> {detail.linkedEmail.subject}</div>
                    <div><span className="text-muted-foreground">From:</span> {detail.linkedEmail.fromName ? `${detail.linkedEmail.fromName} <${detail.linkedEmail.fromAddress}>` : detail.linkedEmail.fromAddress}</div>
                    <div><span className="text-muted-foreground">AI Summary:</span> {detail.linkedEmail.aiSummary ?? "-"}</div>
                    <div><span className="text-muted-foreground">AI Reasoning:</span> {detail.linkedEmail.aiReasoning ?? "-"}</div>
                    {detail.linkedEmail.userFeedback && (
                      <div>
                        <span className="text-muted-foreground">User Feedback:</span>{" "}
                        <Badge variant={detail.linkedEmail.userFeedback === "correct" ? "default" : "destructive"} className="text-xs">
                          {detail.linkedEmail.userFeedback}
                        </Badge>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Linked Email [consent not granted]</p>
                )
              )}

              {detail.metadata && (
                <div>
                  <h4 className="text-sm font-medium mb-1">Metadata</h4>
                  <pre className="text-xs bg-muted rounded p-2 overflow-x-auto">
                    {JSON.stringify(detail.metadata, null, 2)}
                  </pre>
                </div>
              )}

              <div>
                <h4 className="text-sm font-medium mb-1">Prompt</h4>
                <pre className="text-xs bg-muted rounded p-3 overflow-x-auto max-h-60 whitespace-pre-wrap">
                  {detail.prompt}
                </pre>
              </div>

              {detail.response && (
                <div>
                  <h4 className="text-sm font-medium mb-1">Response</h4>
                  <pre className="text-xs bg-muted rounded p-3 overflow-x-auto max-h-60 whitespace-pre-wrap">
                    {detail.response}
                  </pre>
                </div>
              )}

              {detail.consentGranted && detail.action === "email-analysis" && (
                <LinkedEmailSection aiCallLogId={detail.id} />
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LinkedEmailSection({ aiCallLogId }: { aiCallLogId: string }) {
  const [fetched, setFetched] = useState(false);
  const { data, isLoading } = trpc.admin.aiCallLogLinkedEmail.useQuery(
    { aiCallLogId },
    { enabled: fetched, refetchOnWindowFocus: false },
  );

  if (!fetched) {
    return (
      <div className="pt-2">
        <Button variant="outline" size="sm" onClick={() => setFetched(true)}>
          Fetch Linked Email
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-2">Loading email...</p>;
  }

  if (!data || "error" in data) {
    const msg = data?.error === "consent_not_granted" ? "Linked Email [consent not granted]"
      : data?.error === "no_message_id" ? "No message ID in metadata"
      : "Failed to load";
    return <p className="text-sm text-muted-foreground py-2">{msg}</p>;
  }

  const e = data.email;
  const from = e ? (e.fromName ? `${e.fromName} <${e.fromAddress}>` : e.fromAddress) : null;

  return (
    <div className="rounded border p-3 text-sm space-y-3">
      <h4 className="font-medium">Linked Email</h4>

      {e ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs">
            <div><span className="text-muted-foreground">Subject:</span> {e.subject}</div>
            <div><span className="text-muted-foreground">From:</span> {from}</div>
            <div><span className="text-muted-foreground">Received:</span> {new Date(e.receivedAt).toLocaleString()}</div>
            {e.aiSubject && <div><span className="text-muted-foreground">AI Subject:</span> {e.aiSubject}</div>}
            <div><span className="text-muted-foreground">AI Decision:</span> {e.aiDecision ? "Send" : "Skip"}</div>
            <div><span className="text-muted-foreground">AI Relevant:</span> {e.aiRelevant ? "Yes" : "No"}</div>
            <div><span className="text-muted-foreground">Provider:</span> {e.aiProvider}/{e.aiModel}</div>
            <div><span className="text-muted-foreground">Tokens:</span> {e.aiTokensInput}+{e.aiTokensOutput}</div>
            <div><span className="text-muted-foreground">Latency:</span> {e.aiLatencyMs}ms</div>
            <div><span className="text-muted-foreground">Attachments:</span> {e.attachmentCount} ({e.imageCount} images)</div>
            <div><span className="text-muted-foreground">Forwarded:</span> {e.forwarded ? "Yes" : "No"}{e.isManualForward ? " (manual)" : ""}</div>
            <div><span className="text-muted-foreground">Delivery:</span> {e.deliveryStatus ?? "n/a"}</div>
            {e.skipForwardReason && <div><span className="text-muted-foreground">Skip Reason:</span> {e.skipForwardReason}</div>}
            {e.forwardedAt && <div><span className="text-muted-foreground">Forwarded At:</span> {new Date(e.forwardedAt).toLocaleString()}</div>}
            {e.deliveryError && <div className="col-span-2"><span className="text-red-600">Delivery Error:</span> {e.deliveryError}</div>}
            <div><span className="text-muted-foreground">Backfill:</span> {e.isBackfill ? "Yes" : "No"}</div>
            {e.isDuplicateSlug && <div><span className="text-muted-foreground">Duplicate Slug:</span> Yes</div>}
            {e.topicSlug && <div><span className="text-muted-foreground">Topic:</span> {e.topicSlug}</div>}
            <div><span className="text-muted-foreground">Message ID:</span> <span className="font-mono break-all">{e.externalMessageId}</span></div>
          </div>

          {e.aiSummary && (
            <div>
              <span className="text-xs text-muted-foreground">AI Summary:</span>
              <p className="text-xs mt-0.5 whitespace-pre-wrap">{e.aiSummary}</p>
            </div>
          )}

          {e.aiReasoning && (
            <div>
              <span className="text-xs text-muted-foreground">AI Reasoning:</span>
              <p className="text-xs mt-0.5 whitespace-pre-wrap">{e.aiReasoning}</p>
            </div>
          )}

          {e.aiLinks && (
            <div>
              <span className="text-xs text-muted-foreground">AI Links:</span>
              <pre className="text-xs mt-0.5 bg-muted rounded p-2 overflow-x-auto">{e.aiLinks}</pre>
            </div>
          )}

          {e.userFeedback && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">User Feedback:</span>
              <Badge variant={e.userFeedback === "correct" ? "default" : "destructive"} className="text-xs">
                {e.userFeedback}
              </Badge>
              {e.userFeedbackReason && <span className="text-muted-foreground">({e.userFeedbackReason})</span>}
              {e.userFeedbackAt && <span className="text-muted-foreground">{new Date(e.userFeedbackAt).toLocaleString()}</span>}
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">No ProcessedEmail record (AI call may have failed before saving).</p>
      )}

      {data.fetchError && (
        <p className="text-xs text-amber-600">Could not fetch email body from provider: {data.fetchError}</p>
      )}

      {(data.body || data.fetchedSubject) && (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-muted-foreground">Email Content (from provider)</h4>
          {data.fetchedSubject && (
            <div className="text-xs"><span className="text-muted-foreground">Subject:</span> {data.fetchedSubject}</div>
          )}
          {data.fetchedFrom && (
            <div className="text-xs"><span className="text-muted-foreground">From:</span> {data.fetchedFromName ? `${data.fetchedFromName} <${data.fetchedFrom}>` : data.fetchedFrom}</div>
          )}
          {data.body && (
            <pre className="text-xs bg-muted rounded p-3 overflow-x-auto max-h-80 whitespace-pre-wrap mt-1">{data.body}</pre>
          )}
        </div>
      )}

      {!e && !data.body && !data.fetchError && (
        <p className="text-xs text-muted-foreground">No email data available.</p>
      )}
    </div>
  );
}
