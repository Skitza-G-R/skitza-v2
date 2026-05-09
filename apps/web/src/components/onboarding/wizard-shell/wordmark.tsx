// "skitza" wordmark used in the onboarding wizard top bar. Same shape
// as the .skitza-wordmark class in globals.css (Syne 800, gold dot,
// dot animates on hover) — re-rendered as a typed component so the
// onboarding shell isn't depending on a global class name + so the
// dot color follows --brand-primary which the rest of the wizard uses.
//
// Server component — no client JS needed, hover state is CSS only.

export function Wordmark({
  size = 22,
  href = "/",
  ariaLabel = "Skitza home",
}: {
  /** Font-size in px. Reference uses 22px desktop, 18px mobile. */
  size?: number;
  /** Optional href. Defaults to home; pass null to render a non-link. */
  href?: string | null;
  ariaLabel?: string;
}) {
  const inner = (
    <span
      className="skitza-wordmark"
      style={{ fontSize: size, lineHeight: 1 }}
      aria-label={ariaLabel}
    >
      <span>skitza</span>
      <span className="dot" aria-hidden>
        .
      </span>
    </span>
  );

  if (href === null) return inner;
  return (
    <a href={href} className="inline-flex" aria-label={ariaLabel}>
      {inner}
    </a>
  );
}
