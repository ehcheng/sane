"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { BackfillProgressBanner } from "./backfill-progress-banner";

export function EmailVerificationBanner() {
  const { data: user } = trpc.user.me.useQuery();
  const resend = trpc.user.resendVerification.useMutation({
    onSuccess: () => {
      setSent(true);
      toast({ title: "Verification email sent" });
    },
    onError: (err) =>
      toast({
        title: "Failed to send verification",
        description: err.message,
        variant: "destructive",
      }),
  });
  const [sent, setSent] = useState(false);

  if (!user || user.emailVerified) return null;

  return (
    <Card className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="font-medium text-blue-900 dark:text-blue-100">
            Email not verified
          </p>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Check your inbox for a verification link. Monitoring won&apos;t
            start until your email is verified.
          </p>
        </div>
        {sent ? (
          <span className="shrink-0 text-sm text-blue-700 dark:text-blue-300">
            Sent!
          </span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => resend.mutate()}
            disabled={resend.isPending}
          >
            {resend.isPending ? "Sending..." : "Resend"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function SetupIncompleteBanner() {
  const { data: user } = trpc.user.me.useQuery();
  const { data: parents } = trpc.parents.list.useQuery();
  const { data: children } = trpc.children.list.useQuery();
  const { data: forwarding } = trpc.forwarding.list.useQuery();
  const { data: gmailStatus } = trpc.email.connectionStatus.useQuery();

  if (!user) return null;

  // If wizard is finished OR all required config is present, no banner needed
  const isFullyConfigured =
    (parents?.length ?? 0) > 0 &&
    (children?.length ?? 0) > 0 &&
    (forwarding?.length ?? 0) > 0 &&
    gmailStatus?.status === "ACTIVE";

  if (user.wizardStep >= 3 || isFullyConfigured) return null;

  return (
    <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="font-medium text-amber-900 dark:text-amber-100">
            Setup incomplete
          </p>
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Complete the setup wizard to start monitoring your school emails.
          </p>
        </div>
        <Button asChild>
          <Link href="/setup">Complete Setup</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function ConfigMissingBanner() {
  const { data: user } = trpc.user.me.useQuery();
  const { data: parents } = trpc.parents.list.useQuery();
  const { data: children } = trpc.children.list.useQuery();
  const { data: forwarding } = trpc.forwarding.list.useQuery();

  // Show only after wizard is complete (or user has manually configured enough to skip it)
  const isSetupComplete = !!(user && user.wizardStep >= 3);
  const hasNoParents = isSetupComplete && parents?.length === 0;
  const hasNoChildren = isSetupComplete && children?.length === 0;
  const hasNoForwarding = isSetupComplete && forwarding?.length === 0;

  if (!hasNoParents && !hasNoChildren && !hasNoForwarding) return null;

  const missing: string[] = [];
  if (hasNoParents) missing.push("parents");
  if (hasNoChildren) missing.push("children");
  if (hasNoForwarding) missing.push("forwarding addresses");

  return (
    <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="font-medium text-red-900 dark:text-red-100">
            Monitoring paused — configuration missing
          </p>
          <p className="text-sm text-red-700 dark:text-red-300">
            You have no {missing.join(" or ")} configured. All are required for
            monitoring.
          </p>
        </div>
        <Button asChild size="sm">
          <Link
            href={
              hasNoParents || hasNoChildren
                ? "/settings#family"
                : "/settings#email-setup"
            }
          >
            {hasNoParents
              ? "Add Parents"
              : hasNoChildren
                ? "Add Children"
                : "Add Address"}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function ForwardingVerificationBanner() {
  const { data: addresses } = trpc.forwarding.list.useQuery();
  const resend = trpc.forwarding.resendVerification.useMutation({
    onSuccess: () => toast({ title: "Verification email sent" }),
    onError: (err) =>
      toast({
        title: "Failed to send",
        description: err.message,
        variant: "destructive",
      }),
  });

  const unverified = useMemo(
    () => addresses?.filter((a) => !a.verifiedAt) ?? [],
    [addresses]
  );

  // Show when any address is unverified
  if (!addresses?.length || unverified.length === 0) return null;

  const allUnverified = unverified.length === addresses.length;

  return (
    <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="font-medium text-amber-900 dark:text-amber-100">
            {allUnverified
              ? "No forwarding addresses verified"
              : `${unverified.length} forwarding address${unverified.length > 1 ? "es" : ""} need${unverified.length === 1 ? "s" : ""} verification`}
          </p>
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {allUnverified
              ? "You won\u2019t receive any forwarded emails until at least one address is verified."
              : "Check your inbox and click the verification link to complete setup."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => resend.mutate({ id: unverified[0].id })}
          disabled={resend.isPending}
        >
          {resend.isPending ? "Sending..." : "Resend"}
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Composite component that renders all status banners.
 * Placed in AppShell so alerts appear on every user page.
 * Skips rendering on the /setup wizard page (wizard has its own flow).
 */
export function StatusBanners() {
  const pathname = usePathname();

  // Don't show banners on the setup wizard — it has its own step-by-step flow
  if (pathname === "/setup") return null;

  return (
    <>
      {/* Events page has its own inline backfill progress */}
      {pathname !== "/events" && <BackfillProgressBanner />}
      <EmailVerificationBanner />
      <SetupIncompleteBanner />
      <ConfigMissingBanner />
      <ForwardingVerificationBanner />
    </>
  );
}
