// Shared producer art block. Renders the gradient + radial sheen +
// producer initials in a fixed-size square. Used by the Last Upload
// card (170×170) and the Book-a-session tiles (44×44).
//
// Gradient + initials come from the shared `producer-color` helper so
// the same producer renders identically on producer and artist surfaces.

import type { CSSProperties } from "react";

import {
  producerGradient,
  producerInitials,
} from "~/lib/_phase4-stubs/producer-color";

type Props = {
  producerName: string;
  size: number;
  initialsFontSize?: number;
  className?: string;
};

export function ProducerArt({
  producerName,
  size,
  initialsFontSize,
  className,
}: Props) {
  const fontSize = initialsFontSize ?? Math.round(size * 0.13);
  const inset = Math.max(8, Math.round(size * 0.06));
  const gradientStyle: CSSProperties = {
    width: size,
    height: size,
    background: producerGradient(producerName),
  };
  return (
    <div
      className={
        "relative shrink-0 overflow-hidden rounded-[10px] " + (className ?? "")
      }
      style={gradientStyle}
      aria-hidden
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 30% 18%, rgba(255,255,255,.28), transparent 62%)",
        }}
      />
      <span
        className="absolute font-bold text-white/95"
        style={{
          left: inset,
          bottom: inset,
          fontFamily: "var(--font-syne)",
          fontSize,
          letterSpacing: "-0.01em",
          textShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      >
        {producerInitials(producerName)}
      </span>
    </div>
  );
}
