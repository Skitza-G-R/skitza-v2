import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(join(here, "..", "payment-step-client.tsx"), "utf8");
const constantsSource = readFileSync(join(here, "..", "constants.ts"), "utf8");

describe("onboarding external-payment boundary", () => {
  it("explains direct payment without offering a provider choice", () => {
    expect(clientSource).toContain("External payments only");
    expect(clientSource).toContain("bank transfer, Bit, cash");
    expect(clientSource).toContain("does not take, hold, route");
    expect(clientSource).not.toMatch(
      /Stripe|PayPal|Apple Pay|Connect Stripe|PayoutId|data-stripe-card|aria-pressed/i,
    );
  });

  it("does not promise invoice tracking or a later provider connection", () => {
    expect(clientSource).not.toMatch(/invoice|connect later|Settings → Payouts/i);
    expect(constantsSource).not.toMatch(/invoice|Stripe|PayPal|connect later/i);
    expect(constantsSource).toContain("Skitza does not process or route money");
  });
});
