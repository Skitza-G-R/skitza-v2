import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const listSource = readFileSync(join(here, "..", "purchase-requests-list.tsx"), "utf8");
const reviewSource = readFileSync(join(here, "..", "purchase-request-review.tsx"), "utf8");
const actionsSource = readFileSync(
  join(here, "..", "..", "..", "..", "app", "(producer)", "dashboard", "requests", "actions.ts"),
  "utf8",
);
const hubPageSource = readFileSync(
  join(here, "..", "..", "..", "..", "app", "(producer)", "dashboard", "requests", "page.tsx"),
  "utf8",
);
const dashboardPageSource = readFileSync(
  join(here, "..", "..", "..", "..", "app", "(producer)", "dashboard", "page.tsx"),
  "utf8",
);
const detailPageSource = readFileSync(
  join(
    here,
    "..",
    "..",
    "..",
    "..",
    "app",
    "(producer)",
    "dashboard",
    "requests",
    "[id]",
    "page.tsx",
  ),
  "utf8",
);
const purchaseRouterSource = readFileSync(
  join(here, "..", "..", "..", "..", "server", "trpc", "routers", "purchase.ts"),
  "utf8",
);

describe("producer purchase request flow", () => {
  it("loads the decision queue without putting payment proofs in Requests", () => {
    expect(hubPageSource).toMatch(/auth\(\)/);
    expect(hubPageSource).toMatch(/redirect\("\/sign-in"\)/);
    expect(hubPageSource).toMatch(/producer\.purchase\.list\(\{\s*status:\s*"pending"\s*\}\)/);
    expect(hubPageSource).not.toMatch(/proofOfPayment\.pending\(\)/);
    expect(hubPageSource).not.toMatch(/<PendingPaymentProofs/);
    expect(hubPageSource).not.toMatch(/<ProofQueueRefresh/);
    expect(hubPageSource).toMatch(/<PurchaseRequestsList requests=\{requests\}/);
    expect(listSource).toMatch(/\/dashboard\/requests\/\$\{request\.id\}/);
    expect(purchaseRouterSource).toMatch(/list:\s*producerProcedure/);
    expect(purchaseRouterSource).toMatch(/eq\(purchaseRequests\.producerId, ctx\.producerId\)/);
  });

  it("threads the fail-closed purchase proof projection into the dashboard", () => {
    expect(dashboardPageSource).toMatch(/proofOfPayment\.pending\(\)/);
    expect(dashboardPageSource).toMatch(/paymentProofs=\{pendingPaymentProofs\.proofs\}/);
    expect(dashboardPageSource).not.toMatch(/<PendingPaymentProofs/);
    expect(dashboardPageSource).toMatch(/<ProofQueueRefresh/);
    expect(dashboardPageSource).toMatch(/<OverviewScreen/);
  });

  it("keeps locked request facts visible in a compact review list", () => {
    expect(listSource).toMatch(/productNameSnapshot/);
    expect(listSource).toMatch(/refNumber/);
    expect(listSource).toMatch(/priceCents/);
    expect(listSource).toMatch(/artistEmail/);
    expect(listSource).toMatch(/bg-\[rgb\(var\(--brand-primary\)\)\]/);
    expect(listSource).toContain("Review");
  });

  it("wraps approve, decline, and undo in authenticated server actions", () => {
    expect(actionsSource).toMatch(/^"use server";/);
    expect(actionsSource).toMatch(/producer\.purchase\.approve/);
    expect(actionsSource).toMatch(/producer\.purchase\.decline/);
    expect(actionsSource).toMatch(/producer\.purchase\.undoApproval/);
    expect(actionsSource).toMatch(/transition\.undoableUntil\.toISOString\(\)/);
    expect(actionsSource).toMatch(/revalidatePath\("\/dashboard"\)/);
    expect(actionsSource).toMatch(/revalidatePath\(REQUESTS_PATH\)/);
    expect(actionsSource).toContain("This purchase request is no longer available.");
    expect(actionsSource).not.toMatch(/error instanceof Error\s*\?\s*error\.message/);
  });

  it("adds request review actions without presenting proposal data as accepted history", () => {
    expect(detailPageSource).toMatch(/producer\.purchase\.get\(\{ id \}\)/);
    expect(detailPageSource).toMatch(/requestedProofId/);
    expect(detailPageSource).not.toMatch(/proofOfPayment\.history|proofOfPayment\.view/);
    expect(detailPageSource).not.toMatch(/<PaymentProofReview/);
    expect(detailPageSource).toMatch(/<PurchaseRequestReview/);
    expect(detailPageSource).toMatch(/paymentPlanOptionsSnapshot/);
    expect(detailPageSource).toMatch(/royaltyTermsSnapshot/);
    expect(detailPageSource).toMatch(/agreementTextSnapshot/);
    expect(detailPageSource).toMatch(/contractUrlSnapshot/);
    expect(detailPageSource).toContain("Proposed agreement");
    expect(detailPageSource).toContain("Final acceptance is recorded on the purchase");
    expect(detailPageSource).toMatch(
      /initialUndoableUntilIso=\{request\.undoableUntil\?\.toISOString\(\) \?\? null\}/,
    );
    expect(purchaseRouterSource).toMatch(
      /undoableUntil:[\s\S]*purchaseRequestApprovalUndoDeadline\(approvedAt\)/,
    );
    expect(detailPageSource).not.toMatch(/booking\.packages|from\(products\)/);
  });

  it("keeps foreign, missing, and guessed proof ids on the 404 path", () => {
    expect(detailPageSource).toMatch(/error\.code === "FORBIDDEN"/);
    expect(detailPageSource).toMatch(/error\.code === "NOT_FOUND"/);
    expect(detailPageSource).toMatch(/PURCHASE_REQUEST_ID\.safeParse\(id\)/);
    expect(detailPageSource).toMatch(/if \(requestedProofId\) notFound\(\)/);
    expect(detailPageSource).toMatch(/notFound\(\)/);
  });

  it("shows accessible decisions, private decline context, and inline failures", () => {
    expect(reviewSource).toMatch(/approvePurchaseRequest/);
    expect(reviewSource).toMatch(/declinePurchaseRequest/);
    expect(reviewSource).toMatch(/undoPurchaseApproval/);
    expect(reviewSource).toMatch(/isApprovalUndoAvailable\(undoableUntilIso\)/);
    expect(reviewSource).toMatch(/setUndoableUntilIso\(result\.undoableUntilIso\)/);
    expect(reviewSource).toContain("Private note (optional)");
    expect(reviewSource).toContain("The artist receives a generic update.");
    expect(reviewSource).toMatch(/aria-describedby="decline-reason-help"/);
    expect(reviewSource).toMatch(/role=\{error \? "alert" : undefined\}/);
  });
});
