// Loading skeleton for /dashboard/clients-projects/[id]/songs/[songId].
//
// Without this route-segment loading file, Next.js would fall back to
// the parent /[id]/loading.tsx — which is shaped for the AlbumSpace
// (table-of-songs body) and looks visually different from the
// SongSpace shell (hero + stat strip + tab bar + 2-column overview).
// On slow networks the swap-in from AlbumLoading to SongSpace creates a
// jarring layout shift; the dedicated skeleton below mirrors the real
// page's geometry so the hand-off is imperceptible.
//
// Tokens: --bg-elevated for the card surfaces and --border-subtle for
// the hairlines, per CLAUDE.md Skitza CSS token rules. Animation uses
// Tailwind's built-in `animate-pulse`.

export default function SongSpaceLoading() {
  return (
    <main aria-hidden aria-label="Loading song">
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {/* Dark gradient placeholder for the SongSpaceHero (~h-[220px]) */}
        <Skel className="h-[220px] rounded-[var(--radius-lg)]" tone="band" />

        {/* 4-cell stat strip placeholder */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Skel className="h-[88px] rounded-[var(--radius-md)]" />
          <Skel className="h-[88px] rounded-[var(--radius-md)]" />
          <Skel className="h-[88px] rounded-[var(--radius-md)]" />
          <Skel className="h-[88px] rounded-[var(--radius-md)]" />
        </div>

        {/* Tab bar placeholder */}
        <div className="mt-6 flex gap-2">
          <Skel className="h-9 w-24 rounded-full" />
          <Skel className="h-9 w-24 rounded-full" />
          <Skel className="h-9 w-24 rounded-full" />
          <Skel className="h-9 w-28 rounded-full" />
        </div>

        {/* Overview body: workflow card + 2-column rows */}
        <div className="mt-6 space-y-4">
          <Skel className="h-[136px] rounded-[var(--radius-lg)]" />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Skel className="h-[260px] rounded-[var(--radius-lg)]" />
            <Skel className="h-[260px] rounded-[var(--radius-lg)]" />
          </div>
        </div>
      </div>
    </main>
  );
}

function Skel({
  className,
  tone = "default",
}: {
  className?: string;
  tone?: "default" | "band";
}) {
  // The hero band placeholder reads as a dark gradient stand-in so the
  // perceived weight matches the real hero; everything else uses the
  // standard elevated surface tone so the cards line up with the live
  // page's card backgrounds.
  const bg =
    tone === "band"
      ? "bg-[rgb(var(--bg-sunken))]"
      : "bg-[rgb(var(--bg-elevated))]";
  return (
    <span
      aria-hidden
      className={[
        "block animate-pulse border border-[rgb(var(--border-subtle))]",
        bg,
        className ?? "",
      ].join(" ")}
    />
  );
}
