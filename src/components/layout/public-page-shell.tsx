"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { PublicHeader } from "./public-header";
import { MobileTabBar } from "./mobile-tab-bar";
import { trpc } from "@/lib/trpc";

/**
 * Shell for public pages (FAQ, Terms, Privacy) that need to work
 * both publicly and within the logged-in mobile app experience.
 *
 * When authenticated on mobile: shows a minimal header + tab bar
 * instead of PublicHeader's hamburger menu.
 * Desktop and unauthenticated: shows PublicHeader as normal.
 */
export function PublicPageShell({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const isLoggedIn = status === "authenticated";
  const { data: brand } = trpc.user.brandInfo.useQuery(undefined, {
    enabled: isLoggedIn,
  });
  const brandName = brand?.brandName ?? "SANE";

  return (
    <div className="bg-background min-h-dvh">
      {isLoggedIn ? (
        <>
          {/* Desktop: full PublicHeader with nav */}
          <div className="hidden md:block">
            <PublicHeader />
          </div>
          {/* Mobile: minimal header matching app-shell style */}
          <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl pt-safe md:hidden">
            <div className="flex h-14 items-center px-4">
              <Link href="/events" className="flex items-center gap-2 text-lg font-semibold">
                <Image src="/sane_ollie.png" alt="" width={28} height={28} unoptimized className="rounded-full" />
                {brandName}
              </Link>
            </div>
          </header>
        </>
      ) : (
        <PublicHeader />
      )}

      <div className={isLoggedIn ? "pb-[calc(var(--mobile-tab-bar-h)+env(safe-area-inset-bottom))] md:pb-0" : ""}>
        {children}
      </div>

      {isLoggedIn && <MobileTabBar />}
    </div>
  );
}
