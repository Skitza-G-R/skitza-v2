import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const routerSource = readFileSync(
  join(process.cwd(), "src/server/trpc/routers/purchase-ledger.ts"),
  "utf8",
);
const appSource = readFileSync(join(process.cwd(), "src/server/trpc/routers/_app.ts"), "utf8");

describe("purchase-ledger router security contract", () => {
  it("mounts a separate generic API without changing proof routes", () => {
    expect(appSource).toContain('import { purchaseLedgerRouter } from "./purchase-ledger"');
    expect(appSource).toContain("purchaseLedger: purchaseLedgerRouter");
    expect(routerSource).not.toContain("paymentProofs");
    expect(routerSource).not.toContain("storageKey");
  });

  it("derives tenant and actor identity only from producer auth context", () => {
    expect(routerSource).toContain("producerId: ctx.producerId");
    expect(routerSource).toContain("requireActor(ctx.userId)");
    expect(routerSource).not.toMatch(/producerId:\s*z\./);
    expect(routerSource).not.toMatch(/actorId:\s*z\./);
    for (const procedure of [
      "overview",
      "project",
      "client",
      "state",
      "presignManualReceipt",
      "cancelManualReceipt",
      "recordManualPayment",
      "correctPayment",
      "waiveDebt",
      "setAutomaticReminders",
      "pauseProject",
      "resumeProject",
      "sendReminder",
    ]) {
      expect(routerSource).toMatch(new RegExp(`${procedure}: producerProcedure`));
    }
  });

  it("keeps routers thin and delegates every money transition", () => {
    expect(routerSource).toContain("loadProducerPaymentReadModel(");
    expect(routerSource).toContain("paymentLedgerReadRepository(ctx.db)");
    // SK-260: manual payments (with an optional receipt) go through the
    // producer-manual-payment domain module, which owns the ledger write.
    expect(routerSource).toContain("recordProducerManualPayment(");
    expect(routerSource).toContain("prepareProducerReceiptUpload(");
    expect(routerSource).not.toContain("recordConfirmedPurchasePayment(");
    expect(routerSource).toContain("correctPurchasePayment(");
    expect(routerSource).toContain("waiveInstallmentDebt(");
    expect(routerSource).not.toContain("cancelPurchase(");
    expect(routerSource).toContain("pauseProjectForOverdueInstallment(");
    expect(routerSource).toContain("resumePaymentPausedProject(");
    expect(routerSource).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });
});
