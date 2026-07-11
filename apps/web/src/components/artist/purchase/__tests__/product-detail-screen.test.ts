import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-grep on the S3 entry screen for the wiring that matters — matching
// the repo's existing test style (see commit-screens.test.ts). The pure data
// helpers (formatShekels, swatchGradient) are already covered there; here we
// assert the funnel ENTRY screen is wired correctly.

const here = dirname(fileURLToPath(import.meta.url));
const S3_PATH = join(here, "..", "product-detail-screen.tsx");
const s3Src = readFileSync(S3_PATH, "utf8");

describe("product-detail-screen.tsx (S3) wiring", () => {
  it("is a client component", () => {
    expect(s3Src).toMatch(/^"use client";/);
  });

  it("reuses the currency-aware price + avatar helpers from purchase-data", () => {
    expect(s3Src).toMatch(/formatPurchaseMoney/);
    expect(s3Src).toMatch(/swatchGradient/);
    expect(s3Src).toMatch(/from "\.\/purchase-data"/);
  });

  it("renders the product name and locked price", () => {
    expect(s3Src).toMatch(/product\.name/);
    expect(s3Src).toMatch(
      /formatPurchaseMoney\(product\.priceCents, product\.currency\)/,
    );
    expect(s3Src).toMatch(/LOCKS AT REQUEST/);
  });

  it("maps the what's-included list, hidden when deliverables are empty", () => {
    expect(s3Src).toMatch(/product\.includes\.map/);
    expect(s3Src).toMatch(/product\.includes\.length > 0 \? \(/);
  });

  it("shows the producer mini-row (avatar gradient + name)", () => {
    expect(s3Src).toMatch(/swatchGradient\(producer\.hue\)/);
    expect(s3Src).toMatch(/producer\.name/);
  });

  it("shows the payment-plan hint card with per-plan chips (handoff-4 ticket)", () => {
    expect(s3Src).toMatch(/The artist picks after\s+approval/);
    expect(s3Src).toMatch(/PLAN_CHIP_LABELS/);
    expect(s3Src).toMatch(/product\.paymentPlans\.map/);
  });

  it("shows concise product-level royalty terms before the request action", () => {
    expect(s3Src).toMatch(/Rights & royalties/);
    expect(s3Src).toMatch(/royaltyTermsDisplay/);
    expect(s3Src).toMatch(/product\.royaltyTerms\?\.notes/);
  });

  it("backs out to the producer's store from the collapsing StickyNav", () => {
    expect(s3Src).toMatch(/<StickyNav/);
    expect(s3Src).toMatch(/router\.push\("\/artist\/store"\)/);
  });

  it("routes the primary CTA to the agree screen", () => {
    expect(s3Src).toMatch(/Request to book/);
    expect(s3Src).toMatch(
      /previewAgreeHref \?\? `\/artist\/purchase\/\$\{productId\}\/agree`/,
    );
  });

  it("disables the CTA while any purchase still has a balance", () => {
    expect(s3Src).toMatch(/pendingRequest/);
    expect(s3Src).toMatch(/active purchase/);
    expect(s3Src).toMatch(/fully paid/);
  });

  it("gives the Store text action a full mobile touch target", () => {
    expect(s3Src).toMatch(/min-h-11/);
  });
});
