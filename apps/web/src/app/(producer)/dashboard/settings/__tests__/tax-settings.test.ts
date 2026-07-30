import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const settingsDir = join(here, "..");
const page = readFileSync(join(settingsDir, "page.tsx"), "utf8");
const client = readFileSync(join(settingsDir, "settings-client.tsx"), "utf8");

describe("studio tax settings", () => {
  it("hydrates the saved producer tax treatment and rate", () => {
    expect(page).toMatch(/taxMode:\s*coerceTaxMode\(profile\.taxMode\)/);
    expect(page).toMatch(/taxRatePct:\s*profile\.taxRatePct/);
    expect(client).toMatch(/taxMode:\s*"tax_free"\s*\|\s*"tax_included"\s*\|\s*"tax_added"/);
    expect(client).toMatch(/taxRatePct:\s*number/);
  });

  it("owns tax treatment inside Currency & region", () => {
    const region =
      client.match(/function RegionSection[\s\S]*?\n}\s*\n/)?.[0] ?? "";

    expect(region, "RegionSection block not found").not.toBe("");
    expect(region).toContain("Tax treatment");
    expect(region).toContain("Tax-free");
    expect(region).toContain("Included in price");
    expect(region).toContain("Added at checkout");
    expect(region).toContain("Tax rate");
  });

  it("includes tax changes in the region dirty state and save patch", () => {
    expect(client).toMatch(/form\.taxMode\s*!==\s*savedForm\.taxMode/);
    expect(client).toMatch(/form\.taxRatePct\s*!==\s*savedForm\.taxRatePct/);
    expect(client).toMatch(/patch\.taxMode\s*=\s*form\.taxMode/);
    expect(client).toMatch(/patch\.taxRatePct\s*=\s*form\.taxRatePct/);
  });
});
