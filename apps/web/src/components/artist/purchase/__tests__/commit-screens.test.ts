import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildAgreementTerms,
  formatPurchaseMoney,
  formatShekels,
  includesOrFallback,
} from "../purchase-data";

describe("purchase-data helpers", () => {
  it("formats exact currencies", () => {
    expect(formatShekels(240000)).toBe("₪2,400");
    expect(formatPurchaseMoney(240000, "USD")).toBe("$2,400");
    expect(formatPurchaseMoney(90050, "EUR")).toBe("€900.50");
  });

  it("keeps the pre-request summary truthful about final acceptance", () => {
    const terms = buildAgreementTerms("Gili Studio", ["Mix", "Master"]);
    expect(terms[0]?.body).toContain("Only that final acceptance freezes");
    expect(terms.find((term) => term.heading === "What's included")?.points).toEqual([
      "Mix",
      "Master",
    ]);
    expect(includesOrFallback([], "Gili Studio")).toEqual([
      "Everything agreed with Gili Studio for this offer",
    ]);
  });
});

const here = dirname(fileURLToPath(import.meta.url));
const review = readFileSync(join(here, "..", "review-agree-screen.tsx"), "utf8");
const actions = readFileSync(join(here, "..", "actions.ts"), "utf8");
const sent = readFileSync(join(here, "..", "request-sent-screen.tsx"), "utf8");

describe("exact agreement acceptance", () => {
  it("renders the immutable commercial snapshot instead of the live product", () => {
    expect(review).toMatch(/snapshot\.lineItems\.map/);
    expect(review).toMatch(/snapshot\.discountCents/);
    expect(review).toMatch(/snapshot\.tax\.amountCents/);
    expect(review).toMatch(/snapshot\.totalCents/);
    expect(review).toMatch(/snapshot\.deliverables\.map/);
    expect(review).toMatch(/snapshot\.rights\.map/);
    expect(review).toMatch(/snapshot\.agreementText/);
    expect(review).toMatch(/snapshot\.includedSongSpaces/);
    expect(review).toMatch(/sessionLines\(snapshot\)/);
    expect(review).toMatch(/revisionLabel\(snapshot\)/);
  });

  it("shows the exact target, selected plan, and installment schedule", () => {
    expect(review).toMatch(/preview\.target\.kind === "new"/);
    expect(review).toMatch(/preview\.target\.projectTitle/);
    expect(review).toMatch(/target\.lifecycleStatus/);
    expect(review).toMatch(/target\.workflowStage/);
    expect(review).toMatch(/target\.updatedAtIso/);
    expect(review).toMatch(/snapshot\.selectedPaymentPlan/);
    expect(review).toMatch(/preview\.schedule\.map/);
  });

  it("requires explicit acceptance of the exact agreement and plan", () => {
    expect(review).toMatch(/I accept this exact agreement and payment plan/);
    expect(review).toMatch(
      /disabled=\{!accepted \|\| sending \|\| \(!online && isExactReview\(props\)\)\}/,
    );
    expect(review).toMatch(/agreementAccepted: true/);
    expect(actions).toMatch(/agreementAccepted: true/);
  });

  it("accepts digest + plan atomically with a stable operation key", () => {
    expect(review).toMatch(/acceptPurchaseAction\(\{/);
    expect(review).toMatch(/expectedSnapshotDigest: preview\.snapshotDigest/);
    expect(review).toMatch(/operationKeyRef\.current \?\? crypto\.randomUUID\(\)/);
    expect(actions).toMatch(/caller\.artist\.purchase\.acceptance\.accept\(input\)/);
  });

  it("routes the created purchase to purchase-backed payment instructions", () => {
    expect(review).toMatch(/purchase: result\.purchaseId/);
    expect(review).toMatch(/req: props\.purchaseRequestId/);
    expect(review).toMatch(/\/pay\/instructions\?/);
  });

  it("never sends a request or fakes acceptance on the live exact path", () => {
    expect(review).not.toMatch(/requestToBookAction/);
    expect(review).toMatch(/Development-gallery compatibility only/);
    expect(review).toMatch(/if \(!isExactReview\(props\)\)/);
  });

  it("keeps one natural mobile page scroll and reduced-motion loading", () => {
    expect(review.match(/overflow-y-auto/g)?.length).toBe(1);
    expect(review).toMatch(/animate-spin[^"]*motion-reduce:animate-none/);
  });
});

describe("request sent screen", () => {
  it("shows intent-only identity without claiming terms are frozen", () => {
    expect(sent).toMatch(/requestRef/);
    expect(sent).toMatch(/PENDING REVIEW/);
    expect(sent).not.toMatch(/PRICE LOCKED|product\.priceCents/);
  });

  it("offers studio-preserving Home and Store exits", () => {
    expect(sent).toContain('withArtistStudio("/artist", studioId)');
    expect(sent).toContain('withArtistStudio("/artist/store", studioId)');
  });

  it("shows approval, plan choice, exact acceptance, then external payment", () => {
    expect(sent).toContain("Choose an enabled payment plan");
    expect(sent).toContain("Review and accept the exact agreement");
    expect(sent).toContain("Receive external payment instructions");
    expect(sent.indexOf("Choose an enabled payment plan")).toBeLessThan(
      sent.indexOf("Review and accept the exact agreement"),
    );
    expect(sent.indexOf("Review and accept the exact agreement")).toBeLessThan(
      sent.indexOf("Receive external payment instructions"),
    );
  });
});
