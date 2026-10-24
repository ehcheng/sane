"use client";

import { useSession } from "next-auth/react";
import { MobileTabBar } from "./mobile-tab-bar";

/**
 * Renders the MobileTabBar only when the user is authenticated.
 * Use on pages outside the (app) route group (e.g. the home page)
 * that don't have AppShell but should still show bottom navigation
 * for logged-in mobile users.
 */
export function MobileTabBarConditional() {
  const { status } = useSession();
  if (status !== "authenticated") return null;
  return <MobileTabBar />;
}
