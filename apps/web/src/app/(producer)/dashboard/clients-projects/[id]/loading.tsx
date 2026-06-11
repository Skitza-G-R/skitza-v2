// Route-segment loading state for /dashboard/clients-projects/[id]
// (Album page). Mirrors the AlbumSpace shell: dark gradient hero band
// (avatar + identity + hero CTAs), 4-tile stat strip, segmented tab
// bar, and a tracklist body. The previous version of this file was a
// generic title + 2-column grid that didn't match either branch of
// the page (album vs single-mode redirect), creating a noticeable
// shape flip on hand-off.
//
// Single-mode (project with exactly one track) redirects on the
// server to /songs/[songId] before this loading file ever renders, so
// the skeleton only needs to match the album-mode geometry.

export default function AlbumSpaceLoading() {
  return (
    <main aria-hidden aria-label="Loading project" className="sk-page-enter">
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        {/* Breadcrumb placeholder — "Clients & Projects › {project}". */}
        <Skel className="mb-4 h-4 w-56 rounded" />

        {/* Dark gradient placeholder for the AlbumHero band — shorter
            below md to match the SK-60 stacked mobile hero. */}
        <Skel className="h-[200px] rounded-[var(--radius-lg)] md:h-[260px]" tone="band" />

        {/* 4-cell stat strip — 2×2 below md, matching AlbumStatStrip */}
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Skel className="h-[88px] rounded-[var(--radius-md)]" />
          <Skel className="h-[88px] rounded-[var(--radius-md)]" />
          <Skel className="h-[88px] rounded-[var(--radius-md)]" />
          <Skel className="h-[88px] rounded-[var(--radius-md)]" />
        </div>

        {/* Tab pill bar — Songs / Files / Payments / Studio Log */}
        <div className="mt-6 flex gap-2">
          <Skel className="h-9 w-24 rounded-full" />
          <Skel className="h-9 w-20 rounded-full" />
          <Skel className="h-9 w-24 rounded-full" />
          <Skel className="h-9 w-28 rounded-full" />
        </div>

        {/* Tracklist body — 4 row placeholders */}
        <div className="mt-6 space-y-2">
          <Skel className="h-[64px] rounded-[var(--radius-md)]" />
          <Skel className="h-[64px] rounded-[var(--radius-md)]" />
          <Skel className="h-[64px] rounded-[var(--radius-md)]" />
          <Skel className="h-[64px] rounded-[var(--radius-md)]" />
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
