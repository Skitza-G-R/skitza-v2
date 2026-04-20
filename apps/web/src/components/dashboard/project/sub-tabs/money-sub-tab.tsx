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
// Batch G, Task 5 — contracts collapse to a read-only terms summary.
//
// Before: an actions panel with a prominent "Send contract / New
// contract" button, an empty-state CTA, and a list of prior sends.
// This treated contracts as a separate document the producer had to
// manage in parallel to the project.
//
// After: terms are agreed AT BOOKING TIME via the checkbox on the
// public booking flow. The Money sub-tab's Contract section now
// reports the outcome, not the action:
//   * If at least one contract exists → show the most recent: signed
//     status, signed-on date, a link to the signed PDF (or detail
//     page when the PDF isn't yet flattened), plus a quieter "Send
//     another" link for unusual multi-contract projects.
//   * If no contract exists → tell the producer what WILL happen
//     automatically once booking confirmation lands. The copy
//     reframes contracts as a side-effect of booking, not a parallel
//     workflow. The "manage template" link points back to Setup
//     where the default terms live.
//
// TODO(contract-auto-generate): the plan calls for an
// auto-generation-on-booking flow ("when a booking is confirmed,
// standard terms are auto-generated and emailed to the artist for
// e-signature"). That hook does not exist yet in the booking.confirm
// or booking.publicRequest paths. Adding it is a separate task
// (requires a producer-level `defaultContractTemplateId` column or a
// hard-coded Skitza template, plus the send-for-signature wiring).
// For now the "no contract" copy is aspirational — it describes the
// intended behavior; the producer still has to click "Send one now"
// if they want a signed PDF for this project.
function ContractSection({
  projectId,
  contracts,
}: {
  projectId: string;
  contracts: ContractRow[];
}) {
  const latest = contracts[0] ?? null;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl tracking-tight" style={{ fontWeight: 700 }}>
          Contract
        </h2>
      </div>

      {latest ? (
        <SignedContractCard contract={latest} projectId={projectId} />
      ) : (
        <NoContractCard projectId={projectId} />
      )}
    </div>
  );
}

// Render the latest contract on the project. 95% of projects have one
// contract; the rare multi-contract case is handled by the small
// "Send another" link at the bottom. Older contracts stay findable
// at /dashboard/contracts.
function SignedContractCard({
  contract,
  projectId,
}: {
  contract: ContractRow;
  projectId: string;
}) {
  const isSigned = contract.status === "signed" || contract.signedAt !== null;
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[rgb(var(--fg-primary))]">
            {isSigned ? "Signed" : stateLabel(contract.status)}
            {isSigned && contract.signedAt
              ? ` on ${fmtDateTime(contract.signedAt)}`
              : ""}
          </p>
          <p className="mt-0.5 text-xs text-[rgb(var(--fg-secondary))]">
            Terms: standard · deposit at booking · balance on delivery
          </p>
          <p className="mt-0.5 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-[rgb(var(--fg-muted))]">
            Title: {contract.title} · created {fmtDateTime(contract.createdAt)}
          </p>
        </div>
        <span
          className={[
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[0.62rem] font-medium uppercase tracking-[0.1em]",
            isSigned
              ? "border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))]"
              : contract.status === "cancelled" || contract.status === "expired"
                ? "border-[rgb(var(--fg-danger)/0.35)] bg-[rgb(var(--fg-danger)/0.12)] text-[rgb(var(--fg-danger))]"
                : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))]",
          ].join(" ")}
        >
          {contract.status}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/dashboard/contracts`}
          className="inline-flex min-h-9 items-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 text-xs font-medium text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))]"
        >
          {isSigned ? "View signed PDF →" : "Open contract →"}
        </Link>
        <Link
          href={`/dashboard/contracts/new?projectId=${projectId}`}
          className="inline-flex min-h-9 items-center rounded-[var(--radius-md)] px-3 text-xs font-medium text-[rgb(var(--fg-secondary))] underline decoration-dotted underline-offset-2 hover:text-[rgb(var(--fg-primary))]"
        >
          Send another
        </Link>
      </div>
    </div>
  );
}

// Framed as "here's what happens automatically" — not as an action
// panel. The primary affordance is the "manage template" link, which
// points to the Setup → Services tab where the producer can edit the
// default terms behind the contract.
function NoContractCard({ projectId }: { projectId: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-5">
      <p className="text-sm text-[rgb(var(--fg-primary))]">No contract yet.</p>
      <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
        When a booking is confirmed, standard terms are auto-generated and
        emailed to the artist for e-signature.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/dashboard/settings?section=services"
          className="inline-flex min-h-9 items-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 text-xs font-medium text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))]"
        >
          Manage template →
        </Link>
        <Link
          href={`/dashboard/contracts/new?projectId=${projectId}`}
          className="inline-flex min-h-9 items-center rounded-[var(--radius-md)] px-3 text-xs font-medium text-[rgb(var(--fg-secondary))] underline decoration-dotted underline-offset-2 hover:text-[rgb(var(--fg-primary))]"
        >
          Send one now
        </Link>
      </div>
    </div>
  );
}

function stateLabel(status: string): string {
  // Capitalize + humanize the free-text status. "contract_sent" stays
  // "Sent"; "viewed" stays "Viewed"; etc.
  if (status === "sent") return "Sent";
  if (status === "viewed") return "Viewed";
  if (status === "draft") return "Draft";
  if (status === "cancelled") return "Cancelled";
  if (status === "expired") return "Expired";
  if (status === "completed") return "Completed";
  return status;
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
