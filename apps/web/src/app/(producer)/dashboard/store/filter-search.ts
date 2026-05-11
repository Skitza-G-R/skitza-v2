// filter-search.ts
//
// Pure helpers driving the toolbar's filter tabs and the search input.
// Decoupled from React so they're testable without rendering and reused
// in Phase 3's table view.

export type FilterTab = "all" | "live" | "hidden";

export interface StoreItem {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}

export interface FilterCounts {
  all: number;
  live: number;
  hidden: number;
}

export function countByFilter(items: StoreItem[]): FilterCounts {
  let live = 0;
  for (const it of items) if (it.active) live += 1;
  return { all: items.length, live, hidden: items.length - live };
}

export function filterAndSearch<T extends StoreItem>(
  items: T[],
  tab: FilterTab,
  search: string,
): T[] {
  const q = search.trim().toLowerCase();
  return items.filter((it) => {
    if (tab === "live" && !it.active) return false;
    if (tab === "hidden" && it.active) return false;
    if (q.length === 0) return true;
    if (it.name.toLowerCase().includes(q)) return true;
    if ((it.description ?? "").toLowerCase().includes(q)) return true;
    return false;
  });
}
