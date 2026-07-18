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
  it("fails commercial totals closed until the purchase payment projection exists", () => {
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
    expect(clientContacts).toMatch(/eq\(projects\.clientContactId, input\.id\)/);
    expect(clientContacts).not.toMatch(/emailMatchesProject|contactByEmail|byEmail/);
  });

  it("fails proof history closed until the purchase-owned projection adapter is wired", () => {
    expect(purchase).toMatch(
      /history: producerProcedure[\s\S]*?available: false; proofs: ProducerProofHistory\[\]/,
    );
    expect(purchase).not.toMatch(/listProducerProofHistory|paymentProofsTableAvailable/);
    expect(clientPage).not.toMatch(/proofOfPayment\.history|<ClientPaymentProofs/);
  });

  it("rejects proof deep-links and leaves proof decisions unavailable", () => {
    expect(requestPage).toMatch(/if \(requestedProofId\) notFound\(\)/);
    expect(requestPage).not.toMatch(/proofOfPayment\.(?:history|pending|view)/);
    expect(purchase).toMatch(/notImplemented\("producer\.purchase\.proofOfPayment\.view"\)/);
    expect(purchase).toMatch(/notImplemented\("producer\.purchase\.proofOfPayment\.confirm"\)/);
    expect(purchase).toMatch(/notImplemented\("producer\.purchase\.proofOfPayment\.reject"\)/);
  });
});
