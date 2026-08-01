import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const detail = readFileSync(join(here, "..", "professional-product-detail.tsx"), "utf8");
const request = readFileSync(join(here, "..", "purchase-request-screen.tsx"), "utf8");

describe("professional artist Store detail", () => {
  it("uses the approved information order without boutique decoration", () => {
    const name = detail.indexOf("product.name");
    const price = detail.indexOf("formatPurchaseMoney(", detail.indexOf("return ("));
    const description = detail.indexOf("product.tagline");
    const included = detail.indexOf("What is included");
    const timing = detail.indexOf('label="Timing"');
    const offApp = detail.indexOf("After your request is approved");
    const action = detail.indexOf("Request to book");
    expect(name).toBeGreaterThan(-1);
    expect(price).toBeGreaterThan(name);
    expect(description).toBeGreaterThan(price);
    expect(included).toBeGreaterThan(description);
    expect(timing).toBeGreaterThan(included);
    expect(offApp).toBeGreaterThan(timing);
    expect(action).toBeGreaterThan(offApp);
    expect(detail).not.toMatch(/coverGradient|Signature|floating|shadow-\[/);
  });

  it("keeps per-song quantity on detail and carries it into the request step", () => {
    expect(detail).toMatch(/<SongCountStepper/);
    expect(detail).toMatch(/requestQuery\.set\("songs"/);
    expect(detail).toMatch(/\/request/);
  });

  it("starts a focused request with one primary action and stable retries", () => {
    expect(request).toMatch(/<FunnelTopBar/);
    expect(request).toMatch(/operationKeyRef\.current \?\? crypto\.randomUUID\(\)/);
    expect(request).toMatch(/requestToBookAction/);
    expect(request).toContain("Send request");
    expect(request).not.toMatch(/Pay by card|Stripe|Tranzila/i);
  });
});
