import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-grep test for the reorderProducts server action. We don't
// boot tRPC here — the router-side mutation has its own dedicated
// test (booking-packages-reorder). This test pins down the action's
// wiring so a future refactor can't silently break the drag-reorder
// flow: the action must exist, hit `booking.packages.reorder`, and
// revalidate the redesigned /dashboard/store URL.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "actions.ts"), "utf8");

describe("reorderProducts server action", () => {
  it("exports a reorderProducts function", () => {
    expect(SRC).toMatch(/export\s+async\s+function\s+reorderProducts/);
  });

  it("calls the tRPC packages.reorder mutation", () => {
    expect(SRC).toMatch(/booking\.packages\.reorder/);
  });

  it("revalidates the /dashboard/store path on success", () => {
    expect(SRC).toMatch(/reorderProducts[\s\S]{0,400}revalidatePath\(["']\/dashboard\/store["']\)/);
  });
});
