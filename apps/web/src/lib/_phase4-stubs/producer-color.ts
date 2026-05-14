// TEMPORARY — Phase 4 stub for the producer-color helpers shipping in
// Phase 5 PR #59 (`apps/web/src/lib/artist/producer-color.ts`).
//
// Phase 5 ships first via PR #59, then Phase 4's main PR rebases on
// top of v3-clean once #59 lands. Until that happens, Phase 4 pages
// need the same `producerHue` / `producerInitials` /
// `producerGradient` helpers to render gradient client avatars on
// the producer dashboard. Building duplicate copies in `~/lib/color`
// would conflict with Phase 5; importing from `~/lib/artist/producer-
// color` directly would fail to compile until Phase 5 merges.
//
// Resolution: keep Phase 4's import line stable (`from "~/lib/_phase4-
// stubs/producer-color"`) for the duration of the parallel work, then
// after Phase 5 lands run a mechanical migration:
//
//   1. Delete this folder (`apps/web/src/lib/_phase4-stubs/`).
//   2. Sed-replace `~/lib/_phase4-stubs/producer-color` →
//      `~/lib/artist/producer-color` across the Phase 4 page files.
//   3. Verify gates green; commit as part of the Phase 4 PR.
//
// The exports below are byte-equivalent to Phase 5's — same hash,
// same gradient formula, same initials extraction. Any drift would
// produce visually-different avatars between producer + artist
// surfaces, so any change here MUST also land in Phase 5.

/** Deterministic 0-360 hue derived from a name string (FNV-31-ish). */
export function producerHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

/** 1-2 letter monogram for a name string. Defaults to "??" on empty. */
export function producerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  const firstChar = parts[0]?.[0];
  if (parts.length === 1) {
    return (parts[0] ?? "").slice(0, 2).toUpperCase();
  }
  const secondChar = parts[1]?.[0];
  return `${firstChar ?? ""}${secondChar ?? ""}`.toUpperCase();
}

/** OKLCH gradient string for `style.background`. 30deg hue rotation. */
export function producerGradient(name: string): string {
  const hue = producerHue(name);
  const second = (hue + 30) % 360;
  return `linear-gradient(135deg, oklch(0.72 0.13 ${String(hue)}), oklch(0.45 0.14 ${String(second)}))`;
}
