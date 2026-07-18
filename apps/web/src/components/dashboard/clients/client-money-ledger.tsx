import { Check, Clock3, XCircle } from "lucide-react";

import { formatMoney } from "~/lib/format/money";

export interface ClientMoneyCurrencyTotal {
  currency: string;
  purchasedCents: number;
  paidCents: number;
  remainingCents: number;
}

export interface ClientMoneyPayment {
  id: string;
  amountCents: number;
  currency: string;
  paidAtIso: string;
  source: "proof" | "manual";
  note: string | null;
}

export interface ClientMoneyProof {
  id: string;
  amountCents: number;
  currency: string;
  status: "pending" | "confirmed" | "rejected";
  originalFileName: string | null;
  createdAtIso: string;
  rejectionNote: string | null;
}

export interface ClientMoneyPurchase {
  id: string;
  reference: string;
  title: string;
  lifecycleStatus: string;
  acceptedAtIso: string | null;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  payments: ClientMoneyPayment[];
  proofs: ClientMoneyProof[];
}

export interface ClientMoneyProject {
  id: string;
  title: string;
  lifecycleStatus: string;
  currencyTotals: ClientMoneyCurrencyTotal[];
  purchases: ClientMoneyPurchase[];
}

export interface ClientMoneyLedgerData {
  currencyTotals: ClientMoneyCurrencyTotal[];
  projects: ClientMoneyProject[];
}

interface ClientMoneyLedgerProps {
  data: ClientMoneyLedgerData;
}

export function ClientMoneyLedger({ data }: ClientMoneyLedgerProps) {
  return (
    <section aria-labelledby="client-money-heading" className="min-w-0">
      <div className="mb-4">
        <p className="text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
          Commercial history
        </p>
        <h2
          id="client-money-heading"
          className="font-display mt-0.5 text-[20px] font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]"
        >
          Money
        </h2>
        <p className="mt-1 text-[12.5px] text-[rgb(var(--fg-muted))]">
          Purchases, confirmed payments, and uploaded proofs stay grouped by project. Currencies are
          never combined.
        </p>
      </div>

      {data.currencyTotals.length > 0 ? (
        <div
          className="mb-5 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"
          aria-label="Totals by currency"
        >
          {data.currencyTotals.map((total) => (
            <CurrencySummary key={total.currency} total={total} />
          ))}
        </div>
      ) : null}

      {data.projects.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-10 text-center">
          <p className="text-[14px] font-semibold text-[rgb(var(--fg-default))]">
            No purchases or payments yet
          </p>
          <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
            Accepted purchases and their payment records will appear here under the relevant
            project.
          </p>
        </div>
      ) : (
        <div className="min-w-0 space-y-4">
          {data.projects.map((project) => (
            <article
              key={project.id}
              className="min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
            >
              <header className="min-w-0 border-b border-[rgb(var(--border-subtle))] px-4 py-3.5 sm:flex sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="text-[9.5px] font-bold tracking-[0.13em] text-[rgb(var(--fg-muted))] uppercase">
                    Project
                  </p>
                  <h3 className="mt-0.5 text-[15px] font-bold break-words text-[rgb(var(--fg-default))]">
                    {project.title}
                  </h3>
                </div>
                <StatusBadge value={project.lifecycleStatus} />
              </header>

              {project.currencyTotals.length > 0 ? (
                <div className="grid min-w-0 grid-cols-1 gap-2 border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background)/0.45)] p-3 sm:grid-cols-2 xl:grid-cols-3">
                  {project.currencyTotals.map((total) => (
                    <CurrencySummary
                      key={`${project.id}-${total.currency}`}
                      total={total}
                      compact
                    />
                  ))}
                </div>
              ) : null}

              <div className="min-w-0 space-y-3 p-3 sm:p-4">
                {project.purchases.length === 0 ? (
                  <p className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] px-3 py-5 text-center text-[12.5px] text-[rgb(var(--fg-muted))]">
                    No purchases in this project
                  </p>
                ) : (
                  project.purchases.map((purchase) => (
                    <PurchaseLedger key={purchase.id} purchase={purchase} />
                  ))
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function CurrencySummary({
  total,
  compact = false,
}: {
  total: ClientMoneyCurrencyTotal;
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
      <dl className="mt-2 grid min-w-0 grid-cols-3 gap-x-3 gap-y-2">
        <MoneyDatum label="Purchased" cents={total.purchasedCents} currency={total.currency} />
        <MoneyDatum label="Paid" cents={total.paidCents} currency={total.currency} />
        <MoneyDatum label="Remaining" cents={total.remainingCents} currency={total.currency} />
      </dl>
    </section>
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
        className="mt-0.5 font-mono text-[12.5px] font-bold break-words tabular-nums"
        style={{
          color: danger ? "rgb(var(--fg-danger-text))" : "rgb(var(--fg-default))",
        }}
      >
        {formatMoney(cents, currency, { withCents: true })}{" "}
        <span className="text-[9px] text-[rgb(var(--fg-muted))]">{currency}</span>
      </dd>
    </div>
  );
}

function PurchaseLedger({ purchase }: { purchase: ClientMoneyPurchase }) {
  const openByDefault =
    purchase.remainingCents > 0 ||
    purchase.proofs.some((proof) => proof.status === "pending" || proof.status === "rejected");

  return (
    <details
      open={openByDefault}
      className="group min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))]"
    >
      <summary className="min-w-0 cursor-pointer list-none px-3 py-3 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))]">
                {purchase.reference}
              </span>
              <StatusBadge value={purchase.lifecycleStatus} />
            </span>
            <span className="mt-1 block text-[14px] font-bold break-words text-[rgb(var(--fg-default))]">
              {purchase.title}
            </span>
            {purchase.acceptedAtIso ? (
              <span className="mt-1 block text-[11px] text-[rgb(var(--fg-muted))]">
                Accepted {formatDate(purchase.acceptedAtIso)}
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

        <span className="mt-3 grid min-w-0 grid-cols-3 gap-2 border-t border-[rgb(var(--border-subtle))] pt-2.5">
          <PurchaseSummaryAmount label="Total" cents={purchase.totalCents} purchase={purchase} />
          <PurchaseSummaryAmount label="Paid" cents={purchase.paidCents} purchase={purchase} />
          <PurchaseSummaryAmount
            label="Remaining"
            cents={purchase.remainingCents}
            purchase={purchase}
            danger={purchase.remainingCents > 0}
          />
        </span>
      </summary>

      <div className="border-t border-[rgb(var(--border-subtle))]">
        <p className="px-3 pt-2.5 text-[11px] text-[rgb(var(--fg-muted))]">
          Subtotal {formatMoney(purchase.subtotalCents, purchase.currency, { withCents: true })}
          {" · "}
          Tax {formatMoney(purchase.taxCents, purchase.currency, { withCents: true })}
        </p>
        <div className="grid min-w-0 grid-cols-1 gap-3 p-3 pt-2.5 xl:grid-cols-2">
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
              Payments ({purchase.payments.length})
            </p>
            {purchase.payments.length === 0 ? (
              <p className="mt-2 text-[12px] text-[rgb(var(--fg-muted))]">No payments</p>
            ) : (
              <ul className="mt-2 min-w-0 space-y-2">
                {purchase.payments.map((payment) => (
                  <li
                    key={payment.id}
                    className="min-w-0 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] p-2.5"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                          <Check size={13} className="text-[rgb(var(--fg-success))]" aria-hidden />
                          Confirmed payment
                        </p>
                        <p className="mt-0.5 text-[10.5px] text-[rgb(var(--fg-muted))]">
                          {formatDate(payment.paidAtIso)} ·{" "}
                          {payment.source === "proof" ? "From proof" : "Added manually"}
                        </p>
                      </div>
                      <p className="shrink-0 font-mono text-[12px] font-bold text-[rgb(var(--fg-default))] tabular-nums">
                        {formatMoney(payment.amountCents, payment.currency, {
                          withCents: true,
                        })}{" "}
                        <span className="text-[9px] text-[rgb(var(--fg-muted))]">
                          {payment.currency}
                        </span>
                      </p>
                    </div>
                    {payment.note ? (
                      <p className="mt-2 text-[11px] leading-relaxed break-words text-[rgb(var(--fg-muted))]">
                        {payment.note}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
              Proofs ({purchase.proofs.length})
            </p>
            {purchase.proofs.length === 0 ? (
              <p className="mt-2 text-[12px] text-[rgb(var(--fg-muted))]">No proofs</p>
            ) : (
              <ul className="mt-2 min-w-0 space-y-2">
                {purchase.proofs.map((proof) => (
                  <li
                    key={proof.id}
                    className="min-w-0 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] p-2.5"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <ProofIcon status={proof.status} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-semibold break-all text-[rgb(var(--fg-default))]">
                          {proof.originalFileName ?? "Payment proof"}
                        </p>
                        <p className="mt-0.5 text-[10.5px] text-[rgb(var(--fg-muted))]">
                          {statusLabel(proof.status)} · {formatDate(proof.createdAtIso)}
                        </p>
                      </div>
                      <p className="shrink-0 font-mono text-[12px] font-bold text-[rgb(var(--fg-default))] tabular-nums">
                        {formatMoney(proof.amountCents, proof.currency, {
                          withCents: true,
                        })}{" "}
                        <span className="text-[9px] text-[rgb(var(--fg-muted))]">
                          {proof.currency}
                        </span>
                      </p>
                    </div>
                    {proof.rejectionNote ? (
                      <p className="mt-2 rounded-[var(--radius-sm)] bg-[rgb(var(--fg-danger)/0.08)] px-2 py-1.5 text-[11px] leading-relaxed break-words text-[rgb(var(--fg-danger-text))]">
                        {proof.rejectionNote}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}

function PurchaseSummaryAmount({
  label,
  cents,
  purchase,
  danger = false,
}: {
  label: string;
  cents: number;
  purchase: ClientMoneyPurchase;
  danger?: boolean;
}) {
  return (
    <span className="min-w-0">
      <span className="block text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
        {label}
      </span>
      <span
        className="mt-0.5 block font-mono text-[11.5px] font-bold break-words tabular-nums"
        style={{
          color: danger ? "rgb(var(--fg-danger-text))" : "rgb(var(--fg-default))",
        }}
      >
        {formatMoney(cents, purchase.currency, { withCents: true })}
      </span>
    </span>
  );
}

function StatusBadge({ value }: { value: string }) {
  return (
    <span className="mt-2 inline-flex shrink-0 rounded-[var(--radius-sm)] bg-[rgb(var(--bg-background))] px-2 py-1 text-[9.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase sm:mt-0">
      {statusLabel(value)}
    </span>
  );
}

function ProofIcon({ status }: { status: ClientMoneyProof["status"] }) {
  const className = "mt-0.5 h-3.5 w-3.5 shrink-0";
  if (status === "confirmed") {
    return <Check className={`${className} text-[rgb(var(--fg-success))]`} aria-hidden />;
  }
  if (status === "rejected") {
    return <XCircle className={`${className} text-[rgb(var(--fg-danger))]`} aria-hidden />;
  }
  return <Clock3 className={`${className} text-[rgb(var(--fg-muted))]`} aria-hidden />;
}

function statusLabel(value: string): string {
  const normalized = value.replaceAll("_", " ").replaceAll("-", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
