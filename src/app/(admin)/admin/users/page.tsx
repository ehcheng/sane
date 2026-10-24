"use client";

import { useState, Fragment } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { countSchoolDays } from "@/lib/school-year";
import { INACTIVITY_THRESHOLD_DAYS, DEACTIVATION_WINDOW_DAYS } from "@/lib/constants";

function ResetPasswordDialog({ userId, userName, open, onOpenChange }: { userId: string; userName: string | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const resetPassword = trpc.admin.resetUserPassword.useMutation({
    onSuccess: () => {
      toast({ title: `Password reset for ${userName ?? "user"}` });
      onOpenChange(false);
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err) =>
      toast({
        title: "Failed to reset password",
        description: err.message,
        variant: "destructive",
      }),
  });

  const passwordTooShort = newPassword.length > 0 && newPassword.length < 12;
  const passwordsMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit =
    newPassword.length >= 12 &&
    confirmPassword.length > 0 &&
    newPassword === confirmPassword &&
    !resetPassword.isPending;

  return (
    <AlertDialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setNewPassword(""); setConfirmPassword(""); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset password for {userName ?? "user"}</AlertDialogTitle>
          <AlertDialogDescription>
            Set a new password for this user. They will need to use it on next login.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor={`reset-pw-${userId}`}>New Password</Label>
            <Input
              id={`reset-pw-${userId}`}
              type="password"
              placeholder="At least 12 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={12}
            />
            {passwordTooShort && (
              <p className="text-sm text-destructive">
                Password must be at least 12 characters
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`reset-pw-confirm-${userId}`}>Confirm Password</Label>
            <Input
              id={`reset-pw-confirm-${userId}`}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {passwordsMismatch && (
              <p className="text-sm text-destructive">Passwords do not match</p>
            )}
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            disabled={!canSubmit}
            onClick={() => resetPassword.mutate({ userId, newPassword })}
          >
            {resetPassword.isPending ? "Resetting..." : "Reset Password"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ChangeEmailDialog({ userId, userName, currentEmail, pendingEmail, open, onOpenChange }: { userId: string; userName: string | null; currentEmail: string; pendingEmail: string | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [newEmail, setNewEmail] = useState("");
  const utils = trpc.useUtils();

  const changeEmail = trpc.admin.changeUserEmail.useMutation({
    onSuccess: () => {
      toast({ title: `Verification email sent for ${userName ?? "user"}` });
      utils.admin.users.invalidate();
      onOpenChange(false);
      setNewEmail("");
    },
    onError: (err) =>
      toast({
        title: "Failed to change email",
        description: err.message,
        variant: "destructive",
      }),
  });

  const canSubmit = newEmail.length > 0 && newEmail.includes("@") && !changeEmail.isPending;

  return (
    <AlertDialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setNewEmail(""); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Change email for {userName ?? "user"}</AlertDialogTitle>
          <AlertDialogDescription>
            Current email: {currentEmail}
            {pendingEmail && (
              <span className="block text-amber-600 dark:text-amber-400">
                Pending change: {pendingEmail}
              </span>
            )}
            <span className="block mt-1">
              A verification email will be sent to the new address. The email will only change once the user clicks the verification link.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor={`change-email-${userId}`}>New Email</Label>
            <Input
              id={`change-email-${userId}`}
              type="email"
              placeholder="new@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            disabled={!canSubmit}
            onClick={() => changeEmail.mutate({ userId, newEmail })}
          >
            {changeEmail.isPending ? "Sending..." : "Send Verification"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteUserDialog({ userId, userName, userEmail, open, onOpenChange }: { userId: string; userName: string | null; userEmail: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const utils = trpc.useUtils();

  const deleteUser = trpc.admin.deleteUser.useMutation({
    onSuccess: () => {
      toast({ title: `Deleted user ${userName ?? userEmail}` });
      utils.admin.users.invalidate();
      onOpenChange(false);
    },
    onError: (err) =>
      toast({
        title: "Failed to delete user",
        description: err.message,
        variant: "destructive",
      }),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete User</AlertDialogTitle>
          <AlertDialogDescription>
            Permanently delete <strong>{userName ?? "this user"}</strong> ({userEmail})? All their data will be permanently removed. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={deleteUser.isPending}
            onClick={() => deleteUser.mutate({ userId })}
          >
            {deleteUser.isPending ? "Deleting..." : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ClearAndBackfillDialog({ userId, userName, userEmail, open, onOpenChange }: { userId: string; userName: string | null; userEmail: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const utils = trpc.useUtils();

  const clearAndBackfill = trpc.admin.clearAndBackfill.useMutation({
    onSuccess: () => {
      toast({ title: `Cleared data and started backfill for ${userName ?? userEmail}` });
      utils.admin.users.invalidate();
      onOpenChange(false);
    },
    onError: (err) =>
      toast({
        title: "Failed to clear and backfill",
        description: err.message,
        variant: "destructive",
      }),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear Data & Backfill</AlertDialogTitle>
          <AlertDialogDescription>
            This will delete all processed emails, extracted events, and stats for <strong>{userName ?? "this user"}</strong> ({userEmail}), then start a fresh backfill from Gmail. The user&apos;s account, family, and settings are not affected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={clearAndBackfill.isPending}
            onClick={() => clearAndBackfill.mutate({ userId })}
          >
            {clearAndBackfill.isPending ? "Processing..." : "Clear & Backfill"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Stat helper for the detail panel
// ---------------------------------------------------------------------------

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-semibold", warn && "text-red-600 dark:text-red-400")}>
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Household annotation (shared between desktop table and mobile cards)
// ---------------------------------------------------------------------------

function HouseholdAnnotation({ user }: { user: { householdRole: string | null; householdPrimaryName: string | null; householdMemberNames: string[] | null } }) {
  if (user.householdRole === "member" && user.householdPrimaryName) {
    return <span className="text-xs text-blue-600 dark:text-blue-400">Household member of {user.householdPrimaryName}</span>;
  }
  if (user.householdRole === "primary" && user.householdMemberNames && user.householdMemberNames.length > 0) {
    const totalMembers = user.householdMemberNames.length + 1;
    return <span className="text-xs text-blue-600 dark:text-blue-400">Household manager ({totalMembers} members)</span>;
  }
  return null;
}

function UserLifecycleIndicator({ user }: {
  user: {
    accountStatus: string;
    lastActiveAt: Date | null;
    inactivityNotifiedAt: Date | null;
    lifecycleEmailsSent: number;
    deactivatedAt: Date | null;
    lastProcessedEmailAt: Date | null;
    lastCalendarAccessAt: Date | null;
    createdAt: Date;
  };
}) {
  let dotColor: string;
  let textClass: string;
  let label: string;
  let sublabel: string | null = null;

  if (user.accountStatus === "DEACTIVATED") {
    dotColor = "bg-red-500";
    textClass = "text-red-600 dark:text-red-400";
    label = `Deactivated ${user.deactivatedAt ? new Date(user.deactivatedAt).toLocaleDateString() : ""}`;
  } else if (user.accountStatus === "WARNING") {
    const daysRemaining = user.inactivityNotifiedAt
      ? Math.max(0, DEACTIVATION_WINDOW_DAYS - Math.floor((Date.now() - new Date(user.inactivityNotifiedAt).getTime()) / 86400000))
      : null;
    dotColor = "bg-amber-500";
    textClass = "text-amber-600 dark:text-amber-400";
    const emailStage = user.lifecycleEmailsSent;
    const emailLabel = emailStage > 0 ? `, email ${Math.min(emailStage, 3)}/3 sent` : "";
    label = `Warning${daysRemaining !== null ? ` (${daysRemaining}d until deactivation${emailLabel})` : ""}`;
  } else {
    // Active signals: web login, ICS feed, or email delivery.
    // Sync alone is automatic and does not count.
    const activityDates = [
      user.lastActiveAt,
      user.lastCalendarAccessAt,
      user.lastProcessedEmailAt,
    ].filter((d): d is Date => d !== null);

    if (activityDates.length === 0) {
      dotColor = "bg-red-500";
      textClass = "text-red-600 dark:text-red-400";
      const schoolDays = countSchoolDays(new Date(user.createdAt), new Date());
      label = "No activity";
      sublabel = `${schoolDays}/${INACTIVITY_THRESHOLD_DAYS} school days toward warning`;
    } else {
      const mostRecent = new Date(Math.max(...activityDates.map((d) => new Date(d).getTime())));
      const daysAgo = Math.floor((Date.now() - mostRecent.getTime()) / 86400000);
      const stale = daysAgo >= 30;
      dotColor = stale ? "bg-amber-500" : "bg-green-500";
      textClass = stale ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground";
      label = `Active ${mostRecent.toLocaleDateString()} (${daysAgo}d ago)`;
      if (stale) {
        const schoolDays = countSchoolDays(mostRecent, new Date());
        sublabel = `${schoolDays}/${INACTIVITY_THRESHOLD_DAYS} school days toward warning`;
      }
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 text-xs">
        <span className={cn("inline-block w-1.5 h-1.5 rounded-full shrink-0", dotColor)} />
        <span className={textClass}>{label}</span>
      </div>
      {sublabel && (
        <div className="text-[10px] text-muted-foreground ml-3">
          {sublabel}
        </div>
      )}
    </div>
  );
}

function ActivityStats({ user }: {
  user: {
    lastActiveAt: Date | null;
    lastProcessedEmailAt: Date | null;
    lastCalendarAccessAt: Date | null;
  };
}) {
  const fmt = (d: Date | null) => d ? new Date(d).toLocaleDateString() : "\u2014";
  return (
    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
      <span title="Last website activity">Web: {fmt(user.lastActiveAt)}</span>
      <span title="Last email processed">Email: {fmt(user.lastProcessedEmailAt)}</span>
      <span title="Last ICS calendar feed access">ICS: {fmt(user.lastCalendarAccessAt)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lazy-loaded user detail panel (fetched on expand)
// ---------------------------------------------------------------------------

function UserDetailPanel({ userId }: { userId: string }) {
  const detail = trpc.admin.userDetail.useQuery({ userId });

  if (detail.isLoading) {
    return (
      <div className="px-4 py-3 text-sm text-muted-foreground animate-pulse">
        Loading user details...
      </div>
    );
  }

  if (detail.error) {
    return (
      <div className="px-4 py-3 text-sm text-red-600">
        Failed to load: {detail.error.message}
      </div>
    );
  }

  const d = detail.data!;

  return (
    <div className="px-4 py-3 space-y-3 text-xs">
      {/* Household info banner */}
      {d.isHouseholdStats && d.householdPrimaryName && (
        <div className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded px-2.5 py-1.5">
          Stats are household-level, shared with {d.householdPrimaryName}. This member&apos;s Gmail feeds into the shared data pool.
        </div>
      )}
      {d.householdMemberNames && d.householdMemberNames.length > 0 && (
        <div className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded px-2.5 py-1.5">
          Household owner. Stats include data from: {d.householdMemberNames.join(", ")}.
        </div>
      )}
      {/* Settings row */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Settings</div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={d.settings.individualForwardingEnabled ? "default" : "secondary"} className="text-[10px]">
            Forwarding {d.settings.individualForwardingEnabled ? "ON" : "OFF"}
          </Badge>
          <Badge variant={d.settings.dailyBriefEnabled ? "default" : "secondary"} className="text-[10px]">
            Daily Brief {d.settings.dailyBriefEnabled ? "ON" : "OFF"}
          </Badge>
          <Badge variant={d.settings.weeklyBriefEnabled ? "default" : "secondary"} className="text-[10px]">
            Weekly Brief {d.settings.weeklyBriefEnabled ? "ON" : "OFF"}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            Scope: {d.settings.briefScope}
          </Badge>
          {d.settings.brutalMode && (
            <Badge variant="destructive" className="text-[10px]">Brutal</Badge>
          )}
          <Badge variant="outline" className="text-[10px]">
            TZ: {d.settings.timezone}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {d.settings.emailAccountType}
          </Badge>
        </div>
      </div>

      {/* Clustered stat groups */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Forwarding */}
        <div className="rounded-md border p-2.5 space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Forwarding (All Time)</div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Forwarded" value={d.emails.forwarded} />
            <Stat label="Delivered" value={d.emails.delivered} />
            <Stat label="Bounced" value={d.emails.bounced} warn={d.emails.bounced > 0} />
          </div>
        </div>

        {/* Activity (recent) */}
        <div className="rounded-md border p-2.5 space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Activity</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Proc (24h)" value={d.emails.processedLast24h} />
            <Stat label="Fwd (24h)" value={d.emails.forwardedLast24h} />
            <Stat label="Proc (7d)" value={d.emails.processedLast7d} />
            <Stat label="Fwd (7d)" value={d.emails.forwardedLast7d} />
          </div>
        </div>

        {/* Content */}
        <div className="rounded-md border p-2.5 space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Content (All Time)</div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Events" value={d.eventsTotal} />
            <Stat label="Feedback" value={d.feedbackCount} />
          </div>
        </div>
      </div>

      {/* Brief delivery: two side-by-side cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-md border p-2.5 space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Daily Briefs (30d)</div>
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Sent" value={d.briefs.daily.sent} />
            <Stat label="Delivered" value={d.briefs.daily.delivered} />
            <Stat label="Failed" value={d.briefs.daily.failed} warn={d.briefs.daily.failed > 0} />
            <Stat label="Pending" value={d.briefs.daily.pending} warn={d.briefs.daily.pending > 0} />
          </div>
        </div>
        <div className="rounded-md border p-2.5 space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Weekly Briefs (10w)</div>
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Sent" value={d.briefs.weekly.sent} />
            <Stat label="Delivered" value={d.briefs.weekly.delivered} />
            <Stat label="Failed" value={d.briefs.weekly.failed} warn={d.briefs.weekly.failed > 0} />
            <Stat label="Pending" value={d.briefs.weekly.pending} warn={d.briefs.weekly.pending > 0} />
          </div>
        </div>
      </div>

      {/* Connection detail (only if noteworthy) */}
      {d.connection && !d.connection.hasSyncCursor && (
        <div className="text-xs text-amber-600 dark:text-amber-400">
          No sync cursor set (first poll will seed it)
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// User actions dropdown menu
// ---------------------------------------------------------------------------

function UserActionsMenu({ user }: { user: { id: string; name: string | null; email: string; pendingEmail: string | null; accountStatus: string; emailConnection?: { status: string } | null } }) {
  const [activeDialog, setActiveDialog] = useState<"email" | "password" | "delete" | "reprocess" | null>(null);
  const utils = trpc.useUtils();

  const backfill = trpc.admin.adminBackfill.useMutation({
    onSuccess: (data) => {
      toast({
        title: data.alreadyRunning ? "Backfill already running" : "Backfill queued",
        description: data.alreadyRunning
          ? `A backfill is already in progress for ${user.name ?? "this user"}.`
          : `Backfill started for ${user.name ?? "this user"}.`,
      });
      utils.admin.users.invalidate();
    },
    onError: (err) => {
      toast({ title: "Failed to start backfill", description: err.message, variant: "destructive" });
    },
  });

  const cancelBackfill = trpc.admin.adminCancelBackfill.useMutation({
    onSuccess: () => {
      toast({
        title: "Backfill cancellation requested",
        description: `Backfill for ${user.name ?? "this user"} will stop after the current batch.`,
      });
    },
    onError: (err) => {
      toast({ title: "Failed to cancel backfill", description: err.message, variant: "destructive" });
    },
  });

  const forceBrief = trpc.admin.adminForceBrief.useMutation({
    onSuccess: (_, vars) => {
      toast({
        title: `${vars.briefType === "daily" ? "Daily" : "Weekly"} brief queued`,
        description: `A ${vars.briefType} brief will be sent to ${user.name ?? "this user"} shortly.`,
      });
    },
    onError: (err) => {
      toast({ title: "Failed to queue brief", description: err.message, variant: "destructive" });
    },
  });

  const simulateReauth = trpc.admin.adminSimulateReauth.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Re-auth backfill queued",
        description: `Backfill with ${data.gapDays}-day gap queued for ${user.name ?? "user"}. Catch-up brief will follow.`,
      });
      utils.admin.users.invalidate();
    },
    onError: (err) => {
      toast({ title: "Failed to simulate reauth", description: err.message, variant: "destructive" });
    },
  });

  const adminReactivate = trpc.admin.adminReactivateUser.useMutation({
    onSuccess: () => {
      toast({ title: `Reactivated ${user.name ?? "user"}` });
      utils.admin.users.invalidate();
    },
    onError: (err) => toast({ title: "Failed to reactivate", description: err.message, variant: "destructive" }),
  });

  const adminDeactivate = trpc.admin.adminDeactivateUser.useMutation({
    onSuccess: () => {
      toast({ title: `Deactivated ${user.name ?? "user"}` });
      utils.admin.users.invalidate();
    },
    onError: (err) => toast({ title: "Failed to deactivate", description: err.message, variant: "destructive" }),
  });

  const hasConnection = !!user.emailConnection;
  const isActive = user.emailConnection?.status === "ACTIVE";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
              <path d="M8 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM8 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM9.5 12.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0Z" />
            </svg>
            <span className="sr-only">Actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setActiveDialog("email")}>
            Change Email
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setActiveDialog("password")}>
            Reset Password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={forceBrief.isPending}
            onSelect={() => forceBrief.mutate({ userId: user.id, briefType: "daily" })}
          >
            Force Daily Brief
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={forceBrief.isPending}
            onSelect={() => forceBrief.mutate({ userId: user.id, briefType: "weekly" })}
          >
            Force Weekly Brief
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={backfill.isPending}
            onSelect={() => backfill.mutate({ userId: user.id })}
          >
            Backfill
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setActiveDialog("reprocess")}
          >
            Clear & Backfill
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={cancelBackfill.isPending}
            onSelect={() => {
              if (window.confirm(`Cancel the active backfill for ${user.name ?? "this user"}? Emails already processed will be kept.`)) {
                cancelBackfill.mutate({ userId: user.id });
              }
            }}
          >
            Cancel Backfill
          </DropdownMenuItem>
          {hasConnection && isActive && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={simulateReauth.isPending}
                className="text-orange-700 focus:text-orange-700 dark:text-orange-400"
                onSelect={() => {
                  if (window.confirm(`Run a re-auth backfill for ${user.name ?? "this user"} with a 5-day gap? This backdates lastPolledAt and queues a backfill with catch-up brief. Connection stays active.`)) {
                    simulateReauth.mutate({ userId: user.id, gapDays: 5 });
                  }
                }}
              >
                Sim Reauth Backfill (5d gap)
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          {user.accountStatus === "DEACTIVATED" ? (
            <DropdownMenuItem
              disabled={adminReactivate.isPending}
              className="text-green-700 focus:text-green-700 dark:text-green-400"
              onSelect={() => {
                if (window.confirm(`Reactivate ${user.name ?? "this user"}? They will need to reconnect Gmail.`)) {
                  adminReactivate.mutate({ userId: user.id });
                }
              }}
            >
              Reactivate User
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={adminDeactivate.isPending}
              className="text-orange-700 focus:text-orange-700 dark:text-orange-400"
              onSelect={() => {
                if (window.confirm(`Deactivate ${user.name ?? "this user"}? Gmail will be disconnected and monitoring stopped.`)) {
                  adminDeactivate.mutate({ userId: user.id });
                }
              }}
            >
              Deactivate User
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setActiveDialog("delete")}
          >
            Delete User
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangeEmailDialog
        userId={user.id}
        userName={user.name}
        currentEmail={user.email}
        pendingEmail={user.pendingEmail}
        open={activeDialog === "email"}
        onOpenChange={(v) => { if (!v) setActiveDialog(null); }}
      />
      <ResetPasswordDialog
        userId={user.id}
        userName={user.name}
        open={activeDialog === "password"}
        onOpenChange={(v) => { if (!v) setActiveDialog(null); }}
      />
      <DeleteUserDialog
        userId={user.id}
        userName={user.name}
        userEmail={user.email}
        open={activeDialog === "delete"}
        onOpenChange={(v) => { if (!v) setActiveDialog(null); }}
      />
      <ClearAndBackfillDialog
        userId={user.id}
        userName={user.name}
        userEmail={user.email}
        open={activeDialog === "reprocess"}
        onOpenChange={(v) => { if (!v) setActiveDialog(null); }}
      />
    </>
  );
}

export default function AdminUsersPage() {
  const users = trpc.admin.users.useQuery();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const setUserMonitoring = trpc.admin.setUserMonitoring.useMutation({
    onSuccess: () => {
      utils.admin.users.invalidate();
    },
  });

  const setUserDebugTools = trpc.admin.setUserDebugTools.useMutation({
    onSuccess: () => {
      utils.admin.users.invalidate();
    },
  });

  const filteredUsers = users.data?.filter((user) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      user.name?.toLowerCase().includes(q) ||
      user.email.toLowerCase().includes(q) ||
      user.emailConnection?.emailAddress?.toLowerCase().includes(q) ||
      user.householdPrimaryName?.toLowerCase().includes(q) ||
      user.householdMemberNames?.some((n) => n.toLowerCase().includes(q))
    );
  });

  const toggleExpand = (userId: string) => {
    setExpandedUserId((prev) => (prev === userId ? null : userId));
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">User Management</h1>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <CardTitle className="shrink-0">All Users</CardTitle>
            {users.data && users.data.length > 0 && (
              <>
                <Input
                  placeholder="Search by name or email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="sm:max-w-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5 text-xs"
                  onClick={() => {
                    const text = users.data!
                      .map((u) => u.name ? `${u.name} <${u.email}>` : u.email)
                      .join(", ");
                    navigator.clipboard.writeText(text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy All"}
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {users.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : users.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          ) : filteredUsers?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users match &ldquo;{search}&rdquo;</p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-6"></TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Gmail</TableHead>
                      <TableHead className="text-right">Children</TableHead>
                      <TableHead className="text-right">Proc</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Fwd/Dlvd</TableHead>
                      <TableHead className="w-12 text-center">Mon</TableHead>
                      <TableHead className="w-12 text-center">Dbg</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers?.map((user, i) => {
                      const isExpanded = expandedUserId === user.id;
                      return (
                        <Fragment key={user.id}>
                          <TableRow
                            className={cn(
                              "cursor-pointer",
                              user.emailConnection?.status === "NEEDS_REAUTH" ? "bg-amber-50 dark:bg-amber-950/20" : i % 2 === 1 ? "bg-muted/30" : "",
                              isExpanded && "border-b-0"
                            )}
                            onClick={() => toggleExpand(user.id)}
                          >
                            <TableCell className="w-6 px-2">
                              <ChevronDown className={cn(
                                "h-4 w-4 text-muted-foreground transition-transform duration-200",
                                !isExpanded && "-rotate-90"
                              )} />
                            </TableCell>
                            <TableCell>
                              <div>
                                <div className="font-medium">{user.name}</div>
                                <div className="text-sm text-muted-foreground">
                                  {user.email}
                                </div>
                                {user.pendingEmail && (
                                  <div className="text-xs text-amber-600 dark:text-amber-400">
                                    Pending: {user.pendingEmail}
                                  </div>
                                )}
                                <UserLifecycleIndicator user={user} />
                                <ActivityStats user={user} />
                                <HouseholdAnnotation user={user} />
                                {user.emailConnection?.status === "NEEDS_REAUTH" && (
                                  <div className="flex items-center gap-1 mt-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
                                      <path fillRule="evenodd" d="M6.701 2.25c.577-1 2.02-1 2.598 0l5.196 9a1.5 1.5 0 0 1-1.299 2.25H2.804a1.5 1.5 0 0 1-1.3-2.25l5.197-9ZM8 5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 5Zm0 6.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" />
                                    </svg>
                                    Gmail needs reconnection
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {user.emailConnection ? (
                                <div className="space-y-1">
                                  <Badge
                                    variant={
                                      user.emailConnection.status === "ACTIVE"
                                        ? "default"
                                        : "destructive"
                                    }
                                  >
                                    {user.emailConnection.status}
                                  </Badge>
                                  <div className="text-xs text-muted-foreground">
                                    {user.emailConnection.emailAddress}
                                  </div>
                                  {user.emailConnection.lastPolledAt && (
                                    <div className="text-xs text-muted-foreground">
                                      Polled:{" "}
                                      {new Date(
                                        user.emailConnection.lastPolledAt
                                      ).toLocaleString()}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <Badge variant="secondary">Not connected</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {user._count.children}
                            </TableCell>
                            <TableCell className="text-right">
                              {user._count.processedEmails}
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              <span>{user.forwardedCount}</span>
                              <span className="text-muted-foreground">/</span>
                              <span className={cn(user.deliveredCount < user.forwardedCount && user.forwardedCount > 0 ? "text-amber-600 dark:text-amber-400" : "")}>
                                {user.deliveredCount}
                              </span>
                              {user.bouncedCount > 0 && (
                                <span className="text-red-600 dark:text-red-400 text-xs ml-1">
                                  ({user.bouncedCount})
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                              <Switch
                                checked={user.isMonitoringEnabled}
                                onCheckedChange={(checked) =>
                                  setUserMonitoring.mutate({
                                    userId: user.id,
                                    enabled: checked,
                                  })
                                }
                                disabled={setUserMonitoring.isPending}
                              />
                            </TableCell>
                            <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                              <Switch
                                checked={user.debugToolsEnabled}
                                onCheckedChange={(checked) =>
                                  setUserDebugTools.mutate({
                                    userId: user.id,
                                    enabled: checked,
                                  })
                                }
                                disabled={setUserDebugTools.isPending}
                              />
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <UserActionsMenu user={user} />
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow className={cn(
                              "hover:bg-transparent",
                              user.emailConnection?.status === "NEEDS_REAUTH" ? "bg-amber-50/50 dark:bg-amber-950/10" : "bg-muted/20"
                            )}>
                              <TableCell colSpan={9} className="p-0">
                                <UserDetailPanel userId={user.id} />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {filteredUsers?.map((user) => {
                  const isExpanded = expandedUserId === user.id;
                  return (
                    <div
                      key={user.id}
                      className={cn(
                        "rounded-lg border p-4 space-y-3",
                        user.emailConnection?.status === "NEEDS_REAUTH" && "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{user.name}</p>
                          <p className="text-sm text-muted-foreground truncate">
                            {user.email}
                          </p>
                          {user.pendingEmail && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 truncate">
                              Pending: {user.pendingEmail}
                            </p>
                          )}
                          <UserLifecycleIndicator user={user} />
                          <ActivityStats user={user} />
                          <HouseholdAnnotation user={user} />
                          {user.emailConnection?.status === "NEEDS_REAUTH" && (
                            <p className="flex items-center gap-1 mt-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
                                <path fillRule="evenodd" d="M6.701 2.25c.577-1 2.02-1 2.598 0l5.196 9a1.5 1.5 0 0 1-1.299 2.25H2.804a1.5 1.5 0 0 1-1.3-2.25l5.197-9ZM8 5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 5Zm0 6.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" />
                              </svg>
                              Gmail needs reconnection
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex flex-col items-center gap-0.5">
                            <Switch
                              checked={user.isMonitoringEnabled}
                              onCheckedChange={(checked) =>
                                setUserMonitoring.mutate({
                                  userId: user.id,
                                  enabled: checked,
                                })
                              }
                              disabled={setUserMonitoring.isPending}
                              aria-label={`Toggle monitoring for ${user.name}`}
                            />
                            <span className="text-[10px] text-muted-foreground">Monitor</span>
                          </div>
                          <div className="flex flex-col items-center gap-0.5">
                            <Switch
                              checked={user.debugToolsEnabled}
                              onCheckedChange={(checked) =>
                                setUserDebugTools.mutate({
                                  userId: user.id,
                                  enabled: checked,
                                })
                              }
                              disabled={setUserDebugTools.isPending}
                              aria-label={`Toggle debug tools for ${user.name}`}
                            />
                            <span className="text-[10px] text-muted-foreground">Debug</span>
                          </div>
                          <UserActionsMenu user={user} />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {user.emailConnection ? (
                          <>
                            <Badge
                              variant={
                                user.emailConnection.status === "ACTIVE"
                                  ? "default"
                                  : "destructive"
                              }
                            >
                              {user.emailConnection.status}
                            </Badge>
                            <span className="text-xs text-muted-foreground truncate">
                              {user.emailConnection.emailAddress}
                            </span>
                          </>
                        ) : (
                          <Badge variant="secondary">Gmail not connected</Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-center text-xs">
                        <div>
                          <div className="font-medium text-muted-foreground">Children</div>
                          <div className="text-sm font-semibold">{user._count.children}</div>
                        </div>
                        <div>
                          <div className="font-medium text-muted-foreground">Processed</div>
                          <div className="text-sm font-semibold">{user._count.processedEmails}</div>
                        </div>
                        <div>
                          <div className="font-medium text-muted-foreground">Forwarded</div>
                          <div className="text-sm font-semibold">{user.forwardedCount}</div>
                        </div>
                        <div>
                          <div className="font-medium text-muted-foreground">Delivered</div>
                          <div className="text-sm font-semibold">{user.deliveredCount}</div>
                        </div>
                      </div>
                      {/* Expand/collapse for mobile */}
                      <button
                        type="button"
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full justify-center pt-1"
                        onClick={() => toggleExpand(user.id)}
                      >
                        <ChevronDown className={cn(
                          "h-3.5 w-3.5 transition-transform duration-200",
                          !isExpanded && "-rotate-90"
                        )} />
                        {isExpanded ? "Less" : "More details"}
                      </button>
                      {isExpanded && <UserDetailPanel userId={user.id} />}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

