import type { MetadataRoute } from "next";

const BASE = process.env.SITE_URL ?? "https://skitza-v2-web.vercel.app";

// Crawl policy:
// * / , /about, /privacy, /terms, /changelog, /sign-up, /sign-in, and
//   /p/* are the marketing surface area — allow. (Previously we blocked
//   /sign-in and /sign-up because there was nothing to see; now they're
//   real flows with SEO value for "skitza sign up" queries.)
// * /dashboard/* and /onboarding — auth-gated, no value to index.
// * /m/* — magic links are single-use, should NEVER be crawled (and the
//   route returns 404 for anyone without a valid signed token anyway,
//   but make intent explicit here).
// * /api/* — endpoints aren't pages.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/p/", "/about", "/privacy", "/terms", "/changelog", "/sign-in", "/sign-up"],
        disallow: ["/dashboard", "/onboarding", "/m/", "/api/"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
