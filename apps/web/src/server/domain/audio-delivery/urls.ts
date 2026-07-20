function sameOriginPath(prefix: string, id: string): string {
  return `${prefix}/${encodeURIComponent(id)}`;
}

/** Stable, same-origin playback URL for one private stored song version. */
export function privateVersionStreamPath(versionId: string): string {
  return sameOriginPath("/api/audio/stream", versionId);
}

/** Stable, same-origin playback URL for one explicitly public portfolio row. */
export function publicPortfolioStreamPath(portfolioTrackId: string): string {
  return sameOriginPath("/api/audio/public/portfolio", portfolioTrackId);
}

const PROTECTED_AUDIO_PATH =
  /^\/api\/audio\/(?:stream\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|public\/portfolio\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Allow only exact protected routes into browser-facing audio read models. */
export function browserSafeStoredAudioUrl(value: string | null): string | null {
  return value !== null && PROTECTED_AUDIO_PATH.test(value) ? value : null;
}
