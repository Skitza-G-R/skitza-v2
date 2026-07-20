import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(__dirname, "../page.tsx"), "utf-8");

describe("/artist page composition", () => {
  it("imports separate request, payment, music, and session home sections", () => {
    expect(SRC).toMatch(/import\s*\{\s*GreetingStrip\s*\}/);
    expect(SRC).toMatch(/import\s*\{\s*LastUploadCard\s*\}/);
    expect(SRC).toMatch(/import\s*\{\s*NextSessionCard\s*\}/);
    expect(SRC).toMatch(/import\s*\{\s*ArtistPaymentActionsCard\s*\}/);
    expect(SRC).toMatch(/import\s*\{\s*PurchaseStatusCard\s*\}/);
    expect(SRC).toMatch(/import\s*\{\s*BookSessionTiles\s*\}/);
    expect(SRC).not.toMatch(/PaymentRequestsSection/);
  });

  it("fetches the canonical payment projection with the other Home sources in parallel", () => {
    expect(SRC).toMatch(/caller\.artist\.home\(\)/);
    expect(SRC).toMatch(/caller\.artist\.purchase\.payments\(\)/);
    expect(SRC).toMatch(/caller\.artist\.studios\(\)/);
    expect(SRC).not.toMatch(/caller\.artist\.book\.myPendingPayments\(\)/);
    expect(SRC).toMatch(/Promise\.all/);
  });

  it("does NOT import the deleted v3-clean components", () => {
    expect(SRC).not.toMatch(/HomeHero|LatestMixCard|UpcomingSessionsCard|BalanceCard|ActivityFeed/);
  });
});
