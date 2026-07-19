// store-toolbar.tsx
//
// Single toolbar row: filter tabs on the left, search on the right.
// Layout drops to wrap on narrow viewports.

"use client";

import { forwardRef } from "react";

import type { FilterCounts, FilterTab } from "./filter-search";
import { SearchInput } from "./search-input";
import { SegmentedTabs } from "./segmented-tabs";

interface StoreToolbarProps {
  filter: FilterTab;
  onFilterChange: (next: FilterTab) => void;
  counts: FilterCounts;
  search: string;
  onSearchChange: (next: string) => void;
}

export const StoreToolbar = forwardRef<HTMLInputElement, StoreToolbarProps>(function StoreToolbar(
  { filter, onFilterChange, counts, search, onSearchChange },
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
      {/* Full-width on mobile so the search field can grow; auto on sm+. */}
      <div className="flex w-full items-center sm:w-auto">
        <SearchInput ref={searchRef} value={search} onChange={onSearchChange} />
      </div>
    </div>
  );
});
