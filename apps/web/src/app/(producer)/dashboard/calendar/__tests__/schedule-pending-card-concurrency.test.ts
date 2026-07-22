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

  it("asks for an explicit second click before rejecting a booking", () => {
    const firstClick = source.indexOf("setDeclineTarget(row)");
    const confirmation = source.indexOf("Decline this booking request?");
    const rejection = source.indexOf('act(target, "reject")');

    expect(firstClick).toBeGreaterThan(-1);
    expect(confirmation).toBeGreaterThan(firstClick);
    expect(rejection).toBeGreaterThan(confirmation);
    expect(source).toContain("Keep request");
    expect(source).toContain("Decline booking");
  });

  it("uses the shared accessible dialog so focus is trapped and restored", () => {
    expect(source).toContain('from "~/components/ui/dialog"');
    expect(source).toContain("<DialogTitle>");
    expect(source).toContain("<DialogDescription>");
  });
});
