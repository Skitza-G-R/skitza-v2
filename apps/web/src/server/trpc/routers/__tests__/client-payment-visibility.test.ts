import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const routersDir = join(here, "..");
const webSrc = join(here, "..", "..", "..", "..");

const clientContacts = readFileSync(join(routersDir, "client-contacts.ts"), "utf8");
const purchase = readFileSync(join(routersDir, "purchase.ts"), "utf8");
const workspacePage = readFileSync(
  join(webSrc, "app", "(producer)", "dashboard", "clients-projects", "page.tsx"),
  "utf8",
);
const clientPage = readFileSync(
  join(webSrc, "app", "(producer)", "dashboard", "clients-projects", "clients", "[id]", "page.tsx"),
  "utf8",
);
const requestPage = readFileSync(
  join(webSrc, "app", "(producer)", "dashboard", "requests", "[id]", "page.tsx"),
  "utf8",
);
const proofReview = readFileSync(
  join(webSrc, "components", "dashboard", "requests", "payment-proof-review.tsx"),
  "utf8",
);
const projectLedger = readFileSync(join(webSrc, "lib", "payments", "project-ledger.ts"), "utf8");
const clientProofsPath = join(
  webSrc,
  "components",
  "dashboard",
  "clients",
  "client-payment-proofs.tsx",
);

describe("producer client payment visibility", () => {
  it("uses the paid invoice ledger and exposes a month-scoped paid total", () => {
    expect(clientContacts).toMatch(/\binvoices\b/);
    expect(projectLedger).toMatch(/invoice\.status === "paid"/);
    expect(clientContacts).toMatch(/paidThisMonthCents/);
    expect(workspacePage).toMatch(/earnings \+= p\.paidThisMonthCents/);
    expect(workspacePage).not.toMatch(/earnings \+= p\.lifetimeCents/);
  });

  it("lists tenant-scoped proof history on the client page without leaking storage metadata", () => {
    expect(purchase).toMatch(/listProducerProofHistory/);
    expect(purchase).toMatch(/clientContactId/);
    expect(purchase).toMatch(/paymentProofsTableAvailable/);
    expect(clientPage).toMatch(/proofOfPayment\.history/);
    expect(clientPage).toMatch(/<ClientPaymentProofs/);
    expect(existsSync(clientProofsPath)).toBe(true);
    if (!existsSync(clientProofsPath)) return;
    const clientProofs = readFileSync(clientProofsPath, "utf8");
    expect(clientProofs).toMatch(/originalFileName/);
    expect(clientProofs).toMatch(/amountCents/);
    expect(clientProofs).toMatch(/status/);
    expect(clientProofs).toMatch(/purchaseRequestId/);
    expect(clientProofs).not.toMatch(/storageKey|storageBucket|objectEtag/);

    const historyHelper = purchase.slice(
      purchase.indexOf("export async function listProducerProofHistory"),
      purchase.indexOf("// Migration 0023", purchase.indexOf("listProducerProofHistory")),
    );
    expect(historyHelper).toMatch(/eq\(paymentProofs\.producerId, producerId\)/);
    expect(historyHelper).toMatch(/eq\(purchaseRequests\.producerId, producerId\)/);
    expect(historyHelper).toMatch(/eq\(clientContacts\.producerId, producerId\)/);
    expect(historyHelper).not.toMatch(/storageKey|storageBucket|objectEtag/);
  });

  it("reopens historical proofs but keeps decisions pending-only", () => {
    expect(requestPage).toMatch(/proofOfPayment\.history/);
    expect(requestPage).not.toMatch(/proofOfPayment\.pending\(\{\s*purchaseRequestId/);
    expect(proofReview).toMatch(/proof\.status === "pending"/);
    expect(proofReview).toMatch(/proof\.status === "confirmed"/);
    expect(proofReview).toMatch(/proof\.status === "rejected"/);
  });
});
