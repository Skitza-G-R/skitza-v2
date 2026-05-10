import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "page.tsx"), "utf8");

describe("/dashboard/profile redirect shim", () => {
  it("permanent-redirects to /dashboard/store by default", () => {
    expect(SRC).toMatch(/permanentRedirect|redirect\(["']\/dashboard\/store["']/);
  });

  it("redirects ?tab=portfolio to /dashboard/portfolio", () => {
    expect(SRC).toMatch(/portfolio/);
    expect(SRC).toMatch(/\/dashboard\/portfolio/);
  });
});
