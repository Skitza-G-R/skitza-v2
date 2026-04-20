"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

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

  const select = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("itemId", id);
    const query = params.toString();
    startTransition(() => {
      router.replace(`/dashboard${query ? `?${query}` : ""}`, { scroll: false });
    });
  };

  if (items.length === 0) {
    return (
      <TodayListEmpty />
    );
  }

  return (
    // Batch C — shed the card frame. Typography and a single hairline
    // between rows carries the hierarchy; the active item gets a
    // thin brand left-border accent (sk-row-active style) rather than
    // a wash fill.
    <ul
      role="list"
      aria-label="Today's inbox"
      aria-live="polite"
      className="divide-y divide-[rgb(var(--border-subtle))]"
    >
      {items.map((item) => {
        const isSelected = selectedItemId === item.id;
        return (
          <li key={item.id}>
            <button
              type="button"
              aria-current={isSelected ? "true" : undefined}
              onClick={() => {
                select(item.id);
              }}
              disabled={isPending}
              // min-h-[64px] — a nudge taller than before so text
              // breathes like Spotify track rows. Active state uses an
              // inset 2px brand left-border (see sk-row-active) so the
              // focused item reads without needing a heavy fill.
              className={[
                "flex min-h-[64px] w-full items-start gap-4 py-4 pr-2 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]",
                isSelected
                  ? "pl-4 bg-[rgb(var(--brand-primary)/0.06)] shadow-[inset_2px_0_0_rgb(var(--brand-primary))]"
                  : "pl-2 hover:bg-[rgb(var(--bg-overlay))]",
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

