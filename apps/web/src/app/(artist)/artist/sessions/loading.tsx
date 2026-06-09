// Loading state for S11 "My sessions" — warm skeleton (not a spinner), per
// design system §7. This is a STANDING screen, so the silhouette sits inside
// the shell's content column (no fixed overlay), mirroring the real screen:
// eyebrow → active-package card → a few session rows.
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
    <div className="space-y-4">
      <Block className="h-4 w-32 rounded-[8px]" />
      <Block className="h-[88px] w-full rounded-[var(--radius-lg)]" />
      <Block className="h-[52px] w-full rounded-[var(--radius-lg)]" />
      <div
        className="rounded-[var(--radius-lg)] px-4"
        style={{
          background: "rgb(var(--bg-elevated))",
          border: "1px solid rgb(var(--border-subtle))",
        }}
      >
        <div className="divide-y divide-[rgb(var(--border-subtle))]">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3.5 py-3.5">
              <Block className="h-9 w-9 shrink-0 rounded-[10px]" />
              <div className="flex-1 space-y-2">
                <Block className="h-3.5 w-2/3 rounded-[6px]" />
                <Block className="h-3 w-2/5 rounded-[6px]" />
              </div>
              <Block className="h-6 w-16 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
