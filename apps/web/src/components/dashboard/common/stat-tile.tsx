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
        className="text-[22px] font-semibold leading-none tabular-nums"
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
