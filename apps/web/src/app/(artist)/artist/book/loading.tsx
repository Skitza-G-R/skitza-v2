// Loading state for /artist/book — warm skeleton (not a spinner), per
// design system §7. STANDING screen: mirrors the booking silhouette
// (eyebrow row → producer row → availability calendar card) inside the
// page's own container so the data swap doesn't jump.
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
    <div className="reveal-up mx-auto w-full max-w-[480px] space-y-5">
      {/* eyebrow row — "Book." + "Next 14 days" */}
      <div className="flex items-baseline justify-between px-1 sm:px-0">
        <Block className="h-5 w-16 rounded-[8px]" />
        <Block className="h-3 w-24 rounded-[6px]" />
      </div>
      {/* producer row */}
      <Block className="h-[56px] w-full rounded-[var(--radius-lg)]" />
      {/* availability calendar card — day grid + slot ghost */}
      <div
        className="rounded-[var(--radius-xl)] border px-5 py-5"
        style={{
          background: "rgb(var(--bg-elevated))",
          borderColor: "rgb(var(--border-subtle))",
        }}
      >
        <Block className="h-4 w-32 rounded-[6px]" />
        <div className="mt-4 grid grid-cols-7 gap-2">
          {Array.from({ length: 14 }).map((_, i) => (
            <Block key={i} className="aspect-square w-full rounded-[10px]" />
          ))}
        </div>
        <Block className="mt-4 h-[46px] w-full rounded-[var(--radius-lg)]" />
      </div>
    </div>
  );
}
