import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(__dirname, "../page.tsx"),
  "utf-8",
);

describe("/artist page composition", () => {
  it("imports the 5 new home sections", () => {
    expect(SRC).toMatch(/import\s*\{\s*GreetingStrip\s*\}/);
    expect(SRC).toMatch(/import\s*\{\s*LastUploadCard\s*\}/);
    expect(SRC).toMatch(/import\s*\{\s*NextSessionCard\s*\}/);
    expect(SRC).toMatch(/import\s*\{\s*PaymentRequestsSection\s*\}/);
    expect(SRC).toMatch(/import\s*\{\s*BookSessionTiles\s*\}/);
  });

  it("fetches the three tRPC procedures in parallel", () => {
    expect(SRC).toMatch(/caller\.artist\.home\(\)/);
    expect(SRC).toMatch(/caller\.artist\.book\.myPendingPayments\(\)/);
    expect(SRC).toMatch(/caller\.artist\.studios\(\)/);
    expect(SRC).toMatch(/Promise\.all/);
  });

  it("does NOT import the deleted v3-clean components", () => {
    expect(SRC).not.toMatch(/HomeHero|LatestMixCard|UpcomingSessionsCard|BalanceCard|ActivityFeed/);
  });
});
