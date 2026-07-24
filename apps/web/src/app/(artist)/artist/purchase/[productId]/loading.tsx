// Loading state for S3 (product detail) — warm skeleton (not a spinner),
// per design system §7. Full-screen funnel overlay mirroring the screen
// silhouette: top-bar ghost → cover band → price line → producer card →
// "what's included" card → pinned CTA ghost.
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
      className="fixed inset-0 z-[60] overflow-hidden"
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
        <div className="px-5 pt-3">
          {/* cover band */}
          <Block className="h-[150px] w-full rounded-[var(--radius-xl)]" />
          {/* price line */}
          <Block className="mt-5 h-8 w-32 rounded-[10px]" />
          {/* producer card */}
          <Block className="mt-4 h-[72px] w-full rounded-[var(--radius-lg)]" />
          {/* what's included */}
          <Block className="mt-4 h-[180px] w-full rounded-[var(--radius-lg)]" />
        </div>
      </div>

      {/* pinned CTA ghost */}
      <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[440px] px-[18px] pb-6">
        <Block className="h-[58px] w-full rounded-[var(--radius-lg)]" />
      </div>
    </div>
  );
}
