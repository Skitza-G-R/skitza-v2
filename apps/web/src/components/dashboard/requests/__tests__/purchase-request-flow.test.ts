import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const listSource = readFileSync(join(here, "..", "purchase-requests-list.tsx"), "utf8");
const reviewSource = readFileSync(join(here, "..", "purchase-request-review.tsx"), "utf8");
const refreshSource = readFileSync(join(here, "..", "purchase-request-queue-refresh.tsx"), "utf8");
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
const artistActionsSource = readFileSync(
  join(here, "..", "..", "..", "artist", "purchase", "actions.ts"),
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
    expect(hubPageSource).toMatch(/<PurchaseRequestQueueRefresh/);
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

  it("keeps request facts visible without claiming pending terms are frozen", () => {
    expect(listSource).toMatch(/productNameSnapshot/);
    expect(listSource).toMatch(/refNumber/);
    expect(listSource).toMatch(/priceCents/);
    expect(listSource).toMatch(/artistEmail/);
    expect(listSource).toMatch(/bg-\[rgb\(var\(--brand-primary\)\)\]/);
    expect(listSource).toContain("Review");
    expect(listSource).not.toContain("locked commercial terms");
    expect(purchaseRouterSource).toMatch(/priceCents: proposal\?\.totalCents/);
    expect(purchaseRouterSource).toMatch(/commercialTermsAvailable: proposal !== null/);
    expect(purchaseRouterSource).toMatch(/approvalAvailable:/);
    expect(listSource).toContain("Terms unavailable");
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

  it("shows current proposal data before acceptance and frozen truth after conversion", () => {
    expect(detailPageSource).toMatch(/producer\.purchase\.get\(\{ id \}\)/);
    expect(detailPageSource).toMatch(/requestedProofId/);
    expect(detailPageSource).not.toMatch(/proofOfPayment\.history|proofOfPayment\.view/);
    expect(detailPageSource).not.toMatch(/<PaymentProofReview/);
    expect(detailPageSource).toMatch(/<PurchaseRequestReview/);
    expect(detailPageSource).toMatch(/commercialTerms\.snapshot/);
    expect(detailPageSource).toMatch(/commercialTerms\.kind === "accepted"/);
    expect(detailPageSource).toMatch(/<PurchaseRequestCommercialDetails/);
    expect(detailPageSource).not.toMatch(/contractUrlSnapshot|agreementUrlSnapshot/);
    expect(detailPageSource).not.toMatch(/safeAgreementUrl/);
    expect(detailPageSource).toMatch(
      /initialUndoableUntilIso=\{request\.undoableUntil\?\.toISOString\(\) \?\? null\}/,
    );
    expect(purchaseRouterSource).toMatch(
      /undoableUntil:[\s\S]*purchaseRequestApprovalUndoDeadline\(approvedAt\)/,
    );
    expect(detailPageSource).not.toMatch(/booking\.packages|from\(products\)/);
  });

  it("keeps converted request deep links alive through accepted Purchase truth", () => {
    const producerGetStart = purchaseRouterSource.indexOf(
      "  get: producerProcedure\n    .input(z.object({ id: z.string().uuid() }))",
    );
    const producerGet = purchaseRouterSource.slice(
      producerGetStart,
      purchaseRouterSource.indexOf("correctTarget: producerProcedure"),
    );
    expect(purchaseRouterSource).toMatch(/loadAcceptedPurchaseForProducerRequest/);
    expect(producerGet).toMatch(/commercialTerms:[\s\S]*kind: "accepted"/);
    expect(producerGet).not.toMatch(
      /request\.status === "canceled" \|\| request\.status === "converted"/,
    );
    expect(purchaseRouterSource).toMatch(/emitAgreementAccepted\(ctx\.db, notification\)/);
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
    expect(reviewSource).toMatch(/disabled=\{isPending \|\| !canApprove \|\| !online\}/);
    expect(reviewSource).toContain("useOnlineStatus");
    expect(reviewSource).toContain("Reconnect to approve this request.");
    expect(reviewSource).toContain("artist cannot continue while the Store product is hidden");
    expect(reviewSource).toMatch(/aria-describedby="decline-reason-help"/);
    expect(reviewSource).toMatch(/role=\{error \? "alert" : undefined\}/);
  });

  it("keeps target reset available and describes the truthful acceptance sequence", () => {
    expect(reviewSource).toMatch(/projectId !== null \|\| targetProjects\.length > 0/);
    expect(reviewSource).toMatch(/project\.workflowStage/);
    expect(reviewSource).toContain("choose an enabled plan");
    expect(reviewSource).toContain("review the exact agreement");
    expect(reviewSource).toContain("external payment instructions");
    expect(reviewSource).not.toContain("continue to payment");
  });

  it("refreshes externally-created requests and invalidates producer surfaces", () => {
    expect(refreshSource).toMatch(/setInterval/);
    expect(refreshSource).toMatch(/visibilitychange/);
    expect(refreshSource).toMatch(/addEventListener\("focus"/);
    expect(refreshSource).toMatch(/addEventListener\("pageshow"/);
    expect(refreshSource).toMatch(/router\.refresh\(\)/);
    expect(artistActionsSource).toMatch(/revalidatePath\("\/dashboard", "layout"\)/);
    expect(artistActionsSource).toMatch(/revalidatePath\("\/dashboard\/requests", "layout"\)/);
  });

  it("loads the artist's latest owned request so approval can continue", () => {
    const currentQuery = purchaseRouterSource.slice(
      purchaseRouterSource.indexOf("current: artistProcedure"),
      purchaseRouterSource.indexOf("paymentPlan: router"),
    );
    expect(currentQuery).toMatch(/clientContacts\.clerkUserId/);
    expect(currentQuery).toMatch(/purchaseRequests\.clientContactId/);
    expect(currentQuery).toMatch(
      /\.from\(purchaseRequests\)[\s\S]*\.innerJoin\(\s*clientContacts,[\s\S]*eq\(clientContacts\.id, purchaseRequests\.clientContactId\)[\s\S]*eq\(clientContacts\.producerId, purchaseRequests\.producerId\)/,
    );
    expect(currentQuery).not.toMatch(/const \[contact\]/);
    expect(currentQuery).not.toMatch(/eq\(purchaseRequests\.clientContactId, contact\.id\)/);
    expect(currentQuery).toMatch(
      /inArray\(purchaseRequests\.status,\s*\["pending", "approved", "declined"\]\)/,
    );
    expect(currentQuery).toMatch(/current:\s*\{[\s\S]*status: request\.status/);
    expect(currentQuery).not.toMatch(/declineReason|reason/);
  });

  it("resolves a targeted project's stable client before creating a request", () => {
    const requestMutation = purchaseRouterSource.slice(
      purchaseRouterSource.indexOf("request: artistProcedure"),
      purchaseRouterSource.indexOf("  get: artistProcedure"),
    );

    expect(requestMutation).toMatch(
      /if \(input\.projectId\)[\s\S]*\.from\(projects\)[\s\S]*\.innerJoin\(\s*clientContacts/,
    );
    expect(requestMutation).toMatch(/eq\(projects\.clientContactId, clientContacts\.id\)/);
    expect(requestMutation).toMatch(/eq\(clientContacts\.clerkUserId, ctx\.clerkUserId\)/);
    expect(requestMutation).toMatch(
      /orderBy\(asc\(clientContacts\.firstSeenAt\), asc\(clientContacts\.id\)\)/,
    );
  });
});
