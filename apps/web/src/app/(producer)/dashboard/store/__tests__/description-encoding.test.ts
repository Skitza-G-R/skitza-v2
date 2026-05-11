import { describe, expect, it } from "vitest";

import {
  decodeDescription,
  encodeDescription,
} from "../description-encoding";

describe("encodeDescription", () => {
  it("returns just the tagline when revisions + turnaround are empty", () => {
    expect(encodeDescription({ tagline: "Stems delivered", revisions: 0, turnaround: "" })).toBe("Stems delivered");
  });

  it("appends the meta block when revisions > 0 or turnaround set", () => {
    const out = encodeDescription({ tagline: "Stems delivered", revisions: 2, turnaround: "5 days" });
    expect(out).toContain("Stems delivered");
    expect(out).toContain("---");
    expect(out).toMatch(/revisions:\s*2/);
    expect(out).toMatch(/turnaround:\s*5 days/);
  });

  it("preserves multi-line tagline bodies", () => {
    const out = encodeDescription({ tagline: "Line one\nLine two", revisions: 1, turnaround: "1 week" });
    expect(out.split("\n")[0]).toBe("Line one");
    expect(out).toContain("Line two");
    expect(out).toContain("---");
  });
});

describe("decodeDescription", () => {
  it("returns tagline only when no meta block exists", () => {
    expect(decodeDescription("Stems delivered")).toEqual({
      tagline: "Stems delivered",
      revisions: 0,
      turnaround: "",
    });
  });

  it("parses the meta block back out", () => {
    const dec = decodeDescription("Stems delivered\n\n---\nrevisions: 2\nturnaround: 5 days");
    expect(dec.tagline).toBe("Stems delivered");
    expect(dec.revisions).toBe(2);
    expect(dec.turnaround).toBe("5 days");
  });

  it("survives a null description", () => {
    expect(decodeDescription(null)).toEqual({
      tagline: "",
      revisions: 0,
      turnaround: "",
    });
  });

  it("round-trips encode → decode losslessly", () => {
    const original = { tagline: "Mix + master included", revisions: 3, turnaround: "10 days" };
    expect(decodeDescription(encodeDescription(original))).toEqual(original);
  });
});
