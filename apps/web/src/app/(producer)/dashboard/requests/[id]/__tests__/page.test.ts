import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "..", "page.tsx"), "utf8");

describe("producer purchase request detail", () => {
  it("loads the tenant-scoped frozen request instead of the live product", () => {
    expect(page).toMatch(/producer\.purchase\.get/);
    expect(page).not.toMatch(/booking\.packages|from\(products\)/);
  });

  it("shows frozen payment, royalty, agreement, and acceptance terms", () => {
    expect(page).toMatch(/paymentPlanOptionsSnapshot/);
    expect(page).toMatch(/paymentPlanChosenAt/);
    expect(page).toMatch(/artist picks after approval/);
    expect(page).toMatch(/royaltyTermsSnapshot/);
    expect(page).toMatch(/royaltyTermsSnapshot\?\.notes/);
    expect(page).toMatch(/agreementTextSnapshot/);
    expect(page).toMatch(/contractUrlSnapshot/);
    expect(page).toMatch(/acceptedAt/);
  });

  it("adds the Gate 1 review controls while preserving the detail route", () => {
    expect(page).toMatch(/PurchaseRequestReview/);
    expect(page).toMatch(/initialStatus=\{request\.status\}/);
    expect(page).toMatch(
      /initialUndoableUntilIso=\{request\.undoableUntil\?\.toISOString\(\) \?\? null\}/,
    );
    expect(page).toMatch(/href="\/dashboard\/requests"/);
  });

  it("maps malformed ids to the same 404 surface as missing requests", () => {
    expect(page).toMatch(/PURCHASE_REQUEST_ID\.safeParse\(id\)/);
    expect(page).toMatch(/notFound\(\)/);
  });
});
