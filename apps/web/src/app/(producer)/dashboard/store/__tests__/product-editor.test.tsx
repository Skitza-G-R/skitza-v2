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

  it("keeps the session choice canonical across new, restored, preset, and edited drafts", () => {
    expect(SRC).toMatch(/bookingEnabled:\s*false/);
    expect(SRC).toMatch(/const includesSessions = product\.bookingEnabled/);
    expect(SRC).toMatch(/bookingEnabled:\s*includesSessions/);
    expect(SRC).toMatch(/bookingEnabled:\s*preset\.preset\.includesSessions/);
    expect(SRC).toMatch(/bookingEnabled=\{draft\.bookingEnabled\}/);
    expect(PAYLOAD_SRC).toMatch(/bookingEnabled:\s*includesSessions/);
  });

  it("returns both canonical session fields after submission", () => {
    expect(SRC).toMatch(
      /onSubmittedResult\?:\s*\(result:\s*\{[\s\S]*?includesSessions:\s*boolean;[\s\S]*?bookingEnabled:\s*boolean;/,
    );
    expect(SRC).toMatch(
      /onSubmittedResult\?\.\(\{[\s\S]*?includesSessions:\s*draft\.includesSessions,[\s\S]*?bookingEnabled:\s*draft\.bookingEnabled/,
    );
  });

  it("requires a duration and valid count whenever sessions are included", () => {
    const start = SRC.indexOf("const validDelivery");
    const end = SRC.indexOf("const validDetails", start);
    const validation = SRC.slice(start, end);

    expect(validation).toMatch(/!draft\.includesSessions/);
    expect(validation).toMatch(/\/\^\\d\+\\s\*min\$\/i\.test\(draft\.duration\)/);
    expect(validation).toMatch(/Number\.isInteger\(draft\.sessions\)/);
    expect(validation).not.toContain("!draft.bookingEnabled");
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

  it("passes an optional presentation through without changing Store's dialog default", () => {
    expect(SRC).toContain('presentation?: "dialog" | "embedded"');
    expect(SRC).toContain('presentation = "dialog"');
    expect(SRC).toContain("presentation={presentation}");
  });

  it("calls a packages.create or .update server action", () => {
    expect(SRC).toMatch(/createPackage|updatePackage|packages\.create|packages\.update/);
  });

  it("keeps catalog saves online-only and handles transport failures locally", () => {
    expect(SRC).toContain("useOnlineStatus");
    expect(SRC).toContain("Reconnect to save this product.");
    expect(SRC).toContain("Could not save this product. Please try again.");
  });

  it("flushes an edit synchronously when client navigation unmounts inside the debounce", () => {
    const debounceStart = SRC.indexOf("const timeout = window.setTimeout");
    const lifecycleStart = SRC.indexOf("const flush = () =>", debounceStart);
    const lifecycleEnd = SRC.indexOf("function handleEditorOpenChange", lifecycleStart);
    const lifecycle = SRC.slice(lifecycleStart, lifecycleEnd);

    expect(debounceStart).toBeGreaterThan(-1);
    expect(SRC.slice(debounceStart, lifecycleStart)).toContain("}, 250)");
    expect(lifecycle).toContain("latestPersistedDraftRef.current");
    expect(lifecycle).toMatch(/return \(\) => \{[\s\S]*flush\(\);[\s\S]*\};/);
  });

  it("makes a delayed autosave fail closed after successful submit clears its ref", () => {
    const debounceStart = SRC.indexOf("const timeout = window.setTimeout");
    const debounceEnd = SRC.indexOf("}, 250)", debounceStart);
    const debounce = SRC.slice(debounceStart, debounceEnd);

    expect(debounce).toContain("latestPersistedDraftRef.current");
    expect(debounce).toContain("latest && onPersistDraft(latest)");
    expect(debounce).not.toContain("onPersistDraft(nextRecord)");
  });

  it("keeps the unmount flush available for an ordinary close", () => {
    const handlerStart = SRC.indexOf("function handleEditorOpenChange");
    const handlerEnd = SRC.indexOf("function handleSuccessfulSubmit", handlerStart);
    const handler = SRC.slice(handlerStart, handlerEnd);
    const persistIndex = handler.indexOf("onPersistDraft(latest)");
    const clearIndex = handler.indexOf("latestPersistedDraftRef.current = null");
    const closeIndex = handler.indexOf("onOpenChange(nextOpen)");

    expect(handlerStart).toBeGreaterThan(-1);
    expect(persistIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeGreaterThan(persistIndex);
    expect(closeIndex).toBeGreaterThan(clearIndex);
    expect(SRC).toContain("onOpenChange={handleEditorOpenChange}");
  });

  it("clears the saved draft only after a successful submit", () => {
    const closeStart = SRC.indexOf("function handleSuccessfulSubmit");
    const closeEnd = SRC.indexOf("function handleDiscardDraft", closeStart);
    const close = SRC.slice(closeStart, closeEnd);
    const saveStart = SRC.indexOf("function save(active: boolean)");
    const saveEnd = SRC.indexOf("const basePriceCents", saveStart);
    const save = SRC.slice(saveStart, saveEnd);

    expect(close).toContain("latestPersistedDraftRef.current = null");
    expect(close).toContain("onSubmitted()");
    expect(close).toContain("onOpenChange(false)");
    expect(save).toContain("handleSuccessfulSubmit()");
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

  it("threads the product's real signed-in Store placement into Review", () => {
    expect(SRC).toMatch(/previewPlacement\?:\s*"focal" \| "secondary"/);
    expect(SRC).toMatch(/previewPlacement=\{previewPlacement\}/);
  });

  it("uses the dedicated Payment step without duplicate pricing controls", () => {
    expect(SRC).not.toMatch(/showPaymentPlans/);
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

  it("hides untouched rights errors but surfaces required legacy-link replacement", () => {
    expect(SRC).toContain("visibleRoyaltyErrors");
    expect(SRC).toMatch(/rightsTouched\.master\s*&&\s*royaltyErrors\.master/);
    expect(SRC).toMatch(
      /rightsTouched\.agreement\s*\|\|\s*draft\._legacyAgreementLink\s*\?\s*agreementError/,
    );
    expect(SRC).toContain("Replace the old agreement link with the exact terms before saving.");
  });

  it("allows save only from the Review step", () => {
    expect(SRC).toMatch(/currentStep\s*!==\s*"review"/);
  });

  it("requires an exact tagline and positive cash price before Review", () => {
    expect(SRC).toMatch(/productTaglineError\(draft\.tagline\)/);
    expect(SRC).toMatch(/productCashPriceError\(draft\)/);
    expect(SRC).toMatch(/paymentPlanFeasibilityError\(draft\)/);
    expect(SRC).toMatch(/tagline=\{draft\.tagline\}/);
    expect(SRC).toMatch(/priceError=\{priceError\}/);
  });

  it("creates live and hidden products atomically through the same create call", () => {
    expect(SRC).toMatch(/createPackage\(\{\s*\.\.\.payload,\s*active\s*\}/);
    expect(SRC).toMatch(/onPublish/);
    expect(SRC).toMatch(/onSaveHidden/);
  });

  it("models bookable sessions independently from the product type", () => {
    expect(SRC).toMatch(/includesSessions/);
    expect(SRC).toMatch(/const includesSessions = product\.bookingEnabled/);
    expect(SRC).toMatch(/includesSessions=\{draft\.includesSessions\}/);
    expect(SRC).not.toMatch(/draft\.type\s*===\s*"mix"[\s\S]{0,120}includesSessions/);
  });

  it("shows actual draft persistence and supports an explicit discard", () => {
    expect(SRC).toMatch(/draftSaved=\{draftSaved\}/);
    expect(SRC).toMatch(/onDiscardDraft/);
    expect(SRC).toMatch(/onDiscard=/);
  });

  it("uses read-only global tax state in the product flow", () => {
    expect(SRC).not.toMatch(/function onTaxChange/);
    expect(SRC).not.toMatch(/updateProducer/);
    expect(SRC).not.toMatch(/onTaxChange=/);
  });
});
