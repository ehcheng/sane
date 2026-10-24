"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { StatusIndicator } from "@/components/layout/status-indicator";
import { StatusBanners } from "@/components/alerts/page-banners";
import { TourProvider } from "@/components/tour/tour-provider";
import { TourSpotlight } from "@/components/tour/tour-spotlight";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { StatusBarBlur } from "@/components/layout/status-bar-blur";

const navLinks = [
  { href: "/events", label: "Events" },
  { href: "/settings", label: "Settings" },
  { href: "/faq", label: "FAQ" },
  { href: "/feedback", label: "Feedback" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const isNavigatingAway = useRef(false);
  const [broadcastDismissed, setBroadcastDismissed] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);

  /** Navigate to an external/API URL without the auth useEffect interfering. */
  const navigateAway = useCallback((url: string) => {
    isNavigatingAway.current = true;
    window.location.href = url;
  }, []);

  const { data: globalStatus } = trpc.user.globalMonitoringStatus.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    enabled: status !== "unauthenticated",
  });
  const { data: emailConn } = trpc.email.connectionStatus.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    enabled: status !== "unauthenticated",
  });
  const { data: statusSummary } = trpc.user.statusSummary.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    enabled: status !== "unauthenticated",
  });
  const brandName = globalStatus?.brandName ?? "SANE";

  // Reset dismiss state when the broadcast message changes (new broadcast)
  useEffect(() => {
    const msg = globalStatus?.broadcastMessage;
    if (!msg) return;
    const dismissed = sessionStorage.getItem("broadcast_dismissed");
    if (dismissed === msg) {
      setBroadcastDismissed(true);
    } else {
      setBroadcastDismissed(false);
    }
  }, [globalStatus?.broadcastMessage]);

  useEffect(() => {
    if (status === "unauthenticated" && !isNavigatingAway.current) {
      // Use window.location for a full-page redirect so middleware handles it
      window.location.href = `/login?callbackUrl=${encodeURIComponent(pathname)}`;
    }
  }, [status, pathname]);

  // Not yet confirmed as authenticated — show skeleton that matches authenticated layout
  if (status !== "authenticated") {
    return (
      <div className="min-h-dvh bg-background">
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 pt-safe">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Image src="/sane_ollie.png" alt="" width={28} height={28} unoptimized className="rounded-full" />
                <span className="text-lg font-semibold">{brandName}</span>
              </div>
              {/* Ghost nav tabs */}
              <div className="hidden md:flex items-center gap-1">
                <div className="h-5 w-14 rounded bg-muted animate-pulse" />
                <div className="h-5 w-14 rounded bg-muted animate-pulse" />
                <div className="h-5 w-16 rounded bg-muted animate-pulse" />
              </div>
            </div>
            <div className="hidden md:flex items-center gap-3">
              <div className="h-5 w-24 rounded bg-muted animate-pulse" />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 pb-8">
          <div className="space-y-4">
            <div className="h-8 w-40 rounded bg-muted animate-pulse" />
            <div className="h-10 w-full rounded-md bg-muted/60 animate-pulse" />
            <div className="space-y-3 pt-2">
              <div className="h-16 w-full rounded-lg border bg-muted/30 animate-pulse" />
              <div className="h-16 w-full rounded-lg border bg-muted/30 animate-pulse" />
              <div className="h-16 w-full rounded-lg border bg-muted/30 animate-pulse" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      <StatusBarBlur />
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 pt-safe">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
              <Image src="/sane_ollie.png" alt="" width={28} height={28} unoptimized className="rounded-full" />
              {brandName}
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={(e) => {
                      if (isActive) {
                        e.preventDefault();
                        window.dispatchEvent(new CustomEvent("nav-reclick"));
                      }
                    }}
                    className={cn(
                      "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary dark:bg-primary/20"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <StatusIndicator
              gmailStatus={emailConn?.status}
              isMonitoringEnabled={globalStatus?.isGlobalMonitoringEnabled}
              lastPolledAt={emailConn?.lastPolledAt}
              wizardComplete={statusSummary?.wizardComplete}
              hasRequiredConfig={statusSummary?.hasRequiredConfig}
            />
            <div className="hidden md:flex items-center gap-3">
              {session?.user?.name && (
                <span className="text-sm text-muted-foreground">
                  {session.user.name}
                </span>
              )}
              <ThemeToggle />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </header>

      {globalStatus && !globalStatus.isGlobalMonitoringEnabled && (
        <div className="border-b border-amber-500/30 bg-amber-50 px-4 py-3 text-center text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
          Email monitoring is temporarily paused system-wide. Your settings are preserved.
        </div>
      )}
      {emailConn?.status === "NEEDS_REAUTH" && (
        <div className="border-b border-red-500/30 bg-red-50 px-4 py-3 text-center text-sm text-red-800 dark:bg-red-950/20 dark:text-red-200">
          Your Gmail connection has expired.{" "}
          <button
            type="button"
            onClick={() => navigateAway(`/api/gmail/connect?returnTo=${encodeURIComponent(pathname)}`)}
            className="font-medium underline underline-offset-4 hover:text-red-900"
          >
            Reconnect now
          </button>{" "}
          to resume email monitoring.
        </div>
      )}
      {globalStatus?.primaryDeactivated && (
        <div className="border-b border-red-500/30 bg-red-50 px-4 py-3 text-center text-sm text-red-800 dark:bg-red-950/20 dark:text-red-200">
          Your household owner&apos;s account has been deactivated. New email processing is paused until they reactivate.
        </div>
      )}
      {globalStatus?.lifecycleEnforcementEnabled && globalStatus?.accountStatus === "WARNING" && !warningDismissed && (
        <div className="relative border-b border-amber-500/30 bg-amber-50 px-4 py-3 pr-10 text-center text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
          Your account has been inactive and will be deactivated soon. Using the app keeps your account active.
          <button
            type="button"
            onClick={() => setWarningDismissed(true)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-amber-600 hover:bg-amber-200/50 hover:text-amber-900 dark:text-amber-400 dark:hover:bg-amber-800/50 dark:hover:text-amber-100"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {globalStatus?.broadcastMessage && !broadcastDismissed && (
        <div className="relative border-b border-blue-500/30 bg-blue-50 px-4 py-3 pr-10 text-center text-sm text-blue-800 dark:bg-blue-950/20 dark:text-blue-200">
          {globalStatus.broadcastMessage}
          <button
            type="button"
            onClick={() => {
              setBroadcastDismissed(true);
              sessionStorage.setItem("broadcast_dismissed", globalStatus.broadcastMessage!);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-blue-600 hover:bg-blue-200/50 hover:text-blue-900 dark:text-blue-400 dark:hover:bg-blue-800/50 dark:hover:text-blue-100"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <main className="mx-auto max-w-5xl px-4 pb-[calc(var(--mobile-tab-bar-h)+env(safe-area-inset-bottom)+1rem)] md:pb-8">
        <div className="mb-4 space-y-2 empty:mb-0">
          <StatusBanners />
        </div>
        <TourProvider>
          {children}
          <TourSpotlight />
        </TourProvider>
      </main>
      <MobileTabBar />
    </div>
  );
}
