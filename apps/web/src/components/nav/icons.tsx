// Inline-SVG icon set for Phase 2 chrome. No icon-library dependency —
// each glyph is 4-8 path segments and travels with the chrome bundle.
// This deliberately mirrors the design source's `Icon` API
// (`<Icon name="home" size={16} />`) so future ports stay
// recognisable, but it's exhaustively typed: only the glyphs the
// chrome actually uses are wired. Adding a new icon = adding a case
// to the switch + a new entry in `IconName`.
//
// Stroke style: 1.7-2.2 stroke-width, currentColor, round caps + joins.
// Lifted from the design canvas's `ui.jsx` Icon component (locked
// design system) so the visual weight matches the reference renders
// exactly.

import type { ReactNode } from "react";

export type IconName =
  | "home"
  | "users"
  | "music"
  | "calendar"
  | "store"
  | "settings"
  | "bell"
  | "search"
  | "x"
  | "chevron-up"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "arrow-left"
  | "plus"
  | "tag"
  | "book";

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.8,
  className = "",
  "aria-hidden": ariaHidden = true,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  "aria-hidden"?: boolean;
}): ReactNode {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor" as const,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": ariaHidden,
  };

  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1Z" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
          <path d="M16 11a3 3 0 1 0 0-6" />
          <path d="M21.5 20a5 5 0 0 0-6-4.9" />
        </svg>
      );
    case "music":
      return (
        <svg {...common}>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 9h18" />
          <path d="M8 3v4" />
          <path d="M16 3v4" />
        </svg>
      );
    case "store":
      return (
        <svg {...common}>
          <path d="M3 9 4.5 4h15L21 9" />
          <path d="M3 9v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9" />
          <path d="M3 9h18" />
          <path d="M9 21v-6h6v6" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      );
    case "bell":
      return (
        <svg {...common}>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.5 21a2 2 0 0 0 3 0" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      );
    case "x":
      return (
        <svg {...common} strokeWidth={strokeWidth + 0.4}>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      );
    case "chevron-up":
      return (
        <svg {...common}>
          <path d="m18 15-6-6-6 6" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "chevron-left":
      return (
        <svg {...common}>
          <path d="m15 18-6-6 6-6" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...common}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      );
    case "arrow-left":
      return (
        <svg {...common}>
          <path d="M19 12H5" />
          <path d="m12 19-7-7 7-7" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common} strokeWidth={strokeWidth + 0.4}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case "tag":
      return (
        <svg {...common}>
          <path d="M3 12V4h8l10 10-8 8L3 12z" />
          <circle cx="8" cy="9" r="1.5" fill="currentColor" />
        </svg>
      );
    case "book":
      return (
        <svg {...common}>
          <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 1 4 17.5z" />
          <path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20" />
        </svg>
      );
  }
}
