import { describe, expect, it } from "vitest";

import { buildHomeView } from "./view-model";

describe("buildHomeView", () => {
  it("reports a quiet console when nothing needs attention", () => {
    const view = buildHomeView({
      betaInvitesWithoutSignup: 0,
      failedInvitationEmails: 0,
      failedReminderEmails: 0,
      onboardingIncomplete: 0,
    });

    expect(view.quiet).toBe(true);
    expect(view.rows).toHaveLength(0);
  });

  it("lists only the signals that are non-zero", () => {
    const view = buildHomeView({
      betaInvitesWithoutSignup: 3,
      failedInvitationEmails: 0,
      failedReminderEmails: 5,
      onboardingIncomplete: 0,
    });

    expect(view.quiet).toBe(false);
    expect(view.rows.map((row) => row.id)).toEqual([
      "failed-reminder-emails",
      "beta-invites-without-signup",
    ]);
  });

  it("puts broken things above people waiting", () => {
    const view = buildHomeView({
      betaInvitesWithoutSignup: 0,
      failedInvitationEmails: 1,
      failedReminderEmails: 0,
      onboardingIncomplete: 4,
    });

    expect(view.rows.map((row) => row.tone)).toEqual(["broken", "waiting"]);
  });

  it("only links a row that has somewhere real to go", () => {
    const view = buildHomeView({
      betaInvitesWithoutSignup: 2,
      failedInvitationEmails: 1,
      failedReminderEmails: 1,
      onboardingIncomplete: 1,
    });

    const hrefs = Object.fromEntries(view.rows.map((row) => [row.id, row.href]));
    expect(hrefs["onboarding-incomplete"]).toBe("/users?onboarding=not-complete");
    expect(hrefs["beta-invites-without-signup"]).toBe("/beta");
    // Admin has no screen listing failed emails, so these rows must not
    // pretend to link anywhere — a dead-end link is the SK-283 bug.
    expect(hrefs["failed-invitation-emails"]).toBeUndefined();
    expect(hrefs["failed-reminder-emails"]).toBeUndefined();

    // A row with nowhere to go still has to say what to do instead.
    const hints = Object.fromEntries(view.rows.map((row) => [row.id, row.hint]));
    expect(hints["failed-invitation-emails"]).toBeTruthy();
    expect(hints["failed-reminder-emails"]).toBeTruthy();
  });
});
