import { describe, it, expect } from "vitest";

import { computeParts } from "./use-multipart-upload";

describe("computeParts", () => {
  it("splits 50MB into 10 parts of 5MB", () => {
    const parts = computeParts(50 * 1024 * 1024, 5 * 1024 * 1024);
    expect(parts).toHaveLength(10);
    expect(parts[0]).toEqual({ partNumber: 1, start: 0, end: 5 * 1024 * 1024 });
  });

  it("last part handles remainder", () => {
    const parts = computeParts(12 * 1024 * 1024, 5 * 1024 * 1024);
    expect(parts).toHaveLength(3);
    const last = parts[2];
    expect(last).toBeDefined();
    if (!last) return;
    expect(last.end - last.start).toBe(2 * 1024 * 1024);
  });

  it("single-part when file smaller than part size", () => {
    const parts = computeParts(1024, 5 * 1024 * 1024);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ partNumber: 1, start: 0, end: 1024 });
  });

  it("exact multiple has no partial tail", () => {
    const parts = computeParts(15 * 1024 * 1024, 5 * 1024 * 1024);
    expect(parts).toHaveLength(3);
    const last = parts[2];
    expect(last).toBeDefined();
    if (!last) return;
    expect(last.end - last.start).toBe(5 * 1024 * 1024);
  });

  it("zero size throws", () => {
    expect(() => computeParts(0, 5 * 1024 * 1024)).toThrow(/positive/i);
  });
});
