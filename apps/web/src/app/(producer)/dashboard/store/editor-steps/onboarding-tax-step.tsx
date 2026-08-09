"use client";

import { applyTaxToCents, type TaxMode } from "~/lib/tax-mode";

const OPTIONS: readonly {
  id: TaxMode;
  title: string;
  description: string;
}[] = [
  {
    id: "tax_free",
    title: "Tax-free",
    description: "No tax line is shown. The artist pays your listed price.",
  },
  {
    id: "tax_included",
    title: "Tax included",
    description: "Your listed price already includes tax. The artist pays that exact price.",
  },
  {
    id: "tax_added",
    title: "Tax added",
    description: "Your listed price is before tax. Tax is added to the artist's total.",
  },
];

function formatSample(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function OnboardingTaxStep({
  value,
  taxRatePct,
  currency,
  error,
  onChange,
}: {
  value: TaxMode | null;
  taxRatePct: number;
  currency: string;
  error?: string | null;
  onChange: (patch: { taxMode?: TaxMode; taxRatePct?: number }) => void;
}) {
  const listedCents = 10_000;
  return (
    <div className="flex flex-col gap-4">
      <fieldset
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        aria-describedby="tax-choice-help"
      >
        <legend className="sr-only">Choose how tax works for every product</legend>
        {OPTIONS.map((option) => {
          const selected = value === option.id;
          const artistPays = applyTaxToCents(listedCents, option.id, taxRatePct);
          return (
            <label
              key={option.id}
              className={[
                "flex min-h-[154px] cursor-pointer flex-col rounded-[var(--radius-lg)] border p-4 transition-colors",
                selected
                  ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.08)]"
                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]",
              ].join(" ")}
            >
              <span className="flex items-center gap-2.5">
                <input
                  type="radio"
                  name="onboarding-tax-mode"
                  value={option.id}
                  checked={selected}
                  onChange={() => {
                    onChange({ taxMode: option.id });
                  }}
                  className="h-4 w-4 accent-[rgb(var(--brand-primary))]"
                />
                <span className="text-[14px] font-bold text-[rgb(var(--fg-default))]">
                  {option.title}
                </span>
              </span>
              <span className="mt-2 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
                {option.description}
              </span>
              <span className="mt-auto pt-3 text-[11.5px] font-semibold text-[rgb(var(--fg-default))]">
                List {formatSample(listedCents, currency)} · Artist pays{" "}
                {formatSample(artistPays, currency)}
              </span>
            </label>
          );
        })}
      </fieldset>

      <p id="tax-choice-help" className="text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
        This is one studio-wide setting. You can change it later in Settings.
      </p>

      {value === "tax_included" || value === "tax_added" ? (
        <div className="max-w-[240px]">
          <label
            htmlFor="onboarding-tax-rate"
            className="text-[10.5px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase"
          >
            Tax rate
          </label>
          <div className="mt-2 flex h-11 items-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 focus-within:border-[rgb(var(--brand-primary))] sm:rounded-[var(--radius-md)]">
            <input
              id="onboarding-tax-rate"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              value={taxRatePct}
              onChange={(event) => {
                onChange({ taxRatePct: Number(event.target.value) });
              }}
              className="min-w-0 flex-1 bg-transparent text-base text-[rgb(var(--fg-default))] outline-none sm:text-[14px]"
            />
            <span className="text-[13px] font-semibold text-[rgb(var(--fg-muted))]">%</span>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-[12px] font-medium text-[rgb(var(--fg-danger))]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
