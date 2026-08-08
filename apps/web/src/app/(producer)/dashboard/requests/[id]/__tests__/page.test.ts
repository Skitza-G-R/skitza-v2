import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "..", "page.tsx"), "utf8");

describe("producer purchase request detail", () => {
  it("loads the tenant-scoped request read model instead of querying products in the page", () => {
    expect(page).toMatch(/producer\.purchase\.get/);
    expect(page).not.toMatch(/booking\.packages|from\(products\)/);
  });

  it("branches between the current proposal and authoritative accepted snapshot", () => {
    expect(page).toMatch(/commercialTerms\.snapshot/);
    expect(page).toMatch(/commercialTerms\.kind === "accepted"/);
    expect(page).toMatch(/<PurchaseRequestCommercialDetails/);
    expect(page).not.toMatch(/agreementUrl|contractUrlSnapshot/);
  });

  it("renders the action-first review while preserving the detail route", () => {
    expect(page).toMatch(/<PurchaseRequestReview/);
    expect(page).toMatch(
      /canApprove=\{[\s\S]*commercialTerms\.kind === "proposal" && commercialTerms\.approvalAvailable/,
    );
    expect(page).toMatch(/initialStatus=\{request\.status\}/);
    expect(page).toMatch(/artistName=\{request\.artistName\}/);
    expect(page).toMatch(/reference=\{request\.refNumber\}/);
    expect(page).not.toMatch(/undoableUntil|initialUndoableUntilIso/);
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

  it("does not put payment-proof review on the new-work detail", () => {
    expect(page).not.toMatch(/proofOfPayment\.(history|view)|PaymentProofReview/);
  });

  it("loads only the accepted purchase's pending proofs and renders exact Payments links", () => {
    expect(page).toMatch(
      /proofOfPayment\.pending\(\{[\s\S]*purchaseId: commercialTerms\.purchaseId/,
    );
    expect(page).toMatch(/<AcceptedRequestPaymentProofActions/);
    expect(page).toMatch(/pendingProofs\.proofs/);
  });
});
