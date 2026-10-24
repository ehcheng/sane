"use client";

import { Suspense } from "react";
import { useIsNarrowViewport } from "@/hooks/use-mobile";
import { EventsPage, EventsPageSkeleton } from "@/components/events/events-page";
import { AgendaMobileShell } from "@/components/agenda/agenda-mobile-shell";

export default function EventsRoute() {
  const isNarrow = useIsNarrowViewport();

  if (isNarrow) {
    return <AgendaMobileShell />;
  }

  return (
    <Suspense fallback={<EventsPageSkeleton />}>
      <EventsPage />
    </Suspense>
  );
}
