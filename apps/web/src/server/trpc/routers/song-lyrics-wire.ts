import { TRPCError } from "@trpc/server";

import type { LyricsWriterRole, SetSongLyricsResult } from "~/server/domain/song-management/db";
import { SongManagementDomainError } from "~/server/domain/song-management/service";

/**
 * SK-305. One shape for both sides.
 *
 * The producer and the artist call different procedures with different
 * authorization, but the same dialog renders whatever comes back, so both
 * return this. Dates cross tRPC as ISO strings.
 *
 * A stale save is a successful response carrying `ok: false`, not an error.
 * The caller has to draw the other side's words beside the ones still sitting
 * in the textarea, which is ordinary flow rather than a failure.
 */
export type SongLyricsWire =
  | {
      ok: true;
      lyrics: string | null;
      lyricsUpdatedAtIso: string;
      lyricsUpdatedBy: LyricsWriterRole;
    }
  | {
      ok: false;
      reason: "stale";
      lyrics: string | null;
      lyricsUpdatedAtIso: string | null;
      lyricsUpdatedBy: LyricsWriterRole | null;
    };

export function toSongLyricsWire(result: SetSongLyricsResult): SongLyricsWire {
  return result.ok
    ? {
        ok: true,
        lyrics: result.lyrics,
        lyricsUpdatedAtIso: result.lyricsUpdatedAt.toISOString(),
        lyricsUpdatedBy: result.lyricsUpdatedBy,
      }
    : {
        ok: false,
        reason: "stale",
        lyrics: result.lyrics,
        // Null only if the sheet was never written, which the dialog reads as
        // "start from nothing" rather than "somebody beat you to it".
        lyricsUpdatedAtIso: result.lyricsUpdatedAt?.toISOString() ?? null,
        lyricsUpdatedBy: result.lyricsUpdatedBy,
      };
}

/**
 * Narrow on purpose. `setSongLyrics` can only fail three ways, and both the
 * producer and the artist route through this one mapper so the same refusal
 * reads the same on either side.
 *
 * Staleness never arrives here — it is a successful response, not a throw.
 */
export function mapSongLyricsDomainError(error: unknown): never {
  if (!(error instanceof SongManagementDomainError)) throw error;
  // Wrong producer, wrong project, or a song that is not there. Deliberately
  // undifferentiated so the response cannot confirm another producer's song
  // exists.
  if (error.code === "NOT_FOUND") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Song not found." });
  }
  // Past the length cap, or not text at all.
  if (error.code === "INVALID_INPUT") {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
}
