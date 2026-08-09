import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const purchaseSource = readFileSync(new URL("../purchase.ts", import.meta.url), "utf8");

describe("artist purchase notification wiring", () => {
  it("resolves the exact request artist and emits only on real decisions", () => {
    expect(purchaseSource).toMatch(
      /loadProducerRequest[\s\S]*?artistClerkUserId: clientContacts\.clerkUserId/,
    );

    const approve = purchaseSource.slice(
      purchaseSource.indexOf("  approve: producerProcedure"),
      purchaseSource.indexOf("  decline: producerProcedure"),
    );
    expect(approve).toMatch(
      /if \(result\.transition\.changed\)[\s\S]*?emitArtistPurchaseDecisionNotification/,
    );
    expect(approve).toMatch(/recipientClerkUserId: result\.artistClerkUserId/);
    expect(approve).toMatch(/decision: "approved"/);
    expect(approve).toMatch(/if \(artistEmailEnabled\)[\s\S]*?sendPurchaseApprovedEmail/);

    const decline = purchaseSource.slice(
      purchaseSource.indexOf("  decline: producerProcedure"),
      purchaseSource.indexOf("  list: producerProcedure"),
    );
    expect(decline).toMatch(
      /if \(result\.transition\.changed\)[\s\S]*?emitArtistPurchaseDecisionNotification/,
    );
    expect(decline).toMatch(/decision: "declined"/);
    expect(decline).toMatch(/if \(artistEmailEnabled\)[\s\S]*?sendPurchaseDeclinedEmail/);
  });

  it("emits exact proof records and honors the saved artist email channel", () => {
    const producerProof = purchaseSource.slice(
      purchaseSource.lastIndexOf("  proofOfPayment: router({"),
    );
    expect(producerProof).toMatch(
      /if \(result\.created\)[\s\S]*?emitArtistProofDecisionNotification[\s\S]*?decision: "verified"/,
    );
    expect(producerProof).toMatch(
      /if \(result\.changed\)[\s\S]*?emitArtistProofDecisionNotification[\s\S]*?decision: "rejected"/,
    );
    expect(producerProof).toMatch(
      /if \(email && artistEmailEnabled\)[\s\S]*?sendProofVerifiedEmail/,
    );
    expect(producerProof).toMatch(
      /if \(email && rejectionNote && artistEmailEnabled\)[\s\S]*?sendProofRejectedEmail/,
    );
  });
});
