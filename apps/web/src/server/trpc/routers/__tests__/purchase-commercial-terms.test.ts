import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const purchaseSource = readFileSync(join(__dirname, "../purchase.ts"), "utf8");
const bookingSource = readFileSync(join(__dirname, "../booking.ts"), "utf8");

describe("purchase commercial-term snapshots", () => {
  it("requires the reviewed-terms fingerprint before creating a request", () => {
    expect(purchaseSource).toMatch(/commercialTermsFingerprint:\s*z\.string\(\)/);
    expect(purchaseSource).toMatch(
      /input\.commercialTermsFingerprint\s*!==\s*currentTermsFingerprint/,
    );
    expect(purchaseSource).toMatch(/code:\s*["']CONFLICT["']/);
  });

  it("snapshots structured royalties and effective inline text with the request", () => {
    const transaction = purchaseSource.slice(
      purchaseSource.indexOf("const inserted = await ctx.db.transaction"),
      purchaseSource.indexOf("// 7. Notify the producer"),
    );
    expect(transaction).toMatch(/royaltyTermsSnapshot:\s*prod\.royaltyTerms \?\? null/);
    expect(transaction).toMatch(/agreementTextSnapshot/);
    expect(transaction).toMatch(/tx\.insert\(agreementAcceptances\)/);
  });

  it("retains the legacy encoded agreement compatibility read", () => {
    expect(purchaseSource).toMatch(/decodeDescription\(product\.description\)\.contractText/);
    expect(purchaseSource).toMatch(/product\.agreementText !== null/);
  });

  it("fingerprints and snapshots only the safe agreement URL shown to the artist", () => {
    expect(purchaseSource).toMatch(
      /const contractUrlSnapshot = safeAgreementUrl\(prod\.contractUrl\)/,
    );
    expect(purchaseSource).toMatch(/contractUrl:\s*contractUrlSnapshot/);
    expect(purchaseSource).toMatch(/contractUrlSnapshot,\s*\n/);
  });

  it("returns immutable terms to artist and tenant-scoped producer detail reads", () => {
    expect(purchaseSource).toMatch(/get:\s*producerProcedure/);
    expect(purchaseSource).toMatch(/loadProducerRequest\(ctx\.db, ctx\.producerId, input\.id\)/);
    expect(purchaseSource).toMatch(
      /eq\(purchaseRequests\.producerId, producerId\)/,
    );
    expect(purchaseSource).toMatch(/acceptedAt:\s*acceptance\?\.acceptedAt \?\? null/);
    expect(purchaseSource).toMatch(
      /paymentPlanChosenAt:\s*request\.paymentPlanChosenAt/,
    );
    expect(
      purchaseSource.match(/royaltyTermsSnapshot:\s*request\.royaltyTermsSnapshot/g),
    ).toHaveLength(2);
    expect(
      purchaseSource.match(/agreementTextSnapshot:\s*request\.agreementTextSnapshot/g),
    ).toHaveLength(2);
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
