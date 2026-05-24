import { Skeleton } from "~/components/ui/skeleton";

// Route-segment loading state for /artist/music/[projectId] (L2
// Project page). Mirrors the shared ProjectPage's shape: full-bleed
// gradient hero band with cover + title + meta block, then a
// tracklist on the cream canvas below. The shell's `px-4 pt-6
// lg:px-10 lg:pt-10` would otherwise leave cream strips around the
// hero — same negative-margin breakout the real page applies.
export default function ArtistProjectLoading() {
  return (
    <div className="-mx-4 -mt-6 lg:-mx-10 lg:-mt-10">
      {/* Hero band — neutral skeleton color (no per-project gradient
          yet because we don't have the projectId at this layer). */}
      <header className="relative isolate overflow-hidden bg-[rgb(var(--bg-elevated))]">
        <div
          className="relative mx-auto"
          style={{
            maxWidth: 1120,
            padding:
              "clamp(36px, 4.4vw, 56px) clamp(28px, 3vw, 36px) clamp(30px, 3vw, 40px)",
          }}
        >
          <div className="flex flex-wrap items-end gap-8 pb-1.5">
            <Skeleton className="h-[232px] w-[232px] shrink-0 rounded-[18px]" />
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-12 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3.5">
            <Skeleton className="h-[60px] w-[60px] rounded-full" />
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-10 w-10 rounded-full" />
          </div>
        </div>
      </header>

      {/* Tracklist skeleton */}
      <section
        className="mx-auto"
        style={{
          maxWidth: 1120,
          padding:
            "clamp(14px, 1.8vw, 22px) clamp(28px, 3vw, 36px) clamp(56px, 5vw, 80px)",
        }}
      >
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="grid items-center gap-3 px-4 py-2.5"
              style={{
                gridTemplateColumns: "36px minmax(0,1fr) 86px 80px 60px 44px",
              }}
            >
              <Skeleton className="h-3 w-4 justify-self-end" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-3 w-8 justify-self-end" />
              <Skeleton className="h-3 w-8 justify-self-end" />
              <Skeleton className="h-3 w-10 justify-self-end" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
