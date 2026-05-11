// store-toolbar.tsx
//
// Single toolbar row: filter tabs on the left, view-toggle + search on
// the right. Layout drops to wrap on narrow viewports.

"use client";

import { forwardRef } from "react";

import type { FilterCounts, FilterTab } from "./filter-search";
import { SearchInput } from "./search-input";
import { SegmentedTabs } from "./segmented-tabs";
import { ViewToggle, type ViewMode } from "./view-toggle";

interface StoreToolbarProps {
  filter: FilterTab;
  onFilterChange: (next: FilterTab) => void;
  counts: FilterCounts;
  view: ViewMode;
  onViewChange: (next: ViewMode) => void;
  search: string;
  onSearchChange: (next: string) => void;
  /** When true, the Table option in <ViewToggle> renders interactive (Phase 3). */
  enableTable?: boolean;
}

export const StoreToolbar = forwardRef<HTMLInputElement, StoreToolbarProps>(
  function StoreToolbar(
    {
      filter,
      onFilterChange,
      counts,
      view,
      onViewChange,
      search,
      onSearchChange,
      enableTable = false,
    },
    searchRef,
  ) {
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
        <div className="flex items-center gap-3">
          <ViewToggle value={view} onChange={onViewChange} enableTable={enableTable} />
          <SearchInput ref={searchRef} value={search} onChange={onSearchChange} />
        </div>
      </div>
    );
  },
);
