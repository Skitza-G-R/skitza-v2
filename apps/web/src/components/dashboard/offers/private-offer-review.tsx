"use client";

import type { PurchaseCommercialSnapshot } from "@skitza/db";
import { useId, useMemo } from "react";

import { PrivateOfferTerms } from "~/components/artist/offers/private-offer-terms";

export type PrivateOfferReviewEditStep =
  | "recipient"
  | "details"
  | "price"
  | "payment"
  | "delivery"
  | "rights";

interface PrivateOfferReviewProps {
  snapshot: PurchaseCommercialSnapshot;
  targetLabel: string;
  recipientName: string;
  recipientEmail: string;
  expiresAtLocal: string;
  onExpiresAtLocalChange: (value: string) => void;
  onEdit?: (step: PrivateOfferReviewEditStep) => void;
  sourceTemplateName?: string | null;
}

const EDIT_SECTIONS: readonly Readonly<{
  step: PrivateOfferReviewEditStep;
  label: string;
}>[] = [
  { step: "recipient", label: "Recipient & project" },
  { step: "details", label: "Details" },
  { step: "price", label: "Price" },
  { step: "payment", label: "Payment" },
  { step: "delivery", label: "Delivery" },
  { step: "rights", label: "Rights & agreement" },
];

/** Producer-side review of the exact snapshot the artist will receive. */
export function PrivateOfferReview({
  snapshot,
  targetLabel,
  recipientName,
  recipientEmail,
  expiresAtLocal,
  onExpiresAtLocalChange,
  onEdit,
  sourceTemplateName,
}: PrivateOfferReviewProps) {
  const expiryId = `${useId()}-private-offer-expiry`;
  const expiryMinimum = useMemo(() => {
    const now = new Date();
    const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    return localNow.toISOString().slice(0, 16);
  }, []);
  const expiryInvalid =
    !expiresAtLocal ||
    Number.isNaN(new Date(expiresAtLocal).getTime()) ||
    new Date(expiresAtLocal).getTime() <= Date.now();

  return (
    <div className="min-w-0 space-y-5">
      <div className="min-w-0">
        <h2 className="font-syne text-[18px] leading-tight font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))] sm:text-[20px]">
          Review the exact offer
        </h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-pretty text-[rgb(var(--fg-muted))]">
          Check who will receive it, when it expires, and every term they will agree to.
        </p>
      </div>

      {sourceTemplateName ? (
        <aside
          aria-label="Product template source"
          className="min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.28)] bg-[rgb(var(--brand-primary)/0.07)] px-4 py-3"
        >
          <p className="font-mono text-[9.5px] font-semibold tracking-[0.14em] text-[rgb(var(--brand-primary-dark))] uppercase">
            Based on a Store product
          </p>
          <p className="mt-1 min-w-0 text-[13px] leading-relaxed [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
            <strong className="font-bold text-[rgb(var(--fg-default))]">
              {sourceTemplateName}
            </strong>{" "}
            supplied these terms. Changes apply only to this private offer.
          </p>
        </aside>
      ) : null}

      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.72fr)]">
        <section
          aria-labelledby={`${expiryId}-recipient-heading`}
          className="min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-4"
        >
          <h3
            id={`${expiryId}-recipient-heading`}
            className="font-mono text-[9.5px] font-semibold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase"
          >
            Recipient & project
          </h3>
          <dl className="mt-3 min-w-0 space-y-3">
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold text-[rgb(var(--fg-muted))]">Artist</dt>
              <dd className="mt-0.5 min-w-0">
                <p className="text-[13px] font-bold [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))]">
                  {recipientName}
                </p>
                <p className="mt-0.5 text-[12px] [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-muted))]">
                  {recipientEmail}
                </p>
              </dd>
            </div>
            <div className="min-w-0 border-t border-[rgb(var(--border-subtle))] pt-3">
              <dt className="text-[11px] font-semibold text-[rgb(var(--fg-muted))]">
                Project after acceptance
              </dt>
              <dd className="mt-0.5 text-[13px] font-bold [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))]">
                {targetLabel}
              </dd>
            </div>
          </dl>
        </section>

        <section
          aria-labelledby={`${expiryId}-expiry-heading`}
          className="min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-4"
        >
          <h3
            id={`${expiryId}-expiry-heading`}
            className="font-mono text-[9.5px] font-semibold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase"
          >
            Availability
          </h3>
          <label
            htmlFor={expiryId}
            className="mt-3 block text-[11px] font-semibold text-[rgb(var(--fg-secondary))]"
          >
            Offer expires
          </label>
          <input
            id={expiryId}
            type="datetime-local"
            value={expiresAtLocal}
            min={expiryMinimum}
            required
            aria-invalid={expiryInvalid}
            aria-describedby={`${expiryId}-help${expiryInvalid ? ` ${expiryId}-error` : ""}`}
            onChange={(event) => {
              onExpiresAtLocalChange(event.currentTarget.value);
            }}
            className="mt-1.5 h-11 w-full min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-background))] px-3 text-[13px] text-[rgb(var(--fg-default))] transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
          />
          <p
            id={`${expiryId}-help`}
            className="mt-2 text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]"
          >
            The artist can review and accept until this date and time.
          </p>
          {expiryInvalid ? (
            <p
              id={`${expiryId}-error`}
              role="alert"
              className="mt-1.5 text-[11.5px] font-medium text-[rgb(var(--fg-danger))]"
            >
              Choose a future expiry date and time.
            </p>
          ) : null}
        </section>
      </div>

      {onEdit ? (
        <nav
          aria-label="Edit private offer sections"
          className="min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3"
        >
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="shrink-0 text-[12px] font-semibold text-[rgb(var(--fg-secondary))]">
              Need to change something?
            </p>
            <div className="flex min-w-0 flex-wrap gap-1">
              {EDIT_SECTIONS.map(({ step, label }) => (
                <button
                  key={step}
                  type="button"
                  aria-label={`Edit ${label.toLowerCase()}`}
                  onClick={() => {
                    onEdit(step);
                  }}
                  className="sk-press inline-flex min-h-10 items-center rounded-[var(--radius-lg)] px-2.5 text-[11.5px] font-semibold text-[rgb(var(--brand-primary-dark))] transition-colors hover:bg-[rgb(var(--brand-primary)/0.09)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.28)] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </nav>
      ) : null}

      <section aria-labelledby={`${expiryId}-terms-heading`} className="min-w-0">
        <div className="mb-3 min-w-0 border-b border-[rgb(var(--border-subtle))] pb-3">
          <h3
            id={`${expiryId}-terms-heading`}
            className="font-syne text-[16px] font-extrabold tracking-[-0.015em] text-[rgb(var(--fg-default))]"
          >
            Terms the artist will see
          </h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
            This is the exact commercial snapshot that will be attached to the offer.
          </p>
        </div>
        <PrivateOfferTerms snapshot={snapshot} targetLabel={targetLabel} embedded />
      </section>
    </div>
  );
}
