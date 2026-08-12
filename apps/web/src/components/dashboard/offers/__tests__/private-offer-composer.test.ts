import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const OFFERS_DIR = path.resolve(__dirname, "..");
const COMPOSER = fs.readFileSync(path.join(OFFERS_DIR, "private-offer-composer.tsx"), "utf8");
const MODEL = fs.readFileSync(path.join(OFFERS_DIR, "private-offer-editor-model.ts"), "utf8");
const STEPS = fs.readFileSync(path.join(OFFERS_DIR, "private-offer-editor-steps.tsx"), "utf8");
const REVIEW = fs.readFileSync(path.join(OFFERS_DIR, "private-offer-review.tsx"), "utf8");
const MANAGER = fs.readFileSync(path.join(OFFERS_DIR, "private-offer-manager.tsx"), "utf8");

describe("PrivateOfferComposer shared-product-editor contract", () => {
  it("uses the regular editor shell and regular leaf components", () => {
    expect(COMPOSER).toMatch(/import \{ EditorShell \}/);
    expect(COMPOSER).toMatch(/import \{ TypeStep \}/);
    expect(STEPS).toMatch(/import \{ PaymentStep \}/);
  });

  it("exports the pure canonical product template type and keeps edit mutually exclusive", () => {
    expect(COMPOSER).toMatch(/export type \{ PrivateOfferTemplateProduct \}/);
    expect(COMPOSER).toMatch(
      /initialOffer: PrivateOfferComposerInitialOffer;[\s\S]*templateProduct\?: never/,
    );
    expect(COMPOSER).toMatch(
      /initialOffer\?: undefined;[\s\S]*templateProduct\?: PrivateOfferTemplateProduct/,
    );
  });

  it("provides the two-step product quick path and the full shared path", () => {
    expect(COMPOSER).toContain('const QUICK_STEPS = ["quick", "review"] as const');
    expect(COMPOSER).toContain('"recipient",\n  "type",\n  "details"');
    expect(COMPOSER).toContain(
      'label: completeMissing ? "Complete missing terms" : "Customize terms"',
    );
  });

  it("requires full validation before exact Review", () => {
    expect(COMPOSER).toMatch(
      /flow === "quick" && currentStep === "quick"[\s\S]*validatePrivateOfferDraft/,
    );
    expect(REVIEW).toMatch(/<PrivateOfferTerms snapshot=\{snapshot\} targetLabel=\{targetLabel\}/);
  });

  it("does not seed the first recipient", () => {
    expect(MODEL).toContain('clientContactId: lockedClientId ?? ""');
    expect(MODEL).not.toMatch(/recipients\[0\]/);
  });

  it("uses one stable create id for retries and carries template provenance", () => {
    expect(COMPOSER).toContain("submissionOfferIdRef.current ?? crypto.randomUUID()");
    expect(COMPOSER).toContain("persistLatestDraft({ submissionOfferId: createOfferId })");
    expect(COMPOSER).toContain("sourceProductId: templateProduct.source.productId");
    expect(COMPOSER).toContain("clearLogicalDraftAndClose()");
  });

  it("passes the sent recipient identity into edit fallback state", () => {
    expect(MANAGER).toMatch(/recipientName:\s*offer\.recipientName/);
    expect(MANAGER).toMatch(/recipientEmail:\s*offer\.recipientEmail/);
  });

  it("preserves every private-only commercial field", () => {
    for (const field of [
      "taxMode",
      "taxRatePct",
      "includedSongSpaces",
      "session",
      "revisionRule",
      "royaltyTerms",
      "rights",
      "enabledPaymentPlans",
      "agreementText",
      "expiresAtLocal",
    ]) {
      expect(MODEL).toContain(field);
    }
  });

  it("uses 100dvh phone chrome through the shared shell", () => {
    const shell = fs.readFileSync(
      path.resolve(OFFERS_DIR, "../../../app/(producer)/dashboard/store/editor-shell.tsx"),
      "utf8",
    );
    expect(shell).toContain("max-sm:h-[100dvh]");
    expect(shell).toContain('progressLabel = "Product setup progress"');
  });
});
