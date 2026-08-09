import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const calendarPage = readFileSync(join(here, "..", "page.tsx"), "utf8");
const dashboardPage = readFileSync(join(here, "..", "..", "page.tsx"), "utf8");

describe("purchase-owned session names", () => {
  it("threads purchase-derived names through every calendar projection", () => {
    expect(calendarPage).not.toMatch(/packageName: "Session"/);
    expect(calendarPage.match(/packageName: b\.title \?\? b\.packageNameSnapshot/g)).toHaveLength(
      4,
    );
    expect(calendarPage.match(/packageName: b\.packageName,/g)).toHaveLength(2);
  });

  it("preserves the purchase-derived name in dashboard pending approvals", () => {
    expect(dashboardPage).toMatch(/packageNameSnapshot: booking\.packageNameSnapshot/);
    expect(dashboardPage).not.toMatch(/packageNameSnapshot: "Session"/);
  });
});
