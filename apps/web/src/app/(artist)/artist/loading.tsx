// Loading state for /artist home — warm skeleton (not a spinner), per design
// system §7. This is a STANDING screen: the silhouette mirrors the page's
// section stack (greeting strip → last-upload hero → next-session strip →
// payment rows → producer tile) inside the same container the real page
// uses, so the swap to live content doesn't jump.
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
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-7 py-6">
      {/* greeting strip — date eyebrow + greeting */}
      <div className="space-y-2">
        <Block className="h-3 w-28 rounded-[6px]" />
        <Block className="h-7 w-48 rounded-[10px]" />
      </div>
      {/* last-upload hero card (PRIMARY, dark) */}
      <Block className="h-[230px] w-full rounded-[var(--radius-xl)]" />
      {/* next-session strip (SECONDARY) */}
      <Block className="h-[72px] w-full rounded-[var(--radius-lg)]" />
      {/* payment request rows (TERTIARY) */}
      <Block className="h-[52px] w-full rounded-[var(--radius-lg)]" />
      <Block className="h-[52px] w-full rounded-[var(--radius-lg)]" />
      {/* producer roster tile (QUATERNARY) */}
      <Block className="h-[88px] w-full rounded-[var(--radius-lg)]" />
    </div>
  );
}
