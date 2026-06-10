// product-card.tsx
//
// Single-row catalog card. Composition: drag handle, type tile, name +
// tagline, price, visibility toggle, edit, delete. Whole-card click
// opens the editor; the action area is wrapped in `.no-card-click-block`
// so its clicks don't bubble. Drag is visual-only in Phase 1
// (re-ordering wires up in Phase 3).

"use client";

import { GripVertical, Pencil, Trash2 } from "lucide-react";

import { formatMoney } from "~/lib/format/money";
import { applyTaxToCents, type TaxMode } from "~/lib/tax-mode";
import { kindToTile } from "./kind-to-tile";
import { TILE_THEME } from "./tile-theme";
import { Toggle } from "./toggle";
import { TypeTile } from "./type-tile";
import type { DragRowHandlers } from "./use-drag-reorder";

export interface ProductCardData {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  active: boolean;
  kind: string;
}

interface ProductCardProps {
  product: ProductCardData;
  pending?: boolean;
  drag?: DragRowHandlers;
  recentlyAdded?: boolean;
  // Producer's business-level tax mode + rate (migration 0019). The
  // card displays the price WITH tax applied for `tax_added` so the
  // producer sees the same number the artist will see at checkout,
  // not the pre-tax base. A small caption underneath the price spells
  // out which mode is active: "Tax-free", "Tax inc", or "Tax inc" with
  // the +rate amount baked into the headline number for tax_added.
  taxMode: TaxMode;
  taxRatePct: number;
  onOpen: () => void;
  onToggleVisible: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

// Short caption shown under the price on the catalog row. Mirrors the
// artist-facing footnote on /artist/store but trimmed for density —
// the producer already knows their rate, so we skip the percent here.
function taxCardCaption(mode: TaxMode): string | null {
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
  const first = description.split("\n")[0]?.trim() ?? "";
  return first;
}

export function ProductCard({
  product,
  pending = false,
  drag,
  recentlyAdded = false,
  taxMode,
  taxRatePct,
  onOpen,
  onToggleVisible,
  onEdit,
  onDelete,
}: ProductCardProps) {
  const tile = kindToTile(product.kind);
  const accent = TILE_THEME[tile].accent;
  const tagline = deriveTagline(product.description);
  // Headline price = post-tax for tax_added, base price otherwise.
  // applyTaxToCents is a no-op for tax_free / tax_included so the
  // helper handles all three modes uniformly.
  const displayCents = applyTaxToCents(product.priceCents, taxMode, taxRatePct);
  const taxCaption = taxCardCaption(taxMode);

  return (
    <article
      role="button"
      tabIndex={0}
      draggable={!!drag}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDragEnd={drag?.onDragEnd}
      onDrop={drag?.onDrop}
      className={[
        "group relative grid items-center rounded-[14px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5 transition-[border-color,transform,box-shadow] duration-200",
        // Mobile (<sm): 2-row layout — tile + name + price on top,
        // action cluster on its own row. Desktop (sm+): the original
        // single-row 5-column grid (grip restored).
        "grid-cols-[60px_minmax(0,1fr)_auto] gap-x-3 gap-y-3",
        "sm:grid-cols-[20px_60px_minmax(0,1fr)_auto_auto] sm:gap-x-3.5 sm:gap-y-0",
        "hover:border-[rgb(var(--border-strong))] hover:-translate-y-px hover:shadow-[0_14px_36px_-22px_rgba(17,16,9,0.28),0_2px_8px_-3px_rgba(17,16,9,0.05)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2",
        product.active ? "" : "opacity-60",
        drag?.isDragging ? "opacity-40 scale-[0.98]" : "",
        recentlyAdded ? "sk-shimmer-glow" : "",
      ].join(" ")}
    >
      {/* Hover accent stripe in tile color */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{ background: accent }}
      />

      {/* Drop indicator: 3px brand-color line above or below the row */}
      {drag?.dropPosition === "above" ? (
        <span
          aria-hidden
          className="sk-drop-fade pointer-events-none absolute -top-[2px] left-2 right-2 h-[3px] rounded-full"
          style={{ background: "rgb(var(--brand-primary))" }}
        />
      ) : null}
      {drag?.dropPosition === "below" ? (
        <span
          aria-hidden
          className="sk-drop-fade pointer-events-none absolute -bottom-[2px] left-2 right-2 h-[3px] rounded-full"
          style={{ background: "rgb(var(--brand-primary))" }}
        />
      ) : null}

      {/* Grip hidden on mobile — HTML5 drag doesn't fire on touch. */}
      <span
        aria-hidden
        className="sk-drag-handle hidden text-[rgb(var(--fg-muted))] opacity-30 transition-opacity group-hover:opacity-100 sm:block"
        style={{ cursor: drag ? "grab" : "default" }}
      >
        <GripVertical size={16} strokeWidth={2.1} />
      </span>

      <TypeTile type={tile} hidden={!product.active} />

      <div className="min-w-0">
        <p className="truncate font-display text-[17px] font-bold leading-tight tracking-[-0.02em] text-[rgb(var(--fg-default))]">
          {product.name || <span className="italic text-[rgb(var(--fg-faint))]">Untitled</span>}
        </p>
        <p className="mt-0.5 truncate text-[12.5px] leading-[1.45] text-[rgb(var(--fg-muted))]">
          {tagline || <span className="italic text-[rgb(var(--fg-faint))]">No tagline yet</span>}
        </p>
      </div>

      <div className="shrink-0 flex flex-col items-end gap-0.5">
        <p className="text-right font-display text-[20px] font-extrabold leading-none tracking-[-0.02em] text-[rgb(var(--fg-default))] tabular-nums sm:text-[26px]">
          {formatMoney(displayCents, product.currency)}
        </p>
        {taxCaption ? (
          <span
            className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--fg-faint))]"
            aria-label={taxCaption}
          >
            {taxCaption}
          </span>
        ) : null}
      </div>

      <div
        className="no-card-click-block col-span-3 flex items-center justify-end gap-2.5 border-t border-[rgb(var(--border-subtle))] pt-3 sm:col-span-1 sm:border-t-0 sm:pt-0"
        onClick={(e) => {
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
        }}
      >
        {product.active ? (
          <span
            aria-hidden
            className="sk-live-pulse inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "rgb(var(--fg-success))" }}
          />
        ) : null}
        <Toggle
          on={product.active}
          onChange={onToggleVisible}
          ariaLabel={product.active ? `Hide ${product.name}` : `Make ${product.name} live`}
          disabled={pending}
        />
        <button
          type="button"
          onClick={onEdit}
          className="sk-press inline-flex min-h-[44px] items-center gap-1 rounded-[8px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-2.5 text-[12px] font-semibold text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))] sm:min-h-0 sm:px-2.5 sm:py-1.5"
        >
          <Pencil size={12} strokeWidth={2.2} /> Edit
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${product.name}`}
          className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] sm:h-[34px] sm:w-[34px]"
        >
          <Trash2 size={14} strokeWidth={2.1} />
        </button>
      </div>
    </article>
  );
}
