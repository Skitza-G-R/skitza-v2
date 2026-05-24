import { describe, expect, it } from "vitest";

import type { FocalItem } from "~/components/artist/home/focal-card";

import { buildSubline } from "../build-subline";

// Round 4: the hero subline is no longer a static one-liner per focal
// kind. It now carries producer attribution + concrete data inline
// (amount, day, studio count) so the artist gets a snapshot of their
// studio life in a single sentence — before they even scan the focal
// card.

const mix: FocalItem = {
  kind: "mix",
  mix: {
    id: "tv1",
    trackTitle: "moonrise",
    label: "v2",
    producerName: "Mor Studio",
    projectId: "proj1",
    audioUrl: "https://r2/x.mp3",
    durationMs: 198_000,
  },
};

const payment: FocalItem = {
  kind: "payment",
  payment: {
    bookingId: "b1",
    producerName: "Mor Studio",
    packageName: "Vocal tracking",
    amountFormatted: "₪10,000",
  },
};

const session: FocalItem = {
  kind: "session",
  session: {
    id: "s1",
    startsAt: new Date("2026-05-30T14:00:00Z"),
    durationMin: 180,
    producerName: "Mor Studio",
    productName: "Mix session",
  },
};

const quiet: FocalItem = { kind: "quiet" };

describe("buildSubline", () => {
  it("attributes the producer when focal is a mix", () => {
    expect(buildSubline({ focal: mix, studioCount: 3 })).toBe(
      "Your new mix from Mor Studio is ready.",
    );
  });

  it("includes amount + producer when focal is a payment", () => {
    expect(buildSubline({ focal: payment, studioCount: 3 })).toBe(
      "₪10,000 due to Mor Studio.",
    );
  });

  it("attributes the producer when focal is a session", () => {
    expect(buildSubline({ focal: session, studioCount: 3 })).toBe(
      "Session with Mor Studio this week.",
    );
  });

  it("uses plural 'studios' when quiet and studioCount > 1", () => {
    expect(buildSubline({ focal: quiet, studioCount: 3 })).toBe(
      "All quiet · 3 studios on tap.",
    );
  });

  it("uses singular 'studio' when quiet and studioCount === 1", () => {
    expect(buildSubline({ focal: quiet, studioCount: 1 })).toBe(
      "All quiet · 1 studio on tap.",
    );
  });

  it("falls back when quiet and no studios connected yet", () => {
    expect(buildSubline({ focal: quiet, studioCount: 0 })).toBe(
      "All quiet · no studios connected yet.",
    );
  });
});
