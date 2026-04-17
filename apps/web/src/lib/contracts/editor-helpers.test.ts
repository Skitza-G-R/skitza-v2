import { describe, expect, it } from "vitest";

import {
  canSend,
  clampRect,
  colorFor,
  createFieldAt,
  DEFAULT_FIELD_SIZE,
} from "./editor-helpers";

describe("editor-helpers", () => {
  describe("clampRect", () => {
    it("leaves an in-bounds rect alone", () => {
      expect(clampRect({ x: 10, y: 20, w: 30, h: 5 })).toEqual({
        x: 10,
        y: 20,
        w: 30,
        h: 5,
      });
    });

    it("clamps a rect that overhangs the right edge", () => {
      const r = clampRect({ x: 90, y: 10, w: 30, h: 5 });
      expect(r.x + r.w).toBeLessThanOrEqual(100);
    });

    it("clamps a rect that overhangs the bottom edge", () => {
      const r = clampRect({ x: 10, y: 98, w: 5, h: 10 });
      expect(r.y + r.h).toBeLessThanOrEqual(100);
    });

    it("refuses sub-minimum sizes", () => {
      const r = clampRect({ x: 10, y: 10, w: 0, h: 0 });
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
    });
  });

  describe("createFieldAt", () => {
    it("uses the default size for the requested type", () => {
      const f = createFieldAt({
        type: "signature",
        page: 1,
        centerX: 50,
        centerY: 50,
      });
      expect(f.w).toBe(DEFAULT_FIELD_SIZE.signature.w);
      expect(f.h).toBe(DEFAULT_FIELD_SIZE.signature.h);
    });

    it("centers the rect on the given point", () => {
      const f = createFieldAt({
        type: "text",
        page: 2,
        centerX: 50,
        centerY: 40,
      });
      const size = DEFAULT_FIELD_SIZE.text;
      expect(f.x + size.w / 2).toBeCloseTo(50, 2);
      expect(f.y + size.h / 2).toBeCloseTo(40, 2);
      expect(f.page).toBe(2);
    });

    it("clamps fields dropped near the edges so they stay in-page", () => {
      const f = createFieldAt({
        type: "signature",
        page: 1,
        centerX: 98,
        centerY: 2,
      });
      expect(f.x + f.w).toBeLessThanOrEqual(100);
      expect(f.y).toBeGreaterThanOrEqual(0);
    });

    it("dropdowns get default choices; other types don't", () => {
      const dd = createFieldAt({
        type: "dropdown",
        page: 1,
        centerX: 50,
        centerY: 50,
      });
      expect(dd.options).not.toBeNull();
      const sig = createFieldAt({
        type: "signature",
        page: 1,
        centerX: 50,
        centerY: 50,
      });
      expect(sig.options).toBeNull();
    });
  });

  describe("colorFor", () => {
    it("returns the accent var for sender-prefilled fields", () => {
      expect(colorFor(null)).toBe("var(--brand-accent)");
    });

    it("is deterministic for a given recipient id", () => {
      const a = colorFor("11111111-1111-1111-1111-111111111111");
      const b = colorFor("11111111-1111-1111-1111-111111111111");
      expect(a).toBe(b);
    });

    it("maps different ids across the hue wheel", () => {
      // Collect a handful of colors; the palette has 8 hue buckets, so
      // a fair sample of ids should hit at least 2 distinct values.
      const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
      const unique = new Set(ids.map((id) => colorFor(id)));
      expect(unique.size).toBeGreaterThan(1);
    });
  });

  describe("canSend", () => {
    it("false when there are no recipients", () => {
      expect(canSend({ recipients: [], fields: [] })).toBe(false);
    });

    it("false when a recipient has no required field", () => {
      expect(
        canSend({
          recipients: [{ id: "r1" }, { id: "r2" }],
          fields: [{ recipientId: "r1", required: true }],
        }),
      ).toBe(false);
    });

    it("true when every recipient has at least one required field", () => {
      expect(
        canSend({
          recipients: [{ id: "r1" }, { id: "r2" }],
          fields: [
            { recipientId: "r1", required: true },
            { recipientId: "r2", required: true },
          ],
        }),
      ).toBe(true);
    });

    it("optional fields don't satisfy the requirement", () => {
      expect(
        canSend({
          recipients: [{ id: "r1" }],
          fields: [{ recipientId: "r1", required: false }],
        }),
      ).toBe(false);
    });
  });
});
