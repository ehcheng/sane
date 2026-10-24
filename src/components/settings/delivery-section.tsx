"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Calendar, Copy, Check, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  TIMEZONE_OPTIONS,
  WEEKLY_BRIEF_DAY_OPTIONS,
  BRIEF_HOUR_OPTIONS,
} from "@/lib/validators";
import { toast } from "@/components/ui/use-toast";

// ---------------------------------------------------------------------------
// Advanced Settings Toggle
// ---------------------------------------------------------------------------

export function AdvancedSettingsToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
    >
      {open ? (
        <ChevronDown className="h-4 w-4" />
      ) : (
        <ChevronRight className="h-4 w-4" />
      )}
      Advanced
    </button>
  );
}

// ---------------------------------------------------------------------------
// Feedback Training Consent Section
// ---------------------------------------------------------------------------

export function FeedbackTrainingSection() {
  const { data: user } = trpc.user.me.useQuery();
  const utils = trpc.useUtils();
  const setConsent = trpc.user.setFeedbackTrainingConsent.useMutation({
    onSuccess: () => {
      utils.user.me.invalidate();
      toast({ title: "AI improvement preference saved" });
    },
    onError: (err) => toast({ title: "Failed to update preference", description: err.message, variant: "destructive" }),
  });

  const isGranted = user?.feedbackTrainingConsent === "granted";

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Improvement</CardTitle>
        <CardDescription>
          When you give thumbs up/down feedback on an email or event, SANE can temporarily store that feedback to improve AI decisions
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <Label htmlFor="feedback-training-toggle" className="font-normal">
            Allow feedback data collection
          </Label>
          <Switch
            id="feedback-training-toggle"
            checked={isGranted}
            onCheckedChange={(checked) =>
              setConsent.mutate({ consent: checked ? "granted" : "denied" })
            }
            disabled={setConsent.isPending}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Support Data Consent Section
// ---------------------------------------------------------------------------

function formatTimeRemaining(expiresAt: Date): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

export function SupportDataConsentSection() {
  const { data: user } = trpc.user.me.useQuery();
  const utils = trpc.useUtils();
  const setConsent = trpc.user.setSupportDataConsent.useMutation({
    onSuccess: () => {
      utils.user.me.invalidate();
    },
    onError: (err) => toast({ title: "Failed to update preference", description: err.message, variant: "destructive" }),
  });

  const isActive = user?.supportDataConsent ?? false;
  const expiresAt = user?.supportDataConsentExpiresAt;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Support Data Access</CardTitle>
        <CardDescription>
          Grant temporary access so admins can view linked email metadata (subject, sender, AI summary, your feedback) alongside AI processing logs for debugging and support. Your email body content is never stored in the database.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isActive ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              <span className="font-medium text-green-700 dark:text-green-400">Active</span>
              {expiresAt && (
                <span className="text-muted-foreground">
                  ({formatTimeRemaining(expiresAt)})
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConsent.mutate({ consent: false })}
              disabled={setConsent.isPending}
            >
              Revoke Access
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" />
              <span className="text-muted-foreground">Not active</span>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={() => setConsent.mutate({ consent: true, hours: 48 })}
              disabled={setConsent.isPending}
            >
              Grant Access for 48 Hours
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Show Links in Summary Section
// ---------------------------------------------------------------------------

export function ShowLinksInSummarySection() {
  const { data: settings } = trpc.user.getForwardingSettings.useQuery();
  const utils = trpc.useUtils();
  const updateSettings = trpc.user.updateForwardingSettings.useMutation({
    onSuccess: () => {
      utils.user.getForwardingSettings.invalidate();
      toast({ title: "Link display preference saved" });
    },
    onError: (err) => toast({ title: "Failed to update preference", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Links from Emails</CardTitle>
        <CardDescription>
          Extract and display links from original emails (sign-up forms, payment portals,
          RSVPs, informational pages). Links are unverified — always check the domain
          before clicking.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <Label htmlFor="show-links-toggle" className="font-normal">
            Include links from original emails
          </Label>
          <Switch
            id="show-links-toggle"
            checked={settings?.showLinksInSummary ?? false}
            onCheckedChange={(checked) =>
              updateSettings.mutate({ showLinksInSummary: checked })
            }
            disabled={updateSettings.isPending}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Brutal Mode Section
// ---------------------------------------------------------------------------

export function BrutalModeSection() {
  const { data: settings } = trpc.user.getForwardingSettings.useQuery();
  const utils = trpc.useUtils();
  const updateSettings = trpc.user.updateForwardingSettings.useMutation({
    onSuccess: () => {
      utils.user.getForwardingSettings.invalidate();
      toast({ title: "Brutal mode preference saved" });
    },
    onError: (err) => toast({ title: "Failed to update preference", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Brutal Mode</CardTitle>
        <CardDescription>
          Only treat mandatory obligations as actionable — payments, required forms,
          schedule changes, safety alerts, and policy matters. Optional content
          (volunteer asks, spirit days, fundraisers, newsletters) is skipped entirely:
          not forwarded, not included in briefs, and not added to your calendar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <Label htmlFor="brutal-mode-toggle" className="font-normal">
            Strict mandatory-only filtering
          </Label>
          <Switch
            id="brutal-mode-toggle"
            checked={settings?.brutalMode ?? false}
            onCheckedChange={(checked) =>
              updateSettings.mutate({ brutalMode: checked })
            }
            disabled={updateSettings.isPending}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Actionable Events Only Section
// ---------------------------------------------------------------------------

export function ActionableEventsOnlySection() {
  const { data: user } = trpc.user.me.useQuery();
  const utils = trpc.useUtils();
  const updateSetting = trpc.user.updateActionableEventsOnly.useMutation({
    onSuccess: () => {
      utils.user.me.invalidate();
      toast({ title: "Calendar feed filter updated" });
    },
    onError: (err) => toast({ title: "Failed to update filter", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calendar Feed Filter</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <Label htmlFor="actionable-events-toggle" className="font-normal">
            Only show actionable events in the calendar feed
          </Label>
          <Switch
            id="actionable-events-toggle"
            checked={user?.actionableEventsOnly ?? false}
            onCheckedChange={(checked) =>
              updateSetting.mutate({ actionableEventsOnly: checked })
            }
            disabled={updateSetting.isPending}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Calendar Subscription Section
// ---------------------------------------------------------------------------

export function CalendarSubscriptionSection() {
  const { data: feedUrl, isLoading } = trpc.events.getCalendarFeedUrl.useQuery();
  const utils = trpc.useUtils();
  const [copied, setCopied] = useState(false);

  const generateToken = trpc.events.generateCalendarToken.useMutation({
    onSuccess: () => {
      utils.events.getCalendarFeedUrl.invalidate();
      toast({ title: "Calendar feed URL generated" });
    },
    onError: (err) => toast({ title: "Failed to generate URL", description: err.message, variant: "destructive" }),
  });

  const revokeToken = trpc.events.revokeCalendarToken.useMutation({
    onSuccess: () => {
      utils.events.getCalendarFeedUrl.invalidate();
      toast({ title: "Calendar feed URL revoked" });
    },
    onError: (err) => toast({ title: "Failed to revoke URL", description: err.message, variant: "destructive" }),
  });

  async function handleCopy() {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Calendar Subscription
        </CardTitle>
        <CardDescription>
          Subscribe to school events in your calendar app (Apple Calendar, Google Calendar, Outlook)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="h-9 w-full rounded-md bg-muted animate-pulse" />
        ) : feedUrl ? (
          <>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={feedUrl}
                className="font-mono text-xs"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={handleCopy}
                title="Copy URL"
              >
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste this URL into your calendar app&apos;s &ldquo;Subscribe to calendar&rdquo; option.
              Events from the past 30 days and next 90 days are included.
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => generateToken.mutate()}
                disabled={generateToken.isPending}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Regenerate URL
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => revokeToken.mutate()}
                disabled={revokeToken.isPending}
              >
                Revoke
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Generate a subscription URL to sync school events with your calendar app.
            </p>
            <Button
              size="sm"
              onClick={() => generateToken.mutate()}
              disabled={generateToken.isPending}
            >
              <Calendar className="mr-1.5 h-3.5 w-3.5" />
              Generate Calendar URL
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Default Events View Section
// ---------------------------------------------------------------------------

export function DefaultEventsViewSection() {
  const { data: user } = trpc.user.me.useQuery();
  const utils = trpc.useUtils();
  const updateView = trpc.user.updateDefaultEventsView.useMutation({
    onSuccess: () => {
      utils.user.me.invalidate();
      toast({ title: "Default events view updated" });
    },
    onError: (err) => toast({ title: "Failed to update view", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Default Events View</CardTitle>
        <CardDescription>
          Which view to show when you open the Events page
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RadioGroup
          value={user?.defaultEventsView ?? "agenda"}
          onValueChange={(value) =>
            updateView.mutate({ defaultEventsView: value as "agenda" | "month" })
          }
          className="flex gap-4"
          disabled={updateView.isPending}
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="agenda" id="view-agenda" />
            <Label htmlFor="view-agenda" className="font-normal">
              Agenda
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="month" id="view-month" />
            <Label htmlFor="view-month" className="font-normal">
              Month
            </Label>
          </div>
        </RadioGroup>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Forwarding Mode Section
// ---------------------------------------------------------------------------

export function ForwardingModeSection({ showAdvanced = false }: { showAdvanced?: boolean }) {
  const { data: settings } = trpc.user.getForwardingSettings.useQuery();
  const { data: user } = trpc.user.me.useQuery();
  const { data: gmail } = trpc.email.connectionStatus.useQuery();
  const { data: fwdAddresses = [] } = trpc.forwarding.list.useQuery();
  const utils = trpc.useUtils();
  const [showFwdConfirm, setShowFwdConfirm] = useState(false);

  const updateSettings = trpc.user.updateForwardingSettings.useMutation({
    onSuccess: () => {
      utils.user.getForwardingSettings.invalidate();
      utils.user.me.invalidate();
      toast({ title: "Forwarding settings updated" });
    },
    onError: (err) =>
      toast({
        title: "Failed to update forwarding settings",
        description: err.message,
        variant: "destructive",
      }),
  });

  const selectClass =
    "flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";

  const individualEnabled = settings?.individualForwardingEnabled ?? true;
  const dailyEnabled = settings?.dailyBriefEnabled ?? false;
  const weeklyEnabled = settings?.weeklyBriefEnabled ?? false;
  const anyBriefEnabled = dailyEnabled || weeklyEnabled;

  const isShared = user?.emailAccountType === "SHARED";
  const gmailAddr = gmail?.emailAddress?.toLowerCase();
  const hasDuplicateAddress = gmailAddr
    ? fwdAddresses.some((a) => a.email.toLowerCase() === gmailAddr)
    : false;
  return (
    <>
    {/* Warning for duplicate address (Gmail = forwarding target) */}
    {!isShared && hasDuplicateAddress && (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        Your connected Gmail address matches one of your forwarding addresses. Individual forwarding
        would send duplicates back to the same inbox.
      </div>
    )}

    {/* Individual Forwarding */}
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Individual Forwarding</CardTitle>
            <CardDescription>
              {isShared
                ? "Not available for shared inboxes — emails already arrive in your Gmail. Use briefs instead."
                : "Each actionable email is forwarded as it arrives"}
            </CardDescription>
          </div>
          <Switch
            checked={isShared ? false : individualEnabled}
            onCheckedChange={(checked) => {
              if (checked && hasDuplicateAddress) {
                setShowFwdConfirm(true);
              } else {
                updateSettings.mutate({ individualForwardingEnabled: checked });
              }
            }}
            disabled={isShared || updateSettings.isPending}
            aria-label="Toggle individual forwarding"
          />
        </div>
      </CardHeader>
    </Card>

    {/* Confirmation dialog for enabling forwarding when Gmail = forwarding target */}
    <AlertDialog open={showFwdConfirm} onOpenChange={setShowFwdConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Enable individual forwarding?</AlertDialogTitle>
          <AlertDialogDescription>
            Your connected Gmail address matches a forwarding address. This will send duplicate
            copies back to the same inbox. Are you sure?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              updateSettings.mutate({ individualForwardingEnabled: true });
              setShowFwdConfirm(false);
            }}
          >
            Enable Anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Briefs */}
    <Card>
      <CardHeader>
        <CardTitle>Briefs</CardTitle>
        <CardDescription>
          Receive a digest of processed emails on a schedule.
          {individualEnabled && " When combined with individual forwarding, briefs serve as a recap."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Daily Brief toggle */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="font-medium">Daily Brief</Label>
            <p className="text-xs text-muted-foreground">
              A summary sent once per day with upcoming events
            </p>
          </div>
          <Switch
            checked={dailyEnabled}
            onCheckedChange={(checked) =>
              updateSettings.mutate({ dailyBriefEnabled: checked })
            }
            disabled={updateSettings.isPending}
            aria-label="Toggle daily brief"
          />
        </div>

        {/* Weekly Brief toggle */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="font-medium">Weekly Brief</Label>
            <p className="text-xs text-muted-foreground">
              A weekly summary with the upcoming school week&apos;s events
            </p>
          </div>
          <Switch
            checked={weeklyEnabled}
            onCheckedChange={(checked) =>
              updateSettings.mutate({ weeklyBriefEnabled: checked })
            }
            disabled={updateSettings.isPending}
            aria-label="Toggle weekly brief"
          />
        </div>

        {anyBriefEnabled && showAdvanced && (
          <>
            <Separator />

            {/* Brief Scope */}
            <div className="space-y-2">
              <Label className="font-medium">Brief Content</Label>
              <RadioGroup
                value={settings?.briefScope ?? "ACTIONABLE"}
                onValueChange={(value) =>
                  updateSettings.mutate({ briefScope: value as "ACTIONABLE" | "ALL" })
                }
                className="space-y-2"
                disabled={updateSettings.isPending}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="ACTIONABLE" id="scope-actionable" />
                  <Label htmlFor="scope-actionable" className="text-sm font-normal">
                    Actionable emails only — things that need your attention or a response
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="ALL" id="scope-all" />
                  <Label htmlFor="scope-all" className="text-sm font-normal">
                    All processed emails — including FYI and informational messages
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Daily Brief schedule */}
            {dailyEnabled && (
              <>
                <Separator />
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-muted-foreground">Daily Brief Schedule</Label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="daily-time">Time</Label>
                      <select
                        id="daily-time"
                        value={settings?.dailyBriefHour ?? 6}
                        onChange={(e) =>
                          updateSettings.mutate({
                            dailyBriefHour: parseInt(e.target.value, 10),
                          })
                        }
                        disabled={updateSettings.isPending}
                        className={selectClass}
                      >
                        {BRIEF_HOUR_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="brief-tz">Timezone</Label>
                      <select
                        id="brief-tz"
                        value={settings?.timezone ?? "America/New_York"}
                        onChange={(e) =>
                          updateSettings.mutate({ timezone: e.target.value })
                        }
                        disabled={updateSettings.isPending}
                        className={selectClass}
                      >
                        {TIMEZONE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {settings?.lastDailyBriefSentAt
                      ? `Last sent: ${new Date(settings.lastDailyBriefSentAt).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                      : "No daily brief sent yet"}
                  </p>
                </div>
              </>
            )}

            {/* Weekly Brief schedule */}
            {weeklyEnabled && (
              <>
                <Separator />
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-muted-foreground">Weekly Brief Schedule</Label>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="weekly-day">Day</Label>
                      <select
                        id="weekly-day"
                        value={settings?.weeklyBriefDay ?? 0}
                        onChange={(e) =>
                          updateSettings.mutate({
                            weeklyBriefDay: parseInt(e.target.value, 10),
                          })
                        }
                        disabled={updateSettings.isPending}
                        className={selectClass}
                      >
                        {WEEKLY_BRIEF_DAY_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="weekly-time">Time</Label>
                      <select
                        id="weekly-time"
                        value={settings?.weeklyBriefHour ?? 9}
                        onChange={(e) =>
                          updateSettings.mutate({
                            weeklyBriefHour: parseInt(e.target.value, 10),
                          })
                        }
                        disabled={updateSettings.isPending}
                        className={selectClass}
                      >
                        {BRIEF_HOUR_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {!dailyEnabled && (
                      <div className="space-y-2">
                        <Label htmlFor="brief-tz-weekly">Timezone</Label>
                        <select
                          id="brief-tz-weekly"
                          value={settings?.timezone ?? "America/New_York"}
                          onChange={(e) =>
                            updateSettings.mutate({ timezone: e.target.value })
                          }
                          disabled={updateSettings.isPending}
                          className={selectClass}
                        >
                          {TIMEZONE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {settings?.lastWeeklyBriefSentAt
                      ? `Last sent: ${new Date(settings.lastWeeklyBriefSentAt).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                      : "No weekly brief sent yet"}
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
    </>
  );
}
