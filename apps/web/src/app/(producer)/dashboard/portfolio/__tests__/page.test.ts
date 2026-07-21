import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "page.tsx"), "utf8");

describe("dashboard/portfolio/page.tsx", () => {
  it("uses real song publication choices and keeps social links", () => {
    expect(SRC).toMatch(/songPublication\.producerPortfolioChoices/);
    expect(SRC).toMatch(/producerExternalLinks\.list/);
    expect(SRC).not.toMatch(/portfolio\.list/);
    expect(SRC).not.toMatch(/library\.list/);
  });

  it("derives featured rows from portfolioPublishedAt and current latestVersion", () => {
    expect(SRC).toMatch(/portfolioPublishedAt !== null/);
    expect(SRC).toMatch(/audioUrl: song\.latestVersion\.audioUrl/);
    expect(SRC).toMatch(/versionLabel: song\.latestVersion\.label/);
  });

  it("mounts <PortfolioPanel>", () => {
    expect(SRC).toMatch(/<PortfolioPanel/);
  });
});
