// Loading state for S12 — warm skeleton (not a spinner), per design system
// §7. Mirrors the session-detail silhouette (full-screen overlay → hero card
// → pinned action stack) so the swap to live content (once BE-3 adds the
// real fetch) doesn't jump.
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
      <div className="mx-auto w-full max-w-[440px] px-5 pt-[72px]">
        {/* hero card */}
        <Block className="h-[220px] w-full rounded-[var(--radius-xl)]" />
        {/* policy line */}
        <Block className="mt-4 h-[52px] w-full rounded-[var(--radius-lg)]" />
      </div>

      {/* pinned actions */}
      <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[440px] px-[18px] pb-6">
        <Block className="h-[50px] w-full rounded-[var(--radius-lg)]" />
        <Block className="mt-2.5 h-[58px] w-full rounded-[var(--radius-lg)]" />
      </div>
    </div>
  );
}
