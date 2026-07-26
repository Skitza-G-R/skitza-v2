import type { ReactNode } from "react";

// Uniform stat tile used across the new hero surfaces. Label sits as
// an uppercase eyebrow above a large value. Optional `sub` renders a
// muted line below the value. Variants tint the value color:
//   - default: fg-default (neutral)
//   - danger:  fg-danger (rose) — for overdue / outstanding
//   - ok:      fg-success (green) — for healthy / paid
//
// Optional `glow` renders a soft radial gradient in the top-right
// corner — matches the HTML mockup's drift-glow behind the
// Outstanding tile (red) and Next deadline tile (amber). Pure
// decoration via a pointer-events-none pseudo-overlay; doesn't affect
// hit-testing or layout.

export type StatTileVariant = "default" | "danger" | "ok";
export type StatTileGlow = "danger" | "brand" | "none";

interface StatTileProps {
  label: string;
  value: ReactNode;
  variant?: StatTileVariant;
  sub?: ReactNode;
  glow?: StatTileGlow;
  /**
   * SK-63 — opt-in mobile density. Below `md` the tile drops its own
   * border/radius (the parent strip renders ONE hairline-divided card)
   * and shrinks padding + value type so four stats fit in ~120px
   * instead of ~440px. md+ is byte-identical to the default. Off by
   * default so other StatTile surfaces are unaffected.
   */
  mobileCompact?: boolean;
  /** Tighter desktop spacing for information-dense dashboard strips. */
  dense?: boolean;
  /** Let an explicitly anchored desktop disclosure escape this tile. */
  allowDesktopOverflow?: boolean;
}

function valueColor(variant: StatTileVariant): string {
  if (variant === "danger") return "rgb(var(--fg-danger))";
  if (variant === "ok") return "rgb(var(--fg-success))";
  return "rgb(var(--fg-default))";
}

function glowGradient(glow: StatTileGlow): string | null {
  // The radial gradient sits at the top-right corner so the value
  // datum reads cleanly on the left. ~40% spread keeps the glow soft
  // and atmospheric, not "alert-tile".
  if (glow === "danger") {
    return "radial-gradient(120% 90% at 100% 0%, rgb(var(--fg-danger) / 0.16) 0%, transparent 55%)";
  }
  if (glow === "brand") {
    return "radial-gradient(120% 90% at 100% 0%, rgb(var(--brand-primary) / 0.18) 0%, transparent 55%)";
  }
  return null;
}

export function StatTile({
  label,
  value,
  variant = "default",
  sub,
  glow = "none",
  mobileCompact = false,
  dense = false,
  allowDesktopOverflow = false,
}: StatTileProps) {
  const glowBg = glowGradient(glow);
  const overflowCls = allowDesktopOverflow ? "lg:overflow-visible" : "";
  const boxCls = mobileCompact
    ? `relative flex flex-col gap-1 overflow-hidden rounded-none border-0 px-3.5 py-3 md:rounded-[var(--radius-md)] md:border ${dense ? "md:gap-1 md:px-4 md:py-3" : "md:gap-1.5 md:px-5 md:py-4"} ${overflowCls}`
    : `relative flex flex-col overflow-hidden rounded-[var(--radius-md)] border ${dense ? "gap-1 px-4 py-3" : "gap-1.5 px-5 py-4"} ${overflowCls}`;
  return (
    <div
      className={boxCls}
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-subtle))",
      }}
    >
      {glowBg ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 motion-safe:animate-[skitza-drift_22s_ease-in-out_infinite]"
          style={{ background: glowBg }}
        />
      ) : null}
      <span
        className="relative text-[10px] font-bold tracking-widest uppercase"
        style={{ color: "rgb(var(--fg-muted))" }}
      >
        {label}
      </span>
      <span
        // G16 — Syne 800 with tight negative tracking matches the design
        // (HTML 305: `.stat .v{font-family:'Syne';font-weight:800;
        // font-size:22px;letter-spacing:-.02em}`). The previous
        // Outfit-semibold reading was too neutral against the heading
        // hierarchy; Syne is what gives the prototype its "premium
        // datum" feel.
        className={
          mobileCompact
            ? `font-syne relative text-[16px] leading-none font-extrabold tracking-[-0.02em] tabular-nums ${dense ? "md:text-[20px]" : "md:text-[22px]"}`
            : `font-syne relative leading-none font-extrabold tracking-[-0.02em] tabular-nums ${dense ? "text-[20px]" : "text-[22px]"}`
        }
        style={{ color: valueColor(variant) }}
      >
        {value}
      </span>
      {sub ? (
        <span
          className={`relative ${dense ? "text-[11px]" : "text-[12px]"}`}
          style={{ color: "rgb(var(--fg-muted))" }}
        >
          {sub}
        </span>
      ) : null}
    </div>
  );
}
