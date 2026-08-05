// Loading state for S9 (upload proof) — warm skeleton (not a spinner), per
// design system §7. Full-screen funnel overlay mirroring the screen
// silhouette: top-bar ghost → intro lines → big dropzone block → pinned
// CTA ghost.
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
        <div className="sk-safe-top flex min-h-[52px] items-center px-[14px]">
          <Block className="h-[38px] w-[38px] shrink-0 rounded-full" />
          <div className="flex flex-1 justify-center">
            <Block className="h-4 w-36 rounded-[6px]" />
          </div>
          <div className="w-[38px] shrink-0" />
        </div>
        <div className="px-5 pt-3.5">
          {/* intro lines */}
          <Block className="h-5 w-3/4 rounded-[8px]" />
          <Block className="mt-2.5 h-4 w-full rounded-[8px]" />
          <Block className="mt-2 h-4 w-4/5 rounded-[8px]" />
          {/* dropzone */}
          <Block className="mt-5 h-[200px] w-full rounded-[var(--radius-lg)]" />
        </div>
      </div>

      {/* pinned CTA ghost */}
      <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[440px] px-[18px] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <Block className="h-[58px] w-full rounded-[var(--radius-lg)]" />
      </div>
    </div>
  );
}
