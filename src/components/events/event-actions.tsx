"use client";

import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/components/ui/use-toast";
import { buildGoogleCalendarUrl } from "@/lib/calendar-links";
import { CalendarPlus, CheckCircle2, Download, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTimezone } from "@/hooks/use-timezone";
import { toLocalInputValue, resolveEventDate, endTimeWrapsToNextDay, nextDayDate } from "@/lib/date-utils";
import { SegmentedDateInput, SegmentedTimeInput } from "@/components/ui/segmented-time-input";

// ---------------------------------------------------------------------------
// Shared event type for actions
// ---------------------------------------------------------------------------

export interface ActionableEvent {
  id: string;
  title: string;
  eventDate: string | Date;
  endDate?: string | Date | null;
  allDay: boolean;
  isTodo?: boolean;
  location: string | null;
  details: string | null;
  children: Array<{ id: string; name: string }>;
  processedEmail: { forwarded: boolean; aiSummary: string | null } | null;
  userFeedback?: string | null;
  userFeedbackReason?: string | null;
  isDone?: boolean;
  doneByName?: string | null;
}

// ---------------------------------------------------------------------------
// Inline SVG icons (same as activity-item.tsx)
// ---------------------------------------------------------------------------

function ThumbsUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
    </svg>
  );
}

function ThumbsDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M18 9.5a1.5 1.5 0 11-3 0v-6a1.5 1.5 0 013 0v6zM14 9.667v-5.43a2 2 0 00-1.106-1.79l-.05-.025A4 4 0 0011.057 2H5.64a2 2 0 00-1.962 1.608l-1.2 6A2 2 0 004.44 12H8v4a2 2 0 002 2 1 1 0 001-1v-.667a4 4 0 01.8-2.4l1.4-1.866a4 4 0 00.8-2.4z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// EventActionButtons — hover-visible icon buttons for event actions
// ---------------------------------------------------------------------------

interface EventActionButtonsProps {
  event: ActionableEvent;
  onEdit: () => void;
  className?: string;
}

export function EventActionButtons({
  event,
  onEdit,
  className,
}: EventActionButtonsProps) {
  const utils = trpc.useUtils();
  const [showReasonInput, setShowReasonInput] = useState(false);
  const [showOptIn, setShowOptIn] = useState(false);
  const [rememberChoice, setRememberChoice] = useState(false);
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);
  const reasonInputRef = useRef<HTMLInputElement>(null);

  const markDone = trpc.events.markDone.useMutation({
    onSuccess: () => {
      utils.events.list.invalidate();
      utils.events.upcoming.invalidate();
      toast({ title: "Marked as done" });
    },
    onError: (err) =>
      toast({ title: "Failed to mark as done", description: err.message, variant: "destructive" }),
  });

  const unmarkDone = trpc.events.unmarkDone.useMutation({
    onSuccess: () => {
      utils.events.list.invalidate();
      utils.events.upcoming.invalidate();
    },
    onError: (err) =>
      toast({ title: "Failed to unmark", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = trpc.events.delete.useMutation({
    onSuccess: () => {
      utils.events.list.invalidate();
      utils.events.upcoming.invalidate();
      toast({ title: "Event deleted" });
    },
    onError: (err) =>
      toast({
        title: "Failed to delete event",
        description: err.message,
        variant: "destructive",
      }),
  });

  const captureSnapshot = trpc.events.captureEventFeedbackSnapshot.useMutation({
    onError: (err) => {
      toast({
        title: "Failed to capture feedback snapshot",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const setConsent = trpc.user.setFeedbackTrainingConsent.useMutation();

  const submitFeedback = trpc.events.submitEventFeedback.useMutation({
    onSuccess: (data) => {
      utils.events.list.invalidate();
      utils.events.upcoming.invalidate();
      const consent = data.feedbackTrainingConsent;
      if (consent === "granted") {
        captureSnapshot.mutate({ eventId: event.id });
      } else if (consent === null || consent === undefined) {
        setPendingEventId(event.id);
        setShowOptIn(true);
      }
    },
    onError: (err) => {
      toast({
        title: "Failed to submit feedback",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const clearFeedback = trpc.events.clearEventFeedback.useMutation({
    onSuccess: () => {
      utils.events.list.invalidate();
      utils.events.upcoming.invalidate();
    },
    onError: (err) => {
      toast({
        title: "Failed to clear feedback",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleFeedback = (feedback: string) => {
    if (feedback === "correct") {
      if (event.userFeedback === "correct") {
        clearFeedback.mutate({ eventId: event.id });
        return;
      }
      submitFeedback.mutate({ eventId: event.id, feedback: "correct" });
      return;
    }
    // Thumbs down — show reason input
    setShowReasonInput(true);
  };

  const submitWithReason = (reason: string) => {
    const trimmed = reason.trim();
    const existingReason = event.userFeedbackReason ?? "";
    if (event.userFeedback === "wrong_event" && trimmed === existingReason) {
      setShowReasonInput(false);
      return;
    }
    setShowReasonInput(false);
    submitFeedback.mutate({
      eventId: event.id,
      feedback: "wrong_event",
      reason: trimmed || undefined,
    });
  };

  useEffect(() => {
    if (showReasonInput) reasonInputRef.current?.focus();
  }, [showReasonInput]);

  const summary = event.processedEmail?.aiSummary;

  return (
    <div>
      <TooltipProvider>
        <div className={className}>
          {/* Mark as Done / Undo */}
          <Tooltip delayDuration={500}>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className={cn(
                  "h-9 w-9 p-0 md:h-7 md:w-7",
                  event.isDone
                    ? "text-green-600 bg-green-50 dark:bg-green-950"
                    : "text-muted-foreground/50"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  if (event.isDone) {
                    unmarkDone.mutate({ id: event.id });
                  } else {
                    markDone.mutate({ id: event.id });
                  }
                }}
                disabled={markDone.isPending || unmarkDone.isPending}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {event.isDone
                ? `Done${event.doneByName ? ` by ${event.doneByName}` : ""}`
                : "Mark as done"}
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={500}>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-9 w-9 p-0 md:h-7 md:w-7"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Edit
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={500}>
            <TooltipTrigger asChild>
              <a
                href={buildGoogleCalendarUrl({
                  title: event.title,
                  eventDate: new Date(event.eventDate),
                  endDate: event.endDate ? new Date(event.endDate) : null,
                  allDay: event.allDay,
                  isTodo: event.isTodo,
                  location: event.location,
                  description: summary,
                })}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 w-9 p-0 md:h-7 md:w-7"
                  type="button"
                  tabIndex={-1}
                >
                  <CalendarPlus className="h-3.5 w-3.5" />
                </Button>
              </a>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Add to Google Calendar
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={500}>
            <TooltipTrigger asChild>
              <a href={`/api/events/${event.id}/ics`} download>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 w-9 p-0 md:h-7 md:w-7"
                  type="button"
                  tabIndex={-1}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
              </a>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Download .ics
            </TooltipContent>
          </Tooltip>

          <AlertDialog>
            <Tooltip delayDuration={500}>
              <TooltipTrigger asChild>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 w-9 p-0 text-destructive hover:text-destructive md:h-7 md:w-7"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </AlertDialogTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Delete
              </TooltipContent>
            </Tooltip>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete event?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove &ldquo;{event.title}&rdquo;.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteMutation.mutate({ id: event.id })}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? "Deleting..." : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Feedback thumbs — right-justified */}
          <div className="ml-auto flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            <Tooltip delayDuration={500}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-accent md:h-7 md:w-7",
                    event.userFeedback === "correct"
                      ? "text-green-600 bg-green-50 dark:bg-green-950"
                      : "text-muted-foreground/50 hover:text-foreground"
                  )}
                  onClick={() => handleFeedback("correct")}
                  disabled={submitFeedback.isPending || clearFeedback.isPending}
                >
                  <ThumbsUpIcon className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Event is correct
              </TooltipContent>
            </Tooltip>
            <Tooltip delayDuration={500}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-accent md:h-7 md:w-7",
                    event.userFeedback === "wrong_event"
                      ? "text-red-600 bg-red-50 dark:bg-red-950"
                      : "text-muted-foreground/50 hover:text-foreground"
                  )}
                  onClick={() => handleFeedback("wrong_event")}
                  disabled={submitFeedback.isPending}
                >
                  <ThumbsDownIcon className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Event is wrong
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>

      {/* Reason input for thumbs-down feedback */}
      {showReasonInput && (
        <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <input
            ref={reasonInputRef}
            key={event.id + showReasonInput}
            type="text"
            defaultValue={event.userFeedbackReason ?? ""}
            placeholder="What's wrong? (optional, Enter to submit)"
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={500}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitWithReason(e.currentTarget.value);
              } else if (e.key === "Escape") {
                setShowReasonInput(false);
              }
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setShowReasonInput(false)}
          >
            Cancel
          </Button>
          {event.userFeedback === "wrong_event" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-red-600 hover:text-red-700 dark:text-red-400"
              onClick={() => {
                setShowReasonInput(false);
                clearFeedback.mutate({ eventId: event.id });
              }}
              disabled={clearFeedback.isPending}
            >
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Inline opt-in prompt for feedback training */}
      {showOptIn && (
        <div className="mt-2 rounded border border-blue-200 bg-blue-50 p-2.5 dark:border-blue-800 dark:bg-blue-950" onClick={(e) => e.stopPropagation()}>
          <p className="text-xs text-blue-900 dark:text-blue-100">
            Help improve SANE? Let us use this event data to make AI decisions better.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                if (pendingEventId) captureSnapshot.mutate({ eventId: pendingEventId });
                if (rememberChoice) setConsent.mutate({ consent: "granted" });
                setShowOptIn(false);
              }}
              disabled={captureSnapshot.isPending}
            >
              Yes
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                if (rememberChoice) setConsent.mutate({ consent: "denied" });
                setShowOptIn(false);
              }}
            >
              No thanks
            </Button>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-blue-700 dark:text-blue-300">
              <input
                type="checkbox"
                checked={rememberChoice}
                onChange={(e) => setRememberChoice(e.target.checked)}
                className="h-3 w-3 rounded border-blue-400"
              />
              Remember
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EventEditForm — inline edit form for title + date
// ---------------------------------------------------------------------------

interface EventEditFormProps {
  event: ActionableEvent;
  onCancel: () => void;
}

export function EventEditForm({ event, onCancel }: EventEditFormProps) {
  const utils = trpc.useUtils();
  const tz = useTimezone();
  const { data: children = [] } = trpc.children.list.useQuery();
  const [editTitle, setEditTitle] = useState(event.title);
  const [editAllDay, setEditAllDay] = useState(event.allDay);
  const [editIsTodo, setEditIsTodo] = useState(event.isTodo ?? false);
  const [editChildIds, setEditChildIds] = useState<string[]>(
    event.children.map((c) => c.id)
  );
  const [editDetails, setEditDetails] = useState(event.details ?? "");
  const [editDate, setEditDate] = useState(() => {
    const d = new Date(event.eventDate);
    return toLocalInputValue(d, tz, !event.allDay).slice(0, 10);
  });
  const [editStartTime, setEditStartTime] = useState(() => {
    if (event.allDay) return "09:00";
    const d = new Date(event.eventDate);
    return toLocalInputValue(d, tz, true).slice(11, 16) || "09:00";
  });
  const [editEndTime, setEditEndTime] = useState(() => {
    if (event.allDay || !event.endDate) return "";
    const d = new Date(event.endDate);
    return toLocalInputValue(d, tz, true).slice(11, 16) || "";
  });

  const handleAllDayToggle = (checked: boolean) => {
    setEditAllDay(checked);
    if (checked) {
      setEditEndTime("");
    }
  };

  const updateMutation = trpc.events.update.useMutation({
    onSuccess: () => {
      utils.events.list.invalidate();
      utils.events.upcoming.invalidate();
      utils.events.agenda.invalidate();
      onCancel();
      toast({ title: "Event updated" });
    },
    onError: (err) =>
      toast({
        title: "Failed to update event",
        description: err.message,
        variant: "destructive",
      }),
  });

  const handleSave = () => {
    const dateInput = editAllDay ? editDate : `${editDate}T${editStartTime}`;
    const eventDateIso = resolveEventDate(dateInput, editAllDay, tz);
    if (!eventDateIso) {
      toast({ title: "Invalid date", variant: "destructive" });
      return;
    }
    let endDateIso: string | null = null;
    if (!editAllDay && editEndTime) {
      const endDateStr = endTimeWrapsToNextDay(editStartTime, editEndTime)
        ? nextDayDate(editDate)
        : editDate;
      endDateIso = resolveEventDate(`${endDateStr}T${editEndTime}`, false, tz);
    }
    updateMutation.mutate({
      id: event.id,
      title: editTitle,
      eventDate: eventDateIso,
      endDate: endDateIso,
      allDay: editAllDay,
      isTodo: editIsTodo,
      details: editDetails.trim() || null,
      childIds: editChildIds,
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-background p-3">
      <Input
        value={editTitle}
        onChange={(e) => setEditTitle(e.target.value)}
        placeholder="Event title"
        className="h-8 text-sm"
        onClick={(e) => e.stopPropagation()}
      />
      <textarea
        value={editDetails}
        onChange={(e) => setEditDetails(e.target.value)}
        placeholder="Details (optional)"
        rows={2}
        maxLength={1000}
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm resize-y"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <SegmentedDateInput
          value={editDate}
          onChange={setEditDate}
        />
        {!editAllDay && (
          <>
            <SegmentedTimeInput
              value={editStartTime}
              onChange={setEditStartTime}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <SegmentedTimeInput
              value={editEndTime}
              onChange={setEditEndTime}
              clearable
            />
            {editEndTime && endTimeWrapsToNextDay(editStartTime, editEndTime) && (
              <span className="text-xs text-amber-600 dark:text-amber-400 whitespace-nowrap">+1 day</span>
            )}
          </>
        )}
        <div className="flex items-center gap-2">
          <label
            className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap cursor-pointer"
          >
            <input
              type="checkbox"
              checked={editAllDay}
              onChange={(e) => handleAllDayToggle(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-input accent-primary"
            />
            All day
          </label>
          <label
            className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 whitespace-nowrap cursor-pointer"
          >
            <input
              type="checkbox"
              checked={editIsTodo}
              onChange={(e) => {
                setEditIsTodo(e.target.checked);
                if (e.target.checked) handleAllDayToggle(true);
              }}
              className="h-3.5 w-3.5 rounded border-input accent-amber-500"
            />
            To-do
          </label>
        </div>
      </div>
      {children.length > 0 && (
        <div
          className="flex flex-wrap gap-x-3 gap-y-1 px-1"
          onClick={(e) => e.stopPropagation()}
        >
          {children.map((child) => (
            <label
              key={child.id}
              className="flex items-center gap-1.5 text-sm cursor-pointer"
            >
              <input
                type="checkbox"
                checked={editChildIds.includes(child.id)}
                onChange={(e) => {
                  setEditChildIds((prev) =>
                    e.target.checked
                      ? [...prev, child.id]
                      : prev.filter((id) => id !== child.id)
                  );
                }}
                className="h-3.5 w-3.5 rounded border-input accent-primary"
              />
              {child.name}
            </label>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-7"
          onClick={(e) => {
            e.stopPropagation();
            handleSave();
          }}
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? "Saving..." : "Save"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
