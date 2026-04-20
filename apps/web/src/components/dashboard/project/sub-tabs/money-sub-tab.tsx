"use client";

import Link from "next/link";
import { useTransition } from "react";

import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { fmtDateTime } from "~/lib/time/relative";
import { openStripeDashboard } from "~/app/(app)/dashboard/settings/stripe-actions";

// Batch G, Task 4 — Money sub-tab collapsed to a 3-metric strip.
//
// Before: Contract section on top + an "Invoices" empty-state stub.
// The stub implied a full ledger was coming, which directly contradicts
// the simplification goal — Skitza is not going to reproduce Stripe's
// ledger. Producers want Paid / Outstanding / Next-charge at a glance,
// and a one-click bridge to the real ledger when they need it.
//
// The Invoices table is STILL the source of truth (webhooks insert
// rows on every Checkout / subscription invoice event; audit trail is
// intact). The UI just stops pretending to be a ledger and shows the
// producer the 3 numbers that actually matter.

// Money summary produced by the project.money query. See
// apps/web/src/server/trpc/routers/project.ts for the shape.
export interface MoneySummary {
  paidCents: number;
  outstandingCents: number;
  currency: string;
  nextChargeAt: Date | null;
}

// Contract row shape (passed through to ContractSection — unchanged
// surface for Task 4; Task 5 takes over the Contract section).
export interface ContractRow {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  signedAt: Date | null;
}

export function MoneySubTab({
  projectId,
  money,
  contracts,
}: {
  projectId: string;
  money: MoneySummary;
  contracts: ContractRow[];
}) {
  return (
    <section
      role="tabpanel"
      id="panel-money"
      aria-labelledby="tab-money"
      className="space-y-8"
    >
      <ContractSection projectId={projectId} contracts={contracts} />
      <MoneyStrip money={money} />
    </section>
  );
}

// ─── Contract section ────────────────────────────────────────────────
// Unchanged in Task 4 — Task 5 takes this over. Kept the existing
// behavior so the Task 4 commit is strictly the money-strip swap.
function ContractSection({
  projectId,
  contracts,
}: {
  projectId: string;
  contracts: ContractRow[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl tracking-tight" style={{ fontWeight: 700 }}>
            Contract
          </h2>
          <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
            Lock the terms before you start. The artist gets one signing link.
          </p>
        </div>
        <Link href={`/dashboard/contracts/new?projectId=${projectId}`}>
          <Button size="sm">New contract</Button>
        </Link>
      </div>

      {contracts.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center">
          <p className="text-sm text-[rgb(var(--fg-secondary))]">
            No contract yet — send one before kickoff.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {contracts.map((c) => (
            <li key={c.id}>
              <Link
                href={`/dashboard/contracts`}
                className="block rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 transition-colors hover:border-[rgb(var(--border-strong))]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[rgb(var(--fg-primary))]">
                      {c.title}
                    </p>
                    <p className="mt-0.5 font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
                      Created {fmtDateTime(c.createdAt)}
                      {c.signedAt ? ` · signed ${fmtDateTime(c.signedAt)}` : ""}
                    </p>
                  </div>
                  <span
                    className={[
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[0.62rem] font-medium uppercase tracking-[0.1em]",
                      c.status === "signed"
                        ? "border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))]"
                        : c.status === "cancelled" || c.status === "expired"
                          ? "border-[rgb(var(--fg-danger)/0.35)] bg-[rgb(var(--fg-danger)/0.12)] text-[rgb(var(--fg-danger))]"
                          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))]",
                    ].join(" ")}
                  >
                    {c.status}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Money strip ─────────────────────────────────────────────────────
// Three metrics + an "Open in Stripe" CTA. The CTA is a Server
// Action roundtrip because Stripe's Express dashboard link is
// single-use and time-limited — minting it client-side would leak a
// secret; minting it via the Server Action keeps the secret on the
// server and the producer's tab gets a fresh URL each click.
function MoneyStrip({ money }: { money: MoneySummary }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function onOpenStripe() {
    startTransition(async () => {
      const res = await openStripeDashboard();
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      // Full-page redirect, not Next.js navigation: Stripe's hosted
      // dashboard sets its own cookies/referer and doesn't play nice
      // with a client router push.
      window.location.href = res.url;
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl tracking-tight" style={{ fontWeight: 700 }}>
          Money
        </h2>
        <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
          Paid, outstanding, and what&rsquo;s next at a glance. Deep ledger
          lives in Stripe.
        </p>
      </div>

      <div
        className="grid gap-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 sm:grid-cols-3"
        role="group"
        aria-label="Money summary"
      >
        <MoneyMetric
          label="Paid"
          value={formatMoney(money.paidCents, money.currency)}
          tone="success"
        />
        <MoneyMetric
          label="Outstanding"
          value={
            money.outstandingCents > 0
              ? formatMoney(money.outstandingCents, money.currency)
              : "—"
          }
          tone={money.outstandingCents > 0 ? "warn" : "muted"}
        />
        <MoneyMetric
          label="Next charge"
          value={
            money.nextChargeAt
              ? fmtShortDate(money.nextChargeAt)
              : "—"
          }
          tone="neutral"
        />
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={onOpenStripe}
        >
          {pending ? "Opening Stripe…" : "Open in Stripe →"}
        </Button>
      </div>
    </div>
  );
}

function MoneyMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "warn" | "muted" | "neutral";
}) {
  const color =
    tone === "success"
      ? "rgb(var(--brand-primary))"
      : tone === "warn"
        ? "rgb(var(--fg-warning))"
        : tone === "muted"
          ? "rgb(var(--fg-muted))"
          : "rgb(var(--fg-primary))";
  return (
    <div>
      <p className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <p
        className="sk-num mt-1 font-display text-2xl leading-none"
        style={{ fontWeight: 800, color }}
      >
        {value}
      </p>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────
function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function fmtShortDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(d);
}
