"use client";

import { ArrowUpDown } from "lucide-react";

import type { SortValue } from "./sort-value";

// Sortable column header for the Clients table mode (G18). Mirrors
// ClientCompactRow's grid so each header cell sits over its row
// counterpart. Reuses the same SortValue contract as the Projects
// header — `name` is the only column that maps directly; the other
// sortable columns (balance) reuse the existing sort dropdown's
// vocabulary so the dropdown and headers stay in sync.

interface ClientsTableHeaderProps {
  sort: SortValue;
  onSortChange: (next: SortValue) => void;
}

interface ColumnSpec {
  label: string;
  sortKey?: SortValue;
  align?: "left" | "right";
}

// Column lineup matches ClientCompactRow's grid:
//   24px(grip) 44px(avatar) minmax(0,1.5fr)(name+email)
//   80px(projects) 110px(lifetime) 110px(owed) 110px(status) 36px(chevron)
const COLUMNS: ColumnSpec[] = [
  { label: "" }, // grip
  { label: "" }, // avatar
  { label: "Client", sortKey: "name", align: "left" },
  { label: "Projects", align: "right" },
  { label: "Lifetime", align: "right" },
  { label: "Owed", sortKey: "balance", align: "right" },
  { label: "Status", align: "left" },
  { label: "" }, // chevron
];

export function ClientsTableHeader({
  sort,
  onSortChange,
}: ClientsTableHeaderProps) {
  return (
    <div
      role="row"
      className="grid items-center gap-3 border-b px-3 py-2"
      style={{
        gridTemplateColumns:
          "24px 44px minmax(0,1.5fr) 80px 110px 110px 110px 36px",
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
