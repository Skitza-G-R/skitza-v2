import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Source-level regression coverage follows the established dashboard
// component convention. The real Postgres integration test covers data
// ownership; these tests pin the complete producer surface so the hub
// cannot be silently removed while the artist request mutation remains.

const here = dirname(fileURLToPath(import.meta.url));
const listSrc = readFileSync(join(here, "..", "purchase-requests-list.tsx"), "utf-8");
const detailSrc = readFileSync(join(here, "..", "purchase-request-detail.tsx"), "utf-8");
const actionsSrc = readFileSync(
  join(here, "..", "..", "..", "..", "app", "(producer)", "dashboard", "requests", "actions.ts"),
  "utf-8",
);
const hubPageSrc = readFileSync(
  join(here, "..", "..", "..", "..", "app", "(producer)", "dashboard", "requests", "page.tsx"),
  "utf-8",
);
const detailPageSrc = readFileSync(
  join(here, "..", "..", "..", "..", "app", "(producer)", "dashboard", "requests", "[id]", "page.tsx"),
  "utf-8",
);
const dashboardPageSrc = readFileSync(
  join(here, "..", "..", "..", "..", "app", "(producer)", "dashboard", "page.tsx"),
  "utf-8",
);
const mobileFeedSrc = readFileSync(
  join(here, "..", "..", "overview", "mobile-today-feed.tsx"),
  "utf-8",
);
const purchaseRouterSrc = readFileSync(
  join(here, "..", "..", "..", "..", "server", "trpc", "routers", "purchase.ts"),
  "utf-8",
);

describe("producer purchase request hub", () => {
  it("loads pending requests through the tenant-scoped producer purchase query", () => {
    expect(hubPageSrc).toMatch(/producer\.purchase\.list\(\{\s*status:\s*"pending"\s*\}\)/);
    expect(hubPageSrc).toMatch(/<PurchaseRequestsList/);
    expect(listSrc).toMatch(/\/dashboard\/requests\/\$\{request\.id\}/);
  });

  it("puts a pending purchase request on the dashboard instead of relying on booking approvals", () => {
    expect(dashboardPageSrc).toMatch(/producer\.purchase\.list\(\{\s*status:\s*"pending"\s*\}\)/);
    expect(dashboardPageSrc).toMatch(/PurchaseRequestsBanner/);
    expect(dashboardPageSrc).toMatch(/pendingPurchaseRequests=/);
    expect(mobileFeedSrc).toMatch(/pendingPurchaseRequests\.length/);
    expect(mobileFeedSrc).toMatch(/PurchaseRequestCard/);
    expect(mobileFeedSrc).toMatch(/\/dashboard\/requests\/\$\{request\.id\}/);
  });

  it("uses a durable request-detail route with a producer-owned detail query", () => {
    expect(detailPageSrc).toMatch(/producer\.purchase\.get\(\{ id \}\)/);
    expect(detailPageSrc).toMatch(/notFound\(\)/);
    expect(detailPageSrc).toMatch(/error\.code === "FORBIDDEN"/);
    expect(detailPageSrc).toMatch(/error\.code === "NOT_FOUND"/);
    expect(purchaseRouterSrc).toMatch(/get:\s*producerProcedure/);
    expect(purchaseRouterSrc).toMatch(/loadProducerRequest\(ctx\.db, ctx\.producerId, input\.id\)/);
  });

  it("renders the artist, locked product, agreement, and frozen payment options", () => {
    expect(detailSrc).toContain("Artist");
    expect(detailSrc).toContain("Locked purchase");
    expect(detailSrc).toContain("Agreement");
    expect(detailSrc).toContain("Payment options");
    expect(detailSrc).toContain("View agreement");
    expect(purchaseRouterSrc).toMatch(/paymentPlanOptionsSnapshot:\s*frozenPlanOptions\(request\)/);
    expect(purchaseRouterSrc).toMatch(/agreementAcceptances\.purchaseRequestId/);
  });

  it("uses server actions for approve, decline, and the live undo window", () => {
    expect(detailSrc).toMatch(/approvePurchaseRequest/);
    expect(detailSrc).toMatch(/declinePurchaseRequest/);
    expect(detailSrc).toMatch(/undoPurchaseApproval/);
    expect(detailSrc).toMatch(/const canUndo = request\.undoableUntil !== null/);
    expect(detailSrc).toMatch(/router\.refresh/);
    expect(detailSrc).not.toMatch(/useMutation/);
    expect(actionsSrc).toMatch(/producer\.purchase\.approve/);
    expect(actionsSrc).toMatch(/producer\.purchase\.decline/);
    expect(actionsSrc).toMatch(/producer\.purchase\.undoApproval/);
    expect(actionsSrc).toMatch(/revalidatePath\("\/dashboard"\)/);
    expect(actionsSrc).toMatch(/revalidatePath\("\/artist"\)/);
    expect(actionsSrc).not.toMatch(/return error instanceof Error \? error\.message/);
    expect(purchaseRouterSrc).toMatch(/undoableUntil:\s*\n\s*request\.status === "approved"/);
  });

  it("keeps the decline reason explicitly private from the artist", () => {
    expect(detailSrc).toContain("Private note (optional)");
    expect(detailSrc).toContain("The artist receives a generic update.");
  });
});
