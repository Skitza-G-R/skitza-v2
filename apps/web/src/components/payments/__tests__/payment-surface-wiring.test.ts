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
const artistPaymentInstructions = read(
  "app",
  "(artist)",
  "artist",
  "payments",
  "[purchaseId]",
  "instructions",
  "page.tsx",
);
const artistNewProof = read(
  "app",
  "(artist)",
  "artist",
  "payments",
  "[purchaseId]",
  "proof",
  "new",
  "page.tsx",
);
const artistExactProof = read(
  "app",
  "(artist)",
  "artist",
  "payments",
  "[purchaseId]",
  "proof",
  "[proofId]",
  "page.tsx",
);
const artistPaymentSummary = read("components", "artist", "purchase", "payment-summary-screen.tsx");
const paymentHistory = read("components", "payments", "payment-history.tsx");
const producerPaymentWorkspace = read("components", "payments", "producer-payment-workspace.tsx");
const producerPaymentWorkspaceData = read(
  "components",
  "payments",
  "producer-payment-workspace-data.ts",
);
const producerPaymentsDashboard = read("components", "payments", "producer-payments-dashboard.tsx");
const producerPaymentsDashboardData = read(
  "components",
  "payments",
  "producer-payments-dashboard-data.ts",
);
const purchaseLedgerRouter = read("server", "trpc", "routers", "purchase-ledger.ts");
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
const clientSpaceWorkspace = read(
  "components",
  "dashboard",
  "clients",
  "client-space-workspace.tsx",
);
const clientPaymentsPanel = read("components", "dashboard", "clients", "client-payments-panel.tsx");
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
    expect(producerPayments).toContain("toProducerPaymentsDashboardData(model)");
    expect(producerPayments).toContain("ProducerPaymentsDashboard");
    expect(producerPayments).not.toContain("ProducerPaymentWorkspace");
    expect(producerPayments).not.toContain("PaymentHistoryView");
    expect(artistPayments).toContain("ArtistPaymentsOverview");
    expect(artistPayments).not.toMatch(/\bPaymentHistoryView\b/);
  });

  it("feeds canonical project and client views from the same read projection", () => {
    expect(projectPage).toContain("caller.purchaseLedger.project({ projectId: id })");
    expect(clientPage).toContain("caller.purchaseLedger.client({ clientContactId: id })");
    expect(projectPage).toContain("payments={payments}");
    expect(projectPage).toContain("paymentModel.producerBuckets.needs_review");
    expect(projectPage).toContain("paymentModel.producerBuckets.due_or_overdue");
    expect(projectPage).toContain("paymentModel.producerBuckets.history");
    expect(songPage).toContain("/dashboard/music/");
    expect(songPage).toContain("projectSongUploadHref");
    expect(songPage).not.toContain("purchaseLedger");
    expect(clientPage).toContain("toClientPaymentsData(paymentModel");
    expect(clientPage).toContain("<ClientSpaceWorkspace");
    expect(clientPage).not.toContain("<ProducerPaymentWorkspace");
    expect(clientSpaceWorkspace).toContain(
      'import { ClientPaymentsPanel } from "./client-payments-panel"',
    );

    const compactClientWorkspace = clientSpaceWorkspace.replace(/\s+/g, " ");
    expect(compactClientWorkspace).toContain(
      "<ClientPaymentsPanel state={payments} clientName={clientName} />",
    );
    expect(clientSpaceWorkspace).not.toContain("ProducerPaymentWorkspace");
  });

  it("does not add a second client proof queue beside the canonical workspace", () => {
    for (const clientSurface of [clientPage, clientSpaceWorkspace]) {
      expect(clientSurface).not.toContain("ClientPaymentProofs");
      expect(clientSurface).not.toContain("client-payment-proofs");
      expect(clientSurface).not.toMatch(/proofOfPayment\.(history|view)/);
      expect(clientSurface).not.toContain("<PaymentProofReview");
    }
  });

  it("keeps each exact proof reachable from both Project and Client Payments", () => {
    expect(paymentHistory).toContain(
      "href={`/dashboard/payments/${encodeURIComponent(proof.id)}`}",
    );
    expect(clientPaymentsPanel).toContain(
      "href={`/dashboard/payments/${encodeURIComponent(row.action.proofId)}`}",
    );
    expect(clientPaymentsPanel).toContain(
      "href={`/dashboard/payments/${encodeURIComponent(proof.id)}`}",
    );
  });

  it("keeps purchase, proof/payment, and session actions separate on dashboard and Home", () => {
    expect(dashboardPage).toContain("paymentProofs={pendingPaymentProofs.proofs}");
    expect(dashboardPage).toContain("paymentBalances={paymentBalances}");
    expect(dashboardPage).toContain("purchaseRequests={pendingPurchaseRequests.requests}");
    expect(dashboardPage).toContain("pendingApprovals={pendingApprovals}");
    expect(artistHome).toContain("<ProfessionalArtistHome");
    expect(artistHome).toContain('kind: "payment_action"');
    expect(artistHome).toContain("artistHomeBookingStatusActions({");
    expect(artistHome).toContain("sessions: sessions.sessions");
    expect(artistHome).toContain('kind: "ready_to_schedule"');
    expect(artistHome).not.toContain("<PurchaseStatusCard");
    expect(artistHome).not.toContain("<ArtistPaymentActionsCard");
    expect(artistHome).not.toContain("<NextSessionCard");
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
    // SK-258: no per-read transaction (each one cost a new DB connection).
    expect(readDb).not.toContain("db.transaction(");
    expect(readDb).toContain("activeArtistClientOwner");
    expect(readDb).toContain("eq(purchases.producerId, scope.producerId)");
    expect(readDb).not.toMatch(/paymentProofs\.(storageKey|objectEtag|storageBucket)/);
  });

  it("maps exact owned Artists only after the producer-scoped overview read", () => {
    expect(producerPayments).toContain("purchaseLedger.overview()");
    expect(purchaseLedgerRouter).toMatch(
      /overview: producerProcedure\.query[\s\S]*?producerId: ctx\.producerId/,
    );
    expect(producerPaymentsDashboardData).toContain("purchase.clientContactId");
    expect(producerPaymentsDashboardData).toContain("purchase.producerId");
    expect(producerPaymentsDashboardData).not.toMatch(/storageKey|objectEtag|storageBucket/);
    expect(producerPaymentsDashboard).toContain("clientPaymentsHref(artist.clientContactId)");
    expect(producerPaymentsDashboard).toContain("/dashboard/payments/");
    expect(producerPaymentsDashboard).not.toContain("PaymentHistoryPurchaseDetails");
  });

  it("completes payment through the exact purchase and installment returned by the existing flow", () => {
    expect(paymentHistory).toMatch(
      /withArtistStudio\([\s\S]{0,120}`\/artist\/payments\/\$\{encodeURIComponent\(purchase\.id\)\}`[\s\S]{0,80}purchase\.studioId/,
    );
    expect(paymentHistory).toContain("Complete payment");
    expect(artistPurchasePayment).toContain(
      "caller.artist.purchase.proofOfPayment.state({ purchaseId })",
    );
    expect(artistPurchasePayment).toContain(
      "proofUploadAvailability={state?.proofUploadAvailability ?? null}",
    );
    expect(artistPurchasePayment).not.toContain("caller.artist.purchase.paymentInstructions");
    expect(artistPurchasePayment).toContain("<PaymentSummaryScreen");
    expect(artistPurchasePayment).toContain("studioId={studioId}");

    expect(artistPaymentSummary).toContain(
      "`/artist/payments/${encodeURIComponent(purchaseId)}/instructions`",
    );
    expect(artistPaymentSummary).toContain(
      "`/artist/payments/${encodeURIComponent(purchaseId)}/proof/${encodeURIComponent(proof.proofId)}`",
    );

    expect(artistPaymentInstructions).toContain("caller.artist.purchase.paymentInstructions({");
    expect(artistPaymentInstructions).toContain(
      "const proofQuery = new URLSearchParams({ installment: data.installmentId })",
    );
    expect(artistPaymentInstructions).toContain("purchaseId={data.purchaseId}");
    expect(artistPaymentInstructions).toContain("installmentId={data.installmentId}");

    expect(artistNewProof).toContain("caller.artist.purchase.proofOfPayment.state({");
    expect(artistNewProof).toContain("proof.installmentId === data.installmentId");
    expect(artistNewProof).toContain("purchaseId={data.purchaseId}");
    expect(artistNewProof).toContain("installmentId={data.installmentId}");
    expect(artistNewProof).not.toContain("paymentInstructions");

    expect(artistExactProof).toContain(".artist.purchase.proofOfPayment.state({ purchaseId })");
    expect(artistExactProof).toContain("data.proofs.find((proof) => proof.proofId === proofId)");
    expect(artistExactProof).toContain("if (!exact) notFound()");
  });

  it("opens every agreement from the rich ledger and keeps imported copy neutral", () => {
    expect(artistPurchasePayment).toContain("caller.artist.purchase.payments()");
    expect(artistPurchasePayment).toContain("findArtistPaymentRecord(sections, purchaseId)");
    expect(artistPurchasePayment).toMatch(
      /recordUsesProofFlow\(purchase\)[\s\S]*proofOfPayment\.state/,
    );
    expect(artistPurchasePayment).toContain("purchaseRecord={purchase}");
    expect(artistPaymentSummary).toContain("PaymentHistoryPurchaseDetails");
    expect(artistPaymentSummary).toContain("Full purchase record");
    expect(artistPayments).toContain('eyebrow: "Agreements"');
    expect(artistPayments).not.toContain("Accepted purchases");
    expect(artistPurchasePayment).toContain('eyebrow: "Agreement"');
    expect(artistPurchasePayment).not.toContain("Accepted purchase");
  });
});

// SK-283 — the dashboard's "Payment due" row used to link to
// #payment-history-due-overdue, an id that existed nowhere in the app, so the
// browser silently ignored the fragment. The link and the element it targets
// now share one constant, and this pins that they stay wired together.
describe("SK-283 payment-due deep link", () => {
  const dashboard = read("components", "payments", "producer-payments-dashboard.tsx");
  const needsYou = read("components", "dashboard", "overview", "needs-you.ts");

  it("renders the Needs you group with the id the dashboard links to", () => {
    expect(dashboard).toContain("PAYMENTS_NEEDS_YOU_ANCHOR");
    expect(dashboard).toContain('id={group.id === "needs_you" ? PAYMENTS_NEEDS_YOU_ANCHOR');
    expect(dashboard).toContain("scroll-mt-24");
  });

  it("builds the dashboard link from that same constant", () => {
    expect(needsYou).toContain("PAYMENTS_NEEDS_YOU_ANCHOR");
    expect(needsYou).not.toContain("payment-history-due-overdue");
  });
});
