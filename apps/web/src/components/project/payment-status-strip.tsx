// Compact single-line payment-plan status for the project room. The
// producer opens a project and immediately sees: total amount, plan
// shape (full / 50/50 / 4-monthly), progress dots, and either the
// next-charge date (monthly) or a completion hint.
//
// Logic lives in payment-status-strip-helpers.ts so it's
// Node-testable under vitest without pulling in RTL. This file is
// just the JSX shell that reads the derived struct and renders it
// with the project-view design tokens.

import {
  buildStatus,
  type PaymentPlanKind,
  type Stage,
} from "./payment-status-strip-helpers";

export type PaymentStatusStripProps = {
  paymentPlanKind: PaymentPlanKind | null;
  installments: number | null;
  chargesCompleted: number;
  chargesTotal: number | null;
  totalAmountCents: number | null;
  currency: string;
  nextChargeAt: Date | null;
  stage: Stage;
};

// Known plan kinds. The server writes one of these three strings but
// the project row types it as `string | null`, so we narrow here
// before handing off to the helper (which is strictly typed).
function isKnownKind(k: string | null): k is PaymentPlanKind {
  return k === "full" || k === "split_50_50" || k === "monthly";
}

export function PaymentStatusStrip(props: PaymentStatusStripProps) {
  const {
    paymentPlanKind,
    installments,
    chargesCompleted,
    chargesTotal,
    totalAmountCents,
    currency,
    nextChargeAt,
    stage,
  } = props;

  // Legacy rows (pre-auto-installments) or trial bookings render
  // nothing — there's no plan to strip-visualize.
  if (!isKnownKind(paymentPlanKind)) return null;
  if (totalAmountCents === null) return null;

  // chargesTotal is null on freshly-seeded rows until the webhook
  // fills it. Derive sensibly: 1 for full, 2 for 50/50, installments
  // for monthly. If monthly + no installments recorded either, bail —
  // we have no way to render the dots.
  let effectiveChargesTotal: number;
  if (chargesTotal !== null) {
    effectiveChargesTotal = chargesTotal;
  } else if (paymentPlanKind === "full") {
    effectiveChargesTotal = 1;
  } else if (paymentPlanKind === "split_50_50") {
    effectiveChargesTotal = 2;
  } else {
    // monthly — fall back to installments
    if (installments === null) return null;
    effectiveChargesTotal = installments;
  }

  const status = buildStatus({
    paymentPlanKind,
    installments,
    chargesCompleted,
    chargesTotal: effectiveChargesTotal,
    totalAmountCents,
    currency,
    nextChargeAt,
    stage,
  });

  // Hint color token: paused → warning, cancelled → muted/strikethrough,
  // otherwise → secondary. Kept inline so the helper stays pure.
  const hintClass = status.paused
    ? "text-[rgb(var(--fg-warning,var(--fg-primary)))]"
    : status.cancelled
      ? "text-[rgb(var(--fg-muted))]"
      : "text-[rgb(var(--fg-secondary))]";

  return (
    <div
      aria-label="Payment plan status"
      className={[
        "mt-4 flex flex-wrap items-center gap-x-3 gap-y-1",
        "rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))]",
        "bg-[rgb(var(--bg-sunken))] px-3 py-2",
        "font-mono text-[0.75rem]",
        status.cancelled ? "opacity-70" : "",
      ].join(" ")}
    >
      {/* Total — the anchor. Always readable, top of hierarchy. */}
      <span className="font-semibold text-[rgb(var(--fg-primary))]">
        {status.amount}
      </span>
      <span aria-hidden="true" className="text-[rgb(var(--fg-muted))]">
        ·
      </span>
      {/* Plan shape label. Paused state nudges the text toward the
          warning token so the whole strip reads "attention needed". */}
      <span
        className={
          status.paused
            ? "text-[rgb(var(--fg-warning,var(--fg-primary)))]"
            : "text-[rgb(var(--fg-primary))]"
        }
      >
        {status.planLabel}
      </span>

      {/* Fully-paid checkmark sits right after the plan label for
          full / 50/50 / monthly complete — matches the spec's copy. */}
      {status.fullyPaid ? (
        <span
          aria-label="paid in full"
          className="text-[rgb(var(--fg-primary))]"
        >
          {status.planLabel === "Paid in full" ? "✓" : "Paid in full ✓"}
        </span>
      ) : null}

      {status.dots ? (
        <span
          aria-label="charges"
          className={[
            "tracking-[0.18em] text-[0.85rem]",
            status.paused
              ? "text-[rgb(var(--fg-warning,var(--fg-primary)))]"
              : "text-[rgb(var(--fg-primary))]",
          ].join(" ")}
        >
          {status.dots}
        </span>
      ) : null}

      {status.progress ? (
        <span className="text-[rgb(var(--fg-secondary))]">
          {status.progress}
        </span>
      ) : null}

      {status.hint ? (
        <>
          <span aria-hidden="true" className="text-[rgb(var(--fg-muted))]">
            ·
          </span>
          <span className={hintClass}>{status.hint}</span>
        </>
      ) : null}
    </div>
  );
}
