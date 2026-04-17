import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { AppShell } from "~/components/shell/app-shell";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { appRouter } from "~/server/trpc/routers/_app";

// Placeholder list page — C.4 replaces this with a full Kanban board.
// For now we render one section per stage with the deals inside.

const STAGE_ORDER = [
  "lead",
  "booked",
  "contract_sent",
  "in_production",
  "final_review",
  "paid",
  "archived",
] as const;
type Stage = (typeof STAGE_ORDER)[number];

const STAGE_LABEL: Record<Stage, string> = {
  lead: "Lead",
  booked: "Booked",
  contract_sent: "Contract sent",
  in_production: "In production",
  final_review: "Final review",
  paid: "Paid",
  archived: "Archived",
};

export default async function DealsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const grouped = await caller.deal.listByStage();
  const total = STAGE_ORDER.reduce((acc, s) => acc + grouped[s].length, 0);

  return (
    <AppShell active="deals">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="reveal-up flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
              Deals
            </p>
            <h1
              className="mt-2 font-display text-4xl leading-tight tracking-tight sm:text-5xl"
              style={{ fontWeight: 800 }}
            >
              The rooms.
            </h1>
            <p className="mt-3 max-w-xl text-sm text-[rgb(var(--fg-secondary))]">
              One deal per engagement. Tracks + versions + contract + invoices all live
              inside. Kanban view lands in the next phase.
            </p>
          </div>
          <Link href="/dashboard/deals/new">
            <Button>+ New deal</Button>
          </Link>
        </header>

        <section className="mt-10">
          {total === 0 ? (
            <EmptyState
              title="No deals yet."
              description="Create your first deal room — tracks, versions, feedback, contract, invoices all live inside. Share one URL with the artist."
            />
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {STAGE_ORDER.map((stage) => {
                const items = grouped[stage];
                return (
                  <div
                    key={stage}
                    className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                        {STAGE_LABEL[stage]}
                      </p>
                      <Badge>{String(items.length)}</Badge>
                    </div>
                    {items.length === 0 ? (
                      <p className="text-xs text-[rgb(var(--fg-muted))]">—</p>
                    ) : (
                      <ul className="space-y-2">
                        {items.map((d) => (
                          <li key={d.id}>
                            <Link
                              href={`/dashboard/deals/${d.id}`}
                              className="block rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 transition-colors hover:border-[rgb(var(--border-strong))]"
                            >
                              <p className="text-sm font-semibold text-[rgb(var(--fg-primary))]">
                                {d.title}
                              </p>
                              <p className="mt-0.5 font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
                                {d.artistName}
                              </p>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
