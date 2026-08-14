import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "page.tsx"), "utf8");

describe("dashboard/store/page.tsx", () => {
  it("authenticates via Clerk and redirects unauthenticated visitors", () => {
    expect(SRC).toMatch(/auth\(\)/);
    expect(SRC).toMatch(/redirect\("\/sign-in"\)/);
  });

  it("calls booking.packages.list and producer.me via the server caller", () => {
    expect(SRC).toMatch(/booking\.packages\.list/);
    expect(SRC).toMatch(/producer\.me/);
  });

  it("mounts <StoreScreen>", () => {
    expect(SRC).toMatch(/<StoreScreen/);
  });

  it("moves private offers into the Store workspace instead of rendering them above it", () => {
    const storeScreenStart = SRC.indexOf("<StoreScreen");
    const privateOfferManagerStart = SRC.indexOf("<PrivateOfferManager");

    expect(storeScreenStart).toBeGreaterThan(-1);
    expect(privateOfferManagerStart).toBeGreaterThan(storeScreenStart);
    expect(SRC).toMatch(/privateOffers=\{/);
    expect(SRC).toMatch(/privateOfferCount=\{offerHistory\.offers\.length\}/);
    expect(SRC).toMatch(/privateOfferRecipients=\{offerRecipients\}/);
  });

  it("builds each private-offer shortcut from canonical raw product fields", () => {
    expect(SRC).toMatch(/buildPrivateOfferTemplateProduct\(p,/);
    expect(SRC).toMatch(/privateOfferTemplate:/);
    expect(SRC).not.toMatch(/displayCents/);
  });

  it("passes the producer identity needed by copy-link and artist preview actions", () => {
    expect(SRC).toMatch(/producerSlug=\{profile\.slug\}/);
    expect(SRC).toMatch(/producerLogoUrl=\{profile\.brand\.logoUrl \?\? null\}/);
  });

  it("maps purchase-level plans without old deposit compatibility fields", () => {
    expect(SRC).toMatch(/paymentPlans:\s*p\.paymentPlans/);
    expect(SRC).not.toMatch(/depositPct|depositModel|milestones/);
  });

  it("does not depend on the removed legacy booking form for Store currency", () => {
    expect(SRC).not.toMatch(/booking\/package-form/);
  });

  it("forwards only a server-proven delete/archive lifecycle action", () => {
    expect(SRC).toMatch(/removalAction:\s*p\.removalAction/);
  });
});
