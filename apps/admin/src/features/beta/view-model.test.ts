import { describe, expect, it } from "vitest";

import type { BetaInvitee } from "@skitza/db";
import {
  betaStatusTone,
  countBetaStatuses,
  formatBetaDate,
  groupBetaInviteesByWave,
  serializeBetaInvitee,
  type BetaInviteeView,
} from "./view-model";

function view(overrides: Partial<BetaInviteeView>): BetaInviteeView {
  return {
    activatedAt: null,
    email: "person@example.com",
    invitedAt: null,
    name: null,
    signedUpAt: null,
    status: "pending",
    wave: 1,
    ...overrides,
  };
}

describe("serializeBetaInvitee", () => {
  it("converts dates to ISO strings and keeps nulls", () => {
    const row = {
      activatedAt: null,
      activationHelpSentAt: null,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      email: "noa@example.com",
      id: "row-1",
      invitedAt: new Date("2026-08-20T10:00:00.000Z"),
      name: "Noa",
      notes: null,
      signedUpAt: null,
      signupReminderSentAt: null,
      status: "invited",
      updatedAt: new Date("2026-08-20T10:00:00.000Z"),
      wave: 2,
    } satisfies BetaInvitee;

    expect(serializeBetaInvitee(row)).toEqual({
      activatedAt: null,
      email: "noa@example.com",
      invitedAt: "2026-08-20T10:00:00.000Z",
      name: "Noa",
      signedUpAt: null,
      status: "invited",
      wave: 2,
    });
  });
});

describe("groupBetaInviteesByWave", () => {
  it("groups rows by wave in ascending wave order", () => {
    const grouped = groupBetaInviteesByWave([
      view({ email: "c@example.com", wave: 3 }),
      view({ email: "a@example.com", wave: 1 }),
      view({ email: "b@example.com", wave: 1 }),
    ]);

    expect(grouped.map(([wave]) => wave)).toEqual([1, 3]);
    expect(grouped[0]?.[1].map((row) => row.email)).toEqual(["a@example.com", "b@example.com"]);
  });
});

describe("countBetaStatuses", () => {
  it("counts every status bucket", () => {
    const counts = countBetaStatuses([
      view({ status: "pending" }),
      view({ status: "invited" }),
      view({ status: "invited" }),
      view({ status: "signed_up" }),
      view({ status: "active" }),
    ]);

    expect(counts).toEqual({ active: 1, invited: 2, pending: 1, signed_up: 1 });
  });
});

describe("formatBetaDate", () => {
  it("formats ISO dates in UTC and falls back to a dash", () => {
    expect(formatBetaDate("2026-08-20T23:30:00.000Z")).toBe("20 Aug 2026");
    expect(formatBetaDate(null)).toBe("—");
    expect(formatBetaDate("garbage")).toBe("—");
  });
});

describe("betaStatusTone", () => {
  it("maps each status to its badge tone", () => {
    expect(betaStatusTone("pending")).toBe("muted");
    expect(betaStatusTone("invited")).toBe("warning");
    expect(betaStatusTone("signed_up")).toBe("info");
    expect(betaStatusTone("active")).toBe("success");
  });
});
