/**
 * 4 starter service templates for the May 2026 onboarding redesign,
 * Step 2 ("First service"). Smaller and more opinionated than
 * lib/service-templates.ts (which serves the full Setup → Services
 * editor) — the redesign collapses choice to four big buckets so the
 * producer can pick + advance in one click.
 *
 * Each entry maps to the existing `createOnboardingPackage` action
 * input: name, kind, priceCents, durationMin, depositPct,
 * locationType, currency. The producer can edit name + price inline
 * in the form before continuing.
 *
 * Tested in service-templates-onboarding.test.ts.
 */

import type { LucideIcon } from "lucide-react";
import { Clock, Mic2, Plus, Sliders } from "lucide-react";

export type OnboardingServiceTemplateId =
  | "mix"
  | "production"
  | "studio"
  | "custom";

export interface OnboardingServiceTemplate {
  id: OnboardingServiceTemplateId;
  icon: LucideIcon;
  /** Card title, e.g. "Mix & Master — Single". */
  title: string;
  /** One-line description shown on the unselected card. */
  description: string;
  /** Default service name pre-filled into the form. */
  defaultName: string;
  /** Default price in MAJOR currency units (USD/EUR/GBP/ILS). */
  defaultPrice: number;
  /** Default sessions count (1+). */
  defaultSessions: number;
  /** Maps to createOnboardingPackage's `kind` field. */
  packageKind: "mixing" | "mastering" | "producing" | "session" | "other";
  /** Default duration in minutes. */
  defaultDurationMin: number;
}

export const ONBOARDING_SERVICE_TEMPLATES: ReadonlyArray<OnboardingServiceTemplate> = [
  {
    id: "mix",
    icon: Sliders,
    title: "Mix & Master — Single",
    description: "A polished, release-ready single.",
    defaultName: "Mix & Master — Single",
    defaultPrice: 800,
    defaultSessions: 1,
    packageKind: "mixing",
    defaultDurationMin: 180,
  },
  {
    id: "production",
    icon: Mic2,
    title: "Full Production",
    description: "From demo to finished record.",
    defaultName: "Full Production",
    defaultPrice: 2400,
    defaultSessions: 4,
    packageKind: "producing",
    defaultDurationMin: 240,
  },
  {
    id: "studio",
    icon: Clock,
    title: "Studio Session — 4h",
    description: "A block of studio time.",
    defaultName: "Studio Session — 4h",
    defaultPrice: 350,
    defaultSessions: 1,
    packageKind: "session",
    defaultDurationMin: 240,
  },
  {
    id: "custom",
    icon: Plus,
    title: "Something else",
    description: "Make your own.",
    defaultName: "",
    defaultPrice: 500,
    defaultSessions: 1,
    packageKind: "other",
    defaultDurationMin: 60,
  },
];

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "ILS"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const PAYMENT_PLANS = [
  { id: "full", label: "Full" },
  { id: "deposit", label: "50% upfront" },
  { id: "monthly", label: "Monthly" },
] as const;

export type PaymentPlanId = (typeof PAYMENT_PLANS)[number]["id"];

/**
 * Continue gate. Trimmed name must have ≥ 2 characters AND price > 0
 * AND sessions ≥ 1.
 */
export function isServiceContinueAllowed(
  name: string,
  price: number,
  sessions: number,
): boolean {
  return name.trim().length >= 2 && price > 0 && sessions >= 1;
}

/**
 * Map the redesign's payment plan id to the deposit percentage that
 * the existing `createOnboardingPackage` action expects:
 *   - "full" → 0% deposit
 *   - "deposit" → 50%
 *   - "monthly" → 25% (placeholder; real monthly billing requires
 *     Stripe Connect milestones, which Phase H owns)
 */
export function depositPctForPlan(plan: PaymentPlanId): number {
  switch (plan) {
    case "full":
      return 0;
    case "deposit":
      return 50;
    case "monthly":
      return 25;
  }
}
