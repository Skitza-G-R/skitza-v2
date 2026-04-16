import {
  createDb,
  eq,
  portfolioTracks,
  producers,
  type PortfolioTrack,
  type Producer,
} from "@skitza/db";

export type LoadedPortfolio = {
  producer: Producer;
  tracks: PortfolioTrack[];
};

/**
 * Loader for the public `/p/[slug]` portfolio page.
 *
 * Treats two distinct cases as "not public":
 *   1. No producer with that slug.
 *   2. Producer exists but `displayName` is still null — webhook seeded the
 *      row at Clerk sign-up before the user finished /onboarding. Surfacing
 *      a half-built profile to the public would leak email-derived auto-slugs
 *      and an empty name.
 *
 * Returns `null` for both cases so callers can map to `notFound()` uniformly.
 * Throws on missing `DATABASE_URL` to mirror the existing trpc/(app)
 * pattern — config error, not a 404.
 */
export async function loadProducerPortfolio(
  slug: string,
): Promise<LoadedPortfolio | null> {
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

  const tracks = await db
    .select()
    .from(portfolioTracks)
    .where(eq(portfolioTracks.producerId, producer.id))
    .orderBy(portfolioTracks.position);

  return { producer, tracks };
}
