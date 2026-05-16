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
}: StatTileProps) {
  const glowBg = glowGradient(glow);
  return (
    <div
      className="relative flex flex-col gap-1.5 overflow-hidden rounded-[var(--radius-md)] border px-5 py-4"
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
        className="relative text-[10px] font-bold uppercase tracking-widest"
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
        className="relative font-syne text-[22px] font-extrabold leading-none tracking-[-0.02em] tabular-nums"
        style={{ color: valueColor(variant) }}
      >
        {value}
      </span>
      {sub ? (
        <span
          className="relative text-[12px]"
          style={{ color: "rgb(var(--fg-muted))" }}
        >
          {sub}
        </span>
      ) : null}
    </div>
  );
}
