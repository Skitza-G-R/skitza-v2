import type { MetadataRoute } from "next";

const BASE = process.env.SITE_URL ?? "https://skitza-v2-web.vercel.app";

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
  return [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "monthly", priority: 1 },
    { url: `${BASE}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: `${BASE}/changelog`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE}/sign-up`, lastModified: now, changeFrequency: "yearly", priority: 0.6 },
    { url: `${BASE}/sign-in`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
