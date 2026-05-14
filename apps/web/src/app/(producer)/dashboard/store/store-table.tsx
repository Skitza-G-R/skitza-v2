// store-table.tsx
//
// Table view of the catalog. Owns the wrap, header strip, and group
// dividers (LIVE / HIDDEN). Rows are <ProductRow>; drag-to-reorder
// is NOT wired in the table view (it's a cards-mode affordance only,
// because the table row already uses click-anywhere-to-edit and a
// drag handle would compete with that gesture).

"use client";

import { ProductRow } from "./product-row";
import type { StoreProduct } from "./store-screen";

interface StoreTableProps {
  live: StoreProduct[];
  hidden: StoreProduct[];
  pending?: boolean;
  showHiddenGroup: boolean;
  onOpen: (p: StoreProduct) => void;
  onToggleVisible: (p: StoreProduct) => void;
  onEdit: (p: StoreProduct) => void;
  onDelete: (p: StoreProduct) => void;
}

const GRID = "minmax(0,1fr) 140px 110px 80px 130px";

export function StoreTable({
  live,
  hidden,
  pending = false,
  showHiddenGroup,
  onOpen,
  onToggleVisible,
  onEdit,
  onDelete,
}: StoreTableProps) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[0_1px_2px_rgba(17,16,9,0.03)]">
      {/* Header strip */}
      <div
        className="grid gap-[14px] border-b border-[rgb(var(--border-subtle))] bg-[rgb(17_16_9/0.025)] px-[18px] py-[11px]"
        style={{ gridTemplateColumns: GRID }}
      >
        {["NAME", "TYPE", "PRICE", "STATUS", "ACTIONS"].map((col, idx) => (
          <span
            key={col}
            className={[
              "font-display text-[10.5px] font-bold uppercase tracking-[0.08em] text-[rgb(var(--fg-muted))]",
              idx === 4 ? "text-right" : "",
            ].join(" ")}
          >
            {col}
          </span>
        ))}
      </div>

      {/* LIVE group */}
      {live.length > 0 ? (
        <>
          <div className="border-t border-[rgb(var(--border-subtle))] bg-[rgb(17_16_9/0.015)] px-[18px] pt-[10px] pb-[6px] font-display text-[10px] font-bold uppercase tracking-[0.1em] text-[rgb(var(--fg-muted))]">
            LIVE
          </div>
          {live.map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              pending={pending}
              onOpen={() => {
                onOpen(p);
              }}
              onToggleVisible={() => {
                onToggleVisible(p);
              }}
              onEdit={() => {
                onEdit(p);
              }}
              onDelete={() => {
                onDelete(p);
              }}
            />
          ))}
        </>
      ) : null}

      {/* HIDDEN group */}
      {showHiddenGroup && hidden.length > 0 ? (
        <>
          <div className="border-t border-[rgb(var(--border-subtle))] bg-[rgb(17_16_9/0.015)] px-[18px] pt-[10px] pb-[6px] font-display text-[10px] font-bold uppercase tracking-[0.1em] text-[rgb(var(--fg-muted))]">
            HIDDEN · {hidden.length}
          </div>
          {hidden.map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              pending={pending}
              onOpen={() => {
                onOpen(p);
              }}
              onToggleVisible={() => {
                onToggleVisible(p);
              }}
              onEdit={() => {
                onEdit(p);
              }}
              onDelete={() => {
                onDelete(p);
              }}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}
