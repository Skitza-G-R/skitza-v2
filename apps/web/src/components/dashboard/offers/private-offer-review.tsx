"use client";

import type { PurchaseCommercialSnapshot } from "@skitza/db";
import { Check, ExternalLink, FileText } from "lucide-react";
import { useId, useMemo } from "react";

import { kindToTile } from "~/app/(producer)/dashboard/store/kind-to-tile";
import { TILE_THEME } from "~/app/(producer)/dashboard/store/tile-theme";
import { TypeTile } from "~/app/(producer)/dashboard/store/type-tile";
import { PrivateOfferTerms } from "~/components/artist/offers/private-offer-terms";
import { formatPurchaseMoney } from "~/components/artist/purchase/purchase-data";
import { agreementPdfFromCommercialSnapshot } from "~/lib/agreement-pdf";
import { royaltyTermsDisplay } from "~/lib/purchase/royalty-terms";

import type { PrivateOfferDraftField } from "./private-offer-editor-model";

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
  invalidField: PrivateOfferDraftField | null;
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
  invalidField,
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
            data-private-offer-field="expiresAtLocal"
            type="datetime-local"
            value={expiresAtLocal}
            min={expiryMinimum}
            required
            aria-invalid={expiryInvalid || invalidField === "expiresAtLocal"}
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

function paymentPlanLabel(plan: PurchaseCommercialSnapshot["offeredPaymentPlans"][number]): string {
  if (plan.kind === "full") return "Pay in full";
  if (plan.kind === "split_50_50") return "50 / 50";
  return `${String(plan.installments)} monthly payments`;
}

function CompactSection({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 rounded-[14px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 shadow-[0_12px_30px_-24px_rgba(17,16,9,0.28)] ${className}`}
    >
      <h3 className="font-mono text-[9.5px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
        {title}
      </h3>
      <div className="mt-3 text-[12.5px] leading-relaxed text-[rgb(var(--fg-secondary))]">
        {children}
      </div>
    </section>
  );
}

export function ProductPrivateOfferReview({
  snapshot,
  targetLabel,
  recipientName,
  recipientEmail,
  expiresAtLocal,
  sourceTemplateName,
  sourceTemplateKind,
  agreementHref,
  agreementPdfPreview,
}: {
  snapshot: PurchaseCommercialSnapshot;
  targetLabel: string;
  recipientName: string;
  recipientEmail: string;
  expiresAtLocal: string;
  sourceTemplateName: string;
  sourceTemplateKind: string;
  agreementHref?: string;
  agreementPdfPreview?: Readonly<{
    documentId: string | null;
    originalFileName: string;
    sizeBytes: number;
  }> | null;
}) {
  const royalty = royaltyTermsDisplay(snapshot.royaltyTerms);
  const frozenAgreementPdf = agreementPdfFromCommercialSnapshot(snapshot);
  const agreementPdf = frozenAgreementPdf ?? agreementPdfPreview ?? null;
  const agreementMode =
    snapshot.agreementMode ?? (agreementPdf ? "pdf" : snapshot.agreementText ? "text" : "none");
  const expiry = new Date(expiresAtLocal);
  const expiryLabel = Number.isNaN(expiry.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(expiry);
  const session = snapshot.session;
  const revision = snapshot.revisionRule;
  const tile = kindToTile(sourceTemplateKind);
  const accent = TILE_THEME[tile].accent;

  return (
    <div className="min-w-0 space-y-4">
      <aside className="min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-3.5 py-3">
        <p className="min-w-0 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
          <span className="mr-2 font-mono text-[9.5px] font-bold tracking-[0.14em] uppercase">
            To:
          </span>{" "}
          <span className="font-bold text-[rgb(var(--fg-default))]">{recipientName}</span> ·{" "}
          <span className="break-all">{recipientEmail}</span>
        </p>
      </aside>

      <article className="relative grid min-w-0 grid-cols-[60px_minmax(0,1fr)] items-center gap-x-3 gap-y-3 overflow-hidden rounded-[14px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5 shadow-[0_16px_36px_-26px_rgba(17,16,9,0.42),0_2px_8px_-5px_rgba(17,16,9,0.08)] sm:grid-cols-[60px_minmax(0,1fr)_auto]">
        <span
          aria-hidden
          className="pointer-events-none absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full"
          style={{ background: accent }}
        />
        <TypeTile type={tile} />
        <div className="min-w-0">
          <p className="font-display line-clamp-2 text-[17px] leading-tight font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))] sm:text-[18px]">
            {snapshot.productOrOfferName}
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
            Private offer based on {sourceTemplateName}
          </p>
        </div>
        <div className="col-span-2 flex items-end justify-between gap-3 border-t border-[rgb(var(--border-subtle))] pt-3 sm:col-auto sm:block sm:border-t-0 sm:pt-0 sm:text-right">
          <p className="font-mono text-[9px] font-bold tracking-[0.13em] text-[rgb(var(--fg-muted))] uppercase">
            Client pays
          </p>
          <p className="font-display text-[24px] leading-none font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))] tabular-nums sm:mt-1 sm:text-[27px]">
            {formatPurchaseMoney(snapshot.totalCents, snapshot.currency)}
          </p>
        </div>
      </article>

      <dl className="grid grid-cols-2 divide-x divide-[rgb(var(--border-subtle))] overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
        <div className="px-3.5 py-3">
          <dt className="font-mono text-[9px] font-bold tracking-[0.12em] text-[rgb(var(--fg-faint))] uppercase">
            Your price
          </dt>
          <dd className="font-display mt-1 text-[15px] font-bold text-[rgb(var(--fg-default))] tabular-nums">
            {formatPurchaseMoney(snapshot.subtotalCents, snapshot.currency)}
          </dd>
        </div>
        <div className="px-3.5 py-3">
          <dt className="font-mono text-[9px] font-bold tracking-[0.12em] text-[rgb(var(--fg-faint))] uppercase">
            VAT
          </dt>
          <dd className="font-display mt-1 text-[15px] font-bold text-[rgb(var(--fg-default))] tabular-nums">
            {snapshot.tax.mode === "tax_free"
              ? "Not added"
              : formatPurchaseMoney(snapshot.tax.amountCents, snapshot.currency)}
          </dd>
        </div>
      </dl>

      <dl className="divide-y divide-[rgb(var(--border-subtle))] overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 text-[12.5px]">
        <div className="flex items-start justify-between gap-4 py-3">
          <dt className="text-[rgb(var(--fg-muted))]">Payment</dt>
          <dd className="max-w-[68%] text-right font-semibold text-[rgb(var(--fg-default))]">
            {snapshot.offeredPaymentPlans.length
              ? snapshot.offeredPaymentPlans.map(paymentPlanLabel).join(" · ")
              : "No payment required"}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-4 py-3">
          <dt className="text-[rgb(var(--fg-muted))]">After acceptance</dt>
          <dd className="max-w-[68%] text-right font-semibold text-[rgb(var(--fg-default))]">
            {targetLabel}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-4 py-3">
          <dt className="text-[rgb(var(--fg-muted))]">Valid until</dt>
          <dd className="text-right font-semibold text-[rgb(var(--fg-default))]">{expiryLabel}</dd>
        </div>
        <div className="flex items-start justify-between gap-4 py-3">
          <dt className="text-[rgb(var(--fg-muted))]">Agreement</dt>
          <dd className="max-w-[72%] text-right font-semibold text-[rgb(var(--fg-default))]">
            {agreementPdf ? (
              <span className="inline-flex min-w-0 items-center justify-end gap-2">
                <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">{agreementPdf.originalFileName}</span>
                {agreementHref ? (
                  <a
                    href={agreementHref}
                    target="_blank"
                    rel="noreferrer"
                    className="sk-press inline-flex shrink-0 items-center gap-1 text-[rgb(var(--brand-primary-dark))] underline underline-offset-2"
                  >
                    View <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                ) : null}
              </span>
            ) : agreementMode === "text" ? (
              "Written agreement"
            ) : (
              "No separate agreement"
            )}
          </dd>
        </div>
      </dl>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <CompactSection title="Product details & deliverables" className="sm:col-span-2">
          {snapshot.tagline ? <p className="mb-3">{snapshot.tagline}</p> : null}
          {snapshot.deliverables.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {snapshot.deliverables.map((deliverable, index) => (
                <li
                  key={`${deliverable}-${String(index)}`}
                  className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-2.5 py-1 text-[11.5px] font-semibold text-[rgb(var(--fg-default))]"
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-on-brand))]">
                    <Check className="h-2.5 w-2.5" aria-hidden />
                  </span>
                  <span className="min-w-0 break-words">{deliverable}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[rgb(var(--fg-muted))]">No separate deliverables listed.</p>
          )}
        </CompactSection>
        {snapshot.includedSongSpaces > 0 || session || revision ? (
          <CompactSection title="Delivery, sessions & revisions">
            <ul className="space-y-2">
              {snapshot.includedSongSpaces > 0 ? (
                <li>{String(snapshot.includedSongSpaces)} song spaces</li>
              ) : null}
              {session ? (
                <li>
                  {session.limit.kind === "unlimited"
                    ? "Unlimited sessions"
                    : `${String(session.limit.count)} sessions`}{" "}
                  · {String(session.durationMin)} minutes · {session.locationType}
                </li>
              ) : null}
              {revision ? (
                <li>
                  {revision.kind === "unlimited"
                    ? "Unlimited revisions"
                    : `${String(revision.count)} revisions`}
                </li>
              ) : null}
            </ul>
          </CompactSection>
        ) : null}
        <CompactSection
          title="Rights & royalties"
          className={snapshot.includedSongSpaces > 0 || session || revision ? "" : "sm:col-span-2"}
        >
          <div className="grid gap-2">
            <div className="rounded-[var(--radius-md)] bg-[rgb(var(--bg-sunken))] px-3 py-2.5">
              <p className="font-mono text-[8.5px] font-bold tracking-[0.11em] text-[rgb(var(--fg-faint))] uppercase">
                Master
              </p>
              <p className="mt-1 font-semibold text-[rgb(var(--fg-default))]">{royalty.master}</p>
            </div>
            <div className="rounded-[var(--radius-md)] bg-[rgb(var(--bg-sunken))] px-3 py-2.5">
              <p className="font-mono text-[8.5px] font-bold tracking-[0.11em] text-[rgb(var(--fg-faint))] uppercase">
                Composition
              </p>
              <p className="mt-1 font-semibold text-[rgb(var(--fg-default))]">
                {royalty.composition}
              </p>
            </div>
          </div>
          <ul className="mt-3 space-y-1.5">
            {snapshot.rights.map((right, index) => (
              <li key={`${right}-${String(index)}`} className="flex gap-2">
                <span
                  aria-hidden
                  className="mt-[0.52em] h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--brand-primary))]"
                />
                <span>{right}</span>
              </li>
            ))}
          </ul>
        </CompactSection>
        {agreementMode === "text" && snapshot.agreementText ? (
          <CompactSection title="Written agreement" className="sm:col-span-2">
            <p className="whitespace-pre-wrap">{snapshot.agreementText}</p>
          </CompactSection>
        ) : null}
      </div>
    </div>
  );
}
