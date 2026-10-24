"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
import { FIELD_LIMITS } from "@/lib/validators";
import { toast } from "@/components/ui/use-toast";

// ---------------------------------------------------------------------------
// Email Source Filter Section
// ---------------------------------------------------------------------------

export function EmailSourceFilterSection() {
  const { data: user } = trpc.user.me.useQuery();
  const { data: senders } = trpc.allowedSenders.list.useQuery();
  const utils = trpc.useUtils();

  const updateMode = trpc.user.updateEmailFilterMode.useMutation({
    onSuccess: () => {
      utils.user.me.invalidate();
      toast({ title: "Email filter updated" });
    },
    onError: (err) => toast({ title: "Failed to update filter", description: err.message, variant: "destructive" }),
  });
  const createSender = trpc.allowedSenders.create.useMutation({
    onSuccess: () => {
      utils.allowedSenders.list.invalidate();
      setNewPattern("");
      toast({ title: "Allowed sender added" });
    },
    onError: (err) => toast({ title: "Failed to add sender", description: err.message, variant: "destructive" }),
  });
  const deleteSender = trpc.allowedSenders.delete.useMutation({
    onSuccess: () => {
      utils.allowedSenders.list.invalidate();
      toast({ title: "Allowed sender removed" });
    },
    onError: (err) => toast({ title: "Failed to remove sender", description: err.message, variant: "destructive" }),
  });

  const [newPattern, setNewPattern] = useState("");
  const mode = user?.emailFilterMode ?? "ALL";
  const isShared = user?.emailAccountType === "SHARED";

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newPattern.trim()) return;
    createSender.mutate({ pattern: newPattern.trim() });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Source Filter</CardTitle>
        <CardDescription>
          Choose whether every email is scanned, or only emails from senders you approve
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isShared && (
          <div className={`rounded-md border p-3 text-sm ${
            mode === "ALLOWED_ONLY" && senders?.length === 0
              ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
              : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          }`}>
            {mode === "ALLOWED_ONLY" && senders?.length === 0
              ? "Sender filtering is active but no senders are configured. No emails will be processed."
              : "Sender filtering is required for shared inboxes to separate school emails from personal email."}
          </div>
        )}

        <RadioGroup
          value={mode}
          onValueChange={(value) =>
            updateMode.mutate({ emailFilterMode: value as "ALL" | "ALLOWED_ONLY" })
          }
          className="space-y-3"
          disabled={updateMode.isPending}
        >
          <div className="flex items-start space-x-3">
            <RadioGroupItem value="ALL" id="filter-all" className="mt-0.5" disabled={isShared} />
            <div>
              <Label htmlFor="filter-all" className={`font-medium ${isShared ? "text-muted-foreground" : ""}`}>
                All emails
                {isShared && <span className="ml-2 text-xs font-normal">(not available for shared inboxes)</span>}
              </Label>
              <p className="text-xs text-muted-foreground">
                Every email in this inbox will be scanned for school-related content
              </p>
            </div>
          </div>
          <div className="flex items-start space-x-3">
            <RadioGroupItem value="ALLOWED_ONLY" id="filter-allowed" className="mt-0.5" />
            <div>
              <Label htmlFor="filter-allowed" className="font-medium">Only from allowed senders</Label>
              <p className="text-xs text-muted-foreground">
                Only scan emails from specific schools or teachers you add below
              </p>
            </div>
          </div>
        </RadioGroup>

        {mode === "ALLOWED_ONLY" && (
          <>
            <Separator />
            <div className="space-y-3">
              {senders?.length === 0 && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  No allowed senders. All emails will be ignored while this filter is active.
                </p>
              )}

              <div className="space-y-2">
                {senders?.map((sender) => (
                  <AlertDialog key={sender.id}>
                    <div className="flex items-center justify-between rounded-md border p-2">
                      <span className="truncate text-sm font-medium">{sender.pattern}</span>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-muted-foreground hover:text-destructive"
                          disabled={deleteSender.isPending}
                        >
                          &times;
                        </Button>
                      </AlertDialogTrigger>
                    </div>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove &ldquo;{sender.pattern}&rdquo;?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Emails from this sender/domain will no longer be processed.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteSender.mutate({ id: sender.id })}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ))}
              </div>

              <form onSubmit={handleAdd} className="flex gap-2">
                <Input
                  placeholder="e.g., @school.edu or teacher@gmail.com"
                  value={newPattern}
                  onChange={(e) => setNewPattern(e.target.value)}
                  className="max-w-sm"
                  maxLength={320}
                />
                <Button type="submit" size="sm" disabled={createSender.isPending}>
                  {createSender.isPending ? "Adding..." : "Add"}
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">
                Enter a domain (e.g., @school.edu) to allow all emails from that domain, or a specific email address.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Priority Activities Section
// ---------------------------------------------------------------------------

export function PriorityActivitiesSection() {
  const { data: activities } = trpc.priorityActivities.list.useQuery();
  const utils = trpc.useUtils();

  const createActivity = trpc.priorityActivities.create.useMutation({
    onSuccess: () => {
      utils.priorityActivities.list.invalidate();
      setNewActivity("");
      toast({ title: "Priority activity added" });
    },
    onError: (err) => toast({ title: "Failed to add activity", description: err.message, variant: "destructive" }),
  });
  const deleteActivity = trpc.priorityActivities.delete.useMutation({
    onSuccess: () => {
      utils.priorityActivities.list.invalidate();
      toast({ title: "Priority activity removed" });
    },
    onError: (err) => toast({ title: "Failed to remove activity", description: err.message, variant: "destructive" }),
  });

  const [newActivity, setNewActivity] = useState("");

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newActivity.trim()) return;
    createActivity.mutate({ name: newActivity.trim() });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Priority Activities</CardTitle>
        <CardDescription>
          Always forward emails about these activities, even if they&apos;d normally be filtered as optional
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {activities?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No priority activities set.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {activities?.map((activity) => (
            <AlertDialog key={activity.id}>
              <div className="flex items-center gap-1 rounded-full border px-3 py-1">
                <span className="text-sm">{activity.name}</span>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    className="ml-1 text-muted-foreground hover:text-destructive"
                    disabled={deleteActivity.isPending}
                    aria-label={`Remove ${activity.name}`}
                  >
                    &times;
                  </button>
                </AlertDialogTrigger>
              </div>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove &ldquo;{activity.name}&rdquo;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Emails about this activity will no longer be prioritized.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteActivity.mutate({ id: activity.id })}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ))}
        </div>

        <form onSubmit={handleAdd} className="flex gap-2">
          <Input
            placeholder="e.g. Basketball, Chess Club"
            value={newActivity}
            onChange={(e) => setNewActivity(e.target.value)}
            className="max-w-xs"
            maxLength={FIELD_LIMITS.priorityActivityName}
          />
          <Button type="submit" size="sm" disabled={createActivity.isPending}>
            {createActivity.isPending ? "Adding..." : "Add"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Ignored Activities Section
// ---------------------------------------------------------------------------

export function IgnoredActivitiesSection() {
  const { data: activities } = trpc.ignoredActivities.list.useQuery();
  const utils = trpc.useUtils();

  const createActivity = trpc.ignoredActivities.create.useMutation({
    onSuccess: () => {
      utils.ignoredActivities.list.invalidate();
      setNewActivity("");
      toast({ title: "Activity added to ignore list" });
    },
    onError: (err) => toast({ title: "Failed to add activity", description: err.message, variant: "destructive" }),
  });
  const deleteActivity = trpc.ignoredActivities.delete.useMutation({
    onSuccess: () => {
      utils.ignoredActivities.list.invalidate();
      toast({ title: "Activity removed from ignore list" });
    },
    onError: (err) => toast({ title: "Failed to remove activity", description: err.message, variant: "destructive" }),
  });

  const [newActivity, setNewActivity] = useState("");

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newActivity.trim()) return;
    createActivity.mutate({ name: newActivity.trim() });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ignored Activities</CardTitle>
        <CardDescription>
          Emails about these activities will be filtered out
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {activities?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No ignored activities. All school activity emails will be forwarded.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {activities?.map((activity) => (
            <AlertDialog key={activity.id}>
              <div className="flex items-center gap-1 rounded-full border px-3 py-1">
                <span className="text-sm">{activity.name}</span>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    className="ml-1 text-muted-foreground hover:text-destructive"
                    disabled={deleteActivity.isPending}
                    aria-label={`Remove ${activity.name}`}
                  >
                    &times;
                  </button>
                </AlertDialogTrigger>
              </div>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove &ldquo;{activity.name}&rdquo;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Emails about this activity will no longer be filtered out.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteActivity.mutate({ id: activity.id })}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ))}
        </div>

        <form onSubmit={handleAdd} className="flex gap-2">
          <Input
            placeholder="Activity name to ignore"
            value={newActivity}
            onChange={(e) => setNewActivity(e.target.value)}
            className="max-w-xs"
            maxLength={FIELD_LIMITS.ignoredActivityName}
          />
          <Button type="submit" size="sm" disabled={createActivity.isPending}>
            {createActivity.isPending ? "Adding..." : "Add"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sender Rules Section
// ---------------------------------------------------------------------------

export function SenderRulesSection() {
  const { data: rules } = trpc.senderRules.list.useQuery();
  const utils = trpc.useUtils();

  const createRule = trpc.senderRules.create.useMutation({
    onSuccess: () => {
      utils.senderRules.list.invalidate();
      setNewEmail("");
      toast({ title: "Sender rule created" });
    },
    onError: (err) => toast({ title: "Failed to create rule", description: err.message, variant: "destructive" }),
  });
  const deleteRule = trpc.senderRules.delete.useMutation({
    onSuccess: () => {
      utils.senderRules.list.invalidate();
      toast({ title: "Sender rule removed" });
    },
    onError: (err) => toast({ title: "Failed to remove rule", description: err.message, variant: "destructive" }),
  });

  const [newEmail, setNewEmail] = useState("");
  const [newAction, setNewAction] = useState<"ALWAYS_FORWARD" | "NEVER_FORWARD">("ALWAYS_FORWARD");

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    createRule.mutate({ senderEmail: newEmail.trim(), action: newAction });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sender Rules</CardTitle>
        <CardDescription>
          Always forward or always skip emails from specific senders, regardless of what the AI decides
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No sender rules configured. AI decides for all senders.
          </p>
        )}

        <div className="space-y-2">
          {rules?.map((rule) => (
            <AlertDialog key={rule.id}>
              <div className="flex items-center justify-between rounded-md border p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{rule.senderEmail}</p>
                  <p className="text-xs text-muted-foreground">
                    {rule.action === "ALWAYS_FORWARD" ? "Always forward" : "Never forward"}
                  </p>
                </div>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-muted-foreground hover:text-destructive"
                    disabled={deleteRule.isPending}
                  >
                    &times;
                  </Button>
                </AlertDialogTrigger>
              </div>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove sender rule?</AlertDialogTitle>
                  <AlertDialogDescription>
                    AI will decide for emails from {rule.senderEmail} again.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteRule.mutate({ id: rule.id })}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ))}
        </div>

        <form onSubmit={handleAdd} className="flex gap-2">
          <Input
            type="email"
            placeholder="sender@example.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="max-w-xs"
          />
          <select
            value={newAction}
            onChange={(e) => setNewAction(e.target.value as "ALWAYS_FORWARD" | "NEVER_FORWARD")}
            className="rounded-md border px-2 py-1 text-sm bg-background"
          >
            <option value="ALWAYS_FORWARD">Always forward</option>
            <option value="NEVER_FORWARD">Never forward</option>
          </select>
          <Button type="submit" size="sm" disabled={createRule.isPending}>
            {createRule.isPending ? "Adding..." : "Add"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
