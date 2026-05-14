// F4 — pick the initial selected version per track. When an
// `initialVersionId` is provided (deep-link from /dashboard/music's
// ?version= param) and it matches a real version, the parent track
// pre-selects it; every other track falls back to its latest version.
// `versions` is assumed to be pre-sorted newest-first per track, which
// matches the server's `desc(uploadedAt)` ordering — so `find` on
// trackId yields "latest". Stale URLs (version deleted) silently fall
// back to latest, which is the safest UX.
export function pickInitialVersions(
  tracks: { id: string }[],
  versions: { id: string; trackId: string }[],
  initialVersionId?: string,
): Record<string, string | null> {
  const pinned = initialVersionId
    ? versions.find((v) => v.id === initialVersionId)
    : undefined;
  return Object.fromEntries(
    tracks.map((t) => {
      if (pinned && pinned.trackId === t.id) {
        return [t.id, pinned.id];
      }
      const latest = versions.find((v) => v.trackId === t.id);
      return [t.id, latest?.id ?? null];
    }),
  );
}
