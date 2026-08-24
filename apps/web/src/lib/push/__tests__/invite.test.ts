// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  dismissPushInvite,
  parsePushInviteDismissedAt,
  PUSH_INVITE_DISMISS_MS,
  pushInviteEligible,
  readPushInviteDismissedAt,
} from "~/lib/push/invite";

const NOW = 1_756_000_000_000;

function eligibleInput(overrides: Partial<Parameters<typeof pushInviteEligible>[0]> = {}) {
  return {
    supported: true,
    permission: "default" as NotificationPermission,
    subscribed: false,
    dismissedAt: null,
    now: NOW,
    ...overrides,
  };
}

describe("pushInviteEligible", () => {
  it("shows the invite when push works, nothing is on, and nobody said no", () => {
    expect(pushInviteEligible(eligibleInput())).toBe(true);
    expect(pushInviteEligible(eligibleInput({ permission: "granted" }))).toBe(true);
  });

  it("stays hidden when unsupported, already subscribed, or permission denied", () => {
    expect(pushInviteEligible(eligibleInput({ supported: false }))).toBe(false);
    expect(pushInviteEligible(eligibleInput({ subscribed: true }))).toBe(false);
    expect(pushInviteEligible(eligibleInput({ permission: "denied" }))).toBe(false);
  });

  it("respects a dismissal for 90 days and re-allows after it expires", () => {
    expect(pushInviteEligible(eligibleInput({ dismissedAt: NOW - 1000 }))).toBe(false);
    expect(
      pushInviteEligible(eligibleInput({ dismissedAt: NOW - PUSH_INVITE_DISMISS_MS + 1 })),
    ).toBe(false);
    expect(
      pushInviteEligible(eligibleInput({ dismissedAt: NOW - PUSH_INVITE_DISMISS_MS })),
    ).toBe(true);
  });
});

describe("dismissal marker", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("parses only finite positive timestamps", () => {
    expect(parsePushInviteDismissedAt(null)).toBeNull();
    expect(parsePushInviteDismissedAt("")).toBeNull();
    expect(parsePushInviteDismissedAt("garbage")).toBeNull();
    expect(parsePushInviteDismissedAt("-5")).toBeNull();
    expect(parsePushInviteDismissedAt("Infinity")).toBeNull();
    expect(parsePushInviteDismissedAt(String(NOW))).toBe(NOW);
  });

  it("round-trips a dismissal through storage", () => {
    expect(readPushInviteDismissedAt()).toBeNull();
    dismissPushInvite(NOW);
    expect(readPushInviteDismissedAt()).toBe(NOW);
  });
});
