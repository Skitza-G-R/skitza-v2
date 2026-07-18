import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-grep on the live request caller. Per-song quantity is request
// intent; commercial price and plan must not be trusted or frozen here.

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(here, "..", "store-product-client.tsx");
const ACTIONS_PATH = join(here, "..", "actions.ts");
const PAGE_PATH = join(here, "..", "page.tsx");

const clientSrc = readFileSync(CLIENT_PATH, "utf8");
const actionsSrc = readFileSync(ACTIONS_PATH, "utf8");
const pageSrc = readFileSync(PAGE_PATH, "utf8");

describe("store-product-client.tsx wiring", () => {
  it("imports SongCountStepper from the co-located component", () => {
    expect(clientSrc).toMatch(/from\s+['"]\.\/song-count-stepper['"]/);
    expect(clientSrc).toMatch(/SongCountStepper/);
  });

  it("accepts pricingModel + volumeTiers on the product prop", () => {
    expect(clientSrc).toMatch(/pricingModel/);
    expect(clientSrc).toMatch(/volumeTiers/);
  });

  it("renders the stepper only when pricingModel === 'per_song'", () => {
    expect(clientSrc).toMatch(/pricingModel\s*===\s*["']per_song["']/);
    expect(clientSrc).toMatch(/<SongCountStepper/);
  });

  it("tracks song quantity without treating the client unit price as commercial input", () => {
    expect(clientSrc).toMatch(/songQty/);
    expect(clientSrc).not.toMatch(/setUnitPriceCents|songQty \* unitPriceCents/);
  });

  it("passes quantity and a stable operation key to the intent-only request action", () => {
    expect(clientSrc).toMatch(/requestStorePurchaseAction\(\s*\{[\s\S]{0,200}songQty/);
    expect(clientSrc).toMatch(/operationKeyRef\.current \?\? crypto\.randomUUID\(\)/);
    expect(clientSrc).not.toMatch(/startStoreCheckoutAction|Continue to checkout/);
  });

  it("does not choose a payment plan before purchase acceptance", () => {
    expect(clientSrc).not.toMatch(/PlanPicker|supportedPlans|paymentPlan/);
  });

  it("routes a created request to the request-sent page", () => {
    expect(clientSrc).toMatch(/purchaseRequestId/);
    expect(clientSrc).toMatch(/\/artist\/purchase\/\$\{product\.id\}\/sent/);
  });
});

describe("store/[productId]/actions.ts wiring", () => {
  it("calls the intent-only purchase request boundary", () => {
    expect(actionsSrc).toMatch(/caller\.artist\.purchase\.request\(input\)/);
    expect(actionsSrc).not.toMatch(/artist\.store\.checkout|checkoutUrl/);
  });

  it("accepts quantity and operation identity without a client unit price", () => {
    expect(actionsSrc).toMatch(/songQty\?:\s*number/);
    expect(actionsSrc).toMatch(/operationKey:\s*string/);
    expect(actionsSrc).not.toMatch(/unitPriceCents|paymentPlan/);
  });
});

describe("store/[productId]/page.tsx wiring", () => {
  it("threads pricingModel + volumeTiers down to StoreProductClient", () => {
    expect(pageSrc).toMatch(/pricingModel/);
    expect(pageSrc).toMatch(/volumeTiers/);
  });
});
