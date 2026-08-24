import { describe, expect, it } from "vitest";

import {
  BETA_ACTIVATION_HELP_AFTER_DAYS,
  BETA_SIGNUP_REMINDER_AFTER_DAYS,
  planBetaStatusSync,
  selectBetaNudges,
  type BetaNudgeCandidate,
} from "../beta";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

describe("planBetaStatusSync", () => {
  it("moves a pending invitee with a producer account to signed_up", () => {
    const plan = planBetaStatusSync(
      [{ email: "a@example.com", id: "row-a", status: "pending" }],
      new Set(["a@example.com"]),
      new Set(),
    );
    expect(plan.markSignedUp).toEqual(["row-a"]);
    expect(plan.markActive).toEqual([]);
  });

  it("jumps straight to active when the producer already has a project", () => {
    const plan = planBetaStatusSync(
      [{ email: "a@example.com", id: "row-a", status: "pending" }],
      new Set(["a@example.com"]),
      new Set(["a@example.com"]),
    );
    expect(plan.markSignedUp).toEqual([]);
    expect(plan.markActive).toEqual(["row-a"]);
  });

  it("promotes invited and signed_up rows but never re-marks signed_up", () => {
    const plan = planBetaStatusSync(
      [
        { email: "b@example.com", id: "row-b", status: "invited" },
        { email: "c@example.com", id: "row-c", status: "signed_up" },
        { email: "d@example.com", id: "row-d", status: "signed_up" },
      ],
      new Set(["b@example.com", "c@example.com", "d@example.com"]),
      new Set(["d@example.com"]),
    );
    expect(plan.markSignedUp).toEqual(["row-b"]);
    expect(plan.markActive).toEqual(["row-d"]);
  });

  it("never touches active rows or emails without a producer", () => {
    const plan = planBetaStatusSync(
      [
        { email: "done@example.com", id: "row-done", status: "active" },
        { email: "stranger@example.com", id: "row-s", status: "invited" },
      ],
      new Set(["done@example.com"]),
      new Set(["done@example.com"]),
    );
    expect(plan.markSignedUp).toEqual([]);
    expect(plan.markActive).toEqual([]);
  });
});

function candidate(overrides: Partial<BetaNudgeCandidate>): BetaNudgeCandidate {
  return {
    activationHelpSentAt: null,
    email: "person@example.com",
    id: "row-1",
    invitedAt: null,
    name: "Person",
    signedUpAt: null,
    signupReminderSentAt: null,
    status: "invited",
    ...overrides,
  };
}

describe("selectBetaNudges", () => {
  it("sends the signup reminder exactly at the threshold, not a minute before", () => {
    const due = candidate({ id: "due", invitedAt: daysAgo(BETA_SIGNUP_REMINDER_AFTER_DAYS) });
    const early = candidate({
      id: "early",
      invitedAt: new Date(daysAgo(BETA_SIGNUP_REMINDER_AFTER_DAYS).getTime() + 60_000),
    });
    const picked = selectBetaNudges([due, early], NOW);
    expect(picked.signupReminders.map((row) => row.id)).toEqual(["due"]);
    expect(picked.activationHelp).toEqual([]);
  });

  it("never repeats a nudge once its sent stamp is set", () => {
    const reminded = candidate({
      id: "reminded",
      invitedAt: daysAgo(30),
      signupReminderSentAt: daysAgo(25),
    });
    const helped = candidate({
      activationHelpSentAt: daysAgo(1),
      id: "helped",
      signedUpAt: daysAgo(30),
      status: "signed_up",
    });
    const picked = selectBetaNudges([reminded, helped], NOW);
    expect(picked.signupReminders).toEqual([]);
    expect(picked.activationHelp).toEqual([]);
  });

  it("sends activation help only to stalled signed_up invitees", () => {
    const stalled = candidate({
      id: "stalled",
      signedUpAt: daysAgo(BETA_ACTIVATION_HELP_AFTER_DAYS),
      status: "signed_up",
    });
    const fresh = candidate({
      id: "fresh",
      signedUpAt: daysAgo(1),
      status: "signed_up",
    });
    const picked = selectBetaNudges([stalled, fresh], NOW);
    expect(picked.activationHelp.map((row) => row.id)).toEqual(["stalled"]);
    expect(picked.signupReminders).toEqual([]);
  });

  it("ignores pending and active rows and rows missing their timestamps", () => {
    const picked = selectBetaNudges(
      [
        candidate({ id: "pending", status: "pending" }),
        candidate({ id: "active", status: "active" }),
        candidate({ id: "no-invited-at", invitedAt: null, status: "invited" }),
        candidate({ id: "no-signed-up-at", signedUpAt: null, status: "signed_up" }),
      ],
      NOW,
    );
    expect(picked.signupReminders).toEqual([]);
    expect(picked.activationHelp).toEqual([]);
  });
});
