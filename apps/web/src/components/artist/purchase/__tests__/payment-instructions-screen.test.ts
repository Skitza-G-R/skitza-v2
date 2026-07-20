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
    "purchase",
    "[productId]",
    "pay",
    "instructions",
    "page.tsx",
  ),
  "utf8",
);

describe("PaymentInstructionsScreen SK-75 wiring", () => {
  it("keeps off-app payment details and clipboard fallback", () => {
    expect(screenSource).toMatch(/^"use client";/);
    expect(screenSource).toMatch(/navigator\.clipboard|writeText/);
    expect(screenSource).toMatch(/document\.execCommand\("copy"\)/);
    expect(screenSource).not.toMatch(/Pay by card|Stripe|Tranzila/i);
    expect(screenSource).toContain("Money is paid directly to {producerName}");
  });

  it("routes to the exact accepted purchase and installment proof", () => {
    expect(screenSource).toMatch(
      /new URLSearchParams\(\{ purchase: purchaseId, installment: installmentId \}\)/,
    );
    expect(screenSource).toMatch(/\/pay\/proof\?\$\{query\.toString\(\)\}/);
    expect(screenSource).not.toMatch(/req=\$\{purchaseRequestId\}/);
  });

  it("reads the owned accepted purchase and redirects pending review to its exact proof", () => {
    expect(pageSource).toMatch(/paymentInstructions\(\{ purchaseId: purchase \}\)/);
    expect(pageSource).toMatch(/purchaseRequestId: req/);
    expect(pageSource).toMatch(
      /purchase=\$\{data\.purchaseId\}&installment=\$\{data\.installmentId\}/,
    );
    expect(pageSource).toMatch(/data\.pendingProofCents > 0/);
    expect(pageSource).toMatch(/proofUploadsAvailable=\{data\.proofUploadsAvailable\}/);
  });

  it("keeps the producer-will-send-details fallback", () => {
    expect(screenSource).toMatch(/will send payment details/i);
    expect(screenSource).toMatch(/paymentDetails/);
  });
});
