"use client";

import { useEffect, useState, useRef } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTourContext } from "./tour-provider";
import { resolveBody } from "./tour-definitions";

/**
 * Floating callout card anchored to a DOM element via data-tour attribute.
 * Uses Radix Popover with a virtual anchor for positioning.
 */
export function TourCallout() {
  const {
    activeStep,
    activeStepIndex,
    totalSteps,
    nextStep,
    prevStep,
    dismissTour,
    userContext,
  } = useTourContext();

  const [targetEl, setTargetEl] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const prevTargetRef = useRef<HTMLElement | null>(null);

  // On step change: hide callout, find new target, then reveal
  useEffect(() => {
    setVisible(false);
    setTargetEl(null);

    if (!activeStep?.target) return;

    // Remove highlight from previous target immediately
    if (prevTargetRef.current) {
      prevTargetRef.current.classList.remove("tour-highlight");
      prevTargetRef.current = null;
    }

    // Wait for old callout to disappear, then find & show new target
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-tour="${activeStep.target}"]`
      );
      if (el) {
        el.classList.add("tour-highlight");
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        prevTargetRef.current = el;
        setTargetEl(el);
        // Small extra delay so popover positions before fading in
        requestAnimationFrame(() => setVisible(true));
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [activeStep]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up highlight on unmount
  useEffect(() => {
    return () => {
      if (prevTargetRef.current) {
        prevTargetRef.current.classList.remove("tour-highlight");
      }
    };
  }, []);

  if (!activeStep || !activeStep.target) return null;
  if (!targetEl) return null;

  const isFirst = activeStepIndex === 0;
  const isLast = activeStepIndex === totalSteps - 1;

  return (
    <PopoverPrimitive.Root open>
      <PopoverPrimitive.Anchor virtualRef={{ current: targetEl }} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={activeStep.side ?? "bottom"}
          align={activeStep.align ?? "center"}
          sideOffset={8}
          collisionPadding={16}
          className="z-[60] w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg outline-none transition-opacity duration-150"
          style={{ opacity: visible ? 1 : 0 }}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
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
          <div className="mt-3 flex items-center justify-end gap-2">
            {!isFirst && (
              <Button variant="ghost" size="sm" onClick={prevStep}>
                Back
              </Button>
            )}
            <Button size="sm" onClick={nextStep}>
              {isLast ? "Done" : "Next"}
            </Button>
          </div>

          <PopoverPrimitive.Arrow className="fill-popover" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
