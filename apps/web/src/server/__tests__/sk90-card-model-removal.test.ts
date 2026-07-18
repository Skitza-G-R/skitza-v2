import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const webRoot = join(process.cwd());
const repoRoot = join(webRoot, "../..");

function source(path: string): string {
  return readFileSync(join(webRoot, path), "utf8");
}

describe("SK-90 removed card-processing paths", () => {
  it("does not ship live Stripe or Tranzila execution endpoints", () => {
    const removed = [
      "src/app/api/stripe/webhook/route.ts",
      "src/app/api/stripe/webhook/handlers.ts",
      "src/app/api/tranzila/callback/route.ts",
      "src/server/payments/checkout-initiator.ts",
      "src/server/payments/checkout.ts",
      "src/server/stripe/client.ts",
      "src/server/stripe/customer.ts",
      "src/lib/tranzila.ts",
    ];

    for (const path of removed) {
      expect(existsSync(join(webRoot, path)), path).toBe(false);
    }
  });

  it("does not register a card-processing router or dependency", () => {
    const appRouter = source("src/server/trpc/routers/_app.ts");
    const packageJson = JSON.parse(
      readFileSync(join(repoRoot, "apps/web/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(appRouter).not.toMatch(/stripeRouter|stripe:\s*stripeRouter/);
    expect(packageJson.dependencies).not.toHaveProperty("stripe");
  });

  it("keeps artist and project routers free of direct-card execution", () => {
    const artist = source("src/server/trpc/routers/artist.ts");
    const project = source("src/server/trpc/routers/project.ts");

    expect(artist).not.toMatch(/initiatePaidPlanCheckout|stripeAccountId|stripeChargesEnabled/);
    expect(project).not.toMatch(/getStripe|paymentIntents\.create|subscriptionSchedules\.cancel/);
  });

  it("keeps artist payment-plan helpers limited to the approved paid plans", () => {
    const payData = source("src/components/artist/purchase/pay-data.ts");

    expect(payData).not.toMatch(/\bmilestones?\b/i);
    expect(payData).not.toMatch(/kind:\s*["']none["']/);
  });

  it("does not retain the removed project Milestone and invoice panels", () => {
    const removed = [
      "src/components/dashboard/project/album-tabs/payments-tab.tsx",
      "src/components/dashboard/song/song-tabs/payments-tab.tsx",
      "src/components/project/payment-status-strip.tsx",
      "src/components/project/payment-status-strip-helpers.ts",
      "src/components/project/__tests__/payment-status-strip.test.ts",
      "src/components/checkout/plan-picker.tsx",
    ];

    for (const path of removed) {
      expect(existsSync(join(webRoot, path)), path).toBe(false);
    }
  });

  it("does not expose dead project invoice commands", () => {
    const project = source("src/server/trpc/routers/project.ts");
    const actions = source("src/app/(producer)/dashboard/clients-projects/actions.ts");

    expect(project).not.toMatch(/AddInvoiceInput|\baddInvoice\b/);
    expect(actions).not.toMatch(/\baddProjectInvoice\b/);
  });

  it("does not export the removed project/invoice-era payment emails", () => {
    const removed = [
      "src/server/email/templates/final-payment-due.tsx",
      "src/server/email/templates/payment-received.tsx",
      "src/lib/payments/project-ledger.ts",
      "src/lib/payments/__tests__/project-ledger.test.ts",
    ];
    for (const path of removed) {
      expect(existsSync(join(webRoot, path)), path).toBe(false);
    }

    const emailSend = source("src/server/email/send.tsx");
    const smoke = source("src/server/email/templates/__tests__/smoke-render.test.tsx");

    expect(emailSend).not.toMatch(/sendFinalPaymentDueEmail|FinalPaymentDue/);
    expect(emailSend).not.toMatch(/sendPaymentReceivedEmail|PaymentReceived/);
    expect(smoke).not.toMatch(/FinalPaymentDue|PaymentReceived/);
  });

  it("does not expose removed card or invoice actions in Today", () => {
    const detail = source("src/components/dashboard/today/today-detail.tsx");
    const list = source("src/components/dashboard/today/today-list.tsx");
    const producer = source("src/server/trpc/routers/producer.ts");

    expect(detail).not.toMatch(/Open Stripe|kind === "invoice"|invoice:\s*"Invoice"/);
    expect(list).not.toMatch(/\| "invoice"|invoice:\s*"\$"/);
    expect(producer).not.toMatch(/invoiceItems|unpaidInvoiceRows|kind:\s*"invoice"/);
  });

  it("does not expose dead project commercial or legacy-lifecycle commands", () => {
    const project = source("src/server/trpc/routers/project.ts");
    const actions = source("src/app/(producer)/dashboard/clients-projects/actions.ts");

    expect(project).not.toMatch(/\b(money|setPaid|chargeFinal|cancel|setStage|setStageBulk):/);
    expect(actions).not.toMatch(
      /\b(setProjectPaid|chargeFinalAction|cancelProjectAction|setStageAction|bulkSetProjectStage)\b/,
    );
    expect(existsSync(join(webRoot, "src/components/project/confirm-charge-modal.tsx"))).toBe(
      false,
    );
    expect(existsSync(join(webRoot, "src/components/project/cancel-confirm-modal.tsx"))).toBe(
      false,
    );
  });
});
