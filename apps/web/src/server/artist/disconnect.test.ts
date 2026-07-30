import { describe, expect, it } from "vitest";

import { evaluateArtistDisconnectBlockers } from "./disconnect";

const now = new Date("2026-07-30T12:00:00.000Z");

function emptySnapshot() {
  return {
    purchaseRequests: [],
    purchases: [],
    paymentProofs: [],
    bookings: [],
    allowances: [],
  } as const;
}

describe("evaluateArtistDisconnectBlockers", () => {
  it("allows a studio with only terminal history", () => {
    expect(
      evaluateArtistDisconnectBlockers(
        {
          ...emptySnapshot(),
          purchaseRequests: [{ id: "request", status: "converted" }],
          purchases: [
            {
              id: "purchase",
              lifecycleStatus: "active",
              projectLifecycleStatus: "completed",
            },
          ],
          paymentProofs: [{ id: "proof", status: "confirmed" }],
        },
        now,
      ),
    ).toEqual([]);
  });

  it("reports every active-work blocker instead of stopping after the first", () => {
    const blockers = evaluateArtistDisconnectBlockers(
      {
        purchaseRequests: [{ id: "request", status: "pending" }],
        purchases: [
          {
            id: "purchase",
            lifecycleStatus: "active",
            projectLifecycleStatus: "active",
          },
        ],
        paymentProofs: [{ id: "proof", status: "pending" }],
        bookings: [
          {
            id: "booking",
            sessionAllowanceId: "allowance",
            startsAt: new Date("2026-08-01T12:00:00.000Z"),
            status: "pending_approval",
            outcome: "reserved",
          },
        ],
        allowances: [
          {
            id: "allowance",
            kind: "fixed",
            sessionLimit: 2,
            purchaseLifecycleStatus: "active",
            projectLifecycleStatus: "active",
          },
        ],
      },
      now,
    );

    expect(blockers.map((blocker) => blocker.kind)).toEqual([
      "open_purchase_request",
      "active_purchase",
      "pending_payment_proof",
      "pending_booking_decision",
      "unused_session_allowance",
      "future_session",
    ]);
  });

  it("does not block on an exhausted fixed allowance", () => {
    const blockers = evaluateArtistDisconnectBlockers(
      {
        ...emptySnapshot(),
        bookings: [
          {
            id: "used",
            sessionAllowanceId: "allowance",
            startsAt: new Date("2026-07-01T12:00:00.000Z"),
            status: "completed",
            outcome: "completed",
          },
        ],
        allowances: [
          {
            id: "allowance",
            kind: "fixed",
            sessionLimit: 1,
            purchaseLifecycleStatus: "active",
            projectLifecycleStatus: "active",
          },
        ],
      },
      now,
    );

    expect(blockers).toEqual([]);
  });

  it("blocks an open unlimited allowance and ignores a terminal project's allowance", () => {
    const open = evaluateArtistDisconnectBlockers(
      {
        ...emptySnapshot(),
        allowances: [
          {
            id: "open",
            kind: "unlimited",
            sessionLimit: null,
            purchaseLifecycleStatus: "active",
            projectLifecycleStatus: "active",
          },
        ],
      },
      now,
    );
    expect(open.map((blocker) => blocker.kind)).toEqual(["unused_session_allowance"]);

    const terminal = evaluateArtistDisconnectBlockers(
      {
        ...emptySnapshot(),
        allowances: [
          {
            id: "closed-by-project",
            kind: "unlimited",
            sessionLimit: null,
            purchaseLifecycleStatus: "active",
            projectLifecycleStatus: "completed",
          },
        ],
      },
      now,
    );
    expect(terminal).toEqual([]);
  });
});
