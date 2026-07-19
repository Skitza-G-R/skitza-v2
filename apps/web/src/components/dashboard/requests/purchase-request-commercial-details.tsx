import type { PurchaseCommercialSnapshot } from "@skitza/db";

import { planKey, requestPlanLabel } from "~/components/checkout/plan-picker-helpers";
import { formatMoney } from "~/lib/format/money";
import { royaltyTermsDisplay } from "~/lib/purchase/royalty-terms";
import type { DeepReadonly } from "~/server/domain/purchases/policy";

type SnapshotView = DeepReadonly<PurchaseCommercialSnapshot>;

export type ProducerRequestCommercialTerms =
  | Readonly<{
      kind: "proposal";
      snapshot: SnapshotView;
    }>
  | Readonly<{
      kind: "accepted";
      purchaseId: string;
      acceptedAt: Date;
      snapshot: SnapshotView;
    }>
  | Readonly<{
      kind: "unavailable";
      productName: string;
    }>;

function money(cents: number, currency: string): string {
  return formatMoney(cents, currency, { withCents: cents % 100 !== 0 });
}

function taxCopy(snapshot: SnapshotView): string {
  if (snapshot.tax.mode === "tax_free") return "Tax-free";
  if (snapshot.tax.mode === "tax_included") {
    return `Includes ${money(snapshot.tax.amountCents, snapshot.currency)} tax (${String(snapshot.tax.ratePct)}%).`;
  }
  return `${money(snapshot.subtotalCents, snapshot.currency)} before tax · ${money(snapshot.tax.amountCents, snapshot.currency)} tax (${String(snapshot.tax.ratePct)}% added).`;
}

function submittedDate(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export function PurchaseRequestCommercialDetails({
  commercialTerms,
  brief,
  submittedAt,
}: {
  commercialTerms: ProducerRequestCommercialTerms;
  brief: string | null;
  submittedAt: Date;
}) {
  if (commercialTerms.kind === "unavailable") {
    return (
      <div className="divide-y divide-[rgb(var(--border-subtle))]">
        <section className="py-6" aria-labelledby="request-commercial-heading">
          <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[rgb(var(--fg-warning))] uppercase">
            Terms need attention
          </p>
          <h2
            id="request-commercial-heading"
            className="font-display mt-1 text-lg font-bold text-[rgb(var(--fg-default))]"
          >
            Commercial details unavailable
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
            This request is preserved, but the current Store product can no longer form a valid
            proposal. You can still decline it. Restore valid published terms before approving.
          </p>
          <p className="mt-2 text-xs text-[rgb(var(--fg-muted))]">
            Submitted {submittedDate(submittedAt)}
          </p>
        </section>

        {brief ? (
          <section className="py-6" aria-labelledby="request-brief-heading">
            <h2
              id="request-brief-heading"
              className="font-display text-lg font-bold text-[rgb(var(--fg-default))]"
            >
              Artist brief
            </h2>
            <p className="mt-3 text-sm leading-relaxed break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
              {brief}
            </p>
          </section>
        ) : null}
      </div>
    );
  }

  const snapshot = commercialTerms.snapshot;
  const royalty = royaltyTermsDisplay(snapshot.royaltyTerms);
  const accepted = commercialTerms.kind === "accepted";

  return (
    <div className="divide-y divide-[rgb(var(--border-subtle))]">
      <section className="py-6" aria-labelledby="request-commercial-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[rgb(var(--brand-primary-text))] uppercase">
              {accepted ? "Frozen at acceptance" : "Current proposal"}
            </p>
            <h2
              id="request-commercial-heading"
              className="font-display mt-1 text-lg font-bold text-[rgb(var(--fg-default))]"
            >
              Commercial details
            </h2>
          </div>
          <p className="text-xs text-[rgb(var(--fg-muted))]">
            {accepted
              ? `Accepted ${submittedDate(commercialTerms.acceptedAt)}`
              : `Submitted ${submittedDate(submittedAt)}`}
          </p>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
          {accepted
            ? "These are the authoritative terms the artist accepted. Future Store edits do not change them."
            : "Nothing is frozen until the artist accepts. If Store terms change first, the artist reviews the updated proposal before accepting."}
        </p>

        <div className="mt-5 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))]">
          <ul className="divide-y divide-[rgb(var(--border-subtle))]">
            {snapshot.lineItems.map((item, index) => (
              <li
                key={`${item.label}:${String(index)}`}
                className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold break-words text-[rgb(var(--fg-default))]">
                    {item.label}
                  </p>
                  <p className="mt-0.5 text-xs text-[rgb(var(--fg-muted))]">
                    {String(item.quantity)} × {money(item.unitPriceCents, snapshot.currency)}
                  </p>
                </div>
                <p className="font-mono text-sm font-bold text-[rgb(var(--fg-default))] tabular-nums">
                  {money(item.totalCents, snapshot.currency)}
                </p>
              </li>
            ))}
          </ul>
          <dl className="grid gap-2 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-4 py-3 text-sm">
            {snapshot.discountCents > 0 ? (
              <div className="flex items-center justify-between gap-4 text-[rgb(var(--fg-secondary))]">
                <dt>Discount</dt>
                <dd className="font-mono tabular-nums">
                  −{money(snapshot.discountCents, snapshot.currency)}
                </dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-4">
              <dt className="font-semibold text-[rgb(var(--fg-default))]">Total</dt>
              <dd className="font-mono text-base font-bold text-[rgb(var(--fg-default))] tabular-nums">
                {money(snapshot.totalCents, snapshot.currency)}
              </dd>
            </div>
          </dl>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
          {taxCopy(snapshot)}
        </p>
      </section>

      {brief ? (
        <section className="py-6" aria-labelledby="request-brief-heading">
          <h2
            id="request-brief-heading"
            className="font-display text-lg font-bold text-[rgb(var(--fg-default))]"
          >
            Artist brief
          </h2>
          <p className="mt-3 text-sm leading-relaxed break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
            {brief}
          </p>
        </section>
      ) : null}

      <section className="py-6" aria-labelledby="request-payment-heading">
        <h2
          id="request-payment-heading"
          className="font-display text-lg font-bold text-[rgb(var(--fg-default))]"
        >
          {accepted ? "Selected payment plan" : "Offered payment plans"}
        </h2>
        {accepted ? (
          <p className="mt-3 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
            {snapshot.selectedPaymentPlan
              ? requestPlanLabel(snapshot.selectedPaymentPlan, snapshot.totalCents, (cents) =>
                  money(cents, snapshot.currency),
                )
              : "No payment plan was required for this zero-total purchase."}
          </p>
        ) : snapshot.offeredPaymentPlans.length > 0 ? (
          <>
            <ul className="mt-3 list-none space-y-2">
              {snapshot.offeredPaymentPlans.map((plan) => (
                <li
                  key={planKey(plan)}
                  className="text-sm leading-relaxed text-[rgb(var(--fg-secondary))]"
                >
                  {requestPlanLabel(plan, snapshot.totalCents, (cents) =>
                    money(cents, snapshot.currency),
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-[rgb(var(--fg-muted))]">
              Not chosen yet — the artist selects one enabled plan at final acceptance.
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-[rgb(var(--fg-muted))]">
            No payment plan is needed for this zero-total proposal.
          </p>
        )}
      </section>

      <section className="py-6" aria-labelledby="request-deliverables-heading">
        <h2
          id="request-deliverables-heading"
          className="font-display text-lg font-bold text-[rgb(var(--fg-default))]"
        >
          Deliverables
        </h2>
        {snapshot.deliverables.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[rgb(var(--fg-secondary))]">
            {snapshot.deliverables.map((deliverable) => (
              <li key={deliverable} className="pl-1 break-words">
                {deliverable}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[rgb(var(--fg-muted))]">No deliverables specified.</p>
        )}
      </section>

      <section className="py-6" aria-labelledby="request-rights-heading">
        <h2
          id="request-rights-heading"
          className="font-display text-lg font-bold text-[rgb(var(--fg-default))]"
        >
          Rights &amp; royalties
        </h2>
        <dl className="mt-3 grid gap-3 text-sm">
          <div className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-3">
            <dt className="font-medium text-[rgb(var(--fg-muted))]">Master</dt>
            <dd className="min-w-0 break-words text-[rgb(var(--fg-secondary))]">
              {royalty.master}
            </dd>
          </div>
          <div className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-3">
            <dt className="font-medium text-[rgb(var(--fg-muted))]">Composition</dt>
            <dd className="min-w-0 break-words text-[rgb(var(--fg-secondary))]">
              {royalty.composition}
            </dd>
          </div>
        </dl>
        {snapshot.royaltyTerms?.notes ? (
          <p className="mt-4 text-sm leading-relaxed break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
            {snapshot.royaltyTerms.notes}
          </p>
        ) : null}
        {snapshot.rights.length > 0 ? (
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-[rgb(var(--fg-secondary))]">
            {snapshot.rights.map((right) => (
              <li key={right} className="pl-1 break-words">
                {right}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="py-6" aria-labelledby="request-agreement-heading">
        <h2
          id="request-agreement-heading"
          className="font-display text-lg font-bold text-[rgb(var(--fg-default))]"
        >
          {accepted ? "Accepted agreement" : "Proposed agreement"}
        </h2>
        <p className="mt-3 text-sm leading-relaxed break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
          {snapshot.agreementText}
        </p>
        <p className="mt-4 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
          {accepted
            ? "Acceptance is immutable. Any payment follow-up belongs in Payments."
            : "Final acceptance is recorded on the Purchase after the producer approves and the artist chooses a plan."}
        </p>
      </section>
    </div>
  );
}
