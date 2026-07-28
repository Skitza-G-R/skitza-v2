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
    expect(clientPage).toContain("ClientMoneyLedger");
    expect(clientPage).not.toMatch(/proofOfPayment\.history|<ClientPaymentProofs/);
  });

  it("rejects proof deep-links in Requests while Payments owns decisions", () => {
    expect(requestPage).toMatch(/if \(requestedProofId\) notFound\(\)/);
    expect(requestPage).not.toMatch(/proofOfPayment\.(?:history|pending|view)/);
    expect(purchase).toMatch(/confirmProducerPaymentProof/);
    expect(purchase).toMatch(/rejectProducerPaymentProof/);
    expect(purchase).not.toMatch(/notImplemented\("producer\.purchase\.proofOfPayment/);
  });
});
