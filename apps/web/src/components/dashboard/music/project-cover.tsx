import { GRADIENT_CSS, hashString, type GradientClass, type ProjectKind } from "./lib";

// Single source of truth for the project cover — used in the library
// grid, project hero, table thumbnails, and song-page hero atmospheric
// overlay. Renders a square gradient with a generative SVG ring
// pattern, a Kind badge bottom-left, and a Skitza wordmark bottom-right.
//
// Per design.md:
//   - 5 SVG circles, derived from a hash of the seed
//   - mix-blend-mode: overlay, opacity 0.55, white stroke 0.5
//   - radial highlight at 28% 22% gives iridescence
//   - Kind badge: Syne 800, white, 13px
//   - Wordmark "Skitza." with amber period, white 55% alpha

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
      ? "0 16px 38px rgba(17,16,9,.28)"
      : shadow === "card"
        ? "0 6px 20px rgba(17,16,9,.08)"
        : "none";

  return (
    <div
      aria-hidden
      className={["relative isolate overflow-hidden", className ?? ""].join(" ").trim()}
      style={{
        background: GRADIENT_CSS[gradient],
        borderRadius: radius ?? "var(--radius-md)",
        boxShadow: shadowStyle,
      }}
    >
      {/* Generative SVG ring pattern. mix-blend-mode: overlay lets the
          rings tint the gradient without bleaching it. */}
      <svg
        viewBox="0 0 64 64"
        className="absolute inset-0 h-full w-full"
        style={{ mixBlendMode: "overlay", opacity: 0.55 }}
        aria-hidden
      >
        {circles.map((c, i) => (
          <circle
            key={i}
            cx={c.cx}
            cy={c.cy}
            r={c.r}
            fill="none"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth="0.5"
          />
        ))}
      </svg>

      {/* Iridescent highlight — soft white-to-transparent radial. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 28% 22%, rgba(255,255,255,0.32), transparent 60%)",
        }}
      />

      {/* Kind badge */}
      {showKind && kind ? (
        <span
          className="absolute bottom-2.5 left-2.5 font-display text-[13px] font-extrabold leading-none text-white"
          style={{ letterSpacing: "-0.01em" }}
        >
          {kind}
        </span>
      ) : null}

      {/* Wordmark */}
      {wordmark ? (
        <span
          className="absolute bottom-2.5 right-2.5 font-display text-[12px] font-extrabold leading-none"
          style={{ color: "rgba(255,255,255,0.55)", letterSpacing: "-0.01em" }}
        >
          Skitza
          <span style={{ color: "rgb(212 150 10)" }}>.</span>
        </span>
      ) : null}
    </div>
  );
}
