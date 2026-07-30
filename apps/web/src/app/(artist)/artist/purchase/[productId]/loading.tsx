// Loading state for S3 (product detail) — warm skeleton (not a spinner),
// per design system §7. It stays in the standing artist shell and mirrors
// the screen silhouette without owning a full-screen overlay.
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
      className="mx-auto w-full max-w-[440px]"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <div>
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

      <div className="px-[18px] pt-5 pb-6">
        <Block className="h-[58px] w-full rounded-[var(--radius-lg)]" />
      </div>
    </div>
  );
}
