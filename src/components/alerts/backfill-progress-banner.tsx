"use client";

import { Loader2, AlertCircle, CheckCircle2, XCircle, X } from "lucide-react";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { BackfillProgress, BackfillStatus } from "@/lib/backfill-types";

export function BackfillProgressBanner() {
  const [cancelledVisible, setCancelledVisible] = useState(true);

  const { data } = trpc.email.backfillStatus.useQuery(undefined, {
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Poll every 3s while active or cancelling
      if (status === "active" || status === "cancelling") return 3000;
      return false;
    },
  });

  const cancelBackfill = trpc.email.cancelBackfill.useMutation();

  // Auto-hide cancelled banner after 4s
  useEffect(() => {
    if (data?.status === "cancelled") {
      setCancelledVisible(true);
      const timer = setTimeout(() => setCancelledVisible(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [data?.status]);

  if (!data || data.status === "idle" || data.status === "completed") {
    return null;
  }

  if (data.status === "cancelled" && !cancelledVisible) {
    return null;
  }

  const progress = data.progress as BackfillProgress;
  const isFailed = data.status === "failed";
  const isCancelled = data.status === "cancelled";
  const isActive = data.status === "active" || data.status === "cancelling";
  const pct =
    progress.total && progress.total > 0
      ? Math.round(((progress.current ?? 0) / progress.total) * 100)
      : 0;

  if (isFailed) {
    return (
      <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            <p className="text-sm font-medium text-red-900 dark:text-red-100">
              Email scan encountered an error
            </p>
          </div>
          {(data as { error?: string }).error && (
            <p className="mt-1 pl-6 text-xs text-red-700 dark:text-red-300">
              {(data as { error?: string }).error}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  if (isCancelled) {
    return (
      <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
              {progress.message ?? "Scan cancelled"}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          {progress.phase === "complete" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          ) : (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
          )}
          <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
            {progress.message ?? "Scanning emails..."}
          </p>
          {isActive && data.status !== "cancelling" && (
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-6 w-6 shrink-0 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
              onClick={() => {
                if (window.confirm("Cancel the email scan? Emails already processed will be kept.")) {
                  cancelBackfill.mutate();
                }
              }}
              disabled={cancelBackfill.isPending}
              title="Cancel scan"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
          {data.status === "cancelling" && (
            <span className="ml-auto text-xs text-blue-600 dark:text-blue-400">Cancelling...</span>
          )}
        </div>

        {/* Progress bar — show when we have a total */}
        {progress.total && progress.total > 0 && (
          <div className="mt-2 pl-6">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-200 dark:bg-blue-800">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-300 dark:bg-blue-400"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
              {progress.current} of {progress.total} emails
              {(progress.eventsFound ?? 0) > 0 && (
                <> &middot; {progress.eventsFound} event{progress.eventsFound === 1 ? "" : "s"} found</>
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
