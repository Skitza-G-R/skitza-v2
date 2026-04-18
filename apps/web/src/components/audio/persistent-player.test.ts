import { describe, expect, it } from "vitest";

import { fmtTime } from "./persistent-player";

// fmtTime renders the "1:23 / 4:56" ticker in the persistent player
// and next to every comment timestamp in the library side panel.
// These cases pin the edges that show up in practice: malformed
// inputs (NaN, negative), sub-second, sub-minute, and multi-minute.
describe("persistent-player fmtTime", () => {
  it("renders 0:00 for non-finite input", () => {
    expect(fmtTime(Number.NaN)).toBe("0:00");
    expect(fmtTime(Number.POSITIVE_INFINITY)).toBe("0:00");
  });

  it("clamps negative values to 0:00", () => {
    expect(fmtTime(-100)).toBe("0:00");
  });

  it("renders seconds with zero-padding", () => {
    expect(fmtTime(5_000)).toBe("0:05");
    expect(fmtTime(45_000)).toBe("0:45");
  });

  it("renders minutes:seconds", () => {
    expect(fmtTime(65_000)).toBe("1:05");
    expect(fmtTime(83_000)).toBe("1:23");
  });

  it("renders multi-minute tracks", () => {
    expect(fmtTime(10 * 60 * 1000 + 7 * 1000)).toBe("10:07");
  });
});
