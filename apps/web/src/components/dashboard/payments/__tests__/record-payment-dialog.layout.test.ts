import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// SK-296 — the "Record a payment" sheet drifted sideways on a phone: the whole
// form could be dragged off the left edge. jsdom has no layout engine, so the
// guards that keep the sheet off the horizontal axis are asserted on the
// source, in the source-grep style of upload-track-modal.test.tsx.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "record-payment-dialog.tsx"), "utf-8");

describe("RecordPaymentDialog — horizontal axis", () => {
  it("never lets the sheet be panned sideways", () => {
    // `overflow-y: auto` on its own computes the other axis to `auto` too, so
    // the sheet was a horizontal scroll container by accident.
    expect(SRC).toMatch(/DialogPrimitive\.Content[\s\S]*?className="[^"]*overflow-x-hidden/);
  });

  it("lets the amount and date columns shrink to the sheet", () => {
    // Grid items keep `min-width: auto`, and a track can never shrink below an
    // item's min-content contribution — so a natively sized control (iOS gives
    // input[type="date"] its own intrinsic width) pushed the row past the sheet
    // and unlocked the pan.
    expect(SRC).toMatch(
      /className="grid gap-4 sm:grid-cols-\[minmax\(0,1\.2fr\)_minmax\(0,1fr\)\]">\s*<div className="min-w-0">/,
    );
    expect(SRC).toMatch(/htmlFor=\{`\$\{baseId\}-date`\}[\s\S]*?className="[^"]*\bmin-w-0\b/);
  });
});
