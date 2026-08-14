import { describe, it, expect } from "vitest";

import sitemap from "../sitemap";

describe("sitemap", () => {
  it("excludes retired public routes from the sitemap", () => {
    const entries = sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls.some((u) => u.includes("/get-started"))).toBe(false);
    expect(urls.some((u) => u.includes("/changelog"))).toBe(false);
  });
});
