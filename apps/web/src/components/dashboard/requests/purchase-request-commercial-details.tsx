"use client";

import type { PurchaseCommercialSnapshot } from "@skitza/db";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";

import { planKey, requestPlanLabel } from "~/components/checkout/plan-picker-helpers";
import { formatMoney } from "~/lib/format/money";
import { royaltyTermsDisplay } from "~/lib/purchase/royalty-terms";
import type { DeepReadonly } from "~/server/domain/purchases/policy";

type SnapshotView = DeepReadonly<PurchaseCommercialSnapshot>;
type CommercialSection = "price" | "deliverables" | "payment" | "rights" | "agreement";

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
}: {
  commercialTerms: ProducerRequestCommercialTerms;
}) {
  const [openSection, setOpenSection] = useState<CommercialSection | null>(null);

  if (commercialTerms.kind === "unavailable") {
    return (
      <section
        aria-labelledby="request-commercial-heading"
        className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-warning)/0.28)] bg-[rgb(var(--fg-warning)/0.07)] p-5"
      >
        <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[rgb(var(--fg-warning-text))] uppercase">
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
      </section>
    );
  }

  const snapshot = commercialTerms.snapshot;
  const royalty = royaltyTermsDisplay(snapshot.royaltyTerms);
  const accepted = commercialTerms.kind === "accepted";

  const toggle = (section: CommercialSection) => {
    setOpenSection((current) => (current === section ? null : section));
  };

  return (
    <section aria-labelledby="request-commercial-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[rgb(var(--brand-primary-text))] uppercase">
            {accepted ? "Frozen at acceptance" : "Current proposal"}
          </p>
          <h2
            id="request-commercial-heading"
            className="font-display mt-1 text-xl font-bold text-[rgb(var(--fg-default))]"
          >
            Commercial details
          </h2>
        </div>
        {accepted ? (
          <p className="text-xs text-[rgb(var(--fg-muted))]">
            Accepted {submittedDate(commercialTerms.acceptedAt)}
          </p>
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
        {accepted
          ? "These are the exact terms the Artist accepted."
          : "Review the complete proposal. Nothing is frozen until the Artist accepts."}
      </p>

      <div className="mt-4 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
        <CommercialRow
          id="price"
          label="Price details"
          open={openSection === "price"}
          onToggle={toggle}
        >
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))]">
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
        </CommercialRow>

        <CommercialRow
          id="deliverables"
          label="What the Artist gets"
          open={openSection === "deliverables"}
          onToggle={toggle}
        >
          {snapshot.deliverables.length > 0 ? (
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-[rgb(var(--fg-secondary))]">
              {snapshot.deliverables.map((deliverable) => (
                <li key={deliverable} className="pl-1 break-words">
                  {deliverable}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[rgb(var(--fg-muted))]">No deliverables specified.</p>
          )}
        </CommercialRow>

        <CommercialRow
          id="payment"
          label="Payment choices"
          open={openSection === "payment"}
          onToggle={toggle}
        >
          {accepted ? (
            <p className="text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
              {snapshot.selectedPaymentPlan
                ? requestPlanLabel(snapshot.selectedPaymentPlan, snapshot.totalCents, (cents) =>
                    money(cents, snapshot.currency),
                  )
                : "No payment plan was required for this zero-total purchase."}
            </p>
          ) : snapshot.offeredPaymentPlans.length > 0 ? (
            <>
              <ul className="space-y-2">
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
                Not chosen yet — the Artist selects one enabled plan at final acceptance.
              </p>
            </>
          ) : (
            <p className="text-sm text-[rgb(var(--fg-muted))]">
              No payment plan is needed for this zero-total proposal.
            </p>
          )}
        </CommercialRow>

        <CommercialRow
          id="rights"
          label="Rights and royalties"
          open={openSection === "rights"}
          onToggle={toggle}
        >
          <dl className="grid gap-3 text-sm">
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
        </CommercialRow>

        <CommercialRow
          id="agreement"
          label="Full agreement"
          open={openSection === "agreement"}
          onToggle={toggle}
        >
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
            {snapshot.agreementText}
          </p>
          <p className="mt-4 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
            {accepted
              ? "Acceptance is immutable. Any payment follow-up belongs in Payments."
              : "Final acceptance is recorded after the Producer approves and the Artist chooses a plan."}
          </p>
        </CommercialRow>
      </div>
    </section>
  );
}

function CommercialRow({
  id,
  label,
  open,
  onToggle,
  children,
}: {
  id: CommercialSection;
  label: string;
  open: boolean;
  onToggle: (id: CommercialSection) => void;
  children: ReactNode;
}) {
  const panelId = `commercial-${id}-panel`;
  return (
    <div className="border-b border-[rgb(var(--border-subtle))] last:border-b-0">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            onToggle(id);
          }}
          className="sk-press flex min-h-14 w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm font-semibold text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-sunken))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset sm:px-5"
        >
          <span>{label}</span>
          <ChevronDown
            aria-hidden
            size={18}
            className={[
              "shrink-0 text-[rgb(var(--fg-muted))] transition-transform duration-200 motion-reduce:transition-none",
              open ? "rotate-180" : "",
            ].join(" ")}
          />
        </button>
      </h3>
      <div
        id={panelId}
        hidden={!open}
        className="border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken)/0.55)] px-4 py-4 sm:px-5"
      >
        {children}
      </div>
    </div>
  );
}
