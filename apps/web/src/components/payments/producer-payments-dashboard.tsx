"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/cn";
import { formatMoney } from "~/lib/format/money";

import {
  aggregateProducerPaymentArtists,
  buildProducerPaymentHistory,
  buildProducerPaymentTimeRange,
  defaultProducerPaymentCustomRange,
  filterProducerPaymentRecords,
  paginateProducerPaymentArtists,
  summarizeProducerPayments,
  type ProducerPaymentArtistNextPayment,
  type ProducerPaymentArtistRow,
  type ProducerPaymentArtistStatus,
  type ProducerPaymentCurrencyAmount,
  type ProducerPaymentCurrencySummary,
  type ProducerPaymentHistoryEvent,
  type ProducerPaymentStatusFilter,
  type ProducerPaymentsData,
  type ProducerPaymentsView,
  type ProducerPaymentTimePreset,
} from "./producer-payments-dashboard-model";

interface ProducerPaymentsDashboardProps {
  data: ProducerPaymentsData;
  producerTimeZone: string;
  initialNowIso: string;
}

const TIME_OPTIONS: readonly Readonly<{
  value: ProducerPaymentTimePreset;
  label: string;
}>[] = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_year", label: "This year" },
  { value: "all_time", label: "All time" },
  { value: "custom", label: "Custom" },
];

const STATUS_OPTIONS: readonly Readonly<{
  value: ProducerPaymentStatusFilter;
  label: string;
}>[] = [
  { value: "all", label: "All payment statuses" },
  { value: "needs_review", label: "Needs review" },
  { value: "overdue", label: "Overdue" },
  { value: "due_now", label: "Due now" },
  { value: "upcoming", label: "Upcoming" },
  { value: "waiting_milestone", label: "Waiting on milestones" },
  { value: "all_paid", label: "All paid" },
];

const STATUS_PRESENTATION: Record<
  ProducerPaymentArtistStatus,
  Readonly<{ label: string; tone: "accent" | "active" | "danger" | "success" | "warning" }>
> = {
  overdue: { label: "Overdue", tone: "danger" },
  needs_review: { label: "Needs review", tone: "accent" },
  due_now: { label: "Due now", tone: "warning" },
  waiting_milestone: { label: "Waiting on milestone", tone: "active" },
  upcoming: { label: "Upcoming", tone: "active" },
  all_paid: { label: "All paid", tone: "success" },
};

function safeDomId(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_-]/gu, "-");
}

function clientPaymentsHref(clientContactId: string): string {
  return `/dashboard/clients-projects/clients/${encodeURIComponent(clientContactId)}?tab=payments`;
}

function formatProducerDate(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  try {
    return new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  }
}

function amountLabel(cents: number, currency: string): string {
  return `${formatMoney(cents, currency, { withCents: true })} ${currency}`;
}

function AmountList({
  amounts,
  danger = false,
}: {
  amounts: readonly ProducerPaymentCurrencyAmount[];
  danger?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {amounts.map((amount) => (
        <span
          key={amount.currency}
          className={cn(
            "font-mono text-[11px] leading-tight font-bold whitespace-nowrap tabular-nums",
            danger && amount.cents > 0
              ? "text-[rgb(var(--fg-danger))]"
              : "text-[rgb(var(--fg-default))]",
          )}
        >
          {formatMoney(amount.cents, amount.currency, { withCents: true })}{" "}
          <span className="text-[9px] tracking-[0.06em] text-[rgb(var(--fg-muted))]">
            {amount.currency}
          </span>
        </span>
      ))}
    </span>
  );
}

function SummaryMoney({ cents, currency }: { cents: number; currency: string }) {
  return (
    <span className="font-mono text-[clamp(13px,4vw,18px)] leading-none font-extrabold tracking-[-0.03em] whitespace-nowrap text-[rgb(var(--fg-default))] tabular-nums">
      {formatMoney(cents, currency, { withCents: true })}
    </span>
  );
}

function PaymentsSummary({
  totals,
  periodLabel,
}: {
  totals: readonly ProducerPaymentCurrencySummary[];
  periodLabel: string;
}) {
  return (
    <section
      aria-labelledby="producer-payments-summary-heading"
      data-producer-payments-summary=""
      className="overflow-hidden rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
    >
      <header className="flex min-w-0 items-baseline justify-between gap-3 border-b border-[rgb(var(--border-subtle))] px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="font-mono text-[9px] font-bold tracking-[0.13em] text-[rgb(var(--brand-primary-text))] uppercase">
            Money overview
          </p>
          <h2
            id="producer-payments-summary-heading"
            className="font-display mt-0.5 text-[18px] font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]"
          >
            {periodLabel}
          </h2>
        </div>
      </header>

      <div className="divide-y divide-[rgb(var(--border-subtle))]">
        {totals.map((total) => (
          <section
            key={total.currency}
            aria-label={`${total.currency} payment summary`}
            className="grid min-w-0 gap-3 px-4 py-3 sm:grid-cols-[70px_minmax(0,1fr)] sm:items-center sm:px-5 sm:py-4"
          >
            <div>
              <p className="font-mono text-[12px] font-extrabold tracking-[0.12em] text-[rgb(var(--fg-default))] uppercase">
                {total.currency}
              </p>
            </div>
            <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-3 lg:grid-cols-4 lg:gap-x-5">
              <div className="min-w-0">
                <dt className="text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                  Received
                </dt>
                <dd className="mt-1">
                  <SummaryMoney cents={total.receivedCents} currency={total.currency} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                  Expected
                </dt>
                <dd className="mt-1">
                  <SummaryMoney cents={total.expectedCents} currency={total.currency} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                  Owed now
                </dt>
                <dd className="mt-1">
                  <SummaryMoney cents={total.owedNowCents} currency={total.currency} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                  Waiting on milestones
                </dt>
                <dd className="mt-1">
                  <SummaryMoney cents={total.waitingOnMilestonesCents} currency={total.currency} />
                </dd>
              </div>
            </dl>
          </section>
        ))}
      </div>
    </section>
  );
}

function nextPaymentTiming(next: ProducerPaymentArtistNextPayment, timeZone: string): string {
  if (next.dueAtIso) return formatProducerDate(next.dueAtIso, timeZone);
  if (next.dueTrigger === "artist_approval") {
    return next.triggeredAtIso ? "Final approval reached" : "After final approval";
  }
  if (next.dueTrigger === "acceptance") return "At acceptance";
  if (next.dueTrigger === "producer_import") return "When added to Skitza";
  return next.triggeredAtIso ? "Monthly payment due" : "After the first payment";
}

function NextPayment({
  next,
  timeZone,
}: {
  next: ProducerPaymentArtistNextPayment | null;
  timeZone: string;
}) {
  if (!next) return <span className="text-[11px] text-[rgb(var(--fg-muted))]">None</span>;
  return (
    <span className="block min-w-0">
      <span className="block font-mono text-[10.5px] font-bold text-[rgb(var(--fg-default))] tabular-nums">
        {amountLabel(next.amountCents, next.currency)}
      </span>
      <span className="mt-0.5 block text-[10px] leading-snug text-[rgb(var(--fg-muted))]">
        {nextPaymentTiming(next, timeZone)} · {next.projectTitle}
      </span>
    </span>
  );
}

function ArtistStatus({ artist }: { artist: ProducerPaymentArtistRow }) {
  const status = STATUS_PRESENTATION[artist.status];
  return (
    <span className="flex min-w-0 flex-col items-start gap-1.5">
      <Badge variant={status.tone}>{status.label}</Badge>
      {artist.pendingProofs.map((proof) => (
        <Link
          key={proof.proofId}
          href={`/dashboard/payments/${encodeURIComponent(proof.proofId)}`}
          className="text-[10px] leading-snug font-bold text-[rgb(var(--brand-primary-text))] underline-offset-4 hover:underline focus-visible:rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
        >
          Review {proof.purchaseTitle} proof
        </Link>
      ))}
    </span>
  );
}

function ArtistProjects({ artist }: { artist: ProducerPaymentArtistRow }) {
  const projects = [
    ...new Map(
      artist.records.map((record) => [record.projectId, record.projectTitle] as const),
    ).entries(),
  ].sort(([, leftTitle], [, rightTitle]) => leftTitle.localeCompare(rightTitle));

  return (
    <span className="flex min-w-0 flex-col gap-1">
      {projects.map(([projectId, projectTitle]) => (
        <span
          key={projectId}
          className="text-[12px] leading-snug font-extrabold break-words text-[rgb(var(--fg-default))]"
        >
          {projectTitle}
        </span>
      ))}
    </span>
  );
}

function ArtistDesktopTable({
  artists,
  timeZone,
}: {
  artists: readonly ProducerPaymentArtistRow[];
  timeZone: string;
}) {
  return (
    <div className="hidden overflow-hidden rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] md:block">
      <table className="w-full table-fixed border-collapse text-left">
        <caption className="sr-only">
          Projects and artists with received money, current debt, next payment, remaining balance,
          and status
        </caption>
        <thead>
          <tr className="border-b border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-background))]">
            {[
              ["Project", "w-[16%]"],
              ["Artist", "w-[14%]"],
              ["Received", "w-[11%]"],
              ["Owes now", "w-[11%]"],
              ["Next payment", "w-[20%]"],
              ["Total left", "w-[11%]"],
              ["Status", "w-[17%]"],
            ].map(([label, width]) => (
              <th
                key={label}
                scope="col"
                className={cn(
                  width,
                  "px-3 py-2.5 text-[9px] font-bold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase xl:px-4",
                )}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgb(var(--border-subtle))]">
          {artists.map((artist) => (
            <tr key={artist.clientContactId} className="align-top hover:bg-[rgb(var(--bg-sunken))]">
              <td className="px-3 py-3 xl:px-4">
                <ArtistProjects artist={artist} />
              </td>
              <th scope="row" className="px-3 py-3 text-left xl:px-4">
                <Link
                  href={clientPaymentsHref(artist.clientContactId)}
                  className="inline-flex min-h-9 max-w-full items-center text-[12px] font-extrabold break-words text-[rgb(var(--fg-default))] underline-offset-4 hover:underline focus-visible:rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
                >
                  {artist.clientName}
                </Link>
              </th>
              <td className="px-3 py-3 xl:px-4">
                <AmountList amounts={artist.receivedByCurrency} />
              </td>
              <td className="px-3 py-3 xl:px-4">
                <AmountList amounts={artist.owedNowByCurrency} danger />
              </td>
              <td className="px-3 py-3 xl:px-4">
                <NextPayment next={artist.nextPayment} timeZone={timeZone} />
              </td>
              <td className="px-3 py-3 xl:px-4">
                <AmountList amounts={artist.totalLeftByCurrency} />
              </td>
              <td className="px-3 py-3 xl:px-4">
                <ArtistStatus artist={artist} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArtistMobileRows({
  artists,
  timeZone,
}: {
  artists: readonly ProducerPaymentArtistRow[];
  timeZone: string;
}) {
  return (
    <ul className="divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))] md:hidden">
      {artists.map((artist) => (
        <li key={artist.clientContactId} className="min-w-0 px-1 py-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <Link
              href={clientPaymentsHref(artist.clientContactId)}
              className="inline-flex min-h-11 min-w-0 items-center text-[13px] font-extrabold break-words text-[rgb(var(--fg-default))] underline-offset-4 hover:underline focus-visible:rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
            >
              {artist.clientName}
            </Link>
            <ArtistStatus artist={artist} />
          </div>
          <dl className="mt-2 grid min-w-0 grid-cols-2 gap-x-3 gap-y-3 border-t border-[rgb(var(--border-subtle))] pt-2.5">
            <div className="min-w-0">
              <dt className="text-[8.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                Received
              </dt>
              <dd className="mt-1">
                <AmountList amounts={artist.receivedByCurrency} />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[8.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                Owes now
              </dt>
              <dd className="mt-1">
                <AmountList amounts={artist.owedNowByCurrency} danger />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[8.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                Total left
              </dt>
              <dd className="mt-1">
                <AmountList amounts={artist.totalLeftByCurrency} />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[8.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                Next payment
              </dt>
              <dd className="mt-1">
                <NextPayment next={artist.nextPayment} timeZone={timeZone} />
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function Pagination({
  page,
  totalPages,
  totalItems,
  onPage,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPage: (page: number) => void;
}) {
  if (totalItems === 0) return null;
  return (
    <nav
      aria-label="Artist payment pages"
      className="flex min-w-0 items-center justify-between gap-3 pt-3"
    >
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => {
          onPage(page - 1);
        }}
        className="sk-press inline-flex min-h-11 min-w-[92px] items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[11px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9 sm:rounded-[var(--radius-md)]"
      >
        Previous
      </button>
      <p aria-live="polite" className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
        Page {String(page)} of {String(totalPages)} · {String(totalItems)} Artists
      </p>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => {
          onPage(page + 1);
        }}
        className="sk-press inline-flex min-h-11 min-w-[92px] items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[11px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9 sm:rounded-[var(--radius-md)]"
      >
        Next
      </button>
    </nav>
  );
}

function historyKindLabel(event: ProducerPaymentHistoryEvent): string {
  if (event.kind === "payment") return "Payment";
  if (event.kind === "proof") return "Proof";
  if (event.kind === "correction") return "Correction";
  if (event.kind === "waiver") return "Waiver";
  return "Cancellation";
}

function HistoryAmount({ event }: { event: ProducerPaymentHistoryEvent }) {
  if (event.amountCents === null) return <span className="text-[rgb(var(--fg-muted))]">—</span>;
  return (
    <span className="block font-mono text-[10.5px] font-bold text-[rgb(var(--fg-default))] tabular-nums">
      {amountLabel(event.amountCents, event.currency)}
      {event.previousAmountCents !== null ? (
        <span className="mt-0.5 block text-[9px] font-normal text-[rgb(var(--fg-muted))]">
          Was {amountLabel(event.previousAmountCents, event.currency)}
        </span>
      ) : null}
    </span>
  );
}

function HistoryAction({ event }: { event: ProducerPaymentHistoryEvent }) {
  if (event.proofId) {
    return (
      <Link
        href={`/dashboard/payments/${encodeURIComponent(event.proofId)}`}
        className="inline-flex min-h-9 items-center text-[10px] font-bold text-[rgb(var(--brand-primary-text))] underline-offset-4 hover:underline focus-visible:rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
      >
        Open proof
      </Link>
    );
  }
  return (
    <Link
      href={clientPaymentsHref(event.clientContactId)}
      className="inline-flex min-h-9 items-center text-[10px] font-bold text-[rgb(var(--fg-secondary))] underline-offset-4 hover:underline focus-visible:rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
    >
      Open Artist
    </Link>
  );
}

function PaymentHistory({
  events,
  timeZone,
}: {
  events: readonly ProducerPaymentHistoryEvent[];
  timeZone: string;
}) {
  return (
    <section aria-labelledby="producer-payment-history-heading" className="min-w-0">
      <header className="mb-3 flex min-w-0 items-baseline justify-between gap-3">
        <h2
          id="producer-payment-history-heading"
          className="font-display text-[20px] font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]"
        >
          Payment history
        </h2>
        <p className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
          {String(events.length)} records
        </p>
      </header>

      <div className="hidden overflow-hidden rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] md:block">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">
            Payment, proof, correction, waiver, and cancellation history
          </caption>
          <thead>
            <tr className="border-b border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-background))]">
              {[
                ["Date", "w-[14%]"],
                ["Artist", "w-[16%]"],
                ["Project and purchase", "w-[27%]"],
                ["Record", "w-[15%]"],
                ["Amount", "w-[15%]"],
                ["Action", "w-[13%]"],
              ].map(([label, width]) => (
                <th
                  key={label}
                  scope="col"
                  className={cn(
                    width,
                    "px-3 py-2.5 text-[9px] font-bold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase xl:px-4",
                  )}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--border-subtle))]">
            {events.map((event) => (
              <tr key={event.id} className="align-top">
                <td className="px-3 py-3 text-[10.5px] font-semibold text-[rgb(var(--fg-secondary))] xl:px-4">
                  {formatProducerDate(event.occurredAtIso, timeZone)}
                </td>
                <th scope="row" className="px-3 py-3 text-left xl:px-4">
                  <Link
                    href={clientPaymentsHref(event.clientContactId)}
                    className="text-[11.5px] font-extrabold break-words text-[rgb(var(--fg-default))] underline-offset-4 hover:underline focus-visible:rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
                  >
                    {event.clientName}
                  </Link>
                </th>
                <td className="px-3 py-3 xl:px-4">
                  <p className="text-[11px] font-bold break-words text-[rgb(var(--fg-default))]">
                    {event.projectTitle}
                  </p>
                  <p className="mt-0.5 text-[9.5px] leading-snug break-words text-[rgb(var(--fg-muted))]">
                    {event.purchaseTitle} · {event.purchaseReference}
                  </p>
                </td>
                <td className="px-3 py-3 xl:px-4">
                  <p className="text-[10.5px] font-bold text-[rgb(var(--fg-default))]">
                    {historyKindLabel(event)}
                  </p>
                  <p className="mt-0.5 text-[9.5px] leading-snug text-[rgb(var(--fg-muted))]">
                    {event.statusLabel}
                    {event.detail ? ` · ${event.detail}` : ""}
                  </p>
                </td>
                <td className="px-3 py-3 xl:px-4">
                  <HistoryAmount event={event} />
                </td>
                <td className="px-3 py-3 xl:px-4">
                  <HistoryAction event={event} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))] md:hidden">
        {events.map((event) => (
          <li key={event.id} className="min-w-0 px-1 py-3">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                  {formatProducerDate(event.occurredAtIso, timeZone)} · {historyKindLabel(event)}
                </p>
                <Link
                  href={clientPaymentsHref(event.clientContactId)}
                  className="mt-1 inline-flex min-h-9 items-center text-[12px] font-extrabold break-words text-[rgb(var(--fg-default))] underline-offset-4 hover:underline focus-visible:rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
                >
                  {event.clientName}
                </Link>
                <p className="text-[10px] leading-snug text-[rgb(var(--fg-muted))]">
                  {event.projectTitle} · {event.purchaseTitle}
                </p>
              </div>
              <HistoryAmount event={event} />
            </div>
            <div className="mt-2 flex min-w-0 items-center justify-between gap-3 border-t border-[rgb(var(--border-subtle))] pt-2">
              <p className="min-w-0 text-[10px] leading-snug font-semibold text-[rgb(var(--fg-secondary))]">
                {event.statusLabel}
                {event.detail ? ` · ${event.detail}` : ""}
              </p>
              <HistoryAction event={event} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProducerPaymentsDashboard({
  data,
  producerTimeZone,
  initialNowIso,
}: ProducerPaymentsDashboardProps) {
  const instanceId = safeDomId(useId());
  const customDefaults = useMemo(
    () => defaultProducerPaymentCustomRange(initialNowIso, producerTimeZone),
    [initialNowIso, producerTimeZone],
  );
  const [view, setView] = useState<ProducerPaymentsView>("overview");
  const [timePreset, setTimePreset] = useState<ProducerPaymentTimePreset>("this_month");
  const [customFrom, setCustomFrom] = useState(customDefaults.from);
  const [customTo, setCustomTo] = useState(customDefaults.to);
  const [query, setQuery] = useState("");
  const [clientContactId, setClientContactId] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [projectId, setProjectId] = useState("all");
  const [status, setStatus] = useState<ProducerPaymentStatusFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);

  const timeRange = useMemo(
    () =>
      buildProducerPaymentTimeRange(
        timePreset,
        initialNowIso,
        producerTimeZone,
        customFrom,
        customTo,
      ),
    [customFrom, customTo, initialNowIso, producerTimeZone, timePreset],
  );
  const currencies = useMemo(
    () => [...new Set(data.records.map((record) => record.currency))].sort(),
    [data.records],
  );
  const artistOptions = useMemo(() => {
    const unique = new Map<string, string>();
    for (const record of data.records) {
      unique.set(record.clientContactId, record.clientName);
    }
    return [...unique]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [data.records]);
  const projects = useMemo(() => {
    const unique = new Map<string, string>();
    for (const record of data.records) unique.set(record.projectId, record.projectTitle);
    return [...unique]
      .map(([id, title]) => ({ id, title }))
      .sort((left, right) => left.title.localeCompare(right.title));
  }, [data.records]);
  const filteredRecords = useMemo(
    () =>
      filterProducerPaymentRecords(data.records, {
        query,
        clientContactId,
        currency,
        projectId,
        status,
      }),
    [clientContactId, currency, data.records, projectId, query, status],
  );
  const summary = useMemo(
    () => summarizeProducerPayments(filteredRecords, timeRange, producerTimeZone),
    [filteredRecords, producerTimeZone, timeRange],
  );
  const artists = useMemo(
    () =>
      aggregateProducerPaymentArtists(filteredRecords, timeRange, producerTimeZone, initialNowIso),
    [filteredRecords, initialNowIso, producerTimeZone, timeRange],
  );
  const artistPage = useMemo(() => paginateProducerPaymentArtists(artists, page), [artists, page]);
  const history = useMemo(
    () => buildProducerPaymentHistory(filteredRecords, timeRange, producerTimeZone),
    [filteredRecords, producerTimeZone, timeRange],
  );
  const allTimeReceived = useMemo(
    () =>
      summarizeProducerPayments(
        filteredRecords,
        buildProducerPaymentTimeRange("all_time", initialNowIso, producerTimeZone),
        producerTimeZone,
      ),
    [filteredRecords, initialNowIso, producerTimeZone],
  );

  const activeFilterCount =
    Number(clientContactId !== "all") +
    Number(currency !== "all") +
    Number(projectId !== "all") +
    Number(status !== "all");
  const periodLabel = TIME_OPTIONS.find((option) => option.value === timePreset)?.label ?? "Custom";
  const noPayments = data.records.length === 0;
  const noMatches = !noPayments && filteredRecords.length === 0;
  const nothingOwed = summary.length > 0 && summary.every((total) => total.owedNowCents === 0);
  const nothingExpected = summary.length > 0 && summary.every((total) => total.expectedCents === 0);
  const allPaid =
    filteredRecords.length > 0 &&
    filteredRecords.every((record) => record.totalRemainingCents === 0);

  function resetFilters() {
    setQuery("");
    setClientContactId("all");
    setCurrency("all");
    setProjectId("all");
    setStatus("all");
    setFiltersOpen(false);
    setPage(1);
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-col gap-3 border-y border-[rgb(var(--border-subtle))] py-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Payment views"
            className="grid min-w-0 flex-1 grid-cols-2 gap-1 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] p-1 sm:max-w-[280px] sm:rounded-[var(--radius-md)]"
          >
            {(["overview", "history"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={view === option}
                aria-controls={`${instanceId}-${option}-panel`}
                onClick={() => {
                  setView(option);
                  setPage(1);
                }}
                className={cn(
                  "sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] px-3 text-[11px] font-bold capitalize focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9",
                  view === option
                    ? "bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-elevated))]"
                    : "text-[rgb(var(--fg-secondary))]",
                )}
              >
                {option}
              </button>
            ))}
          </div>

          <label className="shrink-0">
            <span className="sr-only">Time range</span>
            <select
              value={timePreset}
              aria-label="Time range"
              onChange={(event) => {
                setTimePreset(event.target.value as ProducerPaymentTimePreset);
                setPage(1);
              }}
              className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[11px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
            >
              {TIME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {timePreset === "custom" ? (
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <label className="min-w-0 text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
              From
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(event) => {
                  setCustomFrom(event.target.value);
                  setPage(1);
                }}
                className="mt-1 block min-h-11 w-full min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 text-[16px] font-semibold tracking-normal text-[rgb(var(--fg-default))] normal-case focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)] sm:text-[12px]"
              />
            </label>
            <label className="min-w-0 text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
              To
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(event) => {
                  setCustomTo(event.target.value);
                  setPage(1);
                }}
                className="mt-1 block min-h-11 w-full min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 text-[16px] font-semibold tracking-normal text-[rgb(var(--fg-default))] normal-case focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)] sm:text-[12px]"
              />
            </label>
          </div>
        ) : null}

        {!timeRange.valid ? (
          <p role="alert" className="text-[11px] font-bold text-[rgb(var(--fg-danger))]">
            Choose a valid start and end date.
          </p>
        ) : null}

        {view === "overview" && timeRange.valid && !noPayments && !noMatches ? (
          <PaymentsSummary totals={summary} periodLabel={periodLabel} />
        ) : null}

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
          <label className="min-w-0">
            <span className="sr-only">Search payments</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Search Artist, project, purchase, or reference"
              className="block min-h-11 w-full min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)] sm:text-[12px]"
            />
          </label>
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls={`${instanceId}-filters`}
            onClick={() => {
              setFiltersOpen((current) => !current);
            }}
            className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[11px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
          >
            Filters{activeFilterCount > 0 ? ` (${String(activeFilterCount)})` : ""}
          </button>
        </div>

        {filtersOpen ? (
          <div
            id={`${instanceId}-filters`}
            className="grid min-w-0 grid-cols-1 gap-3 border-t border-[rgb(var(--border-subtle))] pt-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <label className="min-w-0 text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
              Artist
              <select
                value={clientContactId}
                onChange={(event) => {
                  setClientContactId(event.target.value);
                  setPage(1);
                }}
                className="mt-1 block min-h-11 w-full min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] font-semibold tracking-normal text-[rgb(var(--fg-default))] normal-case focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)] sm:text-[12px]"
              >
                <option value="all">All artists</option>
                {artistOptions.map((artist) => (
                  <option key={artist.id} value={artist.id}>
                    {artist.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
              Currency
              <select
                value={currency}
                onChange={(event) => {
                  setCurrency(event.target.value);
                  setPage(1);
                }}
                className="mt-1 block min-h-11 w-full min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] font-semibold tracking-normal text-[rgb(var(--fg-default))] normal-case focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)] sm:text-[12px]"
              >
                <option value="all">All currencies</option>
                {currencies.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
              Project
              <select
                value={projectId}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setPage(1);
                }}
                className="mt-1 block min-h-11 w-full min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] font-semibold tracking-normal text-[rgb(var(--fg-default))] normal-case focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)] sm:text-[12px]"
              >
                <option value="all">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
              Payment status
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as ProducerPaymentStatusFilter);
                  setPage(1);
                }}
                className="mt-1 block min-h-11 w-full min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] font-semibold tracking-normal text-[rgb(var(--fg-default))] normal-case focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)] sm:text-[12px]"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {activeFilterCount > 0 || query.trim() ? (
              <button
                type="button"
                onClick={resetFilters}
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-transparent px-3 text-[11px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:col-span-2 sm:min-h-9 sm:rounded-[var(--radius-md)] lg:col-span-4 lg:justify-self-end"
              >
                Reset filters
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {noPayments ? (
        <div
          role="status"
          className="rounded-[var(--radius-xl)] border border-dashed border-[rgb(var(--border-subtle))] px-4 py-10 text-center"
        >
          <p className="text-[14px] font-extrabold text-[rgb(var(--fg-default))]">
            No payments yet.
          </p>
        </div>
      ) : noMatches || !timeRange.valid ? (
        timeRange.valid ? (
          <div
            role="status"
            className="rounded-[var(--radius-xl)] border border-dashed border-[rgb(var(--border-subtle))] px-4 py-10 text-center"
          >
            <p className="text-[14px] font-extrabold text-[rgb(var(--fg-default))]">
              No payments match this view.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="sk-press mt-3 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-[11px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
            >
              Reset filters
            </button>
          </div>
        ) : null
      ) : view === "overview" ? (
        <section
          id={`${instanceId}-overview-panel`}
          role="tabpanel"
          aria-label="Overview"
          className="min-w-0 space-y-4"
        >
          <div className="space-y-1" aria-live="polite">
            {nothingOwed ? (
              <p className="text-[11px] font-semibold text-[rgb(var(--fg-secondary))]">
                All payments are up to date.
              </p>
            ) : null}
            {nothingExpected ? (
              <p className="text-[11px] font-semibold text-[rgb(var(--fg-secondary))]">
                No payments expected during this time.
              </p>
            ) : null}
          </div>

          {allPaid ? (
            <section
              aria-label="All payments completed"
              className="flex min-w-0 flex-col gap-3 border-y border-[rgb(var(--border-subtle))] py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-[14px] font-extrabold text-[rgb(var(--fg-default))]">All paid</p>
                <p className="mt-1 text-[10px] text-[rgb(var(--fg-muted))]">
                  {allTimeReceived
                    .map((total) => amountLabel(total.receivedCents, total.currency))
                    .join(" · ")}
                  {" received"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setView("history");
                }}
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 text-[11px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
              >
                View History
              </button>
            </section>
          ) : null}

          <section aria-labelledby="artist-payment-table-heading" className="min-w-0">
            <header className="mb-3 flex min-w-0 items-baseline justify-between gap-3">
              <h2
                id="artist-payment-table-heading"
                className="font-display text-[20px] font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]"
              >
                Artists
              </h2>
              <p className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                {String(artists.length)} Artists
              </p>
            </header>
            <ArtistDesktopTable artists={artistPage.items} timeZone={producerTimeZone} />
            <ArtistMobileRows artists={artistPage.items} timeZone={producerTimeZone} />
            <Pagination
              page={artistPage.page}
              totalPages={artistPage.totalPages}
              totalItems={artistPage.totalItems}
              onPage={setPage}
            />
          </section>
        </section>
      ) : (
        <section
          id={`${instanceId}-history-panel`}
          role="tabpanel"
          aria-label="History"
          className="min-w-0"
        >
          {history.length > 0 ? (
            <PaymentHistory events={history} timeZone={producerTimeZone} />
          ) : (
            <div
              role="status"
              className="rounded-[var(--radius-xl)] border border-dashed border-[rgb(var(--border-subtle))] px-4 py-10 text-center"
            >
              <p className="text-[14px] font-extrabold text-[rgb(var(--fg-default))]">
                No payment history during this time.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
