/** Stable same-origin read path. Authorization is rechecked on every request. */
export function privateSongArtworkPath(trackId: string, revision?: string): string {
  const path = `/api/song-artwork/${encodeURIComponent(trackId)}`;
  if (!revision) return path;
  return `${path}?v=${encodeURIComponent(revision)}`;
}
