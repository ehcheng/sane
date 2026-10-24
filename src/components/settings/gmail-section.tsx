"use client";

import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/use-toast";

// Debug UI flag is DB-driven via user.globalMonitoringStatus
function useShowDebugUI(): boolean {
  const { data } = trpc.user.globalMonitoringStatus.useQuery();
  return data?.showDebugUI ?? false;
}

export function GmailAccountTypeSection() {
  const { data: user } = trpc.user.me.useQuery();
  const utils = trpc.useUtils();
  const [showSharedConfirm, setShowSharedConfirm] = useState(false);

  const updateType = trpc.user.updateEmailAccountType.useMutation({
    onSuccess: () => {
      utils.user.me.invalidate();
      utils.user.getForwardingSettings.invalidate();
      toast({ title: "Gmail account type updated" });
    },
    onError: (err) =>
      toast({
        title: "Failed to update account type",
        description: err.message,
        variant: "destructive",
      }),
  });

  const current = user?.emailAccountType ?? "DEDICATED";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Gmail Account Type</CardTitle>
          <CardDescription>
            Which kind of Gmail account are your school emails in?
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <RadioGroup
            value={current}
            onValueChange={(value) => {
              if (value === "SHARED" && current !== "SHARED") {
                setShowSharedConfirm(true);
              } else {
                updateType.mutate({ emailAccountType: value as "DEDICATED" | "SHARED" });
              }
            }}
            className="space-y-3"
            disabled={updateType.isPending}
          >
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="DEDICATED" id="gmail-type-dedicated" className="mt-0.5" />
              <div>
                <Label htmlFor="gmail-type-dedicated" className="font-medium">
                  Dedicated school email
                </Label>
                <p className="text-xs text-muted-foreground">
                  A separate Gmail that only receives school emails — a .edu address, a school-provided account, or a Gmail set up just for school.{current === "DEDICATED" && " Every email in this inbox is monitored. You can get individual forwards plus daily/weekly digests."}
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="SHARED" id="gmail-type-shared" className="mt-0.5" />
              <div>
                <Label htmlFor="gmail-type-shared" className="font-medium">
                  Personal email (mixed inbox)
                </Label>
                <p className="text-xs text-muted-foreground">
                  School emails land in the same Gmail as personal messages — e.g., your regular @gmail.com.{current === "SHARED" && " We filter out personal messages and only process school-related emails. Sender filtering is enabled to help tell them apart."}
                </p>
              </div>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      <AlertDialog open={showSharedConfirm} onOpenChange={setShowSharedConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to shared inbox mode?</AlertDialogTitle>
            <AlertDialogDescription>
              This will turn off individual forwarding, enable daily briefs, and require sender
              filtering. You can change these settings individually afterward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                updateType.mutate({ emailAccountType: "SHARED" });
                setShowSharedConfirm(false);
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function GmailSection() {
  const { data: gmail, isLoading } = trpc.email.connectionStatus.useQuery();
  const { data: user } = trpc.user.me.useQuery();
  const utils = trpc.useUtils();
  const showDebugUI = useShowDebugUI();
  const forceCountRef = useRef<HTMLInputElement>(null);
  const disconnect = trpc.email.disconnect.useMutation({
    onSuccess: () => {
      utils.email.connectionStatus.invalidate();
      toast({ title: "Gmail disconnected" });
    },
    onError: (err) => toast({ title: "Failed to disconnect", description: err.message, variant: "destructive" }),
  });
  const simulateReauthBackfill = trpc.email.simulateReauthBackfill.useMutation({
    onSuccess: (data) => {
      utils.email.connectionStatus.invalidate();
      toast({ title: `Re-auth backfill queued (${data.gapDays}-day gap)` });
    },
    onError: (err) => toast({ title: "Simulate failed", description: err.message, variant: "destructive" }),
  });
  const pollNow = trpc.email.pollNow.useMutation({
    onSuccess: () => {
      utils.email.connectionStatus.invalidate();
      toast({ title: "Check queued" });
    },
    onError: (err) => toast({ title: "Check failed", description: err.message, variant: "destructive" }),
  });
  const backfill = trpc.email.backfill.useMutation({
    onSuccess: () => {
      toast({ title: "Backfill queued — seeding events from recent emails" });
    },
    onError: (err) => toast({ title: "Backfill failed", description: err.message, variant: "destructive" }),
  });
  const forceBrief = trpc.user.forceBrief.useMutation({
    onSuccess: (_data, variables) => {
      toast({ title: `${variables.briefType === "daily" ? "Daily" : "Weekly"} brief queued` });
    },
    onError: (err) => toast({ title: "Brief failed", description: err.message, variant: "destructive" }),
  });
  const { data: allowedSenders = [] } = trpc.allowedSenders.list.useQuery();
  const setMonitoring = trpc.user.setMonitoringEnabled.useMutation({
    onSuccess: (data) => {
      utils.user.me.invalidate();
      toast({ title: data.isMonitoringEnabled ? "Monitoring enabled" : "Monitoring paused" });
    },
    onError: (err) => toast({ title: "Failed to update monitoring", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gmail Connection</CardTitle>
        <CardDescription>
          The Gmail account we read to find your school emails
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-5 w-48 rounded bg-muted animate-pulse" />
            <div className="h-9 w-full rounded-md bg-muted/60 animate-pulse" />
          </div>
        ) : gmail ? (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Connected account
                </span>
                <span className="text-sm font-medium">
                  {gmail.emailAddress}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge
                  variant={
                    gmail.status === "ACTIVE"
                      ? "default"
                      : gmail.status === "NEEDS_REAUTH"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {gmail.status === "ACTIVE"
                    ? "Connected"
                    : gmail.status === "NEEDS_REAUTH"
                      ? "Needs Reconnection"
                      : "Disconnected"}
                </Badge>
              </div>
              {gmail.lastPolledAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Last polled
                  </span>
                  <span className="text-sm">
                    {new Date(gmail.lastPolledAt).toLocaleString()}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-muted-foreground">
                    Automatic monitoring
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {user?.isMonitoringEnabled
                      ? "Emails are checked on a schedule"
                      : "Scheduled checks are paused"}
                  </p>
                </div>
                <Switch
                  checked={user?.isMonitoringEnabled ?? true}
                  onCheckedChange={(checked) => {
                    if (
                      checked &&
                      user?.emailAccountType === "SHARED" &&
                      user?.emailFilterMode === "ALLOWED_ONLY" &&
                      allowedSenders.length === 0
                    ) {
                      toast({
                        title: "Add allowed senders first",
                        description:
                          "Your shared inbox needs at least one allowed sender domain before monitoring can be enabled. Go to Email Source Filter below to add one.",
                        variant: "destructive",
                      });
                      return;
                    }
                    setMonitoring.mutate({ enabled: checked });
                  }}
                  disabled={setMonitoring.isPending}
                  aria-label="Toggle automatic monitoring"
                />
              </div>
            </div>
            <Separator />
            <div className="flex gap-2">
              {gmail.status === "NEEDS_REAUTH" && (
                <>
                  <div className="w-full rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200 space-y-1.5">
                    <p>Google will ask for permission again. Make sure to check the <strong>&quot;View your email&quot;</strong> box.</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => { window.location.href = "/api/gmail/connect?returnTo=/settings"; }}
                  >
                    Reconnect
                  </Button>
                </>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={disconnect.isPending}
                  >
                    {disconnect.isPending ? "Disconnecting..." : "Disconnect"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect Gmail?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will stop monitoring {gmail.emailAddress} for school
                      emails. You can reconnect at any time.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => disconnect.mutate()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Disconnect
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              {showDebugUI && gmail.status === "ACTIVE" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-orange-100 hover:bg-orange-200 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:hover:bg-orange-900/50 dark:text-orange-300 dark:border-orange-700"
                  onClick={() => simulateReauthBackfill.mutate({ gapDays: 5 })}
                  disabled={simulateReauthBackfill.isPending}
                >
                  {simulateReauthBackfill.isPending ? "Queuing..." : "Sim Reauth Backfill (5d gap)"}
                </Button>
              )}
            </div>
            {showDebugUI && gmail.status === "ACTIVE" && (
              <>
                <Separator />
                <div className="rounded-md bg-orange-50 border border-orange-200 p-3 dark:bg-orange-900/20 dark:border-orange-800">
                  <p className="mb-2 text-xs font-medium text-orange-700 uppercase tracking-wide dark:text-orange-300">Debug Actions</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-orange-100 hover:bg-orange-200 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:hover:bg-orange-900/50 dark:text-orange-300 dark:border-orange-700"
                      onClick={() => pollNow.mutate({})}
                      disabled={pollNow.isPending}
                    >
                      {pollNow.isPending ? "Checking..." : "Check Now"}
                    </Button>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-orange-700 dark:text-orange-300">Force</span>
                      <Input
                        ref={forceCountRef}
                        type="number"
                        min={1}
                        max={10}
                        defaultValue={1}
                        className="h-8 w-14 text-center text-sm border-orange-300 dark:border-orange-700"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-orange-100 hover:bg-orange-200 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:hover:bg-orange-900/50 dark:text-orange-300 dark:border-orange-700"
                        onClick={() => {
                          const n = parseInt(forceCountRef.current?.value ?? "1", 10);
                          pollNow.mutate({ forceCount: Math.max(1, Math.min(10, n || 1)) });
                        }}
                        disabled={pollNow.isPending}
                      >
                        {pollNow.isPending ? "Forcing..." : "Go"}
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-orange-100 hover:bg-orange-200 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:hover:bg-orange-900/50 dark:text-orange-300 dark:border-orange-700"
                      onClick={() => forceBrief.mutate({ briefType: "daily" })}
                      disabled={forceBrief.isPending}
                    >
                      {forceBrief.isPending ? "Sending..." : "Daily Brief"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-orange-100 hover:bg-orange-200 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:hover:bg-orange-900/50 dark:text-orange-300 dark:border-orange-700"
                      onClick={() => forceBrief.mutate({ briefType: "weekly" })}
                      disabled={forceBrief.isPending}
                    >
                      {forceBrief.isPending ? "Sending..." : "Weekly Brief"}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-orange-100 hover:bg-orange-200 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:hover:bg-orange-900/50 dark:text-orange-300 dark:border-orange-700"
                          disabled={backfill.isPending}
                        >
                          {backfill.isPending ? "Seeding..." : "Seed Events"}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Seed Events?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will re-scan your recent emails and create new
                            events. Duplicate events will be skipped.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => backfill.mutate()}
                            className="bg-orange-600 hover:bg-orange-700"
                          >
                            Seed Events
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No Gmail account is connected. Connect your account to start
              monitoring school emails.
            </p>
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200 space-y-1.5">
              {user?.emailAccountType === "SHARED" ? (
                <p>Sign in with the personal Gmail where your school emails arrive alongside your other messages.</p>
              ) : (
                <p>Sign in with the Gmail that only gets school emails (e.g., a .edu or school-provided address).</p>
              )}
              <p>Google will ask to let this app <strong>view your email</strong> — you must check that box or we can&apos;t read your school emails.</p>
            </div>
            <Button
              size="sm"
              onClick={() => { window.location.href = "/api/gmail/connect?returnTo=/settings"; }}
            >
              Connect Gmail
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
