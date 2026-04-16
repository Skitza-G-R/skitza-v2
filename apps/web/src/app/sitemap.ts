import type { MetadataRoute } from "next";

import { createDb, producers } from "@skitza/db";
import { isAutoSlug } from "~/lib/slug";

const BASE = process.env.SITE_URL ?? "https://skitza-v2-web.vercel.app";

// Dynamic sitemap — lists /, /sign-up, and one entry per producer whose
// profile is complete (same gate as loadProducerPortfolio). Auto-slug
// rows are excluded because they point at no-op 404s.
//
// Next calls this on-demand; we don't need to rebuild on every producer
// signup because Vercel's edge cache will revalidate naturally when
// Googlebot hits stale cache.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const base: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "monthly", priority: 1 },
    { url: `${BASE}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: `${BASE}/sign-up`, lastModified: now, changeFrequency: "yearly", priority: 0.6 },
    { url: `${BASE}/sign-in`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return base;

  try {
    const db = createDb(dbUrl);
    const rows = await db
      .select({
        slug: producers.slug,
        email: producers.email,
        displayName: producers.displayName,
        updatedAt: producers.updatedAt,
      })
      .from(producers);

    const producerEntries: MetadataRoute.Sitemap = rows
      .filter((r) => r.displayName !== null && !isAutoSlug(r.slug, r.email))
      .map((r) => ({
        url: `${BASE}/p/${r.slug}`,
        lastModified: r.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      }));

    return [...base, ...producerEntries];
  } catch {
    // Sitemap generation is best-effort — if the DB is unreachable we
    // still want Google to see the static surface.
    return base;
  }
}
