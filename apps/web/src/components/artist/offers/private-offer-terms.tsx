import type { PaymentPlan, PurchaseCommercialSnapshot } from "@skitza/db";
import { ExternalLink, FileText } from "lucide-react";

import { formatPurchaseMoney } from "~/components/artist/purchase/purchase-data";
import { agreementPdfFromCommercialSnapshot } from "~/lib/agreement-pdf";
import { royaltyTermsDisplay } from "~/lib/purchase/royalty-terms";

function planLabel(plan: PaymentPlan): string {
  if (plan.kind === "full") return "Pay in full";
  if (plan.kind === "split_50_50") return "Split 50 / 50";
  return `${String(plan.installments)} monthly payments`;
}

function taxLabel(snapshot: PurchaseCommercialSnapshot): string {
  if (snapshot.tax.mode === "tax_free") return "Tax free";
  const rate = `${String(snapshot.tax.ratePct)}% tax`;
  return snapshot.tax.mode === "tax_included" ? `${rate} included` : `${rate} added`;
}

function revisionLabel(snapshot: PurchaseCommercialSnapshot): string {
  if (!snapshot.revisionRule) return "No revisions included";
  if (snapshot.revisionRule.kind === "unlimited") return "Unlimited revisions";
  return `${String(snapshot.revisionRule.count)} ${snapshot.revisionRule.count === 1 ? "revision" : "revisions"}`;
}

function sessionLines(snapshot: PurchaseCommercialSnapshot): string[] {
  if (!snapshot.session) return ["No sessions included"];

  const session = snapshot.session;
  const limit =
    session.limit.kind === "unlimited"
      ? "Unlimited sessions"
      : `${String(session.limit.count)} ${session.limit.count === 1 ? "session" : "sessions"}`;
  return [
    `${limit} · ${String(session.durationMin)} minutes each`,
    `Location: ${session.locationType}`,
    `Buffer between sessions: ${String(session.bufferMinutes)} minutes`,
    `Minimum booking notice: ${String(session.minLeadHours)} hours`,
  ];
}

function TermsHeading({
  children,
  as: Heading = "h2",
}: {
  children: React.ReactNode;
  as?: "h2" | "h4";
}) {
  return (
    <Heading className="mb-2 font-mono text-[10px] font-semibold tracking-[0.16em] text-[rgb(var(--fg-muted))] uppercase">
      {children}
    </Heading>
  );
}

function TermsCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-4">
      {children}
    </div>
  );
}

/** A read-only rendering of the exact commercial snapshot offered to an artist. */
export function PrivateOfferTerms({
  snapshot,
  targetLabel,
  embedded = false,
  agreementHref,
}: {
  snapshot: PurchaseCommercialSnapshot;
  targetLabel: string;
  embedded?: boolean;
  agreementHref?: string;
}) {
  const royalty = royaltyTermsDisplay(snapshot.royaltyTerms);
  const selectedPlan = snapshot.selectedPaymentPlan;
  const OfferHeading = embedded ? "h4" : "h1";
  const sectionHeading = embedded ? "h4" : "h2";
  const agreementPdf = agreementPdfFromCommercialSnapshot(snapshot);
  const agreementMode =
    snapshot.agreementMode ?? (agreementPdf ? "pdf" : snapshot.agreementText ? "text" : "none");

  return (
    <div className="min-w-0 space-y-5" data-testid="private-offer-terms">
      <section className="min-w-0" aria-label="Offer summary">
        <TermsCard>
          <p className="font-mono text-[9.5px] tracking-[0.14em] text-[rgb(var(--brand-primary))] uppercase">
            Private offer
          </p>
          <OfferHeading className="font-syne mt-1.5 text-[22px] leading-tight font-extrabold tracking-[-0.025em] [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))] sm:text-[26px]">
            {snapshot.productOrOfferName}
          </OfferHeading>
          {snapshot.tagline ? (
            <p className="mt-1.5 text-[13px] leading-relaxed [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-muted))]">
              {snapshot.tagline}
            </p>
          ) : null}
          {snapshot.service ? (
            <p className="mt-3 text-[12px] font-semibold [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
              Service · {snapshot.service}
            </p>
          ) : null}
          <div className="mt-4 flex min-w-0 flex-col gap-3 border-t border-[rgb(var(--border-subtle))] pt-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="font-amount text-[30px] leading-none font-bold tracking-[-0.035em] [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))] sm:text-[34px]">
                {formatPurchaseMoney(snapshot.totalCents, snapshot.currency)}
              </p>
              <p className="mt-1 font-mono text-[9.5px] tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
                {snapshot.currency} · {taxLabel(snapshot)}
              </p>
            </div>
            <div className="min-w-0 sm:max-w-[55%] sm:text-right">
              <p className="font-mono text-[9px] tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
                Project target
              </p>
              <p className="mt-1 text-[13px] font-bold [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))]">
                {targetLabel}
              </p>
            </div>
          </div>
        </TermsCard>
      </section>

      <section className="min-w-0" aria-label="Deliverables">
        <TermsHeading as={sectionHeading}>Deliverables</TermsHeading>
        <TermsCard>
          {snapshot.deliverables.length > 0 ? (
            <ul className="min-w-0 space-y-2">
              {snapshot.deliverables.map((deliverable, index) => (
                <li
                  key={`${deliverable}-${String(index)}`}
                  className="flex min-w-0 items-start gap-2.5 text-[13px] leading-relaxed text-[rgb(var(--fg-secondary))]"
                >
                  <span aria-hidden className="shrink-0 text-[rgb(var(--brand-primary))]">
                    ·
                  </span>
                  <span className="min-w-0 [overflow-wrap:anywhere] break-words">
                    {deliverable}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-[rgb(var(--fg-muted))]">No deliverables listed</p>
          )}
        </TermsCard>
      </section>

      <section className="min-w-0" aria-label="Allowances and revisions">
        <TermsHeading as={sectionHeading}>Song, session & revision allowance</TermsHeading>
        <TermsCard>
          <dl className="min-w-0 divide-y divide-[rgb(var(--border-subtle))] text-[13px]">
            <div className="grid min-w-0 gap-1 py-3 first:pt-0 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
              <dt className="font-semibold text-[rgb(var(--fg-muted))]">Song spaces</dt>
              <dd className="[overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
                {String(snapshot.includedSongSpaces)} song{" "}
                {snapshot.includedSongSpaces === 1 ? "space" : "spaces"}
              </dd>
            </div>
            <div className="grid min-w-0 gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
              <dt className="font-semibold text-[rgb(var(--fg-muted))]">Sessions</dt>
              <dd className="min-w-0">
                <ul className="min-w-0 space-y-1 text-[rgb(var(--fg-secondary))]">
                  {sessionLines(snapshot).map((line) => (
                    <li key={line} className="[overflow-wrap:anywhere] break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
            <div className="grid min-w-0 gap-1 pt-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
              <dt className="font-semibold text-[rgb(var(--fg-muted))]">Revisions</dt>
              <dd className="[overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
                {revisionLabel(snapshot)}
              </dd>
            </div>
          </dl>
        </TermsCard>
      </section>

      <section className="min-w-0" aria-label="Price and tax">
        <TermsHeading as={sectionHeading}>Cash price, tax & currency</TermsHeading>
        <TermsCard>
          <ol className="min-w-0 divide-y divide-[rgb(var(--border-subtle))]">
            {snapshot.lineItems.map((item, index) => (
              <li key={`${item.label}-${String(index)}`} className="min-w-0 py-3 first:pt-0">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))]">
                      {item.label}
                    </p>
                    <p className="mt-1 text-[11.5px] [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-muted))]">
                      {String(item.quantity)} ×{" "}
                      {formatPurchaseMoney(item.unitPriceCents, snapshot.currency)}
                      {item.listUnitPriceCents !== item.unitPriceCents
                        ? ` · list ${formatPurchaseMoney(item.listUnitPriceCents, snapshot.currency)} each`
                        : ""}
                    </p>
                  </div>
                  <p className="font-amount shrink-0 text-[13px] font-bold text-[rgb(var(--fg-default))]">
                    {formatPurchaseMoney(item.totalCents, snapshot.currency)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <dl className="min-w-0 border-t border-[rgb(var(--border-subtle))] pt-3 text-[12.5px]">
            <div className="flex min-w-0 justify-between gap-3 py-1 text-[rgb(var(--fg-secondary))]">
              <dt>List subtotal</dt>
              <dd className="shrink-0">
                {formatPurchaseMoney(snapshot.listSubtotalCents, snapshot.currency)}
              </dd>
            </div>
            <div className="flex min-w-0 justify-between gap-3 py-1 text-[rgb(var(--fg-secondary))]">
              <dt>Discount</dt>
              <dd className="shrink-0">
                −{formatPurchaseMoney(snapshot.discountCents, snapshot.currency)}
              </dd>
            </div>
            <div className="flex min-w-0 justify-between gap-3 py-1 text-[rgb(var(--fg-secondary))]">
              <dt>Subtotal</dt>
              <dd className="shrink-0">
                {formatPurchaseMoney(snapshot.subtotalCents, snapshot.currency)}
              </dd>
            </div>
            <div className="flex min-w-0 justify-between gap-3 py-1 text-[rgb(var(--fg-secondary))]">
              <dt>{taxLabel(snapshot)}</dt>
              <dd className="shrink-0">
                {formatPurchaseMoney(snapshot.tax.amountCents, snapshot.currency)}
              </dd>
            </div>
            <div className="mt-2 flex min-w-0 items-baseline justify-between gap-3 border-t border-[rgb(var(--border-subtle))] pt-3 font-bold text-[rgb(var(--fg-default))]">
              <dt>Total · {snapshot.currency}</dt>
              <dd className="font-amount shrink-0 text-[15px]">
                {formatPurchaseMoney(snapshot.totalCents, snapshot.currency)}
              </dd>
            </div>
          </dl>
        </TermsCard>
      </section>

      <section className="min-w-0" aria-label="Payment plans">
        <TermsHeading as={sectionHeading}>Enabled payment plans</TermsHeading>
        <TermsCard>
          {snapshot.offeredPaymentPlans.length > 0 ? (
            <ul className="min-w-0 divide-y divide-[rgb(var(--border-subtle))]">
              {snapshot.offeredPaymentPlans.map((plan) => {
                const label = planLabel(plan);
                return (
                  <li
                    key={
                      plan.kind === "monthly"
                        ? `${plan.kind}-${String(plan.installments)}`
                        : plan.kind
                    }
                    className="flex min-w-0 items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <span className="text-[13px] font-semibold [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
                      {label}
                    </span>
                    {selectedPlan && planLabel(selectedPlan) === label ? (
                      <span className="shrink-0 rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary)/0.13)] px-2 py-1 font-mono text-[9px] font-semibold tracking-[0.08em] text-[rgb(var(--fg-default))] uppercase">
                        Selected
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] leading-relaxed text-[rgb(var(--fg-secondary))]">
              No payment plan or payment is required for this zero-price offer.
            </p>
          )}
        </TermsCard>
      </section>

      <section className="min-w-0" aria-label="Rights and royalties">
        <TermsHeading as={sectionHeading}>Rights, master & royalties</TermsHeading>
        <TermsCard>
          <dl className="min-w-0 divide-y divide-[rgb(var(--border-subtle))] text-[13px]">
            <div className="grid min-w-0 gap-1 pb-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
              <dt className="font-semibold text-[rgb(var(--fg-muted))]">Master</dt>
              <dd className="[overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
                {royalty.master}
              </dd>
            </div>
            <div className="grid min-w-0 gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
              <dt className="font-semibold text-[rgb(var(--fg-muted))]">Composition</dt>
              <dd className="[overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
                {royalty.composition}
              </dd>
            </div>
            <div className="grid min-w-0 gap-1 pt-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
              <dt className="font-semibold text-[rgb(var(--fg-muted))]">Rights</dt>
              <dd className="min-w-0">
                {snapshot.rights.length > 0 ? (
                  <ul className="min-w-0 space-y-1.5 text-[rgb(var(--fg-secondary))]">
                    {snapshot.rights.map((right, index) => (
                      <li
                        key={`${right}-${String(index)}`}
                        className="[overflow-wrap:anywhere] break-words"
                      >
                        {right}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-[rgb(var(--fg-muted))]">No additional rights listed</span>
                )}
              </dd>
            </div>
          </dl>
          {snapshot.royaltyTerms?.notes ? (
            <p className="mt-3 min-w-0 border-t border-[rgb(var(--border-subtle))] pt-3 text-[12.5px] leading-relaxed [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
              {snapshot.royaltyTerms.notes}
            </p>
          ) : null}
        </TermsCard>
      </section>

      {agreementPdf ? (
        <section className="min-w-0" aria-label="Agreement PDF">
          <TermsHeading as={sectionHeading}>Agreement</TermsHeading>
          <TermsCard>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <FileText
                  className="h-4 w-4 shrink-0 text-[rgb(var(--brand-primary-dark))]"
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                    {agreementPdf.originalFileName}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[rgb(var(--fg-muted))]">PDF</p>
                </div>
              </div>
              {agreementHref ? (
                <a
                  href={agreementHref}
                  target="_blank"
                  rel="noreferrer"
                  className="sk-press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-lg)] px-3 text-[12px] font-semibold text-[rgb(var(--brand-primary-dark))] hover:bg-[rgb(var(--brand-primary)/0.08)]"
                >
                  Open PDF <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              ) : null}
            </div>
          </TermsCard>
        </section>
      ) : null}

      {agreementMode === "text" ? (
        <section className="min-w-0" aria-label="Exact agreement">
          <TermsHeading as={sectionHeading}>Written agreement</TermsHeading>
          <div className="min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-4 py-4">
            <p className="min-w-0 text-[13px] leading-relaxed [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
              {snapshot.agreementText || "No additional agreement text."}
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}
