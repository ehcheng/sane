export type TourId = "events" | "emails" | "settings";

/** Subset of user data available to dynamic tour step bodies */
export interface TourUserContext {
  individualForwardingEnabled: boolean;
  emailAccountType: string; // "DEDICATED" | "SHARED"
}

/** Resolve a step body — handles both static strings and dynamic functions */
export function resolveBody(
  body: string | ((ctx: TourUserContext) => string),
  ctx: TourUserContext
): string {
  return typeof body === "function" ? body(ctx) : body;
}

export interface TourStep {
  /** Unique key for this step */
  key: string;
  /** data-tour attribute value to find the target element. null = welcome (centered) */
  target: string | null;
  /** Popover placement relative to target */
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  title: string;
  body: string | ((ctx: TourUserContext) => string);
  /** If this returns true, skip this step automatically */
  skipWhen?: () => boolean;
}

export interface TourDefinition {
  id: TourId;
  steps: TourStep[];
}

export const TOUR_DEFINITIONS: Record<TourId, TourDefinition> = {
  events: {
    id: "events",
    steps: [
      {
        key: "events-welcome",
        target: null,
        title: "Welcome to SANE",
        body: (ctx) => {
          const base =
            "Your school emails are now being monitored. Events like field trips, early dismissals, and picture days are extracted automatically and appear here.";
          const forwardNote =
            ctx.individualForwardingEnabled
              ? " We\u2019ve scanned your recent emails to populate these events; going forward, new emails will also be forwarded to you as they arrive."
              : "";
          return base + forwardNote + " Let\u2019s take a quick look around.";
        },
      },
      {
        key: "events-view-toggle",
        target: "events-view-toggle",
        side: "bottom",
        align: "start",
        title: "Two Ways to View",
        body: "Switch between Agenda (a scrolling timeline) and Month (a calendar grid). Tap the active view again to jump back to today.",
      },
      {
        key: "events-child-filter",
        target: "events-child-filter",
        side: "bottom",
        align: "start",
        title: "Filter by Child",
        body: 'Tap a name to see only that child\u2019s events. Tap "All" to see everything.',
        skipWhen: () => !document.querySelector('[data-tour="events-child-filter"]'),
      },
      {
        key: "events-add-event",
        target: "events-add-event",
        side: "bottom",
        align: "end",
        title: "Add Your Own Events",
        body: "See something SANE missed? Tap here to manually add events like field trips or picture day.",
        skipWhen: () => !document.querySelector('[data-tour="events-add-event"]'),
      },
    ],
  },
  emails: {
    id: "emails",
    steps: [
      {
        key: "emails-welcome",
        target: null,
        title: "Email Log",
        body: "This is your email processing log. Every school email SANE analyzes appears here, grouped by day. Tap any email to see the AI summary and reasoning, re-forward it, or give feedback.",
      },
      {
        key: "emails-stats",
        target: "emails-stats",
        side: "bottom",
        align: "start",
        title: "Quick Stats",
        body: "See at a glance how your emails break down — actionable vs. FYI.",
        skipWhen: () => !document.querySelector('[data-tour="emails-stats"]'),
      },
    ],
  },
  settings: {
    id: "settings",
    steps: [],
  },
};
