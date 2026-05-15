// Deterministic name → 1-of-6 gradient token. Same FNV-31 hash style
// as ~/lib/_phase4-stubs/producer-color so a name's gradient stays
// stable across both surfaces.

export const GRADIENT_TOKENS = [
  "grad-rose",
  "grad-amber",
  "grad-slate",
  "grad-emerald",
  "grad-violet",
  "grad-indigo",
] as const;

export type GradientToken = (typeof GRADIENT_TOKENS)[number];

export function deriveGradient(name: string): GradientToken {
  if (!name) return "grad-slate";
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return GRADIENT_TOKENS[Math.abs(h) % GRADIENT_TOKENS.length] ?? "grad-slate";
}
