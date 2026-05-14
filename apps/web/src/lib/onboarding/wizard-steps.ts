/**
 * Single source of truth for the 5 numbered steps shown in the
 * producer onboarding rail (Step 1..Step 5).
 *
 * Welcome (the pre-step) and Done (post-step) are intentionally NOT
 * in this list — they don't appear in the rail and have their own
 * standalone shells.
 *
 * Used by:
 *   - StepRail (renders one row per record)
 *   - OnboardingChrome (computes "Step N of 5" from `position`)
 *   - Per-step page.tsx files (back/skip/continue route from the
 *     step's neighbours in this list — no string-typed routes)
 *
 * The redesign collapsed the legacy `services` chip-multi-select step
 * into the `service` template-picker step (Decision #4 — drop service
 * roles entirely). That's why this list has 5 entries, not 6.
 *
 * Tested in wizard-steps.test.ts.
 */

export type WizardStepId =
  | "studio"
  | "service"
  | "availability"
  | "portfolio"
  | "payment";

export interface WizardStep {
  /** Stable URL/state identifier — never displayed to producers. */
  id: WizardStepId;
  /** 1-indexed position used for the active-row highlight + "Step N of 5". */
  position: 1 | 2 | 3 | 4 | 5;
  /** Rail row label as shown to the producer (matches design copy). */
  label: string;
  /** Meta line under the label, format "Required · 30s" or "Optional · 20s". */
  meta: string;
  /** Required steps gate Continue; optional steps show a Skip button. */
  required: boolean;
  /** Absolute path the rail row + back/next handlers route to. */
  route: `/onboarding/${WizardStepId}`;
}

export const WIZARD_STEPS: ReadonlyArray<WizardStep> = [
  {
    id: "studio",
    position: 1,
    label: "Your hall",
    meta: "Required · 30s",
    required: true,
    route: "/onboarding/studio",
  },
  {
    id: "service",
    position: 2,
    label: "First service",
    meta: "Required · 40s",
    required: true,
    route: "/onboarding/service",
  },
  {
    id: "availability",
    position: 3,
    label: "When you work",
    meta: "Required · 20s",
    required: true,
    route: "/onboarding/availability",
  },
  {
    id: "portfolio",
    position: 4,
    label: "A taste",
    meta: "Optional · 20s",
    required: false,
    route: "/onboarding/portfolio",
  },
  {
    id: "payment",
    position: 5,
    label: "Get paid",
    meta: "Optional · 15s",
    required: false,
    route: "/onboarding/payment",
  },
] as const;

export function getStepByPosition(
  position: number,
): WizardStep | undefined {
  return WIZARD_STEPS.find((s) => s.position === position);
}

export function getStepById(id: string): WizardStep | undefined {
  return WIZARD_STEPS.find((s) => s.id === id);
}
