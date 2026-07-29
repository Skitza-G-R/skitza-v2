import { describe, expect, it } from "vitest";

import { createFixtureAdminRepository } from "./demo-repository";

describe("fixture admin repository", () => {
  it("keeps every read bound to one explicit environment", () => {
    const liveRepository = createFixtureAdminRepository("live");

    expect(() => liveRepository.getOverview("test")).toThrow("environment mismatch");
    expect(() => liveRepository.searchUsers("test")).toThrow("environment mismatch");
  });

  it("uses deterministic demo identities and non-customer emails", async () => {
    const repository = createFixtureAdminRepository("live");
    const directory = await repository.searchUsers("live");

    expect(directory.users.length).toBeGreaterThan(0);
    for (const user of directory.users) {
      expect(user.id).toMatch(/^demo_live_/);
      expect(user.email).toMatch(/@example\.com$/);
    }
  });

  it("provides separate Live and Test datasets", async () => {
    const live = await createFixtureAdminRepository("live").getOverview("live");
    const test = await createFixtureAdminRepository("test").getOverview("test");

    expect(live.environment).toBe("live");
    expect(test.environment).toBe("test");
    expect(live.metrics).not.toEqual(test.metrics);
    expect(live.attention[0]?.id).toMatch(/^demo_live_/);
    expect(test.attention[0]?.id).toMatch(/^demo_test_/);
  });

  it("keeps Overview to four primary metrics and two chart datasets", async () => {
    const overview = await createFixtureAdminRepository("live").getOverview("live");

    expect(overview.metrics).toHaveLength(4);
    expect(overview.activationTrend.length).toBeGreaterThan(0);
    expect(overview.activityTrend.length).toBeGreaterThan(0);
  });

  it("keeps recorded money separated by currency", async () => {
    const payments = await createFixtureAdminRepository("live").listPayments("live");

    expect(payments.totals.map((metric) => metric.label)).toEqual(
      expect.arrayContaining(["Verified ILS recorded", "Verified USD recorded"]),
    );
    expect(payments.totals.some((metric) => /combined|total sales|gmv/i.test(metric.label))).toBe(
      false,
    );
  });

  it("allows retry only on the explicitly supported payment failure fixture", async () => {
    const payments = await createFixtureAdminRepository("live").listPayments("live");
    const retryable = payments.payments.filter((payment) => payment.retrySupported);

    expect(retryable).toHaveLength(1);
    expect(retryable[0]?.state).toBe("Proof rejected");
    expect(payments.payments.find((payment) => payment.state === "Approved")?.retrySupported).toBe(
      false,
    );
  });

  it("links every payment to its producer and preserves an immutable event timeline", async () => {
    const repository = createFixtureAdminRepository("live");
    const directory = await repository.searchUsers("live");
    const payments = await repository.listPayments("live");

    for (const payment of payments.payments) {
      expect(directory.users.some((user) => user.id === payment.producerUserId)).toBe(true);
      expect(payment.timeline.length).toBeGreaterThan(0);
      expect(payment.timeline.every((entry) => entry.id.startsWith("demo_live_"))).toBe(true);
    }
  });

  it("keeps every mutation capability inert in demo mode", async () => {
    const repository = createFixtureAdminRepository("test");
    const users = await repository.searchUsers("test");
    const firstUser = users.users[0];
    expect(firstUser).toBeDefined();
    if (!firstUser) throw new Error("Expected at least one demo user.");
    const profile = await repository.getUserProfile("test", firstUser.id);
    const payments = await repository.listPayments("test");
    const health = await repository.getSystemHealth("test");

    expect(profile?.capability.enabled).toBe(false);
    expect(payments.capability.enabled).toBe(false);
    expect(health.capability.enabled).toBe(false);
  });

  it("keeps profile activity scoped to the selected demo user", async () => {
    const repository = createFixtureAdminRepository("live");
    const directory = await repository.searchUsers("live");

    for (const user of directory.users) {
      const profile = await repository.getUserProfile("live", user.id);
      expect(profile?.activity.length).toBeGreaterThan(0);
      expect(profile?.activity.every((entry) => entry.detail.includes(user.name))).toBe(true);
    }
  });

  it("keeps profile timestamps aligned with their environment dataset", async () => {
    const liveRepository = createFixtureAdminRepository("live");
    const testRepository = createFixtureAdminRepository("test");
    const liveUser = (await liveRepository.searchUsers("live")).users[0];
    const testUser = (await testRepository.searchUsers("test")).users[0];
    expect(liveUser).toBeDefined();
    expect(testUser).toBeDefined();
    if (!liveUser || !testUser) throw new Error("Expected demo users.");

    const liveProfile = await liveRepository.getUserProfile("live", liveUser.id);
    const testProfile = await testRepository.getUserProfile("test", testUser.id);

    expect(liveProfile?.updatedAt).not.toBe(testProfile?.updatedAt);
  });
});
