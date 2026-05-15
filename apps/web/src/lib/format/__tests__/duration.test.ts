import { describe, it, expect } from "vitest";

import { formatDuration } from "../duration";

describe("formatDuration", () => {
  it("formats milliseconds as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(60_000)).toBe("1:00");
    expect(formatDuration(225_000)).toBe("3:45");
    expect(formatDuration(599_000)).toBe("9:59");
  });

  it("returns '—' for null or NaN", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });

  it("pads seconds with leading zero", () => {
    expect(formatDuration(61_000)).toBe("1:01");
    expect(formatDuration(2_000)).toBe("0:02");
  });

  it("returns '—' for non-finite or negative input", () => {
    // The helper is defensive — Infinity and negatives both signal
    // "garbage in" (a decode never finished, an external API returned
    // junk) and we prefer the placeholder to a bogus 0:00.
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
  });
});
