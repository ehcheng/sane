"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import {
  WIZARD_STEPS,
  WIZARD_STEP_COUNT,
  OLD_TO_NEW_WIZARD_STEP,
} from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { FamilyStep } from "@/components/wizard/family-step";
import { GmailStep } from "@/components/wizard/gmail-step";
import { ForwardingStep } from "@/components/wizard/forwarding-step";

export default function SetupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <SetupWizard />
    </Suspense>
  );
}

function SetupWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: user, isLoading: userLoading } = trpc.user.me.useQuery();
  const { data: parents = [] } = trpc.parents.list.useQuery();
  const { data: children = [] } = trpc.children.list.useQuery();
  const { data: addresses = [] } = trpc.forwarding.list.useQuery();
  const { data: gmailStatus } = trpc.email.connectionStatus.useQuery();
  const { data: allowedSenders = [] } = trpc.allowedSenders.list.useQuery();

  const utils = trpc.useUtils();
  const updateWizardStep = trpc.user.updateWizardStep.useMutation();
  const triggerBackfill = trpc.email.backfill.useMutation();

  // Normalize old wizard step values for existing users
  const normalizedRef = useRef(false);
  const savedStep = user?.wizardStep ?? 0;
  const normalizedSavedStep = useMemo(() => {
    if (savedStep in OLD_TO_NEW_WIZARD_STEP) {
      return OLD_TO_NEW_WIZARD_STEP[savedStep];
    }
    // Clamp unknown values
    return Math.min(savedStep, WIZARD_STEP_COUNT);
  }, [savedStep]);

  // Auto-persist the normalized step once
  useEffect(() => {
    if (normalizedRef.current || !user) return;
    if (savedStep !== normalizedSavedStep && normalizedSavedStep !== undefined) {
      normalizedRef.current = true;
      updateWizardStep.mutate({ step: normalizedSavedStep });
    }
  }, [user, savedStep, normalizedSavedStep, updateWizardStep]);

  // Derive current step from URL search params, falling back to user's saved step
  const currentStep = useMemo(() => {
    const paramStep = searchParams.get("step");
    if (paramStep !== null) {
      const parsed = parseInt(paramStep, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed < WIZARD_STEP_COUNT) {
        return parsed;
      }
    }
    return Math.min(normalizedSavedStep, WIZARD_STEP_COUNT - 1);
  }, [searchParams, normalizedSavedStep]);

  const stepName = WIZARD_STEPS[currentStep];

  // Validation: determine if user can proceed from the current step
  const canProceed = useMemo(() => {
    switch (stepName) {
      case "family":
        return parents.length > 0 && children.length > 0;
      case "gmail":
        if (gmailStatus?.status !== "ACTIVE") return false;
        // SHARED users must pick at least one allowed sender
        if (user?.emailAccountType === "SHARED") return allowedSenders.length > 0;
        return true;
      case "forwarding":
        return addresses.length > 0;
      default:
        return true;
    }
  }, [stepName, parents.length, children.length, gmailStatus?.status, addresses, user?.emailAccountType, allowedSenders.length]);

  const goToStep = useCallback(
    (step: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("step", String(step));
      // Strip OAuth params when navigating away from Gmail step
      params.delete("success");
      params.delete("error");
      router.push(`/setup?${params.toString()}`);
    },
    [router, searchParams]
  );

  const handleNext = useCallback(async () => {
    const nextStep = currentStep + 1;
    // Persist the wizard step to the server
    await updateWizardStep.mutateAsync({ step: nextStep });
    // Update user.me cache so downstream pages see the new wizardStep immediately
    utils.user.me.setData(undefined, (old) =>
      old ? { ...old, wizardStep: nextStep } : old
    );
    if (nextStep >= WIZARD_STEP_COUNT) {
      // Wizard complete — invalidate status so the dot turns green immediately
      utils.user.statusSummary.invalidate();
      // Queue backfill, then redirect to events
      try {
        await triggerBackfill.mutateAsync();
      } catch {
        // Ignore errors (e.g. cooldown) — not critical
      }
      router.push("/events?setup=1");
    } else {
      goToStep(nextStep);
    }
  }, [currentStep, updateWizardStep, utils, triggerBackfill, router, goToStep]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      goToStep(currentStep - 1);
    }
  }, [currentStep, goToStep]);

  const handleFinishLater = useCallback(() => {
    router.push("/events");
  }, [router]);

  // Auto-detect browser timezone and save if user still has the default
  const updateForwardingSettings =
    trpc.user.updateForwardingSettings.useMutation();
  const tzSaved = useRef(false);
  useEffect(() => {
    if (tzSaved.current || !user) return;
    if (user.timezone !== "America/New_York") return;
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && detected !== "America/New_York") {
      tzSaved.current = true;
      updateForwardingSettings.mutate({ timezone: detected });
    }
  }, [user, updateForwardingSettings]);

  if (userLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const isLastStep = currentStep === WIZARD_STEP_COUNT - 1;

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 py-8">
      {/* Progress indicator */}
      <div className="mb-8">
        <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Step {currentStep + 1} of {WIZARD_STEP_COUNT}
          </span>
          <span className="capitalize">{stepName?.replace(/-/g, " ")}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{
              width: `${((currentStep + 1) / WIZARD_STEP_COUNT) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Step content */}
      <div className="mb-8">
        {stepName === "family" && <FamilyStep />}
        {stepName === "gmail" && <GmailStep />}
        {stepName === "forwarding" && <ForwardingStep />}
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between border-t pt-6">
        <Button
          variant="ghost"
          onClick={handleBack}
          disabled={currentStep === 0}
        >
          Back
        </Button>
        <div className="flex items-center gap-3">
          {!isLastStep && (
            <Button
              variant="link"
              className="text-muted-foreground"
              onClick={handleFinishLater}
            >
              Finish later
            </Button>
          )}
          <Button
            size={isLastStep ? "lg" : "default"}
            onClick={handleNext}
            disabled={!canProceed || updateWizardStep.isPending}
          >
            {updateWizardStep.isPending
              ? "Saving..."
              : isLastStep
                ? "Start Monitoring"
                : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}
