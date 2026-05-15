// Skitza logo mark — soft-rounded amber square with a dark Syne capital "S"
// and an amber glow shadow. Pairs with `<Wordmark lowercase />` to form the
// full lockup used in the producer + artist app sidebars (spec lifted from
// Gili's Clients Projects Room mockup, 2026-05-15).
//
// The glow shadow is what lifts the mark off the dark sidebar — it's the
// signature detail. Don't drop it for a flat fill: the difference between
// "premium" and "generic" here is entirely in that 14px amber blur.
//
// Distinct from `SkitzaMark` (the elaborate landing-page character SVG) —
// this one is the *product* mark: small, geometric, legible at 24-40px,
// designed to sit next to the wordmark or stand alone in the collapsed
// 64px sidebar.

import type { CSSProperties, ReactNode } from "react";

export function LogoMark({
  size = 30,
  ariaLabel,
}: {
  /** Square edge length in px. Sidebar header uses 30 (spec); collapsed rail uses 32. */
  size?: number;
  /** Optional label. Omit when rendered next to a labeled Wordmark — the parent already names the lockup. */
  ariaLabel?: string;
}): ReactNode {
  // Ratios derived from the mockup's 30px spec: radius 8/30, font-size 16/30.
  const radius = Math.max(6, Math.round((size * 8) / 30));
  const fontSize = Math.round((size * 16) / 30);
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size,
    height: size,
    borderRadius: radius,
    background: "rgb(var(--brand-primary))",
    color: "#111009",
    fontFamily: "var(--font-syne), system-ui, sans-serif",
    fontWeight: 800,
    fontSize,
    lineHeight: 1,
    letterSpacing: "-0.02em",
    flexShrink: 0,
    boxShadow: "0 4px 14px rgba(212, 150, 10, 0.4)",
  };
  return (
    <span
      {...(ariaLabel ? { "aria-label": ariaLabel, role: "img" } : { "aria-hidden": true })}
      style={style}
    >
      S
    </span>
  );
}
