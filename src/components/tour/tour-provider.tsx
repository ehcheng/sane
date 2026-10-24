"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";
import type { TourId, TourStep, TourUserContext } from "./tour-definitions";
import { TOUR_DEFINITIONS } from "./tour-definitions";

interface TourContextValue {
  /** Which tours the user has already completed */
  completedTours: TourId[];
  /** Currently active tour (null if none) */
  activeTourId: TourId | null;
  /** Current step index within the active tour */
  activeStepIndex: number;
  /** The current step definition */
  activeStep: TourStep | null;
  /** Total visible steps (after skips) for the active tour */
  totalSteps: number;
  /** Current 1-based display step number */
  displayStepNumber: number;
  /** Start a tour */
  startTour: (tourId: TourId) => void;
  /** Go to next step */
  nextStep: () => void;
  /** Go to previous step */
  prevStep: () => void;
  /** Dismiss (skip) the current tour — marks it complete */
  dismissTour: () => void;
  /** Whether the user data has loaded */
  isReady: boolean;
  /** User context for dynamic step bodies */
  userContext: TourUserContext;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTourContext() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTourContext must be used within TourProvider");
  return ctx;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { data: user } = trpc.user.me.useQuery();
  const utils = trpc.useUtils();
  const completeTourMutation = trpc.user.completeTour.useMutation({
    onSuccess: () => {
      utils.user.me.invalidate();
    },
  });

  const completedTours: TourId[] = useMemo(() => {
    if (!user?.completedTours) return [];
    try {
      return JSON.parse(user.completedTours) as TourId[];
    } catch {
      return [];
    }
  }, [user?.completedTours]);

  const userContext: TourUserContext = useMemo(
    () => ({
      individualForwardingEnabled: user?.individualForwardingEnabled ?? false,
      emailAccountType: user?.emailAccountType ?? "DEDICATED",
    }),
    [user?.individualForwardingEnabled, user?.emailAccountType]
  );

  const [activeTourId, setActiveTourId] = useState<TourId | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  const tourDef = activeTourId ? TOUR_DEFINITIONS[activeTourId] : null;

  // Compute visible steps (filtering out skipped ones)
  const visibleSteps = useMemo(() => {
    if (!tourDef) return [];
    return tourDef.steps.filter((s) => !s.skipWhen?.());
  }, [tourDef]);

  const activeStep = visibleSteps[activeStepIndex] ?? null;

  const markComplete = useCallback(
    (tourId: TourId) => {
      completeTourMutation.mutate({ tourId });
    },
    [completeTourMutation]
  );

  const startTour = useCallback(
    (tourId: TourId) => {
      if (activeTourId) return; // don't interrupt
      setActiveTourId(tourId);
      setActiveStepIndex(0);
    },
    [activeTourId]
  );

  const finishTour = useCallback(() => {
    if (activeTourId) {
      markComplete(activeTourId);
    }
    setActiveTourId(null);
    setActiveStepIndex(0);
  }, [activeTourId, markComplete]);

  const nextStep = useCallback(() => {
    if (activeStepIndex < visibleSteps.length - 1) {
      setActiveStepIndex((i) => i + 1);
    } else {
      finishTour();
    }
  }, [activeStepIndex, visibleSteps.length, finishTour]);

  const prevStep = useCallback(() => {
    if (activeStepIndex > 0) {
      setActiveStepIndex((i) => i - 1);
    }
  }, [activeStepIndex]);

  const dismissTour = useCallback(() => {
    finishTour();
  }, [finishTour]);

  const value: TourContextValue = useMemo(
    () => ({
      completedTours,
      activeTourId,
      activeStepIndex,
      activeStep,
      totalSteps: visibleSteps.length,
      displayStepNumber: activeStepIndex + 1,
      startTour,
      nextStep,
      prevStep,
      dismissTour,
      isReady: !!user,
      userContext,
    }),
    [
      completedTours,
      activeTourId,
      activeStepIndex,
      activeStep,
      visibleSteps.length,
      startTour,
      nextStep,
      prevStep,
      dismissTour,
      user,
      userContext,
    ]
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}
