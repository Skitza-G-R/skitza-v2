import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "page.tsx"), "utf8");

describe("dashboard/portfolio/page.tsx", () => {
  it("calls portfolio.list, producerExternalLinks.list, library.list", () => {
    expect(SRC).toMatch(/portfolio\.list/);
    expect(SRC).toMatch(/producerExternalLinks\.list/);
    expect(SRC).toMatch(/library\.list/);
  });

  it("mounts <PortfolioPanel>", () => {
    expect(SRC).toMatch(/<PortfolioPanel/);
  });
});
