import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { formatMoney } from "~/lib/format/money";
import { withArtistStudio } from "~/lib/artist-studio-context";

import type { PaymentDeliveryState } from "./delivery-state";
import { PaymentReminderButton } from "./payment-reminder-button";

export type PaymentHistoryRole = "artist" | "producer";

export type PaymentHistoryTone = "neutral" | "active" | "warning" | "danger" | "success" | "accent";

export interface PaymentHistoryStatus {
  label: string;
  tone: PaymentHistoryTone;
}

export type PaymentHistoryRecordStatus =
  | "open"
  | "no_payment_required"
  | "paid_in_full"
  | "settled_by_waiver"
  | "canceled";

export interface PaymentHistorySectionDescriptor {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
}

export interface PaymentHistoryCurrencyTotal {
  currency: string;
  dueNowCents: number;
  totalRemainingCents: number;
}

export interface PaymentHistoryLineItem {
  id: string;
  label: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface PaymentHistoryFrozenTermDetail {
  label: string;
  value: string;
}

export interface PaymentHistoryFrozenTerms {
  frozenAtIso: string;
  productName: string;
  deliverables: readonly string[];
  lineItems: readonly PaymentHistoryLineItem[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  detailRows: readonly PaymentHistoryFrozenTermDetail[];
  rights: readonly string[];
  agreementText: string | null;
}

export interface PaymentHistoryAcceptance {
  acceptedAtIso: string;
  acceptedByLabel: string | null;
  statement: string | null;
}

export interface PaymentHistoryPlan {
  label: string;
  description: string | null;
}

export interface PaymentHistoryInstallment {
  id: string;
  position: number;
  label: string;
  amountCents: number;
  paidCents: number;
  waivedCents: number;
  remainingCents: number;
  dueAtIso: string | null;
  trigger: string | null;
  status: PaymentHistoryStatus;
}

export interface PaymentHistoryNextPayment {
  amountCents: number;
  dueAtIso: string | null;
  trigger: string | null;
}

export interface PaymentHistoryInstructionField {
  label: string;
  value: string;
}

export interface PaymentHistoryInstructions {
  title: string;
  updatedAtIso: string | null;
  fields: readonly PaymentHistoryInstructionField[];
  note: string | null;
}

export interface PaymentHistoryProof {
  id: string;
  installmentLabel: string;
  amountCents: number;
  currency: string;
  status: "pending" | "confirmed" | "rejected";
  originalFileName: string | null;
  submittedAtIso: string;
  reviewedAtIso: string | null;
  note: string | null;
  rejectionNote: string | null;
  detailAvailable: boolean;
}

export interface PaymentHistoryPayment {
  id: string;
  installmentLabel: string;
  amountCents: number;
  currency: string;
  paidAtIso: string;
  sourceLabel: string;
  note: string | null;
}

export interface PaymentHistoryCorrection {
  id: string;
  label: string;
  amountDeltaCents: number;
  currency: string;
  occurredAtIso: string;
  reason: string;
}

export interface PaymentHistoryWaiver {
  id: string;
  installmentLabel: string;
  amountCents: number;
  currency: string;
  occurredAtIso: string;
  reason: string;
}

export interface PaymentHistoryCancellation {
  id: string;
  occurredAtIso: string;
  reason: string;
}

export interface PaymentHistoryPauseEvent {
  id: string;
  actionLabel: string;
  occurredAtIso: string;
  reason: string | null;
}

export interface PaymentHistoryDownloadOverride {
  id: string;
  actionLabel: string;
  trackVersionLabel: string;
  occurredAtIso: string;
  reason: string;
  expiresAtIso: string | null;
}

export interface PaymentHistoryPurchase {
  id: string;
  studioId?: string;
  reference: string;
  title: string;
  counterpartyId?: string | null;
  counterpartyLabel: string | null;
  currency: string;
  status: PaymentHistoryStatus;
  recordStatus: PaymentHistoryRecordStatus;
  defaultOpen: boolean;
  totalCents: number;
  paidCents: number;
  dueNowCents: number;
  totalRemainingCents: number;
  delivery: PaymentDeliveryState;
  frozenTerms: PaymentHistoryFrozenTerms;
  acceptance: PaymentHistoryAcceptance;
  plan: PaymentHistoryPlan;
  schedule: readonly PaymentHistoryInstallment[];
  nextPayment: PaymentHistoryNextPayment | null;
  showPayNextPayment: boolean;
  currentInstructions: PaymentHistoryInstructions | null;
  proofs: readonly PaymentHistoryProof[];
  payments: readonly PaymentHistoryPayment[];
  corrections: readonly PaymentHistoryCorrection[];
  waivers: readonly PaymentHistoryWaiver[];
  cancellations: readonly PaymentHistoryCancellation[];
  pauseHistory: readonly PaymentHistoryPauseEvent[];
  downloadOverrideHistory: readonly PaymentHistoryDownloadOverride[];
}

export interface PaymentHistoryProject {
  id: string;
  title: string;
  status: PaymentHistoryStatus;
  currencyTotals: readonly PaymentHistoryCurrencyTotal[];
  purchases: readonly PaymentHistoryPurchase[];
}

export interface PaymentHistorySectionProps {
  role: PaymentHistoryRole;
  section: PaymentHistorySectionDescriptor;
  currencyTotals: readonly PaymentHistoryCurrencyTotal[];
  projects: readonly PaymentHistoryProject[];
}

function currencyTotalsMatch(
  left: readonly PaymentHistoryCurrencyTotal[],
  right: readonly PaymentHistoryCurrencyTotal[],
): boolean {
  if (left.length !== right.length) return false;
  const rightByCurrency = new Map(right.map((total) => [total.currency, total]));
  return left.every((total) => {
    const match = rightByCurrency.get(total.currency);
    return (
      match?.dueNowCents === total.dueNowCents &&
      match.totalRemainingCents === total.totalRemainingCents
    );
  });
}

/**
 * Read-only payment history shared by artist, producer, project, and client views.
 * All grouping, bucket assignment, status, totals, and available actions are supplied
 * by the caller's authorized domain projection; this component only presents them.
 */
export function PaymentHistorySection({
  role,
  section,
  currencyTotals,
  projects,
}: PaymentHistorySectionProps) {
  const headingId = `payment-history-${section.id}`;

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <header className="mb-4 min-w-0">
        <p className="font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--brand-primary-text))] uppercase">
          {section.eyebrow}
        </p>
        <h2
          id={headingId}
          className="font-display mt-1 text-[22px] font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]"
        >
          {section.title}
        </h2>
        <p className="mt-1 max-w-[68ch] text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
          {section.description}
        </p>
      </header>

      {currencyTotals.length > 0 ? (
        <div
          aria-label={`${section.title} totals by currency`}
          className="mb-4 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"
        >
          {currencyTotals.map((total) => (
            <CurrencyTotalCard key={total.currency} total={total} />
          ))}
        </div>
      ) : null}

      {projects.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-10 text-center">
          <p className="text-sm font-bold text-[rgb(var(--fg-default))]">{section.emptyTitle}</p>
          <p className="mx-auto mt-1 max-w-[44ch] text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
            {section.emptyDescription}
          </p>
        </div>
      ) : (
        <div className="min-w-0 space-y-4">
          {projects.map((project) => (
            <ProjectHistory
              key={project.id}
              project={project}
              role={role}
              showCurrencyTotals={
                projects.length !== 1 ||
                !currencyTotalsMatch(currencyTotals, project.currencyTotals)
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CurrencyTotalCard({
  total,
  compact = false,
}: {
  total: PaymentHistoryCurrencyTotal;
  compact?: boolean;
}) {
  return (
    <section
      aria-label={`${total.currency} totals`}
      className={`min-w-0 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] ${compact ? "p-2.5" : "p-3.5"}`}
    >
      <p className="font-mono text-[11px] font-extrabold tracking-[0.12em] text-[rgb(var(--fg-default))] uppercase">
        {total.currency}
      </p>
      <dl className="mt-2 grid min-w-0 grid-cols-2 gap-3">
        <MoneyDatum
          label="Due now"
          cents={total.dueNowCents}
          currency={total.currency}
          danger={total.dueNowCents > 0}
        />
        <MoneyDatum
          label="Total remaining"
          cents={total.totalRemainingCents}
          currency={total.currency}
        />
      </dl>
    </section>
  );
}

function ProjectHistory({
  project,
  role,
  showCurrencyTotals,
}: {
  project: PaymentHistoryProject;
  role: PaymentHistoryRole;
  showCurrencyTotals: boolean;
}) {
  return (
    <article className="min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
      <header className="flex min-w-0 items-start justify-between gap-3 border-b border-[rgb(var(--border-subtle))] px-3.5 py-3.5 sm:px-5">
        <div className="min-w-0">
          <p className="text-[9.5px] font-bold tracking-[0.13em] text-[rgb(var(--fg-muted))] uppercase">
            Project
          </p>
          <h3 className="mt-0.5 text-[16px] font-extrabold break-words text-[rgb(var(--fg-default))]">
            {project.title}
          </h3>
        </div>
        <StatusBadge status={project.status} />
      </header>

      {showCurrencyTotals && project.currencyTotals.length > 0 ? (
        <div className="grid min-w-0 grid-cols-1 gap-2 border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background)/0.45)] p-3 sm:grid-cols-2 xl:grid-cols-3">
          {project.currencyTotals.map((total) => (
            <CurrencyTotalCard key={`${project.id}-${total.currency}`} total={total} compact />
          ))}
        </div>
      ) : null}

      <div className="min-w-0 space-y-3 p-3 sm:p-4">
        {project.purchases.map((purchase) => (
          <PurchaseHistory key={purchase.id} purchase={purchase} role={role} />
        ))}
      </div>
    </article>
  );
}

function PurchaseHistory({
  purchase,
  role,
}: {
  purchase: PaymentHistoryPurchase;
  role: PaymentHistoryRole;
}) {
  return (
    <details
      open={purchase.defaultOpen}
      className="group min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))]"
    >
      <summary className="min-w-0 cursor-pointer list-none px-3 py-3 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset sm:px-4 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))]">
                {purchase.reference}
              </span>
              <StatusBadge status={purchase.status} />
            </span>
            <span className="mt-1 block text-[14px] font-extrabold break-words text-[rgb(var(--fg-default))]">
              {purchase.title}
            </span>
            {purchase.counterpartyLabel ? (
              <span className="mt-0.5 block text-[11px] break-words text-[rgb(var(--fg-muted))]">
                {purchase.counterpartyLabel}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 text-[10px] font-bold text-[rgb(var(--fg-muted))] group-open:hidden">
            Details
          </span>
          <span className="hidden shrink-0 text-[10px] font-bold text-[rgb(var(--fg-muted))] group-open:inline">
            Hide
          </span>
        </span>

        <span className="mt-3 grid min-w-0 grid-cols-2 gap-2 border-t border-[rgb(var(--border-subtle))] pt-2.5 sm:grid-cols-4">
          <PurchaseAmount label="Total" cents={purchase.totalCents} currency={purchase.currency} />
          <PurchaseAmount label="Paid" cents={purchase.paidCents} currency={purchase.currency} />
          <PurchaseAmount
            label="Due now"
            cents={purchase.dueNowCents}
            currency={purchase.currency}
            danger={purchase.dueNowCents > 0}
          />
          <PurchaseAmount
            label="Total remaining"
            cents={purchase.totalRemainingCents}
            currency={purchase.currency}
          />
        </span>
      </summary>

      <PaymentHistoryPurchaseDetails purchase={purchase} role={role} />
    </details>
  );
}

export function PaymentHistoryPurchaseDetails({
  purchase,
  role,
  idPrefix = `purchase-${purchase.id}`,
  showPaymentAction = true,
}: {
  purchase: PaymentHistoryPurchase;
  role: PaymentHistoryRole;
  idPrefix?: string;
  showPaymentAction?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-5 border-t border-[rgb(var(--border-subtle))] p-3 sm:p-4">
      <PaymentSnapshot purchase={purchase} role={role} showPaymentAction={showPaymentAction} />
      <PurchaseDelivery delivery={purchase.delivery} currency={purchase.currency} />
      <FrozenAgreement
        terms={purchase.frozenTerms}
        currency={purchase.currency}
        headingId={`${idPrefix}-frozen-terms`}
      />
      <AcceptanceAndPlan acceptance={purchase.acceptance} plan={purchase.plan} />
      <InstallmentSchedule
        schedule={purchase.schedule}
        currency={purchase.currency}
        purchaseId={purchase.id}
        purchaseReference={purchase.reference}
        role={role}
      />
      <PurchaseHistories purchase={purchase} role={role} />
    </div>
  );
}

function PaymentSnapshot({
  purchase,
  role,
  showPaymentAction,
}: {
  purchase: PaymentHistoryPurchase;
  role: PaymentHistoryRole;
  showPaymentAction: boolean;
}) {
  return (
    <section aria-label="Next payment and current instructions" className="min-w-0">
      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="min-w-0 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3">
          <Eyebrow>Next payment</Eyebrow>
          {purchase.nextPayment ? (
            <>
              <p className="mt-2 font-mono text-[18px] font-extrabold break-words text-[rgb(var(--fg-default))] tabular-nums">
                {formatMoney(purchase.nextPayment.amountCents, purchase.currency, {
                  withCents: true,
                })}{" "}
                <CurrencyCode value={purchase.currency} />
              </p>
              <dl className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                <TextDatum label="Date" value={formatDate(purchase.nextPayment.dueAtIso)} />
                <TextDatum
                  label="Trigger"
                  value={purchase.nextPayment.trigger ?? "No trigger set"}
                />
              </dl>
            </>
          ) : (
            <p className="mt-2 text-[12px] text-[rgb(var(--fg-muted))]">
              No next payment is scheduled.
            </p>
          )}

          {role === "artist" && showPaymentAction && purchase.showPayNextPayment ? (
            <Button
              asChild
              className="mt-3 min-h-11 w-full min-w-11 rounded-[var(--radius-sm)] sm:min-h-0 sm:w-auto sm:min-w-0"
              size="sm"
            >
              <Link
                href={withArtistStudio(
                  `/artist/payments/${encodeURIComponent(purchase.id)}`,
                  purchase.studioId,
                )}
                aria-label={`Complete payment for ${purchase.title}`}
              >
                Complete payment
              </Link>
            </Button>
          ) : null}
        </div>

        <div className="min-w-0 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3">
          <Eyebrow>Current instructions</Eyebrow>
          {purchase.currentInstructions ? (
            <>
              <p className="mt-2 text-[13px] font-bold break-words text-[rgb(var(--fg-default))]">
                {purchase.currentInstructions.title}
              </p>
              <dl className="mt-2 min-w-0 space-y-2">
                {purchase.currentInstructions.fields.map((field) => (
                  <TextDatum key={field.label} label={field.label} value={field.value} />
                ))}
              </dl>
              {purchase.currentInstructions.note ? (
                <p className="mt-2 text-[11.5px] leading-relaxed whitespace-pre-wrap text-[rgb(var(--fg-muted))]">
                  {purchase.currentInstructions.note}
                </p>
              ) : null}
              {purchase.currentInstructions.updatedAtIso ? (
                <p className="mt-2 text-[10px] text-[rgb(var(--fg-muted))]">
                  Updated {formatDate(purchase.currentInstructions.updatedAtIso)}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-[12px] text-[rgb(var(--fg-muted))]">
              No payment instructions are currently available.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function PurchaseDelivery({
  delivery,
  currency,
}: {
  delivery: PaymentDeliveryState;
  currency: string;
}) {
  const paid = delivery.key === "paid";
  const noPaymentRequired = delivery.key === "no_payment_required";
  const early = delivery.key === "early_override";
  return (
    <section
      aria-label="Purchase delivery state"
      className="min-w-0 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Eyebrow>Delivery</Eyebrow>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
            <p className="text-[13px] font-extrabold break-words text-[rgb(var(--fg-default))]">
              {delivery.label}
            </p>
            <Badge
              className={[
                "rounded-[var(--radius-sm)] border-0 px-2 py-0.5 text-[9.5px]",
                paid || noPaymentRequired
                  ? "bg-[rgb(var(--fg-success)/0.12)] text-[rgb(var(--fg-success))]"
                  : early
                    ? "bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary-text))]"
                    : "bg-[rgb(var(--fg-danger)/0.1)] text-[rgb(var(--fg-danger))]",
              ].join(" ")}
            >
              {paid
                ? "Paid"
                : noPaymentRequired
                  ? "No payment due"
                  : early
                    ? "Selected version only"
                    : "Locked"}
            </Badge>
          </div>
          <p className="mt-1 max-w-[68ch] text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
            {delivery.description}
          </p>
          {delivery.overdue ? (
            <p className="mt-1 text-[11px] font-bold text-[rgb(var(--fg-danger))]">
              Payment is overdue. Listening stays available; download entitlement is unchanged.
            </p>
          ) : null}
        </div>
        <dl className="grid shrink-0 grid-cols-3 gap-3 sm:min-w-[280px]">
          <MoneyDatum label="Paid" cents={delivery.paidCents} currency={currency} />
          <MoneyDatum label="Waived" cents={delivery.waivedCents} currency={currency} />
          <MoneyDatum label="Remaining" cents={delivery.remainingCents} currency={currency} />
        </dl>
      </div>

      {delivery.googleDriveLinks.length > 0 ? (
        <div className="mt-3 border-t border-[rgb(var(--border-subtle))] pt-3">
          <p className="text-[11px] font-bold text-[rgb(var(--fg-default))]">
            Stems and extra deliverables
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {delivery.googleDriveLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-3 text-[12px] font-bold text-[rgb(var(--fg-default))]"
              >
                Open {link.label}
              </a>
            ))}
          </div>
        </div>
      ) : delivery.withheldGoogleDriveLinkCount > 0 ? (
        <p className="mt-3 border-t border-[rgb(var(--border-subtle))] pt-3 text-[11.5px] text-[rgb(var(--fg-muted))]">
          Google Drive stems and extra deliverables stay locked until this purchase is fully paid.
        </p>
      ) : null}
    </section>
  );
}

function FrozenAgreement({
  terms,
  currency,
  headingId,
}: {
  terms: PaymentHistoryFrozenTerms;
  currency: string;
  headingId: string;
}) {
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <Eyebrow>Frozen terms</Eyebrow>
          <h4
            id={headingId}
            className="mt-1 text-[14px] font-extrabold break-words text-[rgb(var(--fg-default))]"
          >
            {terms.productName}
          </h4>
        </div>
        <p className="text-[10.5px] text-[rgb(var(--fg-muted))]">
          Frozen {formatDate(terms.frozenAtIso)}
        </p>
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="min-w-0 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] p-3">
          <p className="text-[11px] font-bold text-[rgb(var(--fg-default))]">Exact price</p>
          <ul className="mt-2 min-w-0 space-y-2">
            {terms.lineItems.map((lineItem) => (
              <li
                key={lineItem.id}
                className="flex min-w-0 items-start justify-between gap-3 text-[11.5px]"
              >
                <span className="min-w-0 break-words text-[rgb(var(--fg-secondary))]">
                  {lineItem.label} · {String(lineItem.quantity)} ×{" "}
                  {formatMoney(lineItem.unitPriceCents, currency, { withCents: true })}
                </span>
                <span className="shrink-0 font-mono font-bold text-[rgb(var(--fg-default))] tabular-nums">
                  {formatMoney(lineItem.totalCents, currency, { withCents: true })}
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 grid min-w-0 grid-cols-2 gap-2 border-t border-[rgb(var(--border-subtle))] pt-3 sm:grid-cols-4">
            <MoneyDatum label="Subtotal" cents={terms.subtotalCents} currency={currency} />
            <MoneyDatum label="Discount" cents={terms.discountCents} currency={currency} />
            <MoneyDatum label="Tax" cents={terms.taxCents} currency={currency} />
            <MoneyDatum label="Total" cents={terms.totalCents} currency={currency} />
          </dl>
        </div>

        <div className="min-w-0 space-y-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] p-3">
          {terms.detailRows.length > 0 ? (
            <div>
              <p className="text-[11px] font-bold text-[rgb(var(--fg-default))]">
                Accepted details
              </p>
              <dl className="mt-1.5 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                {terms.detailRows.map((detail) => (
                  <TextDatum key={detail.label} label={detail.label} value={detail.value} />
                ))}
              </dl>
            </div>
          ) : null}
          <TermList
            title="Deliverables"
            values={terms.deliverables}
            emptyCopy="No deliverables listed"
          />
          <TermList title="Rights" values={terms.rights} emptyCopy="No additional rights listed" />
          <div>
            <p className="text-[11px] font-bold text-[rgb(var(--fg-default))]">Exact agreement</p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
              {terms.agreementText ?? "No additional agreement text."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function AcceptanceAndPlan({
  acceptance,
  plan,
}: {
  acceptance: PaymentHistoryAcceptance;
  plan: PaymentHistoryPlan;
}) {
  return (
    <section
      className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"
      aria-label="Acceptance and plan"
    >
      <div className="min-w-0 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] p-3">
        <Eyebrow>Acceptance</Eyebrow>
        <p className="mt-2 text-[12px] font-bold text-[rgb(var(--fg-default))]">
          Accepted {formatDate(acceptance.acceptedAtIso)}
        </p>
        {acceptance.acceptedByLabel ? (
          <p className="mt-1 text-[11.5px] break-words text-[rgb(var(--fg-secondary))]">
            {acceptance.acceptedByLabel}
          </p>
        ) : null}
        {acceptance.statement ? (
          <p className="mt-1 text-[11.5px] leading-relaxed break-words text-[rgb(var(--fg-muted))]">
            {acceptance.statement}
          </p>
        ) : null}
      </div>
      <div className="min-w-0 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] p-3">
        <Eyebrow>Payment plan</Eyebrow>
        <p className="mt-2 text-[12px] font-bold break-words text-[rgb(var(--fg-default))]">
          {plan.label}
        </p>
        {plan.description ? (
          <p className="mt-1 text-[11.5px] leading-relaxed break-words text-[rgb(var(--fg-muted))]">
            {plan.description}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function InstallmentSchedule({
  schedule,
  currency,
  purchaseId,
  purchaseReference,
  role,
}: {
  schedule: readonly PaymentHistoryInstallment[];
  currency: string;
  purchaseId: string;
  purchaseReference: string;
  role: PaymentHistoryRole;
}) {
  return (
    <section aria-label="Payment schedule" className="min-w-0">
      <Eyebrow>Schedule</Eyebrow>
      {schedule.length === 0 ? (
        <p className="mt-2 text-[12px] text-[rgb(var(--fg-muted))]">
          No installments were created because this accepted purchase requires no payment.
        </p>
      ) : (
        <ol className="mt-2 min-w-0 space-y-2">
          {schedule.map((installment) => (
            <li
              key={installment.id}
              className="min-w-0 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] p-3"
            >
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12px] font-bold break-words text-[rgb(var(--fg-default))]">
                    {String(installment.position)}. {installment.label}
                  </p>
                  <p className="mt-0.5 text-[10.5px] break-words text-[rgb(var(--fg-muted))]">
                    {formatDate(installment.dueAtIso)} · {installment.trigger ?? "No trigger set"}
                  </p>
                </div>
                <StatusBadge status={installment.status} />
              </div>
              <dl className="mt-2 grid min-w-0 grid-cols-2 gap-2 border-t border-[rgb(var(--border-subtle))] pt-2 sm:grid-cols-4">
                <MoneyDatum label="Amount" cents={installment.amountCents} currency={currency} />
                <MoneyDatum label="Paid" cents={installment.paidCents} currency={currency} />
                <MoneyDatum label="Waived" cents={installment.waivedCents} currency={currency} />
                <MoneyDatum
                  label="Remaining"
                  cents={installment.remainingCents}
                  currency={currency}
                />
              </dl>
              {role === "producer" &&
              installment.remainingCents > 0 &&
              installment.dueAtIso !== null &&
              installment.status.label !== "Canceled" &&
              installment.status.label !== "Needs review" ? (
                <PaymentReminderButton
                  purchaseId={purchaseId}
                  installmentId={installment.id}
                  installmentLabel={`purchase ${purchaseReference}, installment ${String(installment.position)}: ${installment.label}`}
                />
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function PurchaseHistories({
  purchase,
  role,
}: {
  purchase: PaymentHistoryPurchase;
  role: PaymentHistoryRole;
}) {
  const hasHistory =
    purchase.proofs.length > 0 ||
    purchase.payments.length > 0 ||
    purchase.corrections.length > 0 ||
    purchase.waivers.length > 0 ||
    purchase.cancellations.length > 0 ||
    purchase.pauseHistory.length > 0 ||
    purchase.downloadOverrideHistory.length > 0;

  return (
    <section aria-label="Purchase history" className="min-w-0">
      <Eyebrow>History</Eyebrow>
      {!hasHistory ? (
        <p className="mt-2 text-[12px] text-[rgb(var(--fg-muted))]">
          No payment history has been recorded yet.
        </p>
      ) : (
        <div className="mt-2 grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
          {purchase.proofs.length > 0 ? (
            <HistoryGroup title="Proofs" count={purchase.proofs.length}>
              {purchase.proofs.map((proof) => (
                <HistoryItem
                  key={proof.id}
                  title={proof.originalFileName ?? "Payment proof"}
                  meta={`${proof.installmentLabel} · ${proofStatusLabel(proof.status)} · Submitted ${formatDate(proof.submittedAtIso)}`}
                  amount={<MoneyValue cents={proof.amountCents} currency={proof.currency} />}
                  note={proof.rejectionNote ?? proof.note}
                  action={
                    role === "producer" && proof.detailAvailable ? (
                      <Button
                        asChild
                        className="mt-2 w-full rounded-[var(--radius-sm)] sm:w-auto"
                        size="sm"
                        variant="outline"
                      >
                        <Link
                          href={`/dashboard/payments/${encodeURIComponent(proof.id)}`}
                          aria-label={`${proof.status === "pending" ? "Review" : "View"} proof ${
                            proof.originalFileName ?? proof.id
                          }`}
                        >
                          {proof.status === "pending" ? "Review proof" : "View proof"}
                        </Link>
                      </Button>
                    ) : null
                  }
                />
              ))}
            </HistoryGroup>
          ) : null}

          {purchase.payments.length > 0 ? (
            <HistoryGroup title="Payments" count={purchase.payments.length}>
              {purchase.payments.map((payment) => (
                <HistoryItem
                  key={payment.id}
                  title="Confirmed payment"
                  meta={`${payment.installmentLabel} · ${payment.sourceLabel} · ${formatDate(payment.paidAtIso)}`}
                  amount={<MoneyValue cents={payment.amountCents} currency={payment.currency} />}
                  note={payment.note}
                />
              ))}
            </HistoryGroup>
          ) : null}

          {purchase.corrections.length > 0 ? (
            <HistoryGroup title="Corrections" count={purchase.corrections.length}>
              {purchase.corrections.map((correction) => (
                <HistoryItem
                  key={correction.id}
                  title={correction.label}
                  meta={formatDate(correction.occurredAtIso)}
                  amount={
                    <MoneyValue
                      cents={correction.amountDeltaCents}
                      currency={correction.currency}
                    />
                  }
                  note={correction.reason}
                />
              ))}
            </HistoryGroup>
          ) : null}

          {purchase.waivers.length > 0 ? (
            <HistoryGroup title="Waivers" count={purchase.waivers.length}>
              {purchase.waivers.map((waiver) => (
                <HistoryItem
                  key={waiver.id}
                  title="Payment waived"
                  meta={`${waiver.installmentLabel} · ${formatDate(waiver.occurredAtIso)}`}
                  amount={<MoneyValue cents={waiver.amountCents} currency={waiver.currency} />}
                  note={waiver.reason}
                />
              ))}
            </HistoryGroup>
          ) : null}

          {purchase.cancellations.length > 0 ? (
            <HistoryGroup title="Cancellation" count={purchase.cancellations.length}>
              {purchase.cancellations.map((cancellation) => (
                <HistoryItem
                  key={cancellation.id}
                  title="Purchase canceled"
                  meta={formatDate(cancellation.occurredAtIso)}
                  note={cancellation.reason}
                />
              ))}
            </HistoryGroup>
          ) : null}

          {purchase.pauseHistory.length > 0 ? (
            <HistoryGroup title="Pause history" count={purchase.pauseHistory.length}>
              {purchase.pauseHistory.map((pause) => (
                <HistoryItem
                  key={pause.id}
                  title={pause.actionLabel}
                  meta={formatDate(pause.occurredAtIso)}
                  note={pause.reason}
                />
              ))}
            </HistoryGroup>
          ) : null}

          {purchase.downloadOverrideHistory.length > 0 ? (
            <HistoryGroup
              title="Download override history"
              count={purchase.downloadOverrideHistory.length}
            >
              {purchase.downloadOverrideHistory.map((override) => (
                <HistoryItem
                  key={override.id}
                  title={override.actionLabel}
                  meta={`${override.trackVersionLabel} · ${formatDate(override.occurredAtIso)}${
                    override.expiresAtIso ? ` · Expires ${formatDate(override.expiresAtIso)}` : ""
                  }`}
                  note={override.reason}
                />
              ))}
            </HistoryGroup>
          ) : null}
        </div>
      )}
    </section>
  );
}

function HistoryGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] p-3">
      <h5 className="text-[11px] font-bold tracking-[0.08em] text-[rgb(var(--fg-default))] uppercase">
        {title} ({String(count)})
      </h5>
      <ul className="mt-2 min-w-0 space-y-2">{children}</ul>
    </section>
  );
}

function HistoryItem({
  title,
  meta,
  amount,
  note,
  action,
}: {
  title: string;
  meta: string;
  amount?: ReactNode;
  note: string | null;
  action?: ReactNode;
}) {
  return (
    <li className="min-w-0 rounded-[var(--radius-sm)] bg-[rgb(var(--bg-elevated))] p-2.5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11.5px] font-bold break-words text-[rgb(var(--fg-default))]">
            {title}
          </p>
          <p className="mt-0.5 text-[10.5px] leading-relaxed break-words text-[rgb(var(--fg-muted))]">
            {meta}
          </p>
        </div>
        {amount ? <div className="shrink-0">{amount}</div> : null}
      </div>
      {note ? (
        <p className="mt-2 text-[11px] leading-relaxed break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
          {note}
        </p>
      ) : null}
      {action}
    </li>
  );
}

function StatusBadge({ status }: { status: PaymentHistoryStatus }) {
  return (
    <Badge className="shrink-0" dot variant={status.tone}>
      {status.label}
    </Badge>
  );
}

function MoneyDatum({
  label,
  cents,
  currency,
  danger = false,
}: {
  label: string;
  cents: number;
  currency: string;
  danger?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[9.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
        {label}
      </dt>
      <dd
        className="mt-0.5 font-mono text-[12px] font-bold break-words tabular-nums"
        style={{ color: danger ? "rgb(var(--fg-danger-text))" : "rgb(var(--fg-default))" }}
      >
        {formatMoney(cents, currency, { withCents: true })} <CurrencyCode value={currency} />
      </dd>
    </div>
  );
}

function PurchaseAmount({
  label,
  cents,
  currency,
  danger = false,
}: {
  label: string;
  cents: number;
  currency: string;
  danger?: boolean;
}) {
  return (
    <span className="min-w-0">
      <span className="block text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
        {label}
      </span>
      <span
        className="mt-0.5 block font-mono text-[11.5px] font-bold break-words tabular-nums"
        style={{ color: danger ? "rgb(var(--fg-danger-text))" : "rgb(var(--fg-default))" }}
      >
        {formatMoney(cents, currency, { withCents: true })} <CurrencyCode value={currency} />
      </span>
    </span>
  );
}

function MoneyValue({ cents, currency }: { cents: number; currency: string }) {
  return (
    <p className="font-mono text-[11.5px] font-bold text-[rgb(var(--fg-default))] tabular-nums">
      {formatMoney(cents, currency, { withCents: true })} <CurrencyCode value={currency} />
    </p>
  );
}

function CurrencyCode({ value }: { value: string }) {
  return <span className="text-[9px] text-[rgb(var(--fg-muted))]">{value}</span>;
}

function TextDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-[11.5px] leading-relaxed break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
        {value}
      </dd>
    </div>
  );
}

function TermList({
  title,
  values,
  emptyCopy,
}: {
  title: string;
  values: readonly string[];
  emptyCopy: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-bold text-[rgb(var(--fg-default))]">{title}</p>
      {values.length > 0 ? (
        <ul className="mt-1.5 min-w-0 list-disc space-y-1 pl-4 text-[11.5px] leading-relaxed text-[rgb(var(--fg-secondary))]">
          {values.map((value) => (
            <li key={value} className="break-words">
              {value}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-[11.5px] text-[rgb(var(--fg-muted))]">{emptyCopy}</p>
      )}
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
      {children}
    </p>
  );
}

function proofStatusLabel(status: PaymentHistoryProof["status"]): string {
  if (status === "confirmed") return "Confirmed";
  if (status === "rejected") return "Rejected";
  return "Needs review";
}

function formatDate(value: string | null): string {
  if (!value) return "No date set";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
