import type { ReactNode } from "react";

// Uniform stat tile used across the new hero surfaces. Label sits as
// an uppercase eyebrow above a large value. Optional `sub` renders a
// muted line below the value. Variants tint the value color:
//   - default: fg-default (neutral)
//   - danger:  fg-danger (rose) — for overdue / outstanding
//   - ok:      fg-success (green) — for healthy / paid

export type StatTileVariant = "default" | "danger" | "ok";

interface StatTileProps {
  label: string;
  value: ReactNode;
  variant?: StatTileVariant;
  sub?: ReactNode;
}

function valueColor(variant: StatTileVariant): string {
  if (variant === "danger") return "rgb(var(--fg-danger))";
  if (variant === "ok") return "rgb(var(--fg-success))";
  return "rgb(var(--fg-default))";
}

export function StatTile({
  label,
  value,
  variant = "default",
  sub,
}: StatTileProps) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border px-4 py-3"
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-subtle))",
      }}
    >
      <span
        className="text-[10px] font-bold uppercase tracking-widest"
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
        className="font-syne text-[22px] font-extrabold leading-none tracking-[-0.02em] tabular-nums"
        style={{ color: valueColor(variant) }}
      >
        {value}
      </span>
      {sub ? (
        <span
          className="text-[12px]"
          style={{ color: "rgb(var(--fg-muted))" }}
        >
          {sub}
        </span>
      ) : null}
    </div>
  );
}
