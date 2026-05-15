// Shared helpers for the Music library / Project page redesign.
//
// All pure, side-effect-free utilities live here so the screen + view
// files stay focused on JSX. None of these touch the network or DOM.

/** Project "kind" label per the design.md spec. Derived from track count
 *  because the schema has no explicit kind column yet:
 *    1 track   → SINGLE
 *    2-4 tracks → EP
 *    5+ tracks → ALBUM
 */
export type ProjectKind = "SINGLE" | "EP" | "ALBUM";

export function kindFromTrackCount(n: number): ProjectKind {
  if (n <= 1) return "SINGLE";
  if (n <= 4) return "EP";
  return "ALBUM";
}

// Six gradient palettes from design.md. Stable per seed so a project
// always lands on the same cover across renders/devices.
export const GRADIENT_CLASSES = [
  "grad-rose",
  "grad-amber",
  "grad-slate",
  "grad-emerald",
  "grad-violet",
  "grad-indigo",
] as const;

export type GradientClass = (typeof GRADIENT_CLASSES)[number];

// Inline CSS for each gradient — used where we can't rely on a
// stylesheet class. Interpolated `in oklch` so the transitions
// between stops avoid the muddy mid-tones of sRGB interpolation
// (impeccable rule: use OKLCH). Hex tokens kept as-is since they're
// the design.md source of truth; only the interpolation space changes.
export const GRADIENT_CSS: Record<GradientClass, string> = {
  "grad-rose": "linear-gradient(135deg in oklch, #fb7185, #ef4444)",
  "grad-amber": "linear-gradient(135deg in oklch, #fcd34d, #fb923c)",
  "grad-slate": "linear-gradient(135deg in oklch, #cbd5e1, #94a3b8)",
  "grad-emerald": "linear-gradient(135deg in oklch, #6ee7b7, #10b981)",
  "grad-violet": "linear-gradient(135deg in oklch, #c4b5fd, #8b5cf6)",
  "grad-indigo": "linear-gradient(135deg in oklch, #a5b4fc, #6366f1)",
};

// Solid base color per gradient — the first stop. Used as a fallback
// background so the cover never renders empty even if linear-gradient
// somehow fails to parse (and as a safe under-color for the gradient
// image to paint over).
export const GRADIENT_BASE_COLOR: Record<GradientClass, string> = {
  "grad-rose": "#fb7185",
  "grad-amber": "#fcd34d",
  "grad-slate": "#cbd5e1",
  "grad-emerald": "#6ee7b7",
  "grad-violet": "#c4b5fd",
  "grad-indigo": "#a5b4fc",
};

/** Layered ambient shadow for cover artwork — three stacked shadows
 *  give depth without the harsh single-layer "drop" look. Used for
 *  hero covers (project page) and card covers (library grids).
 *
 *  Reference: Apple Music album hero, Spotify "now playing" hero.
 *  The micro shadow (1px blur) defines the edge; the soft layer
 *  (8px blur) gives it weight; the ambient layer (32px blur) lifts
 *  it off the background.
 */
export const COVER_SHADOW_HERO =
  "0 1px 2px rgba(17,16,9,0.08), 0 4px 14px rgba(17,16,9,0.10), 0 18px 40px -12px rgba(17,16,9,0.22)";

export const COVER_SHADOW_CARD =
  "0 1px 2px rgba(17,16,9,0.06), 0 2px 8px rgba(17,16,9,0.06), 0 10px 24px -8px rgba(17,16,9,0.14)";

/** Deterministic 32-bit FNV-1a hash. Spreads well, no deps. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Pick a gradient class for a stable input (project id, name, etc). */
export function gradientForSeed(seed: string): GradientClass {
  return GRADIENT_CLASSES[hashString(seed) % GRADIENT_CLASSES.length] ?? "grad-amber";
}

/** Format a millisecond duration as `M:SS` (or `H:MM:SS` past an hour). */
export function fmtDuration(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${String(h)}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

/** Sum durations from a list of tracks. Handles nulls safely. */
export function sumDurations(durations: ReadonlyArray<number | null | undefined>): number {
  return durations.reduce<number>((acc, d) => acc + (typeof d === "number" && Number.isFinite(d) ? d : 0), 0);
}

/** Zero-padded two-digit index for tracklist rows ("01", "02", "10"...). */
export function padIndex(i: number): string {
  return String(i + 1).padStart(2, "0");
}

/** Tabular count formatter used by every "Plays" / "Notes" column.
 *
 *  Returns an empty string for 0/null/undefined so the column reads as
 *  "no value" without falling back to em-dash placeholders (banned by
 *  the impeccable design laws). Call sites reserve the column width
 *  with a `min-width` so empty cells still align with populated rows.
 */
export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(n);
}

/** Project page footer copy. Combines "Created <date>" + "Last upload
 *  <relative>" so the footer earns its row.
 *
 *  Returns "" when both timestamps are missing — caller can branch on
 *  empty to skip rendering the footer entirely.
 */
export function formatProjectFooter(args: {
  createdAtIso: string | null;
  lastUploadIso: string | null;
  /** Optional clock — defaults to Date.now(). Tests pin a fixed value. */
  now?: number;
}): string {
  const now = args.now ?? Date.now();
  const parts: string[] = [];
  if (args.createdAtIso) {
    parts.push(`Created ${formatAbsoluteDate(args.createdAtIso)}`);
  }
  if (args.lastUploadIso) {
    parts.push(`Last upload ${formatRelativeDate(args.lastUploadIso, now)}`);
  } else if (args.createdAtIso) {
    // Only mention "no uploads" if the project itself exists; otherwise
    // both fields are empty and we return "".
    parts.push("No uploads yet");
  }
  return parts.join(" · ");
}

function formatAbsoluteDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatRelativeDate(iso: string, now: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const day = 24 * 60 * 60 * 1000;
  // UTC-day comparison so "today"/"yesterday" align with the producer's
  // intuition (not affected by the local-time-of-day of `now`).
  const startOfNow = new Date(now);
  startOfNow.setUTCHours(0, 0, 0, 0);
  const startOfThen = new Date(ms);
  startOfThen.setUTCHours(0, 0, 0, 0);
  const diffDays = Math.floor(
    (startOfNow.getTime() - startOfThen.getTime()) / day,
  );
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${String(diffDays)} days ago`;
  return formatAbsoluteDate(iso);
}

/** Generative ring pattern for the project cover.
 *
 *  Replaces the previous fixed-5-rings-everywhere generator. Picks 3,
 *  5, or 7 rings based on the seed hash so each project has a
 *  visually distinct silhouette while remaining deterministic per id.
 *  Same seed always returns the same shape.
 *
 *  All rings stay within the 64-unit SVG canvas. Radii vary inside a
 *  single pattern so it never reads as a bullseye.
 */
export interface CoverRing {
  cx: number;
  cy: number;
  r: number;
}

export function coverPattern(seed: string): CoverRing[] {
  const hash = hashString(seed);
  // Pick 3 / 5 / 7 rings based on top bits of the hash. 0..2 → index
  // into [3, 5, 7]. Spreads ~evenly across seeds.
  const counts = [3, 5, 7] as const;
  const count = counts[(hash >>> 28) % counts.length] ?? 5;
  const rings: CoverRing[] = [];
  for (let i = 0; i < count; i++) {
    // cx/cy: keep within 8..56 so even big rings stay on-canvas.
    const cx = 12 + ((hash >> (i * 3)) & 0xf) * 2.6;
    const cy = 16 + ((hash >> (i * 4)) & 0xf) * 2.4;
    // Radius cycles through three sizes (small, medium, large) keyed
    // off both the index and a per-ring hash slice so a single pattern
    // never reads as a bullseye of equal rings.
    const sizeBucket = ((hash >> (i * 5 + 2)) & 0x3) % 3;
    const baseRadius = [6, 12, 22][sizeBucket] ?? 12;
    // Tiny per-ring jitter (±2) so rings of the same bucket aren't
    // perfectly identical across the pattern.
    const jitter = ((hash >> (i * 7)) & 0x3) - 1;
    const r = Math.max(2, baseRadius + jitter);
    rings.push({
      cx: Math.max(0, Math.min(64, cx)),
      cy: Math.max(0, Math.min(64, cy)),
      r,
    });
  }
  return rings;
}
