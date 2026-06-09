// Types + placeholder data for the artist Pay section (SK-42, epic SK-36).
//
// Payment in v1 is OFF-APP: after a producer approves the booking, the artist
// pays by bank transfer or Bit, then uploads a proof-of-payment screenshot.
// Card pay (Tranzila) is v2 — shown greyed as "coming soon", not wired here.
//
// MOCK — BE-2 (SK-38) provides plans + POP upload + Gate 2; swap MOCK_* for the
// tRPC caller in page.tsx, screens unchanged.

import {
  formatShekels,
  swatchGradient,
  type Producer,
  type PurchaseProduct,
} from "./purchase-data";

// ── Placeholder product + producer (BE-2 / BE-3 era) ────────────────────────
// The Commit screens (S3/S4/S5) were wired to REAL BE-1 data in SK-46; these
// placeholders remain ONLY for the Pay slice (until BE-2 / SK-38) and the
// sessions pages (until BE-3 / SK-39), which import them from here.
export const MOCK_PRODUCER: Producer = {
  name: "Gili Studio",
  initials: "GS",
  hue: 30,
  agreement: { filename: "Booking_Agreement.pdf" },
};

export const MOCK_PRODUCT: PurchaseProduct = {
  id: "g1",
  name: "Single — start to finish",
  priceCents: 240000,
  currency: "ILS",
  durationLabel: "Multi-session · 3–4 weeks",
  includes: [
    "Up to 4 song parts tracked",
    "Comped & tuned lead vocal",
    "Full mix + master",
    "2 revision rounds",
    "WAV stems + masters delivered",
  ],
};

// ── Payment plans ─────────────────────────────────────────────────────────

export type PaymentPlan = "full" | "split" | "milestones";

export type PlanOption = {
  plan: PaymentPlan;
  title: string;
  blurb: string;
  /** What the artist pays today to secure the slot. */
  dueNowCents: number;
  /** Each row is one payment; amounts always sum to the total exactly. */
  schedule: { label: string; amountCents: number }[];
};

// Static copy per plan — the amounts are computed from the total below.
const PLAN_COPY: Record<PaymentPlan, { title: string; blurb: string }> = {
  full: {
    title: "Pay in full",
    blurb: "One payment now. Simplest, nothing left to track.",
  },
  split: {
    title: "Split 50 / 50",
    blurb: "Half to secure your slot, the rest on delivery.",
  },
  milestones: {
    title: "Three milestones",
    blurb: "Spread across the project — start, mid, and delivery.",
  },
};

// Build one PlanOption. Amounts are derived so the schedule sums to totalCents
// exactly (no agorot lost to rounding); any remainder lands on the first row.
function buildOption(plan: PaymentPlan, totalCents: number): PlanOption {
  const { title, blurb } = PLAN_COPY[plan];

  if (plan === "full") {
    return {
      plan,
      title,
      blurb,
      dueNowCents: totalCents,
      schedule: [{ label: "Today", amountCents: totalCents }],
    };
  }

  if (plan === "split") {
    const first = Math.ceil(totalCents / 2);
    const second = totalCents - first;
    return {
      plan,
      title,
      blurb,
      dueNowCents: first,
      schedule: [
        { label: "Today", amountCents: first },
        { label: "On delivery", amountCents: second },
      ],
    };
  }

  // milestones — thirds, remainder to the first row
  const base = Math.floor(totalCents / 3);
  const first = totalCents - base * 2; // base + remainder
  return {
    plan,
    title,
    blurb,
    dueNowCents: first,
    schedule: [
      { label: "Today", amountCents: first },
      { label: "Mid-project", amountCents: base },
      { label: "On delivery", amountCents: base },
    ],
  };
}

export function planOptions(
  totalCents: number,
  allowed: PaymentPlan[],
): PlanOption[] {
  return allowed.map((plan) => buildOption(plan, totalCents));
}

export function amountDueNowCents(opt: PlanOption): number {
  return opt.dueNowCents;
}

// ── Running total (Gate 2 progress) ─────────────────────────────────────────

export function paidProgress(
  paidCents: number,
  totalCents: number,
): {
  paidLabel: string;
  totalLabel: string;
  remainingCents: number;
  pct: number;
  isPaidInFull: boolean;
} {
  const remainingCents = Math.max(0, totalCents - paidCents);
  const pct =
    totalCents <= 0
      ? 100
      : Math.min(100, Math.max(0, Math.round((paidCents / totalCents) * 100)));
  return {
    paidLabel: formatShekels(paidCents),
    totalLabel: formatShekels(totalCents),
    remainingCents,
    pct,
    isPaidInFull: paidCents >= totalCents,
  };
}

// ── Proof-of-payment status ─────────────────────────────────────────────────

export type ProofStatus =
  | "empty"
  | "attached"
  | "uploading"
  | "awaiting"
  | "rejected"
  | "paid";

export function proofStatusCopy(
  status: ProofStatus,
  producerName = "your producer",
): { headline: string; tone: "neutral" | "pending" | "danger" | "success" } {
  switch (status) {
    case "empty":
      return { headline: "Add a screenshot of your transfer", tone: "neutral" };
    case "attached":
      return { headline: "Ready to send for review", tone: "neutral" };
    case "uploading":
      return { headline: "Uploading your proof…", tone: "pending" };
    case "awaiting":
      return { headline: `We sent it to ${producerName}`, tone: "pending" };
    case "rejected":
      return { headline: "Proof needs re-uploading", tone: "danger" };
    case "paid":
      return {
        headline: "Payment complete — sessions unlocked",
        tone: "success",
      };
  }
}

// ── Re-exports so screens import everything from one place ──────────────────

export {
  formatShekels,
  swatchGradient,
  type Producer,
  type PurchaseProduct,
};

// ── Placeholder content (mirrors the prototype's flagship offer) ────────────
// MOCK — BE-2 (SK-38) provides plans + POP upload + Gate 2; swap MOCK_* for the
// tRPC caller in page.tsx, screens unchanged.

export const MOCK_PLAN_OPTIONS: PlanOption[] = planOptions(
  MOCK_PRODUCT.priceCents,
  ["full", "split", "milestones"],
);

export const MOCK_BANK = {
  bank: "Bank Hapoalim",
  branch: "613",
  account: "12-345678",
  bit: "052-000-0000",
};

export const MOCK_PROOFS: { id: string; amountCents: number; status: ProofStatus }[] = [
  { id: "pop-1", amountCents: 120000, status: "awaiting" },
];

// A partial running total — half the flagship offer is paid so far.
export const MOCK_PAID_CENTS = 120000;
export const MOCK_TOTAL_CENTS = MOCK_PRODUCT.priceCents;
