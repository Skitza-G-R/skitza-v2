// Coord transforms between the editor/storage percent system (top-left
// origin, 0–100) and pdf-lib's point system (bottom-left origin, 72dpi).
//
// Storage keeps percents so that zooming the PDF viewer at edit time vs.
// sign time doesn't drift the field positions — the only thing that
// matters is the page's fractional layout, not its rendered pixel size.

export type PercentRect = { x: number; y: number; w: number; h: number };
export type PdfRect = { x: number; y: number; width: number; height: number };

export function percentToPdfLib(r: PercentRect, pageW: number, pageH: number): PdfRect {
  return {
    x: (r.x / 100) * pageW,
    y: pageH - ((r.y + r.h) / 100) * pageH,
    width: (r.w / 100) * pageW,
    height: (r.h / 100) * pageH,
  };
}

export function pdfLibToPercent(r: PdfRect, pageW: number, pageH: number): PercentRect {
  return {
    x: (r.x / pageW) * 100,
    y: ((pageH - r.y - r.height) / pageH) * 100,
    w: (r.width / pageW) * 100,
    h: (r.height / pageH) * 100,
  };
}
