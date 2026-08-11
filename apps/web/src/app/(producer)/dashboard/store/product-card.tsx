// product-card.tsx
//
// Single-row catalog card. Composition: type tile, title + short description,
// price, accessible ordering controls, visibility toggle, edit, and
// lifecycle-aware removal. The article itself is deliberately not a
// button: every action has one explicit, keyboard-focusable control.

"use client";

import { Archive, ChevronDown, ChevronUp, Pencil, Send, Trash2 } from "lucide-react";
import type { Ref } from "react";

import { formatMoney } from "~/lib/format/money";
import { applyTaxToCents, type TaxMode } from "~/lib/tax-mode";
import { kindToTile } from "./kind-to-tile";
import { TILE_THEME } from "./tile-theme";
import { Toggle } from "./toggle";
import { TypeTile } from "./type-tile";
import type { ProductRemovalAction } from "./product-removal-modal";

export interface ProductCardData {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  active: boolean;
  kind: string;
  /** Server-owned decision; absent means the UI safely offers Archive. */
  removalAction?: ProductRemovalAction;
}

interface ProductCardProps {
  product: ProductCardData;
  pending?: boolean;
  recentlyAdded?: boolean;
  featured?: boolean;
  reordering?: boolean;
  reorderPosition?: number;
  reorderTotal?: number;
  focusRef?: Ref<HTMLElement> | undefined;
  // Producer's business-level tax mode + rate (migration 0019). The
  // card displays the price WITH tax applied for `tax_added` so the
  // producer sees the same total the artist will see,
  // not the pre-tax base. A small caption underneath the price spells
  // out which mode is active: "Tax-free", "Tax inc", or "Tax inc" with
  // the +rate amount baked into the headline number for tax_added.
  taxMode: TaxMode;
  taxRatePct: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleVisible: () => void;
  onSendPrivately: () => void;
  onEdit: () => void;
  onRemove: () => void;
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

function deriveShortDescription(description: string | null): string {
  if (!description) return "";
  const first = description.split("\n")[0]?.trim() ?? "";
  return first;
}

export function ProductCard({
  product,
  pending = false,
  recentlyAdded = false,
  featured = false,
  reordering = false,
  reorderPosition = 1,
  reorderTotal = 1,
  focusRef,
  taxMode,
  taxRatePct,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onToggleVisible,
  onSendPrivately,
  onEdit,
  onRemove,
}: ProductCardProps) {
  const tile = kindToTile(product.kind);
  const accent = TILE_THEME[tile].accent;
  const shortDescription = deriveShortDescription(product.description);
  // Headline price = post-tax for tax_added, base price otherwise.
  // applyTaxToCents is a no-op for tax_free / tax_included so the
  // helper handles all three modes uniformly.
  const displayCents = applyTaxToCents(product.priceCents, taxMode, taxRatePct);
  const taxCaption = taxCardCaption(taxMode);
  const removalAction = product.removalAction ?? "archive";
  const RemovalIcon = removalAction === "delete" ? Trash2 : Archive;
  const removalLabel = removalAction === "delete" ? "Delete" : "Archive";

  return (
    <article
      ref={focusRef}
      data-product-id={product.id}
      tabIndex={recentlyAdded ? -1 : undefined}
      className={[
        "group relative grid items-center rounded-[14px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5 transition-[border-color,transform,box-shadow] duration-200",
        // Mobile (<sm): tile + full-width name on top, price line
        // beneath it (SK-57 — a side-by-side price column left the
        // name ~124px and chopped it to "Full produ…"), action
        // cluster on its own row. Desktop (sm+): the original
        // single-row 4-column grid.
        "grid-cols-[60px_minmax(0,1fr)] gap-x-3 gap-y-2.5",
        "sm:grid-cols-[60px_minmax(0,1fr)_auto_auto] sm:gap-x-3.5 sm:gap-y-0",
        "hover:-translate-y-px hover:border-[rgb(var(--border-strong))] hover:shadow-[0_14px_36px_-22px_rgba(17,16,9,0.28),0_2px_8px_-3px_rgba(17,16,9,0.05)]",
        recentlyAdded ? "sk-shimmer-glow" : "",
      ].join(" ")}
    >
      {/* Hover accent stripe in tile color */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{ background: accent }}
      />

      <TypeTile type={tile} hidden={!product.active} />

      <div className={`min-w-0 ${product.active ? "" : "opacity-60"}`}>
        {/* SK-57: phones let the name wrap to two lines — the price
            column squeezed it to ~166px and "Full production day"
            rendered as "Full produ…". sm+ keeps the single ellipsis
            line (line-clamp-1 === truncate visually). */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <p className="font-display line-clamp-2 min-w-0 text-[16px] leading-tight font-bold tracking-[-0.02em] text-[rgb(var(--fg-default))] sm:line-clamp-1 sm:text-[17px]">
            {product.name || (
              <span className="text-[rgb(var(--fg-faint))] italic">Untitled</span>
            )}
          </p>
          {featured ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary)/0.15)] px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.12em] text-[rgb(var(--brand-primary-text))] uppercase">
              <span
                aria-hidden
                className="h-1 w-1 rounded-full bg-[rgb(var(--brand-primary))]"
              />
              Featured
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-[12.5px] leading-[1.45] text-[rgb(var(--fg-muted))]">
          {shortDescription || (
            <span className="text-[rgb(var(--fg-faint))] italic">
              No short description yet
            </span>
          )}
        </p>
      </div>

      <div
        className={`col-start-2 row-start-2 flex shrink-0 flex-row items-baseline gap-2 sm:col-auto sm:row-auto sm:flex-col sm:items-end sm:gap-0.5 ${
          product.active ? "" : "opacity-60"
        }`}
      >
        <p className="font-display text-left text-[17px] leading-none font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))] tabular-nums sm:text-right sm:text-[26px]">
          {formatMoney(displayCents, product.currency)}
        </p>
        {taxCaption ? (
          <span
            className="font-mono text-[9.5px] font-semibold tracking-[0.14em] text-[rgb(var(--fg-faint))] uppercase"
            aria-label={taxCaption}
          >
            {taxCaption}
          </span>
        ) : null}
      </div>

      <div className="col-span-2 flex flex-wrap items-center justify-end gap-1 border-t border-[rgb(var(--border-subtle))] pt-3 sm:col-span-1 sm:gap-2 sm:border-t-0 sm:pt-0">
        {reordering ? (
          <>
            <span
              aria-label={`Position ${String(reorderPosition)} of ${String(reorderTotal)} ${product.active ? "live" : "hidden"} products`}
              className="mr-auto font-mono text-[11px] font-semibold tracking-[0.08em] text-[rgb(var(--fg-muted))] tabular-nums lg:mr-1"
            >
              {String(reorderPosition).padStart(2, "0")} /{" "}
              {String(reorderTotal).padStart(2, "0")}
            </span>
            <button
              type="button"
              onClick={onMoveUp}
              disabled={pending || !canMoveUp}
              aria-label={`Move ${product.name} up`}
              title="Move product up"
              className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))] disabled:cursor-not-allowed disabled:opacity-30 lg:h-9 lg:w-9 lg:rounded-[var(--radius-md)]"
            >
              <ChevronUp size={16} strokeWidth={2.3} />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={pending || !canMoveDown}
              aria-label={`Move ${product.name} down`}
              title="Move product down"
              className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))] disabled:cursor-not-allowed disabled:opacity-30 lg:h-9 lg:w-9 lg:rounded-[var(--radius-md)]"
            >
              <ChevronDown size={16} strokeWidth={2.3} />
            </button>
          </>
        ) : (
          <>
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
              onClick={onSendPrivately}
              disabled={pending}
              aria-label={`Send ${product.name} privately`}
              className="sk-press inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.34)] bg-[rgb(var(--brand-primary)/0.08)] px-3 text-[12px] font-semibold text-[rgb(var(--brand-primary-text))] transition-[border-color,background-color] hover:border-[rgb(var(--brand-primary)/0.6)] hover:bg-[rgb(var(--brand-primary)/0.13)] disabled:cursor-not-allowed disabled:opacity-50 sm:h-[34px] sm:rounded-[var(--radius-md)]"
            >
              <Send size={12} strokeWidth={2.2} aria-hidden />
              <span>Send privately</span>
            </button>
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${product.name}`}
              className="sk-press inline-flex h-11 w-11 items-center justify-center gap-1 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[12px] font-semibold text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))] sm:h-[34px] sm:w-auto sm:rounded-[var(--radius-md)] sm:px-2.5"
            >
              <Pencil size={12} strokeWidth={2.2} />
              <span className="sr-only sm:not-sr-only">Edit</span>
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`${removalLabel} ${product.name}`}
              title={`${removalLabel} product`}
              className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] sm:h-[34px] sm:w-[34px]"
            >
              <RemovalIcon size={14} strokeWidth={2.1} />
            </button>
          </>
        )}
      </div>
    </article>
  );
}
