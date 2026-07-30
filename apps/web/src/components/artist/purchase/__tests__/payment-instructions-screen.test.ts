import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const screenSource = readFileSync(join(here, "..", "payment-instructions-screen.tsx"), "utf8");
const pageSource = readFileSync(
  join(
    here,
    "..",
    "..",
    "..",
    "..",
    "app",
    "(artist)",
    "artist",
    "payments",
    "[purchaseId]",
    "instructions",
    "page.tsx",
  ),
  "utf8",
);

describe("professional off-app payment instructions", () => {
  it("shows only real Bank or Bit details with one expanded method", () => {
    expect(screenSource).toMatch(/Bank transfer/);
    expect(screenSource).toMatch(/label: "Bit"/);
    expect(screenSource).toMatch(/methods\.find/);
    expect(screenSource).toMatch(/role="tab"/);
    expect(screenSource).not.toMatch(/Pay by card|Stripe|Tranzila/i);
  });

  it("keeps the off-app money boundary explicit", () => {
    expect(screenSource).toContain(
      "Skitza records your proof. It does not process, hold, or move money.",
    );
    expect(screenSource).toContain("PAID DIRECTLY TO THE STUDIO");
  });

  it("returns to the standing summary and opens the exact new-proof step", () => {
    expect(screenSource).toMatch(/summaryHref/);
    expect(pageSource).toMatch(
      /\/artist\/payments\/\$\{encodeURIComponent\(data\.purchaseId\)\}\/proof\/new/,
    );
    expect(pageSource).toMatch(/installment: data\.installmentId/);
  });

  it("never enters instructions or proof upload without a producer method", () => {
    expect(pageSource).toMatch(/data\.bankTransfer\?\.trim\(\)/);
    expect(pageSource).toMatch(/data\.bitPhone\?\.trim\(\)/);
    expect(pageSource).toContain("notice=no-instructions");
    expect(screenSource).toMatch(/Proof upload becomes\s+available only after a real payment method/);
  });
});
