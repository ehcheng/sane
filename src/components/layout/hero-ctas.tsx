"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";

export function HeroCTAs() {
  const { status } = useSession();

  if (status !== "unauthenticated") return null;

  return (
    <div className="flex items-center justify-center gap-4">
      <Link
        href="/signup"
        className="rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
      >
        Get Started
      </Link>
      <Link
        href="/login"
        className="rounded-md border border-input bg-background px-6 py-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        Sign In
      </Link>
    </div>
  );
}
