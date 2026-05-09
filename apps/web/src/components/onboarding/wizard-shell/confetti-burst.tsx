"use client";

import { useEffect, useRef, useState } from "react";

// CSS-only confetti burst for the onboarding Done screen. Renders N
// absolutely-positioned squares with random colors and animation
// offsets that fall/rotate from the top of the screen. Auto-dismisses
// after ~1.8s so it doesn't sit there forever.
//
// Why client-only render (no SSR): the previous version generated
// pieces with a deterministic seed during SSR + re-rolled in
// useEffect, but a hydration-time race in Next.js dev was unmounting
// the SSR'd pieces before the effect re-rendered. Skipping SSR
// entirely (mounted=false on initial render → null) sidesteps the
// race; the burst is decorative so an extra paint isn't a problem.

const PIECE_COUNT = 70;
const PALETTE = [
  "rgb(212 150 10)", // brand amber
  "rgb(161 113 6)", // brand amber dark
  "rgb(212 150 10 / 0.7)",
  "rgb(34 197 94)", // success green
  "rgb(220 38 38 / 0.85)", // celebratory red
  "rgb(176 104 48)", // copper
];

interface Piece {
  left: number;
  delay: number;
  duration: number;
  color: string;
  rotate: number;
  size: number;
}

function generatePieces(): Piece[] {
  return Array.from({ length: PIECE_COUNT }, (): Piece => {
    const colorIndex = Math.floor(Math.random() * PALETTE.length);
    return {
      left: Math.random() * 100,
      delay: Math.random() * 0.4,
      duration: 1.4 + Math.random() * 0.6,
      color: PALETTE[colorIndex] ?? PALETTE[0] ?? "rgb(212 150 10)",
      rotate: Math.random() * 720 - 360,
      size: 6 + Math.random() * 6,
    };
  });
}

export function ConfettiBurst() {
  const [mounted, setMounted] = useState(false);
  const [hidden, setHidden] = useState(false);
  const piecesRef = useRef<Piece[]>([]);

  useEffect(() => {
    piecesRef.current = generatePieces();
    setMounted(true);
    const t = setTimeout(() => { setHidden(true); }, 1800);
    return () => { clearTimeout(t); };
  }, []);

  if (!mounted || hidden) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      {piecesRef.current.map((p, i) => (
        <span
          key={i}
          className="confetti-piece absolute top-[-20px]"
          style={{
            left: `${String(p.left)}%`,
            width: `${String(p.size)}px`,
            height: `${String(p.size * 0.4)}px`,
            background: p.color,
            animationDelay: `${String(p.delay)}s`,
            animationDuration: `${String(p.duration)}s`,
            ["--confetti-rotate" as string]: `${String(p.rotate)}deg`,
          }}
        />
      ))}
    </div>
  );
}
