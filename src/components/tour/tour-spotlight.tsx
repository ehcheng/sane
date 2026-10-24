"use client";

import { useTourContext } from "./tour-provider";
import { TourCallout } from "./tour-callout";
import { TourWelcome } from "./tour-welcome";

/**
 * Orchestrator: renders the correct tour component based on the active step type.
 * Place this once inside TourProvider.
 */
export function TourSpotlight() {
  const { activeTourId, activeStep } = useTourContext();

  if (!activeTourId || !activeStep) return null;

  // Welcome step (no target) = centered card with backdrop
  if (activeStep.target === null) {
    return <TourWelcome />;
  }

  // Feature step (has target) = popover callout
  return <TourCallout />;
}
