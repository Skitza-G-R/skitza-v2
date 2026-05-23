// SK-25: this file used to render the standalone meta strip section
// under the hero. The strip was removed when /join/<slug> compacted
// to a single-viewport bento — its content now lives as inline chips
// at the bottom of the identity column inside <JoinBento>.
//
// The two formatter helpers stayed because they encode presentation
// rules the producer's raw fields don't (title-casing genre tags,
// translating raw hour counts into "Within 24h" copy). Kept here as
// the canonical formatting boundary so the bento consumes friendly
// strings rather than raw DB values.

/**
 * Format a producer-supplied genres array into the "Indie · Alt-Pop"
 * dot-separated style. Title-cases each tag so a producer can save
 * lowercase tags ("indie", "alt-pop") and still get presentation-grade
 * casing. Returns null for null/empty so the caller hides the chip.
 */
export function formatGenres(genres: string[] | null | undefined): string | null {
  if (!genres || genres.length === 0) return null;
  const cleaned = genres
    .map((g) => g.trim())
    .filter((g) => g.length > 0)
    .map((g) =>
      g
        .split(/[\s-]+/)
        .map((part) => {
          const head = part.charAt(0);
          if (head.length === 0) return part;
          return `${head.toUpperCase()}${part.slice(1).toLowerCase()}`;
        })
        .join("-"),
    );
  if (cleaned.length === 0) return null;
  return cleaned.join(" · ");
}

/**
 * Translate hours-of-response into the dropdown phrasing the producer
 * picked in Settings. 24/48/168 are the only valid values; anything
 * outside that range renders as "Within Nh" so a direct DB edit
 * doesn't blank out the chip.
 */
export function formatResponseHours(
  hours: number | null | undefined,
): string | null {
  if (hours === null || hours === undefined) return null;
  if (hours <= 0) return null;
  if (hours === 24) return "Within 24h";
  if (hours === 48) return "Within 48h";
  if (hours === 168) return "Within 1 week";
  return `Within ${String(hours)}h`;
}
