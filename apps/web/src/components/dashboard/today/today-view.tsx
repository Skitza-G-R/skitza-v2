"use client";

import { KpiStrip } from "./kpi-strip";
import { TodayDetail } from "./today-detail";
import { TodayList, type TodayListItem } from "./today-list";

// Data shape projected down from the Server Component's
// producer.today payload. Dates cross the RSC → client boundary as
// ISO strings (the page serializes them), so the wire shape mirrors
// the router's return with Date → string on occurredAt.
export type TodayViewData = {
  kpis: {
    activeProjects: number;
    revenueMonthCents: number;
    revenueCurrency: string;
    upcomingSessions7d: number;
    unresolvedItems: number;
  };
  items: TodayListItem[];
  savedViews: Array<{ id: string; label: string; filter: Record<string, string> }>;
};

// Orchestrator for the Today screen. Renders the KPI strip above the
// split-inbox (list + detail). The list drives selection via the
// URL — clicking a row sets ?itemId=<id> — and the detail reads back
// from ?itemId to figure out which row to render.
//
// Desktop: 2-column grid, list pinned at max-w-md on the left, detail
// expands to fill the rest. Mobile: the detail pane hides when no
// item is selected (list fills the viewport); tapping a row flips to
// the detail pane (list slides out). This gives us the "split-inbox
// → stack navigation" responsive behavior the spec calls for without
// needing a second route.
export function TodayView({
  data,
  selectedItemId,
}: {
  data: TodayViewData;
  selectedItemId: string | null;
}) {
  const hasSelection = Boolean(selectedItemId);

  return (
    <div className="flex flex-col gap-10">
      <KpiStrip kpis={data.kpis} />

      {/* Batch C — Inbox section gets an editorial eyebrow + heading
          instead of jumping straight into rows. Pairs with the ShareLink
          hero at the top so the page reads: hero → KPIs → Inbox. */}
      <section aria-labelledby="today-inbox-heading">
        <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-[rgb(var(--border-subtle))] pb-3">
          <div>
            <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
              Inbox
            </p>
            <h2
              id="today-inbox-heading"
              className="mt-1 font-display text-2xl tracking-tight text-[rgb(var(--fg-primary))]"
            >
              What needs you today
            </h2>
          </div>
        </div>

        <div className="grid gap-0 md:grid-cols-[minmax(0,_30rem)_minmax(0,_1fr)]">
          {/* List — hidden on mobile while an item is selected so the
              detail can take over the full viewport. */}
          <div className={hasSelection ? "hidden md:block" : "block"}>
            <TodayList items={data.items} selectedItemId={selectedItemId} />
          </div>

          {/* Detail — always rendered on desktop (shows the empty
              prompt when nothing is selected); mobile hides it until
              there's a selection. Left-border hairline separates the
              two panes on desktop only. */}
          <div
            className={[
              hasSelection ? "block" : "hidden md:block",
              "md:border-l md:border-[rgb(var(--border-subtle))]",
            ].join(" ")}
          >
            <TodayDetail items={data.items} selectedItemId={selectedItemId} />
          </div>
        </div>
      </section>
    </div>
  );
}
