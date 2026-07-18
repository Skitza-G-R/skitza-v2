import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/app/(producer)/dashboard/store/artist-product-preview.tsx"),
  "utf8",
);

describe("ArtistProductPreview", () => {
  it("reuses the real signed-in artist Store card and detail screen", () => {
    expect(source).toMatch(/<FocalProductCard/);
    expect(source).toMatch(/<QuietProductList/);
    expect(source).toMatch(/placement === "focal"/);
    expect(source).toMatch(/<ProductDetailScreen/);
    expect(source).toMatch(/previewMode=\{true\}/);
    expect(source).toMatch(/onPreviewDetails/);
    expect(source).toMatch(/onPreviewBack/);
  });

  it("mounts the nested detail preview as an accessible dialog", () => {
    expect(source).toMatch(/@radix-ui\/react-dialog/);
    expect(source).toMatch(/<DialogPrimitive\.Title/);
    expect(source).toMatch(/onCloseAutoFocus/);
    expect(source).toMatch(/previewTriggerRef\.current\?\.focus\(\)/);
  });

  it("keeps preview actions inert", () => {
    expect(source).toContain('const previewId = "artist-product-preview"');
    expect(source).toContain("Preview only");
  });

  it("passes exact unlimited and tax settings into the shared artist detail", () => {
    expect(source).toMatch(/unlimitedSessions,/);
    expect(source).toMatch(/unlimitedRevisions,/);
    expect(source).toMatch(/taxMode=\{taxMode\}/);
    expect(source).toMatch(/taxRatePct=\{taxRatePct\}/);
  });
});
