import { and, desc, eq, isNotNull, portfolioTracks, type Db } from "@skitza/db";

function explicitlyPublicPortfolio(producerId: string) {
  return and(
    eq(portfolioTracks.producerId, producerId),
    eq(portfolioTracks.isPublicSample, true),
    isNotNull(portfolioTracks.audioUrl),
  );
}

export async function listPublicPortfolioTracks(db: Db, producerId: string, limit = 3) {
  return db
    .select({
      id: portfolioTracks.id,
      title: portfolioTracks.title,
      artist: portfolioTracks.artist,
      audioUrl: portfolioTracks.audioUrl,
      durationMs: portfolioTracks.durationMs,
      peaksR2Key: portfolioTracks.peaksR2Key,
    })
    .from(portfolioTracks)
    .where(explicitlyPublicPortfolio(producerId))
    .orderBy(desc(portfolioTracks.createdAt))
    .limit(limit);
}

export async function countPublicPortfolioTracks(db: Db, producerId: string): Promise<number> {
  const rows = await db
    .select({ id: portfolioTracks.id })
    .from(portfolioTracks)
    .where(explicitlyPublicPortfolio(producerId));

  return rows.length;
}
