"use client";

import { trpc } from "@/lib/trpc";

export function LifetimeStatsBar() {
  const { data: stats, isLoading } = trpc.activity.lifetimeStats.useQuery(
    undefined,
    { staleTime: 60_000 }
  );
  const { data: user } = trpc.user.me.useQuery();

  const isDedicated = user?.emailAccountType === "DEDICATED";

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="font-medium">Lifetime</span>
        <span className="text-border">&mdash;</span>
        <span className="h-4 w-32 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (!stats || stats.processed === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">Lifetime</span>
      <span className="text-border">&mdash;</span>
      <span>
        <span className="font-medium tabular-nums">{stats.processed.toLocaleString()}</span>{" "}
        processed
      </span>
      <span className="text-border">&middot;</span>
      <span>
        <span className="font-medium tabular-nums">{stats.actionable.toLocaleString()}</span>{" "}
        actionable
      </span>
      {isDedicated && (
        <>
          <span className="text-border">&middot;</span>
          <span>
            <span className="font-medium tabular-nums">{stats.forwarded.toLocaleString()}</span>{" "}
            forwarded
          </span>
        </>
      )}
    </div>
  );
}
