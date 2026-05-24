// Shared producer art block. Renders the gradient + radial sheen +
// producer initials in a fixed-size square. Used by the Last Upload
// card (170×170) and the Book-a-session tiles (44×44).

import type { CSSProperties } from "react";

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
  const hue = hueFromName(producerName);
  const fontSize = initialsFontSize ?? Math.round(size * 0.13);
  const inset = Math.max(8, Math.round(size * 0.06));
  const gradientStyle: CSSProperties = {
    width: size,
    height: size,
    background: `linear-gradient(135deg, oklch(0.72 0.13 ${String(hue)}) 0%, oklch(0.45 0.14 ${String(hue + 30)}) 100%)`,
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
        {initialsFromName(producerName)}
      </span>
    </div>
  );
}

// Deterministic hue (0–360) from a name. Same FNV-31 hash style as
// the existing `~/lib/clients/derive-gradient.ts` helper so two
// surfaces of the same producer pick consistent colors.
export function hueFromName(name: string): number {
  if (!name) return 28; // fallback amber
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

// 1–2 letter initials. "Gili Studio" → "GS", "Skitza" → "S",
// empty / whitespace → "??".
export function initialsFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "??";
  const words = trimmed.split(/\s+/).slice(0, 2);
  const letters = words.map((w) => w.charAt(0).toUpperCase()).join("");
  return letters || "??";
}
