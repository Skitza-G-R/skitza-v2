import { describe, expect, it } from "vitest";

import type { SessionOutcome, SessionStatus } from "../../sessions/book-data";
import { artistHomeBookingStatusActions } from "../booking-status";
import {
  selectArtistHomeMainAction,
  type ArtistHomeAction,
  withoutArtistHomeDuplicate,
} from "../home-priority";

const NOW = new Date("2026-08-04T09:00:00.000Z");
const PRODUCER_ID = "11111111-1111-4111-8111-111111111111";

function session(
  id: string,
  status: SessionStatus,
  startsAtISO: string,
  outcome: SessionOutcome = "reserved",
) {
  return {
    id,
    producerId: PRODUCER_ID,
    producerName: "North Studio",
    producerSlug: "north-studio",
    artistTimezone: "Asia/Jerusalem",
    producerTimezone: "Asia/Jerusalem",
    projectId: "22222222-2222-4222-8222-222222222222",
    projectTitle: "Midnight EP",
    purchaseId: "33333333-3333-4333-8333-333333333333",
    sessionAllowanceId: "44444444-4444-4444-8444-444444444444",
    startsAt: new Date(startsAtISO),
    durationMin: 120,
    packageName: "Vocal session",
    locationType: "studio",
    status,
    outcome,
    heldExpiryReason: null,
  };
}

describe("Artist Home booking status", () => {
  it("shows Held and Confirmed from session rows without notification data", () => {
    const actions = artistHomeBookingStatusActions({
      sessions: [
        session("held-session", "pending_approval", "2026-08-04T12:00:00.000Z"),
        session("confirmed-session", "confirmed", "2026-08-05T12:00:00.000Z"),
      ],
      producerId: PRODUCER_ID,
      artistTimezone: "Asia/Jerusalem",
      now: NOW,
    });

    expect(actions.map((action) => action.detail)).toEqual([
      "Held · Waiting for producer approval · Today, 15:00–17:00",
      "Confirmed · Wed, Aug 5, 03:00 PM",
    ]);
  });

  it("orders the nearest session first and links each exact owned session", () => {
    const actions = artistHomeBookingStatusActions({
      sessions: [
        session("later", "confirmed", "2026-08-06T12:00:00.000Z"),
        session("sooner", "pending_payment", "2026-08-04T10:00:00.000Z"),
      ],
      producerId: PRODUCER_ID,
      artistTimezone: "Asia/Jerusalem",
      now: NOW,
    });

    expect(actions.map((action) => action.id)).toEqual(["sooner", "later"]);
    expect(actions[0]?.href).toBe(
      `/artist/sessions/sooner?studio=${encodeURIComponent(PRODUCER_ID)}`,
    );
    expect(actions[1]?.href).toBe(
      `/artist/sessions/later?studio=${encodeURIComponent(PRODUCER_ID)}`,
    );
  });

  it("excludes terminal, ended, and other-studio rows", () => {
    const otherStudio = {
      ...session("other-studio", "confirmed", "2026-08-04T12:00:00.000Z"),
      producerId: "55555555-5555-4555-8555-555555555555",
    };
    const actions = artistHomeBookingStatusActions({
      sessions: [
        session("cancelled", "cancelled", "2026-08-04T12:00:00.000Z", "cancelled_on_time"),
        session("completed", "completed", "2026-08-04T12:00:00.000Z", "completed"),
        session("no-show", "no_show", "2026-08-04T12:00:00.000Z", "no_show"),
        session("ended", "confirmed", "2026-08-04T06:59:59.000Z"),
        otherStudio,
      ],
      producerId: PRODUCER_ID,
      artistTimezone: "Asia/Jerusalem",
      now: NOW,
    });

    expect(actions).toEqual([]);
  });

  it("keeps an ongoing Confirmed session until its end and excludes it at the end", () => {
    const confirmed = session("ongoing", "confirmed", "2026-08-04T08:00:00.000Z");

    expect(
      artistHomeBookingStatusActions({
        sessions: [confirmed],
        producerId: PRODUCER_ID,
        artistTimezone: "Asia/Jerusalem",
        now: new Date("2026-08-04T08:01:00.000Z"),
      }).map((action) => action.id),
    ).toEqual(["ongoing"]);
    expect(
      artistHomeBookingStatusActions({
        sessions: [confirmed],
        producerId: PRODUCER_ID,
        artistTimezone: "Asia/Jerusalem",
        now: new Date("2026-08-04T10:00:00.000Z"),
      }),
    ).toEqual([]);
  });

  it("never treats a Held session at or after its start as ongoing", () => {
    const held = session("held", "pending_approval", "2026-08-04T10:00:00.000Z");

    expect(
      artistHomeBookingStatusActions({
        sessions: [held],
        producerId: PRODUCER_ID,
        artistTimezone: "Asia/Jerusalem",
        now: new Date("2026-08-04T10:00:00.000Z"),
      }),
    ).toEqual([]);
  });

  it("keeps a later booking supporting while a due payment remains the main action", () => {
    const [futureBooking] = artistHomeBookingStatusActions({
      sessions: [session("future", "confirmed", "2026-08-05T12:00:00.000Z")],
      producerId: PRODUCER_ID,
      artistTimezone: "Asia/Jerusalem",
      now: NOW,
    });
    const payment: ArtistHomeAction = {
      id: "payment",
      kind: "payment_action",
      title: "Payment due",
      detail: "First payment",
      href: "/artist/payments/payment",
      actionLabel: "View payment",
      upcomingAt: new Date("2026-08-06T09:00:00.000Z"),
      occurredAt: NOW,
    };
    const main = selectArtistHomeMainAction([
      payment,
      ...(futureBooking?.mainEligible ? [futureBooking] : []),
    ]);

    expect(main?.id).toBe("payment");
    expect(withoutArtistHomeDuplicate(futureBooking ? [futureBooking] : [], main)).toEqual([
      futureBooking,
    ]);
  });
});
