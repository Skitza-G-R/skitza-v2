import { describe, expect, it } from "vitest";

import {
  isOpenPrivateOfferStatus,
  partitionProducerPrivateOffers,
  privateOfferExpiryUrgency,
  type PrivateOfferListEntry,
} from "../private-offer-list-model";

function entry(
  status: PrivateOfferListEntry["status"],
  expiresAt: string,
  createdAt: string,
  id: string,
): PrivateOfferListEntry & { id: string } {
  return { id, status, expiresAt: new Date(expiresAt), createdAt: new Date(createdAt) };
}

const NOW = new Date("2026-08-30T12:00:00.000Z");

describe("partitionProducerPrivateOffers", () => {
  it("keeps only drafts and waiting offers in the queue, soonest expiry first", () => {
    const { open, history } = partitionProducerPrivateOffers([
      entry("sent", "2026-09-20T00:00:00Z", "2026-08-01T00:00:00Z", "late"),
      entry("accepted", "2026-09-01T00:00:00Z", "2026-08-20T00:00:00Z", "won"),
      entry("sent", "2026-09-02T00:00:00Z", "2026-08-10T00:00:00Z", "urgent"),
      entry("draft", "2026-09-10T00:00:00Z", "2026-08-05T00:00:00Z", "draft"),
      entry("expired", "2026-08-01T00:00:00Z", "2026-07-01T00:00:00Z", "old"),
    ]);

    expect(open.map((offer) => offer.id)).toEqual(["urgent", "draft", "late"]);
    expect(history.map((offer) => offer.id)).toEqual(["won", "old"]);
  });

  it("breaks identical expiries by newest created and sorts history newest first", () => {
    const { open, history } = partitionProducerPrivateOffers([
      entry("sent", "2026-09-02T00:00:00Z", "2026-08-01T00:00:00Z", "older-send"),
      entry("sent", "2026-09-02T00:00:00Z", "2026-08-15T00:00:00Z", "newer-send"),
      entry("declined", "2026-09-01T00:00:00Z", "2026-08-02T00:00:00Z", "old-no"),
      entry("canceled", "2026-09-01T00:00:00Z", "2026-08-12T00:00:00Z", "new-stop"),
    ]);

    expect(open.map((offer) => offer.id)).toEqual(["newer-send", "older-send"]);
    expect(history.map((offer) => offer.id)).toEqual(["new-stop", "old-no"]);
  });

  it("classifies every terminal status as history", () => {
    for (const status of ["accepted", "declined", "expired", "canceled"] as const) {
      expect(isOpenPrivateOfferStatus(status)).toBe(false);
    }
    expect(isOpenPrivateOfferStatus("draft")).toBe(true);
    expect(isOpenPrivateOfferStatus("sent")).toBe(true);
  });
});

describe("privateOfferExpiryUrgency", () => {
  it("flags the last day as danger", () => {
    expect(privateOfferExpiryUrgency(new Date("2026-08-31T06:00:00Z"), NOW)).toEqual({
      kind: "days-left",
      days: 1,
      tone: "danger",
    });
  });

  it("warns inside the three-day chase window", () => {
    expect(privateOfferExpiryUrgency(new Date("2026-09-02T06:00:00Z"), NOW)).toEqual({
      kind: "days-left",
      days: 3,
      tone: "warning",
    });
  });

  it("falls back to the plain date outside the window and marks past instants expired", () => {
    expect(privateOfferExpiryUrgency(new Date("2026-09-10T00:00:00Z"), NOW)).toEqual({
      kind: "date",
    });
    expect(privateOfferExpiryUrgency(new Date("2026-08-30T11:59:59Z"), NOW)).toEqual({
      kind: "expired",
    });
  });
});
