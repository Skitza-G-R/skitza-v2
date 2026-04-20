import { describe, expect, it } from "vitest";

import { normalizeTags } from "./tag-editor";

// Pure-logic test for the tag deduplication helper — deliberate sibling
// of the client-contacts.setTags server normalizer. Keeping the two
// in lock-step means a producer who types the same tag twice on the
// client (once with shift, once without) won't end up with two rows
// in the db.

describe("normalizeTags", () => {
  it("drops empty strings + whitespace-only inputs", () => {
    expect(normalizeTags(["", "  ", "vip"])).toEqual(["vip"]);
  });

  it("preserves the first casing when duplicates differ in case", () => {
    expect(normalizeTags(["VIP", "vip", "Vip"])).toEqual(["VIP"]);
  });

  it("trims surrounding whitespace on each tag", () => {
    expect(normalizeTags([" warm-vocals ", "budget-conscious  "])).toEqual([
      "warm-vocals",
      "budget-conscious",
    ]);
  });

  it("keeps order of first appearance across duplicates", () => {
    expect(normalizeTags(["a", "b", "A", "c", "B"])).toEqual(["a", "b", "c"]);
  });

  it("collapses to [] when every tag is blank", () => {
    expect(normalizeTags(["", "  ", "\t"])).toEqual([]);
  });
});
