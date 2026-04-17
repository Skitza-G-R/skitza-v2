import type { CSSProperties } from "react";

// Skitza brand mark — a round badge with a headphoned character peeking
// over a fan of papers (one marked OVERDUE). Same motif as the landing
// page's `sk-logo-icon`, ported as an SVG for zero runtime cost.
//
// The full fidelity on the landing is elaborate CSS (steam, sweat, arc
// brows, etc.). Here we ship a structurally-faithful simplified
// version: amber→copper ring, fanned papers, headphone band, minimal
// face. Producers see the same "stressed character handling paperwork"
// read, without the CSS animation overhead.
//
// `size`: "sm" (32), "md" (44), "lg" (72), "hero" (128). Uses a single
// `--mark-size` CSS var so callers can size without prop bloat.
type MarkSize = "sm" | "md" | "lg" | "hero";
const SIZE_PX: Record<MarkSize, number> = {
  sm: 32,
  md: 44,
  lg: 72,
  hero: 128,
};

export function SkitzaMark({ size = "md" }: { size?: MarkSize }) {
  const px = SIZE_PX[size];
  const style: CSSProperties = {
    width: px,
    height: px,
    display: "inline-block",
    flexShrink: 0,
  };
  return (
    <span style={style} aria-hidden>
      <svg viewBox="0 0 128 128" width={px} height={px}>
        <defs>
          <linearGradient id="sk-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#D4960A" />
            <stop offset="100%" stopColor="#B06830" />
          </linearGradient>
          <radialGradient id="sk-halo" cx="50%" cy="40%" r="70%">
            <stop offset="0%" stopColor="#D4960A" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#D4960A" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Soft amber halo behind the badge — reads as warm glow. */}
        <circle cx="64" cy="64" r="62" fill="url(#sk-halo)" />

        {/* Ring (badge outline) */}
        <circle
          cx="64"
          cy="64"
          r="50"
          fill="none"
          stroke="url(#sk-ring)"
          strokeWidth="3"
        />

        {/* Papers fanning behind character — three rectangles rotated. */}
        <g transform="translate(64, 78)">
          <rect
            x="-22"
            y="-6"
            width="44"
            height="26"
            rx="2"
            fill="#FFFBF5"
            stroke="#B06830"
            strokeWidth="0.8"
            transform="rotate(-14)"
          />
          <rect
            x="-22"
            y="-6"
            width="44"
            height="26"
            rx="2"
            fill="#FFFBF5"
            stroke="#B06830"
            strokeWidth="0.8"
            transform="rotate(-4)"
          />
          <rect
            x="-22"
            y="-6"
            width="44"
            height="26"
            rx="2"
            fill="#FFFBF5"
            stroke="#D4960A"
            strokeWidth="1"
            transform="rotate(8)"
          />
          {/* OVERDUE stamp on the top paper */}
          <g transform="rotate(8) translate(-16, 2)">
            <rect x="0" y="0" width="28" height="9" rx="1" fill="none" stroke="#CC3A2E" strokeWidth="0.8" />
            <text
              x="14"
              y="6.5"
              textAnchor="middle"
              fontSize="6"
              fontFamily="ui-sans-serif, system-ui"
              fontWeight="700"
              fill="#CC3A2E"
              letterSpacing="0.5"
            >
              OVERDUE
            </text>
          </g>
        </g>

        {/* Character head with headphones, centered above the papers. */}
        <g transform="translate(64, 48)">
          {/* Headphone band arcing over the head */}
          <path
            d="M -22 -6 A 22 22 0 0 1 22 -6"
            fill="none"
            stroke="#1A1714"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
          {/* Ear cups */}
          <rect x="-26" y="-8" width="8" height="14" rx="3" fill="#1A1714" />
          <rect x="18" y="-8" width="8" height="14" rx="3" fill="#1A1714" />
          {/* Head */}
          <ellipse cx="0" cy="4" rx="16" ry="18" fill="#EDE1CE" stroke="#B06830" strokeWidth="0.8" />
          {/* Brows (slanted, stressed) */}
          <path d="M -10 -2 L -4 0" stroke="#1A1714" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M 4 0 L 10 -2" stroke="#1A1714" strokeWidth="1.8" strokeLinecap="round" />
          {/* Eyes */}
          <circle cx="-6" cy="4" r="1.4" fill="#1A1714" />
          <circle cx="6" cy="4" r="1.4" fill="#1A1714" />
          {/* Mouth (worried flat line, slight curve down) */}
          <path d="M -4 12 Q 0 10 4 12" stroke="#1A1714" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        </g>
      </svg>
    </span>
  );
}
