import type { MetadataRoute } from "next";

const BASE = process.env.SITE_URL ?? "https://skitza.app";

// Crawl policy:
// * / , /about, /privacy, /terms, /changelog, /sign-up, /sign-in are
//   the marketing surface area — allow.
// * /dashboard/* and /onboarding — auth-gated, no value to index.
// * /join/* — the artist funnel requires Clerk signup; no durable
//   public content to crawl. Disallow so Google doesn't waste budget
//   on gated pages that always look the same.
// * /m/* — magic links are single-use, should NEVER be crawled (and the
//   route returns 404 for anyone without a valid signed token anyway,
//   but make intent explicit here).
// * /api/* — endpoints aren't pages.
//
// Post-Story-03 (PRD §6.6): `/p/*` was removed from the allow list
// because the routes no longer exist — every URL under that prefix
// returns a 404.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/about", "/privacy", "/terms", "/changelog", "/sign-in", "/sign-up"],
        disallow: ["/dashboard", "/onboarding", "/join/", "/m/", "/api/"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
