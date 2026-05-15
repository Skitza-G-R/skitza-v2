import {
  GRADIENT_BASE_COLOR,
  GRADIENT_CSS,
  hashString,
  type GradientClass,
  type ProjectKind,
} from "./lib";

// Single source of truth for the project cover — used in the library
// grid, project hero, and table thumbnails. Renders a gradient surface
// with a generative SVG ring pattern, optional Kind badge, and a
// Skitza wordmark.
//
// Defensive rendering:
//   - background is split into backgroundColor + backgroundImage (NOT
//     the `background` shorthand) so the solid base color renders even
//     if the linear-gradient parser ever chokes
//   - SVG rings paint with a plain white stroke at 0.32 opacity rather
//     than relying on mix-blend-mode (overlay needs a backdrop to
//     compose against; without one, the rings were invisible)
//   - the wrapper is `position: relative` so the caller's wrapping div
//     positions the cover; child overlays (rings, badge, wordmark) are
//     all absolute within it

export interface ProjectCoverProps {
  seed: string;
  gradient: GradientClass;
  kind?: ProjectKind | null;
  /** Show the Skitza wordmark bottom-right. Default true. Off for tight
   *  thumbnails like 36×36 table cells where the wordmark would clutter. */
  wordmark?: boolean;
  /** Show the kind badge bottom-left. Default true. */
  showKind?: boolean;
  /** Optional rounded-corner override. Default `var(--radius-md)` (12). */
  radius?: string;
  /** Optional shadow override. Default a card-lift; pass `hero` for the
   *  large hero shadow specified in design.md. */
  shadow?: "card" | "hero" | "none";
  className?: string;
}

export function ProjectCover({
  seed,
  gradient,
  kind,
  wordmark = true,
  showKind = true,
  radius,
  shadow = "card",
  className,
}: ProjectCoverProps) {
  const hash = hashString(seed);
  // Five concentric circles, offsets derived from hash bit-fields per
  // the design.md spec. Stable per seed so the same project always
  // renders the same artwork.
  const circles = Array.from({ length: 5 }, (_, i) => {
    const cx = 20 + ((hash >> (i * 3)) & 7) * 4;
    const cy = 50 + ((hash >> (i * 4)) & 7) * 2 - 14;
    const r = 26 - i * 4;
    return { cx, cy, r };
  });

  const shadowStyle =
    shadow === "hero"
      ? "0 16px 38px rgba(17,16,9,0.28)"
      : shadow === "card"
        ? "0 6px 20px rgba(17,16,9,0.08)"
        : "none";

  return (
    <div
      aria-hidden
      className={["relative overflow-hidden", className ?? ""].join(" ").trim()}
      style={{
        backgroundColor: GRADIENT_BASE_COLOR[gradient],
        backgroundImage: GRADIENT_CSS[gradient],
        borderRadius: radius ?? "var(--radius-md)",
        boxShadow: shadowStyle,
      }}
    >
      {/* Generative SVG ring pattern. Plain white strokes at low
          opacity — no mix-blend so it always renders, regardless of
          backdrop composition. preserveAspectRatio="none" stretches
          the pattern to fill non-square covers cleanly. */}
      <svg
        viewBox="0 0 64 64"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden
      >
        {circles.map((c, i) => (
          <circle
            key={i}
            cx={c.cx}
            cy={c.cy}
            r={c.r}
            fill="none"
            stroke="rgba(255,255,255,0.32)"
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {/* Soft top-left highlight for iridescence. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(120% 80% at 28% 22%, rgba(255,255,255,0.28), transparent 60%)",
        }}
      />

      {/* Kind badge */}
      {showKind && kind ? (
        <span
          className="absolute bottom-2.5 left-2.5 font-display text-[13px] font-extrabold leading-none text-white drop-shadow-[0_1px_2px_rgba(17,16,9,0.32)]"
          style={{ letterSpacing: "-0.01em" }}
        >
          {kind}
        </span>
      ) : null}

      {/* Wordmark */}
      {wordmark ? (
        <span
          className="absolute bottom-2.5 right-2.5 font-display text-[12px] font-extrabold leading-none drop-shadow-[0_1px_2px_rgba(17,16,9,0.22)]"
          style={{ color: "rgba(255,255,255,0.78)", letterSpacing: "-0.01em" }}
        >
          Skitza
          <span style={{ color: "rgb(212 150 10)" }}>.</span>
        </span>
      ) : null}
    </div>
  );
}
