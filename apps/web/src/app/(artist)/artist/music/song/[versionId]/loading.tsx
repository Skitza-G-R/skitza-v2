import { Skeleton } from "~/components/ui/skeleton";

// Route-segment loading state for /artist/music/song/[versionId]
// (L3 Song page). Mirrors the shared SongPage's shape: gradient hero
// band with the album-art glyph + title + meta + action rail, then
// the waveform card and a comments thread.
export default function ArtistSongLoading() {
  return (
    <div className="-mx-4 -mt-6 lg:-mx-10 lg:-mt-10">
      {/* Hero band */}
      <header className="relative isolate overflow-hidden bg-[rgb(var(--bg-elevated))] text-white">
        <div className="relative mx-auto max-w-[1120px] px-4 pt-3 pb-4 sm:px-6 sm:pt-4 sm:pb-5">
          <div className="mb-4 flex justify-end">
            <Skeleton className="h-7 w-44 rounded-[var(--radius-sm)]" />
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:gap-5">
            {/* Album-art tile */}
            <Skeleton className="h-[88px] w-[88px] shrink-0 rounded-[20px]" />

            {/* Title block */}
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-3.5 w-1/2" />
            </div>

            {/* Action rail */}
            <div className="flex shrink-0 flex-wrap items-center gap-2.5">
              <Skeleton className="h-11 w-24 rounded-[var(--radius-md)]" />
              <Skeleton className="h-10 w-10 rounded-full" />
            </div>
          </div>
        </div>
      </header>

      {/* Waveform card */}
      <section className="mx-auto max-w-[1120px] px-4 py-4 sm:px-6 sm:py-5">
        <Skeleton className="h-[88px] w-full rounded-[20px]" />

        {/* Notes header */}
        <div className="mt-5 flex items-baseline justify-between">
          <Skeleton className="h-5 w-20" />
        </div>

        {/* Composer */}
        <div className="mt-2.5">
          <Skeleton className="h-9 w-full rounded-[var(--radius-sm)]" />
        </div>

        {/* Comments list */}
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5 rounded-[12px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2.5 py-2"
            >
              <Skeleton className="mt-0.5 h-7 w-7 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex gap-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-14" />
                </div>
                <Skeleton className="h-3 w-3/4" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
