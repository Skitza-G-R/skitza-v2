import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(__dirname, "../page.tsx"), "utf-8");

describe("/artist page composition", () => {
  it("renders one prioritized professional Home surface", () => {
    expect(SRC).toMatch(/ProfessionalArtistHome/);
    expect(SRC).toMatch(/selectArtistHomeMainAction/);
    expect(SRC).toMatch(/withoutArtistHomeDuplicate/);
    expect(SRC).not.toMatch(
      /GreetingStrip|LastUploadCard|NextSessionCard|ArtistPaymentActionsCard|PurchaseStatusCard|BookSessionTiles|PaymentRequestsSection/,
    );
  });

  it("keeps request status outside the selected-studio Home critical path", () => {
    expect(SRC).toMatch(/caller\.artist\.home\(\{\s*producerId:/);
    expect(SRC).toMatch(/caller\.artist\.purchase\.payments\(\)/);
    expect(SRC).toMatch(/caller\.artist\.studios\(\)/);
    expect(SRC).toMatch(/caller\.artist\.book\.mySessions\(\{\s*producerId:/);
    expect(SRC).toMatch(/caller\.artist\.purchase\.current\(\{\s*producerId:/);
    expect(SRC).not.toMatch(/caller\.artist\.book\.myPendingPayments\(\)/);
    expect(SRC).toMatch(
      /const \[home, paymentReadModel, sessions\] = await Promise\.all\([\s\S]*?\);/,
    );
    expect(SRC).toMatch(/<Suspense fallback=\{null\}>/);
    expect(SRC).toMatch(/<ArtistHomeSupportingSection/);
    expect(SRC).toMatch(/async function ArtistHomeSupportingSection/);
  });

  it("uses the saved artist IANA timezone for Home date labels", () => {
    expect(SRC).toContain("caller.artistPlatform.profile.get()");
    expect(SRC).toContain('artistProfile.timezone ?? "UTC"');
    expect(SRC).toContain("artistGreeting(new Date(), firstName, artistTimezone)");
    expect(SRC).toContain("isSameArtistDay(");
    expect(SRC).toContain("formatArtistTimeRange(");
    expect(SRC).toContain("formatArtistDateTime(");
  });

  it("does not reintroduce old dashboard or multi-studio Home sections", () => {
    expect(SRC).not.toMatch(/HomeHero|LatestMixCard|UpcomingSessionsCard|BalanceCard|ActivityFeed/);
    expect(SRC).not.toMatch(/BookSessionTiles|studiosForTiles/);
  });

  it("uses exact session details and plain payment labels", () => {
    expect(SRC).toMatch(/\/artist\/sessions\/\$\{home\.nextSession\.id\}/);
    expect(SRC).toMatch(/First payment/);
    expect(SRC).toMatch(/Remaining balance/);
  });
});
