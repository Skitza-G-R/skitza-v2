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
// stylesheet class (e.g. in dynamic style props, or for the song-page
// hero where the original CSS class isn't present in scope).
export const GRADIENT_CSS: Record<GradientClass, string> = {
  "grad-rose": "linear-gradient(135deg, #fb7185, #ef4444)",
  "grad-amber": "linear-gradient(135deg, #fcd34d, #fb923c)",
  "grad-slate": "linear-gradient(135deg, #cbd5e1, #94a3b8)",
  "grad-emerald": "linear-gradient(135deg, #6ee7b7, #10b981)",
  "grad-violet": "linear-gradient(135deg, #c4b5fd, #8b5cf6)",
  "grad-indigo": "linear-gradient(135deg, #a5b4fc, #6366f1)",
};

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
