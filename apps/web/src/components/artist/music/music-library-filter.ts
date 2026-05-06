// Pure filter predicate extracted from MusicLibraryClient so it's
// testable without spinning up a React renderer (the repo doesn't
// pull in @testing-library/react). The component imports this and
// applies the predicate inside its `useMemo`.

export type MusicProjectRow = {
  projectId: string;
  title: string;
  producerId: string;
  producerName: string;
  producerSlug: string;
  latestTrackTitle: string | null;
  latestTrackUploadedAt: Date | null;
  trackCount: number;
};

export type Filter = "all" | "recent" | "with_tracks";

export function matchesMusicFilter(
  p: MusicProjectRow,
  producerFilter: string,
  filter: Filter,
  now: Date,
): boolean {
  if (producerFilter !== "all" && p.producerId !== producerFilter) {
    return false;
  }
  if (filter === "with_tracks" && p.trackCount === 0) {
    return false;
  }
  if (filter === "recent") {
    if (!p.latestTrackUploadedAt) return false;
    const ageMs = now.getTime() - p.latestTrackUploadedAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > 14) return false;
  }
  return true;
}
