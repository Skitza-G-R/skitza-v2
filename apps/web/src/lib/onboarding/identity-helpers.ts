/**
 * Pure helpers for Step 1 of the producer onboarding wizard
 * (Identity / "Your hall" — name + monogram + tagline).
 *
 * The slug field shown in the redesign HTML is intentionally NOT
 * implemented here — slug stays server-derived + hidden per Decision
 * #1 (memory: project_onboarding_redesign_shell.md). The producer
 * never sees or chooses their slug.
 *
 * Tested in identity-helpers.test.ts.
 */

/**
 * The 6 monogram swatches shown in the Identity step's color picker.
 * These are CSS class names declared in apps/web/src/app/globals.css
 * (search "Project gradient swatches"). Persisted on
 * `producers.monogram_color` once migration 0007 lands.
 */
export const MONOGRAM_GRADIENTS = [
  "grad-amber",
  "grad-rose",
  "grad-emerald",
  "grad-violet",
  "grad-indigo",
  "grad-slate",
] as const;

export type MonogramGradient = (typeof MONOGRAM_GRADIENTS)[number];

export function isMonogramGradient(value: unknown): value is MonogramGradient {
  return (
    typeof value === "string" &&
    (MONOGRAM_GRADIENTS as readonly string[]).includes(value)
  );
}

/**
 * Tagline maximum length. Matches the redesign's char counter (80) and
 * the application-level cap that gates writes to the (future)
 * `producers.tagline` column added by migration 0007.
 */
export const TAGLINE_MAX_LENGTH = 80;

export function taglineWithinLimit(
  tagline: string | null | undefined,
): boolean {
  if (tagline == null) return true;
  return tagline.length <= TAGLINE_MAX_LENGTH;
}

/**
 * Renders the 1-2 character monogram displayed in the live preview
 * tile. Takes the first letter of the first two whitespace-separated
 * words of the producer's display name. Uppercases the result.
 *
 * Matches the redesign's Identity component (search `function Identity`
 * in design_handoff_producer_onboarding/Producer Onboarding -
 * Reference.html) and the placeholder behavior shown when the name
 * field is empty (returns "YS" for "Your Studio").
 */
export function initialsFromName(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (words.length === 0) return "YS";
  return words.map((w) => w[0]?.toUpperCase() ?? "").join("");
}
