// Pure helpers for the pipeline Kanban. Kept separate from the client
// component (kanban.tsx) so they're trivially unit-testable without a
// React or JSDOM environment. Consumed by both kanban.tsx (client) and
// page.tsx (server), which is why nothing in here imports React.

export const STAGES = [
  "lead",
  "booked",
  "contract_sent",
  "in_production",
  "final_review",
  "paid",
  "archived",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  lead: "Lead",
  booked: "Booked",
  contract_sent: "Contract sent",
  in_production: "In production",
  final_review: "Final review",
  paid: "Paid",
  archived: "Archived",
};

// Stage-specific call-to-action label rendered at the bottom of each
// deal card. Always links to the deal detail page — the label's only
// job is to hint the next pipeline step.
export const STAGE_CTA: Record<Stage, string> = {
  lead: "Book session",
  booked: "Send contract",
  contract_sent: "Start production",
  in_production: "Share final",
  final_review: "Mark paid",
  paid: "Archive",
  archived: "Reopen",
};

// Droppable IDs are namespaced `stage:<key>` so dnd-kit's `over.id` can
// be parsed unambiguously. Returns null when the id doesn't match (e.g.
// the user dropped onto nothing, or onto a non-column surface).
export function stageFromDroppableId(id: string | number | null | undefined): Stage | null {
  if (typeof id !== "string") return null;
  if (!id.startsWith("stage:")) return null;
  const key = id.slice("stage:".length);
  return (STAGES as readonly string[]).includes(key) ? (key as Stage) : null;
}

export function droppableIdForStage(stage: Stage): string {
  return `stage:${stage}`;
}

// Produces a compact relative-time string suited for deal cards:
// "just now" / "5m" / "3h" / "2d" for recent activity; falls back to
// a short "MMM d" absolute date for anything older than ~6 days so the
// cards don't drift into vague "12w ago" territory.
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  // Future timestamps (clock skew) collapse to "just now" so we never
  // render nonsense like "-3m".
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min.toString()}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr.toString()}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day.toString()}d`;
  // Older: "Apr 15" style. Uses en-US to keep the format stable for
  // tests; the dashboard header already locks English copy anyway.
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
