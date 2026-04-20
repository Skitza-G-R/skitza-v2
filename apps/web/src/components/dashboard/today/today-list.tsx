"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  BulkActionBar,
  useBulkSelection,
  useEscClearsSelection,
} from "~/components/ui/bulk-action-bar";
import {
  ListSearchInput,
  listSearchMatches,
  useListSearch,
} from "~/components/ui/list-search";
import { useToast } from "~/components/ui/toast";
import { formatRelativeTime } from "~/lib/time/relative";

// Row shape matches the `producer.today` items payload projected down
// to the wire (dates cross the boundary as ISO strings, so we take
// string here and re-parse the timestamp for display).
export type TodayListItem = {
  id: string;
  kind: "session" | "comment" | "invoice" | "lead";
  title: string;
  subtitle: string;
  occurredAtIso: string;
  href: string;
  unread: boolean;
};

// Renders a flat vertical list of actionable items. Tapping a row
// updates ?itemId=<id> in the URL — we're manipulating search params,
// not navigating, so each row is a button (not a Link). A pending
// transition softens the route-change flash if the detail pane does
// any async work on the next render.
export function TodayList({
  items,
  selectedItemId,
}: {
  items: TodayListItem[];
  selectedItemId: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const { value: q, setValue: setQ, inputRef } = useListSearch();
  const { toast } = useToast();
  const { selection, toggle, setMany, clear } = useBulkSelection();
  // Local "dismissed" set carries a soft-delete: selecting rows +
  // clicking Dismiss removes them from the list without mutating
  // server state. The underlying Today inbox items are derived from
  // four sources (bookings / comments / invoices / leads) with
  // incompatible persistence semantics — mapping a single "archive"
  // back to each would take as much code as the rest of this commit.
  // Clearing this state on refresh is acceptable: the producer wanted
  // them out of sight for this session, not out of the database.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEscClearsSelection(selection.size > 0, clear);

  // Apply dismissed-filter first so the bulk count + selection reflect
  // what the producer sees in the list.
  const visibleItems = useMemo(
    () => items.filter((it) => !dismissedIds.has(it.id)),
    [items, dismissedIds],
  );

  // Filter rows by title / subtitle / kind — the three text fields a
  // producer is likely to remember. We keep filtering client-side
  // because the Today payload is already tiny (a handful of urgent
  // items), so no server round-trip is worth the latency.
  const filteredItems = useMemo(
    () =>
      visibleItems.filter((it) =>
        listSearchMatches(q, [it.title, it.subtitle, it.kind]),
      ),
    [visibleItems, q],
  );

  // Select-all = every currently visible (post-filter) row. Clicking
  // it again when all are selected clears. Matches Gmail's 3-state
  // select-all: unchecked → all-on-page checked → clear.
  const allFilteredSelected =
    filteredItems.length > 0 &&
    filteredItems.every((it) => selection.has(it.id));

  const toggleSelectAll = () => {
    const ids = filteredItems.map((it) => it.id);
    if (allFilteredSelected) {
      setMany(ids, false);
    } else {
      setMany(ids, true);
    }
  };

  const dismissSelected = () => {
    const ids = Array.from(selection);
    setDismissedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    clear();
    toast(`Dismissed ${String(ids.length)} item${ids.length === 1 ? "" : "s"}.`, "success");
  };

  const select = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("itemId", id);
    const query = params.toString();
    startTransition(() => {
      router.replace(`/dashboard${query ? `?${query}` : ""}`, { scroll: false });
    });
  };

  if (visibleItems.length === 0 && items.length === 0) {
    return (
      <TodayListEmpty />
    );
  }

  return (
    // Batch C — shed the card frame. Typography and a single hairline
    // between rows carries the hierarchy; the active item gets a
    // thin brand left-border accent (sk-row-active style) rather than
    // a wash fill.
    <div>
      <div className="mb-3 flex items-center gap-3 pe-2">
        <div className="flex-1">
          <ListSearchInput
            value={q}
            onChange={setQ}
            inputRef={inputRef}
            placeholder="Search inbox"
            ariaLabel="Search today's inbox"
          />
        </div>
        {filteredItems.length > 0 ? (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[rgb(var(--fg-secondary))]">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAll}
              aria-label="Select all inbox items"
              className="h-4 w-4 cursor-pointer rounded border-[rgb(var(--border-subtle))] text-[rgb(var(--brand-primary))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
            />
            <span className="hidden sm:inline">Select all</span>
          </label>
        ) : null}
      </div>
      {filteredItems.length === 0 ? (
        <div
          role="status"
          className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center text-sm text-[rgb(var(--fg-secondary))]"
        >
          No inbox items match “{q}”.
        </div>
      ) : (
    <ul
      role="list"
      aria-label="Today's inbox"
      aria-live="polite"
      className="divide-y divide-[rgb(var(--border-subtle))]"
    >
      {filteredItems.map((item, i) => {
        const isSelected = selectedItemId === item.id;
        const isChecked = selection.has(item.id);
        return (
          <li
            key={item.id}
            className="sk-stagger-item flex items-start"
            style={{ ["--i" as string]: String(i) } as React.CSSProperties}
          >
            <label
              className="flex min-h-[64px] shrink-0 cursor-pointer items-center ps-2 pe-1"
              onClick={(e) => {
                // Prevent the row-navigation click from firing when
                // the producer just wants to tick the checkbox.
                e.stopPropagation();
              }}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => {
                  toggle(item.id);
                }}
                aria-label={`Select ${item.title}`}
                className="h-4 w-4 cursor-pointer rounded border-[rgb(var(--border-subtle))] text-[rgb(var(--brand-primary))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
              />
            </label>
            <button
              type="button"
              aria-current={isSelected ? "true" : undefined}
              onClick={() => {
                select(item.id);
              }}
              disabled={isPending}
              // min-h-[64px] — a nudge taller than before so text
              // breathes like Spotify track rows. Active state uses an
              // inset 2px brand start-border (logical) so the focused
              // item reads without needing a heavy fill, and the bar
              // moves to the correct edge under RTL. `text-start`
              // keeps the multi-line body aligned to the reading edge.
              className={[
                "flex min-h-[64px] flex-1 items-start gap-4 py-4 pe-2 text-start transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]",
                isSelected
                  ? "ps-4 bg-[rgb(var(--brand-primary)/0.06)] rtl:shadow-[inset_-2px_0_0_rgb(var(--brand-primary))] shadow-[inset_2px_0_0_rgb(var(--brand-primary))]"
                  : "ps-2 hover:bg-[rgb(var(--bg-overlay))]",
              ].join(" ")}
            >
              <KindIcon kind={item.kind} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-[0.95rem] font-medium leading-6 text-[rgb(var(--fg-primary))]">
                    {item.title}
                  </p>
                  <p className="sk-num shrink-0 font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
                    {formatRelativeTime(new Date(item.occurredAtIso))}
                  </p>
                </div>
                <p className="mt-1 truncate text-sm leading-5 text-[rgb(var(--fg-secondary))]">
                  {item.subtitle}
                </p>
              </div>
              {item.unread ? (
                <span
                  aria-label="unread"
                  className="mt-2 inline-block h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--brand-primary))]"
                />
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
      )}
      <BulkActionBar
        count={selection.size}
        onDismiss={clear}
        actions={[
          {
            id: "mark-read",
            label: "Mark read",
            tone: "primary",
            onClick: () => {
              // Mark read = flip the local unread indicator off. The
              // Today payload is a derived view; persisting "read"
              // state across sessions would need a new table tied to
              // the compound ids. UI-only keeps the bulk path simple.
              dismissSelected();
            },
          },
          {
            id: "archive",
            label: "Dismiss",
            tone: "destructive",
            onClick: dismissSelected,
          },
        ]}
      />
    </div>
  );
}

// Kind → glyph. Monochrome, 14px, centered so all 4 kinds share the
// same visual weight in the list. Background wash distinguishes at a
// glance — brand primary for sessions (most urgent), muted for leads.
function KindIcon({ kind }: { kind: TodayListItem["kind"] }) {
  const glyph = KIND_GLYPH[kind];
  return (
    <span
      aria-hidden
      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--bg-sunken))] font-mono text-xs text-[rgb(var(--fg-secondary))]"
    >
      {glyph}
    </span>
  );
}

const KIND_GLYPH: Record<TodayListItem["kind"], string> = {
  session: "◉",
  comment: "✦",
  invoice: "$",
  lead: "→",
};

// Empty-state tile for the Today inbox. Extracted as a named function
// so unit tests can render it in isolation. Copy intentionally warm:
// "all caught up" reframes zero-state as an achievement, not a void.
// aria-live="polite" makes the region announce when items arrive.
export function TodayListEmpty() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center"
    >
      <p className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
        Inbox
      </p>
      <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
        All caught up. New sessions, comments, and payments will land here.
      </p>
    </div>
  );
}

