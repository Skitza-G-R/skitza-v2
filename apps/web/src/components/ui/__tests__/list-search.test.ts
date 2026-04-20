import { describe, expect, it } from "vitest";

import { listSearchMatches } from "../list-search";

describe("listSearchMatches", () => {
  it("matches everything when the query is empty or whitespace", () => {
    expect(listSearchMatches("", ["anything"])).toBe(true);
    expect(listSearchMatches("   ", ["anything"])).toBe(true);
  });

  it("matches case-insensitively on a substring across fields", () => {
    expect(listSearchMatches("ALICE", ["Alice Smith", "producer@mail.com"])).toBe(true);
    expect(listSearchMatches("smith", ["Alice Smith", null])).toBe(true);
    expect(listSearchMatches("mail.com", [null, "producer@mail.com"])).toBe(true);
  });

  it("requires every whitespace-separated token to match some field", () => {
    const fields: readonly (string | null)[] = ["Mix Revision", "Alice Records", null];
    // Both tokens present across different fields → still a match.
    expect(listSearchMatches("mix alice", fields)).toBe(true);
    // First token present, second not → no match.
    expect(listSearchMatches("mix charlie", fields)).toBe(false);
  });

  it("ignores null/undefined fields without throwing", () => {
    expect(() => listSearchMatches("foo", [null, undefined, "bar"])).not.toThrow();
    expect(listSearchMatches("bar", [null, undefined, "bar"])).toBe(true);
  });

  it("returns false for a non-empty query when no field contains it", () => {
    expect(listSearchMatches("zulu", ["alpha", "bravo"])).toBe(false);
  });
});
