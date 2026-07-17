import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "product-editor.tsx"), "utf8");
const PAYLOAD_SRC = readFileSync(join(here, "..", "build-package-payload.ts"), "utf8");

describe("ProductEditor orchestrator", () => {
  it("declares both NEW_STEPS and EDIT_STEPS arrays", () => {
    expect(SRC).toMatch(/NEW_STEPS[^=]*=\s*\[/);
    expect(SRC).toMatch(/EDIT_STEPS[^=]*=\s*\[/);
  });

  it("NEW_STEPS follows Type through required Review", () => {
    expect(SRC).toMatch(
      /NEW_STEPS[\s\S]*?"type"[\s\S]*?"details"[\s\S]*?"price"[\s\S]*?"payment"[\s\S]*?"delivery"[\s\S]*?"rights"[\s\S]*?"review"/,
    );
  });

  it("EDIT_STEPS uses the same flow without Type", () => {
    expect(SRC).toMatch(
      /EDIT_STEPS[\s\S]*?"details"[\s\S]*?"price"[\s\S]*?"payment"[\s\S]*?"delivery"[\s\S]*?"rights"[\s\S]*?"review"/,
    );
  });

  it("renders all seven step components", () => {
    expect(SRC).toMatch(/<TypeStep/);
    expect(SRC).toMatch(/<IncludesStep/);
    expect(SRC).toMatch(/<PricingStep/);
    expect(SRC).toMatch(/<PaymentStep/);
    expect(SRC).toMatch(/<LogisticsStep/);
    expect(SRC).toMatch(/<RightsAgreementStep/);
    expect(SRC).toMatch(/<ReviewStep/);
  });

  it("imports decodeDescription for edit-mode round-trip (encode lives in build-package-payload)", () => {
    expect(SRC).toMatch(/decodeDescription/);
    // After the Task 11 extraction, encodeDescription is called by
    // buildPackagePayload at save time — assert there, not here.
    expect(PAYLOAD_SRC).toMatch(/encodeDescription/);
  });

  it("mounts the EditorShell", () => {
    expect(SRC).toMatch(/<EditorShell/);
  });

  it("calls a packages.create or .update server action", () => {
    expect(SRC).toMatch(/createPackage|updatePackage|packages\.create|packages\.update/);
  });

  it("maps preset type 'consult' to schema kind 'custom' on save (logic in build-package-payload)", () => {
    expect(PAYLOAD_SRC).toMatch(/draft\.type\s*===\s*["']consult["']/);
    expect(PAYLOAD_SRC).toMatch(/["']custom["']\s+as\s+PackageKind/);
  });

  it("does NOT use window.confirm anywhere", () => {
    expect(SRC).not.toMatch(/window\.confirm/);
  });

  it("accepts an optional onCreated callback", () => {
    expect(SRC).toMatch(/onCreated\?:\s*\(id:\s*string\)\s*=>\s*void/);
  });

  it("invokes onCreated on the create-mode save success path", () => {
    expect(SRC).toMatch(/onCreated\?\.\(/);
  });

  it("hides the legacy payment panel from Price", () => {
    expect(SRC).toMatch(/showPaymentPlans=\{false\}/);
  });

  it("uses purchase-level plans without deposit or milestone compatibility fields", () => {
    expect(SRC).not.toMatch(/depositModel|milestones|preservedPlans/);
    expect(PAYLOAD_SRC).not.toMatch(/depositPct|depositModel|milestones|preservedPlans/);
  });

  it("keeps the producer on Type after choosing a preset", () => {
    const start = SRC.indexOf("function onPickPreset");
    const end = SRC.indexOf("const currentStepIndex", start);
    const handler = SRC.slice(start, end);

    expect(handler).toContain("setDraft");
    expect(handler).not.toContain('setCurrentStep("details")');
  });

  it("does not show rights validation errors before that section is touched", () => {
    expect(SRC).toContain("visibleRoyaltyErrors");
    expect(SRC).toMatch(/rightsTouched\.master\s*&&\s*royaltyErrors\.master/);
    expect(SRC).toMatch(/rightsTouched\.agreement\s*\?\s*agreementError/);
  });

  it("allows save only from the Review step", () => {
    expect(SRC).toMatch(/currentStep\s*!==\s*"review"/);
  });
});
