import { describe, expect, it } from "vitest";

import {
  formatTimestamp,
  truncateBody,
  pickHeaderCta,
  selectVisibleEvents,
  formatFileSize,
  type ActivityEvent,
} from "../dashboard-helpers";

// Story 04 — Dashboard tab pure helpers.
//
// Per CLAUDE.md test conventions (vitest in node env, no jsdom, no
// React Testing Library), the load-bearing logic lives in pure helpers
// that we exercise here — the React layer above just wires these to
// the rendered output. Pin every branch.

describe("formatTimestamp — mm:ss formatter for comment anchors", () => {
  it("0 ms → 0:00", () => {
    expect(formatTimestamp(0)).toBe("0:00");
  });

  it("less than a second → 0:00 (round down)", () => {
    expect(formatTimestamp(750)).toBe("0:00");
  });

  it("125000 ms (2 min 5 s) → 2:05", () => {
    expect(formatTimestamp(125000)).toBe("2:05");
  });

  it("zero-pads single-digit seconds", () => {
    expect(formatTimestamp(63000)).toBe("1:03");
  });

  it("3 minutes flat → 3:00", () => {
    expect(formatTimestamp(180000)).toBe("3:00");
  });

  it("clamps negatives to 0:00 (defensive)", () => {
    expect(formatTimestamp(-5000)).toBe("0:00");
  });

  it("over an hour still uses mm:ss (no h:mm:ss for v1)", () => {
    // 1h2m5s = 3725s = 3725000ms → "62:05" (acceptable since
    // comments on hour-long stems are rare; the goal is to never show
    // a confusing 0-padded "01:02:05").
    expect(formatTimestamp(3725000)).toBe("62:05");
  });
});

describe("truncateBody — body preview for open-comments + activity", () => {
  it("returns input unchanged when shorter than max", () => {
    expect(truncateBody("hi", 80)).toBe("hi");
  });

  it("returns input unchanged when exactly at the limit", () => {
    const exactly = "a".repeat(80);
    expect(truncateBody(exactly, 80)).toBe(exactly);
  });

  it("truncates and appends an ellipsis when longer than max", () => {
    const long = "a".repeat(120);
    const out = truncateBody(long, 80);
    expect(out).toHaveLength(81); // 80 chars + the ellipsis
    expect(out.endsWith("…")).toBe(true);
  });

  it("default max is 80", () => {
    const long = "a".repeat(120);
    expect(truncateBody(long)).toBe(`${"a".repeat(80)}…`);
  });

  it("strips trailing whitespace before adding the ellipsis", () => {
    // "abc " sliced to 4 → "abc " then we add "…" → "abc…" with the
    // trailing space removed so it doesn't read as "abc <space><...>".
    const out = truncateBody("abc " + "x".repeat(80), 4);
    expect(out).toBe("abc…");
  });
});

describe("pickHeaderCta — morphing CTA per stage (PRD §11.5)", () => {
  // Maps the live DB stage enum to the 5 CTA categories from the
  // story. The procedure returns whatever projects.stage carries; the
  // mapping below collapses 7 visible stages → 5 CTA categories.

  it("lead → 'Approve & invoice deposit'", () => {
    const cta = pickHeaderCta("lead");
    expect(cta).toEqual({
      label: "Approve & invoice deposit",
      intent: "primary",
    });
  });

  it("booked → 'Send V1 for review' (trial bucket)", () => {
    expect(pickHeaderCta("booked")).toEqual({
      label: "Send V1 for review",
      intent: "primary",
    });
  });

  it("contract_sent → 'Send V1 for review' (trial bucket)", () => {
    expect(pickHeaderCta("contract_sent")?.label).toBe("Send V1 for review");
  });

  it("in_production → 'Send next version'", () => {
    expect(pickHeaderCta("in_production")).toEqual({
      label: "Send next version",
      intent: "primary",
    });
  });

  it("final_review → 'Mark final & invoice'", () => {
    expect(pickHeaderCta("final_review")).toEqual({
      label: "Mark final & invoice",
      intent: "primary",
    });
  });

  it("paid → 'Archive' (terminal CTA, secondary intent)", () => {
    expect(pickHeaderCta("paid")).toEqual({
      label: "Archive",
      intent: "secondary",
    });
  });

  it("archived → null (no CTA — already terminal)", () => {
    expect(pickHeaderCta("archived")).toBeNull();
  });

  it("cancelled → null (no CTA — terminal)", () => {
    expect(pickHeaderCta("cancelled")).toBeNull();
  });

  it("payment_paused → null (no CTA — wait for webhook)", () => {
    expect(pickHeaderCta("payment_paused")).toBeNull();
  });
});

describe("selectVisibleEvents — collapsed-history slice (5 by default)", () => {
  const mkEvent = (i: number): ActivityEvent => ({
    id: `e:${String(i)}`,
    kind: "comment_posted",
    occurredAt: new Date(2026, 3, 25, 12, 0, i),
    payload: {},
  });

  it("returns all events when expanded=true", () => {
    const events = Array.from({ length: 10 }, (_, i) => mkEvent(i));
    expect(selectVisibleEvents(events, true)).toHaveLength(10);
  });

  it("slices to first 5 when expanded=false and there are 10", () => {
    const events = Array.from({ length: 10 }, (_, i) => mkEvent(i));
    expect(selectVisibleEvents(events, false)).toHaveLength(5);
  });

  it("returns all events (under cap) when expanded=false and there are 3", () => {
    const events = Array.from({ length: 3 }, (_, i) => mkEvent(i));
    expect(selectVisibleEvents(events, false)).toHaveLength(3);
  });

  it("preserves order (server already DESC-sorted)", () => {
    const events = Array.from({ length: 10 }, (_, i) => mkEvent(i));
    const sliced = selectVisibleEvents(events, false);
    expect(sliced.map((e) => e.id)).toEqual([
      "e:0",
      "e:1",
      "e:2",
      "e:3",
      "e:4",
    ]);
  });
});

describe("formatFileSize — human-readable byte sizes for the meta sidebar", () => {
  it("0 bytes → '0 B'", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("under 1 KiB stays in bytes", () => {
    expect(formatFileSize(512)).toBe("512 B");
  });

  it("kilobytes round to nearest", () => {
    expect(formatFileSize(2048)).toBe("2 KB");
  });

  it("megabytes show one decimal", () => {
    // 5.25 MiB
    expect(formatFileSize(5_505_024)).toBe("5.3 MB");
  });

  it("gigabytes show one decimal", () => {
    // 1.5 GiB
    expect(formatFileSize(1_610_612_736)).toBe("1.5 GB");
  });
});
