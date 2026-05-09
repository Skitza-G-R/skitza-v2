// Week math for the Producer Calendar / Schedule tab.
//
// Centralised here so the schedule grid, today-card, and pending-card
// all derive their week boundaries from a single source of truth.
// Without this, each component re-derives the week from `new Date()`
// and a DST transition or a stale render could put them out of sync.
//
// All operations work in the producer's local timezone — the calendar
// UI is local-time everywhere. Sunday-based week per the design spec.

export function buildWeek(reference: Date, weekOffset = 0): Date[] {
  // Find Sunday at 00:00 local for the reference date, then shift by
  // weekOffset weeks. setDate handles month/year roll-over.
  const sunday = new Date(reference);
  sunday.setDate(reference.getDate() - reference.getDay() + weekOffset * 7);
  sunday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(sunday);
    day.setDate(sunday.getDate() + i);
    return day;
  });
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function todayIndex(week: readonly Date[], now: Date = new Date()): number {
  return week.findIndex((d) => isSameDay(d, now));
}

// Spec § 4.1: range readout, e.g. "May 3 – 9, 2026" or
// "Apr 26 – May 2, 2026" when the week spans a month boundary.
export function weekRangeLabel(week: readonly Date[]): string {
  const first = week[0];
  const last = week[6];
  if (!first || !last) return "";
  const monthFmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short" });
  const sameMonth = first.getMonth() === last.getMonth();
  const left = sameMonth
    ? `${monthFmt(first)} ${String(first.getDate())}`
    : `${monthFmt(first)} ${String(first.getDate())}`;
  const right = sameMonth
    ? `${String(last.getDate())}, ${String(last.getFullYear())}`
    : `${monthFmt(last)} ${String(last.getDate())}, ${String(last.getFullYear())}`;
  return `${left} – ${right}`;
}

// Spec § 3 eyebrow: "WEEK OF MAY 3, 2026". Always derived off the
// Sunday start so navigation arrows update it in one step.
export function weekEyebrow(weekStart: Date): string {
  const month = weekStart
    .toLocaleDateString("en-US", { month: "long" })
    .toUpperCase();
  return `WEEK OF ${month} ${String(weekStart.getDate())}, ${String(weekStart.getFullYear())}`;
}
