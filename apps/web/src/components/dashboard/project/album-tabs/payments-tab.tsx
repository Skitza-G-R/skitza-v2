"use client";

import { Mail, FileText } from "lucide-react";

// PaymentsTab — Outstanding card + Milestones list for the Album page
// (BUILD-NOTES §5.3). Replaces the money/milestones portion of the old
// OverviewSubTab.
//
// Two halves:
//   1. Outstanding card — Total / Paid / Balance + "Send reminder" +
//      "Send invoice" buttons. Balance turns danger when > 0.
//   2. Milestones list — chronological. Each row: status pill + label
//      + amount + date.
//
// Phase 2 ships the read-only surfaces. Send reminder / Send invoice
// click handlers are stubs (parent passes them in if it wires real
// behavior). The data feeds in from caller.project.money() + an
// invoices-derived milestones array assembled in the page server
// component (Phase 3+ may expose this on the router directly).

export type MilestoneStatus = "paid" | "pending" | "overdue";

export interface PaymentMilestone {
  id: string;
  label: string;
  amountCents: number;
  status: MilestoneStatus;
  date: Date | null;
}

interface PaymentsTabProps {
  paidCents: number;
  outstandingCents: number;
  currency: string;
  nextChargeAt: Date | null;
  milestones: PaymentMilestone[];
  onSendReminder?: () => void;
  onSendInvoice?: () => void;
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${currency}`;
  }
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function statusStyle(status: MilestoneStatus): {
  color: string;
  bg: string;
  label: string;
} {
  if (status === "paid") {
    return {
      color: "rgb(var(--fg-success))",
      bg: "rgb(var(--fg-success) / 0.12)",
      label: "Paid",
    };
  }
  if (status === "overdue") {
    return {
      color: "rgb(var(--fg-danger))",
      bg: "rgb(var(--fg-danger) / 0.12)",
      label: "Overdue",
    };
  }
  return {
    color: "rgb(var(--brand-primary))",
    bg: "rgb(var(--brand-primary) / 0.12)",
    label: "Pending",
  };
}

export function PaymentsTab({
  paidCents,
  outstandingCents,
  currency,
  nextChargeAt,
  milestones,
  onSendReminder,
  onSendInvoice,
}: PaymentsTabProps) {
  const totalCents = paidCents + outstandingCents;
  const balanceIsDanger = outstandingCents > 0;

  return (
    <section
      role="tabpanel"
      id="panel-payments"
      aria-labelledby="tab-payments"
      className="space-y-6"
    >
      {/* Outstanding card */}
      <div
        className="rounded-[var(--radius-lg)] border p-5"
        style={{
          background: "rgb(var(--bg-elevated))",
          borderColor: "rgb(var(--border-subtle))",
        }}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color: "rgb(var(--fg-muted))" }}
            >
              Total
            </p>
            <p
              className="mt-1 font-syne text-[24px] font-bold tabular-nums"
              style={{ color: "rgb(var(--fg-default))" }}
            >
              {formatMoney(totalCents, currency)}
            </p>
          </div>
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color: "rgb(var(--fg-muted))" }}
            >
              Paid
            </p>
            <p
              className="mt-1 font-syne text-[24px] font-bold tabular-nums"
              style={{ color: "rgb(var(--fg-success))" }}
            >
              {formatMoney(paidCents, currency)}
            </p>
          </div>
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color: "rgb(var(--fg-muted))" }}
            >
              Balance
            </p>
            <p
              className="mt-1 font-syne text-[24px] font-bold tabular-nums"
              style={{
                color: balanceIsDanger
                  ? "rgb(var(--fg-danger))"
                  : "rgb(var(--fg-muted))",
              }}
            >
              {formatMoney(outstandingCents, currency)}
            </p>
          </div>
        </div>

        {nextChargeAt ? (
          <p
            className="mt-3 text-[12px]"
            style={{ color: "rgb(var(--fg-muted))" }}
          >
            Next charge {formatDate(nextChargeAt)}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onSendReminder}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors"
            style={{
              background: "transparent",
              borderColor: "rgb(var(--border-subtle))",
              color: "rgb(var(--fg-default))",
            }}
          >
            <Mail size={12} />
            Send reminder
          </button>
          <button
            type="button"
            onClick={onSendInvoice}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors"
            style={{
              background: "rgb(var(--brand-primary))",
              color: "rgb(var(--bg-sidebar))",
            }}
          >
            <FileText size={12} />
            Send invoice
          </button>
        </div>
      </div>

      {/* Milestones list */}
      <div>
        <h3
          className="font-syne text-[18px] font-bold"
          style={{ color: "rgb(var(--fg-default))" }}
        >
          Milestones
        </h3>

        {milestones.length === 0 ? (
          <p
            className="mt-3 rounded-[var(--radius-md)] border border-dashed px-4 py-6 text-[13px]"
            style={{
              borderColor: "rgb(var(--border-subtle))",
              color: "rgb(var(--fg-muted))",
            }}
          >
            No milestones yet — invoices show up here as they&apos;re created.
          </p>
        ) : (
          <ol className="mt-3 space-y-2">
            {milestones.map((m) => {
              const s = statusStyle(m.status);
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-[var(--radius-md)] border px-4 py-3"
                  style={{
                    background: "rgb(var(--bg-elevated))",
                    borderColor: "rgb(var(--border-subtle))",
                  }}
                >
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
                    style={{ color: s.color, background: s.bg }}
                  >
                    {s.label}
                  </span>
                  <p
                    className="flex-1 truncate text-[13px] font-medium"
                    style={{ color: "rgb(var(--fg-default))" }}
                  >
                    {m.label}
                  </p>
                  <span
                    className="whitespace-nowrap text-[12px]"
                    style={{ color: "rgb(var(--fg-muted))" }}
                  >
                    {formatDate(m.date)}
                  </span>
                  <span
                    className="ml-3 whitespace-nowrap font-mono text-[13px] tabular-nums"
                    style={{ color: "rgb(var(--fg-default))" }}
                  >
                    {formatMoney(m.amountCents, currency)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
