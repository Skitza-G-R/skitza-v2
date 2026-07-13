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

  it("maps malformed proof query ids to 404 before calling the API", () => {
    expect(page).toMatch(/PAYMENT_PROOF_ID\.safeParse\(requestedProofId\)/);
    expect(page).toMatch(/requestedProofId && !PAYMENT_PROOF_ID/);
  });
});
