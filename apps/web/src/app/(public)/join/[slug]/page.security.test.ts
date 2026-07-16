import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("public join portfolio count", () => {
  const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

  it("counts only explicitly public tracks through the portfolio domain service", () => {
    expect(source).toContain("countPublicPortfolioTracks(");
    expect(source).not.toMatch(/\bportfolioTracks\b/);
  });
});
