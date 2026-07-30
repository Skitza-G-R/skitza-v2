import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "private-offer-composer.tsx"), "utf8");

describe("PrivateOfferComposer", () => {
  it("exports a stable action and props contract", () => {
    expect(SRC).toMatch(/export interface PrivateOfferComposerProps/);
    expect(SRC).toMatch(/export interface SendPrivateOfferComposerPayload/);
    expect(SRC).toMatch(/export interface UpdatePrivateOfferComposerPayload/);
    expect(SRC).toMatch(/expectedUpdatedAt:\s*string/);
    expect(SRC).toMatch(/terms:\s*PrivateOfferInput/);
  });

  it("supports controlled or uncontrolled opening without changing the default trigger", () => {
    expect(SRC).toMatch(/open\?:\s*boolean/);
    expect(SRC).toMatch(/onOpenChange\?:\s*\(open:\s*boolean\)\s*=>\s*void/);
    expect(SRC).toMatch(/trigger\?:\s*ReactElement\s*\|\s*null/);
    expect(SRC).toMatch(/const \[uncontrolledOpen, setUncontrolledOpen\] = useState\(false\)/);
    expect(SRC).toMatch(/const open = controlledOpen \?\? uncontrolledOpen/);
    expect(SRC).toMatch(/if \(controlledOpen === undefined\) setUncontrolledOpen\(nextOpen\)/);
    expect(SRC).toMatch(/onOpenChange\?\.\(nextOpen\)/);
    expect(SRC).toMatch(/<DialogPrimitive\.Root open=\{open\} onOpenChange=\{handleOpenChange\}>/);
    expect(SRC).toMatch(/trigger !== null/);
    expect(SRC).toMatch(/trigger \?\? \([\s\S]*?New private offer/);
    expect(SRC).toContain("bg-[rgb(var(--brand-primary))]");
  });

  it("lets a controlled caller refresh only after a successful create", () => {
    expect(SRC).toMatch(/onCreated\?:\s*\(offerId:\s*string\)\s*=>\s*void/);
    expect(SRC).toMatch(
      /if \(!result\.ok\)[\s\S]*?return;[\s\S]*?if \(!editing\) onCreated\?\.\(result\.data\.id\);[\s\S]*?handleOpenChange\(false\);[\s\S]*?if \(editing \|\| !onCreated\) router\.refresh\(\)/,
    );
    expect(SRC).not.toMatch(
      /handleOpenChange\(false\);[\s\S]{0,80}onCreated\?\.\(result\.data\.id\)/,
    );
  });

  it("restores focus to an explicit connected target after a headless composer closes", () => {
    expect(SRC).toMatch(/returnFocusRef\?:\s*RefObject<HTMLElement\s*\|\s*null>/);
    expect(SRC).toMatch(
      /onCloseAutoFocus=\{\(event\)\s*=>\s*\{[\s\S]*?returnFocusRef\?\.current[\s\S]*?!target\?\.isConnected[\s\S]*?event\.preventDefault\(\)[\s\S]*?target\.focus\(\)/,
    );
  });

  it("uses authenticated server actions for both create and pre-acceptance correction", () => {
    expect(SRC).toMatch(/sendPrivateOfferAction\(/);
    expect(SRC).toMatch(/updatePrivateOfferAction\(/);
    expect(SRC).toMatch(/Save corrections/);
    expect(SRC).not.toMatch(/useMutation/);
  });

  it("keeps a sent offer in app when the notification email fails", () => {
    expect(SRC).toMatch(/"emailDelivered" in result\.data/);
    expect(SRC).toContain("Offer saved, but the notification email could not be sent");
    expect(SRC).toContain("It is still available in the app.");
  });

  it("uses a portaled Radix dialog with a phone-safe bottom sheet", () => {
    expect(SRC).toMatch(/@radix-ui\/react-dialog/);
    expect(SRC).toMatch(/<DialogPrimitive\.Portal>/);
    expect(SRC).toContain("max-sm:max-h-[94dvh]");
    expect(SRC).toContain("max-sm:w-full");
    expect(SRC).toContain("safe-area-inset-bottom");
    expect(SRC).toContain("overflow-y-auto");
  });

  it("guides the private offer through five validated steps", () => {
    for (const step of ["recipient", "work", "payment", "rights", "agreement"]) {
      expect(SRC).toContain(`id: "${step}"`);
    }
    expect(SRC).toMatch(
      /const \[currentStep, setCurrentStep\] = useState<OfferStep>\("recipient"\)/,
    );
    expect(SRC).toMatch(/setCurrentStep\("recipient"\)/);
    expect(SRC).toContain('aria-label="Private offer progress"');
    expect(SRC).toContain('aria-current={index === currentStepIndex ? "step" : undefined}');
    expect(SRC).toContain("Step {currentStepIndex + 1} of {OFFER_STEPS.length}");
    expect(SRC).toContain("Back");
    expect(SRC).toContain("Next");
    expect(SRC).toMatch(/if \(!isLastStep\)[\s\S]*?currentStepResult\(\)/);
  });

  it("supports an existing recipient or a new verified-email recipient", () => {
    expect(SRC).toMatch(/kind:\s*"existing";\s*clientContactId:\s*string/);
    expect(SRC).toMatch(/kind:\s*"new";\s*name:\s*string;\s*email:\s*string/);
    expect(SRC).toContain("Verified account email");
    expect(SRC).toMatch(/newRecipientEmail\.trim\(\)\.toLowerCase\(\)/);
  });

  it("defaults to a new project and only offers the selected client's projects", () => {
    expect(SRC).toMatch(
      /targetKind:\s*props\.initialOffer\?\.targetProjectId\s*\?\s*"existing"\s*:\s*"new"/,
    );
    expect(SRC).toMatch(/projectOptionsByClient\[selectedClientId\] \?\? \[\]/);
    expect(SRC).toMatch(
      /availableProjects\.some\(\(project\) => project\.id === draft\.targetProjectId\)/,
    );
    expect(SRC).toContain("New project");
    expect(SRC).toContain("Existing project");
  });

  it("loads exact same-client project context before an existing target can be chosen", () => {
    expect(SRC).toMatch(/loadPrivateOfferProjectOptionsAction\(selectedClientId\)/);
    expect(SRC).toMatch(/!projectOptionsLoaded/);
    expect(SRC).toContain("No purchase balance");
    expect(SRC).toContain("Paid");
    expect(SRC).toContain("Balance:");
    expect(SRC).toMatch(/project\.songCount === 1 \? "song" : "songs"/);
    expect(SRC).toMatch(/privateOfferProjectOptionLabel\(project\)/);
    expect(SRC).toMatch(/Selected:\s*\{privateOfferProjectOptionLabel\(selectedTargetProject\)\}/);
    expect(SRC).toContain("[overflow-wrap:anywhere]");
  });

  it("captures every commercial term required by SK-96", () => {
    for (const label of [
      "Offer name",
      "Service",
      "Deliverables",
      "Included song spaces",
      "Session allowance",
      "Cash price",
      "Currency",
      "Tax treatment",
      "Enabled payment plans",
      "Master royalty",
      "Composition royalty",
      "Rights",
      "Revisions",
      "Exact agreement",
      "Expires",
    ]) {
      expect(SRC).toContain(label);
    }
  });

  it("allows true zero cash and clears/disables every payment plan", () => {
    expect(SRC).toMatch(
      /nextCents === 0[\s\S]{0,180}fullPlan: false[\s\S]{0,180}splitPlan: false[\s\S]{0,180}monthlyPlan: false/,
    );
    expect(SRC).toMatch(/if \(cashPriceCents > 0\)/);
    expect(SRC).toMatch(/fieldset disabled=\{zeroCash\}/);
    expect(SRC).toContain("No plan is created for a ₪0 / royalty-only acceptance.");
  });

  it("offers Full, 50/50, and bounded Monthly plans", () => {
    expect(SRC).toMatch(/kind:\s*"full"/);
    expect(SRC).toMatch(/kind:\s*"split_50_50"/);
    expect(SRC).toMatch(/kind:\s*"monthly", installments/);
    expect(SRC).toMatch(/positiveInteger\(draft\.monthlyInstallments, 2, 12\)/);
  });

  it("enforces the domain text limits before sending", () => {
    expect(SRC).toMatch(/const MAX_SERVICE_LENGTH = 200/);
    expect(SRC).toMatch(/const MAX_DELIVERABLES = 20/);
    expect(SRC).toMatch(/const MAX_DELIVERABLE_LENGTH = 500/);
    expect(SRC).toMatch(/deliverables\.length > MAX_DELIVERABLES/);
    expect(SRC).toMatch(
      /deliverables\.some\(\(deliverable\) => deliverable\.length > MAX_DELIVERABLE_LENGTH\)/,
    );
    expect(SRC).toMatch(/const MAX_RIGHTS = 20/);
    expect(SRC).toMatch(/const MAX_RIGHT_LENGTH = 1_000/);
    expect(SRC).toMatch(/rights\.length > MAX_RIGHTS/);
    expect(SRC).toMatch(/rights\.some\(\(right\) => right\.length > MAX_RIGHT_LENGTH\)/);
    expect(SRC).toMatch(/const MAX_AGREEMENT_LENGTH = 50_000/);
    expect(SRC).toMatch(/agreementText\.length > MAX_AGREEMENT_LENGTH/);
    expect(SRC).toMatch(/maxLength=\{MAX_SERVICE_LENGTH\}/);
    expect(SRC).toMatch(/maxLength=\{MAX_DELIVERABLES_TEXT_LENGTH\}/);
    expect(SRC).toMatch(/maxLength=\{MAX_RIGHTS_TEXT_LENGTH\}/);
    expect(SRC).toMatch(/maxLength=\{MAX_AGREEMENT_LENGTH\}/);
  });

  it("rejects a cash price above the database cents limit before sending", () => {
    expect(SRC).toMatch(/const MAX_CASH_PRICE_CENTS = 2_147_483_647/);
    expect(SRC).toMatch(/cashPriceCents > MAX_CASH_PRICE_CENTS/);
    expect(SRC).toContain("Cash price cannot exceed 21,474,836.47.");
  });

  it("captures fixed or unlimited sessions and revisions", () => {
    expect(SRC).toMatch(/sessionLimitMode:\s*LimitMode/);
    expect(SRC).toMatch(/revisionMode:\s*LimitMode/);
    expect(SRC).toMatch(/kind:\s*"unlimited"/);
    expect(SRC).toMatch(/kind:\s*"fixed", count/);
  });

  it("requires exact agreement text and defaults expiry to fourteen days", () => {
    expect(SRC).toMatch(/if \(!agreementText\) return \{ error: "Write the exact agreement/);
    expect(SRC).toMatch(/expiry\.setDate\(expiry\.getDate\(\) \+ 14\)/);
    expect(SRC).toMatch(/expiry\.toISOString\(\)/);
    expect(SRC).toContain("Defaults to 14 days from now.");
  });

  it("uses design tokens and rectangular radii for text controls", () => {
    expect(SRC).toContain("rgb(var(--brand-primary))");
    expect(SRC).toContain("rounded-[var(--radius-lg)]");
    expect(SRC).not.toContain("var(--brand-primary-on)");
    expect(SRC).not.toContain("var(--surface-card)");
  });
});
