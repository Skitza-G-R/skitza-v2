import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const purchaseSource = readFileSync(join(__dirname, "../purchase.ts"), "utf8");

describe("approved-reset purchase request boundary", () => {
  it("does not retain schema-detection or legacy purchase insert paths", () => {
    expect(purchaseSource).not.toMatch(/information_schema/);
    expect(purchaseSource).not.toMatch(/loadPurchaseRequestRow/);
    expect(purchaseSource).not.toMatch(/insertPurchaseRequest/);
    expect(purchaseSource).not.toMatch(/agreementAcceptances|invoices/);
  });

  it("writes only pre-acceptance request intent and operation identity", () => {
    const requestMutation = purchaseSource.slice(
      purchaseSource.indexOf("request: artistProcedure"),
      purchaseSource.indexOf("get: artistProcedure"),
    );

    expect(requestMutation).toMatch(/preparePurchaseRequestOperation/);
    expect(requestMutation).toMatch(/operationKey: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(200\)/);
    expect(requestMutation).toMatch(/operationKey: operation\.operationKey/);
    expect(requestMutation).toMatch(/operationDigest: operation\.operationDigest/);
    expect(requestMutation).toMatch(/requestedSongQty: input\.songQty \?\? null/);
    expect(requestMutation).not.toMatch(/paymentPlanSnapshot|priceCents|agreementTextSnapshot/);
    expect(requestMutation).not.toMatch(/unitPriceCents|randomUUID/);
  });
});
