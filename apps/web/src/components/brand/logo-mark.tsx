// Skitza logo mark — soft-rounded amber square with a white lowercase "s".
// Pairs with `<Wordmark lowercase />` to form the full lockup used in the
// producer + artist app sidebars (see the mockup Gili pinned 2026-05-15).
//
// Distinct from `SkitzaMark` (the elaborate landing-page character SVG) —
// this one is the *product* mark: small, geometric, legible at 24-40px,
// designed to sit next to the wordmark or stand alone in the collapsed
// 64px sidebar.

import type { CSSProperties, ReactNode } from "react";

export function LogoMark({
  size = 28,
  ariaLabel,
}: {
  /** Square edge length in px. Sidebar header uses 28; collapsed rail uses 32. */
  size?: number;
  /** Optional label. Omit when rendered next to a labeled Wordmark — the parent already names the lockup. */
  ariaLabel?: string;
}): ReactNode {
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.26),
    background: "rgb(var(--brand-primary))",
    color: "#FFFFFF",
    fontFamily: "var(--font-syne), system-ui, sans-serif",
    fontWeight: 800,
    fontSize: Math.round(size * 0.62),
    lineHeight: 1,
    letterSpacing: "-0.04em",
    flexShrink: 0,
    // Tiny inner ring lifts the mark off dark surfaces without a hard shadow.
    boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.08)",
  };
  return (
    <span
      {...(ariaLabel ? { "aria-label": ariaLabel, role: "img" } : { "aria-hidden": true })}
      style={style}
    >
      s
    </span>
  );
}
