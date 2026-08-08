import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const routersDir = join(here, "..");
const webSrc = join(here, "..", "..", "..", "..");

const clientContacts = readFileSync(join(routersDir, "client-contacts.ts"), "utf8");
const purchase = readFileSync(join(routersDir, "purchase.ts"), "utf8");
const clientPage = readFileSync(
  join(webSrc, "app", "(producer)", "dashboard", "clients-projects", "clients", "[id]", "page.tsx"),
  "utf8",
);
const clientPaymentsData = readFileSync(
  join(webSrc, "components", "dashboard", "clients", "client-payments-data.ts"),
  "utf8",
);
const requestPage = readFileSync(
  join(webSrc, "app", "(producer)", "dashboard", "requests", "[id]", "page.tsx"),
  "utf8",
);
describe("producer client payment visibility", () => {
  it("keeps legacy list totals closed instead of reading project payment flags", () => {
    expect(clientContacts).toMatch(/ClientCommercialProjection/);
    expect(clientContacts).toMatch(/availability:\s*"unavailable"/);
    expect(clientContacts).toMatch(/purchase_payments_projection_pending/);
    expect(clientContacts).not.toMatch(/\binvoices\b|summarizeProjectMoney/);
    expect(clientContacts).not.toMatch(
      /projects\.(?:depositPaid|finalPaid|paidAt|totalAmountCents|engagementTotalCents|currency)/,
    );
  });

  it("resolves producer-owned projects through the stable client contact id", () => {
    expect(clientContacts).toMatch(/clientContactId:\s*projects\.clientContactId/);
    expect(clientContacts).toMatch(/contactById\.get\(p\.clientContactId\)/);
    expect(clientContacts).toMatch(/byClientContactId\.get\(c\.id\)/);
    expect(clientContacts).toMatch(/eq\(projects\.clientContactId, (?:input\.id|clientId)\)/);
    expect(clientContacts).not.toMatch(/emailMatchesProject|contactByEmail|byEmail/);
  });

  it("keeps the client ledger purchase-owned without duplicating the proof queue", () => {
    expect(purchase).toMatch(/history: producerProcedure/);
    expect(purchase).toMatch(/listProducerPaymentProofHistory/);
    expect(clientContacts).toContain("clientMoneyRepository");
    expect(clientContacts).toContain("getClientMoneyLedger");
    expect(clientPage).toContain("caller.purchaseLedger.client({ clientContactId: id })");
    expect(clientPage).toContain("toClientPaymentsData(paymentModel");
    expect(clientPage).toMatch(
      /<ClientSpaceWorkspace[\s\S]*?payments=\{payments\}[\s\S]*?initialTab=\{initialTab\}/,
    );
    expect(clientPaymentsData).toContain("model.projects.map");
    expect(clientPaymentsData).not.toMatch(/\bdb\b|ctx\.producerId|clientContactId:/);
    expect(clientPage).not.toContain("ClientMoneyLedger");
    expect(clientPage).not.toMatch(/proofOfPayment\.history|<ClientPaymentProofs/);
  });

  it("rejects proof deep-links in Requests while Payments owns decisions", () => {
    expect(requestPage).toMatch(/if \(requestedProofId\) notFound\(\)/);
    expect(requestPage).toMatch(
      /proofOfPayment\.pending\(\{[\s\S]*purchaseId: commercialTerms\.purchaseId/,
    );
    expect(requestPage).not.toMatch(/proofOfPayment\.(?:history|view)/);
    expect(requestPage).not.toMatch(
      /confirmProducerPaymentProof|rejectProducerPaymentProof|PaymentProofReview/,
    );
    expect(purchase).toMatch(/confirmProducerPaymentProof/);
    expect(purchase).toMatch(/rejectProducerPaymentProof/);
    expect(purchase).not.toMatch(/notImplemented\("producer\.purchase\.proofOfPayment/);
  });
});
