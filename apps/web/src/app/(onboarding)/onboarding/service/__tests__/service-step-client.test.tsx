import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildPackagePayload } from "~/app/(producer)/dashboard/store/build-package-payload";
import { decodeDescription } from "~/app/(producer)/dashboard/store/description-encoding";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "service-step-client.tsx"), "utf8");

describe("onboarding first-service commercial terms", () => {
  it("uses the seven-step Store flow and saves only from Review", () => {
    expect(source).toMatch(
      /const STEPS:[\s\S]*"type",[\s\S]*"details",[\s\S]*"price",[\s\S]*"payment",[\s\S]*"delivery",[\s\S]*"rights",[\s\S]*"review"/,
    );
    expect(source).toMatch(/<PaymentStep/);
    expect(source).toMatch(/<RightsAgreementStep/);
    expect(source).toMatch(/<ReviewStep/);
    expect(source).toMatch(/if \(currentStep !== "review"\) return/);
    expect(source).toMatch(/showPaymentPlans=\{false\}/);
    expect(source).toMatch(/allowPerSong=\{false\}/);
    expect(source).toMatch(/showTypeEdit=\{true\}/);
    expect(source).toMatch(/setReturnToReview\(true\)/);
    expect(source).toMatch(/setCurrentStep\("review"\)/);
  });

  it("uses multi-plan and explicit royalty draft helpers", () => {
    expect(source).toMatch(/PaymentSelectionDraft/);
    expect(source).toMatch(/ProductRoyaltyDraft/);
    expect(source).toMatch(/buildPaymentPlans/);
    expect(source).toMatch(/hasPaymentOption/);
    expect(source).toMatch(/validateRoyaltyDraft\(draft\.royalty, true\)/);
    expect(source).toMatch(/royaltyDraftToTerms/);
  });

  it("builds the onboarding payload with dedicated agreement and deliverables", () => {
    const payload = buildPackagePayload({
      name: "First production",
      tagline: "From demo to master.",
      type: "production",
      price: 2_500,
      currency: "USD",
      sessions: 8,
      unlimitedSessions: false,
      payment: {
        full: true,
        split50: true,
        monthly: true,
        monthlyInstallments: 6,
        preservedPlans: [],
      },
      includes: ["Tracking", "Mix", "Master"],
      duration: "60 min",
      revisions: 3,
      unlimitedRevisions: false,
      agreementMode: "text",
      contractUrl: "",
      agreementText: "Credit and delivery terms.",
      royalty: {
        masterMode: "percentage",
        masterPercentage: "2.5",
        compositionMode: "percentage",
        compositionPercentage: "12.5",
        compositionRole: "composer",
        collectingSociety: "ACUM",
        notes: "Headline terms only.",
      },
      pricingModel: "flat",
      volumeTiers: [],
    });

    expect(payload.paymentPlans).toEqual([
      { kind: "full" },
      { kind: "split_50_50" },
      { kind: "monthly", installments: 6 },
    ]);
    expect(payload.deliverables).toEqual(["Tracking", "Mix", "Master"]);
    expect(payload.royaltyTerms).toEqual({
      master: { mode: "percentage", bps: 250 },
      composition: {
        mode: "percentage",
        bps: 1250,
        role: "composer",
        collectingSociety: "ACUM",
      },
      notes: "Headline terms only.",
    });
    expect(payload.agreementText).toBe("Credit and delivery terms.");
    expect(payload.contractUrl).toBeNull();
    expect(decodeDescription(payload.description)).toEqual({
      tagline: "From demo to master.",
      revisions: 3,
      unlimitedRevisions: false,
      contractText: "",
    });
  });
});
