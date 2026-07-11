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

// Real unit tests for the pure data helpers (no rendering needed), plus
// source-grep on the screens for the wiring that matters — matching the
// repo's existing test style (see store-product-client.test.ts).

describe("purchase-data helpers", () => {
  it("formats agorot as whole grouped shekels", () => {
    expect(formatShekels(240000)).toBe("₪2,400");
    expect(formatShekels(90000)).toBe("₪900");
  });

  it("formats the exact product currency for agreement surfaces", () => {
    expect(formatPurchaseMoney(240000, "USD")).toBe("$2,400");
    expect(formatPurchaseMoney(90050, "EUR")).toBe("€900.50");
  });

  it("builds the agreement summary with the producer name woven in", () => {
    const terms = buildAgreementTerms("Gili Studio", ["Mix", "Master"]);
    expect(terms).toHaveLength(7);
    expect(terms[0]?.body).toContain("Gili Studio");
    const included = terms.find((t) => t.heading === "What's included");
    expect(included?.points).toEqual(["Mix", "Master"]);
  });

  it("falls back to a generic covers-line when deliverables are empty", () => {
    expect(includesOrFallback([], "Gili Studio")).toEqual([
      "Everything agreed with Gili Studio for this offer",
    ]);
    const terms = buildAgreementTerms("Gili Studio", []);
    const included = terms.find((t) => t.heading === "What's included");
    expect(included?.points?.length).toBe(1);
  });
});

const here = dirname(fileURLToPath(import.meta.url));
const S4_PATH = join(here, "..", "review-agree-screen.tsx");
const S5_PATH = join(here, "..", "request-sent-screen.tsx");
const FUNNEL_UI_PATH = join(here, "..", "..", "funnel", "funnel-ui.tsx");
const s4Src = readFileSync(S4_PATH, "utf8");
const s5Src = readFileSync(S5_PATH, "utf8");
const funnelUiSrc = readFileSync(FUNNEL_UI_PATH, "utf8");

describe("review-agree-screen.tsx (S4) wiring", () => {
  it("gates the primary action on the agree checkbox + sending state", () => {
    expect(s4Src).toMatch(/disabled=\{!agreed \|\| sending\}/);
    expect(s4Src).toMatch(/<AgreeCheck/);
  });

  it("fires the real BE-1 request action, then routes to S5 with the request id", () => {
    expect(s4Src).toMatch(/commercialTermsFingerprint/);
    expect(s4Src).toMatch(/requestToBookAction\(\{[\s\S]*?productId: product\.id/);
    expect(s4Src).toMatch(
      /router\.push\(`\/artist\/purchase\/\$\{product\.id\}\/sent\?req=\$\{res\.purchaseRequestId\}`\)/,
    );
    expect(s4Src).toMatch(/from "\.\/actions"/);
  });

  it("backs out to the S3 entry screen (not the legacy store detail)", () => {
    expect(s4Src).toMatch(/router\.push\(`\/artist\/purchase\/\$\{product\.id\}`\)/);
  });

  it("hides the PDF card when the producer has no uploaded agreement", () => {
    expect(s4Src).toMatch(/\{producer\.agreement \? \(/);
  });

  it("renders the exact royalty and inline agreement terms being accepted", () => {
    expect(s4Src).toMatch(/Rights & royalties/);
    expect(s4Src).toMatch(/royaltyTermsDisplay/);
    expect(s4Src).toMatch(/formatPurchaseMoney\(product\.priceCents, product\.currency\)/);
    expect(s4Src).toMatch(/product\.royaltyTerms\?\.notes/);
    expect(s4Src).toMatch(/product\.agreementText/);
    expect(s4Src).toMatch(/whitespace-pre-wrap/);
  });

  it("designs an inline error state (not a scary wall)", () => {
    expect(s4Src).toMatch(/role="alert"/);
    expect(s4Src).toMatch(/setError/);
  });

  it("uses one natural page scroll so the agreement cannot trap mobile users", () => {
    expect(s4Src).not.toMatch(/max-h-\[256px\] overflow-y-auto/);
    expect(s4Src.match(/overflow-y-auto/g)?.length ?? 0).toBe(1);
  });

  it("keeps back and document actions at least 44px tall", () => {
    expect(s4Src).toMatch(/min-h-11/);
  });
});

describe("request-sent-screen.tsx (S5) wiring", () => {
  it("shows the booking reference and price-locked stub", () => {
    expect(s5Src).toMatch(/requestRef/);
    expect(s5Src).toMatch(/PRICE LOCKED/);
  });

  it("offers Home + back-to-store exits", () => {
    expect(s5Src).toMatch(/router\.push\("\/artist"\)/);
    expect(s5Src).toMatch(/router\.push\("\/artist\/store"\)/);
  });

  it("keeps the close control aligned to the centered 440px app panel", () => {
    expect(s5Src).toMatch(/mx-auto w-full max-w-\[440px\]/);
    expect(s5Src).not.toMatch(/absolute left-4 top-0/);
  });
});

describe("funnel mobile chrome", () => {
  it("uses a solid top bar that stays stable in narrow embedded browsers", () => {
    const topBar = funnelUiSrc.slice(
      funnelUiSrc.indexOf("export function FunnelTopBar"),
      funnelUiSrc.indexOf("export function GlassRound"),
    );
    expect(topBar).toMatch(/background: "rgb\(var\(--bg-background\)\)"/);
    expect(topBar).not.toMatch(/backdropFilter/);
  });
});
