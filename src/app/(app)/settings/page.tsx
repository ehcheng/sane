"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { User, Mail, Users, Inbox, ScrollText, CalendarDays, Shield, Download } from "lucide-react";
import { SettingsShell, type SettingsSection } from "@/components/settings/settings-shell";
import { trpc } from "@/lib/trpc";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { ProfileSection, PasswordSection } from "@/components/settings/profile-section";
import { FeedbackTrainingSection, SupportDataConsentSection, CalendarSubscriptionSection, ForwardingModeSection, DefaultEventsViewSection, ActionableEventsOnlySection, AdvancedSettingsToggle, ShowLinksInSummarySection, BrutalModeSection } from "@/components/settings/delivery-section";
import { ParentsSection, ChildrenSection } from "@/components/settings/family-section";
import { EmailSourceFilterSection, PriorityActivitiesSection, IgnoredActivitiesSection, SenderRulesSection } from "@/components/settings/filters-section";
import { ForwardingSection } from "@/components/settings/forwarding-section";
import { GmailSection, GmailAccountTypeSection } from "@/components/settings/gmail-section";
import { ActivityPage } from "@/components/activity/activity-page";
import { HouseholdOwnerProvider, OwnerOnlySection } from "@/components/settings/household-context";

// ---------------------------------------------------------------------------
// Settings Page
// ---------------------------------------------------------------------------

const USER_SECTIONS: SettingsSection[] = [
  { id: "family", label: "Family", icon: Users },
  { id: "delivery", label: "Delivery", icon: Mail },
  { id: "email-setup", label: "Email Setup", icon: Inbox },
  { id: "events-setup", label: "Events Setup", icon: CalendarDays },
  { id: "email-log", label: "Email Log", icon: ScrollText },
  { id: "privacy", label: "Privacy", icon: Shield },
  { id: "account", label: "Account", icon: User },
];

function SubSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm font-medium text-muted-foreground pt-2">
      {children}
    </p>
  );
}

function DeliverySection() {
  const hashIsFineTuning =
    typeof window !== "undefined" && window.location.hash === "#fine-tuning";
  const [showAdvanced, setShowAdvanced] = useState(hashIsFineTuning);
  const hasScrolled = useRef(false);

  // Callback ref: scrolls once sibling tRPC data has loaded and the
  // layout above this element has settled. We poll briefly because the
  // sections above fetch data asynchronously
  // and their rendered height changes as results arrive.
  const fineTuningRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !hashIsFineTuning || hasScrolled.current) return;
      hasScrolled.current = true;

      let lastTop = node.getBoundingClientRect().top;
      let stableFrames = 0;
      const REQUIRED_STABLE = 5; // ~80ms of stable position at 60fps

      function pollAndScroll() {
        const top = node!.getBoundingClientRect().top;
        if (Math.abs(top - lastTop) < 1) {
          stableFrames++;
        } else {
          stableFrames = 0;
          lastTop = top;
        }
        if (stableFrames >= REQUIRED_STABLE) {
          node!.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          requestAnimationFrame(pollAndScroll);
        }
      }
      requestAnimationFrame(pollAndScroll);
    },
    [hashIsFineTuning],
  );

  return (
    <div className="space-y-6">
      <ForwardingModeSection showAdvanced={showAdvanced} />
      <AdvancedSettingsToggle
        open={showAdvanced}
        onToggle={() => setShowAdvanced((prev) => !prev)}
      />
      {showAdvanced && (
        <>
          <OwnerOnlySection>
            <div id="fine-tuning" ref={fineTuningRef} className="scroll-mt-20">
              <SubSectionLabel>Fine-tuning</SubSectionLabel>
            </div>
            <PriorityActivitiesSection />
            <IgnoredActivitiesSection />
            <SenderRulesSection />
            <BrutalModeSection />
          </OwnerOnlySection>
          <SubSectionLabel>Extras</SubSectionLabel>
          <ShowLinksInSummarySection />
        </>
      )}
    </div>
  );
}

const DEBUG_BTN_CLASS =
  "text-xs bg-orange-100 hover:bg-orange-200 text-orange-800 dark:bg-orange-900/30 dark:hover:bg-orange-900/50 dark:text-orange-300";

function ResetTourButton() {
  const utils = trpc.useUtils();
  const resetTours = trpc.user.resetTours.useMutation({
    onSuccess: () => {
      utils.user.me.invalidate();
      toast({ title: "Tours reset. They\u2019ll show again on next page visit." });
    },
  });

  return (
    <Button
      variant="outline"
      size="sm"
      className={DEBUG_BTN_CLASS}
      onClick={() => resetTours.mutate()}
      disabled={resetTours.isPending}
    >
      Debug: Reset FTU Tour
    </Button>
  );
}

function RelaunchWizardButton() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const resetWizard = trpc.user.resetWizardWithCleanup.useMutation({
    onSuccess: () => {
      // Update the user cache immediately so the setup page doesn't see
      // the old wizardStep and trigger the normalization effect
      utils.user.me.setData(undefined, (old) =>
        old ? { ...old, wizardStep: 0, completedTours: "[]" } : old
      );
      router.push("/setup?step=0");
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={DEBUG_BTN_CLASS}
          disabled={resetWizard.isPending}
        >
          Debug: Re-launch Setup Wizard
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Re-launch Setup Wizard?</AlertDialogTitle>
          <AlertDialogDescription>
            This will delete all processed emails, extracted events, and email
            stats, then restart the setup wizard from scratch. A new backfill
            will run after you complete the wizard.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => resetWizard.mutate()}
            className="bg-orange-600 hover:bg-orange-700"
          >
            Reset &amp; Re-launch
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ClearDataButton() {
  const utils = trpc.useUtils();
  const clearData = trpc.user.clearData.useMutation({
    onSuccess: () => {
      utils.events.list.invalidate();
      toast({ title: "Data cleared", description: "All emails, events, and stats have been deleted." });
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={DEBUG_BTN_CLASS}
          disabled={clearData.isPending}
        >
          {clearData.isPending ? "Clearing..." : "Debug: Clear Data"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear all data?</AlertDialogTitle>
          <AlertDialogDescription>
            This will delete all processed emails, extracted events, and email
            stats. Your account, family, Gmail connection, and forwarding
            settings will not be affected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => clearData.mutate()}
            className="bg-orange-600 hover:bg-orange-700"
          >
            Clear Data
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DownloadDataButton() {
  const [loading, setLoading] = useState(false);
  const utils = trpc.useUtils();

  async function handleDownload() {
    setLoading(true);
    try {
      const data = await utils.user.exportMyData.fetch();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sane-data-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Data exported successfully" });
    } catch {
      toast({ title: "Failed to export data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={loading}
    >
      <Download className="h-4 w-4 mr-1.5" />
      {loading ? "Exporting..." : "Download My Data"}
    </Button>
  );
}

function HouseholdSection() {
  const { update: updateSession } = useSession();
  const searchParams = useSearchParams();
  const urlInviteToken = searchParams.get("accept-invite");
  const utils = trpc.useUtils();
  const { data: status, isLoading } = trpc.household.status.useQuery();
  const inviteCardRef = useRef<HTMLDivElement>(null);

  // Resolve the invite token: URL param takes priority, fall back to status query
  const inviteToken = urlInviteToken ?? status?.pendingInvite?.token ?? null;
  const inviterName = status?.pendingInvite?.inviterName ?? null;

  // Highlight and scroll to the invite card when arriving from a link
  const hasHighlighted = useRef(false);
  useEffect(() => {
    if (inviteToken && inviteCardRef.current && !hasHighlighted.current) {
      hasHighlighted.current = true;
      inviteCardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [inviteToken]);

  const [inviteEmail, setInviteEmail] = useState("");

  const createHousehold = trpc.household.create.useMutation({
    onSuccess: async () => {
      await updateSession();
      utils.household.status.invalidate();
      toast({ title: "Household created" });
    },
    onError: (err) => toast({ title: "Failed to create household", description: err.message, variant: "destructive" }),
  });

  const sendInvite = trpc.household.invite.useMutation({
    onSuccess: () => {
      utils.household.status.invalidate();
      setInviteEmail("");
      toast({ title: "Invite sent" });
    },
    onError: (err) => toast({ title: "Failed to send invite", description: err.message, variant: "destructive" }),
  });

  const cancelInvite = trpc.household.cancelInvite.useMutation({
    onSuccess: () => {
      utils.household.status.invalidate();
      toast({ title: "Invite cancelled" });
    },
    onError: (err) => toast({ title: "Failed to cancel invite", description: err.message, variant: "destructive" }),
  });

  const resendInvite = trpc.household.resendInvite.useMutation({
    onSuccess: () => toast({ title: "Invite resent" }),
    onError: (err) => toast({ title: "Failed to resend", description: err.message, variant: "destructive" }),
  });

  const declineInvite = trpc.household.declineInvite.useMutation({
    onSuccess: () => {
      utils.household.status.invalidate();
      window.history.replaceState(null, "", "/settings#family");
      toast({ title: "Invite declined" });
    },
    onError: (err) => toast({ title: "Failed to decline", description: err.message, variant: "destructive" }),
  });

  const acceptInvite = trpc.household.acceptInvite.useMutation({
    onSuccess: async () => {
      await updateSession(); // Refresh JWT so effectiveUserId resolves to household primary
      utils.household.status.invalidate();
      utils.events.list.invalidate();
      utils.events.upcoming.invalidate();
      utils.children.list.invalidate();
      utils.parents.list.invalidate();
      toast({ title: "Joined household!" });
      window.history.replaceState(null, "", "/settings#family");
    },
    onError: (err) => toast({ title: "Failed to join household", description: err.message, variant: "destructive" }),
  });

  const removeMember = trpc.household.removeMember.useMutation({
    onSuccess: async () => {
      await updateSession();
      utils.household.status.invalidate();
      toast({ title: "Member disconnected. They will need to log in again to set up their own account." });
    },
    onError: (err) => toast({ title: "Failed to remove member", description: err.message, variant: "destructive" }),
  });

  const leaveHousehold = trpc.household.leave.useMutation({
    onSuccess: async () => {
      await signOut({ callbackUrl: "/login" });
    },
    onError: (err) => toast({ title: "Failed to leave", description: err.message, variant: "destructive" }),
  });

  const dissolveHousehold = trpc.household.dissolve.useMutation({
    onSuccess: async () => {
      await updateSession();
      utils.household.status.invalidate();
      toast({ title: "Sharing stopped" });
    },
    onError: (err) => toast({ title: "Failed to stop sharing", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="h-32 rounded-lg bg-muted/30 animate-pulse" />;
  }

  // Pending invite acceptance (from email link or detected via DB)
  if (inviteToken && !status?.inHousehold) {
    return (
      <Card ref={inviteCardRef} className="ring-2 ring-blue-400 ring-offset-2 dark:ring-blue-600">
        <CardHeader>
          <CardTitle>Household Invite <span className="ml-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Beta</span></CardTitle>
          <CardDescription>
            {inviterName
              ? <><strong>{inviterName}</strong> has invited you to join their household.</>
              : "You have been invited to join a household."
            }{" "}
            Accepting will replace any existing data (events, children,
            settings) with the household&apos;s shared data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Your events, children, parent profiles, and email rules will be
            permanently deleted when you join. Your forwarding addresses and
            email connection will be preserved.
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => acceptInvite.mutate({ token: inviteToken })}
              disabled={acceptInvite.isPending}
            >
              {acceptInvite.isPending ? "Joining..." : "Accept and Join"}
            </Button>
            <Button
              variant="outline"
              onClick={() => declineInvite.mutate({ token: inviteToken })}
              disabled={declineInvite.isPending}
            >
              {declineInvite.isPending ? "Declining..." : "Decline"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Not in a household
  if (!status?.inHousehold) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Household <span className="ml-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Beta</span></CardTitle>
          <CardDescription>
            Create a household to share events, children, and school email
            processing with a partner. When one parent marks an event as done,
            the other sees it too.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => createHousehold.mutate()}
            disabled={createHousehold.isPending}
          >
            {createHousehold.isPending ? "Creating..." : "Create Household"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // In a household
  const { isPrimary, household } = status;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Household Members <span className="ml-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Beta</span></CardTitle>
          <CardDescription>
            Everyone in this household shares the same events, children, and email processing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y">
            {household.members.map((member) => {
              const isOwner = member.id === household.primaryUserId;
              return (
                <li key={member.id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium">
                      {member.name}
                      {isOwner && (
                        <span className="ml-2 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                          Owner
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                  {isPrimary && !isOwner && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                        >
                          Remove
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Disconnect {member.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            They will be signed out and will need to set up their
                            own account from scratch. They will no longer have
                            access to shared monitoring.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => removeMember.mutate({ userId: member.id })}
                            disabled={removeMember.isPending}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Pending invites */}
          {household.pendingInvites.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pending Invites</p>
              {household.pendingInvites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="text-sm">{inv.email}</span>
                  {isPrimary && (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => resendInvite.mutate({ inviteId: inv.id })}
                        disabled={resendInvite.isPending}
                      >
                        {resendInvite.isPending ? "Sending..." : "Resend"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => cancelInvite.mutate({ inviteId: inv.id })}
                        disabled={cancelInvite.isPending}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Invite form (primary only, max 6 members) */}
          {isPrimary && household.members.length < 6 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (inviteEmail.trim()) sendInvite.mutate({ email: inviteEmail.trim() });
              }}
              className="flex gap-2"
            >
              <Input
                type="email"
                placeholder="Partner's email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" disabled={sendInvite.isPending || !inviteEmail.trim()}>
                {sendInvite.isPending ? "Sending..." : "Invite"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {isPrimary ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-muted-foreground">
                  Stop Sharing
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Stop sharing with your household?</AlertDialogTitle>
                  <AlertDialogDescription>
                    All members will be disconnected from shared monitoring.
                    They will need to log in again and set up their own accounts
                    to continue using SANE independently. Your data (events,
                    children, settings) will remain on your account.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => dissolveHousehold.mutate()}
                  >
                    Stop Sharing
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-muted-foreground">
                  Disconnect My Account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disconnect from shared monitoring?</AlertDialogTitle>
                  <AlertDialogDescription>
                    You will be signed out and will need to set up your own
                    account from scratch. Your forwarding addresses will be
                    preserved, but you will no longer have access to shared
                    events or children.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => leaveHousehold.mutate()}
                  >
                    Disconnect
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AccountSection() {
  const { data } = trpc.user.globalMonitoringStatus.useQuery();
  const showDebugUI = data?.showDebugUI ?? false;

  return (
    <div className="space-y-6">
      <ProfileSection />
      <PasswordSection />
      <div className="px-6 pt-2">
        <p className="text-sm text-muted-foreground mb-2">Export all your account data as a JSON file.</p>
        <DownloadDataButton />
      </div>
      {showDebugUI && (
        <div className="flex gap-2 flex-wrap">
          <ResetTourButton />
          <ClearDataButton />
          <RelaunchWizardButton />
        </div>
      )}
      <p className="pt-4 px-6 text-xs text-right">
        <Link href="/account/delete" className="text-destructive hover:underline">
          Delete account
        </Link>
      </p>
    </div>
  );
}

function SectionContent({ section }: { section: string }) {
  switch (section) {
    case "privacy":
      return (
        <div className="space-y-6">
          <FeedbackTrainingSection />
          <SupportDataConsentSection />
        </div>
      );
    case "account":
      return <AccountSection />;
    case "family":
      return (
        <div className="space-y-6">
          <OwnerOnlySection>
            <ParentsSection />
            <ChildrenSection />
          </OwnerOnlySection>
          <SubSectionLabel>Household (optional) <span className="ml-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Beta</span></SubSectionLabel>
          <Suspense>
            <HouseholdSection />
          </Suspense>
        </div>
      );
    case "email-setup":
      return (
        <div className="space-y-6">
          <SubSectionLabel>Connection</SubSectionLabel>
          <GmailSection />
          <OwnerOnlySection>
            <GmailAccountTypeSection />
          </OwnerOnlySection>
          <SubSectionLabel>Forwarding Addresses</SubSectionLabel>
          <ForwardingSection />
          <OwnerOnlySection>
            <SubSectionLabel>Email Filtering</SubSectionLabel>
            <EmailSourceFilterSection />
          </OwnerOnlySection>
        </div>
      );
    case "events-setup":
      return (
        <div className="space-y-6">
          <DefaultEventsViewSection />
          <CalendarSubscriptionSection />
          <ActionableEventsOnlySection />
        </div>
      );
    case "email-log":
      return (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Email Log</h2>
            <p className="text-sm text-muted-foreground">
              Review every email SANE has processed. Re-forward emails, give AI feedback, or export your data.
            </p>
          </div>
          <Suspense
            fallback={
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <div className="h-9 w-28 rounded-md bg-muted animate-pulse" />
                  <div className="h-9 w-28 rounded-md bg-muted animate-pulse" />
                  <div className="h-9 w-36 rounded-md bg-muted animate-pulse" />
                </div>
                <div className="h-4 w-64 rounded bg-muted/60 animate-pulse" />
                {[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex items-baseline gap-2 border-b pb-1.5">
                      <div className="h-5 w-24 rounded bg-muted animate-pulse" />
                      <div className="h-4 w-32 rounded bg-muted/60 animate-pulse" />
                    </div>
                    <div className="h-14 w-full rounded-lg border bg-muted/30 animate-pulse" />
                  </div>
                ))}
              </div>
            }
          >
            <ActivityPage />
          </Suspense>
        </div>
      );
    case "delivery":
      return <DeliverySection />;
    default:
      return null;
  }
}

/** Maps sub-section anchors to their parent section */
const SUB_SECTION_MAP: Record<string, string> = {
  "fine-tuning": "delivery",
};

export default function SettingsPage() {
  const { data: me } = trpc.user.me.useQuery();
  const isOwner = me?.isHouseholdOwner ?? true;

  return (
    <HouseholdOwnerProvider isOwner={isOwner}>
      <SettingsShell
        title="Settings"
        description="Manage your account, children, and email monitoring preferences."
        sections={USER_SECTIONS}
        defaultSection="family"
        subSectionMap={SUB_SECTION_MAP}
      >
        {(activeSection) => <SectionContent section={activeSection} />}
      </SettingsShell>
    </HouseholdOwnerProvider>
  );
}
