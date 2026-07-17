import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-grep on the funnel route pages: SK-46 swapped the mock-first
// wiring for the real BE-1 callers. These tests pin the swap so a future
// refactor can't silently fall back to placeholder data.

const here = dirname(fileURLToPath(import.meta.url));
const s3Src = readFileSync(join(here, "..", "page.tsx"), "utf8");
const s4Src = readFileSync(join(here, "..", "agree", "page.tsx"), "utf8");
const s5Src = readFileSync(join(here, "..", "sent", "page.tsx"), "utf8");
const SRC_ROOT = join(here, "..", "..", "..", "..", "..", "..");
const routerSrc = readFileSync(join(SRC_ROOT, "server", "trpc", "routers", "purchase.ts"), "utf8");
const actionsSrc = readFileSync(
  join(SRC_ROOT, "components", "artist", "purchase", "actions.ts"),
  "utf8",
);

describe("S3 entry page (real BE-1 data)", () => {
  it("fetches the real product and maps it for the screen", () => {
    expect(s3Src).toMatch(/caller\.artist\.store\.product\(\{ productId \}\)/);
    expect(s3Src).toMatch(/toPurchaseProduct\(row\)/);
    expect(s3Src).toMatch(/toProducer\(row\)/);
    expect(s3Src).not.toMatch(/MOCK_/);
  });

  it("resolves pendingRequest from artist.purchase.pending", () => {
    expect(s3Src).toMatch(/caller\.artist\.purchase\.pending\(\{/);
    expect(s3Src).toMatch(/pendingRequest=\{Boolean\(pending\)\}/);
  });

  it("translates NOT_FOUND/BAD_REQUEST into a 404", () => {
    expect(s3Src).toMatch(/notFound\(\)/);
  });
});

describe("S4 agree page (real BE-1 data)", () => {
  it("builds the terms from the real producer + deliverables", () => {
    expect(s4Src).toMatch(/caller\.artist\.store\.product\(\{ productId \}\)/);
    expect(s4Src).toMatch(/buildAgreementTerms\(producer\.name, product\.includes\)/);
    expect(s4Src).not.toMatch(/MOCK_/);
    expect(s4Src).not.toMatch(/commercialTermsFingerprint/);
  });
});

describe("S5 sent page (real BE-1 data)", () => {
  it("requires ?req= and falls back to the S3 entry", () => {
    expect(s5Src).toMatch(/if \(!req\) redirect\(`\/artist\/purchase\/\$\{productId\}`\)/);
  });

  it("renders only the owned request identity, not mutable proposal details", () => {
    expect(s5Src).toMatch(/caller\.artist\.purchase\.get\(\{ purchaseRequestId: req \}\)/);
    expect(s5Src).toMatch(/requestRef=\{request\.refNumber\}/);
    expect(s5Src).toMatch(/request\.productId !== productId/);
    expect(s5Src).not.toMatch(/request\.priceCents|request\.productNameSnapshot|toPurchaseProduct/);
    expect(s5Src).not.toMatch(/makeRequestRef/);
  });
});

describe("artist.purchase.pending read (SK-46)", () => {
  it("exists as an artistProcedure keyed by producerId", () => {
    expect(routerSrc).toMatch(/pending: artistProcedure/);
    expect(routerSrc).toMatch(/\.input\(z\.object\(\{ producerId: z\.string\(\)\.uuid\(\) \}\)\)/);
  });

  it("surfaces only open pre-acceptance requests", () => {
    expect(routerSrc).toMatch(/inArray\(purchaseRequests\.status, \["pending", "approved"\]\)/);
    expect(routerSrc).not.toMatch(/BLOCKING_CANDIDATE_STATUSES|paidTotalCents/);
    expect(routerSrc).toMatch(/if \(!contact\) return \{ pending: null \}/);
  });
});

describe("requestToBookAction (server action)", () => {
  it("is a server action that wraps artist.purchase.request", () => {
    expect(actionsSrc).toMatch(/^"use server";/);
    expect(actionsSrc).toMatch(/caller\.artist\.purchase\.request\(\{/);
  });

  it("sends only pre-acceptance intent instead of a plan, agreement, or terms fingerprint", () => {
    const requestMutation = routerSrc.slice(
      routerSrc.indexOf("request: artistProcedure"),
      routerSrc.indexOf("get: artistProcedure"),
    );
    const requestAction = actionsSrc.slice(
      actionsSrc.indexOf("export async function requestToBookAction"),
      actionsSrc.indexOf("export async function choosePaymentPlanAction"),
    );
    expect(requestMutation).not.toMatch(
      /agreementAccepted|commercialTermsFingerprint|paymentPlan: PAYMENT_PLAN_INPUT/,
    );
    expect(requestMutation).toMatch(/\.strict\(\)/);
    expect(requestAction).not.toMatch(
      /agreementAccepted|commercialTermsFingerprint|provisionalPlan|offeredPlans/,
    );
    expect(requestAction).toMatch(
      /caller\.artist\.purchase\.request\(\{\s*productId: input\.productId,\s*operationKey: input\.operationKey,?\s*\}\)/,
    );
  });

  it("keeps plan options as a live pre-acceptance proposal", () => {
    const optionsSection = routerSrc.slice(
      routerSrc.indexOf("options: artistProcedure"),
      routerSrc.indexOf("choose: artistProcedure"),
    );
    expect(optionsSection).toMatch(/loadArtistRequest/);
    expect(optionsSection).toMatch(/buildPlanOptions\(product\.paymentPlans/);
    expect(optionsSection).not.toMatch(/paymentPlanOptionsSnapshot/);
  });

  it("returns no paid plan or options for a true zero-price proposal", () => {
    expect(routerSrc).toMatch(
      /function proposalPlan[\s\S]*?return totalCents === 0 \? null : \(product\.paymentPlans\[0\] \?\? null\)/,
    );
    const optionsSection = routerSrc.slice(
      routerSrc.indexOf("options: artistProcedure"),
      routerSrc.indexOf("choose: artistProcedure"),
    );
    expect(optionsSection).toMatch(/price\.priceCents === 0\s*\? \[\]/);
  });

  it("fails plan-only acceptance closed until exact terms are accepted together", () => {
    const chooseSection = routerSrc.slice(
      routerSrc.indexOf("choose: artistProcedure"),
      routerSrc.indexOf("paymentInstructions: artistProcedure"),
    );
    expect(chooseSection).toContain('notImplemented("artist.purchase.paymentPlan.choose")');
    expect(chooseSection).not.toMatch(/update\(purchaseRequests\)/);
  });

  it("deduplicates request creation by operation identity without an active-purchase slot", () => {
    expect(routerSrc).toMatch(/ctx\.db\.transaction/);
    expect(routerSrc).toMatch(/preparePurchaseRequestOperation/);
    expect(routerSrc).toMatch(/onConflictDoNothing/);
    expect(routerSrc).not.toMatch(/pg_advisory_xact_lock|already have an active purchase/);
  });

  it("keeps request-backed proof handling unavailable", () => {
    const proofSection = routerSrc.slice(
      routerSrc.indexOf("proofOfPayment: router({"),
      routerSrc.indexOf("export const producerPurchaseRouter"),
    );
    expect(proofSection).not.toMatch(/storageKey: z\.string/);
    expect(proofSection).not.toMatch(/buildProofStagingKey|insert\(paymentProofs\)/);
    expect(proofSection).toContain('notImplemented("artist.purchase.proofOfPayment.submit")');
  });

  it("fails producer proof decisions closed", () => {
    const rejectSection = routerSrc.slice(
      routerSrc.indexOf("reject: producerProcedure"),
      routerSrc.length,
    );
    expect(rejectSection).toContain('notImplemented("producer.purchase.proofOfPayment.reject")');
  });

  it("does not send proof-result side effects from compatibility stubs", () => {
    const confirmSection = routerSrc.slice(
      routerSrc.indexOf("confirm: producerProcedure"),
      routerSrc.indexOf("reject: producerProcedure"),
    );
    expect(confirmSection).toContain('notImplemented("producer.purchase.proofOfPayment.confirm")');
    expect(confirmSection).not.toMatch(/sendProofVerifiedEmail/);
  });

  it("does not choose a provisional plan before acceptance", () => {
    expect(actionsSrc).not.toMatch(/selectProvisionalRequestPaymentPlan|offeredPlans\(product\)/);
  });

  it("returns a tagged union instead of throwing at the client", () => {
    expect(actionsSrc).toMatch(/\{ ok: false, error: e\.message \}/);
    expect(actionsSrc).toMatch(/purchaseRequestId: result\.purchaseRequestId/);
  });
});
