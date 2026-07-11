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
  it("loads the pending hub through the tenant-scoped producer list query", () => {
    expect(hubPageSource).toMatch(/auth\(\)/);
    expect(hubPageSource).toMatch(/redirect\("\/sign-in"\)/);
    expect(hubPageSource).toMatch(/producer\.purchase\.list\(\{\s*status:\s*"pending"\s*\}\)/);
    expect(hubPageSource).toMatch(/<PurchaseRequestsList requests=\{requests\}/);
    expect(listSource).toMatch(/\/dashboard\/requests\/\$\{request\.id\}/);
    expect(purchaseRouterSource).toMatch(/list:\s*producerProcedure/);
    expect(purchaseRouterSource).toMatch(/eq\(purchaseRequests\.producerId, ctx\.producerId\)/);
  });

  it("keeps locked request facts visible in a compact review list", () => {
    expect(listSource).toMatch(/productNameSnapshot/);
    expect(listSource).toMatch(/refNumber/);
    expect(listSource).toMatch(/priceCents/);
    expect(listSource).toMatch(/artistEmail/);
    expect(listSource).toMatch(/bg-\[rgb\(var\(--brand-primary\)\)\]/);
    expect(listSource).toContain("Review");
    expect(listSource).not.toMatch(/href="\/dashboard\/requests"[^>]*>\s*Requests\s*</);
  });

  it("wraps approve, decline, and undo in authenticated server actions", () => {
    expect(actionsSource).toMatch(/^"use server";/);
    expect(actionsSource).toMatch(/producer\.purchase\.approve/);
    expect(actionsSource).toMatch(/producer\.purchase\.decline/);
    expect(actionsSource).toMatch(/producer\.purchase\.undoApproval/);
    expect(actionsSource).toMatch(/transition\.undoableUntil\.toISOString\(\)/);
    expect(actionsSource).toMatch(/revalidatePath\("\/dashboard"\)/);
    expect(actionsSource).toMatch(/revalidatePath\(REQUESTS_PATH\)/);
    expect(actionsSource).toMatch(/revalidatePath\(`\$\{REQUESTS_PATH\}\/\$\{id\}`\)/);
    expect(actionsSource).toContain("This purchase request is no longer available.");
    expect(actionsSource).not.toMatch(/error instanceof Error\s*\?\s*error\.message/);
  });

  it("adds review actions without replacing the SK-73 commercial snapshots", () => {
    expect(detailPageSource).toMatch(/producer\.purchase\.get\(\{ id \}\)/);
    expect(detailPageSource).toMatch(/<PurchaseRequestReview/);
    expect(detailPageSource).toMatch(/paymentPlanOptionsSnapshot/);
    expect(detailPageSource).toMatch(/royaltyTermsSnapshot/);
    expect(detailPageSource).toMatch(/agreementTextSnapshot/);
    expect(detailPageSource).toMatch(/contractUrlSnapshot/);
    expect(detailPageSource).toMatch(/acceptedAt/);
    expect(detailPageSource).toMatch(
      /initialUndoableUntilIso=\{request\.undoableUntil\?\.toISOString\(\) \?\? null\}/,
    );
    expect(purchaseRouterSource).toMatch(
      /undoableUntil:[\s\S]*purchaseApprovalUndoDeadline\(approvedAt\)/,
    );
    expect(detailPageSource).not.toMatch(/booking\.packages|from\(products\)/);
  });

  it("keeps foreign and missing request ids on the 404 path", () => {
    expect(detailPageSource).toMatch(/error\.code === "FORBIDDEN"/);
    expect(detailPageSource).toMatch(/error\.code === "NOT_FOUND"/);
    expect(detailPageSource).toMatch(/PURCHASE_REQUEST_ID\.safeParse\(id\)/);
    expect(detailPageSource).toMatch(/notFound\(\)/);
  });

  it("shows accessible decisions, private decline context, and inline failures", () => {
    expect(reviewSource).toMatch(/approvePurchaseRequest/);
    expect(reviewSource).toMatch(/declinePurchaseRequest/);
    expect(reviewSource).toMatch(/undoPurchaseApproval/);
    expect(reviewSource).toMatch(/setStatus\(initialStatus\)/);
    expect(reviewSource).toMatch(/useState<string \| null>\(\s*initialUndoableUntilIso/);
    expect(reviewSource).toMatch(/isApprovalUndoAvailable\(undoableUntilIso\)/);
    expect(reviewSource).toMatch(/setUndoableUntilIso\(result\.undoableUntilIso\)/);
    expect(reviewSource).not.toMatch(/if \(!result\.ok\) \{\s*setUndoableUntilIso\(null\)/);
    expect(reviewSource).toContain("Private note (optional)");
    expect(reviewSource).toContain("The artist receives a generic update.");
    expect(reviewSource).toMatch(/aria-expanded=\{showDecline\}/);
    expect(reviewSource).toMatch(/aria-controls="decline-request-form"/);
    expect(reviewSource).toMatch(/aria-describedby="decline-reason-help"/);
    expect(reviewSource).toMatch(/role=\{error \? "alert" : undefined\}/);
    expect(reviewSource).toMatch(/catch \{/);
  });
});
