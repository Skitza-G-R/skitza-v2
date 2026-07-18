"use client";

import { ArrowUpDown } from "lucide-react";

import type { SortValue } from "./sort-value";

// Sortable column header for the Clients table mode. Mockup-match
// against /Volumes/KINGSTON/Downloads/Clients Projects Room.html
// table view — 7 data columns (Client / Email / Link / Projects /
// Lifetime / Owed / Joined) plus the grip + avatar + actions
// utility columns.
//
// Only columns with truthful local semantics are sortable. Currency-
// separated money remains display-only here until the list owns that
// projection. Width units mirror ClientCompactRow's grid.

interface ClientsTableHeaderProps {
  sort: SortValue;
  onSortChange: (next: SortValue) => void;
}

interface ColumnSpec {
  label: string;
  sortKey?: SortValue;
  align?: "left" | "right";
}

// Column lineup (matches ClientCompactRow's grid exactly):
//   24px(grip) 44px(avatar) minmax(0,1.4fr)(client name)
//   minmax(0,1.5fr)(email) 110px(link state)
//   90px(projects) 110px(lifetime) 100px(owed) 110px(joined) 144px(actions)
const COLUMNS: ColumnSpec[] = [
  { label: "" }, // grip
  { label: "" }, // avatar
  { label: "Client", sortKey: "name", align: "left" },
  { label: "Email", align: "left" },
  { label: "Link", align: "left" },
  { label: "Projects", sortKey: "progress", align: "right" },
  { label: "Lifetime", align: "right" },
  { label: "Owed", align: "right" },
  { label: "Joined", sortKey: "joined", align: "left" },
  { label: "Actions", align: "right" },
];

const GRID_TEMPLATE =
  "24px 44px minmax(0,1.4fr) minmax(0,1.5fr) 110px 90px 110px 100px 110px 144px";

// Shared with ClientCompactRow so the header + rows align.
export const CLIENTS_TABLE_GRID = GRID_TEMPLATE;

export function ClientsTableHeader({ sort, onSortChange }: ClientsTableHeaderProps) {
  return (
    <div
      data-testid="clients-table-header"
      // Hidden below xl — the fixed data tracks need real desktop width,
      // especially once the expanded sidebar is taken into account.
      // Smaller screens render ClientCompactRow as a compact card row.
      // 2-line card, so the 10-column header has nothing to align with.
      className="hidden items-center gap-3 border-b px-3 py-2.5 xl:grid"
      style={{
        gridTemplateColumns: GRID_TEMPLATE,
        borderBottomColor: "rgb(var(--border-subtle))",
        background: "rgb(var(--bg-background) / 0.6)",
      }}
    >
      {COLUMNS.map((col, i) => {
        const isSortable = col.sortKey !== undefined;
        const isActive = isSortable && sort === col.sortKey;
        const direction = col.sortKey === "name" ? "ascending" : "descending";
        const alignClass = col.align === "right" ? "text-right" : "text-left";
        const content = (
          <span
            className={`inline-flex items-center gap-1 text-[10px] font-bold tracking-[0.12em] uppercase ${alignClass}`}
            style={{
              color: isActive ? "rgb(var(--fg-default))" : "rgb(var(--fg-muted))",
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
                aria-label={
                  isActive
                    ? `${col.label}, sorted ${direction}`
                    : `Sort by ${col.label}`
                }
                className="inline-flex w-full items-center gap-1 transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.4)] focus-visible:outline-none"
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
