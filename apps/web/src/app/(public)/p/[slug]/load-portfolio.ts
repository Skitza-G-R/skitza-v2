import { cache } from "react";
import {
  createDb,
  eq,
  portfolioTracks,
  producers,
  type PortfolioTrack,
  type Producer,
} from "@skitza/db";
import { isAutoSlug } from "~/lib/slug";

export type LoadedPortfolio = {
  // Loader filters out producers with null displayName, so callers can
  // safely treat displayName as a string here without re-narrowing.
  producer: Producer & { displayName: string };
  tracks: PortfolioTrack[];
};

/**
 * Loader for the public `/p/[slug]` portfolio page.
 *
 * Wrapped in `React.cache` so `generateMetadata` and the page render share a
 * single DB round-trip per request. Without this wrapper Next dedupes only
 * `fetch` calls — raw async functions run twice.
 *
 * Treats three cases as "not public" and returns null so callers can map them
 * to `notFound()` uniformly:
 *   1. No producer with that slug.
 *   2. `displayName === null` — webhook seeded the row at sign-up but the
 *      user hasn't finished /onboarding.
 *   3. `slug === emailToSlug(email)` — slug is the auto-generated default,
 *      i.e. the producer hasn't customized it yet. Mirrors the (app) gate
 *      in apps/web/src/app/(app)/layout.tsx so a half-onboarded profile
 *      can't be reached via its temporary email-derived URL.
 *
 * Throws on missing `DATABASE_URL` — config error, not a 404.
 */
export const loadProducerPortfolio = cache(
  async (slug: string): Promise<LoadedPortfolio | null> => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("missing DATABASE_URL");

    const db = createDb(dbUrl);
    const [producer] = await db
      .select()
      .from(producers)
      .where(eq(producers.slug, slug))
      .limit(1);

    if (!producer) return null;
    if (producer.displayName === null) return null;
    if (isAutoSlug(producer.slug, producer.email)) return null;

    const tracks = await db
      .select()
      .from(portfolioTracks)
      .where(eq(portfolioTracks.producerId, producer.id))
      .orderBy(portfolioTracks.position);

    return { producer: { ...producer, displayName: producer.displayName }, tracks };
  },
);
