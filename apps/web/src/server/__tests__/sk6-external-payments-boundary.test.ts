import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const webRoot = process.cwd();

function source(path: string): string {
  return readFileSync(join(webRoot, path), "utf8");
}

describe("SK-6 external-payments-only boundary", () => {
  it("keeps instruction reads and writes behind tenant-owned purchase boundaries", () => {
    const purchase = source("src/server/trpc/routers/purchase.ts");
    const service = source("src/server/domain/payment-instructions/service.ts");

    expect(purchase).toMatch(/paymentInstructions: artistProcedure/);
    expect(purchase).toMatch(/paymentInstructions: router\(\{[\s\S]*get: producerProcedure/);
    expect(purchase).toMatch(/[\s\S]*update: producerProcedure/);
    expect(service).toMatch(/activeArtistClientOwner\(clerkUserId/);
    expect(service).toMatch(/eq\(purchases\.producerId, purchaseInstallments\.producerId\)/);
    expect(service).toMatch(/where\(eq\(producers\.id, producerId\)\)/);
    expect(service).toMatch(/projectPurchaseLedger\(/);
    expect(service).toMatch(/remainingCents: ledger\.remainingCents/);
    expect(service).not.toMatch(/summarizePurchaseLedger\(/);
    expect(service).not.toMatch(/update\(purchases\)|update\(purchaseInstallments\)/);
  });

  it("does not expose a Store card-checkout procedure or processor pricing gate", () => {
    const artist = source("src/server/trpc/routers/artist.ts");
    const store = artist.slice(
      artist.indexOf("const storeSubrouter"),
      artist.indexOf("export type StoreProductRow"),
    );

    expect(store).not.toMatch(/checkout:\s*artistProcedure/);
    expect(store).not.toMatch(/Stripe|Tranzila|stripeAccountId|stripeChargesEnabled/);
    expect(store).not.toMatch(/inArray\(products\.pricingModel,\s*\["flat",\s*"per_song"\]\)/);
  });

  it("does not promise an artist saved card or replacement-card flow", () => {
    const artistSettings = source("src/app/(artist)/artist/settings/page.tsx");

    expect(artistSettings).not.toMatch(/Payment method|Add a card|replace(?:ment)? card/i);
  });

  it("does not require Stripe configuration", () => {
    expect(source(".env.example")).not.toMatch(/STRIPE|api\/stripe/i);
    expect(source(".env.local.example")).not.toMatch(/STRIPE|api\/stripe/i);
  });

  it("keeps onboarding, Store, and booking free of processor-connection gates", () => {
    const onboarding = source("src/app/(onboarding)/onboarding/payment/payment-step-client.tsx");
    const booking = source("src/server/trpc/routers/booking.ts");
    const artist = source("src/server/trpc/routers/artist.ts");

    expect(onboarding).toMatch(/External payments only/);
    expect(onboarding).toMatch(/does not connect a payment provider/);
    expect(booking).not.toMatch(/stripeAccountId|stripeChargesEnabled|tranzilaTerminalName/);
    expect(artist).not.toMatch(/stripeAccountId|stripeChargesEnabled|tranzilaTerminalName/);
  });
});
