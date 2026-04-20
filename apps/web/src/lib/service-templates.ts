// Curated starter templates for the Services / packages tab. Picking
// "Use template" hydrates the NewPackageForm with these values so the
// producer lands on a near-complete form in one click. The list is
// intentionally tiny (5 entries) and static — adding a new one is a
// one-line entry here; no schema change needed because templates are
// just pre-filled form defaults.
//
// Each entry covers the full shape the form expects:
//   - name, description, kind, locationType
//   - priceCents, currency, depositPct
//   - durationMin, sessionCount, bufferMinutes, minLeadHours
//
// The icon is a string emoji/glyph rather than a React element so this
// file stays a plain data module (easier to test, no client-only
// imports). The template-card component maps icon strings to the
// stroke glyphs we already use across the dashboard.

import type { PaymentPlan } from "@skitza/db";

import type {
  PackageKind,
  PackageLocationType,
} from "~/app/(app)/dashboard/booking/actions";

export type TemplateCurrency = "USD" | "EUR" | "GBP" | "ILS";

// Icon keys map to the glyph set we already render inline in the
// Services grid (matches the kind-icon treatment in other lists). The
// card component knows how to draw each one.
export type TemplateIcon = "mix" | "album" | "weekend" | "remote" | "master";

export type ServiceTemplate = {
  id: string;
  icon: TemplateIcon;
  title: string;
  // Short one-liner shown on the card under the title.
  tagline: string;
  // Values consumed by NewPackageForm via URL pre-fill.
  defaults: {
    name: string;
    description: string;
    kind: PackageKind;
    locationType: PackageLocationType;
    priceCents: number;
    currency: TemplateCurrency;
    depositPct: number;
    durationMin: number;
    sessionCount: number;
    bufferMinutes: number;
    minLeadHours: number;
    paymentPlans: PaymentPlan[];
  };
};

// The five built-ins. Prices + durations are sensible defaults drawn
// from what most engineers in the project's target bracket charge;
// producers edit every field before hitting Save.
export const SERVICE_TEMPLATES: readonly ServiceTemplate[] = [
  {
    id: "mix-3h",
    icon: "mix",
    title: "3-hour mixing session",
    tagline: "Single sitting · $150",
    defaults: {
      name: "3-hour mixing session",
      description:
        "One focused session to polish a single track — EQ, compression, and bus work.",
      kind: "mixing",
      locationType: "studio",
      priceCents: 15000,
      currency: "USD",
      depositPct: 25,
      durationMin: 180,
      sessionCount: 1,
      bufferMinutes: 15,
      minLeadHours: 24,
      paymentPlans: [{ kind: "full" }],
    },
  },
  {
    id: "album-package",
    icon: "album",
    title: "Album production package",
    tagline: "Multi-session · 50/50 split",
    defaults: {
      name: "Album production package",
      description:
        "Full album production spread across multiple sessions — tracking, production, and mix prep.",
      kind: "producing",
      locationType: "studio",
      priceCents: 450000,
      currency: "USD",
      depositPct: 50,
      durationMin: 240,
      sessionCount: 10,
      bufferMinutes: 30,
      minLeadHours: 72,
      // 50/50 split — half up front, half on delivery.
      paymentPlans: [{ kind: "split_50_50" }],
    },
  },
  {
    id: "weekend-intensive",
    icon: "weekend",
    title: "Weekend intensive",
    tagline: "2× 4h days · flat $600",
    defaults: {
      name: "Weekend intensive",
      description:
        "Two four-hour days over a weekend. Ideal for tracking a short EP or finishing a stalled project.",
      kind: "session",
      locationType: "studio",
      priceCents: 60000,
      currency: "USD",
      depositPct: 25,
      durationMin: 240,
      sessionCount: 2,
      bufferMinutes: 0,
      minLeadHours: 48,
      paymentPlans: [{ kind: "full" }],
    },
  },
  {
    id: "remote-feedback",
    icon: "remote",
    title: "Remote feedback round",
    tagline: "Async · $75 / hour",
    defaults: {
      name: "Remote feedback round",
      description:
        "Async mix notes delivered over email + annotated timeline. No live session required.",
      kind: "mixing",
      locationType: "remote",
      priceCents: 7500,
      currency: "USD",
      depositPct: 0,
      durationMin: 60,
      sessionCount: 1,
      bufferMinutes: 0,
      minLeadHours: 12,
      paymentPlans: [{ kind: "full" }],
    },
  },
  {
    id: "mastering-pass",
    icon: "master",
    title: "Mastering pass",
    tagline: "Single track · $200",
    defaults: {
      name: "Mastering pass",
      description:
        "One mastering revision on a finished mix. Includes one free revision round.",
      kind: "mastering",
      locationType: "studio",
      priceCents: 20000,
      currency: "USD",
      depositPct: 25,
      durationMin: 90,
      sessionCount: 1,
      bufferMinutes: 15,
      minLeadHours: 24,
      paymentPlans: [{ kind: "full" }],
    },
  },
];

// Lookup helper — the template card link passes `?template=<id>` which
// the form reads on mount. Returns undefined for an unknown id so the
// form cleanly falls back to the blank-create defaults.
export function findTemplate(id: string | null): ServiceTemplate | undefined {
  if (!id) return undefined;
  return SERVICE_TEMPLATES.find((t) => t.id === id);
}
