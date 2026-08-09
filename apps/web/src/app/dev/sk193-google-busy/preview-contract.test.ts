import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const producerPreviewSource = readFileSync(
  new URL("../sk192-google-calendar/google-calendar-preview.tsx", import.meta.url),
  "utf8",
);

describe("SK-193 Google busy-time visual preview", () => {
  it("is development-only and uses the current producer shell", () => {
    expect(pageSource).toContain("if (!isDevGalleryAvailable()) notFound();");
    expect(pageSource).toContain("googleBusyProtectionReduced");
    expect(producerPreviewSource).toContain("ProducerBottomNav");
    expect(producerPreviewSource).toContain("NAV_ITEMS.map");
  });
});
