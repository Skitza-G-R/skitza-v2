// Loading state for S8 (payment instructions) — warm skeleton (not a
// spinner), per design system §7. Full-screen funnel overlay mirroring the
// screen silhouette: top-bar ghost → amount summary card → transfer detail
// rows → pinned CTA ghost.
function Block({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse motion-reduce:animate-none ${className}`}
      style={{ background: "rgb(var(--bg-sunken))" }}
    />
  );
}

export default function Loading() {
  return (
    <div
      className="sk-native-screen fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] z-[60] overflow-hidden"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <div className="mx-auto w-full max-w-[440px]">
        {/* top-bar ghost */}
        <div className="flex h-[52px] items-center px-[14px]">
          <Block className="h-[38px] w-[38px] shrink-0 rounded-full" />
          <div className="flex flex-1 justify-center">
            <Block className="h-4 w-36 rounded-[6px]" />
          </div>
          <div className="w-[38px] shrink-0" />
        </div>
        <div className="px-5 pt-3.5">
          {/* amount summary card */}
          <Block className="h-[110px] w-full rounded-[var(--radius-lg)]" />
          {/* transfer detail rows */}
          <div className="mt-4 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3.5">
                <Block className="h-[34px] w-[34px] shrink-0 rounded-[10px]" />
                <div className="flex-1 space-y-2">
                  <Block className="h-3 w-1/3 rounded-[6px]" />
                  <Block className="h-3.5 w-2/3 rounded-[6px]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* pinned CTA ghost */}
      <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[440px] px-[18px] pb-6">
        <Block className="h-[58px] w-full rounded-[var(--radius-lg)]" />
      </div>
    </div>
  );
}
