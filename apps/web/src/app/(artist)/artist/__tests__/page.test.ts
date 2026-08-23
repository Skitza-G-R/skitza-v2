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

  it("uses artist time for the greeting and producer time for session labels", () => {
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
    expect(SRC).toContain("const supporting: ArtistHomeAction[] = [");
    expect(SRC).toContain("...bookingStatusActions,");
    expect(SRC).not.toContain("artistNotifications");
    expect(SRC).toMatch(/First payment/);
    expect(SRC).toMatch(/Remaining balance/);
  });

  it("orders payment actions by the honest commercial establishment date", () => {
    expect(SRC).toContain("purchase.commercialEstablishedAt");
    expect(SRC).toContain("proofUnderReview.purchase.commercialEstablishedAt");
    expect(SRC).not.toContain("purchase.acceptedAt");
  });

  it('claims a payment is "due" only when the ledger says it is due now', () => {
    // Payable (showPayNextPayment) is looser than due: an anchored monthly
    // installment is payable early. Without the dueNow gate the Home card
    // reads "₪X due" while the producer's client page says all payments are
    // up to date — the same ledger contradicting itself across roles.
    const paymentBranch = SRC.match(
      /for \(const \{ purchase, projectTitle \} of selectedPayments\)[\s\S]*?\n {2}\}/,
    )?.[0];
    expect(paymentBranch).toBeDefined();
    expect(paymentBranch).toContain(
      "if (!purchase.showPayNextPayment || !purchase.nextPayment) continue;",
    );
    expect(paymentBranch).toContain("if (!purchase.nextPayment.dueNow) continue;");
    expect(paymentBranch).toMatch(/\$\{formatPurchaseMoney\([\s\S]*?\)\} due/);
  });

  it("keeps the unread exact Version visible when a higher-priority Home action wins", () => {
    const newSongBranch = SRC.match(
      /let newSongAction:[\s\S]*?if \(home\.latestMix\?\.unread\)[\s\S]*?\n {2}\}/,
    )?.[0];

    expect(newSongBranch).toBeDefined();
    expect(newSongBranch).toContain('kind: "new_song"');
    expect(newSongBranch).toContain("id: home.latestMix.id");
    expect(newSongBranch).toContain("candidates.push(newSongAction)");
    expect(SRC).toContain('newSong={main.kind === "new_song" ? null : newSongAction}');
  });

  it("promotes an approved product request into the exact payment-plan continuation", () => {
    const approvedBranch = SRC.match(
      /if \(\s*currentPurchaseRequest\?\.status === "approved"[\s\S]*?\n {2}\}/,
    )?.[0];

    expect(approvedBranch).toBeDefined();
    expect(approvedBranch).toContain("currentPurchaseRequest.acceptanceAvailable");
    expect(approvedBranch).toContain("currentPurchaseRequest.productId");
    expect(approvedBranch).toContain("candidates.push(approvedRequestAction)");
    expect(approvedBranch).toContain('kind: "payment_action"');
    expect(approvedBranch).toMatch(
      /href: currentPurchaseRequest\.acceptanceAvailable\s*\? withArtistStudio\(\s*`\/artist\/purchase\/\$\{currentPurchaseRequest\.productId\}\/pay\?req=\$\{currentPurchaseRequest\.id\}`/,
    );
    expect(approvedBranch).toContain("activeStudio.producerId");
    expect(approvedBranch).toContain('withArtistStudio("/artist/store"');
    expect(approvedBranch).toContain('"Choose a payment plan"');
    expect(approvedBranch).toContain('"View services"');
    expect(SRC).toContain("...(approvedRequestAction ? [approvedRequestAction] : [])");
    expect(SRC.indexOf("...(approvedRequestAction ? [approvedRequestAction] : [])")).toBeLessThan(
      SRC.indexOf("...bookingStatusActions,"),
    );
    expect(SRC.indexOf('currentPurchaseRequest?.status === "approved"')).toBeLessThan(
      SRC.indexOf("const main = selectArtistHomeMainAction(candidates)"),
    );
  });
});
