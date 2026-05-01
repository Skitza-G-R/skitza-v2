import { describe, expect, it } from "vitest";

import { fmtTime, progressFromSec, secFromProgress } from "../song-time";

describe("fmtTime", () => {
  it("formats 0 seconds as '0:00'", () => {
    expect(fmtTime(0)).toBe("0:00");
  });
  it("pads single-digit seconds with leading zero", () => {
    expect(fmtTime(5)).toBe("0:05");
  });
  it("formats whole minutes", () => {
    expect(fmtTime(60)).toBe("1:00");
  });
  it("formats minutes:seconds", () => {
    expect(fmtTime(65)).toBe("1:05");
    expect(fmtTime(125)).toBe("2:05");
  });
  it("rounds down to nearest second (does not show fractional)", () => {
    expect(fmtTime(65.7)).toBe("1:05");
  });
  it("clamps negative input to 0:00", () => {
    expect(fmtTime(-5)).toBe("0:00");
  });
  it("handles 10+ minute tracks", () => {
    expect(fmtTime(630)).toBe("10:30");
  });
});

describe("progressFromSec", () => {
  it("returns 0 for sec=0", () => {
    expect(progressFromSec(0, 240)).toBe(0);
  });
  it("returns 0.5 for halfway through", () => {
    expect(progressFromSec(120, 240)).toBe(0.5);
  });
  it("clamps to 1 when sec > durationSec", () => {
    expect(progressFromSec(300, 240)).toBe(1);
  });
  it("clamps to 0 when sec is negative", () => {
    expect(progressFromSec(-10, 240)).toBe(0);
  });
  it("returns 0 if durationSec is 0 (avoids divide-by-zero)", () => {
    expect(progressFromSec(50, 0)).toBe(0);
  });
});

describe("secFromProgress", () => {
  it("returns 0 for progress 0", () => {
    expect(secFromProgress(0, 240)).toBe(0);
  });
  it("returns full duration for progress 1", () => {
    expect(secFromProgress(1, 240)).toBe(240);
  });
  it("returns scaled value for partial progress", () => {
    expect(secFromProgress(0.25, 240)).toBe(60);
  });
});
