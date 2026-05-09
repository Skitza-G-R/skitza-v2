// Producer Calendar — three-tab nav per the locked design spec
// (Schedule / Sessions / Availability). The Schedule tab is the default
// landing surface ("/dashboard/calendar"); the legacy `?tab=meetings`
// link from the previous design maps onto Schedule so old bookmarks,
// Sentry breadcrumbs, and email links keep working.

export const CALENDAR_TAB_KEYS = [
  "schedule",
  "sessions",
  "availability",
] as const;

export type CalendarTabKey = (typeof CALENDAR_TAB_KEYS)[number];

export function isCalendarTab(v: unknown): v is CalendarTabKey {
  return (
    typeof v === "string" &&
    (CALENDAR_TAB_KEYS as readonly string[]).includes(v)
  );
}

// Next.js App Router delivers `searchParams.tab` as `string | string[] |
// undefined`. Resolver normalises into a guaranteed valid CalendarTabKey
// so page.tsx never has to branch on the raw shape.
export function resolveCalendarTab(
  raw: string | string[] | undefined,
): CalendarTabKey {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first === "meetings") return "schedule";
  return isCalendarTab(first) ? first : "schedule";
}
