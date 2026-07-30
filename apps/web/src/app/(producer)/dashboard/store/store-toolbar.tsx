"use client";

import { ArrowUpDown, Check } from "lucide-react";
import { forwardRef } from "react";

import type { FilterCounts, FilterTab } from "./filter-search";
import { SearchInput } from "./search-input";
import { SegmentedTabs } from "./segmented-tabs";

interface StoreToolbarProps {
  filter: FilterTab;
  onFilterChange: (next: FilterTab) => void;
  counts: FilterCounts;
  totalCount: number;
  search: string;
  onSearchChange: (next: string) => void;
  reordering: boolean;
  onReorderingChange: (next: boolean) => void;
}

export const StoreToolbar = forwardRef<HTMLInputElement, StoreToolbarProps>(function StoreToolbar(
  {
    filter,
    onFilterChange,
    counts,
    totalCount,
    search,
    onSearchChange,
    reordering,
    onReorderingChange,
  },
  searchRef,
) {
  const showSearch = totalCount >= 8 || search.length > 0;

  if (reordering) {
    return (
      <div className="mb-4 flex min-h-[52px] items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.34)] bg-[rgb(var(--brand-primary)/0.09)] px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary)/0.17)] text-[rgb(var(--brand-primary-dark))]"
          >
            <ArrowUpDown size={15} strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-[rgb(var(--fg-default))]">
              Reorder products
            </p>
            <p className="truncate text-[11px] text-[rgb(var(--fg-muted))]">
              The first live product is Featured.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onReorderingChange(false);
          }}
          className="sk-press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-3.5 text-[12.5px] font-semibold text-[rgb(var(--bg-elevated))] lg:h-9 lg:rounded-[var(--radius-md)]"
        >
          <Check aria-hidden size={14} strokeWidth={2.4} />
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <SegmentedTabs<FilterTab>
        ariaLabel="Filter products"
        value={filter}
        onChange={onFilterChange}
        items={[
          { value: "all", label: "All", count: counts.all },
          { value: "live", label: "Live", count: counts.live },
          { value: "hidden", label: "Hidden", count: counts.hidden },
        ]}
      />
      {showSearch || totalCount > 1 ? (
        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
          {showSearch ? (
            <div className="flex min-w-0 flex-1 items-center sm:flex-none">
              <SearchInput ref={searchRef} value={search} onChange={onSearchChange} />
            </div>
          ) : null}
          {totalCount > 1 ? (
            <button
              type="button"
              onClick={() => {
                onReorderingChange(true);
              }}
              className="sk-press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[12.5px] font-semibold text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))] lg:h-9 lg:rounded-[var(--radius-md)]"
            >
              <ArrowUpDown aria-hidden size={14} strokeWidth={2.1} />
              Reorder
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
