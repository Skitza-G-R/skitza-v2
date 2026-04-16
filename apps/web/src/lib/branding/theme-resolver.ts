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

export const defaultBrand = {
  primary: "29 185 84",
  accent: "224 122 95",
} as const;

const HEX6 = /^#([0-9a-f]{6})$/i;

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
}): Record<`--brand-${string}`, string> {
  const primary =
    brand.primary !== undefined ? hexToRgbTriplet(brand.primary) : null;
  const accent =
    brand.accent !== undefined ? hexToRgbTriplet(brand.accent) : null;
  return {
    "--brand-primary": primary ?? defaultBrand.primary,
    "--brand-accent": accent ?? defaultBrand.accent,
  };
}
