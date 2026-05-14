import { formatMoney } from "~/lib/format/money";
import { type Stage } from "~/lib/projects/stages";
import { formatRelativeTime } from "~/lib/time/relative";

// Payments panel — money-only view of the relationship.
//
// Per direction (2026-05-06): the action buttons ("Send reminder" /
// "New invoice") were dropped because the underlying mutations don't
// exist yet — better to ship a clean read-only ledger than buttons
// that no-op. Producer can act from a project page.
//
// Three KPI cards up top mirror the design's strip:
//   • Lifetime billed = paid + outstanding (sum of priceCents across
//     non-archived projects with a price)
//   • Paid = stats.lifetimeCents (only finalPaid projects)
//   • Balance = stats.outstandingCents (active, unpaid projects)
//
// Below: an "Invoice ledger" — one row per project with priceCents.
// We don't yet expose individual invoice records to this surface; the
// router only rolls up paid/outstanding per project, so the ledger
// shows the project-level snapshot (deposit + payments OR final
// balance) keyed off depositPaid + finalPaid. Once a future
// `invoice.listForClient` query lands, this becomes a true per-invoice
// list — same row component, just more rows per project.

type Project = {
  id: string;
  title: string;
  stage: Stage;
  priceCents: number;
  currency: string | null;
  depositPaid: boolean;
  finalPaid: boolean;
  outstandingCents: number;
  updatedAt: Date | string;
  nextSessionAt: Date | string | null;
};

export function ClientPaymentsPanel({
  projects,
  stats,
  currency,
}: {
  projects: Project[];
  stats: { lifetimeCents: number; outstandingCents: number };
  currency: string;
}) {
  const billedCents = stats.lifetimeCents + stats.outstandingCents;

  return (
    <div className="flex flex-col gap-5">
      <Outstanding
        billedCents={billedCents}
        paidCents={stats.lifetimeCents}
        balanceCents={stats.outstandingCents}
        currency={currency}
      />
      <InvoiceLedger projects={projects} currency={currency} />
    </div>
  );
}

function Outstanding({
  billedCents,
  paidCents,
  balanceCents,
  currency,
}: {
  billedCents: number;
  paidCents: number;
  balanceCents: number;
  currency: string;
}) {
  return (
    <section
      aria-labelledby="payments-outstanding"
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
    >
      <h2
        id="payments-outstanding"
        className="font-display text-base font-bold tracking-tight text-[rgb(var(--fg-default))]"
      >
        Outstanding
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <MoneyCard
          label="Lifetime billed"
          value={billedCents}
          currency={currency}
          tone="default"
        />
        <MoneyCard
          label="Paid"
          value={paidCents}
          currency={currency}
          tone="success"
        />
        <MoneyCard
          label="Balance"
          value={balanceCents}
          currency={currency}
          tone={balanceCents > 0 ? "danger" : "default"}
        />
      </div>
    </section>
  );
}

function MoneyCard({
  label,
  value,
  currency,
  tone,
}: {
  label: string;
  value: number;
  currency: string;
  tone: "default" | "success" | "danger";
}) {
  const palette =
    tone === "danger"
      ? {
          bg: "bg-[rgb(var(--fg-danger)/0.08)]",
          border: "border-[rgb(var(--fg-danger)/0.18)]",
          color: "rgb(var(--fg-danger))",
        }
      : tone === "success"
        ? {
            bg: "bg-[rgb(var(--fg-success)/0.08)]",
            border: "border-[rgb(var(--fg-success)/0.18)]",
            color: "rgb(var(--fg-success))",
          }
        : {
            bg: "bg-[rgb(var(--bg-base))]",
            border: "border-[rgb(var(--border-subtle))]",
            color: "rgb(var(--fg-default))",
          };
  return (
    <div
      className={[
        "rounded-[var(--radius-sm)] border px-4 py-3",
        palette.bg,
        palette.border,
      ].join(" ")}
    >
      <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <p
        className="sk-num mt-1 font-mono text-2xl font-extrabold tabular-nums"
        style={{ color: palette.color }}
      >
        {formatMoney(value, currency)}
      </p>
    </div>
  );
}

// ─── Invoice ledger ─────────────────────────────────────────────────

function InvoiceLedger({
  projects,
  currency,
}: {
  projects: Project[];
  currency: string;
}) {
  const billable = projects.filter((p) => p.priceCents > 0);
  return (
    <section
      aria-labelledby="payments-ledger"
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
    >
      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <h2
          id="payments-ledger"
          className="font-display text-base font-bold tracking-tight text-[rgb(var(--fg-default))]"
        >
          Invoice ledger
        </h2>
      </header>

      {billable.length === 0 ? (
        <p className="border-t border-[rgb(var(--border-subtle))] p-6 text-center text-[13px] text-[rgb(var(--fg-muted))]">
          No invoices yet.
        </p>
      ) : (
        <>
          {/* Column headers (desktop only) */}
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,0.75fr)] items-center gap-4 border-y border-[rgb(var(--border-subtle))] px-4 py-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))] sm:grid sm:px-5">
            <span>Project</span>
            <span>Description</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Date</span>
            <span className="text-right">Status</span>
          </div>

          <ul role="list" className="divide-y divide-[rgb(var(--border-subtle))]">
            {billable.map((p) => (
              <li key={p.id}>
                <LedgerRow project={p} currency={currency} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function LedgerRow({
  project,
  currency,
}: {
  project: Project;
  currency: string;
}) {
  const status = ledgerStatus(project);
  const description = ledgerDescription(project);
  const amount = formatMoney(project.priceCents, project.currency ?? currency);
  const dateLabel = formatRelativeTime(
    project.updatedAt instanceof Date
      ? project.updatedAt
      : new Date(project.updatedAt),
  );

  return (
    <div className="grid grid-cols-2 gap-3 px-4 py-3 text-[13px] sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,0.75fr)] sm:items-center sm:gap-4 sm:px-5">
      <p className="truncate font-bold text-[rgb(var(--fg-default))]">
        {project.title}
      </p>
      <p className="truncate text-[rgb(var(--fg-muted))]">{description}</p>
      <p className="sk-num font-mono font-bold tabular-nums text-[rgb(var(--fg-default))] sm:text-right">
        {amount}
      </p>
      <p className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-[rgb(var(--fg-muted))] sm:text-right">
        {dateLabel}
      </p>
      <p className="sm:text-right">
        <span className={`pill ${status.toneClass}`}>{status.label}</span>
      </p>
    </div>
  );
}

function ledgerStatus(p: Project): { label: string; toneClass: string } {
  if (p.finalPaid) return { label: "Paid", toneClass: "pill-success" };
  if (p.stage === "archived")
    return { label: "Archived", toneClass: "pill-neutral" };
  if (isOverdue(p)) return { label: "Overdue", toneClass: "pill-danger" };
  if (p.depositPaid)
    return { label: "Deposit paid", toneClass: "pill-warning" };
  return { label: "Open", toneClass: "pill-warning" };
}

function ledgerDescription(p: Project): string {
  if (p.finalPaid) return "Deposit + final balance";
  if (p.depositPaid) return "Final balance pending";
  if (p.outstandingCents > 0) return "Deposit pending";
  return "Quoted";
}

function isOverdue(p: Project): boolean {
  if (!p.nextSessionAt) return false;
  const t =
    p.nextSessionAt instanceof Date
      ? p.nextSessionAt.getTime()
      : new Date(p.nextSessionAt).getTime();
  return t < Date.now();
}
