// Client-safe constants. Server-only config is in the database (Admin > Settings).

/** School days of inactivity before entering WARNING state. */
export const INACTIVITY_THRESHOLD_DAYS = 30;

/** Calendar days from initial warning to deactivation. */
export const DEACTIVATION_WINDOW_DAYS = 14;

export const WIZARD_STEPS = ["family", "gmail", "forwarding"] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export const WIZARD_STEP_COUNT = WIZARD_STEPS.length;

/**
 * Maps old 7-step wizard values (0-7) to the new 3-step scheme.
 * Used to normalize existing users' wizardStep on read.
 */
export const OLD_TO_NEW_WIZARD_STEP: Record<number, number> = {
  0: 0,
  1: 0, // welcome/family → family
  2: 1,
  3: 1,
  4: 1, // ignored/connect/type → gmail
  5: 2, // forwarding → forwarding
  6: 3,
  7: 3, // review/complete → complete
};
