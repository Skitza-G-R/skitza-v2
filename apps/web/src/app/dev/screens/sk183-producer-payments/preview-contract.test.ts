import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("SK-183 Producer payments visual preview", () => {
  it("is available only in development and preview environments", () => {
    expect(page).toContain("if (!isDevGalleryAvailable()) notFound();");
  });
});
