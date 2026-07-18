import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "store-toolbar.tsx"), "utf8");

describe("StoreToolbar shell", () => {
  it("composes SegmentedTabs and SearchInput", () => {
    expect(SRC).toMatch(/SegmentedTabs/);
    expect(SRC).toMatch(/SearchInput/);
  });

  it("uses the FilterTab type from the helper", () => {
    expect(SRC).toMatch(/FilterTab/);
  });

  it("does not expose the removed Store table control", () => {
    expect(SRC).not.toMatch(/ViewToggle|ViewMode|enableTable|Table/);
  });
});
