// Pure data-mapping helpers for the design-test surface. Shapes real
// Skitza data (Clerk profile, project_stage enum, recentUpload rows)
// into the structure the mockup's OverviewTab + Sidebar consume.
//
// All functions are pure and unit-tested in
// __tests__/data-mapping.test.ts. No React imports here so the file
// can ship in both server and client bundles.

export type MockupTagType =
  | "danger"
  | "warning"
  | "neutral"
  | "success"
  | "brand";

// Maps the project_stage enum (packages/db/src/schema.ts) to the
// mockup's pill { label, type } pair. Only `payment_paused` and
// `cancelled` map to danger; `final_review` and `contract_sent` map to
// warning. The Overview's "Urgent" filter selects on type ∈ {danger,
// warning} so this mapping decides what counts as urgent.
export function tagForStage(stage: string): {
  label: string;
  type: MockupTagType;
} {
  switch (stage) {
    case "payment_paused":
      return { label: "PAYMENT PAUSED", type: "danger" };
    case "cancelled":
      return { label: "CANCELLED", type: "danger" };
    case "final_review":
      return { label: "ACTION NEEDED", type: "warning" };
    case "contract_sent":
      return { label: "AWAITING SIGN", type: "warning" };
    case "in_production":
      return { label: "IN PROGRESS", type: "neutral" };
    case "booked":
      return { label: "BOOKED", type: "brand" };
    case "lead":
      return { label: "LEAD", type: "neutral" };
    case "paid":
      return { label: "PAID", type: "success" };
    case "archived":
      return { label: "COMPLETE", type: "success" };
    default:
      return { label: stage.toUpperCase(), type: "neutral" };
  }
}

// `in_production` → "In Production". Used as the secondary status line
// under each project's name in the urgent list.
export function humanStage(stage: string): string {
  return stage
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Stage → 0-100 progress %, used by the Project Room (later round) for
// the progress bar. Order is monotonic through the funnel so the bar
// actually advances as a project moves stages. `payment_paused` and
// `cancelled` aren't on the funnel — they sit at "around 50/30" so a
// progress bar still renders a sensible thumb position.
export function progressForStage(stage: string): number {
  switch (stage) {
    case "lead":
      return 5;
    case "booked":
      return 15;
    case "contract_sent":
      return 25;
    case "in_production":
      return 60;
    case "final_review":
      return 90;
    case "paid":
    case "archived":
      return 100;
    case "payment_paused":
      return 50;
    case "cancelled":
      return 30;
    default:
      return 50;
  }
}

// Round-robin grad classes for project badges. Mirrors the SAMPLE_DATA
// fixture's palette. 7 entries — sized so the first 3 entries on the
// Urgent card are always distinct colors. Wraps cleanly for longer
// project lists.
const GRAD_PALETTE = [
  "grad-rose",
  "grad-amber",
  "grad-slate",
  "grad-violet",
  "grad-indigo",
  "grad-emerald",
  "grad-sky",
] as const;

export function gradFor(idx: number): string {
  return GRAD_PALETTE[idx % GRAD_PALETTE.length] ?? "grad-amber";
}

// Greeting first-name. Falls back to "there" so the H1 reads "Good
// morning, there." rather than "Good morning, ." for users without a
// displayName yet (rare — Clerk usually has at least an email-derived
// first name by the time the dashboard renders).
export function firstNameOf(displayName: string | null): string {
  if (!displayName) return "there";
  const trimmed = displayName.trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

// 2-char avatar initials. "Gili Asraf" → "GA"; "Skitza" → "SK".
// Unicode-friendly: works for non-Latin scripts (Hebrew, etc.) by
// just slicing — uppercase is a no-op on scripts without case.
export function initialsOf(displayName: string | null): string {
  if (!displayName) return "GS";
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "GS";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Splits a full public link URL into the dim prefix + amber slug pair
// the mockup renders on the LinkBlock card. Mockup line 1342-1349:
//   <span style={{ color: 'rgba(255,255,255,0.32)' }}>skitza.app/p/</span>
//   <span style={{ color: '#fff' }}>gili</span>
export function splitPublicLink(fullUrl: string): {
  prefix: string;
  slug: string;
} {
  const stripped = fullUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const idx = stripped.lastIndexOf("/");
  if (idx === -1) return { prefix: "", slug: stripped };
  return {
    prefix: stripped.slice(0, idx + 1),
    slug: stripped.slice(idx + 1),
  };
}

// Past Date → human-friendly relative label. Matches the mockup's
// `t.uploaded` strings ("2h ago", "Yesterday", "4d ago"). Granularity
// drops as we go further back so the labels stay short.
export function relTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const min = Math.floor(diffMs / 60_000);
  const hr = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${String(min)}m ago`;
  if (hr < 24) return `${String(hr)}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${String(days)}d ago`;
  if (days < 30) return `${String(Math.floor(days / 7))}w ago`;
  return `${String(Math.floor(days / 30))}mo ago`;
}

// Milliseconds → MM:SS. Matches mockup's tabular-nums display in the
// Recent Uploads duration column. Returns "--:--" for null/0/negative
// so unknown durations render as a placeholder rather than "00:00".
export function fmtDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "--:--";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
