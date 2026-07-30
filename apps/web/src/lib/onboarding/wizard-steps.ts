/**
 * The five durable setup milestones shown around producer onboarding.
 *
 * Product authoring temporarily hides this outer progress system and shows
 * only the shared Store editor's seven steps.
 */

export type WizardStepId = "account" | "identity" | "product" | "availability" | "publish";

export interface WizardStep {
  id: WizardStepId;
  position: 1 | 2 | 3 | 4 | 5;
  label: string;
  meta: string;
  route:
    | "/onboarding/studio"
    | "/onboarding/service"
    | "/onboarding/availability"
    | "/onboarding/review"
    | null;
  /** Account creation is a true completed milestone on first paint. */
  state?: "complete";
}

export const WIZARD_STEPS: ReadonlyArray<WizardStep> = [
  {
    id: "account",
    position: 1,
    label: "Account created",
    meta: "Done",
    route: null,
    state: "complete",
  },
  {
    id: "identity",
    position: 2,
    label: "Public page",
    meta: "Your name and link",
    route: "/onboarding/studio",
  },
  {
    id: "product",
    position: 3,
    label: "First product",
    meta: "What artists can request",
    route: "/onboarding/service",
  },
  {
    id: "availability",
    position: 4,
    label: "Working hours",
    meta: "Only when sessions need them",
    route: "/onboarding/availability",
  },
  {
    id: "publish",
    position: 5,
    label: "Review & publish",
    meta: "Check before sharing",
    route: "/onboarding/review",
  },
] as const;

export function getStepByPosition(position: number): WizardStep | undefined {
  return WIZARD_STEPS.find((step) => step.position === position);
}

export function getStepById(id: string): WizardStep | undefined {
  return WIZARD_STEPS.find((step) => step.id === id);
}
