import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-grep test for the restorePackage server action. We don't
// boot tRPC here — the router-side mutation has its own dedicated
// test (booking-packages-restore). This test pins down the action's
// wiring so a future refactor can't silently break the Undo flow:
// the action must exist, hit `booking.packages.restore`, and
// revalidate the redesigned /dashboard/store URL.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "actions.ts"), "utf8");

describe("restorePackage server action", () => {
  it("exports a restorePackage function", () => {
    expect(SRC).toMatch(/export\s+async\s+function\s+restorePackage/);
  });

  it("calls booking.packages.restore on the tRPC caller", () => {
    expect(SRC).toMatch(/packages\.restore/);
  });

  it("revalidates /dashboard/store so the redesign refreshes", () => {
    expect(SRC).toMatch(/\/dashboard\/store/);
  });
});
