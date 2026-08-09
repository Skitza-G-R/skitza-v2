"use client";

import type { PaymentPlan, ProductRoyaltyTerms } from "@skitza/db";

import { royaltyTermsDisplay } from "~/lib/purchase/royalty-terms";
import type { VolumeTier } from "~/lib/pricing";
import type { TaxMode } from "~/lib/tax-mode";
import { ArtistProductPreview } from "../artist-product-preview";
import type { AgreementMode, AgreementPdfDraft } from "../product-editor-draft";

export type ReviewEditStep = "type" | "details" | "price" | "payment" | "delivery" | "rights";

interface ReviewStepProps {
  name: string;
  tagline: string;
  typeLabel: string;
  showTypeEdit?: boolean;
  includes: string[];
  pricingModel: "flat" | "per_song";
  volumeTiers?: VolumeTier[];
  priceCents: number;
  artistPaysCents?: number;
  taxNote?: string | null;
  currency: string;
  includesSessions: boolean;
  sessions: number;
  unlimitedSessions: boolean;
  bookingEnabled: boolean;
  paymentPlans: PaymentPlan[];
  duration: string;
  revisions: number;
  unlimitedRevisions: boolean;
  royaltyTerms: ProductRoyaltyTerms | null;
  agreementMode: AgreementMode;
  agreementText: string;
  agreementPdf?: AgreementPdfDraft | null;
  producerName?: string;
  taxMode?: TaxMode;
  taxRatePct?: number;
  previewPlacement?: "focal" | "secondary";
  onEdit: (step: ReviewEditStep) => void;
}

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function paymentPlanSummary(plan: PaymentPlan, totalCents: number, currency: string): string {
  if (plan.kind === "full") {
    return `Pay in full · ${formatAmount(totalCents, currency)}`;
  }
  if (plan.kind === "split_50_50") {
    const second = Math.floor(totalCents / 2);
    const first = totalCents - second;
    return `50% / 50% · ${formatAmount(first, currency)} then ${formatAmount(second, currency)}`;
  }
  const later = Math.floor(totalCents / plan.installments);
  const first = totalCents - later * (plan.installments - 1);
  return `Monthly installments · ${String(plan.installments)} payments · ${formatAmount(first, currency)} first`;
}

function ReviewSection({
  title,
  step,
  onEdit,
  children,
}: {
  title: string;
  step: ReviewEditStep;
  onEdit: (step: ReviewEditStep) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-[15px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
          {title}
        </h3>
        <button
          type="button"
          aria-label={`Edit ${title}`}
          onClick={() => {
            onEdit(step);
          }}
          className="sk-press inline-flex h-11 items-center rounded-[var(--radius-lg)] px-3 text-[12.5px] font-semibold text-[rgb(var(--brand-primary-dark))] hover:bg-[rgb(var(--brand-primary)/0.08)] sm:h-9 sm:rounded-[var(--radius-md)]"
        >
          Edit
        </button>
      </div>
      <div className="mt-2 text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">{children}</div>
    </section>
  );
}

export function ReviewStep({
  name,
  tagline,
  typeLabel,
  showTypeEdit = false,
  includes,
  pricingModel,
  volumeTiers = [],
  priceCents,
  artistPaysCents,
  taxNote,
  currency,
  includesSessions,
  sessions,
  unlimitedSessions,
  bookingEnabled,
  paymentPlans,
  duration,
  revisions,
  unlimitedRevisions,
  royaltyTerms,
  agreementMode,
  agreementText,
  agreementPdf = null,
  producerName = "Your studio",
  taxMode = "tax_free",
  taxRatePct = 18,
  previewPlacement = "focal",
  onEdit,
}: ReviewStepProps) {
  const royalty = royaltyTermsDisplay(royaltyTerms);
  const hasBookableSessions = includesSessions && bookingEnabled;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <ArtistProductPreview
        name={name}
        tagline={tagline}
        producerName={producerName}
        priceCents={priceCents}
        currency={currency}
        pricingModel={pricingModel}
        volumeTiers={volumeTiers}
        includesSessions={hasBookableSessions}
        sessions={sessions}
        unlimitedSessions={unlimitedSessions}
        bookingEnabled={hasBookableSessions}
        duration={duration}
        includes={includes}
        revisions={revisions}
        unlimitedRevisions={unlimitedRevisions}
        paymentPlans={paymentPlans}
        royaltyTerms={royaltyTerms}
        agreementText={agreementMode === "text" ? agreementText : ""}
        taxMode={taxMode}
        taxRatePct={taxRatePct}
        placement={previewPlacement}
      />

      {showTypeEdit ? (
        <ReviewSection title="Product type" step="type" onEdit={onEdit}>
          <div className="font-semibold text-[rgb(var(--fg-default))]">{typeLabel}</div>
        </ReviewSection>
      ) : null}

      <ReviewSection title="Product details" step="details" onEdit={onEdit}>
        <div className="font-semibold [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))]">
          {name}
        </div>
        {!showTypeEdit ? <div className="mt-0.5">{typeLabel}</div> : null}
        <div className="mt-2">
          <div className="text-[11px] font-bold tracking-[0.12em] text-[rgb(var(--fg-faint))] uppercase">
            Short description
          </div>
          <p className="mt-0.5 [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))]">
            {tagline}
          </p>
        </div>
        {includes.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 [overflow-wrap:anywhere] break-words">
            {includes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <div className="mt-2 text-[rgb(var(--fg-faint))]">No inclusions added</div>
        )}
      </ReviewSection>

      <ReviewSection title="Price" step="price" onEdit={onEdit}>
        <div className="font-semibold text-[rgb(var(--fg-default))] tabular-nums">
          {formatAmount(priceCents, currency)}
          {pricingModel === "per_song" ? " / song starting rate" : ""}
        </div>
        {taxNote ? <div className="mt-1 text-[rgb(var(--fg-faint))]">{taxNote}</div> : null}
        {artistPaysCents !== undefined && artistPaysCents !== priceCents ? (
          <div className="mt-1 font-medium text-[rgb(var(--fg-secondary))] tabular-nums">
            Artist total: {formatAmount(artistPaysCents, currency)}
            {pricingModel === "per_song" ? " for one song" : ""}.
          </div>
        ) : null}
        {pricingModel === "per_song" && volumeTiers.length > 0 ? (
          <ul className="mt-3 divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))]">
            {volumeTiers.map((tier, index) => (
              <li
                key={`${String(tier.minQty)}-${String(tier.pricePerUnitCents)}`}
                className="flex min-h-10 items-center justify-between gap-3 py-1.5"
              >
                <span>{index === 0 ? "1 song" : `${String(tier.minQty)}+ songs`}</span>
                <span className="font-semibold text-[rgb(var(--fg-default))] tabular-nums">
                  {formatAmount(tier.pricePerUnitCents, currency)} / song
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </ReviewSection>

      <ReviewSection title="Payment" step="payment" onEdit={onEdit}>
        <ul className="space-y-1.5">
          {paymentPlans.map((plan, index) => (
            <li key={`${plan.kind}-${String(index)}`}>
              {paymentPlanSummary(plan, artistPaysCents ?? priceCents, currency)}
            </li>
          ))}
        </ul>
      </ReviewSection>

      <ReviewSection title="Delivery" step="delivery" onEdit={onEdit}>
        {hasBookableSessions ? (
          <>
            <div className="font-semibold text-[rgb(var(--fg-default))]">
              {unlimitedSessions
                ? "Unlimited bookable sessions"
                : `${String(sessions)} bookable ${
                    sessions === 1 ? "session" : "sessions"
                  }`}
            </div>
            <div className="mt-1">{duration} each</div>
          </>
        ) : (
          <div className="mt-1">No bookable sessions included</div>
        )}
        <div className="mt-1">
          {unlimitedRevisions
            ? "Unlimited revisions"
            : `${String(revisions)} ${revisions === 1 ? "revision" : "revisions"}`}
        </div>
      </ReviewSection>

      <ReviewSection title="Rights & agreement" step="rights" onEdit={onEdit}>
        <dl className="space-y-2">
          <div>
            <dt className="text-[11px] font-bold tracking-[0.12em] text-[rgb(var(--fg-faint))] uppercase">
              Master
            </dt>
            <dd className="min-w-0 [overflow-wrap:anywhere] break-words">{royalty.master}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold tracking-[0.12em] text-[rgb(var(--fg-faint))] uppercase">
              Composition
            </dt>
            <dd className="min-w-0 [overflow-wrap:anywhere] break-words">{royalty.composition}</dd>
          </div>
        </dl>
        {royaltyTerms?.notes ? (
          <p className="mt-2 break-words whitespace-pre-wrap">{royaltyTerms.notes}</p>
        ) : null}
        {agreementMode === "text" && agreementText.trim() ? (
          <div className="mt-3 border-t border-[rgb(var(--border-subtle))] pt-3">
            <div className="text-[11px] font-bold tracking-[0.12em] text-[rgb(var(--fg-faint))] uppercase">
              Agreement text
            </div>
            <p className="mt-1 break-words whitespace-pre-wrap text-[rgb(var(--fg-default))]">
              {agreementText.trim()}
            </p>
          </div>
        ) : agreementMode === "pdf" && agreementPdf ? (
          <div className="mt-3 border-t border-[rgb(var(--border-subtle))] pt-3">
            <div className="text-[11px] font-bold tracking-[0.12em] text-[rgb(var(--fg-faint))] uppercase">
              Private PDF agreement
            </div>
            <p className="mt-1 break-words text-[rgb(var(--fg-default))]">
              {agreementPdf.originalFileName}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-[rgb(var(--fg-faint))]">No agreement added</p>
        )}
      </ReviewSection>
    </div>
  );
}
