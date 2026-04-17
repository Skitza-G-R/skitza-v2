import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { AppShell } from "~/components/shell/app-shell";
import { Button } from "~/components/ui/button";
import { appRouter } from "~/server/trpc/routers/_app";

import { Kanban, type KanbanDeal } from "./kanban";
import { STAGES, type Stage } from "./kanban-helpers";

// Phase C.4: the producer's default view is now the pipeline Kanban.
// The previous overview (recent opens / stats / action cards) will be
// reworked in Phase D when the "software feel" pass adds a proper
// sidebar layout; for now we replace it wholesale.
export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const grouped = await caller.deal.listByStage();

  // Project the tRPC response onto the narrower KanbanDeal shape. Two
  // reasons to do this server-side: (1) keep the client bundle free of
  // db-layer types, (2) stability — the client only cares about the
  // six fields below, and insulating it from schema churn is cheap.
  const initial = STAGES.reduce<Record<Stage, KanbanDeal[]>>(
    (acc, stage) => {
      acc[stage] = grouped[stage].map((d) => ({
        id: d.id,
        title: d.title,
        stage: d.stage,
        artistName: d.artistName,
        clientName: d.clientName,
        updatedAt: d.updatedAt,
      }));
      return acc;
    },
    {
      lead: [],
      booked: [],
      contract_sent: [],
      in_production: [],
      final_review: [],
      paid: [],
      archived: [],
    },
  );

  const total = STAGES.reduce((acc, s) => acc + initial[s].length, 0);

  return (
    <AppShell active="pipeline">
      <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 sm:py-10">
        <header className="reveal-up flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
              Pipeline
            </p>
            <h1
              className="mt-2 font-display text-3xl leading-tight tracking-tight sm:text-4xl"
              style={{ fontVariationSettings: '"opsz" 96' }}
            >
              {total === 0
                ? "Your deals, start to finish."
                : `${total.toString()} ${total === 1 ? "deal" : "deals"} in flight.`}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-[rgb(var(--fg-secondary))]">
              Drag a card across columns to move the deal through its stage. Each card
              drills into its own room — tracks, versions, feedback, contract, invoices.
            </p>
          </div>
          <Link href="/dashboard/deals/new">
            <Button>+ New deal</Button>
          </Link>
        </header>

        <section className="mt-8 reveal-up-delay-1">
          <Kanban initial={initial} />
        </section>
      </div>
    </AppShell>
  );
}
