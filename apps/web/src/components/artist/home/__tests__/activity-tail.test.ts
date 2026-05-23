import { describe, expect, it } from "vitest";

import type { ActivityItem } from "~/server/trpc/routers/artist";

import {
  type ActivityDisplayRow,
  getActivityRows,
} from "../activity-tail";

// Round 2 of the artist-home polish pass.
//
// Page 03 / ACTIVITY · Recent shows the last few cross-studio events
// (track uploads, session confirmations, payments) so the page has
// a clear bottom edge and the inbox model has the dense list it
// needs to feel real. We cap at 5 rows here even though the router
// returns up to 10 — the artist home is a digest, not the activity
// feed itself. A dedicated /artist/activity page can show all 10+
// later.
//
// `getActivityRows` is the pure helper: takes the raw `activity`
// array from `artist.home`, returns either the (capped) rows or a
// single empty-row when there's no history yet.

const makeItem = (overrides: Partial<ActivityItem> = {}): ActivityItem => ({
  kind: "track_uploaded",
  message: "Mor uploaded V2 of Summer Song",
  occurredAt: new Date("2026-05-20T10:00:00Z"),
  producerName: "Mor Studio",
  deepLink: "/artist/music/proj1",
  ...overrides,
});

describe("getActivityRows", () => {
  it("synthesizes an empty-row when input has no events", () => {
    const result: ActivityDisplayRow[] = getActivityRows([]);
    expect(result).toEqual([{ kind: "empty" }]);
  });

  it("passes through events when there are 1-5 of them", () => {
    const items = [
      makeItem({ message: "A" }),
      makeItem({ message: "B" }),
      makeItem({ message: "C" }),
    ];
    const result = getActivityRows(items);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ kind: "event", item: items[0] });
    expect(result[2]).toEqual({ kind: "event", item: items[2] });
  });

  it("caps at 5 rows even when more are supplied", () => {
    const items = Array.from({ length: 9 }, (_, i) =>
      makeItem({ message: `m${String(i)}` }),
    );
    const result = getActivityRows(items);
    expect(result).toHaveLength(5);
    // First 5 should be preserved in order
    expect(result.map((r) => r.kind === "event" && r.item.message)).toEqual([
      "m0",
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
  });
});
