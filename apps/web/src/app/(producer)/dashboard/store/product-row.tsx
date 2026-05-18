// product-row.tsx
//
// Table-view counterpart to <ProductCard>. 5-column grid matching the
// prototype's table layout. Row click opens the editor; the action
// cluster on the right is wrapped in .no-card-click-block so its
// clicks don't bubble. Type chip is the 32px <TypeTile>; the type
// label is the uppercase tile name colored with the tile accent.
//
// Drag-to-reorder is intentionally NOT wired into the table view —
// it's a cards-mode affordance only, because the table row already
// uses click-anywhere-to-edit.

"use client";

import { Pencil, Trash2 } from "lucide-react";

import { formatMoney } from "~/lib/format/money";
import { applyTaxToCents, type TaxMode } from "~/lib/tax-mode";

import { kindToTile } from "./kind-to-tile";
import type { ProductCardData } from "./product-card";
import { TILE_THEME } from "./tile-theme";
import { Toggle } from "./toggle";
import { TypeTile } from "./type-tile";

interface ProductRowProps {
  product: ProductCardData;
  pending?: boolean;
  // Producer's business-level tax mode + rate (migration 0019). Row
  // displays the price WITH tax applied for `tax_added`; a small
  // caption underneath spells out the mode in 1-2 words.
  taxMode: TaxMode;
  taxRatePct: number;
  onOpen: () => void;
  onToggleVisible: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

// Same caption helper the card uses — kept inline here so the two
// surfaces stay in lockstep without crossing import boundaries for a
// 3-line switch.
function taxRowCaption(mode: TaxMode): string | null {
  switch (mode) {
    case "tax_free":
      return "Tax-free";
    case "tax_included":
    case "tax_added":
      return "Tax inc";
  }
}

function deriveTagline(description: string | null): string {
  if (!description) return "";
  return description.split("\n")[0]?.trim() ?? "";
}

export function ProductRow({
  product,
  pending = false,
  taxMode,
  taxRatePct,
  onOpen,
  onToggleVisible,
  onEdit,
  onDelete,
}: ProductRowProps) {
  const tile = kindToTile(product.kind);
  const accent = TILE_THEME[tile].accent;
  const tagline = deriveTagline(product.description);
  const displayCents = applyTaxToCents(product.priceCents, taxMode, taxRatePct);
  const taxCaption = taxRowCaption(taxMode);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className={[
        "sk-row-in grid cursor-pointer items-center gap-[14px] border-t border-[rgb(var(--border-subtle))] px-[18px] py-3 transition-colors duration-150",
        "hover:bg-[rgb(17_16_9/0.025)]",
        "focus-visible:outline-none focus-visible:bg-[rgb(17_16_9/0.04)]",
        product.active ? "" : "opacity-60",
      ].join(" ")}
      style={{ gridTemplateColumns: "minmax(0,1fr) 140px 110px 80px 130px" }}
    >
      {/* NAME */}
      <div className="flex min-w-0 items-center gap-3">
        <TypeTile type={tile} size={32} hidden={!product.active} />
        <div className="min-w-0">
          <p className="truncate font-display text-[14px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
            {product.name || <span className="italic text-[rgb(var(--fg-faint))]">Untitled</span>}
          </p>
          <p className="mt-0.5 truncate text-[11.5px] leading-tight text-[rgb(var(--fg-muted))]">{tagline}</p>
        </div>
      </div>

      {/* TYPE */}
      <span
        className="truncate text-[11px] font-semibold uppercase tracking-[0.08em]"
        style={{ color: accent }}
      >
        {tile.toUpperCase()}
      </span>

      {/* PRICE */}
      <div className="flex flex-col gap-0.5">
        <span className="font-display text-[16px] font-bold tabular-nums text-[rgb(var(--fg-default))]">
          {formatMoney(displayCents, product.currency)}
        </span>
        {taxCaption ? (
          <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--fg-faint))]">
            {taxCaption}
          </span>
        ) : null}
      </div>

      {/* STATUS */}
      {product.active ? (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[rgb(var(--fg-success))]">
          <span
            aria-hidden
            className="sk-live-pulse inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "rgb(var(--fg-success))" }}
          />
          Live
        </span>
      ) : (
        <span className="text-[11px] font-semibold text-[rgb(var(--fg-muted))]">Hidden</span>
      )}

      {/* ACTIONS */}
      <div
        className="no-card-click-block flex items-center justify-end gap-2"
        onClick={(e) => {
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
        }}
      >
        <Toggle
          on={product.active}
          onChange={onToggleVisible}
          ariaLabel={product.active ? `Hide ${product.name}` : `Make ${product.name} live`}
          disabled={pending}
        />
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${product.name}`}
          className="sk-press inline-flex h-[28px] w-[28px] items-center justify-center rounded-[6px] text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))]"
        >
          <Pencil size={13} strokeWidth={2.1} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${product.name}`}
          className="sk-press inline-flex h-[28px] w-[28px] items-center justify-center rounded-[6px] text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))]"
        >
          <Trash2 size={13} strokeWidth={2.1} />
        </button>
      </div>
    </div>
  );
}
