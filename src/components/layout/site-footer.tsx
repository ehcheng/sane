"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";

export function SiteFooter() {
  const { data: session, status } = useSession();
  const isLoggedIn = status === "authenticated";
  const isAdmin = session?.user?.role === "ADMIN";

  return (
    <footer className={cn("border-t bg-muted/40", isLoggedIn && !isAdmin && "hidden md:block")}>
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-4 py-6 sm:flex-row sm:justify-between">
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">
            SANE
          </Link>
          {isLoggedIn && !isAdmin && (
            <>
              <Link href="/events" className="hover:text-foreground transition-colors">
                Events
              </Link>
              <Link href="/settings" className="hover:text-foreground transition-colors">
                Settings
              </Link>
              <Link href="/faq" className="hover:text-foreground transition-colors">
                FAQ
              </Link>
              <Link href="/feedback" className="hover:text-foreground transition-colors">
                Feedback
              </Link>
              <Link href="/privacy" className="hover:text-foreground transition-colors">
                Privacy
              </Link>
              <Link href="/terms" className="hover:text-foreground transition-colors">
                Terms
              </Link>
            </>
          )}
          {isAdmin && (
            <>
              <Link href="/admin" className="hover:text-foreground transition-colors">
                Dashboard
              </Link>
              <Link href="/admin/emails" className="hover:text-foreground transition-colors">
                Emails
              </Link>
              <Link href="/admin/users" className="hover:text-foreground transition-colors">
                Users
              </Link>
              <Link href="/admin/settings" className="hover:text-foreground transition-colors">
                Settings
              </Link>
              <Link href="/faq" className="hover:text-foreground transition-colors">
                FAQ
              </Link>
              <Link href="/admin/feedback" className="hover:text-foreground transition-colors">
                Feedback
              </Link>
              <Link href="/privacy" className="hover:text-foreground transition-colors">
                Privacy
              </Link>
              <Link href="/terms" className="hover:text-foreground transition-colors">
                Terms
              </Link>
            </>
          )}
          {!isLoggedIn && (
            <>
              <Link href="/faq" className="hover:text-foreground transition-colors">
                FAQ
              </Link>
              <Link href="/privacy" className="hover:text-foreground transition-colors">
                Privacy
              </Link>
              <Link href="/terms" className="hover:text-foreground transition-colors">
                Terms
              </Link>
              <Link href="/login" className="hover:text-foreground transition-colors">
                Sign in
              </Link>
              <Link href="/signup" className="hover:text-foreground transition-colors">
                Sign up
              </Link>
            </>
          )}
        </nav>
        <p className="text-xs text-muted-foreground">
          SANE: School Alerts, Notices &amp; Essentials
        </p>
      </div>
    </footer>
  );
}
