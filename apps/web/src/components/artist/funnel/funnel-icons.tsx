// Compact icon set for the artist purchase funnel (Commit / Pay / Book).
// Ported 1:1 from the approved prototype (`skitza-mobile-data.jsx` · `Ic`)
// so stroke weights and viewBoxes match the design exactly. Pure
// presentational SVGs — `currentColor` + `stroke`/`fill` inherit from the
// caller, so colour is driven by the surrounding text colour token.

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function ChevronLeft(props: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function ArrowRight(props: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 12h15m0 0l-6-6m6 6l-6 6" />
    </svg>
  );
}

export function Check(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 8.5l3.2 3.2L13 4.5" />
    </svg>
  );
}

// Larger stroked check used inside the S5 confirmation emblem.
export function CheckLarge(props: IconProps) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function DocIcon(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path d="M4 1.5h5l3 3v10H4z" strokeLinejoin="round" />
      <path d="M9 1.5v3h3M6 8h4M6 10.5h4" strokeLinecap="round" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.4} {...props}>
      <path d="M7 1l5 2v4c0 3-2.5 5-5 6-2.5-1-5-3-5-6V3z" strokeLinejoin="round" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.6" />
      <path d="M5.4 7V5a2.6 2.6 0 015.2 0v2" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <circle cx="7" cy="7" r="5.5" />
      <path d="M7 4v3.2l2 1.4" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
