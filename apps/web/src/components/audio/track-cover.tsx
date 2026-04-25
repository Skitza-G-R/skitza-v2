// Deterministic gradient cover used wherever we need a default
// album-art surface without an R2 round-trip — primarily the
// RecentUploadsShelf on the redesigned Today dashboard (Story 3 of
// the today-redesign epic), but reusable anywhere a track lacks
// uploaded artwork.
//
// Why deterministic? A producer who saw a copper-rust gradient on
// "Sunset Mix v3" yesterday must still see it today, even after
// page reloads + cache clears. Determinism is the contract: same
// trackId → same gradient angle + colors, every render. No
// randomness, no Date.now, no per-mount drift.
//
// How it works:
//   1. `hashStr(trackId)` → cheap 32-bit polynomial hash (×31, like
//      Java's String.hashCode). Coerce to non-negative.
//   2. `pickGradient` → pick (a) a [start, end] color pair from a
//      curated 12-entry palette via `hash % 12`, (b) a rotation
//      angle in [0, 360) via `hash % 360`.
//   3. Render a CSS linear-gradient. No <img>, no network, no
//      hydration mismatch (the math is portable across client +
//      server).
//
// No "use client" directive — the component is pure render, no hooks,
// no browser APIs. This means server components can render it
// directly without sending JS to the client.

// 12 curated color pairs. Each pair is [bright start, deeper end] so
// the gradient feels like a plausible album cover at any rotation
// angle. Hex codes are intentional here — TrackCover is a self-
// contained "image generator" producing inline `style.background`
// strings, not theme-aware UI surface. CSS variables wouldn't help
// (the colors must be specific, not theme-driven), and the
// component never reads or writes a theme token.
export const TRACK_COVER_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ["#E8845C", "#A14E3A"], // copper → rust
  ["#5C8FE8", "#3A4FA1"], // sky → indigo
  ["#5CE89A", "#3AA17F"], // mint → forest
  ["#E85CD9", "#A13A8E"], // pink → magenta
  ["#E8C95C", "#A18E3A"], // gold → ochre
  ["#5CE8E0", "#3AA199"], // cyan → teal
  ["#B25CE8", "#7A3AA1"], // violet → purple
  ["#E85C5C", "#A13A3A"], // red → crimson
  ["#5CE85C", "#3AA13A"], // lime → emerald
  ["#5C73E8", "#3A4DA1"], // royal → cobalt
  ["#E8A35C", "#A1773A"], // amber → bronze
  ["#8AE85C", "#67A13A"], // chartreuse → moss
] as const;

// Cheap deterministic 32-bit hash. The `| 0` after each step coerces
// to a signed 32-bit integer (V8's well-known fast path). We then
// take the absolute value so the modulo math always yields a
// non-negative palette index + angle.
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

interface Gradient {
  colors: readonly [string, string];
  angle: number;
}

// Fallback for the `palette[h % palette.length]` lookup. The palette
// is non-empty by construction (12 entries) so the modulo is always
// in range — but TS narrows the access to `pair | undefined`. We pick
// index 0 as the runtime-impossible fallback; eslint flags non-null
// assertions, so we pull the fallback into a const that `??` can read.
const PALETTE_FALLBACK: readonly [string, string] = TRACK_COVER_PALETTE[0] ?? [
  "#000000",
  "#000000",
];

function pickGradient(trackId: string): Gradient {
  const h = hashStr(trackId);
  const colors =
    TRACK_COVER_PALETTE[h % TRACK_COVER_PALETTE.length] ?? PALETTE_FALLBACK;
  const angle = h % 360;
  return { colors, angle };
}

// Render a Gradient as a CSS linear-gradient string. Split out from
// the component so the test suite can pin the exact format without
// poking at React internals.
function toCss(g: Gradient): string {
  return `linear-gradient(${String(g.angle)}deg, ${g.colors[0]}, ${g.colors[1]})`;
}

// Test surface. Exported under __TEST_ONLY__ so the public API stays
// minimal — consumers should reach for <TrackCover /> + the palette
// constant; tests poke at the math directly.
export const __TEST_ONLY__ = {
  hashStr,
  pickGradient,
  toCss,
};

interface TrackCoverProps {
  trackId: string;
  size?: number;
  className?: string;
}

export function TrackCover({
  trackId,
  size = 144,
  className = "",
}: TrackCoverProps) {
  const gradient = pickGradient(trackId);
  return (
    <div
      role="img"
      aria-hidden
      className={`relative shrink-0 rounded-[var(--radius-md)] ${className}`}
      style={{
        width: size,
        height: size,
        background: toCss(gradient),
      }}
    />
  );
}
