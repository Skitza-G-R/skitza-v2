"use client";

import { useMemo, useState } from "react";

import { useToast } from "~/components/ui/toast";

// Item shape projected down from the server. Dates are strings across
// the Server → Client boundary; the client re-parses them.
export type UpcomingItem = {
  id: string;
  artistName: string;
  artistEmail: string;
  startsAtIso: string;
  durationMin: number;
  packageName: string | null;
};

// Horizontal calendar strip for the next N days. Mobile scrolls with
// snap; desktop grids. Tap a day to expand a list of that day's
// bookings. Empty strip shows a share-your-link CTA.
export function UpcomingStrip({
  items,
  bookingUrl,
  days = 7,
}: {
  items: UpcomingItem[];
  bookingUrl: string | null;
  days?: number;
}) {
  const { toast } = useToast();

  // Group items by producer-local calendar day, using the client's
  // timezone for display. The server sends ISO strings; we derive a
  // YYYY-MM-DD day-key via Intl.DateTimeFormat so DST transitions
  // stay honest.
  const byDay = useMemo(() => {
    const map = new Map<string, UpcomingItem[]>();
    for (const it of items) {
      const d = new Date(it.startsAtIso);
      const key = dayKey(d);
      const list = map.get(key) ?? [];
      list.push(it);
      map.set(key, list);
    }
    return map;
  }, [items]);

  const dayCells = useMemo(() => buildDayCells(days), [days]);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <section className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-5 py-6">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
          Next 7 days
        </p>
        <h2 className="mt-2 font-display text-lg text-[rgb(var(--fg-primary))]">
          No sessions scheduled.
        </h2>
        <p className="mt-1 max-w-md text-sm text-[rgb(var(--fg-secondary))]">
          When clients book, you&apos;ll see a day-by-day strip here. Share your link
          to start filling the week.
        </p>
        {bookingUrl ? (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(bookingUrl).then(() => {
                toast("Link copied", "success");
              });
            }}
            className="mt-4 inline-flex h-9 items-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-medium text-[rgb(var(--fg-inverse))] hover:brightness-110"
          >
            Copy bookable link
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section
      aria-label="Upcoming sessions"
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4"
    >
      <div className="mb-3 flex items-baseline justify-between">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
          Next {String(days)} days
        </p>
        <p className="font-mono text-[0.66rem] tracking-[0.1em] text-[rgb(var(--fg-muted))] sk-num">
          {String(items.length)} confirmed
        </p>
      </div>
      {/* Horizontal scroll on mobile, grid on desktop. snap-x so
          each day snaps into view on a flick gesture. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:overflow-visible sm:px-0">
        <ul
          className="flex gap-2 snap-x snap-mandatory sm:grid sm:grid-cols-7 sm:snap-none"
          role="list"
        >
          {dayCells.map((cell) => {
            const list = byDay.get(cell.key) ?? [];
            const isExpanded = expanded === cell.key;
            const first = list[0];
            return (
              <li key={cell.key} className="shrink-0 snap-start sm:shrink">
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => {
                    setExpanded(isExpanded ? null : cell.key);
                  }}
                  className={[
                    "flex h-[88px] w-[124px] flex-col justify-between rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors",
                    "sm:w-full",
                    isExpanded
                      ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.08)]"
                      : list.length > 0
                        ? "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] hover:border-[rgb(var(--border-strong))]"
                        : "border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] hover:border-[rgb(var(--border-subtle))]",
                  ].join(" ")}
                >
                  <div>
                    <p className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
                      {cell.label}
                    </p>
                    <p
                      className="sk-num font-display text-base leading-none text-[rgb(var(--fg-primary))]"
                      style={{ fontWeight: 700 }}
                    >
                      {cell.dayOfMonth}
                    </p>
                  </div>
                  <div className="text-[11px] leading-tight">
                    {list.length === 0 ? (
                      <span className="text-[rgb(var(--fg-muted))]">—</span>
                    ) : list.length === 1 && first ? (
                      <span className="text-[rgb(var(--fg-secondary))]">
                        <span className="sk-num">{timeFmt(new Date(first.startsAtIso))}</span>
                        <span className="block truncate text-[rgb(var(--fg-primary))]">
                          {first.artistName}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[rgb(var(--fg-secondary))]">
                        <span className="sk-num">{String(list.length)} sessions</span>
                        {list.length > 3 ? (
                          <span className="ml-1 text-[rgb(var(--fg-muted))]">
                            (+{String(list.length - 3)} more)
                          </span>
                        ) : null}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Expanded day detail. Renders below the strip so we never
          re-flow the horizontal list on toggle. */}
      {expanded ? (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-3">
          <p className="mb-2 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            {fullDayLabel(expanded)}
          </p>
          {(byDay.get(expanded) ?? []).length === 0 ? (
            <p className="text-sm text-[rgb(var(--fg-secondary))]">Nothing booked.</p>
          ) : (
            <ul className="space-y-2">
              {(byDay.get(expanded) ?? []).map((b) => (
                <li
                  key={b.id}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <p
                      className="truncate text-[rgb(var(--fg-primary))]"
                      style={{ fontWeight: 600 }}
                    >
                      {b.artistName}
                    </p>
                    <p className="truncate font-mono text-xs text-[rgb(var(--fg-muted))]">
                      {b.packageName ?? "Session"} ·{" "}
                      <span className="sk-num">{String(b.durationMin)}min</span>
                    </p>
                  </div>
                  <p className="sk-num whitespace-nowrap font-mono text-xs text-[rgb(var(--fg-secondary))]">
                    {timeFmt(new Date(b.startsAtIso))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

// YYYY-MM-DD key in the viewer's local timezone. Matches the
// producer's mental calendar because the dashboard is the producer.
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${String(y)}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function timeFmt(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function buildDayCells(
  days: number,
): { key: string; label: string; dayOfMonth: string }[] {
  const out: { key: string; label: string; dayOfMonth: string }[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    const key = dayKey(d);
    const label =
      i === 0
        ? "Today"
        : i === 1
          ? "Tomorrow"
          : d.toLocaleDateString(undefined, { weekday: "short" });
    out.push({
      key,
      label,
      dayOfMonth: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    });
  }
  return out;
}

function fullDayLabel(key: string): string {
  const [y, m, d] = key.split("-").map((n) => Number(n));
  if (!y || !m || !d) return key;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
