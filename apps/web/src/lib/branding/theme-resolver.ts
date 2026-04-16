/**
 * Theme resolver — maps a producer's brand input to inline CSS variables that
 * override the workspace-root tokens defined in apps/web/src/app/globals.css.
 *
 * Returned as inline style props (not a class or selector) so per-producer
 * overrides outrank [data-theme="room-paper"] (specificity 0,1,0). Inline
 * styles win at the workspace root regardless of source order.
 *
 * Token format mirrors globals.css: a space-separated RGB triplet
 * ("R G B", no rgb() wrapper) so Tailwind's rgb(var(--brand-primary) / 0.9)
 * alpha-channel idiom keeps working downstream.
 */

import type { CSSProperties } from "react";

export const defaultBrand = {
  primary: "29 185 84",
  accent: "224 122 95",
} as const;

/**
 * Brand input is producer-controlled (sourced from the DB in Task 7+). The
 * HEX6 regex IS the injection sanitizer: any input that fails it falls back
 * to `defaultBrand`, never reaching the inline style. Broadening this regex
 * without re-validating the output (e.g. allowing `rgb(...)` strings) would
 * open a CSS-injection vector — every consumer pipes the result straight
 * into a `style` prop.
 */
const HEX6 = /^#([0-9a-f]{6})$/i;

/**
 * Brand-aware style object. Intersects React's `CSSProperties` with the
 * template-literal-keyed brand contract so consumers can spread it directly
 * into `<div style={...}>` (and merge with other style fields) without casts.
 */
export type BrandStyle = CSSProperties & Record<`--brand-${string}`, string>;

function hexToRgbTriplet(hex: string): string | null {
  const match = HEX6.exec(hex);
  if (match === null) return null;
  const digits = match[1];
  if (digits === undefined) return null;
  const r = parseInt(digits.slice(0, 2), 16);
  const g = parseInt(digits.slice(2, 4), 16);
  const b = parseInt(digits.slice(4, 6), 16);
  return `${r.toString()} ${g.toString()} ${b.toString()}`;
}

export function resolveBrandStyle(brand: {
  primary?: string;
  accent?: string;
}): BrandStyle {
  const primary =
    brand.primary !== undefined ? hexToRgbTriplet(brand.primary) : null;
  const accent =
    brand.accent !== undefined ? hexToRgbTriplet(brand.accent) : null;
  return {
    "--brand-primary": primary ?? defaultBrand.primary,
    "--brand-accent": accent ?? defaultBrand.accent,
  };
}
