import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const purchaseSource = readFileSync(join(__dirname, "../purchase.ts"), "utf8");

describe("accepted-purchase API containment", () => {
  it("removes request-owned proof, invoice, and storage implementations", () => {
    expect(purchaseSource).not.toMatch(/@aws-sdk|GetObjectCommand|PutObjectCommand/);
    expect(purchaseSource).not.toMatch(/paymentProofs|invoices|ensurePurchaseProject/);
    expect(purchaseSource).not.toMatch(/buildProofStagingKey|buildFinalProofKey/);
  });

  it("implements instruction reads while keeping unfinished proof mutations closed", () => {
    expect(purchaseSource).toMatch(
      /paymentInstructions:[\s\S]*loadArtistInstallmentPaymentInstructions/,
    );
    expect(purchaseSource).not.toContain('notImplemented("artist.purchase.paymentInstructions")');

    for (const procedure of [
      "artist.purchase.paymentPlan.choose",
      "artist.purchase.proofOfPayment.state",
      "artist.purchase.proofOfPayment.presign",
      "artist.purchase.proofOfPayment.submit",
    ]) {
      expect(purchaseSource).toContain(`notImplemented("${procedure}")`);
    }
  });

  it("keeps critical producer proof reads safely unavailable and empty", () => {
    const proofRouter = purchaseSource.slice(
      purchaseSource.lastIndexOf("proofOfPayment: router({"),
    );
    expect(proofRouter).toMatch(/pending:[\s\S]*available: false,[\s\S]*proofs: \[\]/);
    expect(proofRouter).toMatch(/history:[\s\S]*available: false,[\s\S]*proofs: \[\]/);
    expect(proofRouter).toContain('notImplemented("producer.purchase.proofOfPayment.view")');
    expect(proofRouter).toContain('notImplemented("producer.purchase.proofOfPayment.confirm")');
    expect(proofRouter).toContain('notImplemented("producer.purchase.proofOfPayment.reject")');
  });

  it("does not expose standalone agreement, session, or download procedures", () => {
    expect(purchaseSource).not.toMatch(/acceptAgreement: artistProcedure/);
    expect(purchaseSource).not.toMatch(/schedule: artistProcedure/);
    expect(purchaseSource).not.toMatch(/canDownload: artistProcedure/);
    expect(purchaseSource).not.toMatch(/session: router/);
  });
});
