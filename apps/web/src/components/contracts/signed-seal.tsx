"use client";

// The one expressive moment in the signing flow — a copper wax-seal
// stamp pops onto a muted-base overlay on successful signature. The
// motion is a single scale-in + fade-in via CSS keyframes defined in
// globals.css (`.seal-enter`). Respects prefers-reduced-motion by
// degrading to a fade only (handled in the @media query in globals).
//
// No framer-motion — this is the sole animation in the view, a new
// dep isn't worth it for one keyframe.

export function SignedSeal() {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center bg-[rgb(var(--bg-base)/0.96)] backdrop-blur-sm"
    >
      <div className="seal-enter flex flex-col items-center gap-4">
        <CopperSealSvg />
        <p
          className="font-display text-3xl tracking-tight text-[rgb(var(--fg-primary))]"
          style={{ fontWeight: 800 }}
        >
          Signed
        </p>
      </div>
    </div>
  );
}

// Hand-rolled SVG so we don't ship an image asset for one moment.
// Two stacked rings + a cross-hatched center evoke a wax-stamp mark;
// amber gradient matches --brand-primary.
function CopperSealSvg() {
  return (
    <svg
      width="160"
      height="160"
      viewBox="0 0 160 160"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <radialGradient id="seal-copper" cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#F2B946" />
          <stop offset="55%" stopColor="#D4960A" />
          <stop offset="100%" stopColor="#8F5E00" />
        </radialGradient>
        <filter id="seal-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
          <feOffset dx="0" dy="3" result="off" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.35" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#seal-shadow)">
        <circle cx="80" cy="80" r="64" fill="url(#seal-copper)" />
        <circle
          cx="80"
          cy="80"
          r="54"
          fill="none"
          stroke="rgba(255, 251, 245, 0.55)"
          strokeWidth="1.5"
        />
        <circle
          cx="80"
          cy="80"
          r="44"
          fill="none"
          stroke="rgba(255, 251, 245, 0.35)"
          strokeWidth="1"
        />
        {/* Stylised "S" monogram for Skitza. */}
        <path
          d="M 62 62 Q 80 50 98 62 Q 110 72 90 80 Q 70 88 82 98 Q 100 110 62 100"
          fill="none"
          stroke="rgba(255, 251, 245, 0.9)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
