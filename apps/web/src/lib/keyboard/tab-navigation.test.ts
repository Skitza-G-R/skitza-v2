import { describe, expect, it } from "vitest";

import { nextTabIndex } from "./tab-navigation";

describe("nextTabIndex", () => {
  it("wraps horizontal arrows and supports Home and End", () => {
    expect(nextTabIndex(2, 3, "ArrowRight")).toBe(0);
    expect(nextTabIndex(0, 3, "ArrowLeft")).toBe(2);
    expect(nextTabIndex(2, 3, "Home")).toBe(0);
    expect(nextTabIndex(0, 3, "End")).toBe(2);
  });

  it("ignores unrelated keys and empty tab lists", () => {
    expect(nextTabIndex(0, 3, "Enter")).toBeNull();
    expect(nextTabIndex(0, 0, "ArrowRight")).toBeNull();
  });
});
