/**
 * Shared types for the agenda view components.
 *
 * These map from the existing Prisma ExtractedEvent/Child models
 * to the agenda view's display-oriented interface.
 */

export interface AgendaEvent {
  id: string;
  title: string;
  location: string | null;
  startsAt: string; // ISO string
  endsAt: string | null; // ISO string
  allDay: boolean;
  isTodo: boolean;
  isDone: boolean;
  doneAt: string | null; // ISO string
  actionable: boolean;
  aiGenerated: boolean;
  children: Array<{ id: string; name: string }>;
  details: string | null; // user-editable details field
  summary: string | null; // AI summary, plain text with bullet prefixes
  links: Array<{ url: string; label: string }> | null;
  source: {
    subject: string;
    sender: string;
    receivedAt: string;
  } | null;
  feedback: string | null;
}

export interface AgendaChild {
  id: string;
  name: string;
  colorInk: string;
  colorInkDark: string;
  color: string;
}

export interface AgendaDay {
  date: string; // YYYY-MM-DD
  events: AgendaEvent[];
}

export interface CarryForwardData {
  items: AgendaEvent[];
  count: number;
}

export interface AgendaFilter {
  childIds: string[] | null; // null = all
  showCompleted: boolean;
  actionableOnly: boolean;
}
