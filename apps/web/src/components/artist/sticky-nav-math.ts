// Pure math for the StickyNav collapse (Handoff 4 —
// docs/design/handoff-4/skitza-mobile-ui.jsx). Kept free of React so
// the easing contract is unit-testable.

/** Linear interpolation between a and b. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Collapse progress for a scroll offset: 0 while the header floats
 * transparent over the cover, 1 once the solid cream bar has fully
 * faded in. Smoothstepped so the crossfade has no hard edges.
 */
export function stickyEase(scrolled: number, start = 46, end = 116): number {
  const p = Math.min(1, Math.max(0, (scrolled - start) / (end - start)));
  return p * p * (3 - 2 * p);
}

/** Round-button background: dark glass → light solid as the bar lands. */
export function stickyBtnBackground(ease: number): string {
  const r = Math.round(lerp(20, 255, ease));
  const g = Math.round(lerp(18, 255, ease));
  const b = Math.round(lerp(12, 255, ease));
  const a = Math.round(lerp(0.34, 0.92, ease) * 1000) / 1000;
  return `rgba(${String(r)},${String(g)},${String(b)},${String(a)})`;
}

/** Round-button icon color: white over the cover → warm ink on cream. */
export function stickyIconColor(ease: number): string {
  return `rgb(${String(Math.round(lerp(255, 17, ease)))},${String(Math.round(lerp(255, 16, ease)))},${String(Math.round(lerp(255, 9, ease)))})`;
}
