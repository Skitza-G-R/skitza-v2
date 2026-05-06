// Decorative waveform — 50-bar SVG silhouette for cards that preview a
// track without playing it. Heights are deterministic from a seed
// (track id or version label) so the same track renders identically
// on every visit. NOT the real waveform — that lives in
// `apps/web/src/components/audio/waveform-player.tsx` (wavesurfer.js
// + decoded peaks). This is only for affordance "this is a song".

export function DecorativeWaveform({
  seed,
  height = 36,
  bars = 50,
  className,
  highlight = 0,
}: {
  seed: string;
  height?: number;
  bars?: number;
  className?: string;
  /** 0..1 — fraction of bars to paint amber (left side). */
  highlight?: number;
}) {
  // FNV-1a-ish seed → deterministic per-bar heights between 0.18 and 1.
  let s = 0;
  for (let i = 0; i < seed.length; i++) {
    s = (s * 31 + seed.charCodeAt(i)) | 0;
  }
  const heights: number[] = [];
  for (let i = 0; i < bars; i++) {
    s = (s * 1103515245 + 12345) | 0;
    const r = ((s >>> 16) & 0x7fff) / 0x7fff;
    heights.push(0.18 + r * 0.82);
  }

  const w = bars * 4 - 2; // 2px wide bars + 2px gap
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${String(w)} ${String(height)}`}
      width="100%"
      height={height}
      className={className}
      preserveAspectRatio="none"
    >
      {heights.map((h, i) => {
        const barH = Math.max(2, h * height);
        const y = (height - barH) / 2;
        const isHighlighted = i / bars < highlight;
        return (
          <rect
            key={i}
            x={i * 4}
            y={y}
            width={2}
            height={barH}
            rx={1}
            fill={
              isHighlighted
                ? "rgb(var(--brand-primary))"
                : "rgb(var(--border-strong))"
            }
          />
        );
      })}
    </svg>
  );
}
