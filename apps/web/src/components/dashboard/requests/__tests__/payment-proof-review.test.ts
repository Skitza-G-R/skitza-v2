import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-level coverage follows the existing producer Requests tests. The
// real-database suite owns mutation races and tenant isolation; this file pins
// the user-facing Gate-2 wiring so a working API can never regress back to an
// artist getting stuck in "verifying" with no producer controls.

const here = dirname(fileURLToPath(import.meta.url));
const requestsDir = join(here, "..");
const appRequestsDir = join(
  here,
  "..",
  "..",
  "..",
  "..",
  "app",
  "(producer)",
  "dashboard",
  "requests",
);

const queuePath = join(requestsDir, "pending-payment-proofs.tsx");
const reviewPath = join(requestsDir, "payment-proof-review.tsx");
const refreshPath = join(requestsDir, "proof-queue-refresh.tsx");
const actionsPath = join(appRequestsDir, "proof-actions.ts");

const dashboardPage = readFileSync(join(appRequestsDir, "..", "page.tsx"), "utf8");
const requestsPage = readFileSync(join(appRequestsDir, "page.tsx"), "utf8");
const detailPage = readFileSync(join(appRequestsDir, "[id]", "page.tsx"), "utf8");
const detailComponent = readFileSync(join(requestsDir, "purchase-request-detail.tsx"), "utf8");
describe("producer Gate-2 proof review wiring", () => {
  it("puts proofs in the dashboard Needs You queue and keeps the detailed Requests queue", () => {
    expect(existsSync(queuePath)).toBe(true);
    expect(dashboardPage).toMatch(/proofOfPayment\.pending\(\)/);
    expect(requestsPage).toMatch(/proofOfPayment\.pending\(\)/);
    expect(dashboardPage).toMatch(
      /paymentProofs=\{pendingPaymentProofs\.available \? pendingPaymentProofs\.proofs : \[\]\}/,
    );
    expect(dashboardPage).not.toMatch(/<PendingPaymentProofs/);
    expect(requestsPage).toMatch(/<PendingPaymentProofs/);
  });

  it("shows all decision-critical metadata and links the exact owned proof", () => {
    expect(existsSync(queuePath)).toBe(true);
    if (!existsSync(queuePath)) return;
    const queue = readFileSync(queuePath, "utf8");
    expect(queue).toMatch(/artistName/);
    expect(queue).toMatch(/productNameSnapshot/);
    expect(queue).toMatch(/refNumber/);
    expect(queue).toMatch(/amountCents/);
    expect(queue).toMatch(/createdAt/);
    expect(queue).toMatch(/originalFileName/);
    expect(queue).toMatch(/proofNote/);
    expect(queue).toMatch(/\?proof=\$\{proof\.proofId\}#payment-proof/);
  });

  it("validates the proof against owned request history before signing a five-minute view", () => {
    expect(detailPage).toMatch(/proofOfPayment\.history\(\{\s*purchaseRequestId:\s*id\s*\}\)/);
    expect(detailPage).toMatch(/proof\.proofId === requestedProofId/);
    expect(detailPage).toMatch(/proofOfPayment\.view\(\{\s*proofId:/);
    expect(detailPage).toMatch(/notFound\(\)/);
    expect(detailPage).toMatch(/expiresInSeconds/);
    expect(detailComponent).toMatch(/<PaymentProofReview/);
  });

  it("renders private image/PDF evidence with confirm and artist-facing reject controls", () => {
    expect(existsSync(reviewPath)).toBe(true);
    if (!existsSync(reviewPath)) return;
    const review = readFileSync(reviewPath, "utf8");
    expect(review).toContain('contentType === "application/pdf"');
    expect(review).toMatch(/Confirm payment/);
    expect(review).toMatch(/Reject proof/);
    expect(review).toMatch(/Message shown to the artist/);
    expect(review).toMatch(/router\.refresh/);
    expect(review).toMatch(/proof\.status === "pending"/);
    expect(review).toMatch(/proof\.status === "confirmed"/);
    expect(review).toMatch(/proof\.status === "rejected"/);
    expect(review).not.toMatch(/storageKey|storageBucket|publicUrl/);
  });

  it("moves focus into each decision panel and restores it when cancelled", () => {
    expect(existsSync(reviewPath)).toBe(true);
    if (!existsSync(reviewPath)) return;
    const review = readFileSync(reviewPath, "utf8");
    expect(review).toContain("confirmTriggerRef");
    expect(review).toContain("rejectTriggerRef");
    expect(review).toContain('aria-controls="confirm-payment-proof-panel"');
    expect(review).toContain('aria-controls="reject-payment-proof-form"');
    expect(review).toMatch(/onClick=\{runConfirm\}[\s\S]*?autoFocus/);
    expect(review).toMatch(/id="proof-rejection-note"[\s\S]*?autoFocus/);
    expect(review).toMatch(/closeConfirm[\s\S]*?requestAnimationFrame/);
    expect(review).toMatch(/closeReject[\s\S]*?requestAnimationFrame/);
  });

  it("revalidates producer, request, notification, and artist surfaces after each decision", () => {
    expect(existsSync(actionsPath)).toBe(true);
    if (!existsSync(actionsPath)) return;
    const actions = readFileSync(actionsPath, "utf8");
    const decisionInput = actions.slice(
      actions.indexOf("const proofDecisionInput"),
      actions.indexOf("function revalidateProofSurfaces"),
    );
    expect(actions).toMatch(/producer\.purchase\.proofOfPayment\.confirm/);
    expect(actions).toMatch(/producer\.purchase\.proofOfPayment\.reject/);
    expect(actions).toMatch(/revalidatePath\("\/dashboard"\)/);
    expect(actions).toMatch(/revalidatePath\("\/dashboard", "layout"\)/);
    expect(actions).toMatch(/revalidatePath\("\/dashboard\/requests"/);
    expect(actions).toMatch(/revalidatePath\(`\/dashboard\/requests\/\$\{purchaseRequestId\}`\)/);
    expect(actions).toMatch(/revalidatePath\("\/artist", "layout"\)/);
    expect(decisionInput).not.toMatch(/purchaseRequestId/);
    expect(actions).toMatch(/revalidateProofSurfaces\(result\.purchaseRequestId\)/);
  });

  it("refreshes already-open dashboard and Requests surfaces while proofs can arrive", () => {
    expect(existsSync(refreshPath)).toBe(true);
    if (!existsSync(refreshPath)) return;
    const refresh = readFileSync(refreshPath, "utf8");

    expect(refresh).toMatch(/^"use client";/);
    expect(refresh).toMatch(/router\.refresh\(\)/);
    expect(refresh).toMatch(/visibilityState/);
    expect(refresh).toMatch(/setInterval/);
    expect(dashboardPage).toMatch(/<ProofQueueRefresh/);
    expect(requestsPage).toMatch(/<ProofQueueRefresh/);
    expect(detailPage).toMatch(
      /<ProofQueueRefresh enabled=\{paymentProof\?\.status !== "pending"\}/,
    );
  });
});
