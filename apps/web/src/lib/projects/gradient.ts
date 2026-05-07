// Deterministic per-project hero gradient picker. Maps a project id to
// one of six warm-toned gradient classes defined in globals.css. Used
// by the Project Room hero so each project opens with its own "album
// artwork" color while keeping the producer's roster visually varied.
//
// Determinism matters: the same project must show the same color every
// visit (no jitter on revisit), so we hash the id rather than picking
// at random per render. FNV-1a is a tiny, portable, dependency-free
// 32-bit hash that distributes well across short-string inputs (UUIDs,
// short ids, slug-style ids alike). See gradient.test.ts for the
// distribution + determinism contract.

export const GRADIENT_KEYS = [
  "grad-rose",
  "grad-amber",
  "grad-slate",
  "grad-emerald",
  "grad-violet",
  "grad-indigo",
] as const;

export type GradientKey = (typeof GRADIENT_KEYS)[number];

/**
 * Fowler–Noll–Vo (FNV-1a) 32-bit hash of a string. Pure, deterministic,
 * platform-agnostic. Returned as an unsigned 32-bit number so the
 * caller can `% N` against any positive bucket count without sign-bit
 * surprises on negative results.
 */
function fnv1a32(input: string): number {
  let h = 0x811c9dc5; // 2166136261 — FNV-1a 32-bit offset basis
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // 16777619 — FNV-1a 32-bit prime
  }
  return h >>> 0;
}

/**
 * Pick the hero gradient class for a project. Returns one of the six
 * `grad-*` utility classes defined in globals.css. Stable across
 * renders for the same id; distributed across all six buckets for a
 * varied id pool.
 *
 * Empty / very short ids still return a valid key — the FNV-1a seed
 * dominates so an empty string maps to a fixed bucket rather than
 * crashing.
 */
export function gradientForId(id: string): GradientKey {
  const hash = fnv1a32(id);
  const index = hash % GRADIENT_KEYS.length;
  // `index` is bounded to [0, GRADIENT_KEYS.length) by the modulo and
  // GRADIENT_KEYS is a non-empty const tuple, so the lookup is always
  // defined. We use `as` rather than the non-null `!` to satisfy the
  // project's no-non-null-assertion lint rule.
  return GRADIENT_KEYS[index] as GradientKey;
}
