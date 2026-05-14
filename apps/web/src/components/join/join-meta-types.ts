// Shared shape for the public meta-strip on /join/<slug>. Lives in a
// plain `.ts` (no "use client") so server components, client components,
// and tests can all import it without crossing the use-client boundary.
//
// Producer authors these fields in Settings → Profile; they're surfaced
// by `publicProfile.forJoin` and rendered by `<JoinMetaStrip>`.

export interface JoinMeta {
  /** Genre tags. Null/empty hides the "Genres" stat block. */
  genres: string[] | null;
  /** Short freeform string ("Multiple records"). Null hides the block. */
  releasedSummary: string | null;
  /** Short freeform string ("On Spotify, Apple, YouTube"). Null hides. */
  streamsSummary: string | null;
  /** Hours of typical response. 24/48/168 → friendly text; null hides. */
  responseHours: number | null;
}
