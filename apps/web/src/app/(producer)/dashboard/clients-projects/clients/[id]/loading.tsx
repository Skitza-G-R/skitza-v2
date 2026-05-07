// Loading skeleton for the client detail page.
//
// Mirrors the new gradient-hero layout: full-bleed dark band with a
// circular avatar placeholder + identity stack + CTA, then the KPI
// strip floats over the cream seam, then tabs and panel placeholder
// below. Animation is the shared Tailwind `animate-pulse`. The dark
// band uses `--bg-sunken` rather than the actual hero gradient since
// the per-client hue isn't known on first paint.

export default function Loading() {
  return (
    <main aria-hidden aria-label="Loading client">
      {/* Hero band */}
      <header className="relative isolate overflow-hidden bg-[rgb(var(--bg-sunken))]">
        <div className="mx-auto max-w-[1400px] px-4 pt-5 pb-12 sm:px-6 sm:pt-7 sm:pb-14 lg:px-8 lg:pt-8 lg:pb-16">
          <div className="mb-7 flex items-center justify-between">
            <Skel className="h-7 w-28 rounded-full" tone="band" />
            <Skel className="h-7 w-56 rounded-full" tone="band" />
          </div>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
            <div className="flex min-w-0 items-end gap-4 sm:gap-6">
              <Skel
                className="h-[88px] w-[88px] shrink-0 rounded-full sm:h-[104px] sm:w-[104px]"
                tone="band-strong"
              />
              <div className="flex-1 space-y-3">
                <Skel className="h-3 w-24" tone="band" />
                <Skel className="h-12 w-3/4 sm:h-16" tone="band-strong" />
                <Skel className="h-3 w-2/3" tone="band" />
              </div>
            </div>
            <Skel className="h-11 w-36 shrink-0 rounded-full" tone="band-strong" />
          </div>
        </div>
      </header>

      {/* KPI strip (overlaps the seam) */}
      <div className="mx-auto -mt-9 max-w-[1400px] px-4 sm:-mt-10 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <Skel className="h-[96px] rounded-[var(--radius-md)] shadow-sm" />
          <Skel className="h-[96px] rounded-[var(--radius-md)] shadow-sm" />
          <Skel className="h-[96px] rounded-[var(--radius-md)] shadow-sm" />
        </div>
      </div>

      {/* Tabs + panel */}
      <div className="mx-auto max-w-[1400px] px-4 pb-24 pt-8 sm:px-6 sm:pt-10 lg:px-8">
        <div className="flex gap-2">
          <Skel className="h-10 w-24 rounded-full" />
          <Skel className="h-10 w-24 rounded-full" />
          <Skel className="h-10 w-24 rounded-full" />
          <Skel className="h-10 w-32 rounded-full" />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
          <div className="space-y-4 lg:col-span-2">
            <Skel className="h-48 rounded-[var(--radius-md)]" />
            <Skel className="h-64 rounded-[var(--radius-md)]" />
          </div>
          <Skel className="h-64 rounded-[var(--radius-md)]" />
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
  tone?: "default" | "band" | "band-strong";
}) {
  const bg =
    tone === "band-strong"
      ? "bg-white/20"
      : tone === "band"
        ? "bg-white/12"
        : "bg-[rgb(var(--bg-overlay))]";
  return (
    <span
      aria-hidden
      className={["block animate-pulse", bg, className ?? ""].join(" ")}
    />
  );
}
