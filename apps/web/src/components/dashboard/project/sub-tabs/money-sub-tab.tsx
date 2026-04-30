"use client";

import { useTransition } from "react";

import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { openStripeDashboard } from "~/app/(producer)/dashboard/settings/stripe-actions";

// Batch G, Task 4 — Money sub-tab collapsed to a 3-metric strip.
//
// Producers want Paid / Outstanding / Next-charge at a glance, and a
// one-click bridge to the real ledger when they need it. The Invoices
// table is STILL the source of truth (webhooks insert rows on every
// Checkout / subscription invoice event; audit trail is intact). The
// UI just stops pretending to be a ledger and shows the producer the
// 3 numbers that actually matter.

// Money summary produced by the project.money query. See
// apps/web/src/server/trpc/routers/project.ts for the shape.
export interface MoneySummary {
  paidCents: number;
  outstandingCents: number;
  currency: string;
  nextChargeAt: Date | null;
}

export function MoneySubTab({
  money,
}: {
  money: MoneySummary;
}) {
  return (
    <section
      role="tabpanel"
      id="panel-money"
      aria-labelledby="tab-money"
      className="space-y-8"
    >
      <MoneyStrip money={money} />
    </section>
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
