"use client";

export type StoreSurface = "products" | "offers";

interface StoreSurfaceTabsProps {
  value: StoreSurface;
  onChange: (surface: StoreSurface) => void;
  productCount: number;
  offerCount: number;
}

const SURFACES: readonly {
  value: StoreSurface;
  label: string;
  tabId: string;
  panelId: string;
}[] = [
  {
    value: "products",
    label: "Products",
    tabId: "store-products-tab",
    panelId: "store-products-panel",
  },
  {
    value: "offers",
    label: "Private offers",
    tabId: "store-offers-tab",
    panelId: "store-offers-panel",
  },
];

export function StoreSurfaceTabs({
  value,
  onChange,
  productCount,
  offerCount,
}: StoreSurfaceTabsProps) {
  function moveFocus(current: StoreSurface, direction: -1 | 1) {
    const currentIndex = SURFACES.findIndex((surface) => surface.value === current);
    const nextIndex = (currentIndex + direction + SURFACES.length) % SURFACES.length;
    const nextSurface = SURFACES[nextIndex];
    if (!nextSurface) return;
    onChange(nextSurface.value);
    window.requestAnimationFrame(() => {
      document.getElementById(nextSurface.tabId)?.focus();
    });
  }

  return (
    <div
      role="tablist"
      aria-label="Store workspace"
      className="grid w-full grid-cols-2 gap-1 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-1 sm:inline-grid sm:w-auto sm:min-w-[340px]"
    >
      {SURFACES.map((surface) => {
        const selected = surface.value === value;
        const count = surface.value === "products" ? productCount : offerCount;

        return (
          <button
            key={surface.value}
            id={surface.tabId}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={surface.panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(surface.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                moveFocus(surface.value, -1);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                moveFocus(surface.value, 1);
              }
            }}
            className={[
              "sk-press relative inline-flex min-h-[44px] min-w-0 items-center justify-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-[13px] font-semibold transition-[background-color,color,box-shadow]",
              selected
                ? "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] shadow-[0_1px_2px_rgb(17_16_9/0.08),0_7px_18px_-14px_rgb(17_16_9/0.5)]"
                : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
            ].join(" ")}
          >
            <span className="truncate">{surface.label}</span>
            <span
              aria-label={`${String(count)} ${surface.label.toLowerCase()}`}
              className={[
                "inline-flex min-w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums",
                selected
                  ? "bg-[rgb(var(--brand-primary)/0.18)] text-[rgb(var(--brand-primary-text))]"
                  : "bg-[rgb(var(--fg-muted)/0.1)] text-[rgb(var(--fg-muted))]",
              ].join(" ")}
            >
              {count}
            </span>
            {selected ? (
              <span
                aria-hidden
                className="absolute inset-x-4 -bottom-1 h-0.5 rounded-full bg-[rgb(var(--brand-primary))]"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
