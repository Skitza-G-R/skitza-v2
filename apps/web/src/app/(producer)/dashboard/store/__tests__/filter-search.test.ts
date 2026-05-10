import { describe, expect, it } from "vitest";

import {
  countByFilter,
  filterAndSearch,
  type FilterTab,
  type StoreItem,
} from "../filter-search";

const SAMPLE: StoreItem[] = [
  { id: "a", name: "Album mix", description: "Stems delivered", active: true },
  { id: "b", name: "Beat lease", description: "Single use", active: true },
  { id: "c", name: "Mastering", description: "Loudness pass", active: false },
];

describe("countByFilter", () => {
  it("returns counts for all, live, hidden", () => {
    const c = countByFilter(SAMPLE);
    expect(c.all).toBe(3);
    expect(c.live).toBe(2);
    expect(c.hidden).toBe(1);
  });

  it("returns zeroes on empty input", () => {
    expect(countByFilter([])).toEqual({ all: 0, live: 0, hidden: 0 });
  });
});

describe("filterAndSearch", () => {
  it.each<[FilterTab, string[]]>([
    ["all", ["a", "b", "c"]],
    ["live", ["a", "b"]],
    ["hidden", ["c"]],
  ])("filter %s returns ids %j", (tab, ids) => {
    expect(filterAndSearch(SAMPLE, tab, "").map((s) => s.id)).toEqual(ids);
  });

  it("searches case-insensitively across name", () => {
    expect(filterAndSearch(SAMPLE, "all", "ALBUM").map((s) => s.id)).toEqual([
      "a",
    ]);
  });

  it("searches case-insensitively across description", () => {
    expect(filterAndSearch(SAMPLE, "all", "stems").map((s) => s.id)).toEqual([
      "a",
    ]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterAndSearch(SAMPLE, "all", "no_match")).toEqual([]);
  });
});
