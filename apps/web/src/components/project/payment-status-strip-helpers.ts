// Pure helpers for <PaymentStatusStrip/>. Extracted from the component
// so the status-text + dot-string logic can be exhaustively unit-tested
// without pulling in React Testing Library (which isn't installed in
// this app — see vitest.config.ts `environment: 'node'` and the
// repo-wide pattern of testing pure helpers in sibling `.test.ts`).

export type PaymentPlanKind = "full" | "split_50_50" | "monthly";

export type Stage =
  | "lead"
  | "booked"
  | "contract_sent"
  | "in_production"
  | "final_review"
  | "paid"
  | "archived"
  | "payment_paused"
  | "cancelled";

// Minor units → currency string. Matches plan-picker-helpers pattern:
// minimumFractionDigits: 0 so round totals render clean ($10,000),
// maximumFractionDigits: 2 so odd-cent totals keep their pennies
// ($10,000.50). Returns whatever Intl produces — an unknown currency
// code falls back to the code itself prefixed, which is acceptable.
export function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

// "May 18" style short date. "Today" when the date is today; "Overdue"
// when the date is in the past. The caller (only called for monthly
// plans) makes sure the date is present before invoking this.
//
// `now` is injected so tests can pin a deterministic clock without
// reaching for vi.useFakeTimers(); in prod the default `new Date()` is
// fine because the "Today" / "Overdue" boundary is day-level, not
// second-level.
export function formatNextCharge(date: Date, now: Date = new Date()): string {
  const d = new Date(date);
  // Same-day compare using local calendar day so 11pm → midnight
  // doesn't bump into "Overdue" prematurely.
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return "Today";
  if (d.getTime() < now.getTime()) return "Overdue";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(d);
}

// "●●○○" / "●●⚠○" dot string. Given `total` slots:
//  - indices < completed  → ● filled
//  - first pending index when paused → ⚠ warning
//  - everything else      → ○ empty
//
// Returned as a single string — React renders it verbatim inside a
// <span> so the unicode dots hit the font directly, no icon lib.
export function computeDots(
  completed: number,
  total: number,
  paused: boolean,
): string {
  if (total <= 0) return "";
  const clampedCompleted = Math.max(0, Math.min(completed, total));
  let out = "";
  for (let i = 0; i < total; i += 1) {
    if (i < clampedCompleted) {
      out += "●";
    } else if (paused && i === clampedCompleted) {
      // First pending slot gets the warning marker when paused.
      out += "⚠";
    } else {
      out += "○";
    }
  }
  return out;
}

// Inputs to the status-text builder. Mirrors the component's props but
// stripped down to the fields actually used — keeps the helper focused
// and the tests readable.
export type StatusInput = {
  paymentPlanKind: PaymentPlanKind;
  installments: number | null;
  chargesCompleted: number;
  chargesTotal: number;
  totalAmountCents: number;
  currency: string;
  nextChargeAt: Date | null;
  stage: Stage;
  now?: Date; // test-injection seam for "Today" / "Overdue" / short-date
};

// The building blocks for the rendered strip. The React component
// wires these fragments into spans with the right design-token colors;
// keeping them as a struct means tests don't have to parse the final
// JSX to assert each segment.
export type StatusOutput = {
  /** "$10,000" — the project total. Always present. */
  amount: string;
  /** Plan shape label, e.g. "4 monthly × $2,500" or "50/50" or "Paid in full". */
  planLabel: string;
  /** Dots string for 50/50 + monthly; empty string for "full". */
  dots: string;
  /** "2/4 paid" / null when the progress count doesn't apply (full plan, finished 50/50). */
  progress: string | null;
  /** Trailing hint: "Next: May 18", "Awaiting final delivery", "Payment paused — ...", "Cancelled", "Paid in full ✓". */
  hint: string | null;
  /** True when the plan has fully settled — the strip can render a checkmark. */
  fullyPaid: boolean;
  /** True when stage is payment_paused — caller uses this to pick accent color. */
  paused: boolean;
  /** True when stage is cancelled — caller dims / greys out. */
  cancelled: boolean;
};

// Builds the renderable struct for a given plan + progress + stage
// combination. Pure — no React, no formatters beyond Intl — which is
// why tests can pin every permutation listed in the Task 8 spec.
export function buildStatus(input: StatusInput): StatusOutput {
  const {
    paymentPlanKind,
    installments,
    chargesCompleted,
    chargesTotal,
    totalAmountCents,
    currency,
    nextChargeAt,
    stage,
  } = input;

  const amount = formatAmount(totalAmountCents, currency);
  const paused = stage === "payment_paused";
  const cancelled = stage === "cancelled";
  const fullyPaidShape = chargesCompleted >= chargesTotal && chargesTotal > 0;

  // ─── Pay in full ────────────────────────────────────────────────────
  if (paymentPlanKind === "full") {
    if (cancelled) {
      return {
        amount,
        planLabel: "Paid in full",
        dots: "",
        progress: null,
        hint: "Cancelled",
        fullyPaid: false,
        paused: false,
        cancelled: true,
      };
    }
    if (fullyPaidShape) {
      return {
        amount,
        planLabel: "Paid in full",
        dots: "",
        progress: null,
        hint: null, // "Paid in full ✓" is the planLabel + the component's ✓ glyph
        fullyPaid: true,
        paused: false,
        cancelled: false,
      };
    }
    return {
      amount,
      planLabel: "Payment pending…",
      dots: "",
      progress: null,
      hint: null,
      fullyPaid: false,
      paused: false,
      cancelled: false,
    };
  }

  // ─── 50/50 ──────────────────────────────────────────────────────────
  if (paymentPlanKind === "split_50_50") {
    const dots = computeDots(chargesCompleted, 2, paused);
    if (cancelled) {
      return {
        amount,
        planLabel: "50/50",
        dots,
        progress: `${String(chargesCompleted)}/2 paid`,
        hint: "Cancelled",
        fullyPaid: false,
        paused: false,
        cancelled: true,
      };
    }
    if (fullyPaidShape) {
      return {
        amount,
        planLabel: "50/50",
        dots,
        progress: null,
        hint: null, // component appends the ✓
        fullyPaid: true,
        paused: false,
        cancelled: false,
      };
    }
    if (paused) {
      return {
        amount,
        planLabel: "50/50",
        dots,
        progress: `${String(chargesCompleted)}/2 paid`,
        hint: "Payment paused — client needs to update card",
        fullyPaid: false,
        paused: true,
        cancelled: false,
      };
    }
    // Deposit paid, awaiting final delivery — the copy used in the
    // task spec. Works whether chargesCompleted is 0 or 1; the
    // progress counter keeps it unambiguous.
    return {
      amount,
      planLabel: "50/50",
      dots,
      progress: `${String(chargesCompleted)}/2 paid`,
      hint:
        chargesCompleted >= 1
          ? "Awaiting final delivery"
          : null,
      fullyPaid: false,
      paused: false,
      cancelled: false,
    };
  }

  // ─── Monthly ────────────────────────────────────────────────────────
  // paymentPlanKind === "monthly"
  // Prefer `installments` (the producer's pick at checkout); fall back
  // to chargesTotal which the webhook populates from Stripe. Both
  // should agree in steady state; installments is the more reliable
  // source pre-webhook.
  const total = installments ?? chargesTotal;
  const dots = computeDots(chargesCompleted, total, paused);

  // Per-installment amount matches calculateCharges: base on N, with
  // any odd-cent remainder riding on the first charge. For the strip
  // we display the base (the steady-state monthly rate) since that's
  // what the client will see most months. 1/N wouldn't be wrong but
  // it doesn't match the conversational "× $2,500" in the spec.
  const perChargeCents =
    total > 0 ? Math.floor(totalAmountCents / total) : 0;
  const perChargeLabel =
    total > 0 ? ` × ${formatAmount(perChargeCents, currency)}` : "";
  // Base label: "4 monthly × $2,500". When all charges landed we drop
  // the "× $2,500" suffix since the per-month rate isn't actionable
  // anymore — the engagement is done.
  const monthlyLabel = fullyPaidShape
    ? `${String(total)} monthly`
    : `${String(total)} monthly${perChargeLabel}`;

  if (cancelled) {
    return {
      amount,
      planLabel: monthlyLabel,
      dots,
      progress: `${String(chargesCompleted)}/${String(total)} paid`,
      hint: "Cancelled",
      fullyPaid: false,
      paused: false,
      cancelled: true,
    };
  }
  if (fullyPaidShape) {
    return {
      amount,
      planLabel: monthlyLabel,
      dots,
      progress: null,
      hint: null, // Component appends the ✓
      fullyPaid: true,
      paused: false,
      cancelled: false,
    };
  }
  if (paused) {
    return {
      amount,
      planLabel: monthlyLabel,
      dots,
      progress: `${String(chargesCompleted)}/${String(total)} paid`,
      hint: "Payment paused — client needs to update card",
      fullyPaid: false,
      paused: true,
      cancelled: false,
    };
  }
  // Normal pending monthly — show "Next: May 18" when the schedule
  // populated nextChargeAt. Missing date (fresh plan before Stripe's
  // webhook fills it) degrades to just the progress count.
  const hint = nextChargeAt
    ? `Next: ${formatNextCharge(nextChargeAt, input.now)}`
    : null;
  return {
    amount,
    planLabel: monthlyLabel,
    dots,
    progress: `${String(chargesCompleted)}/${String(total)} paid`,
    hint,
    fullyPaid: false,
    paused: false,
    cancelled: false,
  };
}
