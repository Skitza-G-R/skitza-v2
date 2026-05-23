import { Skeleton } from "~/components/ui/skeleton";

// Route-segment loading state for /artist/music (L1 Library).
//
// Shown by Next.js while the page's `artist.music.list` RSC fetch is
// in flight (e.g. on Music tab open or after a Library refresh). The
// skeleton mirrors the real screen's shape — warm-amber wash, the
// "Library." heading + counts line, a toolbar pill, and a grid of
// project cards — so the perceptual shift when the data lands is
// minimal. Same negative-margin breakout the real page uses, so the
// skeleton fills the same edge-to-edge canvas.
export default function ArtistMusicLoading() {
  return (
    <div className="-mx-4 -mt-6 lg:-mx-10 lg:-mt-10">
      <div className="relative isolate">
        {/* Same warm-amber wash the real page uses — fades to
            transparent across 360px so it melts into the page bg
            without a visible band. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.10)] to-transparent"
        />
        <div className="mx-auto mt-10 max-w-[1180px] px-4 pt-6 pb-24 sm:px-7 sm:pt-8">
          {/* Header — Library title + counts skeleton */}
          <div className="space-y-3">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>

          {/* Toolbar pill — search + toggles */}
          <div className="mt-5">
            <Skeleton className="h-12 w-full rounded-[12px]" />
          </div>

          {/* Project card grid */}
          <ul
            role="list"
            className="mt-5 grid gap-[22px]"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(196px, 1fr))" }}
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="flex flex-col gap-3">
                <Skeleton className="aspect-square w-full rounded-[12px]" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
