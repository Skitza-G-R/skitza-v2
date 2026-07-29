import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  MAX_SONG_ARTWORK_BYTES,
  SONG_ARTWORK_CONTENT_TYPES,
} from "~/server/domain/song-artwork/policy";
import {
  completeProducerSongArtwork,
  prepareProducerSongArtwork,
  SongArtworkDomainError,
} from "~/server/domain/song-artwork/service";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";

function songArtworkSecret(): string {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) throw new Error("Missing CLERK_SECRET_KEY");
  return secret;
}

function mapSongArtworkError(error: unknown): never {
  if (!(error instanceof SongArtworkDomainError)) throw error;
  switch (error.code) {
    case "NOT_FOUND":
      throw new TRPCError({ code: "NOT_FOUND" });
    case "INVALID_INPUT":
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    case "CONFLICT":
      throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
}

export const songArtworkRouter = router({
  prepare: producerProcedure
    .input(
      z.object({
        trackId: z.string().uuid(),
        fileName: z.string().min(1).max(200),
        contentType: z.enum(SONG_ARTWORK_CONTENT_TYPES),
        sizeBytes: z.number().int().positive().max(MAX_SONG_ARTWORK_BYTES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await prepareProducerSongArtwork(ctx.db, {
          producerId: ctx.producerId,
          trackId: input.trackId,
          originalFileName: input.fileName,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          serverSecret: songArtworkSecret(),
        });
      } catch (error) {
        mapSongArtworkError(error);
      }
    }),

  complete: producerProcedure
    .input(
      z.object({
        trackId: z.string().uuid(),
        uploadToken: z.string().min(1).max(4096),
        objectEtag: z.string().min(1).max(512),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await completeProducerSongArtwork(ctx.db, {
          producerId: ctx.producerId,
          trackId: input.trackId,
          uploadToken: input.uploadToken,
          objectEtag: input.objectEtag,
          serverSecret: songArtworkSecret(),
        });
      } catch (error) {
        mapSongArtworkError(error);
      }
    }),
});
