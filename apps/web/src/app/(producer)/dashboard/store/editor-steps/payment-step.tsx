"use client";

import { Minus, Plus } from "lucide-react";

import type { PaymentSelectionDraft } from "../product-editor-draft";

type PricingModel = "flat" | "per_song";

interface PaymentStepProps {
  selection: PaymentSelectionDraft;
  previewTotalCents: number;
  currency: string;
  pricingModel: PricingModel;
  depositModel: string;
  milestones: { label: string; pct: number }[] | null;
  error?: string;
  onChange: (next: PaymentSelectionDraft) => void;
}

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function paymentPreview(
  kind: "full" | "split" | "monthly",
  totalCents: number,
  currency: string,
  installments: number,
): string {
  if (kind === "full") return `${formatAmount(totalCents, currency)} after approval`;
  if (kind === "split") {
    const second = Math.floor(totalCents / 2);
    const first = totalCents - second;
    return `${formatAmount(first, currency)} first · ${formatAmount(second, currency)} on delivery`;
  }

  const later = Math.floor(totalCents / installments);
  const first = totalCents - later * (installments - 1);
  return `${formatAmount(first, currency)} first · then ${formatAmount(later, currency)} monthly`;
}

export function PaymentStep({
  selection,
  previewTotalCents,
  currency,
  pricingModel,
  depositModel,
  milestones,
  error,
  onChange,
}: PaymentStepProps) {
  const preservedMilestones = selection.preservedPlans.find(
    (plan) => plan.kind === "milestones",
  );
  const milestoneRows =
    depositModel === "milestones" && milestones?.length
      ? milestones
      : preservedMilestones?.kind === "milestones"
        ? preservedMilestones.milestones
        : [];
  const describedBy = error
    ? "payment-step-help payment-step-error"
    : "payment-step-help";
  const previewInstallments = Math.max(
    2,
    Math.min(12, selection.monthlyInstallments),
  );

  function patch(next: Partial<PaymentSelectionDraft>) {
    onChange({ ...selection, ...next });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p
          id="payment-step-help"
          className="text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]"
        >
          Choose one or more. The artist picks after approval.
        </p>
        {pricingModel === "per_song" ? (
          <p className="mt-1 text-[11.5px] text-[rgb(var(--fg-faint))]">
            Amounts below use one song at your starting rate. The final schedule follows the artist&apos;s song count.
          </p>
        ) : null}
      </div>

      <fieldset aria-describedby={describedBy}>
        <legend className="sr-only">Payment options offered</legend>
        <div className="divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))]">
          <label
            htmlFor="payment-plan-full"
            className="grid min-h-14 cursor-pointer grid-cols-[24px_minmax(0,1fr)] items-center gap-x-3 py-3 sm:grid-cols-[24px_minmax(0,1fr)_auto]"
          >
            <input
              id="payment-plan-full"
              name="payment-plan-full"
              type="checkbox"
              checked={selection.full}
              aria-describedby={describedBy}
              onChange={(event) => {
                patch({ full: event.target.checked });
              }}
              className="h-5 w-5 accent-[rgb(var(--brand-primary))]"
            />
            <span className="min-w-0">
              <span className="block font-display text-[15px] font-bold text-[rgb(var(--fg-default))]">
                Pay in full
              </span>
              <span className="mt-0.5 block text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
                One payment after approval.
              </span>
            </span>
            <span className="col-start-2 mt-1 text-[12.5px] font-semibold tabular-nums text-[rgb(var(--fg-default))] sm:col-start-3 sm:mt-0 sm:text-right">
              {paymentPreview("full", previewTotalCents, currency, previewInstallments)}
            </span>
          </label>

          <label
            htmlFor="payment-plan-split"
            className="grid min-h-14 cursor-pointer grid-cols-[24px_minmax(0,1fr)] items-center gap-x-3 py-3 sm:grid-cols-[24px_minmax(0,1fr)_auto]"
          >
            <input
              id="payment-plan-split"
              name="payment-plan-split"
              type="checkbox"
              checked={selection.split50}
              aria-describedby={describedBy}
              onChange={(event) => {
                patch({ split50: event.target.checked });
              }}
              className="h-5 w-5 accent-[rgb(var(--brand-primary))]"
            />
            <span className="min-w-0">
              <span className="block font-display text-[15px] font-bold text-[rgb(var(--fg-default))]">
                50% / 50%
              </span>
              <span className="mt-0.5 block text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
                Half after approval. Half on delivery.
              </span>
            </span>
            <span className="col-start-2 mt-1 text-[12.5px] font-semibold tabular-nums text-[rgb(var(--fg-default))] sm:col-start-3 sm:mt-0 sm:text-right">
              {paymentPreview("split", previewTotalCents, currency, previewInstallments)}
            </span>
          </label>

          <div className="py-3">
            <label
              htmlFor="payment-plan-monthly"
              className="grid min-h-14 cursor-pointer grid-cols-[24px_minmax(0,1fr)] items-center gap-x-3 sm:grid-cols-[24px_minmax(0,1fr)_auto]"
            >
              <input
                id="payment-plan-monthly"
                name="payment-plan-monthly"
                type="checkbox"
                checked={selection.monthly}
                aria-describedby={describedBy}
                onChange={(event) => {
                  patch({ monthly: event.target.checked });
                }}
                className="h-5 w-5 accent-[rgb(var(--brand-primary))]"
              />
              <span className="min-w-0">
                <span className="block font-display text-[15px] font-bold text-[rgb(var(--fg-default))]">
                  Monthly installments
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
                  One schedule with 2–12 total payments.
                </span>
              </span>
              <span className="col-start-2 mt-1 text-[12.5px] font-semibold tabular-nums text-[rgb(var(--fg-default))] sm:col-start-3 sm:mt-0 sm:text-right">
                {paymentPreview(
                  "monthly",
                  previewTotalCents,
                  currency,
                  previewInstallments,
                )}
              </span>
            </label>

            {selection.monthly ? (
              <div className="ml-9 mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(var(--border-subtle))] pt-3">
                <span className="text-[12.5px] font-medium text-[rgb(var(--fg-muted))]">
                  Total payments
                </span>
                <div
                  className="inline-flex items-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] sm:rounded-[var(--radius-md)]"
                  role="group"
                  aria-label="Monthly payments count"
                >
                  <button
                    type="button"
                    aria-label="Decrease monthly payments"
                    disabled={selection.monthlyInstallments <= 2}
                    onClick={() => {
                      patch({
                        monthlyInstallments: Math.max(
                          2,
                          selection.monthlyInstallments - 1,
                        ),
                      });
                    }}
                    className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] text-[rgb(var(--fg-default))] hover:bg-[rgb(17_16_9/0.05)] disabled:opacity-30 sm:h-9 sm:w-9 sm:rounded-[var(--radius-md)]"
                  >
                    <Minus size={14} strokeWidth={2.2} aria-hidden />
                  </button>
                  <output
                    aria-live="polite"
                    className="min-w-10 text-center font-display text-[16px] font-bold tabular-nums text-[rgb(var(--fg-default))]"
                  >
                    {selection.monthlyInstallments}
                  </output>
                  <button
                    type="button"
                    aria-label="Increase monthly payments"
                    disabled={selection.monthlyInstallments >= 12}
                    onClick={() => {
                      patch({
                        monthlyInstallments: Math.min(
                          12,
                          selection.monthlyInstallments + 1,
                        ),
                      });
                    }}
                    className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] text-[rgb(var(--fg-default))] hover:bg-[rgb(17_16_9/0.05)] disabled:opacity-30 sm:h-9 sm:w-9 sm:rounded-[var(--radius-md)]"
                  >
                    <Plus size={14} strokeWidth={2.2} aria-hidden />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </fieldset>

      {milestoneRows.length > 0 ? (
        <section
          aria-label="Existing milestone schedule"
          className="border-t border-[rgb(var(--border-subtle))] pt-4"
        >
          <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            Existing milestone schedule
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[rgb(var(--fg-faint))]">
            Kept unchanged alongside the options above.
          </p>
          <ul className="mt-2 divide-y divide-[rgb(var(--border-subtle))] text-[12.5px]">
            {milestoneRows.map((milestone) => (
              <li
                key={`${milestone.label}-${String(milestone.pct)}`}
                className="flex min-h-10 items-center justify-between gap-3"
              >
                <span className="text-[rgb(var(--fg-default))]">{milestone.label}</span>
                <span className="font-semibold tabular-nums text-[rgb(var(--fg-muted))]">
                  {milestone.pct}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? (
        <p
          id="payment-step-error"
          role="alert"
          className="text-[12.5px] font-medium text-[rgb(var(--fg-danger))]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
