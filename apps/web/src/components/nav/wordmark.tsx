// "Skitza." wordmark — Syne 800 with the amber period that scales +
// rotates on hover. Pure presentational; the component renders the
// glyph + dot but the brand-primary color + transform live in the
// `.skitza-wordmark .dot` rule in globals.css so the entire app
// shares one source of truth for the period interaction.
//
// `inverse` flips the base text colour to `--fg-onsidebar` for
// rendering on dark sidebar surfaces (the producer left rail, the
// artist desktop sidebar, the artist mobile top bar's right-side
// avatar block, etc.). Default = warm canvas usage.
//
// `as` lets the wordmark render as a button-like element when wrapped
// inside an interactive Link — keeps semantics clean (the parent
// <Link> carries the role) without forcing an extra <span> nest.

import type { ReactNode } from "react";

export function Wordmark({
  size = 22,
  inverse = false,
  ariaLabel = "Skitza",
  className = "",
  lowercase = false,
}: {
  /** Font-size in px. Locked design uses 22 (sidebar header), 18 (mobile top bar). */
  size?: number;
  /** Switch base colour to --fg-onsidebar when rendered over a dark surface. */
  inverse?: boolean;
  ariaLabel?: string;
  className?: string;
  /** Render "skitza." instead of "Skitza." — used in the LogoMark + Wordmark lockup. */
  lowercase?: boolean;
}): ReactNode {
  return (
    <span
      aria-label={ariaLabel}
      className={`skitza-wordmark ${className}`}
      style={{
        fontSize: `${size.toString()}px`,
        color: inverse
          ? "rgb(var(--fg-onsidebar))"
          : "rgb(var(--fg-default))",
      }}
    >
      {lowercase ? "skitza" : "Skitza"}
      <span className="dot">.</span>
    </span>
  );
}
