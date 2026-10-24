"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { format, isToday, isTomorrow, isYesterday } from "date-fns";
import { ChevronLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EventEditForm } from "@/components/events/event-actions";
import { ChildName } from "./child-name";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";
import { FormattedSummary } from "@/components/events/formatted-summary";
import type { AgendaEvent, AgendaChild } from "./types";

// ── History back hook ─────────────────────────────────────────────────

/**
 * Pushes a history entry on mount so browser back dismisses the detail
 * view instead of navigating away. Returns a handleBack callback that
 * goes through history.back() to fire popstate consistently.
 */
function useHistoryBack(onBack: () => void) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const mountedRef = useRef(false);

  useEffect(() => {
    // Guard against React strict mode double-mount
    if (!mountedRef.current) {
      history.pushState({ agendaDetail: true }, "");
      mountedRef.current = true;
    }

    const handler = () => onBackRef.current();
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  return useCallback(() => history.back(), []);
}

// ── Public component ──────────────────────────────────────────────────

interface EventDetailViewProps {
  events: AgendaEvent[];
  initialIndex: number;
  allChildren: AgendaChild[];
  onBack: () => void;
  onEventUpdated: () => void;
  /** When true, action buttons log to console instead of calling tRPC. */
  mock?: boolean;
}

/**
 * Full-screen event detail view with horizontal swiping between events.
 * Pass mock={true} for the preview page (no tRPC calls).
 */
export function EventDetailView({
  events,
  initialIndex,
  allChildren,
  onBack,
  onEventUpdated,
  mock = false,
}: EventDetailViewProps) {
  const handleBack = useHistoryBack(onBack);

  const [emblaRef, emblaApi] = useEmblaCarousel({
    startIndex: initialIndex,
    align: "start",
    containScroll: false,
  });

  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setCurrentIndex(emblaApi.selectedScrollSnap());
    emblaApi.on("select", onSelect);
    return () => { emblaApi.off("select", onSelect); };
  }, [emblaApi]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Escape") { if (inInput) (e.target as HTMLElement).blur(); else handleBack(); return; }
      if (inInput) return;
      if (e.key === "ArrowLeft" || e.key === "k") { emblaApi?.scrollPrev(true); e.preventDefault(); return; }
      if (e.key === "ArrowRight" || e.key === "j") { emblaApi?.scrollNext(true); e.preventDefault(); return; }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleBack, emblaApi]);

  return (
    <div className="fixed inset-0 z-50 bg-[var(--agenda-surface)] flex flex-col">
      <header className="flex items-center h-12 px-[var(--agenda-gutter)] border-b border-[var(--agenda-divider)] flex-shrink-0">
        <button
          type="button"
          onClick={handleBack}
          className="flex items-center gap-1 text-agenda-accent-ink font-inter text-agenda-sm min-h-[var(--agenda-touch-min)] -ml-2 px-2 focus-visible:outline-2 focus-visible:outline-agenda-accent"
        >
          <ChevronLeft size={20} />
          Back
        </button>
        <div className="flex-1" />
        {events.length > 1 && (
          <span className="font-inter text-agenda-xs text-agenda-ink-muted">
            {currentIndex + 1} of {events.length}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-hidden" ref={emblaRef}>
        <div className="flex h-full">
          {events.map((event) => (
            <div key={event.id} className="flex-[0_0_100%] min-w-0 overflow-y-auto">
              {mock ? (
                <MockDetailCard event={event} allChildren={allChildren} onBack={handleBack} onEventUpdated={onEventUpdated} />
              ) : (
                <LiveDetailCard event={event} allChildren={allChildren} onBack={handleBack} onEventUpdated={onEventUpdated} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Card variants (split to satisfy Rules of Hooks) ───────────────────

interface DetailCardProps {
  event: AgendaEvent;
  allChildren: AgendaChild[];
  onBack: () => void;
  onEventUpdated: () => void;
}

/** Live card with tRPC mutations. */
function LiveDetailCard({ event, allChildren, onBack, onEventUpdated }: DetailCardProps) {
  const [editing, setEditing] = useState(false);
  const utils = trpc.useUtils();
  const markDone = trpc.events.markDone.useMutation({
    onSuccess: () => { utils.events.agenda.invalidate(); onEventUpdated(); },
  });
  const unmarkDone = trpc.events.unmarkDone.useMutation({
    onSuccess: () => { utils.events.agenda.invalidate(); onEventUpdated(); },
  });
  const deleteEvent = trpc.events.delete.useMutation({
    onSuccess: () => { utils.events.agenda.invalidate(); onBack(); },
  });
  const submitFeedback = trpc.events.submitEventFeedback.useMutation({
    onSuccess: () => { utils.events.agenda.invalidate(); },
  });

  const actions: CardActions = useMemo(() => ({
    onMarkDone: (id, isDone) => isDone ? unmarkDone.mutate({ id }) : markDone.mutate({ id }),
    onDelete: (id) => deleteEvent.mutate({ id }),
    onFeedback: (eventId, feedback) => submitFeedback.mutate({ eventId, feedback }),
    onEdit: () => setEditing(true),
    isPending: markDone.isPending || unmarkDone.isPending,
    icsHref: `/api/events/${event.id}/ics`,
  }), [event.id, markDone, unmarkDone, deleteEvent, submitFeedback]);

  if (editing) {
    // Map AgendaEvent to ActionableEvent shape for the edit form
    const actionableEvent = {
      id: event.id,
      title: event.title,
      eventDate: event.startsAt,
      endDate: event.endsAt,
      allDay: event.allDay,
      isTodo: event.isTodo,
      location: event.location,
      details: event.details,
      children: event.children,
      processedEmail: null,
    };
    return (
      <div className="px-[var(--agenda-gutter)] py-6">
        <EventEditForm event={actionableEvent} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  return <EventDetailCard event={event} allChildren={allChildren} actions={actions} />;
}

/** Mock card for the preview page. No tRPC calls. */
function MockDetailCard({ event, allChildren }: DetailCardProps) {
  const actions: CardActions = useMemo(() => ({
    onMarkDone: () => {},
    onDelete: () => {},
    onFeedback: () => {},
    onEdit: () => {},
    isPending: false,
    icsHref: "#",
  }), []);

  return <EventDetailCard event={event} allChildren={allChildren} actions={actions} />;
}

// ── Shared detail card ────────────────────────────────────────────────

interface CardActions {
  onMarkDone: (id: string, isDone: boolean) => void;
  onDelete: (id: string) => void;
  onFeedback: (eventId: string, feedback: "correct" | "wrong_event") => void;
  onEdit: (id: string) => void;
  isPending: boolean;
  icsHref: string;
}

function EventDetailCard({
  event,
  allChildren,
  actions,
}: {
  event: AgendaEvent;
  allChildren: AgendaChild[];
  actions: CardActions;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);

  const eventChildren = useMemo(
    () => event.children
      .map((ec) => allChildren.find((c) => c.id === ec.id))
      .filter((c): c is AgendaChild => c !== undefined),
    [event.children, allChildren]
  );

  const dateParts = useMemo(() => {
    const d = new Date(event.startsAt);
    let dayName: string;
    if (isToday(d)) dayName = "Today";
    else if (isTomorrow(d)) dayName = "Tomorrow";
    else if (isYesterday(d)) dayName = "Yesterday";
    else dayName = format(d, "EEEE");

    return {
      dayName,
      dateStr: format(d, "MMMM d"),
      timeStr: event.allDay ? "All day" : format(d, "h:mm a"),
    };
  }, [event.startsAt, event.allDay]);

  const { data: globalStatus } = trpc.user.globalMonitoringStatus.useQuery();
  const showEmailSummary = globalStatus?.showEmailSummaryInEvents && event.summary;

  const gcalUrl = useMemo(
    () => buildGoogleCalUrl(event, allChildren),
    [event, allChildren]
  );

  return (
    <div className="px-[var(--agenda-gutter)] py-6 pb-16">
      <div className="mb-1">
        <p className="text-agenda-day font-atkinson font-bold text-agenda-ink leading-[var(--agenda-leading-tight)]">
          {dateParts.dayName}, {dateParts.dateStr}
        </p>
        <p className="text-agenda-title font-inter text-agenda-ink-muted mt-0.5">
          {dateParts.timeStr}
          {event.aiGenerated && (
            <span className="ml-1.5" aria-label="AI-generated">✨</span>
          )}
        </p>
      </div>

      <h1 className="text-agenda-hero font-atkinson font-bold leading-[var(--agenda-leading-tight)] text-agenda-ink mt-3">
        {event.title}
      </h1>

      {eventChildren.length > 0 && (
        <p className="text-agenda-base font-atkinson mt-2">
          {eventChildren.map((child, i) => (
            <span key={child.id}>
              {i > 0 && <span className="text-agenda-ink-muted">, </span>}
              <ChildName child={child} />
            </span>
          ))}
        </p>
      )}

      {event.location && (
        <p className="text-agenda-base font-atkinson text-agenda-ink-muted mt-1">
          {event.location}
        </p>
      )}

      <div className="border-t border-[var(--agenda-divider)] my-5" />

      {event.details && (
        <div className="agenda-details-bg rounded-xl px-4 py-3 mb-4">
          <FormattedSummary text={event.details} variant="agenda" />
        </div>
      )}

      {showEmailSummary && (
        <div className="mb-5">
          <FormattedSummary text={event.summary!} variant="agenda" />
        </div>
      )}

      {event.links && event.links.length > 0 && (
        <div className="mb-5">
          <h3 className="text-agenda-xs font-inter text-agenda-ink-muted uppercase tracking-wider mb-2">Links</h3>
          <div className="space-y-2">
            {event.links.map((link, i) => {
              let domain = "";
              try { domain = new URL(link.url).hostname; } catch {}
              return (
                <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="block focus-visible:outline-2 focus-visible:outline-agenda-accent">
                  <span className="text-agenda-base font-atkinson text-agenda-accent-ink underline">↗ {link.label}</span>
                  {domain && <span className="block text-agenda-xs font-inter text-agenda-ink-muted pl-4">{domain}</span>}
                </a>
              );
            })}
          </div>
        </div>
      )}

      {event.source && (
        <div className="mb-5">
          <h3 className="text-agenda-xs font-inter text-agenda-ink-muted uppercase tracking-wider mb-2">From email</h3>
          <p className="text-agenda-base font-atkinson text-agenda-ink">{event.source.subject}</p>
          <p className="text-agenda-sm font-inter text-agenda-ink-muted mt-0.5">
            {event.source.sender} · {format(new Date(event.source.receivedAt), "MMM d")}
          </p>
        </div>
      )}

      <div className="border-t border-[var(--agenda-divider)] my-5" />

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => actions.onMarkDone(event.id, event.isDone)}
          disabled={actions.isPending}
          className={`w-full h-[var(--agenda-touch-primary)] rounded-xl font-inter font-medium text-agenda-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agenda-accent disabled:opacity-50 ${
            event.isDone ? "bg-agenda-accent text-white" : "bg-agenda-success text-white"
          }`}
        >
          {event.isDone ? "↺ Mark as Not Done" : "✓ Mark as Done"}
        </button>

        <div className="flex gap-3">
          <a href={gcalUrl} target="_blank" rel="noopener noreferrer" className="flex-1 h-[var(--agenda-touch-min)] rounded-xl border border-[var(--agenda-divider)] font-inter font-medium text-agenda-sm text-agenda-ink flex items-center justify-center focus-visible:outline-2 focus-visible:outline-agenda-accent">
            Add to Cal
          </a>
          <a href={actions.icsHref} download={actions.icsHref !== "#"} className="flex-1 h-[var(--agenda-touch-min)] rounded-xl border border-[var(--agenda-divider)] font-inter font-medium text-agenda-sm text-agenda-ink flex items-center justify-center focus-visible:outline-2 focus-visible:outline-agenda-accent">
            .ics
          </a>
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={() => actions.onEdit(event.id)} className="flex-1 h-[var(--agenda-touch-min)] rounded-xl border border-[var(--agenda-divider)] font-inter font-medium text-agenda-sm text-agenda-ink focus-visible:outline-2 focus-visible:outline-agenda-accent">
            Edit
          </button>
          <button type="button" onClick={() => setDeleteOpen(true)} className="flex-1 h-[var(--agenda-touch-min)] rounded-xl border border-[var(--agenda-divider)] font-inter font-medium text-agenda-sm text-agenda-danger focus-visible:outline-2 focus-visible:outline-agenda-accent">
            Delete
          </button>
        </div>

        <div className="pt-2">
          <p className="text-agenda-xs font-inter text-agenda-ink-muted mb-2">Was this useful?</p>
          <div className="flex gap-6">
            <button
              type="button"
              onClick={() => actions.onFeedback(event.id, "correct")}
              className={`h-[var(--agenda-touch-min)] w-[var(--agenda-touch-min)] rounded-xl text-xl flex items-center justify-center border focus-visible:outline-2 focus-visible:outline-agenda-accent transition-colors ${
                event.feedback === "correct"
                  ? "bg-agenda-success/20 border-agenda-success text-agenda-success"
                  : "border-[var(--agenda-divider)] grayscale opacity-50"
              }`}
              aria-label="Thumbs up"
              aria-pressed={event.feedback === "correct"}
            >
              👍
            </button>
            <button
              type="button"
              onClick={() => actions.onFeedback(event.id, "wrong_event")}
              className={`h-[var(--agenda-touch-min)] w-[var(--agenda-touch-min)] rounded-xl text-xl flex items-center justify-center border focus-visible:outline-2 focus-visible:outline-agenda-accent transition-colors ${
                event.feedback === "wrong_event"
                  ? "bg-agenda-danger/20 border-agenda-danger text-agenda-danger"
                  : "border-[var(--agenda-divider)] grayscale opacity-50"
              }`}
              aria-label="Thumbs down"
              aria-pressed={event.feedback === "wrong_event"}
            >
              👎
            </button>
          </div>
        </div>
      </div>

      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={() => { actions.onDelete(event.id); setDeleteOpen(false); }} title={event.title} />
    </div>
  );
}

function buildGoogleCalUrl(event: AgendaEvent, allChildren: AgendaChild[]): string {
  const fmt = (d: string) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const childNames = event.children.map((ec) => allChildren.find((c) => c.id === ec.id)?.name).filter(Boolean).join(", ");
  const title = childNames ? `${event.title} (${childNames})` : event.title;
  const endStr = event.endsAt ? fmt(event.endsAt) : fmt(new Date(new Date(event.startsAt).getTime() + (event.isTodo ? 30 * 60_000 : 60 * 60_000)).toISOString());
  const details = [event.summary ?? "", "", ...(event.links ?? []).map((l) => `${l.label}: ${l.url}`)].join("\n");
  const params = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${fmt(event.startsAt)}/${endStr}`, details, location: event.location ?? "" });
  return `https://calendar.google.com/calendar/render?${params}`;
}
