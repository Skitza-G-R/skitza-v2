type ArtistStudioRef = { producerId: string };

/**
 * Resolves URL state against the artist's current studio roster. A stale
 * deep-link cannot keep a removed producer selected; the most recent studio
 * remains the deterministic fallback used by the artist routes.
 */
export function resolveArtistStudioId(
  studios: readonly ArtistStudioRef[],
  requestedStudioId: string | null | undefined,
  savedStudioId?: string | null,
): string | null {
  if (requestedStudioId && studios.some((studio) => studio.producerId === requestedStudioId)) {
    return requestedStudioId;
  }
  if (savedStudioId && studios.some((studio) => studio.producerId === savedStudioId)) {
    return savedStudioId;
  }
  return studios[0]?.producerId ?? null;
}

/**
 * Adds the artist's selected studio to an internal destination while
 * preserving any route-specific query parameters and hash.
 */
export function withArtistStudio(href: string, studioId: string | null | undefined): string {
  if (!studioId) return href;

  const hashIndex = href.indexOf("#");
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const hrefWithoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const queryIndex = hrefWithoutHash.indexOf("?");
  const pathname = queryIndex >= 0 ? hrefWithoutHash.slice(0, queryIndex) : hrefWithoutHash;
  const query = queryIndex >= 0 ? hrefWithoutHash.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(query);
  params.set("studio", studioId);
  return `${pathname}?${params.toString()}${hash}`;
}
