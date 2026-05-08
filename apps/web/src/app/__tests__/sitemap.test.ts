import { describe, it, expect } from "vitest";

import sitemap from "../sitemap";

// Regression guard for the dead-end-funnel rule (design doc §3.5).
// The /get-started* routes are paid-traffic destinations with their
// own ad copy and noindex metadata. Including them in sitemap.xml
// would cancel out the noindex by advertising the URL — Googlebot
// reads sitemap entries as crawl seeds and may then ignore robots
// directives reached via the seed.
//
// This test fails if a future change re-introduces the URLs.

describe("sitemap", () => {
  it("excludes /get-started* routes from the sitemap", () => {
    const entries = sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls.some((u) => u.includes("/get-started"))).toBe(false);
  });
});
