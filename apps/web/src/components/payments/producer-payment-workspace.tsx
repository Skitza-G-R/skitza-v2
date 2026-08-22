"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { PaymentHistoryPurchaseDetails } from "~/components/payments/payment-history";
import {
  buildPaymentWorkspaceRows,
  filterPaymentWorkspaceRows,
  groupPaymentWorkspaceRows,
  isPaymentWorkspaceDateRangeValid,
  summarizePaymentWorkspaceRows,
  workspaceViewCount,
  type PaymentWorkspaceBucket,
  type PaymentWorkspaceGroup,
  type PaymentWorkspaceRow,
  type PaymentWorkspaceView,
} from "~/components/payments/producer-payment-workspace-model";
import { Badge } from "~/components/ui/badge";
import { ListSearchInput, useListSearch } from "~/components/ui/list-search";
import { cn } from "~/lib/cn";
import { formatMoney } from "~/lib/format/money";

export interface ProducerPaymentWorkspaceProps {
  buckets: readonly PaymentWorkspaceBucket[];
  defaultView?: PaymentWorkspaceView;
  scope: "global" | "client";
  clientLabel?: string;
  presentation?: "client-tab";
}

interface ViewOption {
  value: PaymentWorkspaceView;
  label: string;
}

const ALL_VIEW: ViewOption = { value: "all", label: "All records" };

const CORE_VIEWS: readonly ViewOption[] = [
  { value: "open", label: "Open" },
  { value: "needs_review", label: "Needs review" },
  { value: "due_or_overdue", label: "Due" },
  { value: "upcoming", label: "Upcoming" },
  { value: "history", label: "History" },
];

const dateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

function safeDomId(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_-]/g, "-");
}

function pendingProof(row: PaymentWorkspaceRow) {
  return row.purchase.proofs.find((proof) => proof.status === "pending") ?? null;
}

function nextPaymentCopy(row: PaymentWorkspaceRow): {
  amount: string;
  timing: string;
} | null {
  const nextPayment = row.purchase.nextPayment;
  if (!nextPayment) return null;

  return {
    amount: `${formatMoney(nextPayment.amountCents, row.purchase.currency, {
      withCents: true,
    })} ${row.purchase.currency}`,
    timing: nextPayment.dueAtIso
      ? formatDate(nextPayment.dueAtIso)
      : (nextPayment.trigger ?? "No date or trigger set"),
  };
}

function MoneyText({
  cents,
  currency,
  danger = false,
  compactAtDesktop = false,
}: {
  cents: number;
  currency: string;
  danger?: boolean;
  compactAtDesktop?: boolean;
}) {
  return (
    <span
      data-payment-money=""
      className={cn(
        "inline-block max-w-full min-w-0 font-mono text-[clamp(10px,3vw,12px)] leading-[1.15] font-bold [overflow-wrap:anywhere] tabular-nums xl:max-w-none xl:[overflow-wrap:normal]",
        compactAtDesktop && "xl:text-[11px]",
        danger && cents > 0 ? "text-[rgb(var(--fg-danger))]" : "text-[rgb(var(--fg-default))]",
      )}
    >
      <span data-payment-money-value="" className="whitespace-nowrap">
        {formatMoney(cents, currency, { withCents: true })}
      </span>{" "}
      <span className="text-[9px] tracking-[0.08em] whitespace-nowrap text-[rgb(var(--fg-muted))]">
        {currency}
      </span>
    </span>
  );
}

function ProjectBand({ row, purchaseCount }: { row: PaymentWorkspaceRow; purchaseCount: number }) {
  const project = row.project;

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-3 border-l-[3px] border-l-[rgb(var(--brand-copper))] bg-[rgb(var(--bg-sunken))] px-3 py-3 xl:flex-row xl:items-center xl:justify-between xl:px-4 xl:py-2.5">
      <div className="min-w-0">
        <p className="font-mono text-[9px] font-bold tracking-[0.13em] text-[rgb(var(--fg-muted))] uppercase">
          Project
        </p>
        <Link
          href={`/dashboard/clients-projects/${encodeURIComponent(project.id)}`}
          className="mt-0.5 inline-block max-w-full truncate text-[13px] font-extrabold text-[rgb(var(--fg-default))] underline-offset-4 hover:underline focus-visible:rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
        >
          {project.title}
        </Link>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 xl:justify-start">
        <span className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
          {pluralize(purchaseCount, "purchase")}
        </span>
        <Badge variant={project.status.tone}>{project.status.label}</Badge>
      </div>
    </div>
  );
}

function SummaryPanel({
  rows,
  openCount,
  needsReviewCount,
  headingId,
  outstandingFirst = false,
}: {
  rows: readonly PaymentWorkspaceRow[];
  openCount: number;
  needsReviewCount: number;
  headingId: string;
  outstandingFirst?: boolean;
}) {
  const summary = summarizePaymentWorkspaceRows(rows);

  return (
    <section
      aria-labelledby={headingId}
      data-payment-summary=""
      className="overflow-hidden border-y border-[rgb(var(--border-subtle))]"
    >
      <header className="flex min-w-0 flex-col gap-1 border-b border-[rgb(var(--border-subtle))] px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[9px] font-bold tracking-[0.14em] text-[rgb(var(--brand-primary-text))] uppercase">
            Ledger
          </p>
          <h2
            id={headingId}
            className="font-display mt-0.5 text-[20px] font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]"
          >
            Money at a glance
          </h2>
        </div>
        <p className="text-[11px] font-semibold text-[rgb(var(--fg-muted))]">
          {pluralize(openCount, "open purchase")} ·{" "}
          {pluralize(needsReviewCount, "needs review", "need review")}
        </p>
      </header>

      {summary.currencyTotals.length > 0 ? (
        <div className="divide-y divide-[rgb(var(--border-subtle))]">
          {summary.currencyTotals.map((total) => (
            <div
              key={total.currency}
              className="grid min-w-0 gap-3 px-4 py-3 sm:grid-cols-[minmax(90px,0.55fr)_minmax(0,2fr)] sm:items-center"
            >
              <div className="min-w-0">
                <p className="font-mono text-[12px] font-extrabold tracking-[0.12em] text-[rgb(var(--fg-default))] uppercase">
                  {total.currency}
                </p>
                <p className="mt-0.5 text-[10px] text-[rgb(var(--fg-muted))]">
                  {pluralize(total.purchaseCount, "purchase")}
                </p>
              </div>
              <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 sm:gap-5">
                {outstandingFirst ? (
                  <>
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <dt className="text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                        Outstanding
                      </dt>
                      <dd className="mt-1">
                        <MoneyText
                          cents={total.totalRemainingCents}
                          currency={total.currency}
                          danger
                        />
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                        Due now
                      </dt>
                      <dd className="mt-1">
                        <MoneyText cents={total.dueNowCents} currency={total.currency} danger />
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                        Paid to date
                      </dt>
                      <dd className="mt-1">
                        <MoneyText cents={total.paidCents} currency={total.currency} />
                      </dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <dt className="text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                        Paid to date
                      </dt>
                      <dd className="mt-1">
                        <MoneyText cents={total.paidCents} currency={total.currency} />
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                        Due now
                      </dt>
                      <dd className="mt-1">
                        <MoneyText cents={total.dueNowCents} currency={total.currency} danger />
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                        Total remaining
                      </dt>
                      <dd className="mt-1">
                        <MoneyText cents={total.totalRemainingCents} currency={total.currency} />
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-4 py-4 text-[12px] text-[rgb(var(--fg-muted))]">
          No money is included in this view.
        </p>
      )}
    </section>
  );
}

function ResponsivePurchaseRow({
  row,
  scope,
  expanded,
  detailsId,
  onToggle,
}: {
  row: PaymentWorkspaceRow;
  scope: ProducerPaymentWorkspaceProps["scope"];
  expanded: boolean;
  detailsId: string;
  onToggle: () => void;
}) {
  const purchase = row.purchase;
  const nextPayment = nextPaymentCopy(row);
  const proof = pendingProof(row);

  return (
    <>
      <tr className="grid min-w-0 grid-cols-12 border-b border-[rgb(var(--border-subtle))] px-3 py-3 last:border-b-0 xl:table-row xl:p-0">
        <th
          scope="row"
          className="order-1 col-span-8 min-w-0 pr-2 pb-2 text-left align-top xl:table-cell xl:min-w-[180px] xl:px-4 xl:py-3"
        >
          <p className="text-[13px] font-extrabold break-words text-[rgb(var(--fg-default))] xl:text-[12.5px]">
            {purchase.title}
          </p>
          <p className="mt-1 font-mono text-[9.5px] font-semibold tracking-[0.07em] break-all text-[rgb(var(--fg-muted))]">
            {purchase.counterpartyLabel ? (
              <span className="font-sans tracking-normal xl:hidden">
                {purchase.counterpartyLabel} ·{" "}
              </span>
            ) : null}
            {purchase.reference}
          </p>
        </th>
        {scope === "global" ? (
          <td className="hidden min-w-[130px] px-4 py-3 align-top text-[12px] font-semibold break-words text-[rgb(var(--fg-secondary))] xl:table-cell">
            {purchase.counterpartyLabel ?? "Client unavailable"}
          </td>
        ) : null}
        <td className="order-2 col-span-4 flex justify-end pb-2 align-top xl:table-cell xl:px-4 xl:py-3">
          <Badge variant={purchase.status.tone}>{purchase.status.label}</Badge>
        </td>
        <td className="order-6 col-span-5 min-w-0 pt-2.5 pr-2 align-top xl:table-cell xl:min-w-[150px] xl:px-4 xl:py-3">
          <p className="text-[8.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase xl:hidden">
            Next payment
          </p>
          {nextPayment ? (
            <>
              <p className="mt-1 font-mono text-[11px] font-bold break-words text-[rgb(var(--fg-default))] tabular-nums xl:mt-0 xl:[overflow-wrap:normal] xl:whitespace-nowrap">
                {nextPayment.amount}
              </p>
              <p className="mt-0.5 text-[10px] leading-snug break-words text-[rgb(var(--fg-muted))] xl:mt-1 xl:text-[10.5px]">
                {nextPayment.timing}
              </p>
            </>
          ) : (
            <span className="mt-1 block text-[10.5px] text-[rgb(var(--fg-muted))] xl:mt-0 xl:text-[11px]">
              None scheduled
            </span>
          )}
        </td>
        <td className="order-3 col-span-6 min-w-0 border-y border-[rgb(var(--border-subtle))] py-2.5 pr-1 align-top sm:col-span-4 xl:table-cell xl:min-w-[110px] xl:border-0 xl:px-2 xl:py-3 xl:text-right">
          <p className="text-[8.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase xl:hidden">
            Paid
          </p>
          <div className="mt-1 xl:mt-0">
            <MoneyText cents={purchase.paidCents} currency={purchase.currency} compactAtDesktop />
          </div>
        </td>
        <td className="order-4 col-span-6 min-w-0 border-y border-[rgb(var(--border-subtle))] px-1 py-2.5 align-top sm:col-span-4 xl:table-cell xl:min-w-[110px] xl:border-0 xl:px-2 xl:py-3 xl:text-right">
          <p className="text-[8.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase xl:hidden">
            Due now
          </p>
          <div className="mt-1 xl:mt-0">
            <MoneyText
              cents={purchase.dueNowCents}
              currency={purchase.currency}
              danger
              compactAtDesktop
            />
          </div>
        </td>
        <td className="order-5 col-span-12 min-w-0 border-b border-[rgb(var(--border-subtle))] py-2.5 align-top sm:col-span-4 sm:border-y sm:pl-1 xl:table-cell xl:min-w-[110px] xl:border-0 xl:px-2 xl:py-3 xl:text-right">
          <p className="text-[8.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase xl:hidden">
            Remaining
          </p>
          <div className="mt-1 xl:mt-0">
            <MoneyText
              cents={purchase.totalRemainingCents}
              currency={purchase.currency}
              compactAtDesktop
            />
          </div>
        </td>
        <td className="order-7 col-span-7 pt-2.5 text-right align-top xl:table-cell xl:px-4 xl:py-2">
          <div className="flex min-w-0 items-center justify-end gap-2 xl:min-w-[112px] xl:flex-col xl:items-stretch xl:gap-1.5">
            {proof ? (
              <Link
                href={`/dashboard/payments/${encodeURIComponent(proof.id)}`}
                aria-label={`Review proof for ${purchase.title}`}
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--brand-copper)/0.35)] bg-[rgb(var(--brand-copper)/0.08)] px-3 text-[11px] font-bold text-[rgb(var(--brand-copper))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none xl:min-h-9 xl:rounded-[var(--radius-md)] xl:px-2.5"
              >
                Review proof
              </Link>
            ) : null}
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={detailsId}
              aria-label={`${expanded ? "Hide" : "Show"} details for ${purchase.title}`}
              onClick={onToggle}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-3 text-[11px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none xl:min-h-9 xl:rounded-[var(--radius-md)] xl:px-2.5"
            >
              {expanded ? "Hide details" : "Details"}
            </button>
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className="block xl:table-row">
          <td colSpan={scope === "global" ? 8 : 7} className="block p-0 xl:table-cell">
            <div id={detailsId} className="border-t border-[rgb(var(--border-subtle))]">
              <PaymentHistoryPurchaseDetails
                purchase={purchase}
                role="producer"
                idPrefix={`${detailsId}-content`}
              />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function PaymentProofActionRow({
  row,
  expanded,
  detailsId,
  onToggle,
}: {
  row: PaymentWorkspaceRow;
  expanded: boolean;
  detailsId: string;
  onToggle: () => void;
}) {
  const purchase = row.purchase;
  const proof = pendingProof(row);

  return (
    <li className="min-w-0 border-b border-[rgb(var(--border-subtle))] last:border-b-0">
      <div className="grid min-w-0 gap-3 px-1 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant={purchase.status.tone}>{purchase.status.label}</Badge>
            <Link
              href={`/dashboard/clients-projects/${encodeURIComponent(row.project.id)}`}
              className="font-mono text-[9.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase underline-offset-4 hover:underline focus-visible:rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
            >
              {row.project.title}
            </Link>
          </div>
          <p className="mt-2 text-[14px] font-extrabold break-words text-[rgb(var(--fg-default))]">
            {purchase.title}
          </p>
          <p className="mt-1 text-[11px] text-[rgb(var(--fg-muted))]">
            {purchase.counterpartyLabel ?? "Client unavailable"} · {purchase.reference}
          </p>
          {proof ? (
            <p className="mt-2 text-[11px] font-semibold text-[rgb(var(--fg-secondary))]">
              {formatMoney(proof.amountCents, proof.currency, { withCents: true })} {proof.currency}
              {proof.submittedAtIso ? ` · submitted ${formatDate(proof.submittedAtIso)}` : ""}
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          {proof ? (
            <Link
              href={`/dashboard/payments/${encodeURIComponent(proof.id)}`}
              aria-label={`Review proof for ${purchase.title}`}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--brand-copper)/0.35)] bg-[rgb(var(--brand-copper)/0.08)] px-3 text-[11px] font-bold text-[rgb(var(--brand-copper))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
            >
              Review proof
            </Link>
          ) : null}
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-label={`${expanded ? "Hide" : "Show"} details for ${purchase.title}`}
            onClick={onToggle}
            className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-3 text-[11px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
          >
            {expanded ? "Hide details" : "Details"}
          </button>
        </div>
      </div>
      {expanded ? (
        <div id={detailsId} className="border-t border-[rgb(var(--border-subtle))]">
          <PaymentHistoryPurchaseDetails
            purchase={purchase}
            role="producer"
            idPrefix={`${detailsId}-content`}
          />
        </div>
      ) : null}
    </li>
  );
}

function PaymentProofActions({
  rows,
  instanceId,
  expandedPurchaseId,
  onToggleDetails,
}: {
  rows: readonly PaymentWorkspaceRow[];
  instanceId: string;
  expandedPurchaseId: string | null;
  onToggleDetails: (purchaseId: string) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <section
      aria-label="Payment proof actions"
      className="min-w-0 border-y border-[rgb(var(--border-strong))]"
    >
      <header className="flex min-w-0 flex-col gap-1 px-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:px-3">
        <div>
          <p className="font-mono text-[9px] font-bold tracking-[0.14em] text-[rgb(var(--brand-primary-text))] uppercase">
            Action queue
          </p>
          <h2 className="font-display mt-0.5 text-[20px] font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]">
            Needs review
          </h2>
        </div>
        <p className="text-[11px] font-semibold text-[rgb(var(--fg-muted))]">
          {pluralize(rows.length, "proof")}
        </p>
      </header>
      <ul className="border-t border-[rgb(var(--border-subtle))]">
        {rows.map((row) => {
          const detailsId = `${instanceId}-desktop-details-${safeDomId(row.id)}`;
          return (
            <PaymentProofActionRow
              key={row.id}
              row={row}
              expanded={expandedPurchaseId === row.id}
              detailsId={detailsId}
              onToggle={() => {
                onToggleDetails(row.id);
              }}
            />
          );
        })}
      </ul>
    </section>
  );
}

function renderPaymentRecordsTable({
  groups,
  scope,
  tableCaption,
  instanceId,
  detailsIdSegment,
  expandedPurchaseId,
  onToggleDetails,
}: {
  groups: readonly PaymentWorkspaceGroup[];
  scope: ProducerPaymentWorkspaceProps["scope"];
  tableCaption: string;
  instanceId: string;
  detailsIdSegment?: string;
  expandedPurchaseId: string | null;
  onToggleDetails: (purchaseId: string) => void;
}) {
  return (
    <div className="max-w-full min-w-0 xl:overflow-x-auto xl:rounded-[var(--radius-lg)] xl:border xl:border-[rgb(var(--border-subtle))] xl:bg-[rgb(var(--bg-elevated))]">
      <table className="block w-full min-w-0 border-collapse text-left xl:table xl:min-w-[980px]">
        <caption className="sr-only">{tableCaption}</caption>
        <thead className="hidden xl:table-header-group">
          <tr className="border-b border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-background))]">
            <th
              scope="col"
              className="px-4 py-2.5 text-[9px] font-bold tracking-[0.11em] text-[rgb(var(--fg-muted))] uppercase"
            >
              Purchase
            </th>
            {scope === "global" ? (
              <th
                scope="col"
                className="px-4 py-2.5 text-[9px] font-bold tracking-[0.11em] text-[rgb(var(--fg-muted))] uppercase"
              >
                Client
              </th>
            ) : null}
            <th
              scope="col"
              className="px-4 py-2.5 text-[9px] font-bold tracking-[0.11em] text-[rgb(var(--fg-muted))] uppercase"
            >
              Status
            </th>
            <th
              scope="col"
              className="px-4 py-2.5 text-[9px] font-bold tracking-[0.11em] text-[rgb(var(--fg-muted))] uppercase"
            >
              Next payment
            </th>
            {["Paid", "Due now", "Remaining"].map((label) => (
              <th
                key={label}
                scope="col"
                className="px-4 py-2.5 text-right text-[9px] font-bold tracking-[0.11em] text-[rgb(var(--fg-muted))] uppercase"
              >
                {label}
              </th>
            ))}
            <th
              scope="col"
              className="px-4 py-2.5 text-right text-[9px] font-bold tracking-[0.11em] text-[rgb(var(--fg-muted))] uppercase"
            >
              Details
            </th>
          </tr>
        </thead>
        {groups.map((group) => {
          const firstRow = group.rows[0];
          if (!firstRow) return null;

          return (
            <tbody
              key={group.project.id}
              data-payment-project-group=""
              className="mb-5 block min-w-0 border-t border-[rgb(var(--border-subtle))] last:mb-0 xl:table-row-group xl:border-0"
            >
              <tr className="block xl:table-row">
                <th
                  scope="rowgroup"
                  colSpan={scope === "global" ? 8 : 7}
                  className="block p-0 text-left xl:table-cell"
                >
                  <ProjectBand row={firstRow} purchaseCount={group.rows.length} />
                </th>
              </tr>
              {group.rows.map((row) => {
                const expanded = expandedPurchaseId === row.id;
                const detailsId = `${instanceId}${
                  detailsIdSegment ? `-${detailsIdSegment}` : ""
                }-desktop-details-${safeDomId(row.id)}`;
                return (
                  <ResponsivePurchaseRow
                    key={row.id}
                    row={row}
                    scope={scope}
                    expanded={expanded}
                    detailsId={detailsId}
                    onToggle={() => {
                      onToggleDetails(row.id);
                    }}
                  />
                );
              })}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

export function ProducerPaymentWorkspace({
  buckets,
  defaultView = "open",
  scope,
  clientLabel,
  presentation,
}: ProducerPaymentWorkspaceProps) {
  const instanceId = safeDomId(useId());
  const search = useListSearch();
  const clientTabPresentation = presentation === "client-tab";
  const initialView: PaymentWorkspaceView = clientTabPresentation ? "open" : defaultView;
  const [view, setView] = useState<PaymentWorkspaceView>(initialView);
  const [currency, setCurrency] = useState("all");
  const [projectId, setProjectId] = useState("all");
  const [counterpartyId, setCounterpartyId] = useState("all");
  const [establishedFrom, setEstablishedFrom] = useState("");
  const [establishedTo, setEstablishedTo] = useState("");
  const [advancedFiltersExpanded, setAdvancedFiltersExpanded] = useState(false);
  const [expandedPurchaseId, setExpandedPurchaseId] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const allRows = useMemo(() => buildPaymentWorkspaceRows(buckets), [buckets]);
  const allSummary = useMemo(() => summarizePaymentWorkspaceRows(allRows), [allRows]);
  const currencyOptions = useMemo(
    () => [...new Set(allRows.map((row) => row.purchase.currency))].sort(),
    [allRows],
  );
  const projectOptions = useMemo(() => {
    const projects = new Map<string, string>();
    for (const row of allRows) {
      if (!projects.has(row.project.id)) projects.set(row.project.id, row.project.title);
    }
    return [...projects].map(([id, title]) => ({ id, title }));
  }, [allRows]);
  const artistOptions = useMemo(() => {
    const artists = new Map<string, string>();
    for (const row of allRows) {
      const id = row.purchase.counterpartyId;
      if (!id || artists.has(id)) continue;
      artists.set(id, row.purchase.counterpartyLabel ?? "Artist unavailable");
    }
    return [...artists]
      .map(([id, label]) => ({ id, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [allRows]);

  const dateRangeValid = isPaymentWorkspaceDateRangeValid(establishedFrom, establishedTo);
  const scopeFilteredRows = useMemo(
    () =>
      filterPaymentWorkspaceRows(allRows, {
        view: "all",
        query: search.value,
        currency,
        projectId,
        counterpartyId,
        establishedFrom,
        establishedTo,
      }),
    [establishedFrom, establishedTo, allRows, counterpartyId, currency, projectId, search.value],
  );
  const scopeSummary = useMemo(
    () => summarizePaymentWorkspaceRows(scopeFilteredRows),
    [scopeFilteredRows],
  );
  const visibleSummary = scope === "global" ? scopeSummary : allSummary;
  const viewCountRows = scope === "global" ? scopeFilteredRows : allRows;

  const filteredRows = useMemo(
    () =>
      filterPaymentWorkspaceRows(allRows, {
        view,
        query: search.value,
        currency,
        projectId,
        counterpartyId,
        establishedFrom,
        establishedTo,
      }),
    [
      establishedFrom,
      establishedTo,
      allRows,
      counterpartyId,
      currency,
      projectId,
      search.value,
      view,
    ],
  );
  const actionRows = useMemo(
    () => (scope === "global" ? filteredRows.filter((row) => row.bucketId === "needs_review") : []),
    [filteredRows, scope],
  );
  const recordRows = useMemo(
    () =>
      scope === "global"
        ? filteredRows.filter((row) => row.bucketId !== "needs_review")
        : filteredRows,
    [filteredRows, scope],
  );
  const groups = useMemo(() => groupPaymentWorkspaceRows(recordRows), [recordRows]);
  const historyRows = useMemo(
    () =>
      clientTabPresentation
        ? filterPaymentWorkspaceRows(allRows, {
            view: "history",
            query: search.value,
            currency,
            projectId,
            counterpartyId: "all",
            establishedFrom: "",
            establishedTo: "",
          })
        : [],
    [allRows, clientTabPresentation, currency, projectId, search.value],
  );
  const historyGroups = useMemo(() => groupPaymentWorkspaceRows(historyRows), [historyRows]);

  const viewOptions = clientTabPresentation
    ? CORE_VIEWS.filter((option) => option.value !== "history")
    : scope === "client"
      ? [ALL_VIEW, ...CORE_VIEWS]
      : CORE_VIEWS;
  const filtersChanged =
    view !== initialView ||
    search.value.trim().length > 0 ||
    currency !== "all" ||
    projectId !== "all" ||
    counterpartyId !== "all" ||
    establishedFrom.length > 0 ||
    establishedTo.length > 0;
  const emptyDefaultView = !filtersChanged && filteredRows.length === 0;
  const tableCaption =
    scope === "client"
      ? `${clientLabel ?? "Client"} payment records grouped by project`
      : "Payment records grouped by project and client";

  function clearFilters() {
    setView(initialView);
    search.setValue("");
    setCurrency("all");
    setProjectId("all");
    setCounterpartyId("all");
    setEstablishedFrom("");
    setEstablishedTo("");
    setAdvancedFiltersExpanded(false);
    setExpandedPurchaseId(null);
    setHistoryExpanded(false);
  }

  function toggleDetails(purchaseId: string) {
    setExpandedPurchaseId((current) => (current === purchaseId ? null : purchaseId));
  }

  return (
    <div className="min-w-0 space-y-4">
      <SummaryPanel
        rows={scope === "global" ? scopeFilteredRows : allRows}
        openCount={visibleSummary.openCount}
        needsReviewCount={visibleSummary.needsReviewCount}
        headingId={`${instanceId}-money-summary`}
        outstandingFirst={clientTabPresentation}
      />

      <section
        aria-labelledby={`${instanceId}-filters-heading`}
        className="min-w-0 space-y-3 border-y border-[rgb(var(--border-subtle))] py-3"
      >
        <h2 id={`${instanceId}-filters-heading`} className="sr-only">
          Filter payment records
        </h2>

        <div
          role="group"
          aria-label="Payment views"
          className="flex min-w-0 flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {viewOptions.map((option) => {
            const active = view === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setView(option.value);
                  setExpandedPurchaseId(null);
                }}
                className={cn(
                  "sk-press inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border px-3 text-[11px] font-bold whitespace-nowrap focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:min-w-0 sm:rounded-[var(--radius-md)]",
                  active
                    ? "border-[rgb(var(--fg-default))] bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-elevated))]"
                    : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))]",
                )}
              >
                <span>{option.label}</span>
                <span
                  aria-label={`${String(workspaceViewCount(viewCountRows, option.value))} records`}
                  className={cn(
                    "font-mono text-[9.5px]",
                    active ? "text-[rgb(var(--bg-elevated)/0.72)]" : "text-[rgb(var(--fg-muted))]",
                  )}
                >
                  {String(workspaceViewCount(viewCountRows, option.value))}
                </span>
              </button>
            );
          })}
        </div>

        {scope === "global" ? (
          <>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 lg:grid-cols-1">
              <div className="[&_input]:h-11 [&_input]:rounded-[var(--radius-lg)] sm:[&_input]:h-9 sm:[&_input]:rounded-[var(--radius-md)]">
                <ListSearchInput
                  value={search.value}
                  onChange={(value) => {
                    search.setValue(value);
                    setExpandedPurchaseId(null);
                  }}
                  inputRef={search.inputRef}
                  placeholder="Search artist, project, purchase, or reference"
                  ariaLabel="Search payment records"
                />
              </div>
              <button
                type="button"
                aria-expanded={advancedFiltersExpanded}
                aria-controls={`${instanceId}-advanced-filters`}
                onClick={() => {
                  setAdvancedFiltersExpanded((current) => !current);
                }}
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[11px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none lg:hidden"
              >
                Filters
              </button>
            </div>

            <div
              id={`${instanceId}-advanced-filters`}
              data-payment-advanced-filters=""
              className={cn(
                advancedFiltersExpanded ? "grid" : "hidden",
                "min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid lg:grid-cols-4",
              )}
            >
              <label className="min-w-0 text-[10px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                Artist
                <select
                  value={counterpartyId}
                  onChange={(event) => {
                    setCounterpartyId(event.target.value);
                    setExpandedPurchaseId(null);
                  }}
                  aria-label="Filter by artist"
                  className="mt-1 block min-h-11 w-full min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[12px] font-semibold tracking-normal text-[rgb(var(--fg-default))] normal-case focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
                >
                  <option value="all">All artists</option>
                  {artistOptions.map((artist) => (
                    <option key={artist.id} value={artist.id}>
                      {artist.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="min-w-0 text-[10px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                Agreement from
                <input
                  type="date"
                  value={establishedFrom}
                  max={establishedTo || undefined}
                  onChange={(event) => {
                    setEstablishedFrom(event.target.value);
                    setExpandedPurchaseId(null);
                  }}
                  aria-label="Agreement from"
                  className="mt-1 block min-h-11 w-full min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[12px] font-semibold tracking-normal text-[rgb(var(--fg-default))] normal-case focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
                />
              </label>

              <label className="min-w-0 text-[10px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                Agreement to
                <input
                  type="date"
                  value={establishedTo}
                  min={establishedFrom || undefined}
                  onChange={(event) => {
                    setEstablishedTo(event.target.value);
                    setExpandedPurchaseId(null);
                  }}
                  aria-label="Agreement to"
                  className="mt-1 block min-h-11 w-full min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[12px] font-semibold tracking-normal text-[rgb(var(--fg-default))] normal-case focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
                />
              </label>

              <label className="min-w-0 text-[10px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                Currency
                <select
                  value={currency}
                  onChange={(event) => {
                    setCurrency(event.target.value);
                    setExpandedPurchaseId(null);
                  }}
                  aria-label="Filter by currency"
                  className="mt-1 block min-h-11 w-full min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[12px] font-semibold tracking-normal text-[rgb(var(--fg-default))] normal-case focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
                >
                  <option value="all">All currencies</option>
                  {currencyOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {!dateRangeValid ? (
              <p role="alert" className="text-[11px] font-bold text-[rgb(var(--fg-danger))]">
                Start date must be on or before end date.
              </p>
            ) : null}

            {filtersChanged ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={clearFilters}
                  className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-transparent px-3 text-[11px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
                >
                  Reset filters
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(220px,1fr)_auto_auto_auto] sm:items-center">
            <div className="[&_input]:h-11 [&_input]:rounded-[var(--radius-lg)] sm:[&_input]:h-9 sm:[&_input]:rounded-[var(--radius-md)]">
              <ListSearchInput
                value={search.value}
                onChange={(value) => {
                  search.setValue(value);
                  setExpandedPurchaseId(null);
                }}
                inputRef={search.inputRef}
                placeholder="Search client, project, purchase, or reference"
                ariaLabel="Search payment records"
              />
            </div>

            {currencyOptions.length > 1 ? (
              <select
                value={currency}
                onChange={(event) => {
                  setCurrency(event.target.value);
                  setExpandedPurchaseId(null);
                }}
                aria-label="Filter by currency"
                className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[12px] font-semibold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
              >
                <option value="all">All currencies</option>
                {currencyOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : null}

            {projectOptions.length > 1 ? (
              <select
                value={projectId}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setExpandedPurchaseId(null);
                }}
                aria-label="Filter by project"
                className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[12px] font-semibold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
              >
                <option value="all">All projects</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            ) : null}

            {filtersChanged ? (
              <button
                type="button"
                onClick={clearFilters}
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-transparent px-3 text-[11px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        )}

        <p
          aria-live="polite"
          aria-atomic="true"
          className="font-mono text-[10px] text-[rgb(var(--fg-muted))]"
        >
          {pluralize(filteredRows.length, "payment record")}
        </p>
      </section>

      {allRows.length === 0 ? (
        <div
          role="status"
          className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-9 text-center"
        >
          <p className="text-[14px] font-extrabold text-[rgb(var(--fg-default))]">
            No agreements yet
          </p>
          <p className="mx-auto mt-1 max-w-[46ch] text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
            Agreements{clientLabel ? ` for ${clientLabel}` : ""} will appear here with their payment
            schedule and current balance.
          </p>
        </div>
      ) : !dateRangeValid ? null : filteredRows.length === 0 ? (
        <div
          role="status"
          className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-9 text-center"
        >
          <p className="text-[14px] font-extrabold text-[rgb(var(--fg-default))]">
            {emptyDefaultView && view === "open" ? "No open payments" : "No payment records match"}
          </p>
          <p className="mt-1 text-[12px] text-[rgb(var(--fg-muted))]">
            {emptyDefaultView && view === "open"
              ? "Everything is settled or already in payment history."
              : "Clear the filters to return to the default payment view."}
          </p>
          {!clientTabPresentation &&
          emptyDefaultView &&
          workspaceViewCount(allRows, "history") > 0 ? (
            <button
              type="button"
              onClick={() => {
                setView("history");
              }}
              className="sk-press mt-3 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-4 text-[12px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
            >
              View history
            </button>
          ) : clientTabPresentation && emptyDefaultView ? null : (
            <button
              type="button"
              onClick={clearFilters}
              className="sk-press mt-3 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-4 text-[12px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
            >
              {scope === "global" ? "Reset filters" : "Clear filters"}
            </button>
          )}
        </div>
      ) : (
        <>
          {scope === "global"
            ? PaymentProofActions({
                rows: actionRows,
                instanceId,
                expandedPurchaseId,
                onToggleDetails: toggleDetails,
              })
            : null}

          {recordRows.length > 0 ? (
            scope === "global" ? (
              <section aria-labelledby={`${instanceId}-records-heading`} className="min-w-0">
                <header className="mb-3 flex min-w-0 items-baseline justify-between gap-3">
                  <h2
                    id={`${instanceId}-records-heading`}
                    className="font-display text-[20px] font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]"
                  >
                    Payment records
                  </h2>
                  <p className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                    {pluralize(recordRows.length, "record")}
                  </p>
                </header>
                {renderPaymentRecordsTable({
                  groups,
                  scope,
                  tableCaption,
                  instanceId,
                  expandedPurchaseId,
                  onToggleDetails: toggleDetails,
                })}
              </section>
            ) : (
              renderPaymentRecordsTable({
                groups,
                scope,
                tableCaption,
                instanceId,
                expandedPurchaseId,
                onToggleDetails: toggleDetails,
              })
            )
          ) : null}
        </>
      )}

      {clientTabPresentation && historyRows.length > 0 ? (
        <section
          aria-labelledby={`${instanceId}-history-heading`}
          data-payment-history-disclosure=""
          className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
        >
          <h2 id={`${instanceId}-history-heading`}>
            <button
              type="button"
              aria-expanded={historyExpanded}
              aria-controls={`${instanceId}-history-records`}
              onClick={() => {
                setHistoryExpanded((current) => !current);
                setExpandedPurchaseId(null);
              }}
              className="sk-press flex min-h-12 w-full min-w-0 items-center justify-between gap-3 px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-extrabold text-[rgb(var(--fg-default))]">
                  History
                </span>
                <span className="mt-0.5 block text-[10.5px] font-normal text-[rgb(var(--fg-muted))]">
                  Completed and closed payment records
                </span>
              </span>
              <span className="shrink-0 font-mono text-[10px] font-bold text-[rgb(var(--fg-muted))]">
                {pluralize(historyRows.length, "record")}
              </span>
            </button>
          </h2>
          {historyExpanded ? (
            <div
              id={`${instanceId}-history-records`}
              className="border-t border-[rgb(var(--border-subtle))] p-3"
            >
              {renderPaymentRecordsTable({
                groups: historyGroups,
                scope,
                tableCaption:
                  scope === "client"
                    ? `${clientLabel ?? "Client"} payment history grouped by project`
                    : "Payment history grouped by project and client",
                instanceId,
                detailsIdSegment: "history",
                expandedPurchaseId,
                onToggleDetails: toggleDetails,
              })}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
