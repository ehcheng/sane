"use client";

import { createContext, useContext } from "react";

const HouseholdOwnerContext = createContext(true);

export function HouseholdOwnerProvider({
  isOwner,
  children,
}: {
  isOwner: boolean;
  children: React.ReactNode;
}) {
  return (
    <HouseholdOwnerContext.Provider value={isOwner}>
      {children}
    </HouseholdOwnerContext.Provider>
  );
}

/** Returns true for solo users and household owners, false for partners */
export function useIsHouseholdOwner() {
  return useContext(HouseholdOwnerContext);
}

/**
 * Renders children normally for owners. For partners, shows a banner
 * and disables interaction via pointer-events-none + reduced opacity.
 */
export function OwnerOnlySection({ children }: { children: React.ReactNode }) {
  const isOwner = useIsHouseholdOwner();
  if (isOwner) return <>{children}</>;

  return (
    <div className="relative">
      <div className="rounded-md border border-muted bg-muted/30 px-3 py-2 mb-3 text-xs text-muted-foreground">
        Managed by the household owner. Contact them to make changes.
      </div>
      <div className="opacity-60" inert>{children}</div>
    </div>
  );
}
