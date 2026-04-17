// Unit tests for the drawing step only. We don't hit R2 / DB here;
// flatten.ts#drawFieldsOntoPdf is a pure transform over bytes.
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";

import { drawFieldsOntoPdf } from "./flatten";

async function makeBlankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return await doc.save();
}

// A tiny 1×1 transparent PNG, data-URL encoded — exercises the image
// embed path without needing an image fixture on disk.
const TINY_PNG_DATAURL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("drawFieldsOntoPdf", () => {
  it("returns a non-empty PDF larger than input (content added)", async () => {
    const input = await makeBlankPdf();
    const out = await drawFieldsOntoPdf(input, [
      { page: 1, x: 10, y: 10, w: 30, h: 5, type: "text", signedValue: "Hello", prefilledValue: null },
    ]);
    expect(out.byteLength).toBeGreaterThan(input.byteLength);
  });

  it("skips fields with no value", async () => {
    const input = await makeBlankPdf();
    const out = await drawFieldsOntoPdf(input, [
      { page: 1, x: 10, y: 10, w: 30, h: 5, type: "text", signedValue: null, prefilledValue: null },
    ]);
    // Still a valid PDF; no crash even with a no-op.
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it("handles signature images", async () => {
    const input = await makeBlankPdf();
    const out = await drawFieldsOntoPdf(input, [
      { page: 1, x: 20, y: 50, w: 30, h: 10, type: "signature", signedValue: TINY_PNG_DATAURL, prefilledValue: null },
    ]);
    expect(out.byteLength).toBeGreaterThan(input.byteLength);
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it("draws on the correct 1-indexed page", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.addPage([612, 792]);
    const input = await doc.save();
    const out = await drawFieldsOntoPdf(input, [
      { page: 2, x: 10, y: 10, w: 30, h: 5, type: "text", signedValue: "Page2", prefilledValue: null },
    ]);
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(2);
  });

  it("silently ignores out-of-range page number", async () => {
    const input = await makeBlankPdf();
    const out = await drawFieldsOntoPdf(input, [
      { page: 99, x: 10, y: 10, w: 30, h: 5, type: "text", signedValue: "x", prefilledValue: null },
    ]);
    // Must not throw; keep the original untouched.
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(1);
  });
});
