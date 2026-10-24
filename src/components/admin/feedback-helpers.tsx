"use client";

import { useEffect, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import {
  Table,
  TableHead,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowDown, ArrowUp, ArrowUpDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Date / time helpers
// ---------------------------------------------------------------------------

export function fmtTime(d: string | Date) {
  const dt = new Date(d);
  return dt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type DatePreset = "today" | "7d" | "30d" | "all";

export function datePresetToRange(preset: DatePreset): { from?: string; to?: string } {
  if (preset === "all") return {};
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  if (preset === "today") return { from: to, to };
  const d = new Date();
  d.setDate(d.getDate() - (preset === "7d" ? 7 : 30));
  return { from: d.toISOString().slice(0, 10), to };
}

export function localTzAbbr() {
  return new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value ?? "";
}

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------

export function useDebounce(value: string, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Badge components
// ---------------------------------------------------------------------------

export function FeedbackBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;

  let cls: string;
  let label: string;

  switch (value) {
    case "correct":
      cls = "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      label = "Correct";
      break;
    case "wrong_forward":
      cls = "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      label = "Wrong Forward";
      break;
    case "wrong_skip":
      cls = "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      label = "Wrong Skip";
      break;
    case "wrong_event":
      cls = "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      label = "Wrong Event";
      break;
    default:
      cls = "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
      label = value;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
        cls
      )}
    >
      {label}
    </span>
  );
}

export function DecisionBadge({ forwarded, isManualForward, aiDecision, aiRelevant, isDuplicateSlug, skipForwardReason }: { forwarded: boolean; isManualForward?: boolean; aiDecision: boolean; aiRelevant?: boolean; isDuplicateSlug?: boolean; skipForwardReason?: string | null }) {
  if (forwarded && isManualForward) {
    return (
      <span className="inline-flex items-center rounded-full border bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
        Manual Fwd
      </span>
    );
  }
  if (forwarded) {
    return (
      <span className="inline-flex items-center rounded-full border bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-900 dark:text-blue-200">
        Forwarded
      </span>
    );
  }
  if (aiDecision && isDuplicateSlug) {
    return (
      <span className="inline-flex items-center rounded-full border bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
        Duplicate
      </span>
    );
  }
  if (aiDecision && skipForwardReason === "BACKFILL") {
    return (
      <span className="inline-flex items-center rounded-full border bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        Backfill
      </span>
    );
  }
  if (aiDecision && skipForwardReason === "FORWARDING_DISABLED") {
    return (
      <span className="inline-flex items-center rounded-full border bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
        Brief Only
      </span>
    );
  }
  if (aiDecision && skipForwardReason === "NO_ADDRESSES") {
    return (
      <span className="inline-flex items-center rounded-full border bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
        No Address
      </span>
    );
  }
  if (aiDecision) {
    return (
      <span className="inline-flex items-center rounded-full border bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
        Not sent
      </span>
    );
  }
  if (aiRelevant !== false) {
    return (
      <span className="inline-flex items-center rounded-full border bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
        FYI
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
      Skipped
    </span>
  );
}

// ---------------------------------------------------------------------------
// Expandable table row — data row + inline detail row as siblings
// ---------------------------------------------------------------------------

export function ExpandableEmailRow({
  children,
  detail,
  isExpanded,
  onToggle,
  rowClassName,
  colSpan,
}: {
  children: ReactNode;
  detail: ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  rowClassName?: string;
  colSpan: number;
}) {
  return (
    <>
      <TableRow
        className={cn(rowClassName, isExpanded && "bg-accent/50")}
        onClick={onToggle}
      >
        {children}
      </TableRow>
      {isExpanded && (
        <tr>
          <td colSpan={colSpan} className="bg-muted/50 px-4 py-3">
            {detail}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// EmailSnapshotDetail — lazily fetches & displays decrypted email snapshot
// ---------------------------------------------------------------------------

export function EmailSnapshotDetail({ processedEmailId, fromName, fromAddress, toEmail, subject }: {
  processedEmailId: string;
  fromName: string | null;
  fromAddress: string;
  toEmail: string;
  subject: string;
}) {
  const snapshot = trpc.admin.feedbackSnapshotDetail.useQuery(
    { processedEmailId },
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
        Email Snapshot
      </h4>
      {s.aiSummary && (
        <div>
          <span className="text-xs font-medium text-muted-foreground">AI Summary:</span>
          <p className="mt-0.5 whitespace-pre-wrap text-xs">{s.aiSummary}</p>
        </div>
      )}
      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        <span>From: <strong className="text-foreground">{fromName ? `${fromName} <${fromAddress}>` : fromAddress}</strong></span>
        <span>To: <strong className="text-foreground">{toEmail}</strong></span>
        <span>Subject: <strong className="text-foreground">{subject}</strong></span>
      </div>
      {s.body ? (
        <div>
          <span className="text-xs font-medium text-muted-foreground">Email Body:</span>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded border bg-background p-3 text-xs">
            {s.body}
          </pre>
        </div>
      ) : s.bodyHtml ? (
        <div>
          <span className="text-xs font-medium text-muted-foreground">Email Body (HTML):</span>
          <iframe
            srcDoc={s.bodyHtml}
            sandbox=""
            className="mt-1 w-full h-64 rounded border bg-background"
            title="Email body preview"
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">Email body was not captured (Gmail may have been disconnected).</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable column header
// ---------------------------------------------------------------------------

export type SortField = "createdAt" | "receivedAt" | "subject" | "fromAddress" | "user" | "tokens" | "latency";

export function SortableHeader({
  label,
  field,
  current,
  dir,
  onSort,
  className,
  tooltip,
}: {
  label: string;
  field: SortField;
  current: SortField;
  dir: "asc" | "desc";
  onSort: (field: SortField) => void;
  className?: string;
  tooltip?: string;
}) {
  const active = current === field;
  return (
    <TableHead className={className}>
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
          onClick={() => onSort(field)}
        >
          {label}
          {active ? (
            dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUpDown className="h-3 w-3 opacity-40" />
          )}
        </button>
        {tooltip && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 opacity-40 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </span>
    </TableHead>
  );
}
