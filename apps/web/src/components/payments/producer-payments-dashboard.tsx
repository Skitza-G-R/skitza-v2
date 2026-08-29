"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { cn } from "~/lib/cn";
import { formatMoney } from "~/lib/format/money";

import { badgeVariants } from "~/components/ui/badge";

import { PaymentReminderButton } from "./payment-reminder-button";

import {
  aggregateProducerPaymentArtists,
  buildProducerPaymentHistory,
  buildProducerPaymentTimeRange,
  defaultProducerPaymentCustomRange,
  filterProducerPaymentRecords,
  paginateProducerPaymentArtists,
  producerPaymentArtistProgress,
  producerPaymentAttention,
  producerPaymentLastPaidLabel,
  producerPaymentLine,
  producerPaymentNeedsYou,
  producerPaymentProjectLabel,
  producerPaymentShortDate,
  summarizeProducerPayments,
  type ProducerPaymentArtistProgress,
  type ProducerPaymentArtistRow,
  type ProducerPaymentCurrencySummary,
  type ProducerPaymentHistoryEvent,
  type ProducerPaymentStatusFilter,
  type ProducerPaymentsData,
  PAYMENTS_NEEDS_YOU_ANCHOR,
  type ProducerPaymentsView,
  type ProducerPaymentTimePreset,
  type ProducerPaymentTimeRange,
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

// Wears the Badge skin (10px bold uppercase pill); the ::before overlay
// stretches the touch target to ~44px without inflating the pill itself.
const ATTENTION_GROUPS = [
  {
    id: "needs_you",
    label: "Needs you",
    caption: "Artists waiting on you: a payment proof to review, or money that is late",
  },
  {
    id: "coming_up",
    label: "Coming up",
    caption: "Artists with money still to come, and when each payment is expected",
  },
  { id: "paid_up", label: "Paid up", caption: "Artists who have paid everything" },
] as const;

const NEEDS_YOU_CHIP =
  "sk-press relative shrink-0 cursor-pointer py-1 before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[''] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none";

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

type SummaryTone = "danger" | "default" | "success" | "warning";

const SUMMARY_TONE_CLASS: Record<SummaryTone, string> = {
  danger: "text-[rgb(var(--fg-danger-text))]",
  default: "text-[rgb(var(--fg-default))]",
  success: "text-[rgb(var(--fg-success-text))]",
  warning: "text-[rgb(var(--fg-warning-text))]",
};

function StatPhrase({
  cents,
  currency,
  word,
  tone,
}: {
  cents: number;
  currency: string;
  word: string;
  tone: SummaryTone;
}) {
  return (
    <span className="whitespace-nowrap">
      <span
        className={cn(
          "font-mono text-[clamp(15px,4.4vw,19px)] leading-tight font-extrabold tabular-nums",
          SUMMARY_TONE_CLASS[tone],
        )}
      >
        {formatMoney(cents, currency, { withCents: true })}
      </span>{" "}
      <span className="text-[12px] text-[rgb(var(--fg-muted))]">{word}</span>
    </span>
  );
}

function SummaryGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[9.5px] font-semibold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
        {label}
      </p>
      <p className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        {children}
      </p>
    </div>
  );
}

/** Names the exact days the range covers, so "This month" is never a guess. */
function rangeSummaryLabel(
  range: ProducerPaymentTimeRange,
  timeZone: string,
  nowIso: string,
): string {
  if (range.fromDateKey === null && range.toDateKey === null) return "All time";
  const from = range.fromDateKey
    ? producerPaymentShortDate(`${range.fromDateKey}T12:00:00.000Z`, timeZone, nowIso)
    : null;
  const to = range.toDateKey
    ? producerPaymentShortDate(`${range.toDateKey}T12:00:00.000Z`, timeZone, nowIso)
    : null;
  if (from && to) return from === to ? from : `${from} – ${to}`;
  return from ?? to ?? "All time";
}

/**
 * The money-overview card, kept honest: the left pair follows the chosen time
 * range, the right pair never did — so each pair now sits under its own label
 * instead of one "This month" heading claiming both.
 */
function PaymentsSummary({
  totals,
  periodLabel,
  rangeLabel,
  showCurrencyCode,
}: {
  totals: readonly ProducerPaymentCurrencySummary[];
  periodLabel: string;
  rangeLabel: string;
  showCurrencyCode: boolean;
}) {
  return (
    <section
      aria-labelledby="producer-payments-summary-heading"
      data-producer-payments-summary=""
      className="overflow-hidden rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
    >
      <header className="flex min-w-0 items-baseline justify-between gap-3 border-b border-[rgb(var(--border-subtle))] px-4 py-2.5 sm:px-5">
        <h2
          id="producer-payments-summary-heading"
          className="font-mono text-[9px] font-bold tracking-[0.13em] text-[rgb(var(--brand-primary-text))] uppercase"
        >
          Money overview
        </h2>
        <p className="font-mono text-[10px] whitespace-nowrap text-[rgb(var(--fg-muted))]">
          {rangeLabel}
        </p>
      </header>
      <div className="divide-y divide-[rgb(var(--border-subtle))]">
        {totals.map((total) => (
          <div
            key={total.currency}
            className="grid min-w-0 grid-cols-1 gap-x-10 gap-y-3 px-4 py-3.5 sm:grid-cols-2 sm:px-5"
          >
            <SummaryGroup
              label={`${periodLabel}${showCurrencyCode ? ` · ${total.currency}` : ""}`}
            >
              <StatPhrase
                cents={total.receivedCents}
                currency={total.currency}
                word="received"
                tone="success"
              />
              <StatPhrase
                cents={total.expectedCents}
                currency={total.currency}
                word="expected"
                tone="default"
              />
            </SummaryGroup>
            <SummaryGroup label="Right now">
              <StatPhrase
                cents={total.owedNowCents}
                currency={total.currency}
                word="owed"
                tone={total.owedNowCents > 0 ? "danger" : "default"}
              />
              <StatPhrase
                cents={total.waitingOnMilestonesCents}
                currency={total.currency}
                word="waiting"
                tone={total.waitingOnMilestonesCents > 0 ? "warning" : "default"}
              />
            </SummaryGroup>
          </div>
        ))}
      </div>
    </section>
  );
}

function ArtistName({
  artist,
  stacked = false,
}: {
  artist: ProducerPaymentArtistRow;
  stacked?: boolean;
}) {
  const projectLabel = producerPaymentProjectLabel(artist.projectTitles);
  const link = (
    <Link
      href={clientPaymentsHref(artist.clientContactId)}
      className={cn(
        "font-extrabold text-[rgb(var(--fg-default))] underline-offset-4 hover:underline focus-visible:rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none",
        stacked ? "block truncate text-[14.5px] leading-tight" : "shrink-0 text-[13px]",
      )}
    >
      {artist.clientName}
    </Link>
  );
  // Stacked on desktop: the name is the row's identity, the project its detail.
  if (stacked) {
    return (
      <span className="flex min-w-0 flex-col gap-0.5">
        {link}
        {projectLabel ? (
          <span className="truncate text-[11px] leading-tight font-normal text-[rgb(var(--fg-muted))]">
            {projectLabel}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      {link}
      {projectLabel ? (
        <span className="min-w-0 truncate text-[11.5px] font-normal text-[rgb(var(--fg-muted))]">
          · {projectLabel}
        </span>
      ) : null}
    </span>
  );
}

/** Amount then plain sentence — the words carry the meaning, not the colour. */
function ArtistLine({
  artist,
  timeZone,
  nowIso,
  stacked = false,
}: {
  artist: ProducerPaymentArtistRow;
  timeZone: string;
  nowIso: string;
  stacked?: boolean;
}) {
  const line = producerPaymentLine(artist, timeZone, nowIso);
  const amountClass = cn(
    "font-mono font-extrabold whitespace-nowrap tabular-nums",
    line.tone === "danger"
      ? "text-[rgb(var(--fg-danger-text))]"
      : "text-[rgb(var(--fg-default))]",
  );

  if (stacked) {
    // With no amount the sentence is the headline, so it takes the headline size.
    if (line.amountCents === null) {
      return (
        <span className="block min-w-0 text-[13.5px] leading-tight text-[rgb(var(--fg-default))]">
          {line.detail}
        </span>
      );
    }
    return (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn(amountClass, "text-[15px] leading-tight")}>
          {formatMoney(line.amountCents, line.currency, { withCents: true })}
        </span>
        <span className="truncate text-[11.5px] leading-tight text-[rgb(var(--fg-muted))]">
          {line.detail}
        </span>
      </span>
    );
  }

  return (
    <span className="block min-w-0 text-[12.5px] leading-snug">
      {line.amountCents === null ? null : (
        <span className={amountClass}>
          {formatMoney(line.amountCents, line.currency, { withCents: true })}
          <span className="font-sans font-normal text-[rgb(var(--fg-muted))]"> — </span>
        </span>
      )}
      <span className="text-[rgb(var(--fg-secondary))]">{line.detail}</span>
    </span>
  );
}

function ProgressText({ row }: { row: ProducerPaymentArtistProgress }) {
  return (
    <span className="block font-mono text-[11.5px] leading-tight whitespace-nowrap text-[rgb(var(--fg-secondary))] tabular-nums">
      {formatMoney(row.paidCents, row.currency)}
      <span className="text-[rgb(var(--fg-muted))]"> of </span>
      {formatMoney(row.totalCents, row.currency)}
    </span>
  );
}

function ProgressBar({
  row,
  className,
}: {
  row: ProducerPaymentArtistProgress;
  className?: string;
}) {
  return (
    <span
      role="progressbar"
      aria-valuenow={row.percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${row.currency} paid so far`}
      className={cn(
        "block h-[3px] overflow-hidden rounded-[var(--radius-sm)] bg-[rgb(var(--border-subtle))]",
        className,
      )}
    >
      <span
        className="block h-full rounded-[var(--radius-sm)] bg-[rgb(var(--fg-success))]"
        style={{ width: `${String(row.percent)}%` }}
      />
    </span>
  );
}

function ArtistProgress({
  artist,
  timeZone,
  nowIso,
}: {
  artist: ProducerPaymentArtistRow;
  timeZone: string;
  nowIso: string;
}) {
  const rows = producerPaymentArtistProgress(artist);
  if (rows.length === 0) {
    return <span className="text-[11px] text-[rgb(var(--fg-muted))]">—</span>;
  }
  return (
    <span className="flex min-w-0 flex-col gap-2">
      {rows.map((row, index) => (
        <span key={row.currency} className="block min-w-0 max-w-[200px]">
          <ProgressText row={row} />
          <ProgressBar row={row} className="mt-1.5 w-full" />
          {index === 0 ? (
            <span className="mt-1 block text-[10.5px] leading-tight whitespace-nowrap text-[rgb(var(--fg-muted))]">
              {producerPaymentLastPaidLabel(artist, timeZone, nowIso)}
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

/** Only ever rendered inside "Needs you" — elsewhere the heading says it all. */
function ArtistAction({ artist }: { artist: ProducerPaymentArtistRow }) {
  const proof = artist.pendingProofs[0];
  if (proof) {
    return (
      <Link
        href={`/dashboard/payments/${encodeURIComponent(proof.proofId)}`}
        aria-label={`Review ${proof.purchaseTitle} proof`}
        className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[11px] font-bold whitespace-nowrap text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
      >
        Review
      </Link>
    );
  }
  const next = artist.nextPayment;
  if (!next) return null;
  return (
    <PaymentReminderButton
      layout="inline"
      purchaseId={next.purchaseId}
      installmentId={next.installmentId}
      installmentLabel={`${next.purchaseTitle} · ${amountLabel(next.amountCents, next.currency)}`}
    />
  );
}

function GroupHeading({
  id,
  label,
  count,
  tone,
}: {
  id?: string | undefined;
  label: string;
  count: number;
  tone: "danger" | "muted";
}) {
  return (
    // scroll-mt keeps the heading clear of the sticky chrome when a deep
    // link from the dashboard jumps straight to this group.
    <div id={id} className="flex min-w-0 items-center gap-3 scroll-mt-24 pt-1 pb-2">
      <h3
        className={cn(
          "font-mono text-[9px] font-bold tracking-[0.14em] whitespace-nowrap uppercase",
          tone === "danger" ? "text-[rgb(var(--fg-danger-text))]" : "text-[rgb(var(--fg-muted))]",
        )}
      >
        {label}
      </h3>
      <span aria-hidden="true" className="h-px flex-1 bg-[rgb(var(--border-subtle))]" />
      <span className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">{String(count)}</span>
    </div>
  );
}

function ArtistDesktopTable({
  artists,
  timeZone,
  nowIso,
  withAction,
  caption,
  showHeader,
}: {
  artists: readonly ProducerPaymentArtistRow[];
  timeZone: string;
  nowIso: string;
  withAction: boolean;
  caption: string;
  showHeader: boolean;
}) {
  return (
    <div className="hidden overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] md:block">
      <table className="w-full table-fixed border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr
            className={cn(
              showHeader &&
                "border-b border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-background))]",
            )}
          >
            {[
              ["Artist", "w-[26%]"],
              ["Payment", "w-[34%]"],
              ["Paid", "w-[26%]"],
              ["Action", "w-[14%]"],
            ].map(([label, width]) => (
              <th
                key={label}
                scope="col"
                className={cn(
                  width,
                  showHeader
                    ? "px-3 py-2 text-[9px] font-bold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase xl:px-4"
                    : "h-0 p-0",
                )}
              >
                <span className={cn((!showHeader || label === "Action") && "sr-only")}>
                  {label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgb(var(--border-subtle))]">
          {artists.map((artist) => (
            <tr
              key={artist.clientContactId}
              className="align-middle hover:bg-[rgb(var(--bg-sunken))]"
            >
              <th scope="row" className="px-3 py-3.5 text-left xl:px-4">
                <ArtistName artist={artist} stacked />
              </th>
              <td className="px-3 py-3.5 xl:px-4">
                <ArtistLine artist={artist} timeZone={timeZone} nowIso={nowIso} stacked />
              </td>
              <td className="px-3 py-3.5 xl:px-4">
                <ArtistProgress artist={artist} timeZone={timeZone} nowIso={nowIso} />
              </td>
              <td className="px-3 py-3.5 xl:px-4">
                {withAction ? <ArtistAction artist={artist} /> : null}
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
  nowIso,
  withAction,
}: {
  artists: readonly ProducerPaymentArtistRow[];
  timeZone: string;
  nowIso: string;
  withAction: boolean;
}) {
  return (
    <ul className="divide-y divide-[rgb(var(--border-subtle))] overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] md:hidden">
      {artists.map((artist) => {
        const progress = producerPaymentArtistProgress(artist);
        return (
          <li key={artist.clientContactId} className="min-w-0 px-3.5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0 flex-1">
                <ArtistName artist={artist} />
                <span className="mt-1 block">
                  <ArtistLine artist={artist} timeZone={timeZone} nowIso={nowIso} />
                </span>
              </div>
              {withAction ? <ArtistAction artist={artist} /> : null}
            </div>
            <div className="mt-2.5 flex flex-col gap-1.5">
              {progress.map((row) => (
                <ProgressBar key={row.currency} row={row} className="w-full" />
              ))}
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                {progress.map((row) => (
                  <ProgressText key={row.currency} row={row} />
                ))}
                <span className="text-[10.5px] whitespace-nowrap text-[rgb(var(--fg-muted))]">
                  · {producerPaymentLastPaidLabel(artist, timeZone, nowIso)}
                </span>
              </span>
            </div>
          </li>
        );
      })}
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
        Page {String(page)} of {String(totalPages)} · {String(totalItems)}{" "}
        {totalItems === 1 ? "Artist" : "Artists"}
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

      <ul className="divide-y divide-[rgb(var(--border-subtle))] overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] md:hidden">
        {events.map((event) => (
          <li key={event.id} className="min-w-0 px-3.5 py-3">
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
  // Counted before the status filter, so a chip never hides the other chip.
  const needsYou = useMemo(
    () =>
      producerPaymentNeedsYou(
        aggregateProducerPaymentArtists(
          filterProducerPaymentRecords(data.records, {
            query,
            clientContactId,
            currency,
            projectId,
            status: "all",
          }),
          timeRange,
          producerTimeZone,
          initialNowIso,
        ),
      ),
    [
      clientContactId,
      currency,
      data.records,
      initialNowIso,
      producerTimeZone,
      projectId,
      query,
      timeRange,
    ],
  );
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

  const rangeLabel = rangeSummaryLabel(timeRange, producerTimeZone, initialNowIso);
  const periodLabel = TIME_OPTIONS.find((option) => option.value === timePreset)?.label ?? "Custom";
  const activeFilterCount =
    Number(clientContactId !== "all") +
    Number(currency !== "all") +
    Number(projectId !== "all") +
    Number(status !== "all");
  const noPayments = data.records.length === 0;
  const noMatches = !noPayments && filteredRecords.length === 0;
  const nothingOwed = summary.length > 0 && summary.every((total) => total.owedNowCents === 0);
  const nothingExpected = summary.length > 0 && summary.every((total) => total.expectedCents === 0);
  const allPaid =
    filteredRecords.length > 0 &&
    filteredRecords.every((record) => record.totalRemainingCents === 0);

  function toggleStatus(next: ProducerPaymentStatusFilter) {
    setStatus((current) => (current === next ? "all" : next));
    setPage(1);
  }

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
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-col gap-2 border-b border-[rgb(var(--border-subtle))] pb-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[9px] font-bold tracking-[0.14em] text-[rgb(var(--brand-primary-text))] uppercase">
              Money dashboard
            </p>
            <h1 className="font-display mt-0.5 min-w-0 truncate text-[clamp(1.3rem,4.5vw,1.8rem)] leading-none font-extrabold tracking-[-0.04em] text-[rgb(var(--fg-default))]">
              Payments
            </h1>
          </div>
          <div
            role="tablist"
            aria-label="Payment views"
            className="ml-auto grid shrink-0 grid-cols-2 gap-1 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] p-1 sm:rounded-[var(--radius-md)]"
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
                  "sk-press inline-flex min-h-9 items-center justify-center rounded-[var(--radius-sm)] px-2 text-[11px] font-bold capitalize focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:px-3",
                  view === option
                    ? "bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-elevated))]"
                    : "text-[rgb(var(--fg-secondary))]",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
          <label className="min-w-0">
            <span className="sr-only">Search payments</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Search artist, project, or reference"
              className="block min-h-11 w-full min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)] sm:text-[12px]"
            />
          </label>

          <label className="shrink-0">
            <span className="sr-only">Time range</span>
            <select
              value={timePreset}
              aria-label="Time range"
              onChange={(event) => {
                setTimePreset(event.target.value as ProducerPaymentTimePreset);
                setPage(1);
              }}
              className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2.5 text-[11px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
            >
              {TIME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls={`${instanceId}-filters`}
            onClick={() => {
              setFiltersOpen((current) => !current);
            }}
            className="sk-press inline-flex min-h-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[11px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
          >
            Filters{activeFilterCount > 0 ? ` (${String(activeFilterCount)})` : ""}
          </button>
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
          <p role="alert" className="text-[11px] font-bold text-[rgb(var(--fg-danger-text))]">
            Choose a valid start and end date.
          </p>
        ) : null}

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

      {view === "overview" && timeRange.valid && !noPayments && !noMatches ? (
        <PaymentsSummary
          totals={summary}
          periodLabel={periodLabel}
          rangeLabel={rangeLabel}
          showCurrencyCode={summary.length > 1}
        />
      ) : null}

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
          className="min-w-0 space-y-3"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2" aria-live="polite">
            {needsYou.overdueArtists > 0 || needsYou.pendingProofs > 0 ? (
              <>
                {needsYou.overdueArtists > 0 ? (
                  <button
                    type="button"
                    aria-pressed={status === "overdue"}
                    onClick={() => {
                      toggleStatus("overdue");
                    }}
                    className={cn(badgeVariants({ variant: "danger" }), NEEDS_YOU_CHIP, {
                      "shadow-[inset_0_0_0_1px_currentColor]": status === "overdue",
                    })}
                  >
                    {needsYou.overdueArtists} overdue
                  </button>
                ) : null}
                {needsYou.pendingProofs > 0 ? (
                  <button
                    type="button"
                    aria-pressed={status === "needs_review"}
                    onClick={() => {
                      toggleStatus("needs_review");
                    }}
                    className={cn(badgeVariants({ variant: "accent" }), NEEDS_YOU_CHIP, {
                      "shadow-[inset_0_0_0_1px_currentColor]": status === "needs_review",
                    })}
                  >
                    {needsYou.pendingProofs}{" "}
                    {needsYou.pendingProofs === 1 ? "proof" : "proofs"}
                  </button>
                ) : null}
              </>
            ) : (
              <div className="flex min-w-0 flex-col gap-0.5">
                {nothingOwed && !allPaid ? (
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
            )}
            <p className="ml-auto font-mono text-[10px] whitespace-nowrap text-[rgb(var(--fg-muted))]">
              {String(artists.length)} {artists.length === 1 ? "Artist" : "Artists"}
            </p>
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

          <section aria-labelledby="artist-payment-table-heading" className="min-w-0 space-y-4">
            <h2 id="artist-payment-table-heading" className="sr-only">
              Artists
            </h2>
            {ATTENTION_GROUPS.filter((group) =>
              artistPage.items.some((artist) => producerPaymentAttention(artist) === group.id),
            ).map((group, groupIndex) => {
              const rows = artistPage.items.filter(
                (artist) => producerPaymentAttention(artist) === group.id,
              );
              return (
                <div key={group.id} className="min-w-0">
                  <GroupHeading
                    id={group.id === "needs_you" ? PAYMENTS_NEEDS_YOU_ANCHOR : undefined}
                    label={group.label}
                    count={rows.length}
                    tone={group.id === "needs_you" ? "danger" : "muted"}
                  />
                  <ArtistDesktopTable
                    artists={rows}
                    timeZone={producerTimeZone}
                    nowIso={initialNowIso}
                    withAction={group.id === "needs_you"}
                    caption={group.caption}
                    showHeader={groupIndex === 0}
                  />
                  <ArtistMobileRows
                    artists={rows}
                    timeZone={producerTimeZone}
                    nowIso={initialNowIso}
                    withAction={group.id === "needs_you"}
                  />
                </div>
              );
            })}
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
