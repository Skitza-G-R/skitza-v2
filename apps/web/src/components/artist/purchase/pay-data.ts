// Shared types, display helpers, and development-gallery data for artist Pay.
//
// Payment in v1 is OFF-APP: after a producer approves the booking, the artist
// pays by bank transfer or Bit, then uploads a proof-of-payment screenshot.
//
// The live Pay routes read frozen request data. The two MOCK identity exports
// below remain only for the development gallery and later session prototypes.

import {
  formatShekels,
  swatchGradient,
  type Producer,
  type PurchaseProduct,
} from "./purchase-data";

// ── Placeholder product + producer (BE-2 / BE-3 era) ────────────────────────
// Live purchase routes never read these placeholders. They remain only for
// the dev screen gallery and sessions pages that are still under construction.
export const MOCK_PRODUCER: Producer = {
  name: "Gili Studio",
  initials: "GS",
  hue: 30,
  agreement: {
    filename: "Booking_Agreement.pdf",
    url: "https://example.com/Booking_Agreement.pdf",
    kind: "pdf",
  },
};

export const MOCK_PRODUCT: PurchaseProduct = {
  id: "g1",
  name: "Single — start to finish",
  priceCents: 240000,
  currency: "ILS",
  durationLabel: "Multi-session · 3–4 weeks",
  tagline: "Track, comp, mix & master one song.",
  sessions: 3,
  revisions: 2,
  paymentPlans: [{ kind: "full" }, { kind: "split_50_50" }],
  royaltyTerms: {
    master: { mode: "percentage", bps: 250 },
    composition: {
      mode: "percentage",
      bps: 1250,
      role: "composer",
      collectingSociety: "ACUM",
    },
  },
  agreementText:
    "Producer credit must appear in release metadata. Final files unlock after full payment.",
  includes: [
    "Up to 4 song parts tracked",
    "Comped & tuned lead vocal",
    "Full mix + master",
    "2 revision rounds",
    "WAV stems + masters delivered",
  ],
};

// ── Payment plans ─────────────────────────────────────────────────────────

export type LivePaymentPlanChoice =
  | { kind: "full" }
  | { kind: "split_50_50" }
  | { kind: "monthly"; installments: number };

export type LivePlanOption = {
  id: string;
  choice: LivePaymentPlanChoice;
  title: string;
  blurb: string;
  dueNowCents: number;
  schedule: { label: string; amountCents: number }[];
};

export function nextPlanIndex(
  currentIndex: number,
  optionCount: number,
  key: string,
): number | null {
  if (optionCount <= 0) return null;

  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return (currentIndex + 1) % optionCount;
    case "ArrowUp":
    case "ArrowLeft":
      return (currentIndex - 1 + optionCount) % optionCount;
    case "Home":
      return 0;
    case "End":
      return optionCount - 1;
    default:
      return null;
  }
}

type ServerPlanOption = {
  kind: LivePaymentPlanChoice["kind"];
  installments?: number;
  charges: number[];
  dueNowCents: number;
  labels: string[];
};

export function paymentPlanLabel(
  kind: LivePaymentPlanChoice["kind"],
  installments?: number | null,
): string {
  switch (kind) {
    case "full":
      return "Pay in full";
    case "split_50_50":
      return "Split 50 / 50";
    case "monthly":
      return `${String(installments ?? 2)} monthly payments`;
  }
}

export function livePlanOptions(options: ServerPlanOption[]): LivePlanOption[] {
  return options.map((option) => {
    const installments = option.kind === "monthly" ? (option.installments ?? 2) : null;
    const choice: LivePaymentPlanChoice =
      option.kind === "monthly"
        ? { kind: "monthly", installments: installments ?? 2 }
        : { kind: option.kind };
    const blurb =
      option.kind === "full"
        ? "One payment now. Simplest, with nothing left to track."
        : option.kind === "split_50_50"
          ? "Half secures your slot, and the rest is due on delivery."
          : `Spread the total across ${String(installments)} clear monthly payments.`;
    return {
      id: option.kind === "monthly" ? `monthly-${String(installments)}` : option.kind,
      choice,
      title: paymentPlanLabel(option.kind, installments),
      blurb,
      dueNowCents: option.dueNowCents,
      schedule: option.charges.map((amountCents, index) => ({
        label: option.labels[index] ?? `Payment ${String(index + 1)}`,
        amountCents,
      })),
    };
  });
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
    totalCents <= 0 ? 100 : Math.min(100, Math.max(0, Math.round((paidCents / totalCents) * 100)));
  return {
    paidLabel: formatShekels(paidCents),
    totalLabel: formatShekels(totalCents),
    remainingCents,
    pct,
    isPaidInFull: paidCents >= totalCents,
  };
}

// ── Proof-of-payment status ─────────────────────────────────────────────────

export type ProofStatus = "empty" | "attached" | "uploading" | "awaiting" | "rejected" | "paid";

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

export { formatShekels, swatchGradient, type Producer, type PurchaseProduct };
