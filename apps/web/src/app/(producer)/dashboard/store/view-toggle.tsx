// view-toggle.tsx
//
// Cards / Table switcher. Phase 1 disables the Table option (Phase 3
// enables it). The visual still shows both options so producers know
// it's coming.

"use client";

import { LayoutGrid, Rows3 } from "lucide-react";

export type ViewMode = "cards" | "table";

interface ViewToggleProps {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
  /** When true, the Table option renders interactive (Phase 3). */
  enableTable?: boolean;
}

export function ViewToggle({ value, onChange, enableTable = false }: ViewToggleProps) {
  return (
    <div role="group" aria-label="View mode" className="inline-flex rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-0.5">
      <button
        type="button"
        aria-pressed={value === "cards"}
        onClick={() => {
          onChange("cards");
        }}
        className={[
          "sk-press inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[11.5px] font-semibold",
          value === "cards"
            ? "bg-[rgb(var(--bg-base,242_237_230))] text-[rgb(var(--fg-default))]"
            : "text-[rgb(var(--fg-muted))]",
        ].join(" ")}
      >
        <LayoutGrid size={14} strokeWidth={2.1} /> Cards
      </button>
      <button
        type="button"
        aria-pressed={value === "table"}
        aria-disabled={!enableTable}
        disabled={!enableTable}
        title={!enableTable ? "Table view, Coming soon" : undefined}
        onClick={() => {
          if (enableTable) onChange("table");
        }}
        className={[
          "sk-press inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[11.5px] font-semibold",
          value === "table" && enableTable
            ? "bg-[rgb(var(--bg-base,242_237_230))] text-[rgb(var(--fg-default))]"
            : "text-[rgb(var(--fg-muted))]",
          enableTable ? "" : "cursor-not-allowed opacity-60",
        ].join(" ")}
      >
        <Rows3 size={14} strokeWidth={2.1} /> Table
      </button>
    </div>
  );
}
