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
  it("shows real Bank and Bit details as separate copyable cards", () => {
    expect(screenSource).toMatch(/Bank transfer/);
    expect(screenSource).toMatch(/Bit number/);
    expect(screenSource).toMatch(/CopyButton/);
    expect(screenSource).not.toMatch(/role="tab"/);
    expect(screenSource).not.toMatch(/Pay by card|Stripe|Tranzila/i);
  });

  it("keeps the off-app money boundary explicit", () => {
    expect(screenSource).toMatch(
      /Skitza records your proof\.[\s\S]*It does not[\s\S]*process, hold, or move money\./,
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

  it("keeps proof upload available when Bank and Bit are both missing", () => {
    expect(pageSource).not.toMatch(/data\.bankTransfer\?\.trim\(\)/);
    expect(pageSource).not.toMatch(/data\.bitPhone\?\.trim\(\)/);
    expect(pageSource).not.toContain("notice=no-instructions");
    expect(screenSource).toContain("will send payment details directly");
    expect(screenSource).toMatch(
      /proofUploadsAvailable && Boolean\(proofHref \|\| previewProofHref\)/,
    );
  });

  it("does not treat a payment note as a Bank or Bit method", () => {
    const methodGate = screenSource.slice(
      screenSource.indexOf("const hasPaymentMethod"),
      screenSource.indexOf("const canUpload"),
    );
    expect(methodGate).toMatch(/bankTransfer/);
    expect(methodGate).toMatch(/bitPhone/);
    expect(methodGate).not.toMatch(/\.note/);
  });
});
