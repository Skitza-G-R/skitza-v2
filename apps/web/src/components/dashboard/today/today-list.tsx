"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

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
      <div className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
          Inbox
        </p>
        <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
          Nothing needs you right now. A clean slate.
        </p>
      </div>
    );
  }

  return (
    <ul
      role="list"
      aria-label="Today's inbox"
      className="divide-y divide-[rgb(var(--border-subtle))] overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
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
              className={[
                "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                isSelected
                  ? "bg-[rgb(var(--brand-primary)/0.08)]"
                  : "hover:bg-[rgb(var(--bg-sunken))]",
              ].join(" ")}
            >
              <KindIcon kind={item.kind} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-medium text-[rgb(var(--fg-primary))]">
                    {item.title}
                  </p>
                  <p className="sk-num shrink-0 font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
                    {formatRelativeTime(new Date(item.occurredAtIso))}
                  </p>
                </div>
                <p className="mt-0.5 truncate text-xs text-[rgb(var(--fg-secondary))]">
                  {item.subtitle}
                </p>
              </div>
              {item.unread ? (
                <span
                  aria-label="unread"
                  className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--brand-primary))]"
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

// Compact relative-time string. Future dates get an "in …" prefix so
// an upcoming session reads as "in 1h" rather than "1h ago".
function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = date.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  const sec = Math.floor(absMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${diffMs >= 0 ? "in " : ""}${min.toString()}m${diffMs >= 0 ? "" : " ago"}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${diffMs >= 0 ? "in " : ""}${hr.toString()}h${diffMs >= 0 ? "" : " ago"}`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${diffMs >= 0 ? "in " : ""}${day.toString()}d${diffMs >= 0 ? "" : " ago"}`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
