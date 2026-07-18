import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const purchaseSource = readFileSync(join(__dirname, "../purchase.ts"), "utf8");
const bookingSource = readFileSync(join(__dirname, "../booking.ts"), "utf8");

describe("purchase commercial-term ownership", () => {
  it("keeps requests pre-acceptance and free of commercial snapshots", () => {
    const requestMutation = purchaseSource.slice(
      purchaseSource.indexOf("request: artistProcedure"),
      purchaseSource.indexOf("get: artistProcedure"),
    );
    expect(requestMutation).toMatch(/insert\(purchaseRequests\)/);
    expect(requestMutation).not.toMatch(/agreementAcceptances/);
    expect(requestMutation).not.toMatch(/paymentPlanSnapshot|commercialSnapshot/);
    expect(requestMutation).not.toMatch(/priceCents/);
  });

  it("retains the legacy encoded agreement compatibility read", () => {
    expect(purchaseSource).toMatch(/decodeDescription\(product\.description\)\.contractText/);
    expect(purchaseSource).toMatch(/product\.agreementText !== null/);
  });

  it("keeps legacy agreement URLs out of Store request creation and producer reads", () => {
    const requestMutation = purchaseSource.slice(
      purchaseSource.indexOf("request: artistProcedure"),
      purchaseSource.indexOf("get: artistProcedure"),
    );
    const producerGet = purchaseSource.slice(
      purchaseSource.indexOf("get: producerProcedure"),
      purchaseSource.indexOf("correctTarget: producerProcedure"),
    );
    expect(requestMutation).not.toMatch(/product\.contractUrl|contractUrlSnapshot/);
    expect(producerGet).not.toMatch(/product\.contractUrl|contractUrlSnapshot|agreementUrl/);
    expect(purchaseSource).toMatch(/contractUrlSnapshot:\s*null/);
    expect(purchaseSource).not.toMatch(/safeAgreementUrl/);
  });

  it("uses the domain-built tax-aware proposal for approval email and producer reads", () => {
    expect(purchaseSource).toMatch(/function buildPurchaseRequestCommercialProposal/);
    expect(purchaseSource).toMatch(/buildStorePurchaseSnapshot\(\{/);
    expect(purchaseSource).toMatch(/subtotalCents:\s*snapshot\.subtotalCents/);
    expect(purchaseSource).toMatch(/tax:\s*Object\.freeze\(\{ \.\.\.snapshot\.tax \}\)/);
    expect(purchaseSource).toMatch(/totalCents:\s*snapshot\.totalCents/);
    expect(purchaseSource).toMatch(/subtotalCents:\s*proposal\.subtotalCents/);
    expect(purchaseSource).toMatch(/taxCents:\s*proposal\.tax\.amountCents/);
    expect(purchaseSource).toMatch(/totalCents:\s*proposal\.totalCents/);
  });

  it("keeps request reads tenant-scoped and labels display values as live proposals", () => {
    const producerGet = purchaseSource.slice(
      purchaseSource.lastIndexOf("  get: producerProcedure"),
      purchaseSource.indexOf("correctTarget: producerProcedure"),
    );
    expect(purchaseSource).toMatch(/get:\s*producerProcedure/);
    expect(purchaseSource).toMatch(/loadProducerRequest\(ctx\.db, ctx\.producerId, input\.id\)/);
    expect(purchaseSource).toMatch(/eq\(purchaseRequests\.producerId, producerId\)/);
    expect(purchaseSource).toContain("Compatibility display values are live proposal data");
    expect(producerGet).not.toMatch(/acceptedAt|agreementUrl/);
    expect(purchaseSource).toMatch(/paymentPlanChosenAt: null as Date \| null/);
  });
});

describe("product commercial-term persistence", () => {
  it("copies royalty and agreement fields when duplicating a product", () => {
    const duplicate = bookingSource.slice(
      bookingSource.indexOf("duplicate: producerProcedure"),
      bookingSource.indexOf("export const bookingRouter"),
    );
    expect(duplicate).toMatch(/royaltyTerms:\s*existing\.royaltyTerms/);
    expect(duplicate).toMatch(/agreementText:\s*existing\.agreementText/);
  });

  it("validates percentage basis points as integers from 1 through 10000", () => {
    expect(
      bookingSource.match(/bps:\s*z\.number\(\)\.int\(\)\.min\(1\)\.max\(10_000\)/g),
    ).toHaveLength(2);
  });
});
