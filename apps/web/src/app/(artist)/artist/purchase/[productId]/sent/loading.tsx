// Loading state for S5 (request sent) — warm skeleton (not a spinner), per
// design system §7. Full-screen funnel overlay mirroring the celebration
// silhouette: centered emblem → headline lines → summary card → pinned
// CTA ghost. No top bar on this screen.
function Block({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse ${className}`}
      style={{ background: "rgb(var(--bg-sunken))" }}
    />
  );
}

export default function Loading() {
  return (
    <div
      className="fixed inset-0 z-[60] overflow-hidden"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <div className="mx-auto flex w-full max-w-[440px] flex-col items-center px-[30px] pt-[72px]">
        {/* ripple emblem */}
        <Block className="h-[88px] w-[88px] rounded-full" />
        {/* headline + sub lines */}
        <Block className="mt-6 h-6 w-48 rounded-[10px]" />
        <Block className="mt-3 h-4 w-64 rounded-[8px]" />
        <Block className="mt-2 h-4 w-52 rounded-[8px]" />
        {/* request summary card */}
        <Block className="mt-7 h-[180px] w-full rounded-[var(--radius-xl)]" />
      </div>

      {/* pinned CTA ghost */}
      <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[440px] px-[18px] pb-6">
        <Block className="h-[58px] w-full rounded-[var(--radius-lg)]" />
      </div>
    </div>
  );
}
