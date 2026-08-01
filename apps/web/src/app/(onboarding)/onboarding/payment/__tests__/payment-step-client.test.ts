import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  nextRouteAfterPayment,
  routeOnBackFromPayment,
  routeOnSkipFromPayment,
} from "../constants";

const here = dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(join(here, "..", "payment-step-client.tsx"), "utf8");
const constantsSource = readFileSync(join(here, "..", "constants.ts"), "utf8");
const pageSource = readFileSync(join(here, "..", "page.tsx"), "utf8");
const actionSource = readFileSync(join(here, "..", "actions.ts"), "utf8");

describe("onboarding external-payment boundary", () => {
  it("explains direct payment and the private proof flow", () => {
    expect(clientSource).toContain("External payments only");
    expect(clientSource).toMatch(/never holds, routes, or processes\s+money/);
    expect(clientSource).toContain("only after you approve their request");
    expect(clientSource).toContain("uploads proof");
    expect(clientSource).toContain("verify or reject");
    expect(clientSource).not.toMatch(
      /Stripe|PayPal|Apple Pay|credit card|PayoutId|data-stripe-card|aria-pressed/i,
    );
  });

  it("renders every optional bank and Bit field", () => {
    expect(clientSource).toContain('label="Account owner"');
    expect(clientSource).toContain('label="Bank"');
    expect(clientSource).toContain('label="Branch"');
    expect(clientSource).toContain('label="Account number"');
    expect(clientSource).toContain('label="Bit phone"');
    expect(clientSource).toContain('htmlFor="payment-note"');
  });

  it("hydrates and saves through the producer-scoped payment contract", () => {
    expect(pageSource).toContain("producer.purchase.paymentInstructions.get()");
    expect(actionSource).toContain("producer.purchase.paymentInstructions.update(input)");
    expect(clientSource).toContain("saveOnboardingPaymentInstructions");
    expect(clientSource).toContain("initialInstructions.bankTransfer");
  });

  it("keeps the existing optional-step routes and avoids provider promises", () => {
    expect(clientSource).toContain("routeOnSkipFromPayment(previewMode)");
    expect(clientSource).not.toMatch(/invoice|connect later|Settings → Payouts/i);
    expect(constantsSource).not.toMatch(/invoice|Stripe|PayPal|connect later/i);
    expect(constantsSource).toContain("Skitza does not process or route money");
  });

  it("returns Back, Skip, and Continue to the completion screen", () => {
    expect(nextRouteAfterPayment()).toBe("/onboarding/complete");
    expect(routeOnSkipFromPayment()).toBe("/onboarding/complete");
    expect(routeOnBackFromPayment()).toBe("/onboarding/complete");
  });

  it("preserves the local preview query on every route", () => {
    expect(nextRouteAfterPayment(true)).toBe("/onboarding/complete?__preview=1");
    expect(routeOnSkipFromPayment(true)).toBe("/onboarding/complete?__preview=1");
    expect(routeOnBackFromPayment(true)).toBe("/onboarding/complete?__preview=1");
    expect(pageSource).toContain(
      "<PaymentStepClient previewMode initialInstructions={EMPTY_PAYMENT_INSTRUCTIONS} />",
    );
  });

  it("is clearly post-publish optional and hides numbered setup progress", () => {
    expect(clientSource).toContain("hideOuterProgress");
    expect(clientSource).toContain('stepIndicator="Optional payment details"');
    expect(clientSource).not.toMatch(/Step 5 of 5/);
    expect(clientSource).toContain("Your public page is already ready");
  });

  it("does not write in local preview mode", () => {
    const previewBranch = clientSource.indexOf("if (previewMode)");
    const saveCall = clientSource.indexOf("await saveOnboardingPaymentInstructions");
    expect(previewBranch).toBeGreaterThan(-1);
    expect(saveCall).toBeGreaterThan(previewBranch);
  });
});
