"use client";

import { useState, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PAGE_SIZE = 20;

export function SenderPicker() {
  const utils = trpc.useUtils();
  const [scanDays, setScanDays] = useState(30);
  const { data: senderData, isLoading, isFetching } =
    trpc.email.fetchRecentSenders.useQuery({ days: scanDays });
  const { data: allowedSenders = [] } = trpc.allowedSenders.list.useQuery();
  const { data: globalStatus } = trpc.user.globalMonitoringStatus.useQuery();
  const createSender = trpc.allowedSenders.create.useMutation({
    onSuccess: () => {
      utils.allowedSenders.list.invalidate();
    },
  });
  const deleteSender = trpc.allowedSenders.delete.useMutation({
    onSuccess: () => {
      utils.allowedSenders.list.invalidate();
    },
  });
  const triggerBackfill = trpc.email.triggerBackfill.useMutation();

  const [manualDomain, setManualDomain] = useState("");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const backfillTriggered = useRef(false);

  const showDebugUI = globalStatus?.showDebugUI ?? false;

  // Build a set of currently-allowed domain patterns for quick lookup
  const allowedPatterns = new Set(
    allowedSenders.map((s) => s.pattern.toLowerCase())
  );

  const handleToggleDomain = async (domain: string, checked: boolean) => {
    const pattern = `@${domain}`;
    if (checked) {
      await createSender.mutateAsync({ pattern });
      // Trigger backfill when going from 0→1 senders
      if (allowedSenders.length === 0 && !backfillTriggered.current) {
        backfillTriggered.current = true;
        triggerBackfill.mutate();
      }
    } else {
      const sender = allowedSenders.find(
        (s) => s.pattern.toLowerCase() === pattern
      );
      if (sender) {
        await deleteSender.mutateAsync({ id: sender.id });
      }
    }
  };

  const handleAddManual = async () => {
    let domain = manualDomain.trim().toLowerCase();
    if (!domain) return;
    // Allow entering with or without @
    if (!domain.startsWith("@")) domain = `@${domain}`;
    await createSender.mutateAsync({ pattern: domain });
    setManualDomain("");
    // Trigger backfill when going from 0→1 senders
    if (allowedSenders.length === 0 && !backfillTriggered.current) {
      backfillTriggered.current = true;
      triggerBackfill.mutate();
    }
  };

  const allDomains = senderData?.domains ?? [];

  // Search filters the full set; lazy loading only applies to results
  const filteredDomains = useMemo(() => {
    if (!search.trim()) return allDomains;
    const q = search.trim().toLowerCase();
    return allDomains.filter(
      (d) =>
        d.domain.includes(q) ||
        d.senderNames.some((n) => n.toLowerCase().includes(q))
    );
  }, [allDomains, search]);

  const isSearching = search.trim().length > 0;
  // When searching, show all results; otherwise paginate
  const visibleDomains = isSearching
    ? filteredDomains
    : filteredDomains.slice(0, visibleCount);
  const hasMore = !isSearching && visibleCount < filteredDomains.length;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">
          Choose Your School Senders
        </CardTitle>
        <CardDescription>
          We found these email domains in your recent inbox. Select the ones
          from your kids&apos; school — only those will be monitored.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            <div className="h-10 rounded-md bg-muted animate-pulse" />
            <div className="h-10 rounded-md bg-muted animate-pulse" />
            <div className="h-10 rounded-md bg-muted animate-pulse" />
          </div>
        ) : allDomains.length > 0 ? (
          <>
            <Input
              placeholder="Search by domain or sender name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {filteredDomains.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                No domains match &ldquo;{search}&rdquo;. You can add it manually below.
              </p>
            ) : (
              <>
                <div className="max-h-80 space-y-1 overflow-y-auto">
                  {visibleDomains.map((d) => {
                    const pattern = `@${d.domain}`;
                    const isChecked = allowedPatterns.has(pattern);
                    return (
                      <label
                        key={d.domain}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-1.5 transition-colors ${
                          isChecked
                            ? "border-primary bg-primary/5"
                            : "hover:border-muted-foreground/30"
                        }`}
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={(checked) =>
                            handleToggleDomain(d.domain, !!checked)
                          }
                          disabled={
                            createSender.isPending || deleteSender.isPending
                          }
                        />
                        <span className="text-sm font-medium shrink-0">@{d.domain}</span>
                        {d.senderNames.length > 0 && (
                          <span className="text-xs text-muted-foreground truncate">
                            {d.senderNames.join(", ")}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
                {hasMore && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-muted-foreground"
                    onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  >
                    Show more ({filteredDomains.length - visibleCount} remaining)
                  </Button>
                )}
                <div className="flex items-center justify-between">
                  {!isSearching && (
                    <p className="text-xs text-muted-foreground">
                      Showing {visibleDomains.length} of {allDomains.length} domains
                    </p>
                  )}
                  {scanDays < 180 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground h-auto py-1"
                      onClick={() => setScanDays((d) => Math.min(d * 2, 180))}
                      disabled={isFetching}
                    >
                      {isFetching ? "Scanning..." : "Scan further back"}
                    </Button>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No non-personal senders found in your recent inbox. Add your
            school&apos;s email domain manually below.
          </p>
        )}

        {/* Manual domain entry */}
        <p className="text-xs text-muted-foreground">
          Don&apos;t see your school&apos;s domain? Type it in below.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="e.g. @umbrellaacademy.edu"
            value={manualDomain}
            onChange={(e) => setManualDomain(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddManual();
              }
            }}
            className="flex-1"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddManual}
            disabled={
              !manualDomain.trim() || createSender.isPending
            }
          >
            Add
          </Button>
        </div>

        {allowedSenders.length === 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Select at least one school domain to continue.
          </p>
        )}

        {allowedSenders.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Selected senders ({allowedSenders.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {allowedSenders.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                >
                  {s.pattern}
                  <button
                    type="button"
                    onClick={() => deleteSender.mutate({ id: s.id })}
                    className="ml-0.5 hover:text-destructive"
                    aria-label={`Remove ${s.pattern}`}
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {showDebugUI && (
          <Button
            variant="outline"
            size="sm"
            className="w-full bg-orange-100 hover:bg-orange-200 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:hover:bg-orange-900/50 dark:text-orange-300 dark:border-orange-700"
            onClick={() => {
              utils.email.fetchRecentSenders.invalidate();
              setVisibleCount(PAGE_SIZE);
              setScanDays(30);
            }}
            disabled={isFetching}
          >
            {isFetching ? "Fetching..." : "Debug: Re-fetch Domains"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
