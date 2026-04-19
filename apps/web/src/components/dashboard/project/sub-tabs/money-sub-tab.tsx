"use client";

import Link from "next/link";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { fmtDateTime } from "~/lib/time/relative";

// Task 8 — Project Room Money sub-tab.
//
// Merges the old inner "Contract" + "Invoices" tabs from project-view.tsx
// into a single project-scoped Money surface. Contract section renders
// first (send-on-demand or signed list with audit trail), invoices
// ledger below (currently an empty-state placeholder — the invoicing
// flow is scheduled for a later phase).
//
// MoneySubTab is rendered directly by page.tsx when `tab === "money"`,
// replacing the MoneyPlaceholder stub introduced in Task 7. The outer
// ProjectSubTabs nav still owns the tab button that controls this
// panel, so the ARIA ids are `panel-money` / `tab-money` to match
// project-sub-tabs.tsx.

// Shape of a contract row consumed by ContractSection — matches what
// page.tsx already derives from caller.contract.list(). Keep this
// minimal: the deep contract detail view lives at /dashboard/contracts,
// not here.
export interface ContractRow {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  signedAt: Date | null;
}

export function MoneySubTab({
  projectId,
  contracts,
}: {
  projectId: string;
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
      <InvoicesSection />
    </section>
  );
}

// ─── Contract section ────────────────────────────────────────────────
// Lifted verbatim from project-view.tsx's old ContractTab. The outer
// <section role="tabpanel"> wrapper is removed (MoneySubTab owns the
// panel now); this renders as a plain <div> so the two sections stack
// inside a single tabpanel.
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
        <EmptyState
          title="No contract yet."
          description="Send one before kickoff. The artist gets a single signing link, and every view and signature is timestamped for your records."
          action={
            <Button asChild size="sm">
              <Link href={`/dashboard/contracts/new?projectId=${projectId}`}>
                Send a contract
              </Link>
            </Button>
          }
        />
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
                  <Badge
                    variant={
                      c.status === "signed"
                        ? "active"
                        : c.status === "cancelled" || c.status === "expired"
                          ? "danger"
                          : "neutral"
                    }
                    dot
                  >
                    {c.status}
                  </Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Invoices section ────────────────────────────────────────────────
// Lifted verbatim from project-view.tsx's old InvoicesTab. For MVP this
// is still a "coming next phase" placeholder — no tRPC fetch here, so
// the old pattern of "InvoicesTab does its own client-side fetch" did
// not actually exist. If/when invoice ledger rendering lands, this is
// the entry point to wire a `trpc.invoice.listByProject.useQuery` call.
//
// TODO(invoices-list): replace with real ledger once invoice.listByProject
// ships. Until then, the Overview pay-flags on the Project header + the
// Stripe dashboard remain the source of truth for payment state.
function InvoicesSection() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl tracking-tight" style={{ fontWeight: 700 }}>
          Invoices
        </h2>
        <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
          Ledger of charges tied to this project.
        </p>
      </div>
      <EmptyState
        title="No invoices yet."
        description="Full invoicing is coming soon. For now, mark deposits and final payments on the project header — that's what unlocks downloads for the artist."
      />
    </div>
  );
}
