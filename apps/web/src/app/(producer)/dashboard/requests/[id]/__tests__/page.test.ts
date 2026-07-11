import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "..", "page.tsx"), "utf8");
const detail = readFileSync(
  join(
    here,
    "..",
    "..",
    "..",
    "..",
    "..",
    "..",
    "components",
    "dashboard",
    "requests",
    "purchase-request-detail.tsx",
  ),
  "utf8",
);
const surface = `${page}\n${detail}`;

describe("producer purchase request detail", () => {
  it("loads the tenant-scoped frozen request instead of the live product", () => {
    expect(page).toMatch(/producer\.purchase\.get/);
    expect(page).not.toMatch(/booking\.packages|from\(products\)/);
  });

  it("shows frozen payment, royalty, agreement, and acceptance terms", () => {
    expect(surface).toMatch(/paymentPlanOptionsSnapshot/);
    expect(surface).toMatch(/paymentPlanChosenAt/);
    expect(surface).toMatch(/After approval, the artist chooses/);
    expect(surface).toMatch(/royaltyTermsSnapshot/);
    expect(surface).toMatch(/royaltyTermsSnapshot\?\.notes/);
    expect(surface).toMatch(/agreementTextSnapshot/);
    expect(surface).toMatch(/agreementUrl/);
    expect(surface).toMatch(/acceptedAt/);
  });
});
