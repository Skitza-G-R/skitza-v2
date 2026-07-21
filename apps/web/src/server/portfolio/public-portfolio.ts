import type { Db } from "@skitza/db";

import { songPublicationSecret } from "~/server/domain/song-publication/config";
import { listPublicPortfolioSongs } from "~/server/domain/song-publication/public-read";

/**
 * Public portfolio authority is the song marker plus its newest stored audio.
 * Legacy portfolio rows are intentionally absent from this read path.
 */
export async function listPublicPortfolioTracks(db: Db, producerId: string, limit = 3) {
  return listPublicPortfolioSongs(db, {
    producerId,
    secret: songPublicationSecret(),
    limit,
  });
}

export async function countPublicPortfolioTracks(db: Db, producerId: string): Promise<number> {
  const rows = await listPublicPortfolioSongs(db, {
    producerId,
    secret: songPublicationSecret(),
    limit: Number.MAX_SAFE_INTEGER,
  });
  return rows.length;
}
