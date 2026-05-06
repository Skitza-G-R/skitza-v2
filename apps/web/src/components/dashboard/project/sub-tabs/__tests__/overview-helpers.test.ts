import { describe, expect, it } from "vitest";

import {
  buildOverviewTimeline,
  computeLastActivity,
  OVERVIEW_TIMELINE_MAX,
} from "../overview-helpers";

// Pure unit tests for the Project Room → Overview tab data shaping.
// The component itself is React + uses client hooks; testing the
// helpers separately keeps the assertions deterministic and avoids
// the JSDOM dance.

const D1 = new Date("2026-01-01T10:00:00Z"); // earliest
const D2 = new Date("2026-01-02T10:00:00Z");
const D3 = new Date("2026-01-03T10:00:00Z");
const D4 = new Date("2026-01-04T10:00:00Z");
const D5 = new Date("2026-01-05T10:00:00Z");
const D6 = new Date("2026-01-06T10:00:00Z");
const D7 = new Date("2026-01-07T10:00:00Z");
const D8 = new Date("2026-01-08T10:00:00Z");
const D9 = new Date("2026-01-09T10:00:00Z"); // latest

describe("buildOverviewTimeline", () => {
  it("returns just a 'created' event when nothing else exists", () => {
    const events = buildOverviewTimeline({
      createdAt: D1,
      finalPaid: false,
      paidAt: null,
      session: null,
      tracks: [],
      versions: [],
      comments: [],
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("created");
    expect(events[0]?.at).toEqual(D1);
  });

  it("orders events newest-first", () => {
    const events = buildOverviewTimeline({
      createdAt: D1,
      finalPaid: false,
      paidAt: null,
      session: null,
      tracks: [{ createdAt: D2, title: "A" }],
      versions: [{ uploadedAt: D3, trackId: "t1", label: "v1" }],
      comments: [
        { createdAt: D4, authorName: "Maya", fromProducer: false, body: "hi" },
      ],
    });
    // Expected order: comment (D4), version (D3), track (D2), created (D1)
    expect(events.map((e) => e.kind)).toEqual([
      "comment",
      "version",
      "track",
      "created",
    ]);
  });

  it("includes a session event when one is linked", () => {
    const events = buildOverviewTimeline({
      createdAt: D1,
      finalPaid: false,
      paidAt: null,
      session: { startsAt: D2, status: "confirmed" },
      tracks: [],
      versions: [],
      comments: [],
    });
    const sessionEvent = events.find((e) => e.kind === "session");
    expect(sessionEvent).toBeDefined();
    if (sessionEvent?.kind === "session") {
      expect(sessionEvent.status).toBe("confirmed");
      expect(sessionEvent.at).toEqual(D2);
    }
  });

  it("uses the real paidAt timestamp when provided (not the latest-activity surrogate)", () => {
    // paidAt is D7, but the latest non-paid activity is a version
    // uploaded at D5. The "Paid" event must render at D7 — the actual
    // moment the producer marked it paid — not at D5.
    const paidAt = new Date("2026-01-15T10:00:00Z");
    const events = buildOverviewTimeline({
      createdAt: D1,
      finalPaid: true,
      paidAt,
      session: null,
      tracks: [],
      versions: [{ uploadedAt: D5, trackId: "t1", label: "v1" }],
      comments: [],
    });
    const paid = events.find((e) => e.kind === "paid");
    expect(paid).toBeDefined();
    expect(paid?.at).toEqual(paidAt);
  });

  it("falls back to the latest-activity surrogate when finalPaid is true but paidAt is null", () => {
    // Legacy row: finalPaid=true, paidAt=null (unbackfilled). Use
    // the latest-activity proxy so the event still renders somewhere
    // sensible on the timeline.
    const events = buildOverviewTimeline({
      createdAt: D1,
      finalPaid: true,
      paidAt: null,
      session: null,
      tracks: [],
      versions: [{ uploadedAt: D5, trackId: "t1", label: "v1" }],
      comments: [],
    });
    const paid = events.find((e) => e.kind === "paid");
    expect(paid).toBeDefined();
    expect(paid?.at).toEqual(D5);
  });

  it("does not include a 'paid' event when finalPaid is false and paidAt is null", () => {
    const events = buildOverviewTimeline({
      createdAt: D1,
      finalPaid: false,
      paidAt: null,
      session: null,
      tracks: [],
      versions: [{ uploadedAt: D2, trackId: "t1", label: "v1" }],
      comments: [],
    });
    expect(events.find((e) => e.kind === "paid")).toBeUndefined();
  });

  it("caps the result at OVERVIEW_TIMELINE_MAX events", () => {
    // Build 10 versions across distinct timestamps. Plus the implicit
    // "created" event makes 11 total candidates — output should still
    // cap at OVERVIEW_TIMELINE_MAX (6).
    const versions = [D1, D2, D3, D4, D5, D6, D7, D8, D9, D9].map((d, i) => ({
      uploadedAt: d,
      trackId: "t1",
      label: `v${String(i)}`,
    }));
    const events = buildOverviewTimeline({
      createdAt: D1,
      finalPaid: false,
      paidAt: null,
      session: null,
      tracks: [],
      versions,
      comments: [],
    });
    expect(events).toHaveLength(OVERVIEW_TIMELINE_MAX);
    // First event should be one of the latest (D9).
    expect(events[0]?.at).toEqual(D9);
  });

  it("preserves comment metadata (authorName, fromProducer, body)", () => {
    const events = buildOverviewTimeline({
      createdAt: D1,
      finalPaid: false,
      paidAt: null,
      session: null,
      tracks: [],
      versions: [],
      comments: [
        {
          createdAt: D2,
          authorName: "Lena",
          fromProducer: true,
          body: "Sounds great",
        },
      ],
    });
    const c = events.find((e) => e.kind === "comment");
    expect(c).toBeDefined();
    if (c?.kind === "comment") {
      expect(c.authorName).toBe("Lena");
      expect(c.fromProducer).toBe(true);
      expect(c.body).toBe("Sounds great");
    }
  });
});

describe("computeLastActivity", () => {
  it("returns project.updatedAt when there are no versions or comments", () => {
    expect(computeLastActivity(D5, [], [])).toEqual(D5);
  });

  it("returns the most recent version upload when newer than updatedAt", () => {
    expect(
      computeLastActivity(
        D2,
        [{ uploadedAt: D5 }, { uploadedAt: D3 }],
        [],
      ),
    ).toEqual(D5);
  });

  it("returns the most recent comment when newer than versions + updatedAt", () => {
    expect(
      computeLastActivity(
        D2,
        [{ uploadedAt: D3 }],
        [{ createdAt: D7 }, { createdAt: D5 }],
      ),
    ).toEqual(D7);
  });

  it("preserves updatedAt when it is the most recent of all sources", () => {
    expect(
      computeLastActivity(
        D9,
        [{ uploadedAt: D5 }],
        [{ createdAt: D3 }],
      ),
    ).toEqual(D9);
  });
});
