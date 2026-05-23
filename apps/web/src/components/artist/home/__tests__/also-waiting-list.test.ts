import { describe, expect, it } from "vitest";

import {
  type DisplayRow,
  getWaitingRows,
  type WaitingRow,
} from "../also-waiting-list";

// Round 1 of the artist-home polish pass (audit dated 2026-05-23):
//
// AlsoWaitingList used to `return null` when `rows.length === 0`,
// which produced a visible void on the page — the screenshot showed
// 60-80px of beige between the focal card and the next section. The
// new contract: the section is ALWAYS rendered. When there are zero
// real waiting items we synthesize a single `{ kind: "empty" }` row
// that the UI maps to a calm "Inbox zero · nothing else waiting"
// line. This keeps page rhythm intact regardless of data density.
//
// `getWaitingRows` is the pure helper that owns that decision so we
// can test it without rendering (vitest in node env — no jsdom).

describe("getWaitingRows", () => {
  it("passes through input rows when at least one exists", () => {
    const paymentRow: WaitingRow = {
      kind: "payment",
      bookingId: "b1",
      amountFormatted: "₪10,000",
      packageName: "Vocal tracking",
      producerName: "Mor Studio",
    };
    const result: DisplayRow[] = getWaitingRows([paymentRow]);
    expect(result).toEqual([paymentRow]);
  });

  it("synthesizes a single empty-row when no real rows exist", () => {
    expect(getWaitingRows([])).toEqual([{ kind: "empty" }]);
  });

  it("keeps the order of the supplied rows", () => {
    const paymentRow: WaitingRow = {
      kind: "payment",
      bookingId: "b1",
      amountFormatted: "₪10,000",
      packageName: "Vocal tracking",
      producerName: "Mor Studio",
    };
    const sessionRow: WaitingRow = {
      kind: "session",
      sessionId: "s1",
      startsAt: new Date("2026-05-30T14:00:00Z"),
      durationMin: 180,
      productName: "Mix session",
      producerName: "Mor Studio",
    };
    const result = getWaitingRows([paymentRow, sessionRow]);
    expect(result).toEqual([paymentRow, sessionRow]);
  });
});
