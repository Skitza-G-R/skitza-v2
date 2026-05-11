import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "page.tsx"), "utf8");

describe("dashboard/store/page.tsx", () => {
  it("authenticates via Clerk and redirects unauthenticated visitors", () => {
    expect(SRC).toMatch(/auth\(\)/);
    expect(SRC).toMatch(/redirect\("\/sign-in"\)/);
  });

  it("calls booking.packages.list and producer.me via the server caller", () => {
    expect(SRC).toMatch(/booking\.packages\.list/);
    expect(SRC).toMatch(/producer\.me/);
  });

  it("mounts <StoreScreen>", () => {
    expect(SRC).toMatch(/<StoreScreen/);
  });
});
