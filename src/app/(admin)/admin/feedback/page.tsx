"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { Download } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { cn, downloadBlob } from "@/lib/utils";
import {
  fmtTime,
  FeedbackBadge,
  DecisionBadge,
  ExpandableEmailRow,
  EmailSnapshotDetail,
  datePresetToRange,
  type DatePreset,
} from "@/components/admin/feedback-helpers";

// ---------------------------------------------------------------------------
// General Feedback Tab (form submissions)
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { value: "all", label: "All Categories" },
  { value: "BUG", label: "Bug Report" },
  { value: "FEATURE_REQUEST", label: "Feature Request" },
  { value: "USABILITY", label: "Usability" },
  { value: "EMAIL_QUALITY", label: "Email Quality" },
  { value: "GENERAL", label: "General" },
] as const;

type CategoryFilter = (typeof CATEGORIES)[number]["value"];

const categoryLabel: Record<string, string> = {
  BUG: "Bug",
  FEATURE_REQUEST: "Feature",
  USABILITY: "Usability",
  EMAIL_QUALITY: "Email Quality",
  GENERAL: "General",
};

const categoryColor: Record<string, string> = {
  BUG: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  FEATURE_REQUEST: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  USABILITY: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  EMAIL_QUALITY: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  GENERAL: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

function GeneralFeedbackTab() {
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const dateRange = datePresetToRange(datePreset);

  const query = trpc.admin.userFeedbackList.useInfiniteQuery(
    {
      category,
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
    },
    { getNextPageParam: (last) => last.nextCursor }
  );

  const exportQuery = trpc.admin.userFeedbackExport.useQuery(
    {
      category,
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
    },
    { enabled: false }
  );

  const allItems = query.data?.pages.flatMap((p) => p.items) ?? [];

  function handleExport() {
    exportQuery.refetch().then((res) => {
      if (!res.data) return;
      const dateSuffix = new Date().toISOString().slice(0, 10);
      const catSuffix = category === "all" ? "all" : category.toLowerCase();
      downloadBlob(
        JSON.stringify(res.data, null, 2),
        `feedback-${catSuffix}-${dateSuffix}.json`,
        "application/json",
      );
    });
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={category} onValueChange={(v) => setCategory(v as CategoryFilter)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
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

        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exportQuery.isFetching}
          className="h-9 text-xs"
        >
          <Download className="mr-1 h-3.5 w-3.5" />
          {exportQuery.isFetching ? "Exporting..." : "Export JSON"}
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[130px]">Time</TableHead>
              <TableHead>User</TableHead>
              <TableHead className="w-[110px]">Category</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead className="w-[80px]">Page</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : allItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No feedback found.
                </TableCell>
              </TableRow>
            ) : (
              allItems.map((row, i) => {
                const isExpanded = expandedId === row.id;
                return (
                  <TableRow
                    key={row.id}
                    className={cn(
                      "cursor-pointer transition-colors",
                      i % 2 === 1 && "bg-muted/30",
                      isExpanded && "bg-accent/50"
                    )}
                    onClick={() => setExpandedId(isExpanded ? null : row.id)}
                  >
                    <TableCell className="whitespace-nowrap text-xs">
                      {fmtTime(row.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs">{row.user.name}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
                          categoryColor[row.category] ?? categoryColor.GENERAL
                        )}
                      >
                        {categoryLabel[row.category] ?? row.category}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="max-w-[300px] truncate" title={row.subject}>
                        {row.subject}
                      </div>
                      {isExpanded && (
                        <div className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                          {row.message}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.page ?? "—"}
                    </TableCell>
                  </TableRow>
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
  );
}

// ---------------------------------------------------------------------------
// Email AI Feedback Tab (ported from emails page FeedbackRecordsTab)
// ---------------------------------------------------------------------------

function EmailAIFeedbackTab() {
  const users = trpc.admin.users.useQuery();

  const [userId, setUserId] = useState<string>("all");
  const [feedbackValue, setFeedbackValue] = useState<
    "all" | "correct" | "wrong_forward" | "wrong_skip"
  >("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const dateRange = datePresetToRange(datePreset);

  const query = trpc.admin.feedbackRecords.useInfiniteQuery(
    {
      userId: userId === "all" ? undefined : userId,
      feedbackValue,
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
    },
    {
      getNextPageParam: (last) => last.nextCursor,
    }
  );

  const allItems = query.data?.pages.flatMap((p) => p.items) ?? [];

  const exportQuery = trpc.admin.feedbackEmailsExport.useQuery(
    {
      userId: userId === "all" ? undefined : userId,
      feedbackValue,
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
    },
    { enabled: false }
  );

  const handleExport = async () => {
    try {
      const { data } = await exportQuery.refetch();
      if (!data) return;
      downloadBlob(
        JSON.stringify(data, null, 2),
        `feedback-emails-${new Date().toISOString().slice(0, 10)}.json`,
        "application/json",
      );
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
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

        <Select
          value={feedbackValue}
          onValueChange={(v) => setFeedbackValue(v as typeof feedbackValue)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Feedback</SelectItem>
            <SelectItem value="correct">Correct</SelectItem>
            <SelectItem value="wrong_forward">Wrong Forward</SelectItem>
            <SelectItem value="wrong_skip">Wrong Skip</SelectItem>
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

        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exportQuery.isFetching}
          className="h-9 text-xs"
        >
          <Download className="mr-1 h-3.5 w-3.5" />
          {exportQuery.isFetching ? "Exporting..." : "Export JSON"}
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[70px]">ID</TableHead>
              <TableHead className="w-[130px]">Feedback Time</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Sender</TableHead>
              <TableHead className="max-w-[200px]">Subject</TableHead>
              <TableHead>AI Decision</TableHead>
              <TableHead>Feedback</TableHead>
              <TableHead>Snapshot</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : allItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  No feedback records found.
                </TableCell>
              </TableRow>
            ) : (
              allItems.map((row, i) => {
                const isExpanded = expandedId === row.id;
                return (
                  <ExpandableEmailRow
                    key={row.id}
                    isExpanded={isExpanded}
                    onToggle={() => setExpandedId(isExpanded ? null : row.id)}
                    rowClassName={cn("cursor-pointer transition-colors", i % 2 === 1 && "bg-muted/30")}
                    colSpan={8}
                    detail={
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                          <span>Received: <strong className="text-foreground">{fmtTime(row.receivedAt)}</strong></span>
                          <span>Provider: <strong className="text-foreground">{row.aiProvider}</strong></span>
                          <span>Model: <strong className="text-foreground">{row.aiModel}</strong></span>
                          <span>Tokens: <strong className="text-foreground">{row.aiTokensInput.toLocaleString()}/{row.aiTokensOutput.toLocaleString()}</strong></span>
                          <span>Latency: <strong className="text-foreground">{row.aiLatencyMs.toLocaleString()}ms</strong></span>
                          {row.attachmentCount > 0 && (
                            <span>Attachments: <strong className="text-foreground">{row.attachmentCount}</strong></span>
                          )}
                          {row.imageCount > 0 && (
                            <span>Images: <strong className="text-foreground">{row.imageCount}</strong></span>
                          )}
                        </div>
                        {row.aiReasoning && (
                          <div>
                            <span className="text-xs font-medium text-muted-foreground">AI Reasoning:</span>
                            <p className="mt-1 whitespace-pre-wrap text-xs">{row.aiReasoning}</p>
                          </div>
                        )}
                        {row.userFeedbackReason && (
                          <div>
                            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">User Feedback Reason:</span>
                            <p className="mt-1 whitespace-pre-wrap text-xs">{row.userFeedbackReason}</p>
                          </div>
                        )}
                        {row.processingError && (
                          <div>
                            <span className="text-xs font-medium text-red-600 dark:text-red-400">Processing Error:</span>
                            <p className="mt-1 whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">
                              {row.processingError}
                            </p>
                          </div>
                        )}
                        {row.deliveryError && (
                          <div>
                            <span className="text-xs font-medium text-red-600 dark:text-red-400">Delivery Error:</span>
                            <p className="mt-1 whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">
                              {row.deliveryError}
                            </p>
                          </div>
                        )}
                        {row.hasSnapshot && (
                          <EmailSnapshotDetail
                            processedEmailId={row.id}
                            fromName={row.fromName}
                            fromAddress={row.fromAddress}
                            toEmail={row.user.email}
                            subject={row.subject}
                          />
                        )}
                      </div>
                    }
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.id.slice(0, 8)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {row.userFeedbackAt ? fmtTime(row.userFeedbackAt) : "—"}
                    </TableCell>
                    <TableCell className="text-xs">{row.user.name}</TableCell>
                    <TableCell className="max-w-[150px] truncate text-xs" title={row.fromAddress}>
                      {row.fromName || row.fromAddress}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs" title={row.subject}>
                      {row.subject}
                    </TableCell>
                    <TableCell>
                      <DecisionBadge forwarded={row.forwarded} isManualForward={row.isManualForward} aiDecision={row.aiDecision} aiRelevant={row.aiRelevant} isDuplicateSlug={row.isDuplicateSlug} skipForwardReason={row.skipForwardReason} />
                    </TableCell>
                    <TableCell>
                      <FeedbackBadge value={row.userFeedback} />
                    </TableCell>
                    <TableCell>
                      {row.hasSnapshot ? (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900 dark:text-green-200 dark:hover:bg-green-900">
                          Captured
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">None</span>
                      )}
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
  );
}

// ---------------------------------------------------------------------------
// Event Snapshot Detail — lazily fetches decrypted event snapshot
// ---------------------------------------------------------------------------

function EventSnapshotDetail({ extractedEventId }: { extractedEventId: string }) {
  const snapshot = trpc.admin.eventFeedbackSnapshotDetail.useQuery(
    { extractedEventId },
    { staleTime: Infinity }
  );

  if (snapshot.isLoading) {
    return <p className="text-xs text-muted-foreground">Loading snapshot...</p>;
  }
  if (!snapshot.data) {
    return <p className="text-xs text-muted-foreground">No snapshot data available.</p>;
  }

  const s = snapshot.data;

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Event Snapshot
      </h4>
      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        <span>Title: <strong className="text-foreground">{s.title}</strong></span>
        <span>Date: <strong className="text-foreground">{s.eventDate ? new Date(s.eventDate).toLocaleDateString() : "—"}</strong></span>
        {s.location && <span>Location: <strong className="text-foreground">{s.location}</strong></span>}
        {s.children && s.children.length > 0 && (
          <span>Children: <strong className="text-foreground">{s.children.join(", ")}</strong></span>
        )}
      </div>
      {s.details && (
        <div>
          <span className="text-xs font-medium text-muted-foreground">Details:</span>
          <p className="mt-0.5 whitespace-pre-wrap text-xs">{s.details}</p>
        </div>
      )}
      {s.feedbackReason && (
        <div>
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Feedback Reason:</span>
          <p className="mt-0.5 whitespace-pre-wrap text-xs">{s.feedbackReason}</p>
        </div>
      )}
      {s.emails.length > 0 && (
        <div className="border-t pt-2 mt-2 space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Captured Email{s.emails.length > 1 ? "s" : ""}
          </h4>
          {s.emails.map((email, i) => (
            <div key={i} className="rounded-md border border-border/50 overflow-hidden">
              <div className="flex flex-col gap-0.5 px-3 py-2 text-xs text-muted-foreground bg-muted/30">
                <span>From: <strong className="text-foreground">{email.fromName ? `${email.fromName} <${email.fromAddress}>` : email.fromAddress}</strong></span>
                <span>Subject: <strong className="text-foreground">{email.subject}</strong></span>
              </div>
              {email.body ? (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t bg-background p-3 text-xs">
                  {email.body}
                </pre>
              ) : email.bodyHtml ? (
                <iframe
                  srcDoc={email.bodyHtml}
                  sandbox=""
                  className="w-full h-64 border-t bg-background"
                  title={`Email body: ${email.subject}`}
                />
              ) : (
                <p className="border-t px-3 py-2 text-xs text-muted-foreground italic">Body not captured</p>
              )}
            </div>
          ))}
        </div>
      )}
      {s.emails.length === 0 && s.sourceEmails.length > 0 && (
        <div className="border-t pt-2 mt-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Source Email{s.sourceEmails.length > 1 ? "s" : ""}
          </h4>
          <div className="rounded-md border border-border/50 overflow-hidden">
            {s.sourceEmails.map((src, i) => (
              <div
                key={i}
                className={`flex items-baseline gap-1.5 px-2 py-1 text-xs ${i % 2 === 0 ? "bg-muted/30" : ""}`}
              >
                <span className="shrink-0 text-muted-foreground/50">•</span>
                <span>
                  {src.subject}
                  <span className="ml-1.5 text-muted-foreground">
                    {src.fromName ? `${src.fromName} <${src.fromAddress}>` : src.fromAddress}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground italic">Email bodies were not captured (Gmail may have been disconnected).</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event AI Feedback Tab
// ---------------------------------------------------------------------------

function EventAIFeedbackTab() {
  const users = trpc.admin.users.useQuery();

  const [userId, setUserId] = useState<string>("all");
  const [feedbackValue, setFeedbackValue] = useState<
    "all" | "correct" | "wrong_event"
  >("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const dateRange = datePresetToRange(datePreset);

  const query = trpc.admin.eventFeedbackRecords.useInfiniteQuery(
    {
      userId: userId === "all" ? undefined : userId,
      feedbackValue,
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
    },
    {
      getNextPageParam: (last) => last.nextCursor,
    }
  );

  const allItems = query.data?.pages.flatMap((p) => p.items) ?? [];

  const exportQuery = trpc.admin.eventFeedbackExport.useQuery(
    {
      userId: userId === "all" ? undefined : userId,
      feedbackValue,
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
    },
    { enabled: false }
  );

  const handleExport = async () => {
    try {
      const { data } = await exportQuery.refetch();
      if (!data) return;
      downloadBlob(
        JSON.stringify(data, null, 2),
        `feedback-events-${new Date().toISOString().slice(0, 10)}.json`,
        "application/json",
      );
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
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

        <Select
          value={feedbackValue}
          onValueChange={(v) => setFeedbackValue(v as typeof feedbackValue)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Feedback</SelectItem>
            <SelectItem value="correct">Correct</SelectItem>
            <SelectItem value="wrong_event">Wrong Event</SelectItem>
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

        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exportQuery.isFetching}
          className="h-9 text-xs"
        >
          <Download className="mr-1 h-3.5 w-3.5" />
          {exportQuery.isFetching ? "Exporting..." : "Export JSON"}
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[70px]">ID</TableHead>
              <TableHead className="w-[130px]">Feedback Time</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Event Title</TableHead>
              <TableHead className="w-[110px]">Event Date</TableHead>
              <TableHead>Children</TableHead>
              <TableHead>Feedback</TableHead>
              <TableHead>Snapshot</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : allItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  No event feedback found.
                </TableCell>
              </TableRow>
            ) : (
              allItems.map((row, i) => {
                const isExpanded = expandedId === row.id;
                return (
                  <ExpandableEmailRow
                    key={row.id}
                    isExpanded={isExpanded}
                    onToggle={() => setExpandedId(isExpanded ? null : row.id)}
                    rowClassName={cn("cursor-pointer transition-colors", i % 2 === 1 && "bg-muted/30")}
                    colSpan={8}
                    detail={
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                          <span>Created: <strong className="text-foreground">{fmtTime(row.createdAt)}</strong></span>
                          {row.location && (
                            <span>Location: <strong className="text-foreground">{row.location}</strong></span>
                          )}
                          <span>All Day: <strong className="text-foreground">{row.allDay ? "Yes" : "No"}</strong></span>
                        </div>
                        {row.details && (
                          <div>
                            <span className="text-xs font-medium text-muted-foreground">Details:</span>
                            <p className="mt-1 whitespace-pre-wrap text-xs">{row.details}</p>
                          </div>
                        )}
                        {row.processedEmail && (
                          <div>
                            <span className="text-xs font-medium text-muted-foreground">Email Decision:</span>
                            <div className="mt-1 flex items-center gap-2">
                              <DecisionBadge
                                forwarded={row.processedEmail.forwarded}
                                isManualForward={row.processedEmail.isManualForward}
                                aiDecision={row.processedEmail.aiDecision}
                                aiRelevant={row.processedEmail.aiRelevant}
                                isDuplicateSlug={row.processedEmail.isDuplicateSlug}
                                skipForwardReason={row.processedEmail.skipForwardReason}
                              />
                            </div>
                          </div>
                        )}
                        {row.processedEmail?.aiReasoning && (
                          <div>
                            <span className="text-xs font-medium text-muted-foreground">AI Reasoning:</span>
                            <p className="mt-1 whitespace-pre-wrap text-xs">{row.processedEmail.aiReasoning}</p>
                          </div>
                        )}
                        {row.sourceEmails.length > 0 && (
                          <div>
                            <span className="text-xs font-medium text-muted-foreground">
                              Source Email{row.sourceEmails.length > 1 ? "s" : ""}
                            </span>
                            <div className="mt-1 rounded-md border border-border/50 overflow-hidden">
                              {row.sourceEmails.map((src, i) => (
                                <div
                                  key={i}
                                  className={`flex items-baseline gap-1.5 px-2 py-1 text-xs ${i % 2 === 0 ? "bg-muted/30" : ""}`}
                                >
                                  <span className="shrink-0 text-muted-foreground/50">•</span>
                                  <span>
                                    {src.subject}
                                    <span className="ml-1.5 text-muted-foreground">
                                      {src.fromName ? `${src.fromName} <${src.fromAddress}>` : src.fromAddress}
                                    </span>
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {row.userFeedbackReason && (
                          <div>
                            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Feedback Reason:</span>
                            <p className="mt-1 whitespace-pre-wrap text-xs">{row.userFeedbackReason}</p>
                          </div>
                        )}
                        {row.hasSnapshot && (
                          <EventSnapshotDetail extractedEventId={row.id} />
                        )}
                      </div>
                    }
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.id.slice(0, 8)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {row.userFeedbackAt ? fmtTime(row.userFeedbackAt) : "—"}
                    </TableCell>
                    <TableCell className="text-xs">{row.user.name}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs" title={row.title}>
                      {row.isTodo && (
                        <span className="mr-1 inline-flex items-center rounded-sm bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                          TO-DO
                        </span>
                      )}
                      {row.title}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(row.eventDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.children.length > 0 ? row.children.join(", ") : "—"}
                    </TableCell>
                    <TableCell>
                      <FeedbackBadge value={row.userFeedback} />
                    </TableCell>
                    <TableCell>
                      {row.hasSnapshot ? (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900 dark:text-green-200 dark:hover:bg-green-900">
                          Captured
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">None</span>
                      )}
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
  );
}

// ---------------------------------------------------------------------------
// Page (with Suspense boundary for useSearchParams)
// ---------------------------------------------------------------------------

function FeedbackPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = searchParams.get("tab") ?? "general";

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Feedback</h1>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set("tab", v);
          router.replace(`/admin/feedback?${params.toString()}`);
        }}
      >
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="email-ai">Email AI</TabsTrigger>
          <TabsTrigger value="event-ai">Event AI</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <GeneralFeedbackTab />
        </TabsContent>

        <TabsContent value="email-ai">
          <EmailAIFeedbackTab />
        </TabsContent>

        <TabsContent value="event-ai">
          <EventAIFeedbackTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function AdminFeedbackPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <h1 className="text-3xl font-bold">Feedback</h1>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <FeedbackPageInner />
    </Suspense>
  );
}
