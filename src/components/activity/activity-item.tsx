"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronRight, CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { FormattedSummary, EventLinks, type EventLink } from "@/components/events/formatted-summary";

export interface ActivityEmail {
  id: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  aiDecision: boolean;
  aiRelevant?: boolean;
  aiSummary: string | null;
  aiLinks?: string | null;
  aiReasoning?: string | null;
  aiProvider?: string;
  forwarded: boolean;
  isManualForward: boolean;
  isDuplicateSlug?: boolean;
  deliveryStatus: string | null;
  deliveryError: string | null;
  attachmentCount: number;
  imageCount: number;
  userFeedback?: string | null;
  userFeedbackReason?: string | null;
  receivedAt?: string | Date;
  createdAt: string | Date;
}

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

export function ActivityItem({ email, defaultExpanded = false }: { email: ActivityEmail; defaultExpanded?: boolean }) {
  // Anchor target for event links
  const itemId = `activity-${email.id}`;
  const utils = trpc.useUtils();

  // Optimistic flag: the manual-forward mutation queues an async worker job,
  // so the DB won't reflect `forwarded=true` until the worker finishes.
  // This local state flips immediately on success so the UI updates right away
  // (badge → "Manually Forwarded", button hidden). The next background
  // invalidation will pick up the real DB state.
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [manuallyForwarded, setManuallyForwarded] = useState(false);
  const [showOptIn, setShowOptIn] = useState(false);
  const [rememberChoice, setRememberChoice] = useState(false);
  const [pendingEmailId, setPendingEmailId] = useState<string | null>(null);
  const [showReasonInput, setShowReasonInput] = useState(false);
  const [pendingWrongFeedback, setPendingWrongFeedback] = useState<string | null>(null);
  const reasonInputRef = useRef<HTMLInputElement>(null);

  const { data: user } = trpc.user.me.useQuery();
  const parsedLinks: EventLink[] = useMemo(() => {
    if (!user?.showLinksInSummary || !email.aiLinks) return [];
    try { return JSON.parse(email.aiLinks) as EventLink[]; } catch { return []; }
  }, [user?.showLinksInSummary, email.aiLinks]);

  const captureSnapshot = trpc.activity.captureFeedbackSnapshot.useMutation({
    onError: (err) => {
      toast({
        title: "Failed to capture feedback snapshot",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const setConsent = trpc.user.setFeedbackTrainingConsent.useMutation();

  const submitFeedback = trpc.activity.submitFeedback.useMutation({
    onSuccess: (data) => {
      utils.activity.invalidate();
      const consent = data.feedbackTrainingConsent;
      if (consent === "granted") {
        captureSnapshot.mutate({ emailId: email.id });
      } else if (consent === null || consent === undefined) {
        setPendingEmailId(email.id);
        setShowOptIn(true);
      }
      // consent === "denied" → do nothing
    },
    onError: (err) => {
      toast({
        title: "Failed to submit feedback",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const manualForward = trpc.activity.manualForward.useMutation({
    onSuccess: () => {
      // Only show "Manually Forwarded" badge for emails that weren't already forwarded
      if (!email.forwarded) setManuallyForwarded(true);
      toast({ title: "Email queued for forwarding" });
      // Delayed invalidation — give the worker a few seconds to process
      setTimeout(() => utils.activity.recent.invalidate(), 3000);
      setTimeout(() => utils.activity.recent.invalidate(), 8000);
    },
    onError: (err) => {
      toast({
        title: "Failed to forward",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const createSenderRule = trpc.senderRules.create.useMutation({
    onSuccess: (_, vars) => {
      utils.senderRules.list.invalidate();
      toast({
        title: `Sender rule created`,
        description: `${vars.senderEmail} will ${vars.action === "ALWAYS_FORWARD" ? "always" : "never"} be forwarded`,
      });
    },
    onError: (err) => {
      toast({
        title: "Failed to create rule",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const correctFeedback = "correct";
  const wrongFeedback = email.forwarded || email.aiDecision ? "wrong_forward" : "wrong_skip";

  const clearFeedback = trpc.activity.clearFeedback.useMutation({
    onSuccess: () => {
      utils.activity.invalidate();
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
    // Thumbs up — toggle: clear if already set, otherwise submit
    if (feedback === "correct") {
      if (email.userFeedback === correctFeedback) {
        clearFeedback.mutate({ emailId: email.id });
        return;
      }
      submitFeedback.mutate({ emailId: email.id, feedback: "correct" });
      return;
    }
    // Thumbs down — show reason input (pre-populate if editing existing)
    setPendingWrongFeedback(feedback);
    setShowReasonInput(true);
  };

  const submitWithReason = (reason: string) => {
    if (!pendingWrongFeedback) return;
    const trimmed = reason.trim();
    const existingReason = email.userFeedbackReason ?? "";
    // Skip API call if feedback type and reason are both unchanged
    if (email.userFeedback === pendingWrongFeedback && trimmed === existingReason) {
      setShowReasonInput(false);
      setPendingWrongFeedback(null);
      return;
    }
    setShowReasonInput(false);
    submitFeedback.mutate({
      emailId: email.id,
      feedback: pendingWrongFeedback as "wrong_forward" | "wrong_skip",
      reason: trimmed || undefined,
    });
    setPendingWrongFeedback(null);
  };

  // Auto-focus the reason input when it appears
  useEffect(() => {
    if (showReasonInput) reasonInputRef.current?.focus();
  }, [showReasonInput]);

  // Fetch events extracted from this email (only when expanded)
  const { data: emailEvents } = trpc.activity.eventsForEmail.useQuery(
    { emailId: email.id },
    { enabled: expanded }
  );

  const isRuleBased = email.aiProvider === "rule" || !!email.aiReasoning?.startsWith("Sender rule:");
  const isSkipped = !email.forwarded && !email.aiDecision && !manuallyForwarded;

  return (
    <div id={itemId} className="rounded-md border scroll-mt-4">
      {/* Clickable header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2 p-3 text-left transition-colors hover:bg-accent/30"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {email.subject}
            {email.attachmentCount > 0 && (
              <span
                className="ml-1.5 inline-flex items-center text-muted-foreground"
                title={`${email.attachmentCount} attachment(s)${email.imageCount > 0 ? `, ${email.imageCount} image(s)` : ""}`}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M15.621 4.379a3 3 0 00-4.242 0l-7 7a3 3 0 004.241 4.243h.001l.497-.5a.75.75 0 011.064 1.057l-.498.501-.002.002a4.5 4.5 0 01-6.364-6.364l7-7a4.5 4.5 0 016.368 6.36l-3.455 3.553A2.625 2.625 0 119.52 9.52l3.45-3.451a.75.75 0 111.061 1.06l-3.45 3.451a1.125 1.125 0 001.587 1.595l3.454-3.553a3 3 0 000-4.242z" clipRule="evenodd" />
                </svg>
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {email.fromName ?? email.fromAddress}
            {" \u00b7 "}
            {new Date(email.receivedAt ?? email.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex flex-col items-end gap-1">
            <div className="flex flex-wrap justify-end gap-1">
              {/* AI classification (always one) */}
              {email.aiDecision ? (
                <Badge variant="secondary">Actionable</Badge>
              ) : isRuleBased && !email.forwarded ? (
                <Badge variant="outline">Skipped (rule)</Badge>
              ) : email.aiRelevant !== false ? (
                <Badge variant="outline">FYI</Badge>
              ) : (
                <Badge variant="secondary">Skipped</Badge>
              )}
              {/* Delivery status */}
              {((email.forwarded && email.isManualForward) || manuallyForwarded) && (
                <Badge variant="default">Manually Forwarded</Badge>
              )}
              {email.forwarded && !email.isManualForward && !manuallyForwarded && isRuleBased && (
                <Badge variant="default">Forwarded (rule)</Badge>
              )}
              {email.forwarded && !email.isManualForward && !manuallyForwarded && !isRuleBased && (
                <Badge variant="default">Forwarded</Badge>
              )}
              {/* Special states */}
              {email.aiDecision && email.isDuplicateSlug && (
                <Badge variant="outline">Duplicate</Badge>
              )}
              {email.deliveryStatus === "manually_skipped" && (
                <Badge variant="outline">Manually Skipped</Badge>
              )}
            </div>
            {email.forwarded && email.deliveryStatus && email.deliveryStatus !== "pending" && (
              <Badge
                variant={
                  email.deliveryStatus === "delivered"
                    ? "default"
                    : email.deliveryStatus === "bounced" || email.deliveryStatus === "complained"
                      ? "destructive"
                      : "secondary"
                }
                className="text-[10px]"
                title={email.deliveryError ?? undefined}
              >
                {email.deliveryStatus === "delivered"
                  ? "Delivered"
                  : email.deliveryStatus === "bounced"
                    ? "Bounced"
                    : email.deliveryStatus === "complained"
                      ? "Spam Report"
                      : email.deliveryStatus === "delayed"
                        ? "Delayed"
                        : email.deliveryStatus}
              </Badge>
            )}
            {email.deliveryError && (email.deliveryStatus === "bounced" || email.deliveryStatus === "complained") && (
              <p className="text-[10px] text-red-600 dark:text-red-400 max-w-[200px] truncate" title={email.deliveryError}>
                {email.deliveryError}
              </p>
            )}
          </div>
          {/* Thumbs feedback — always visible in header */}
          <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            <TooltipProvider delayDuration={500}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-accent",
                      email.userFeedback === correctFeedback
                        ? "text-green-600 bg-green-50 dark:bg-green-950"
                        : "text-muted-foreground/50 hover:text-foreground"
                    )}
                    onClick={() => handleFeedback(correctFeedback)}
                    disabled={submitFeedback.isPending || clearFeedback.isPending}
                  >
                    <ThumbsUpIcon className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>AI made the right call</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-accent",
                      email.userFeedback === wrongFeedback
                        ? "text-red-600 bg-red-50 dark:bg-red-950"
                        : "text-muted-foreground/50 hover:text-foreground"
                    )}
                    onClick={() => {
                      setExpanded(true);
                      handleFeedback(wrongFeedback);
                    }}
                    disabled={submitFeedback.isPending}
                  >
                    <ThumbsDownIcon className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>AI got this one wrong</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform duration-200",
              expanded && "rotate-90"
            )}
          />
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-dashed px-3 pb-3 pt-2.5 space-y-3">
          {/* AI Summary */}
          {email.aiSummary && (
            <div className="rounded bg-muted/40 px-2.5 py-2">
              <FormattedSummary text={email.aiSummary} />
              {parsedLinks.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Links</p>
                  <EventLinks links={parsedLinks} />
                </div>
              )}
            </div>
          )}

          {/* AI Reasoning */}
          {email.aiReasoning && (
            <div className="pl-2 border-l-2 border-muted">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-0.5">
                Why this decision
              </p>
              <p className="text-xs text-muted-foreground">
                {email.aiReasoning}
              </p>
            </div>
          )}

          {/* Events extracted from this email */}
          {emailEvents && emailEvents.length > 0 && (
            <div className="pl-2 border-l-2 border-blue-200 dark:border-blue-800">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1 flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                Events from this email
              </p>
              <ul className="space-y-0.5">
                {emailEvents.map((ev) => (
                  <li key={ev.id} className="flex items-center gap-1.5 text-xs">
                    {ev.actionable && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" title="Actionable" />
                    )}
                    {!ev.actionable && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30" title="FYI" />
                    )}
                    <span className={cn(
                      "truncate",
                      ev.actionable ? "text-foreground" : "text-muted-foreground"
                    )}>
                      {ev.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground/60">
                      {ev.isTodo
                        ? "To-do"
                        : new Date(ev.eventDate).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions row */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              title={email.forwarded ? "Re-forward this email" : "Force forward this email"}
              onClick={(e) => {
                e.stopPropagation();
                manualForward.mutate({ emailId: email.id });
              }}
              disabled={manualForward.isPending}
            >
              {manualForward.isPending ? "Forwarding..." : email.forwarded ? "Re-Forward" : "Force Forward"}
            </Button>
            <button
              type="button"
              className="ml-auto h-7 px-2 text-[10px] font-mono text-muted-foreground/50 hover:text-muted-foreground transition-colors rounded"
              title="Click to copy email ID"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(email.id);
                toast({ title: "Email ID copied" });
              }}
            >
              ID: {email.id.slice(0, 8)}…
            </button>
          </div>

          {/* Reason input for thumbs-down feedback */}
          {showReasonInput && (
            <div className="flex items-center gap-2">
              <input
                ref={reasonInputRef}
                key={email.id + showReasonInput}
                type="text"
                defaultValue={email.userFeedbackReason ?? ""}
                placeholder="Why was this wrong? (optional, Enter to submit)"
                className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                maxLength={500}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitWithReason(e.currentTarget.value);
                  } else if (e.key === "Escape") {
                    setShowReasonInput(false);
                    setPendingWrongFeedback(null);
                  }
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => {
                  setShowReasonInput(false);
                  setPendingWrongFeedback(null);
                }}
              >
                Cancel
              </Button>
              {email.userFeedback === wrongFeedback && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-red-600 hover:text-red-700 dark:text-red-400"
                  onClick={() => {
                    setShowReasonInput(false);
                    setPendingWrongFeedback(null);
                    clearFeedback.mutate({ emailId: email.id });
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
            <div className="rounded border border-blue-200 bg-blue-50 p-2.5 dark:border-blue-800 dark:bg-blue-950">
              <p className="text-xs text-blue-900 dark:text-blue-100">
                Help improve SANE? Let us use this email to make AI decisions better.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    if (pendingEmailId) captureSnapshot.mutate({ emailId: pendingEmailId });
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
      )}
    </div>
  );
}
