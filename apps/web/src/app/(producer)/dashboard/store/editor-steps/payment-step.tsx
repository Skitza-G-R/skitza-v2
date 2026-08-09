"use client";

import { Minus, Plus } from "lucide-react";

import type { PaymentSelectionDraft } from "../product-editor-draft";

type PricingModel = "flat" | "per_song";

interface PaymentStepProps {
  selection: PaymentSelectionDraft;
  previewTotalCents: number;
  currency: string;
  pricingModel: PricingModel;
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

function splitPaymentPreview(
  totalCents: number,
  currency: string,
): readonly [atAcceptance: string, afterFinalApproval: string] {
  const second = Math.floor(totalCents / 2);
  const first = totalCents - second;

  return [
    `${formatAmount(first, currency)} at acceptance`,
    `${formatAmount(second, currency)} after final approval`,
  ];
}

function paymentPreview(
  kind: "full" | "monthly",
  totalCents: number,
  currency: string,
  installments: number,
): string {
  if (kind === "full") return `${formatAmount(totalCents, currency)} at acceptance`;

  const later = Math.floor(totalCents / installments);
  const first = totalCents - later * (installments - 1);
  return `${formatAmount(first, currency)} at acceptance · then ${formatAmount(later, currency)} monthly`;
}

export function PaymentStep({
  selection,
  previewTotalCents,
  currency,
  pricingModel,
  error,
  onChange,
}: PaymentStepProps) {
  const describedBy = error
    ? "payment-step-error"
    : pricingModel === "per_song"
      ? "payment-step-rate-help"
      : undefined;
  const previewInstallments = Math.max(2, Math.min(12, selection.monthlyInstallments));
  const splitPreview = splitPaymentPreview(previewTotalCents, currency);

  function patch(next: Partial<PaymentSelectionDraft>) {
    onChange({ ...selection, ...next });
  }

  return (
    <div className="flex flex-col gap-4">
      {pricingModel === "per_song" ? (
        <p
          id="payment-step-rate-help"
          className="text-[11.5px] leading-relaxed text-[rgb(var(--fg-faint))]"
        >
          Amounts below use one song at your starting rate. The final schedule follows the
          artist&apos;s song count.
        </p>
      ) : null}

      <fieldset {...(describedBy ? { "aria-describedby": describedBy } : {})}>
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
              <span className="font-display block text-[15px] font-bold text-[rgb(var(--fg-default))]">
                Pay in full
              </span>
              <span className="mt-0.5 block text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
                One payment at agreement acceptance.
              </span>
            </span>
            <span className="col-start-2 mt-1 text-[12px] font-medium text-[rgb(var(--fg-muted))] tabular-nums sm:col-start-3 sm:mt-0 sm:text-right">
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
              <span className="font-display block text-[15px] font-bold text-[rgb(var(--fg-default))]">
                50% / 50%
              </span>
              <span className="mt-1 block text-[12px] leading-snug font-medium text-[rgb(var(--fg-muted))] tabular-nums">
                <span className="block">{splitPreview[0]}</span>
                <span className="block">{splitPreview[1]}</span>
              </span>
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
                <span className="font-display block text-[15px] font-bold text-[rgb(var(--fg-default))]">
                  Monthly installments
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
                  First payment at agreement acceptance, then monthly.
                </span>
              </span>
              <span className="col-start-2 mt-1 text-[12px] font-medium text-[rgb(var(--fg-muted))] tabular-nums sm:col-start-3 sm:mt-0 sm:text-right">
                {paymentPreview("monthly", previewTotalCents, currency, previewInstallments)}
              </span>
            </label>

            {selection.monthly ? (
              <div className="mt-3 ml-9 flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(var(--border-subtle))] pt-3">
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
                        monthlyInstallments: Math.max(2, selection.monthlyInstallments - 1),
                      });
                    }}
                    className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] text-[rgb(var(--fg-default))] hover:bg-[rgb(17_16_9/0.05)] disabled:opacity-30 sm:h-9 sm:w-9 sm:rounded-[var(--radius-md)]"
                  >
                    <Minus size={14} strokeWidth={2.2} aria-hidden />
                  </button>
                  <output
                    aria-live="polite"
                    className="font-display min-w-10 text-center text-[16px] font-bold text-[rgb(var(--fg-default))] tabular-nums"
                  >
                    {selection.monthlyInstallments}
                  </output>
                  <button
                    type="button"
                    aria-label="Increase monthly payments"
                    disabled={selection.monthlyInstallments >= 12}
                    onClick={() => {
                      patch({
                        monthlyInstallments: Math.min(12, selection.monthlyInstallments + 1),
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
