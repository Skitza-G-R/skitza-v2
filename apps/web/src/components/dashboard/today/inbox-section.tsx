"use client";

import { TodayDetail } from "./today-detail";
import { TodayList, type TodayListItem } from "./today-list";

// InboxSection — the split inbox surface (list left, detail right on
// desktop; stack-nav on mobile). Story 06 of the today-redesign epic.
//
// Extracted from the now-deleted today-view.tsx. The orchestrator
// previously rendered a KPI strip above this section; the redesign
// folded those metrics into the PulseCard, so InboxSection is just
// the inbox layout — no chrome above it.
//
// Selection model:
//   - URL drives selection via ?itemId=<id>. The list emits a
//     router.replace on row click; the detail reads the same URL via
//     useSearchParams. No prop drilling of "selected" state.
//   - On mobile, the list disappears once an item is selected so the
//     detail can take over the full viewport. Tapping "Close" on the
//     detail clears the URL param and brings the list back.
//
// Empty state: TodayList itself renders a TodayListEmpty tile when
// items.length === 0 (the populated TodayDetail prompt sits next to
// it on desktop). That empty surface lives at this layer, not the
// page level — the day-1 empty-state onboarding card on page.tsx
// short-circuits this whole section, so we never render a "0 items
// here" inbox alongside the onboarding nudge.

export type { TodayListItem };

interface InboxSectionProps {
  items: TodayListItem[];
  selectedItemId: string | null;
}

export function InboxSection({ items, selectedItemId }: InboxSectionProps) {
  const hasSelection = Boolean(selectedItemId);

  return (
    // Batch C heritage — editorial eyebrow + heading above the split
    // pane. The eyebrow's mono small-caps treatment matches the rest
    // of the Today surface (RecentUploadsShelf, PulseCard) so the
    // page reads as one composed surface.
    <section
      aria-labelledby="today-inbox-heading"
      data-tour-id="today-inbox"
      className="mb-10"
    >
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
          <TodayList items={items} selectedItemId={selectedItemId} />
        </div>

        {/* Detail — always rendered on desktop (shows the empty
            prompt when nothing is selected); mobile hides it until
            there's a selection. Logical-start-border hairline
            separates the two panes on desktop only; `border-s`
            renders as border-left under LTR and border-right under
            RTL, keeping the divider between the list and detail
            panes regardless of text direction. */}
        <div
          className={[
            hasSelection ? "block" : "hidden md:block",
            "md:border-s md:border-[rgb(var(--border-subtle))]",
          ].join(" ")}
        >
          <TodayDetail items={items} selectedItemId={selectedItemId} />
        </div>
      </div>
    </section>
  );
}
