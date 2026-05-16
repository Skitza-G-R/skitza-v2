import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-grep on the client wrapper that owns the booking flow. For
// per-song products it must mount <SongCountStepper> and feed the
// qty + locked-in unit price into the checkout action.

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

  it("tracks songQty and unitPriceCents in local state for the booking action", () => {
    expect(clientSrc).toMatch(/songQty/);
    expect(clientSrc).toMatch(/unitPriceCents/);
  });

  it("passes songQty + unitPriceCents to startStoreCheckoutAction", () => {
    expect(clientSrc).toMatch(/startStoreCheckoutAction\(\s*\{[\s\S]{0,200}songQty/);
    expect(clientSrc).toMatch(/startStoreCheckoutAction\(\s*\{[\s\S]{0,200}unitPriceCents/);
  });
});

describe("store/[productId]/actions.ts wiring", () => {
  it("startStoreCheckoutAction accepts optional songQty + unitPriceCents", () => {
    expect(actionsSrc).toMatch(/songQty\?:\s*number/);
    expect(actionsSrc).toMatch(/unitPriceCents\?:\s*number/);
  });

  it("threads the new fields through to caller.artist.store.checkout", () => {
    expect(actionsSrc).toMatch(/caller\.artist\.store\.checkout\(\s*input\s*\)/);
  });
});

describe("store/[productId]/page.tsx wiring", () => {
  it("threads pricingModel + volumeTiers down to StoreProductClient", () => {
    expect(pageSrc).toMatch(/pricingModel/);
    expect(pageSrc).toMatch(/volumeTiers/);
  });
});
