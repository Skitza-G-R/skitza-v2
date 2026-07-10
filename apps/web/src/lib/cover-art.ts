// Generated cover-art system from the Handoff 4 prototype
// (docs/design/handoff-4/skitza-mobile-data.jsx).
//
// Products, portfolio tracks and producer avatars get a warm oklch
// gradient "record sleeve" until real imagery lands (drop-in image
// slots keyed by the same id — see Handoff.md §5). The store scans
// like a record shelf because neighbouring products land on distinct
// hues: g1=44 amber, g2=30 terracotta, g3=12 red, g4=340 magenta.
//
// Our rows don't carry a hue column, so — same idiom as
// `project-gradient.ts` — we hash the entity id into the hue palette.
// Same id always renders the same sleeve, across surfaces and renders.

export const COVER_HUES = [44, 30, 12, 340] as const;

// Vignette layer adds depth without a fragile SVG-noise data URL.
// Lighter at the top so overlaid light text/status bars stay legible.
const SK_VIGNETTE =
  "radial-gradient(125% 115% at 50% 6%, transparent 42%, rgba(17,16,9,0.30) 100%)";

/** Full-size cover art: vignette over a 3-stop oklch gradient. */
export function skCover(hue: number): string {
  const h = ((hue % 360) + 360) % 360;
  const mid = String((h + 8) % 360);
  const deep = String((h + 24) % 360);
  return `${SK_VIGNETTE}, linear-gradient(168deg, oklch(0.82 0.075 ${String(h)}) 0%, oklch(0.60 0.13 ${mid}) 52%, oklch(0.42 0.135 ${deep}) 100%)`;
}

/** Compact 2-stop gradient for avatars/swatches. */
export function skSwatch(hue: number): string {
  const h = ((hue % 360) + 360) % 360;
  return `linear-gradient(135deg, oklch(0.72 0.13 ${String(h)}) 0%, oklch(0.46 0.14 ${String((h + 30) % 360)}) 100%)`;
}

// Stable string hash → integer. djb2 variant (mirrors project-gradient.ts).
function hashString(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Deterministic hue for an entity id (product, track, producer). */
export function hueForId(id: string): number {
  return COVER_HUES[hashString(id) % COVER_HUES.length] ?? 44;
}

/** Convenience: cover gradient straight from an entity id. */
export function coverForId(id: string): string {
  return skCover(hueForId(id));
}

/** Convenience: avatar swatch straight from an entity id. */
export function swatchForId(id: string): string {
  return skSwatch(hueForId(id));
}
