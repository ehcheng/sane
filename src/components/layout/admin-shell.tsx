"use client";

import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/** Top-level header tabs */
const topNav = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/settings", label: "Settings" },
];

/** Dashboard sidebar sub-navigation */
const sidebarLinks = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/emails", label: "Emails" },
  { href: "/admin/feedback", label: "Feedback" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/ai-logs", label: "AI Logs" },
  { href: "/admin/insights", label: "Insights" },
];

function isSettingsPage(pathname: string) {
  return pathname.startsWith("/admin/settings");
}

function isDashboardActive(pathname: string) {
  return pathname.startsWith("/admin") && !isSettingsPage(pathname);
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: branding } = trpc.admin.brandingConfig.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const brandName = branding?.brandName ?? "SANE";

  const showSidebar = isDashboardActive(pathname);

  return (
    <div className="min-h-dvh bg-background">
      {/* Top header bar */}
      <header className="sticky top-0 z-40 border-b border-red-500/30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-semibold">
              Admin: {brandName}
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {topNav.map((link) => {
                const active =
                  link.href === "/admin"
                    ? isDashboardActive(pathname)
                    : pathname.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>
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
          {/* Mobile hamburger */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Mobile nav drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="right" className="w-64">
          <SheetHeader>
            <SheetTitle>
              <Link href="/" onClick={() => setMobileOpen(false)}>
                Admin
              </Link>
            </SheetTitle>
          </SheetHeader>
          <nav className="mt-6 flex flex-col gap-1">
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Dashboard
            </p>
            {sidebarLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                  pathname === link.href
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground"
                )}
              >
                {link.label}
              </Link>
            ))}
            <Separator className="my-2" />
            <Link
              href="/admin/settings"
              onClick={() => setMobileOpen(false)}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                isSettingsPage(pathname)
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground"
              )}
            >
              Settings
            </Link>
          </nav>
          <Separator className="my-4" />
          {session?.user?.name && (
            <p className="px-3 text-sm text-muted-foreground">
              {session.user.name}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2 px-3">
            <ThemeToggle />
            <span className="text-sm text-muted-foreground">Theme</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start"
            onClick={() => {
              setMobileOpen(false);
              signOut({ callbackUrl: "/login" });
            }}
          >
            Sign out
          </Button>
        </SheetContent>
      </Sheet>

      {/* Body: sidebar + content */}
      {showSidebar ? (
        <div className="mx-auto max-w-7xl flex">
          {/* Desktop sidebar */}
          <aside className="hidden md:flex w-48 shrink-0 flex-col border-r min-h-[calc(100dvh-3.5rem)]">
            <nav className="sticky top-14 flex flex-col gap-0.5 px-2 py-4">
              {sidebarLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                    pathname === link.href
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="flex-1 min-w-0 px-4 py-8">{children}</main>
        </div>
      ) : (
        <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
      )}
    </div>
  );
}
