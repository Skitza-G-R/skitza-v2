// Deterministic producer color/initials helpers. The locked design
// gives every producer a unique hue gradient + monogram avatar so the
// artist can scan multi-producer surfaces (Music, Store, Activity)
// quickly. The data shape returned by `artist.*` tRPC procedures only
// carries `producerName` strings, so we derive hue + initials client-
// or server-side from the name itself — no schema change needed.
//
// Determinism matters: a producer should look the same colour on the
// home page, the music library, and the song page. The hash is plain
// FNV-1a-ish (multiplicative 31) — fast, stable, no library.

export function producerHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

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

// Gradient string for `style.background`. Mirrors the design source's
// `skGradient` helper from `~/Downloads/skitza (1)/data.artist.jsx`:
//   linear-gradient(135deg, oklch(0.72 0.13 H), oklch(0.45 0.14 H+30))
// — warm-to-deep saturation walk, 30deg hue rotation between stops.
export function producerGradient(name: string): string {
  const hue = producerHue(name);
  const second = (hue + 30) % 360;
  return `linear-gradient(135deg, oklch(0.72 0.13 ${String(hue)}), oklch(0.45 0.14 ${String(second)}))`;
}
