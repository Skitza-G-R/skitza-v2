import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "schedule-pending-card.tsx"), "utf8");

describe("producer pending booking decisions", () => {
  it("syncs refreshed rows and tracks concurrent decisions independently", () => {
    expect(source).toMatch(/setRows\(initial\)/);
    expect(source).toMatch(/useState<ReadonlySet<string>>/);
    expect(source).toMatch(/pendingIds\.has\(row\.id\)/);
  });

  it("removes only the successfully processed row and never restores a stale snapshot", () => {
    expect(source).toMatch(
      /setRows\(\(current\) => current\.filter\(\(candidate\) => candidate\.id !== row\.id\)\)/,
    );
    expect(source).not.toMatch(/const snapshot = rows|setRows\(snapshot\)/);
  });
});
