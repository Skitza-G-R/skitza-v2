// Loading state for S4 — warm skeleton (not a spinner), per design system
// §7. Mirrors the screen silhouette so the swap to live content (once BE-1
// adds the real fetch) doesn't jump.
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
      <div className="mx-auto w-full max-w-[440px] px-5 pt-[72px]">
        <Block className="h-7 w-2/3 rounded-[10px]" />
        <Block className="mt-3 h-4 w-full rounded-[8px]" />
        <Block className="mt-2 h-4 w-4/5 rounded-[8px]" />
        <Block className="mt-5 h-[68px] w-full rounded-[var(--radius-lg)]" />
        <Block className="mt-4 h-[72px] w-full rounded-[var(--radius-lg)]" />
        <Block className="mt-4 h-[240px] w-full rounded-[var(--radius-lg)]" />
      </div>
    </div>
  );
}
