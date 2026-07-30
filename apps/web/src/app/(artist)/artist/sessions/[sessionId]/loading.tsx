// Loading state for S12 — warm skeleton (not a spinner), per design system
// §7. Mirrors the standing session-detail silhouette without owning a
// full-screen overlay.
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
      <div className="px-5">
        <Block className="mb-3 h-11 w-36 rounded-[var(--radius-lg)]" />
        {/* hero card */}
        <Block className="h-[220px] w-full rounded-[var(--radius-xl)]" />
        {/* policy line */}
        <Block className="mt-4 h-[52px] w-full rounded-[var(--radius-lg)]" />
      </div>

      <div className="px-[18px] pt-5 pb-6">
        <Block className="h-[50px] w-full rounded-[var(--radius-lg)]" />
        <Block className="mt-2.5 h-[58px] w-full rounded-[var(--radius-lg)]" />
      </div>
    </div>
  );
}
