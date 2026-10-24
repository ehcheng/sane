/** Shape of the progress object stored on a backfill BullMQ job */
export interface BackfillProgress {
  phase?: string;
  current?: number;
  total?: number;
  message?: string;
  eventsFound?: number;
  emailsRelevant?: number;
}

/** Possible statuses returned by the backfillStatus query */
export type BackfillStatus =
  | "idle"
  | "active"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed";
