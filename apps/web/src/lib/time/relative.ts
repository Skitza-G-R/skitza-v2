// Returns a compact relative-time string. Handles both past ("3d ago")
// and future ("in 3d") timestamps. Thresholds are chosen to read
// naturally in dashboard contexts (where seconds/minutes of jitter
// don't matter). When a date is missing, returns "—".
//
// Merged from the near-identical helpers that were previously
// duplicated in projects-list.tsx (past-only) and today-list.tsx
// (bidirectional). The bidirectional version is the superset so that
// the Today inbox can render upcoming sessions as "in 3h" while the
// Projects list keeps reading "3d ago" for past updated-at stamps.
export function formatRelativeTime(
  date: Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!date) return "—";
  const diffMs = date.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  const sec = Math.floor(absMs / 1000);
  if (sec < 60) return "just now";
  const future = diffMs > 0;
  const min = Math.floor(sec / 60);
  if (min < 60) return future ? `in ${min.toString()}m` : `${min.toString()}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return future ? `in ${hr.toString()}h` : `${hr.toString()}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return future ? `in ${day.toString()}d` : `${day.toString()}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Absolute date-time formatter used throughout the Project Room sub-tabs
// (Music comments, Sessions booking card, Money contract list, Notes
// timeline + overview). Uses the user's locale with medium-date +
// short-time styles — e.g. "Apr 19, 2026, 14:32" in en-US with 24h, or
// "19 Apr 2026, 14:32" in en-GB. Accepts a Date or anything new Date()
// can coerce (e.g. an ISO string from a server response).
//
// Previously duplicated across four files; Task 9 consolidated them
// here when project-view.tsx was retired.
export function fmtDateTime(d: Date): string {
  return new Date(d).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
