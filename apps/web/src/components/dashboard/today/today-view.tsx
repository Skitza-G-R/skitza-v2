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
    <div className="flex flex-col gap-6">
      <KpiStrip kpis={data.kpis} />

      <div className="grid gap-4 md:grid-cols-[minmax(0,_28rem)_minmax(0,_1fr)]">
        {/* List — hidden on mobile while an item is selected so the
            detail can take over the full viewport. */}
        <div className={hasSelection ? "hidden md:block" : "block"}>
          <TodayList items={data.items} selectedItemId={selectedItemId} />
        </div>

        {/* Detail — always rendered on desktop (shows the empty
            prompt when nothing is selected); mobile hides it until
            there's a selection. */}
        <div className={hasSelection ? "block" : "hidden md:block"}>
          <TodayDetail items={data.items} selectedItemId={selectedItemId} />
        </div>
      </div>
    </div>
  );
}
