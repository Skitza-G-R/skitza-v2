// Loading state for /artist/store — warm skeleton (not a spinner), per
// design system §7. STANDING screen: mirrors the storefront silhouette
// (eyebrow → producer hero band → focal product card → quiet "Also from"
// rows) inside the page's own container so the data swap doesn't jump.
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
    <div className="mx-auto w-full max-w-[600px] space-y-6 lg:max-w-[760px]">
      {/* eyebrow — "Store." */}
      <Block className="h-5 w-20 rounded-[8px]" />
      {/* producer hero band */}
      <Block className="h-[120px] w-full rounded-[var(--radius-xl)]" />
      {/* focal product card — cover band + text lines + CTA ghost */}
      <div
        className="overflow-hidden rounded-[var(--radius-xl)] border"
        style={{
          background: "rgb(var(--bg-elevated))",
          borderColor: "rgb(var(--border-subtle))",
        }}
      >
        <Block className="h-[150px] w-full rounded-none" />
        <div className="px-5 py-5">
          <Block className="h-5 w-2/3 rounded-[8px]" />
          <Block className="mt-2.5 h-3.5 w-full rounded-[6px]" />
          <Block className="mt-2 h-3.5 w-4/5 rounded-[6px]" />
          <Block className="mt-5 h-[46px] w-full rounded-[var(--radius-lg)]" />
        </div>
      </div>
      {/* quiet product list rows */}
      <div className="space-y-2.5">
        <Block className="h-[64px] w-full rounded-[var(--radius-lg)]" />
        <Block className="h-[64px] w-full rounded-[var(--radius-lg)]" />
      </div>
    </div>
  );
}
