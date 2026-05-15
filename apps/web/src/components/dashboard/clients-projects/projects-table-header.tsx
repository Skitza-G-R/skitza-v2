"use client";

import { ArrowUpDown } from "lucide-react";

import type { SortValue } from "./sort-value";

// Sortable column header for the Projects table mode (G18). Mirrors
// ProjectRow's 8-column grid so each header cell sits over its
// matching row column. Clicking a sortable column sets the parent's
// sort state to that column's value; non-sortable columns render as
// plain labels.
//
// DESIGN.md §4.1 calls out the layout switcher as available on both
// tabs — this is the table half of that pair. The cards half stays
// as the existing vertical ProjectRow stack.

interface ProjectsTableHeaderProps {
  sort: SortValue;
  onSortChange: (next: SortValue) => void;
}

interface ColumnSpec {
  label: string;
  /** Sort value this column drives; undefined = non-sortable. */
  sortKey?: SortValue;
  /** Right-align numeric / date columns to match ProjectRow's layout. */
  align?: "left" | "right";
}

// Column lineup matches ProjectRow's grid order:
//   24px(grip) 44px(badge) 1.6fr(title) 1fr(client) 120px(progress)
//   100px(balance) 110px(deadline) 36px(chevron)
const COLUMNS: ColumnSpec[] = [
  { label: "" }, // grip
  { label: "" }, // badge
  { label: "Project", sortKey: "name", align: "left" },
  { label: "Client", align: "left" },
  { label: "Progress", sortKey: "progress", align: "left" },
  { label: "Balance", sortKey: "balance", align: "right" },
  { label: "Deadline", sortKey: "deadline", align: "right" },
  { label: "" }, // chevron
];

export function ProjectsTableHeader({
  sort,
  onSortChange,
}: ProjectsTableHeaderProps) {
  return (
    <div
      role="row"
      className="grid items-center gap-3 border-b px-3 py-2"
      style={{
        gridTemplateColumns:
          "24px 44px minmax(0,1.6fr) minmax(0,1fr) 120px 100px 110px 36px",
        borderBottomColor: "rgb(var(--border-subtle))",
      }}
    >
      {COLUMNS.map((col, i) => {
        const isSortable = col.sortKey !== undefined;
        const isActive = isSortable && sort === col.sortKey;
        const alignClass = col.align === "right" ? "text-right" : "text-left";
        const content = (
          <span
            className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] ${alignClass}`}
            style={{
              color: isActive
                ? "rgb(var(--fg-default))"
                : "rgb(var(--fg-muted))",
            }}
          >
            {col.label}
            {isSortable ? (
              <ArrowUpDown
                size={10}
                strokeWidth={2.2}
                aria-hidden
                style={{ opacity: isActive ? 1 : 0.45 }}
              />
            ) : null}
          </span>
        );
        return (
          <div key={`col-${String(i)}`} className={`min-w-0 ${alignClass}`}>
            {isSortable && col.sortKey ? (
              <button
                type="button"
                onClick={() => {
                  if (col.sortKey) onSortChange(col.sortKey);
                }}
                aria-sort={isActive ? "ascending" : "none"}
                className="inline-flex w-full items-center gap-1 hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.4)]"
                style={{
                  justifyContent: col.align === "right" ? "flex-end" : "flex-start",
                }}
              >
                {content}
              </button>
            ) : (
              content
            )}
          </div>
        );
      })}
    </div>
  );
}
