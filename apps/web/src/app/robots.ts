import type { MetadataRoute } from "next";

const BASE = process.env.SITE_URL ?? "https://skitza-v2-web.vercel.app";

// Crawl policy:
// * / and /p/* are the marketing surface area — allow.
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
        allow: ["/", "/p/"],
        disallow: ["/dashboard", "/onboarding", "/m/", "/api/", "/sign-in", "/sign-up"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
