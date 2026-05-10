import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "store-toolbar.tsx"), "utf8");

describe("StoreToolbar shell", () => {
  it("composes SegmentedTabs, ViewToggle, SearchInput", () => {
    expect(SRC).toMatch(/SegmentedTabs/);
    expect(SRC).toMatch(/ViewToggle/);
    expect(SRC).toMatch(/SearchInput/);
  });

  it("uses the FilterTab and ViewMode types from the helpers", () => {
    expect(SRC).toMatch(/FilterTab/);
    expect(SRC).toMatch(/ViewMode/);
  });
});
