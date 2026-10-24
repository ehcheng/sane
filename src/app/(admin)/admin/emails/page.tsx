"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Search, Send } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  fmtTime,
  DecisionBadge,
  ExpandableEmailRow,
  SortableHeader,
  localTzAbbr,
  useDebounce,
  datePresetToRange,
  type DatePreset,
  type SortField,
} from "@/components/admin/feedback-helpers";

// ---------------------------------------------------------------------------
// Inline helpers (only used on this page)
// ---------------------------------------------------------------------------

function DeliveryBadge({ status, error, forwarded }: { status: string | null; error: string | null; forwarded: boolean }) {
  if (!forwarded) return <span className="text-xs text-muted-foreground">—</span>;
  const label = status === "pending" ? "Sent" : (status ?? "unknown");
  const variant =
    status === "delivered"
      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      : status === "bounced" || status === "complained"
        ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
        : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";

  if (error) {
    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "inline-flex cursor-help items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
                variant
              )}
            >
              {label}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            {error}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
        variant
      )}
    >
      {label}
    </span>
  );
}

function ForceForwardButton({
  emailId,
  subject,
  userName,
  forwarded,
}: {
  emailId: string;
  subject: string;
  userName: string;
  forwarded: boolean;
}) {
  const utils = trpc.useUtils();
  const mutation = trpc.admin.adminForceForward.useMutation({
    onSuccess: (data) => {
      toast({
        title: data.alreadyForwarded
          ? "Re-forward queued"
          : "Forward queued",
        description: "The email has been queued for forwarding. It may take a few seconds to process.",
      });
      setTimeout(() => {
        utils.admin.emailLog.invalidate();
      }, 5000);
    },
    onError: (err) => {
      toast({
        title: "Forward failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={mutation.isPending}
        >
          <Send className="mr-1 h-3 w-3" />
          {mutation.isPending
            ? "Queuing..."
            : forwarded
              ? "Re-Forward"
              : "Force Forward"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {forwarded ? "Re-forward email?" : "Force forward email?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will {forwarded ? "re-send" : "send"} the email to{" "}
            <strong>{userName}</strong>&apos;s forwarding addresses.
            <br />
            <br />
            <span className="font-medium">Subject:</span> {subject}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => mutation.mutate({ emailId })}
          >
            {forwarded ? "Re-Forward" : "Forward"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Processing Log
// ---------------------------------------------------------------------------

export default function AdminEmailsPage() {
  const users = trpc.admin.users.useQuery();

  const [userId, setUserId] = useState<string>("all");
  const [decision, setDecision] = useState<"all" | "forwarded" | "skipped">("all");
  const [errorStatus, setErrorStatus] = useState<"all" | "has_error" | "no_error">("has_error");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [sortBy, setSortBy] = useState<SortField>("receivedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
  };

  const dateRange = datePresetToRange(datePreset);

  const query = trpc.admin.emailLog.useInfiniteQuery(
    {
      userId: userId === "all" ? undefined : userId,
      decision,
      errorStatus,
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
      search: debouncedSearch || undefined,
      sortBy,
      sortDir,
    },
    {
      getNextPageParam: (last) => last.nextCursor,
    }
  );

  const allItems = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Processing Log</h1>

      <div className="space-y-4">
        {/* Search + Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search subject, sender, user..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-[260px] pl-9"
            />
          </div>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Users" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {users.data?.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={decision} onValueChange={(v) => setDecision(v as typeof decision)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Decisions</SelectItem>
              <SelectItem value="forwarded">Forwarded</SelectItem>
              <SelectItem value="skipped">Skipped</SelectItem>
            </SelectContent>
          </Select>

          <Select value={errorStatus} onValueChange={(v) => setErrorStatus(v as typeof errorStatus)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="has_error">Has Error</SelectItem>
              <SelectItem value="no_error">No Error</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>

          <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DatePreset)}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[70px]">ID</TableHead>
                <SortableHeader label={`Time (${localTzAbbr()})`} field="receivedAt" current={sortBy} dir={sortDir} onSort={handleSort} className="w-[140px]" />
                <SortableHeader label="User" field="user" current={sortBy} dir={sortDir} onSort={handleSort} />
                <SortableHeader label="Sender" field="fromAddress" current={sortBy} dir={sortDir} onSort={handleSort} />
                <SortableHeader label="Subject" field="subject" current={sortBy} dir={sortDir} onSort={handleSort} className="max-w-[200px]" />
                <TableHead>Decision</TableHead>
                <SortableHeader label="Tokens" field="tokens" current={sortBy} dir={sortDir} onSort={handleSort} className="text-right" />
                <SortableHeader label="Latency" field="latency" current={sortBy} dir={sortDir} onSort={handleSort} className="text-right" tooltip="Round-trip time for the AI provider to analyze the email and return a decision" />
                <TableHead>Delivery</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : allItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    No emails found.
                  </TableCell>
                </TableRow>
              ) : (
                allItems.map((row, i) => {
                  const hasError = !!row.processingError || !!row.deliveryError ||
                    row.deliveryStatus === "bounced" || row.deliveryStatus === "complained";
                  const isExpanded = expandedId === row.id;

                  return (
                    <ExpandableEmailRow
                      key={row.id}
                      isExpanded={isExpanded}
                      onToggle={() => setExpandedId(isExpanded ? null : row.id)}
                      rowClassName={cn(
                        "cursor-pointer transition-colors",
                        hasError && "bg-red-50 dark:bg-red-950/30",
                        !hasError && i % 2 === 1 && "bg-muted/30",
                        isExpanded && "bg-accent/50"
                      )}
                      colSpan={9}
                      detail={
                        <div className="space-y-3 text-xs">
                          {/* Identity */}
                          <div>
                            <h4 className="font-medium text-muted-foreground mb-1">Identity</h4>
                            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                              <span className="text-muted-foreground">ID</span>
                              <span className="font-mono text-foreground">{row.id}</span>
                              <span className="text-muted-foreground">External ID</span>
                              <span className="font-mono text-foreground truncate" title={row.externalMessageId}>{row.externalMessageId}</span>
                              <span className="text-muted-foreground">From</span>
                              <span className="text-foreground">{row.fromName ? `${row.fromName} <${row.fromAddress}>` : row.fromAddress}</span>
                              <span className="text-muted-foreground">Subject</span>
                              <span className="text-foreground">{row.subject}</span>
                              {row.aiSubject && (
                                <>
                                  <span className="text-muted-foreground">AI Subject</span>
                                  <span className="text-foreground">{row.aiSubject}</span>
                                </>
                              )}
                              {row.topicSlug && (
                                <>
                                  <span className="text-muted-foreground">Topic Slug</span>
                                  <span className="font-mono text-foreground">{row.topicSlug}</span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* AI Classification */}
                          <div>
                            <h4 className="font-medium text-muted-foreground mb-1">AI Classification</h4>
                            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                              <span className="text-muted-foreground">Relevant</span>
                              <span className={row.aiRelevant ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>{row.aiRelevant ? "Yes" : "No"}</span>
                              <span className="text-muted-foreground">Actionable (send)</span>
                              <span className={row.aiDecision ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>{row.aiDecision ? "Yes" : "No"}</span>
                              <span className="text-muted-foreground">Provider</span>
                              <span className="text-foreground">{row.aiProvider}</span>
                              <span className="text-muted-foreground">Model</span>
                              <span className="text-foreground">{row.aiModel}</span>
                              <span className="text-muted-foreground">Tokens</span>
                              <span className="text-foreground">{row.aiTokensInput.toLocaleString()} in / {row.aiTokensOutput.toLocaleString()} out</span>
                              <span className="text-muted-foreground">Latency</span>
                              <span className="text-foreground">{row.aiLatencyMs.toLocaleString()}ms</span>
                            </div>
                          </div>

                          {/* AI Reasoning */}
                          {row.aiReasoning && (
                            <div>
                              <h4 className="font-medium text-muted-foreground mb-1">AI Reasoning</h4>
                              <p className="whitespace-pre-wrap">{row.aiReasoning}</p>
                            </div>
                          )}

                          {/* AI Summary */}
                          {row.aiSummary && (
                            <div>
                              <h4 className="font-medium text-muted-foreground mb-1">AI Summary</h4>
                              <p className="whitespace-pre-wrap">{row.aiSummary}</p>
                            </div>
                          )}

                          {/* AI Links */}
                          {row.aiLinks && (() => {
                            try {
                              const links = JSON.parse(row.aiLinks) as Array<{ url: string; label: string }>;
                              if (links.length === 0) return null;
                              return (
                                <div>
                                  <h4 className="font-medium text-muted-foreground mb-1">Extracted Links</h4>
                                  <ul className="list-disc list-inside space-y-0.5">
                                    {links.map((l, i) => (
                                      <li key={i}>
                                        <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{l.label}</a>
                                        <span className="text-muted-foreground ml-1">({new URL(l.url).hostname})</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              );
                            } catch { return null; }
                          })()}

                          {/* Delivery */}
                          <div>
                            <h4 className="font-medium text-muted-foreground mb-1">Delivery</h4>
                            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                              <span className="text-muted-foreground">Forwarded</span>
                              <span className="text-foreground">{row.forwarded ? "Yes" : "No"}{row.isManualForward ? " (manual)" : ""}</span>
                              {row.forwardedAt && (
                                <>
                                  <span className="text-muted-foreground">Forwarded At</span>
                                  <span className="text-foreground">{fmtTime(row.forwardedAt)}</span>
                                </>
                              )}
                              <span className="text-muted-foreground">Delivery Status</span>
                              <span className="text-foreground">{row.deliveryStatus ?? "N/A"}</span>
                              {row.resendMessageId && (
                                <>
                                  <span className="text-muted-foreground">Resend ID</span>
                                  <span className="font-mono text-foreground">{row.resendMessageId}</span>
                                </>
                              )}
                              {row.deliveryUpdatedAt && (
                                <>
                                  <span className="text-muted-foreground">Delivery Updated</span>
                                  <span className="text-foreground">{fmtTime(row.deliveryUpdatedAt)}</span>
                                </>
                              )}
                              {row.skipForwardReason && (
                                <>
                                  <span className="text-muted-foreground">Skip Reason</span>
                                  <span className="text-foreground">{row.skipForwardReason}</span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Flags & Metadata */}
                          <div>
                            <h4 className="font-medium text-muted-foreground mb-1">Metadata</h4>
                            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                              <span className="text-muted-foreground">Backfill</span>
                              <span className="text-foreground">{row.isBackfill ? "Yes" : "No"}</span>
                              <span className="text-muted-foreground">Duplicate Slug</span>
                              <span className="text-foreground">{row.isDuplicateSlug ? "Yes" : "No"}</span>
                              <span className="text-muted-foreground">Attachments</span>
                              <span className="text-foreground">{row.attachmentCount}</span>
                              <span className="text-muted-foreground">Images</span>
                              <span className="text-foreground">{row.imageCount}</span>
                              <span className="text-muted-foreground">Received</span>
                              <span className="text-foreground">{fmtTime(row.receivedAt)}</span>
                              <span className="text-muted-foreground">Processed</span>
                              <span className="text-foreground">{fmtTime(row.createdAt)}</span>
                            </div>
                          </div>

                          {/* User Feedback */}
                          {(row.userFeedback || row.userFeedbackReason) && (
                            <div>
                              <h4 className="font-medium text-amber-600 dark:text-amber-400 mb-1">User Feedback</h4>
                              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                                {row.userFeedback && (
                                  <>
                                    <span className="text-muted-foreground">Verdict</span>
                                    <span className="text-foreground">{row.userFeedback}</span>
                                  </>
                                )}
                                {row.userFeedbackAt && (
                                  <>
                                    <span className="text-muted-foreground">At</span>
                                    <span className="text-foreground">{fmtTime(row.userFeedbackAt)}</span>
                                  </>
                                )}
                                {row.userFeedbackReason && (
                                  <>
                                    <span className="text-muted-foreground">Reason</span>
                                    <span className="text-foreground whitespace-pre-wrap">{row.userFeedbackReason}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Errors */}
                          {(row.processingError || row.deliveryError) && (
                            <div>
                              <h4 className="font-medium text-red-600 dark:text-red-400 mb-1">Errors</h4>
                              {row.processingError && (
                                <div className="mb-1">
                                  <span className="text-muted-foreground">Processing: </span>
                                  <span className="text-red-600 dark:text-red-400 whitespace-pre-wrap">{row.processingError}</span>
                                </div>
                              )}
                              {row.deliveryError && (
                                <div>
                                  <span className="text-muted-foreground">Delivery: </span>
                                  <span className="text-red-600 dark:text-red-400 whitespace-pre-wrap">{row.deliveryError}</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Actions */}
                          <div className="border-t pt-2 mt-2">
                            <ForceForwardButton
                              emailId={row.id}
                              subject={row.subject}
                              userName={row.user.name}
                              forwarded={row.forwarded}
                            />
                          </div>
                        </div>
                      }
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">{row.id.slice(0, 8)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        <span className="inline-flex items-center gap-1">
                          {hasError && <span className="text-red-500" title="Has error">⚠</span>}
                          {fmtTime(row.receivedAt)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">{row.user.name}</TableCell>
                      <TableCell className="max-w-[150px] truncate text-xs" title={isExpanded ? row.fromAddress : undefined}>
                        <span className={isExpanded ? undefined : "blur-sm select-none"}>{row.fromName || row.fromAddress}</span>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs" title={isExpanded ? row.subject : undefined}>
                        <span className={isExpanded ? undefined : "blur-sm select-none"}>{row.subject}</span>
                      </TableCell>
                      <TableCell>
                        <DecisionBadge forwarded={row.forwarded} isManualForward={row.isManualForward} aiDecision={row.aiDecision} aiRelevant={row.aiRelevant} isDuplicateSlug={row.isDuplicateSlug} skipForwardReason={row.skipForwardReason} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs">
                        {row.aiTokensInput.toLocaleString()}/{row.aiTokensOutput.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {row.aiLatencyMs.toLocaleString()}ms
                      </TableCell>
                      <TableCell>
                        <DeliveryBadge status={row.deliveryStatus} error={row.deliveryError} forwarded={row.forwarded} />
                      </TableCell>
                    </ExpandableEmailRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Load More */}
        {query.hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              {query.isFetchingNextPage ? "Loading..." : "Load More"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
