"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { PaymentHistoryPurchaseDetails } from "~/components/payments/payment-history";
import { PaymentReminderButton } from "~/components/payments/payment-reminder-button";
import { Badge } from "~/components/ui/badge";
import { formatMoney } from "~/lib/format/money";

import type { ClientPaymentProofData, ClientPaymentsData } from "./client-payments-data";
import {
  buildClientPaymentsView,
  type ClientPaymentCurrencySummary,
  type ClientPaymentProjectGroup,
  type ClientPaymentRow,
} from "./client-payments-model";

export type ClientPaymentsPanelState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; data: ClientPaymentsData }>;

const PROOF_STATUS_LABEL: Record<ClientPaymentProofData["status"], string> = {
  pending: "Needs review",
  confirmed: "Confirmed",
  rejected: "Rejected",
};

export function ClientPaymentsPanel({
  state,
  clientName,
}: {
  state: ClientPaymentsPanelState;
  clientName: string;
}) {
  if (state.status === "loading") return <ClientPaymentsLoading />;
  if (state.status === "error") return <ClientPaymentsError message={state.message} />;
  return <ClientPaymentsReady data={state.data} clientName={clientName} />;
}

function ClientPaymentsReady({
  data,
  clientName,
}: {
  data: ClientPaymentsData;
  clientName: string;
}) {
  const instanceId = useId().replaceAll(":", "");
  const view = useMemo(() => buildClientPaymentsView(data), [data]);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  if (!view.hasPayments) {
    return (
      <div
        role="status"
        className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-9 text-center"
      >
        <p className="text-[14px] font-extrabold text-[rgb(var(--fg-default))]">
          No payments yet for this Artist.
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <CurrencyLedger summaries={view.currencySummaries} />

      {view.allPaid ? (
        <div
          role="status"
          className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success)/0.2)] bg-[rgb(var(--fg-success)/0.07)] px-4 py-3"
        >
          <p className="text-[13px] font-extrabold text-[rgb(var(--fg-success-text))]">All paid</p>
          <p className="mt-0.5 text-[11.5px] text-[rgb(var(--fg-muted))]">
            {view.currencySummaries
              .map(
                (summary) =>
                  `${formatMoney(summary.paidAllTimeCents, summary.currency, {
                    withCents: true,
                  })} ${summary.currency} received`,
              )
              .join(" · ")}
          </p>
        </div>
      ) : view.noCurrentDebt ? (
        <div
          role="status"
          className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success)/0.18)] bg-[rgb(var(--fg-success)/0.06)] px-4 py-3 text-[13px] font-bold text-[rgb(var(--fg-success-text))]"
        >
          All payments are up to date.
        </div>
      ) : null}

      {view.currentGroups.length > 0 ? (
        <section aria-labelledby={`${instanceId}-current-heading`} className="min-w-0">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3
              id={`${instanceId}-current-heading`}
              className="text-[13px] font-extrabold text-[rgb(var(--fg-default))]"
            >
              Payments by project
            </h3>
            <span className="font-mono text-[9.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
              Current
            </span>
          </div>
          <ProjectGroups
            groups={view.currentGroups}
            instanceId={`${instanceId}-current`}
            expandedRowId={expandedRowId}
            onToggleRow={(rowId) => {
              setExpandedRowId((current) => (current === rowId ? null : rowId));
            }}
            producerTimeZone={data.producerTimeZone}
          />
        </section>
      ) : null}

      {view.historyGroups.length > 0 ? (
        <details
          data-testid="client-payment-history"
          className="group min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
        >
          <summary className="sk-press flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-lg)] px-4 py-3 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="block text-[13px] font-extrabold text-[rgb(var(--fg-default))]">
                History
              </span>
              <span className="mt-0.5 block text-[10.5px] text-[rgb(var(--fg-muted))]">
                Completed and closed payment records
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2 font-mono text-[10px] font-bold text-[rgb(var(--fg-muted))]">
              {String(view.historyGroups.reduce((sum, group) => sum + group.rows.length, 0))}
              <ChevronDown
                size={14}
                aria-hidden
                className="transition-transform group-open:rotate-180 motion-reduce:transition-none"
              />
            </span>
          </summary>
          <div className="border-t border-[rgb(var(--border-subtle))] p-2 sm:p-3">
            <ProjectGroups
              groups={view.historyGroups}
              instanceId={`${instanceId}-history`}
              expandedRowId={expandedRowId}
              onToggleRow={(rowId) => {
                setExpandedRowId((current) => (current === rowId ? null : rowId));
              }}
              producerTimeZone={data.producerTimeZone}
            />
          </div>
        </details>
      ) : null}

      <span className="sr-only">Payment records for {clientName}</span>
    </div>
  );
}

function CurrencyLedger({ summaries }: { summaries: readonly ClientPaymentCurrencySummary[] }) {
  return (
    <section aria-label="Client payment totals by currency" className="min-w-0 space-y-2">
      {summaries.map((summary) => (
        <div
          key={summary.currency}
          className="min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-l-[3px] border-[rgb(var(--border-subtle))] border-l-[rgb(var(--brand-copper))] bg-[rgb(var(--bg-elevated))]"
        >
          <div className="border-b border-[rgb(var(--border-subtle))] px-3 py-2.5 sm:px-4">
            <p className="font-mono text-[11px] font-extrabold tracking-[0.13em] text-[rgb(var(--fg-default))] uppercase">
              {summary.currency}
            </p>
          </div>
          <dl className="grid min-w-0 grid-cols-2 sm:grid-cols-4 sm:divide-x sm:divide-[rgb(var(--border-subtle))]">
            <SummaryAmount
              label="Paid all time"
              cents={summary.paidAllTimeCents}
              currency={summary.currency}
            />
            <SummaryAmount
              label="Owes now"
              cents={summary.owesNowCents}
              currency={summary.currency}
              danger={summary.owesNowCents > 0}
            />
            <SummaryAmount
              label="Expected this month"
              cents={summary.expectedThisMonthCents}
              currency={summary.currency}
            />
            <SummaryAmount
              label="Waiting on milestones"
              cents={summary.waitingOnMilestonesCents}
              currency={summary.currency}
            />
          </dl>
        </div>
      ))}
    </section>
  );
}

function SummaryAmount({
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
    <div className="min-w-0 border-b border-[rgb(var(--border-subtle))] px-3 py-3 odd:border-r sm:border-r-0 sm:border-b-0 sm:px-4">
      <dt className="text-[8.5px] leading-tight font-bold tracking-[0.075em] text-[rgb(var(--fg-muted))] uppercase">
        {label}
      </dt>
      <dd
        className={`mt-1.5 min-w-0 font-mono text-[12px] leading-tight font-extrabold [overflow-wrap:anywhere] tabular-nums ${
          danger ? "text-[rgb(var(--fg-danger))]" : "text-[rgb(var(--fg-default))]"
        }`}
      >
        {formatMoney(cents, currency, { withCents: true })}{" "}
        <span className="text-[8.5px] tracking-[0.08em] text-[rgb(var(--fg-muted))]">
          {currency}
        </span>
      </dd>
    </div>
  );
}

function ProjectGroups({
  groups,
  instanceId,
  expandedRowId,
  onToggleRow,
  producerTimeZone,
}: {
  groups: readonly ClientPaymentProjectGroup[];
  instanceId: string;
  expandedRowId: string | null;
  onToggleRow: (rowId: string) => void;
  producerTimeZone: string;
}) {
  return (
    <div className="min-w-0 space-y-3">
      {groups.map((group) => (
        <section
          key={group.project.id}
          aria-labelledby={`${instanceId}-project-${group.project.id}`}
          className="min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
        >
          <header className="flex min-w-0 items-center justify-between gap-3 border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-3 py-2.5 sm:px-4">
            <Link
              data-tab-swipe-ignore
              href={`/dashboard/clients-projects/${encodeURIComponent(group.project.id)}`}
              id={`${instanceId}-project-${group.project.id}`}
              className="min-w-0 truncate text-[12.5px] font-extrabold text-[rgb(var(--fg-default))] underline-offset-4 hover:underline focus-visible:rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
            >
              {group.project.title}
            </Link>
            <Badge variant={group.project.status.tone}>{group.project.status.label}</Badge>
          </header>
          <ul className="min-w-0 divide-y divide-[rgb(var(--border-subtle))]">
            {group.rows.map((row) => (
              <PaymentRow
                key={row.id}
                row={row}
                detailsId={`${instanceId}-row-${row.id.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`}
                expanded={expandedRowId === row.id}
                onToggle={() => {
                  onToggleRow(row.id);
                }}
                producerTimeZone={producerTimeZone}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PaymentRow({
  row,
  detailsId,
  expanded,
  onToggle,
  producerTimeZone,
}: {
  row: ClientPaymentRow;
  detailsId: string;
  expanded: boolean;
  onToggle: () => void;
  producerTimeZone: string;
}) {
  return (
    <li data-testid={`client-payment-row-${row.installment.id}`} className="min-w-0">
      <div className="grid min-w-0 gap-3 px-3 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-4">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="min-w-0 text-[13px] font-extrabold break-words text-[rgb(var(--fg-default))]">
              {row.purchase.title} · {row.installment.label}
            </p>
            <Badge variant={row.installment.statusPresentation.tone}>
              {row.installment.statusPresentation.label}
            </Badge>
          </div>
          <p className="mt-1 font-mono text-[9.5px] font-semibold tracking-[0.06em] break-all text-[rgb(var(--fg-muted))]">
            {row.purchase.reference}
          </p>
          <dl className="mt-2 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-[auto_auto_minmax(0,1fr)]">
            <RowDatum
              label="Amount"
              value={`${formatMoney(row.installment.amountCents, row.installment.currency, {
                withCents: true,
              })} ${row.installment.currency}`}
            />
            <RowDatum
              label="Remaining"
              value={`${formatMoney(row.installment.remainingCents, row.installment.currency, {
                withCents: true,
              })} ${row.installment.currency}`}
            />
            <RowDatum
              label="Timing"
              value={paymentTiming(row, producerTimeZone)}
              className="col-span-2 sm:col-span-1"
            />
          </dl>
          {row.proofs.length > 0 ? <AttachedProofs proofs={row.proofs} /> : null}
        </div>

        <PrimaryAction row={row} detailsId={detailsId} expanded={expanded} onToggle={onToggle} />
      </div>

      {expanded ? (
        <div
          id={detailsId}
          data-tab-swipe-ignore
          className="border-t border-[rgb(var(--border-subtle))]"
        >
          <PaymentHistoryPurchaseDetails
            purchase={row.purchase.details}
            role="producer"
            idPrefix={`${detailsId}-purchase`}
            showPaymentAction={false}
          />
        </div>
      ) : null}
    </li>
  );
}

function RowDatum({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-[8.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 min-w-0 text-[10.5px] font-semibold [overflow-wrap:anywhere] text-[rgb(var(--fg-secondary))]">
        {value}
      </dd>
    </div>
  );
}

function AttachedProofs({ proofs }: { proofs: readonly ClientPaymentProofData[] }) {
  return (
    <ul
      aria-label="Proofs attached to this payment"
      className="mt-2 min-w-0 space-y-1 border-l-2 border-[rgb(var(--brand-copper)/0.35)] pl-2"
    >
      {proofs.map((proof, index) => (
        <li key={proof.id} className="min-w-0 text-[10.5px] text-[rgb(var(--fg-muted))]">
          {index === 0 ? (
            <span className="break-words">
              {proof.originalFileName ?? "Payment proof"} · {PROOF_STATUS_LABEL[proof.status]}
            </span>
          ) : (
            <Link
              data-tab-swipe-ignore
              href={`/dashboard/payments/${encodeURIComponent(proof.id)}`}
              className="break-words underline underline-offset-2 focus-visible:rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
            >
              Earlier proof: {proof.originalFileName ?? proof.id} ·{" "}
              {PROOF_STATUS_LABEL[proof.status]}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

function PrimaryAction({
  row,
  detailsId,
  expanded,
  onToggle,
}: {
  row: ClientPaymentRow;
  detailsId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const commonClass =
    "sk-press inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border px-3 text-[11px] font-bold focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:w-auto sm:min-w-[112px] sm:rounded-[var(--radius-md)]";

  if (row.action.kind === "open_proof") {
    return (
      <Link
        data-client-payment-primary-action
        data-tab-swipe-ignore
        href={`/dashboard/payments/${encodeURIComponent(row.action.proofId)}`}
        aria-label={`Open proof for ${row.purchase.title}, ${row.installment.label}`}
        className={`${commonClass} border-[rgb(var(--brand-copper)/0.35)] bg-[rgb(var(--brand-copper)/0.08)] text-[rgb(var(--brand-copper))]`}
      >
        Open proof
        <ExternalLink size={12} aria-hidden />
      </Link>
    );
  }

  if (row.action.kind === "send_reminder") {
    return (
      <div
        data-client-payment-primary-action
        data-tab-swipe-ignore
        className="min-w-0 [&_button]:sm:min-w-[112px] [&>div]:mt-0"
      >
        <PaymentReminderButton
          purchaseId={row.purchase.id}
          installmentId={row.installment.id}
          installmentLabel={`${row.purchase.reference}, ${row.installment.label}`}
        />
      </div>
    );
  }

  const record = row.action.kind === "view_record";
  return (
    <button
      type="button"
      data-client-payment-primary-action
      data-tab-swipe-ignore
      aria-expanded={expanded}
      aria-controls={detailsId}
      onClick={onToggle}
      className={`${commonClass} border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))]`}
    >
      {expanded
        ? record
          ? "Hide record"
          : "Hide details"
        : record
          ? "View record"
          : "View details"}
    </button>
  );
}

function paymentTiming(row: ClientPaymentRow, producerTimeZone: string): string {
  if (row.installment.dueAtIso) {
    const date = new Date(row.installment.dueAtIso);
    if (!Number.isNaN(date.getTime())) {
      return `Due ${new Intl.DateTimeFormat("en", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: producerTimeZone,
      }).format(date)}`;
    }
  }
  return row.installment.triggerLabel ?? "No date yet";
}

function ClientPaymentsLoading() {
  return (
    <div role="status" aria-label="Loading payments" className="min-w-0 space-y-2">
      <span className="sr-only">Loading payments…</span>
      <div
        aria-hidden
        className="h-28 animate-pulse rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] motion-reduce:animate-none"
      />
      <div
        aria-hidden
        className="h-24 animate-pulse rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] motion-reduce:animate-none"
      />
    </div>
  );
}

function ClientPaymentsError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.24)] bg-[rgb(var(--fg-danger)/0.06)] px-4 py-4"
    >
      <p className="text-[13px] font-extrabold text-[rgb(var(--fg-danger-text))]">
        Couldn’t load payments.
      </p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">{message}</p>
    </div>
  );
}
