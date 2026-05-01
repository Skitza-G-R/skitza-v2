import { describe, expect, it } from "vitest";

import {
  firstNameOf,
  fmtDuration,
  gradFor,
  humanStage,
  initialsOf,
  progressForStage,
  relTime,
  splitPublicLink,
  tagForStage,
} from "../data-mapping";

// Pure-function tests for the design-test data-mapping helpers. These
// helpers shape real Skitza data (Clerk profile, project_stage enum,
// recentUpload rows) into the structure the mockup's OverviewTab/Sidebar
// expect to consume. Bugs in this layer would silently misrepresent
// real data inside a perfectly-styled UI — exactly the kind of failure
// the user warned about ("misunderstood the /join link flow 3 times").

describe("tagForStage — project stage → mockup pill", () => {
  it("maps payment_paused to a danger pill", () => {
    expect(tagForStage("payment_paused")).toEqual({
      label: "PAYMENT PAUSED",
      type: "danger",
    });
  });

  it("maps cancelled to a danger pill", () => {
    expect(tagForStage("cancelled")).toEqual({
      label: "CANCELLED",
      type: "danger",
    });
  });

  it("maps final_review to a warning pill (the producer needs to act)", () => {
    expect(tagForStage("final_review")).toEqual({
      label: "ACTION NEEDED",
      type: "warning",
    });
  });

  it("maps contract_sent to a warning pill (waiting on artist signature)", () => {
    expect(tagForStage("contract_sent")).toEqual({
      label: "AWAITING SIGN",
      type: "warning",
    });
  });

  it("maps in_production to a neutral pill", () => {
    expect(tagForStage("in_production")).toEqual({
      label: "IN PROGRESS",
      type: "neutral",
    });
  });

  it("maps booked to a brand pill", () => {
    expect(tagForStage("booked")).toEqual({
      label: "BOOKED",
      type: "brand",
    });
  });

  it("maps lead to a neutral pill", () => {
    expect(tagForStage("lead")).toEqual({ label: "LEAD", type: "neutral" });
  });

  it("maps paid + archived to success pills", () => {
    expect(tagForStage("paid")).toEqual({ label: "PAID", type: "success" });
    expect(tagForStage("archived")).toEqual({
      label: "COMPLETE",
      type: "success",
    });
  });

  it("falls back to neutral with uppercased label for unknown stages", () => {
    expect(tagForStage("frobnicated")).toEqual({
      label: "FROBNICATED",
      type: "neutral",
    });
  });
});

describe("humanStage — DB enum → human label", () => {
  it("title-cases snake_case", () => {
    expect(humanStage("in_production")).toBe("In Production");
    expect(humanStage("payment_paused")).toBe("Payment Paused");
  });

  it("leaves single-word stages alone", () => {
    expect(humanStage("paid")).toBe("Paid");
  });
});

describe("progressForStage — stage → 0-100 % bar", () => {
  it("returns monotonic-ish progress through the funnel", () => {
    const lead = progressForStage("lead");
    const inProd = progressForStage("in_production");
    const review = progressForStage("final_review");
    const paid = progressForStage("paid");
    expect(lead).toBeLessThan(inProd);
    expect(inProd).toBeLessThan(review);
    expect(review).toBeLessThan(paid);
    expect(paid).toBe(100);
  });

  it("returns a sensible default for unknown stages (not 0, not 100)", () => {
    const v = progressForStage("frobnicated");
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(100);
  });
});

describe("gradFor — round-robin grad palette", () => {
  it("returns a stable grad class for index 0", () => {
    expect(gradFor(0)).toMatch(/^grad-/);
  });

  it("wraps around the palette length", () => {
    const a = gradFor(0);
    const b = gradFor(7);
    // The palette is 7 items long, so index 7 should wrap to index 0.
    expect(b).toBe(a);
  });

  it("returns distinct grads for the first 3 indices (so an Urgent card has 3 colors)", () => {
    const set = new Set([gradFor(0), gradFor(1), gradFor(2)]);
    expect(set.size).toBe(3);
  });
});

describe("firstNameOf — Clerk displayName → greeting first name", () => {
  it("returns just the first token of a multi-word name", () => {
    expect(firstNameOf("Gili Asraf")).toBe("Gili");
    expect(firstNameOf("Maya Ben Zvi")).toBe("Maya");
  });

  it("handles single-word display names", () => {
    expect(firstNameOf("Skitza")).toBe("Skitza");
  });

  it("falls back to 'there' for null / empty / whitespace-only", () => {
    expect(firstNameOf(null)).toBe("there");
    expect(firstNameOf("")).toBe("there");
    expect(firstNameOf("   ")).toBe("there");
  });
});

describe("initialsOf — Clerk displayName → 2-char avatar initials", () => {
  it("takes first chars of first + last word", () => {
    expect(initialsOf("Gili Asraf")).toBe("GA");
    expect(initialsOf("Maya Ben Zvi")).toBe("MB");
  });

  it("doubles up the first 2 chars of a single-word name", () => {
    expect(initialsOf("Skitza")).toBe("SK");
  });

  it("falls back to GS for null / empty / whitespace-only", () => {
    expect(initialsOf(null)).toBe("GS");
    expect(initialsOf("")).toBe("GS");
    expect(initialsOf("   ")).toBe("GS");
  });

  it("uppercases multibyte cleanly", () => {
    // Hebrew display name — initialsOf should still produce a 2-char
    // string. Hebrew has no upper/lowercase distinction so .toUpperCase()
    // is a no-op, but the slicing should still hold.
    expect(initialsOf("נוצר אסרף")).toHaveLength(2);
  });
});

describe("splitPublicLink — full URL → mockup two-tone display", () => {
  it("strips the protocol and splits at the last slash", () => {
    expect(splitPublicLink("https://skitza.app/p/gili")).toEqual({
      prefix: "skitza.app/p/",
      slug: "gili",
    });
  });

  it("handles http:// too", () => {
    expect(splitPublicLink("http://skitza.app/p/gili")).toEqual({
      prefix: "skitza.app/p/",
      slug: "gili",
    });
  });

  it("trims a trailing slash", () => {
    expect(splitPublicLink("https://skitza.app/p/gili/")).toEqual({
      prefix: "skitza.app/p/",
      slug: "gili",
    });
  });

  it("returns the whole string as slug when there's no slash", () => {
    expect(splitPublicLink("gili")).toEqual({ prefix: "", slug: "gili" });
  });
});

describe("relTime — past Date → human-friendly label", () => {
  it("returns 'Just now' for sub-minute deltas", () => {
    expect(relTime(new Date(Date.now() - 30_000))).toBe("Just now");
  });

  it("returns Xm ago for minute-scale deltas", () => {
    expect(relTime(new Date(Date.now() - 5 * 60_000))).toBe("5m ago");
  });

  it("returns Xh ago for hour-scale deltas (under 24h)", () => {
    expect(relTime(new Date(Date.now() - 3 * 3_600_000))).toBe("3h ago");
  });

  it("returns 'Yesterday' for ~24h deltas", () => {
    // Pin to 25h to avoid clock-edge flakiness around the 24h boundary.
    expect(relTime(new Date(Date.now() - 25 * 3_600_000))).toBe("Yesterday");
  });

  it("returns Xd ago for week-scale deltas", () => {
    expect(relTime(new Date(Date.now() - 4 * 86_400_000))).toBe("4d ago");
  });

  it("returns Xw ago beyond a week", () => {
    expect(relTime(new Date(Date.now() - 14 * 86_400_000))).toBe("2w ago");
  });

  it("returns Xmo ago beyond a month", () => {
    expect(relTime(new Date(Date.now() - 65 * 86_400_000))).toBe("2mo ago");
  });
});

describe("fmtDuration — ms → MM:SS for the duration column", () => {
  it("zero-pads minutes and seconds to 2 digits", () => {
    expect(fmtDuration(7_000)).toBe("00:07");
    expect(fmtDuration(65_000)).toBe("01:05");
    expect(fmtDuration(222_000)).toBe("03:42");
  });

  it("returns '--:--' for null or non-positive values", () => {
    expect(fmtDuration(null)).toBe("--:--");
    expect(fmtDuration(0)).toBe("--:--");
    expect(fmtDuration(-100)).toBe("--:--");
  });
});
