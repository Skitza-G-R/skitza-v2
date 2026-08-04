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

  it("fetches selected-studio Home, payments, sessions, and request state in parallel", () => {
    expect(SRC).toMatch(/caller\.artist\.home\(\{\s*producerId:/);
    expect(SRC).toMatch(/caller\.artist\.purchase\.payments\(\)/);
    expect(SRC).toMatch(/caller\.artist\.studios\(\)/);
    expect(SRC).toMatch(/caller\.artist\.book\.mySessions\(\{\s*producerId:/);
    expect(SRC).toMatch(/caller\.artist\.purchase\.current\(\{\s*producerId:/);
    expect(SRC).not.toMatch(/caller\.artist\.book\.myPendingPayments\(\)/);
    expect(SRC).toMatch(/Promise\.all/);
  });

  it("uses the saved artist IANA timezone for Home booking labels", () => {
    expect(SRC).toContain("caller.artistPlatform.profile.get()");
    expect(SRC).toContain('artistProfile.timezone ?? "UTC"');
    expect(SRC).toContain("artistGreeting(new Date(), firstName, artistTimezone)");
    expect(SRC).toContain("artistHomeBookingStatusActions({");
    expect(SRC).toContain("artistTimezone,");
  });

  it("does not reintroduce old dashboard or multi-studio Home sections", () => {
    expect(SRC).not.toMatch(/HomeHero|LatestMixCard|UpcomingSessionsCard|BalanceCard|ActivityFeed/);
    expect(SRC).not.toMatch(/BookSessionTiles|studiosForTiles/);
  });

  it("derives Home booking status from real session rows and keeps plain payment labels", () => {
    expect(SRC).toContain("sessions: sessions.sessions");
    expect(SRC).toContain("producerId: activeStudio.producerId");
    expect(SRC).toContain(
      "candidates.push(...bookingStatusActions.filter(({ mainEligible }) => mainEligible))",
    );
    expect(SRC).toContain("const supporting: ArtistHomeAction[] = [...bookingStatusActions]");
    expect(SRC).not.toContain("artistNotifications");
    expect(SRC).toMatch(/First payment/);
    expect(SRC).toMatch(/Remaining balance/);
  });
});
