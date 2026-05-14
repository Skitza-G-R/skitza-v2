import type { MetadataRoute } from "next";

const BASE = process.env.SITE_URL ?? "https://skitza.app";

// Dynamic sitemap — lists the marketing surface only.
//
// Post-Story-03 (PRD §6.6): the legacy `/p/<slug>` portfolio URLs are
// removed, so per-producer entries are no longer emitted here. The new
// `/join/<slug>` entry is artist-funnel chrome (requires Clerk signup
// and carries no durable public content), so it isn't indexed either.
// If/when we ship a public marketing page per producer we'll reintroduce
// per-producer entries.
//
// Next calls this on-demand; Vercel's edge cache revalidates naturally
// when Googlebot hits stale cache.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "monthly", priority: 1 },
    { url: `${BASE}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: `${BASE}/changelog`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE}/sign-up`, lastModified: now, changeFrequency: "yearly", priority: 0.6 },
    { url: `${BASE}/sign-in`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
  // Belt-and-suspenders for the dead-end-funnel rule (see
  // docs/plans/active/2026-05-08-marketing-landing-design.md §3.5).
  // The /get-started* routes set noindex+nofollow at the layout level
  // already; this filter ensures even an accidental future addition
  // can't end up advertised in sitemap.xml. Test:
  // apps/web/src/app/__tests__/sitemap.test.ts
  return entries.filter((e) => !e.url.includes("/get-started"));
}
