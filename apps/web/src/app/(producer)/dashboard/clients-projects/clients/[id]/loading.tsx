// Loading skeleton for the client detail page.
//
// Mirrors the actual page layout: top-row breadcrumb, gradient band,
// header (avatar + name + KPIs + CTA), tab nav, and a tall panel
// placeholder. The numeric proportions (avatar size, KPI height, panel
// gap) match the rendered page so there's no jolt when content swaps
// in. Animation: `sk-skeleton-pulse` is the shared shimmer keyframe
// used elsewhere; falling back to opacity flicker when reduced-motion
// is set is handled at the keyframe level in globals.css.

export default function Loading() {
  return (
    <>
      <div className="mx-auto max-w-[1400px] px-4 pt-4 sm:px-6 lg:px-8 lg:pt-6">
        <div className="flex items-center justify-between gap-3">
          <Skel className="h-3 w-24" />
          <Skel className="h-3 w-48" />
        </div>
      </div>

      <div className="relative isolate">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[280px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.08)] via-[rgb(var(--bg-base))] to-[rgb(var(--bg-base))]"
        />
        <div
          aria-hidden
          aria-label="Loading client"
          className="mx-auto max-w-[1400px] px-4 pt-6 pb-24 sm:px-6 sm:pt-8 lg:px-8 lg:pt-10"
        >
          {/* Header */}
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <div className="flex min-w-0 items-start gap-4 sm:gap-5">
                <Skel className="h-14 w-14 shrink-0 rounded-full sm:h-[72px] sm:w-[72px]" />
                <div className="flex-1 space-y-3">
                  <Skel className="h-3 w-24" />
                  <Skel className="h-12 w-3/4 sm:h-16" />
                  <Skel className="h-3 w-2/3" />
                </div>
              </div>
              <Skel className="h-10 w-32 shrink-0 rounded-[var(--radius-md)]" />
            </div>
            {/* KPI strip */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
              <Skel className="h-[88px] rounded-[var(--radius-md)]" />
              <Skel className="h-[88px] rounded-[var(--radius-md)]" />
              <Skel className="h-[88px] rounded-[var(--radius-md)]" />
            </div>
          </div>

          {/* Tab nav */}
          <div className="mt-7 flex gap-2">
            <Skel className="h-10 w-24 rounded-full" />
            <Skel className="h-10 w-24 rounded-full" />
            <Skel className="h-10 w-24 rounded-full" />
            <Skel className="h-10 w-32 rounded-full" />
          </div>

          {/* Panel placeholder */}
          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
            <div className="space-y-4 lg:col-span-2">
              <Skel className="h-48 rounded-[var(--radius-md)]" />
              <Skel className="h-64 rounded-[var(--radius-md)]" />
            </div>
            <Skel className="h-64 rounded-[var(--radius-md)]" />
          </div>
        </div>
      </div>
    </>
  );
}

function Skel({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={[
        "block animate-pulse bg-[rgb(var(--bg-overlay))]",
        className ?? "",
      ].join(" ")}
    />
  );
}
