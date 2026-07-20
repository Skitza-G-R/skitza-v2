import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const purchaseSource = readFileSync(join(__dirname, "../purchase.ts"), "utf8");
const serviceSource = readFileSync(
  join(__dirname, "../../../domain/payment-proofs/service.ts"),
  "utf8",
);
const evidenceRouteSource = readFileSync(
  join(__dirname, "../../../../app/api/payment-proofs/evidence/route.ts"),
  "utf8",
);

describe("accepted-purchase proof API security", () => {
  it("keeps storage implementation out of the tRPC router", () => {
    expect(purchaseSource).not.toMatch(/@aws-sdk|GetObjectCommand|PutObjectCommand/);
    expect(purchaseSource).not.toMatch(/storageKey|objectEtag|storageBucket/);
    expect(purchaseSource).toMatch(/prepareArtistProofUpload/);
    expect(purchaseSource).toMatch(/submitArtistPaymentProof/);
  });

  it("uses exact purchase/installment inputs and a signed opaque upload token", () => {
    const artistProofRouter = purchaseSource.slice(
      purchaseSource.indexOf("  proofOfPayment: router({"),
      purchaseSource.indexOf("export const producerPurchaseRouter"),
    );
    expect(artistProofRouter).toMatch(/purchaseId: z\.string\(\)\.uuid\(\)/);
    expect(artistProofRouter).toMatch(/installmentId: z\.string\(\)\.uuid\(\)/);
    expect(artistProofRouter).toMatch(/uploadToken: z\.string\(\)/);
    expect(artistProofRouter).toMatch(/amountCents: z\.number\(\)\.int\(\)\.positive\(\)/);
    expect(artistProofRouter).not.toMatch(/purchaseRequestId|storageKey|objectEtag/);
  });

  it("scopes producer reads and decisions to ctx.producerId", () => {
    const producerProofRouter = purchaseSource.slice(
      purchaseSource.lastIndexOf("  proofOfPayment: router({"),
    );
    expect(producerProofRouter).toMatch(
      /listProducerPendingPaymentProofs\(ctx\.db, ctx\.producerId/,
    );
    expect(producerProofRouter).toMatch(/producerId: ctx\.producerId/);
    expect(serviceSource).toMatch(/eq\(paymentProofs\.producerId, producerId\)/);
    expect(serviceSource).toMatch(/eq\(purchases\.producerId, producerId\)/);
  });

  it("delivers evidence only through a short-lived same-origin authorization route", () => {
    expect(serviceSource).toMatch(/PROOF_EVIDENCE_TTL_SECONDS/);
    expect(serviceSource).toMatch(/\/api\/payment-proofs\/evidence\?token=/);
    expect(evidenceRouteSource).toMatch(/verifyProofEvidenceToken/);
    expect(evidenceRouteSource).toMatch(/payload\.viewerClerkUserId !== userId/);
    expect(evidenceRouteSource).toMatch(/authorizePrivateProofEvidence/);
    expect(evidenceRouteSource).toMatch(/private, no-store/);
    expect(evidenceRouteSource).toMatch(/Content-Security-Policy/);
    expect(evidenceRouteSource).not.toMatch(
      /getSignedUrl|storageKey.*headers|storageBucket.*headers/,
    );
  });

  it("does not add standalone agreement, session, or final-trigger procedures", () => {
    expect(purchaseSource).not.toMatch(/acceptAgreement: artistProcedure/);
    expect(purchaseSource).not.toMatch(/schedule: artistProcedure/);
    expect(purchaseSource).not.toMatch(/canDownload: artistProcedure/);
    expect(purchaseSource).not.toMatch(/session: router/);
  });
});
