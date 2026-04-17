import { describe, it, expect } from "vitest";
import { percentToPdfLib, pdfLibToPercent } from "./coords";

describe("coord transforms", () => {
  it("top-left percent → pdf-lib bottom-left points (US Letter 612×792)", () => {
    // A 10% × 5% rect anchored at (10%, 10%) top-left on an 8.5×11 inch page
    const pdf = percentToPdfLib({ x: 10, y: 10, w: 20, h: 5 }, 612, 792);
    // x: 10% of 612 = 61.2
    expect(pdf.x).toBeCloseTo(61.2, 2);
    // width: 20% of 612 = 122.4
    expect(pdf.width).toBeCloseTo(122.4, 2);
    // height: 5% of 792 = 39.6
    expect(pdf.height).toBeCloseTo(39.6, 2);
    // y in pdf-lib is the bottom-left corner.
    // In our coords, the box's TOP edge is 10% from top → y_top_points = 792 - (10/100*792) = 712.8
    // The bottom edge (= pdf-lib y) is 5% below that → 712.8 - 39.6 = 673.2
    expect(pdf.y).toBeCloseTo(673.2, 2);
  });

  it("round trips", () => {
    const pct = { x: 25, y: 50, w: 30, h: 8 };
    const pdf = percentToPdfLib(pct, 612, 792);
    const back = pdfLibToPercent(pdf, 612, 792);
    expect(back.x).toBeCloseTo(pct.x, 4);
    expect(back.y).toBeCloseTo(pct.y, 4);
    expect(back.w).toBeCloseTo(pct.w, 4);
    expect(back.h).toBeCloseTo(pct.h, 4);
  });

  it("zero-anchored box: top-left corner", () => {
    const pdf = percentToPdfLib({ x: 0, y: 0, w: 10, h: 10 }, 612, 792);
    expect(pdf.x).toBeCloseTo(0, 4);
    // top edge at y=792, box 10% tall = 79.2 → bottom edge = 712.8
    expect(pdf.y).toBeCloseTo(712.8, 2);
  });

  it("bottom-right corner", () => {
    const pdf = percentToPdfLib({ x: 90, y: 90, w: 10, h: 10 }, 612, 792);
    // box 10% wide at x=90 → x_points = 550.8
    expect(pdf.x).toBeCloseTo(550.8, 2);
    // top edge at 90%, so y from top = 712.8. Bottom edge = 712.8 - 79.2 = 633.6. Wait — (90+10)/100 * 792 = 792. So bottom edge at 0.
    expect(pdf.y).toBeCloseTo(0, 2);
  });

  it("handles non-US-Letter pages (A4: 595×842)", () => {
    const pdf = percentToPdfLib({ x: 50, y: 50, w: 10, h: 5 }, 595, 842);
    expect(pdf.x).toBeCloseTo(297.5, 2);
    expect(pdf.width).toBeCloseTo(59.5, 2);
    expect(pdf.height).toBeCloseTo(42.1, 2);
    // y_bottom = 842 - (55/100 * 842) = 378.9
    expect(pdf.y).toBeCloseTo(378.9, 2);
  });
});
