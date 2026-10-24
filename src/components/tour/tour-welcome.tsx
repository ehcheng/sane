"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTourContext } from "./tour-provider";
import { resolveBody } from "./tour-definitions";

/**
 * Centered welcome card for tour steps that have no target element.
 * Shows a light backdrop overlay.
 */
export function TourWelcome() {
  const {
    activeStep,
    activeStepIndex,
    totalSteps,
    nextStep,
    dismissTour,
    userContext,
  } = useTourContext();

  if (!activeStep || activeStep.target !== null) return null;

  const isLast = activeStepIndex === totalSteps - 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/10">
      <div className="mx-4 w-full max-w-xs rounded-lg border bg-popover p-5 text-popover-foreground shadow-lg">
        {/* Header: step counter + close */}
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {activeStepIndex + 1} of {totalSteps}
          </span>
          <button
            onClick={dismissTour}
            className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Close tour"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Content */}
        <h4 className="text-sm font-semibold">{activeStep.title}</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolveBody(activeStep.body, userContext)}
        </p>

        {/* Buttons */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={dismissTour}>
            Skip
          </Button>
          <Button size="sm" onClick={nextStep}>
            {isLast ? "Done" : "Show me around"}
          </Button>
        </div>
      </div>
    </div>
  );
}
