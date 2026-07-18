import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-grep wiring tests for S8 — Payment instructions (off-app pay).
// Matches the repo's screen-test style (see commit-screens.test.ts): the
// money math lives in pay-data and is unit-tested there; here we assert the
// screen wires up the bits that matter — copy controls, the primary route,
// the no-details fallback, and the external-payments-only boundary.

const here = dirname(fileURLToPath(import.meta.url));
const S8_PATH = join(here, "..", "payment-instructions-screen.tsx");
const s8Src = readFileSync(S8_PATH, "utf8");
const PAGE_PATH = join(
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
);
const pageSrc = readFileSync(PAGE_PATH, "utf8");

describe("payment-instructions-screen.tsx (S8) wiring", () => {
  it("is a client component (clipboard + router live here)", () => {
    expect(s8Src).toMatch(/^"use client";/);
  });

  it("formats money through the shared pay-data helper", () => {
    expect(s8Src).toMatch(/formatPurchaseMoney\(amountDueNowCents, currency\)/);
    expect(s8Src).toMatch(/from "\.\/pay-data"/);
    expect(pageSrc).toMatch(/currency=\{data\.currency\}/);
  });

  it("exposes one clear page heading to assistive technology", () => {
    expect(s8Src).toMatch(/<h1 className="sr-only">Payment instructions<\/h1>/);
  });

  it("offers a copy control that writes to the clipboard", () => {
    // an inline CopyButton that toggles a 'copied' confirmation state
    expect(s8Src).toMatch(/CopyButton/);
    expect(s8Src).toMatch(/navigator\.clipboard|writeText/);
    expect(s8Src).toMatch(/Promise\.race/);
    expect(s8Src).toMatch(/document\.execCommand\("copy"\)/);
    expect(s8Src).toMatch(/Copied/);
    expect(s8Src).toMatch(/Copy manually/);
  });

  it("does not advertise a card processor or future in-app card path", () => {
    expect(s8Src).not.toMatch(/Pay by card|coming soon|Stripe|Tranzila/i);
    expect(s8Src).toContain("Money is paid directly to {producerName}");
    expect(s8Src).toContain("we never hold or");
  });

  it("routes the primary action to the proof-upload screen", () => {
    expect(s8Src).toMatch(/router\.push\(\s*`\/artist\/purchase\/\$\{productId\}\/pay\/proof/);
    expect(s8Src).toMatch(/req=\$\{purchaseRequestId\}/);
  });

  it("disables proof upload when migration 0023 is not available", () => {
    expect(s8Src).toMatch(/proofUploadsAvailable\s*=\s*true/);
    expect(s8Src).toMatch(/disabled=\{!proofUploadsAvailable\}/);
    expect(s8Src).toMatch(/Proof upload temporarily unavailable/);
    expect(pageSrc).toMatch(/proofUploadsAvailable=\{data\.proofUploadsAvailable\}/);
  });

  it("supports the 'producer will send details' fallback when bank details are absent", () => {
    expect(s8Src).toMatch(/will send/i);
    expect(s8Src).toMatch(/paymentDetails/);
  });

  it("reads the locked request's real payment instructions", () => {
    expect(pageSrc).toMatch(/caller\.artist\.purchase\.paymentInstructions/);
    expect(pageSrc).toMatch(/purchaseRequestId: req/);
    expect(pageSrc).toMatch(/data\.productId && data\.productId !== productId/);
    expect(pageSrc).not.toMatch(/MOCK_/);
  });
});
