// Brand-recognition logo for the /get-started ad funnel.
// Display-only — never wrapped in <a> or <Link> per design doc §3.5.
// Test in __tests__/static-logo.test.tsx pins the no-link invariant.

export function StaticLogo() {
  return (
    <div
      aria-label="Skitza"
      className="inline-flex items-center gap-2 text-[rgb(var(--fg-primary))]"
    >
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        aria-hidden
      >
        <circle cx="14" cy="14" r="12" stroke="currentColor" strokeWidth="2" />
        <circle cx="14" cy="14" r="6" fill="currentColor" />
      </svg>
      <span className="font-semibold tracking-tight">Skitza</span>
    </div>
  );
}
