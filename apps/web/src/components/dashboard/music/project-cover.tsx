import {
  COVER_SHADOW_CARD,
  COVER_SHADOW_HERO,
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
// API: ProjectCover ALWAYS renders as `position: relative` and sizes
// itself via the className the caller passes (e.g. `aspect-square`,
// `h-[232px] w-[232px]`, `h-9 w-9`). Callers MUST pass dimensions.
// To position the cover absolutely inside another container, wrap it
// in your own absolute-inset-0 div — never pass conflicting position
// classes (Tailwind utility-class collisions silently break the
// gradient render in some build paths).

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
   *  hero ambient stack specified in lib.ts. */
  shadow?: "card" | "hero" | "none";
  /** Sizing classes: aspect-square, h-[232px] w-[232px], etc. The caller
   *  is responsible for giving the cover dimensions. */
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
  const shadowStyle =
    shadow === "hero"
      ? COVER_SHADOW_HERO
      : shadow === "card"
        ? COVER_SHADOW_CARD
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
      <CoverPattern seed={seed} kind={kind} wordmark={wordmark} showKind={showKind} />
    </div>
  );
}

/** Internal: the visual ornaments that sit ON TOP of the gradient.
 *  Exported so callers who paint the gradient themselves (because they
 *  need full control of the wrapper) can compose the same ornaments.
 *  Always renders as a `pointer-events: none` overlay filling its
 *  positioned parent. */
export function CoverPattern({
  seed,
  kind,
  wordmark = true,
  showKind = true,
}: {
  seed: string;
  kind?: ProjectKind | null | undefined;
  wordmark?: boolean;
  showKind?: boolean;
}) {
  const hash = hashString(seed);
  // Five concentric circles with offsets derived from the seed hash.
  const circles = Array.from({ length: 5 }, (_, i) => {
    const cx = 20 + ((hash >> (i * 3)) & 7) * 4;
    const cy = 50 + ((hash >> (i * 4)) & 7) * 2 - 14;
    const r = 26 - i * 4;
    return { cx, cy, r };
  });

  return (
    <>
      {/* Generative SVG ring pattern. Plain white strokes — no
          mix-blend so they always render. preserveAspectRatio="none"
          stretches the pattern to non-square covers. */}
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
            stroke="rgba(255,255,255,0.45)"
            strokeWidth="0.6"
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
            "radial-gradient(120% 80% at 28% 22%, rgba(255,255,255,0.32), transparent 60%)",
        }}
      />

      {/* Inner edge — subtle 1px white bevel + outer dark bottom edge,
          gives the cover the "printed sleeve" feel. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(17,16,9,0.10)",
          borderRadius: "inherit",
        }}
      />

      {showKind && kind ? (
        <span
          className="absolute bottom-2.5 left-2.5 font-display text-[13px] font-extrabold leading-none text-white drop-shadow-[0_1px_2px_rgba(17,16,9,0.32)]"
          style={{ letterSpacing: "-0.01em" }}
        >
          {kind}
        </span>
      ) : null}

      {wordmark ? (
        <span
          className="absolute bottom-2.5 right-2.5 font-display text-[12px] font-extrabold leading-none drop-shadow-[0_1px_2px_rgba(17,16,9,0.22)]"
          style={{ color: "rgba(255,255,255,0.78)", letterSpacing: "-0.01em" }}
        >
          Skitza
          <span style={{ color: "rgb(212 150 10)" }}>.</span>
        </span>
      ) : null}
    </>
  );
}
