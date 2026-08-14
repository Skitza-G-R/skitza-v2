import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const purchaseSource = readFileSync(join(__dirname, "../purchase.ts"), "utf8");
const bookingSource = readFileSync(join(__dirname, "../booking.ts"), "utf8");
const proposalSource = readFileSync(
  join(__dirname, "../../../domain/purchases/request-proposal.ts"),
  "utf8",
);
const storeCommercialSource = readFileSync(
  join(__dirname, "../../../domain/store-products/service.ts"),
  "utf8",
);
const storeAcceptanceSource = readFileSync(
  join(__dirname, "../../../domain/purchases/store-acceptance.ts"),
  "utf8",
);

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

  it("locks open-studio state for new requests while preserving exact request replays", () => {
    const requestMutation = purchaseSource.slice(
      purchaseSource.indexOf("request: artistProcedure"),
      purchaseSource.indexOf("get: artistProcedure"),
    );
    const replay = requestMutation.indexOf("assertPurchaseRequestOperationReplay");
    const replayReturn = requestMutation.indexOf(
      "return { request: existing, created: false }",
      replay,
    );
    const closureGuard = requestMutation.indexOf("isNull(producers.closedAt)", replayReturn);
    const rowLock = requestMutation.indexOf('.for("share")', closureGuard);
    const insert = requestMutation.indexOf(".insert(purchaseRequests)", rowLock);

    expect(replay).toBeGreaterThanOrEqual(0);
    expect(replayReturn).toBeGreaterThan(replay);
    expect(closureGuard).toBeGreaterThan(replayReturn);
    expect(rowLock).toBeGreaterThan(closureGuard);
    expect(insert).toBeGreaterThan(rowLock);
  });

  it("blocks new Store acceptance after closure without breaking an accepted replay", () => {
    const accept = storeAcceptanceSource.slice(
      storeAcceptanceSource.indexOf("export async function acceptStorePurchase"),
      storeAcceptanceSource.indexOf("export function storeAcceptancePlanKey"),
    );
    const replay = accept.indexOf('context.request.status === "converted"');
    const closureGuard = accept.indexOf("context.producerClosedAt !== null", replay);
    const purchaseAcceptance = accept.indexOf("acceptPurchase(", closureGuard);

    expect(storeAcceptanceSource).toMatch(
      /loadArtistAcceptanceContext[\s\S]*isNull\(producers\.closedAt\)/,
    );
    expect(replay).toBeGreaterThanOrEqual(0);
    expect(closureGuard).toBeGreaterThan(replay);
    expect(purchaseAcceptance).toBeGreaterThan(closureGuard);
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
    expect(purchaseSource).toMatch(/buildPurchaseRequestCommercialProposal/);
    expect(proposalSource).toMatch(/buildStorePurchaseSnapshot\(\{/);
    expect(proposalSource).toMatch(/selectedPaymentPlan: null/);
    expect(proposalSource).toMatch(/buildStorePurchaseProposalAgreementText/);
    expect(storeCommercialSource).toContain('"Not selected yet"');
    expect(purchaseSource).toMatch(/subtotalCents:\s*proposal\.subtotalCents/);
    expect(purchaseSource).toMatch(/taxCents:\s*proposal\.tax\.amountCents/);
    expect(purchaseSource).toMatch(/totalCents:\s*proposal\.totalCents/);
  });

  it("keeps request reads tenant-scoped and separates live proposals from accepted truth", () => {
    const producerGetStart = purchaseSource.indexOf(
      "  get: producerProcedure\n    .input(z.object({ id: z.string().uuid() }))",
    );
    const producerGet = purchaseSource.slice(
      producerGetStart,
      purchaseSource.indexOf("correctTarget: producerProcedure"),
    );
    expect(purchaseSource).toMatch(/get:\s*producerProcedure/);
    expect(purchaseSource).toMatch(
      /loadProducerRequest\(\s*ctx\.db,\s*ctx\.producerId,\s*input\.id,?\s*\)/,
    );
    expect(purchaseSource).toMatch(/eq\(purchaseRequests\.producerId, producerId\)/);
    expect(producerGet).toMatch(/kind: "proposal" as const/);
    expect(producerGet).toMatch(/kind: "accepted" as const/);
    expect(producerGet).toMatch(/loadAcceptedPurchaseForProducerRequest/);
    expect(producerGet).not.toMatch(/agreementUrl/);
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
