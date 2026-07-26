import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, "src", ...parts), "utf8");

const producerPayments = read("app", "(producer)", "dashboard", "payments", "page.tsx");
const artistPayments = read("app", "(artist)", "artist", "payments", "page.tsx");
const artistPurchasePayment = read(
  "app",
  "(artist)",
  "artist",
  "payments",
  "[purchaseId]",
  "page.tsx",
);
const paymentHistory = read("components", "payments", "payment-history.tsx");
const producerPaymentWorkspace = read(
  "components",
  "payments",
  "producer-payment-workspace.tsx",
);
const producerPaymentWorkspaceData = read(
  "components",
  "payments",
  "producer-payment-workspace-data.ts",
);
const projectPage = read("app", "(producer)", "dashboard", "clients-projects", "[id]", "page.tsx");
const songPage = read(
  "app",
  "(producer)",
  "dashboard",
  "clients-projects",
  "[id]",
  "songs",
  "[songId]",
  "page.tsx",
);
const clientPage = read(
  "app",
  "(producer)",
  "dashboard",
  "clients-projects",
  "clients",
  "[id]",
  "page.tsx",
);
const dashboardPage = read("app", "(producer)", "dashboard", "page.tsx");
const artistHome = read("app", "(artist)", "artist", "page.tsx");
const requestsPage = read("app", "(producer)", "dashboard", "requests", "page.tsx");
const requestDetail = read("app", "(producer)", "dashboard", "requests", "[id]", "page.tsx");
const readModel = read("server", "domain", "purchase-ledger", "read-model.ts");
const readDb = read("server", "domain", "purchase-ledger", "read-db.ts");

describe("SK-69 payment surface wiring", () => {
  it("renders the approved producer and artist buckets from domain-owned classifications", () => {
    for (const bucket of ["needs_review", "due_or_overdue", "upcoming", "history"]) {
      expect(producerPaymentWorkspaceData).toContain(`id: "${bucket}"`);
    }
    for (const bucket of ["waiting", "active", "history"]) {
      expect(artistPayments).toContain(`model.artistBuckets.${bucket}`);
    }
    expect(producerPayments).toContain(
      "toProducerPaymentWorkspaceBuckets(model.producerBuckets)",
    );
    expect(producerPayments).toContain("ProducerPaymentWorkspace");
    expect(producerPayments).not.toContain("PaymentHistoryView");
    expect(artistPayments).toContain("PaymentHistoryView");
  });

  it("feeds project, song, and client views from the same read projection", () => {
    expect(projectPage).toContain("caller.purchaseLedger.project({ projectId: id })");
    expect(songPage).toContain("caller.purchaseLedger.project({ projectId: id })");
    expect(clientPage).toContain("caller.purchaseLedger.client({ clientContactId: id })");
    expect(projectPage).toContain("paymentHistory={paymentHistory}");
    expect(songPage).toContain("paymentHistory={paymentHistory}");
    expect(clientPage).toContain(
      "toProducerPaymentWorkspaceBuckets(payments.producerBuckets)",
    );
    expect(clientPage).toContain("<ProducerPaymentWorkspace");
  });

  it("keeps purchase, proof/payment, and session actions separate on dashboard and Home", () => {
    expect(dashboardPage).toContain("paymentProofs={pendingPaymentProofs.proofs}");
    expect(dashboardPage).toContain("paymentBalances={paymentBalances}");
    expect(dashboardPage).toContain("purchaseRequests={pendingPurchaseRequests.requests}");
    expect(dashboardPage).toContain("pendingApprovals={pendingApprovals}");
    expect(artistHome).toContain("<PurchaseStatusCard");
    expect(artistHome).toContain("<ArtistPaymentActionsCard");
    expect(artistHome).toContain("<NextSessionCard");
    expect(artistHome).not.toContain("myPendingPayments");
    expect(artistHome).not.toContain("PaymentRequestsSection");
  });

  it("keeps Requests on Gate 1 and proof review only in Payments", () => {
    expect(requestsPage).not.toMatch(/proofOfPayment|PaymentProof/);
    expect(requestDetail).not.toMatch(/proofOfPayment\.(history|view)|PaymentProofReview/);
    expect(producerPaymentWorkspace).toContain("Needs review");
    expect(producerPaymentWorkspace).toContain("/dashboard/payments/");
  });

  it("uses the canonical ledger in a tenant-safe read-only repository", () => {
    expect(readModel).toContain("projectPurchaseLedger({");
    expect(readModel).not.toContain("summarizePurchaseLedger");
    expect(readModel).not.toContain("reconcilePurchaseLedger");
    expect(readDb).toContain('accessMode: "read only"');
    expect(readDb).toContain("activeArtistClientOwner");
    expect(readDb).toContain("eq(purchases.producerId, scope.producerId)");
    expect(readDb).not.toMatch(/paymentProofs\.(storageKey|objectEtag|storageBucket)/);
  });

  it("completes payment through the exact purchase and installment returned by the existing flow", () => {
    expect(paymentHistory).toMatch(
      /withArtistStudio\([\s\S]{0,120}`\/artist\/payments\/\$\{encodeURIComponent\(purchase\.id\)\}`[\s\S]{0,80}purchase\.studioId/,
    );
    expect(paymentHistory).toContain("Complete payment");
    expect(artistPurchasePayment).toContain(
      "caller.artist.purchase.paymentInstructions({ purchaseId })",
    );
    expect(artistPurchasePayment).toContain("installmentId={data.installmentId}");
    expect(artistPurchasePayment).toContain(
      "new URLSearchParams({ installment: data.installmentId })",
    );
  });
});
