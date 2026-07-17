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

  it("uses safe agreement URLs only in compatibility proposal reads", () => {
    expect(purchaseSource).toMatch(/safeAgreementUrl\(product\.contractUrl\)/);
    expect(purchaseSource).not.toMatch(/agreementUrl:\s*request\./);
  });

  it("keeps request reads tenant-scoped and labels display values as live proposals", () => {
    expect(purchaseSource).toMatch(/get:\s*producerProcedure/);
    expect(purchaseSource).toMatch(/loadProducerRequest\(ctx\.db, ctx\.producerId, input\.id\)/);
    expect(purchaseSource).toMatch(/eq\(purchaseRequests\.producerId, producerId\)/);
    expect(purchaseSource).toContain("Compatibility display values are live proposal data");
    expect(purchaseSource).toMatch(/acceptedAt: null as Date \| null/);
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
