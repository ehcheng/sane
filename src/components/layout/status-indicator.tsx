"use client";

import Link from "next/link";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type StatusLevel = "green" | "yellow" | "red";

interface StatusIndicatorProps {
  gmailStatus?: string | null; // "ACTIVE" | "NEEDS_REAUTH" | "DISCONNECTED"
  isMonitoringEnabled?: boolean;
  lastPolledAt?: string | Date | null;
  wizardComplete?: boolean;
  hasRequiredConfig?: boolean;
}

function getStatus(props: StatusIndicatorProps): {
  level: StatusLevel;
  label: string;
  href: string;
} {
  const { gmailStatus, isMonitoringEnabled, wizardComplete, hasRequiredConfig } = props;

  // Red: setup wizard not finished
  if (wizardComplete === false) {
    return { level: "red", label: "Setup incomplete", href: "/setup" };
  }

  // Red: Gmail needs reauth or disconnected
  if (gmailStatus === "NEEDS_REAUTH") {
    return { level: "red", label: "Gmail needs reconnection", href: "/settings#email-setup" };
  }
  if (gmailStatus === "DISCONNECTED" || !gmailStatus) {
    return { level: "red", label: "Gmail not connected", href: "/settings#email-setup" };
  }

  // Red: required config missing (parents, children, forwarding)
  if (hasRequiredConfig === false) {
    return { level: "red", label: "Configuration missing", href: "/settings#family" };
  }

  // Yellow: Gmail active but monitoring paused
  if (!isMonitoringEnabled) {
    return { level: "yellow", label: "Monitoring paused", href: "/settings#email-setup" };
  }

  // Green: all good
  return { level: "green", label: "All systems active", href: "/settings#email-setup" };
}

const DOT_STYLES: Record<StatusLevel, string> = {
  green: "bg-green-500",
  yellow: "bg-amber-500",
  red: "bg-red-500 animate-pulse",
};

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

export function StatusIndicator(props: StatusIndicatorProps) {
  const { level, label, href } = getStatus(props);

  const lastPolled = props.lastPolledAt ? new Date(props.lastPolledAt) : null;
  const relativeTime = lastPolled ? formatRelativeTime(lastPolled) : null;
  const absoluteTime = lastPolled
    ? lastPolled.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={href}
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 transition-colors hover:bg-accent"
            aria-label={label}
          >
            <span
              className={cn(
                "block h-2.5 w-2.5 rounded-full shrink-0",
                DOT_STYLES[level]
              )}
            />
            {relativeTime && level !== "red" && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {relativeTime}
              </span>
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{label}</p>
          {absoluteTime && (
            <p className="text-xs text-muted-foreground">Last checked: {absoluteTime}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
