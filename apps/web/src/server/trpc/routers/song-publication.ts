import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  listProducerPortfolioSongChoices,
  readArtistSongPublicationState,
  readProducerSongPublicationState,
  SongPublicationAuthenticatedReadError,
} from "~/server/domain/song-publication/authenticated-read";
import { songPublicationSecret } from "~/server/domain/song-publication/config";
import { songPublicationRepository } from "~/server/domain/song-publication/db";
import {
  disableSongPublicLink,
  publishSongPublicLink,
  resetSongPublicLink,
  setPortfolioPublic,
  SongPublicationDomainError,
} from "~/server/domain/song-publication/service";

import { artistProcedure } from "../artist-procedure";
import { producerProcedure } from "../producer-procedure";
import { router } from "../init";

const TrackInput = z.object({ trackId: z.string().uuid() });
const CommandInput = TrackInput.extend({ operationKey: z.string().uuid() });

function mapError(error: unknown): never {
  if (error instanceof SongPublicationAuthenticatedReadError) {
    throw new TRPCError({
      code: error.code === "NOT_FOUND" ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
      message: error.code === "NOT_FOUND" ? "Not found" : "Public song state is invalid",
    });
  }
  if (error instanceof SongPublicationDomainError) {
    switch (error.code) {
      case "INVALID_INPUT":
        throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
      case "NOT_FOUND":
        throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      case "NO_STORED_AUDIO":
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
      case "LINK_NOT_LIVE":
      case "OPERATION_KEY_CONFLICT":
      case "CONCURRENT_CHANGE":
        throw new TRPCError({ code: "CONFLICT", message: error.message });
      case "INTEGRITY_ERROR":
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Public song state is invalid",
        });
    }
  }
  throw error;
}

function command(
  ctx: { producerId: string; userId: string | null },
  input: z.infer<typeof CommandInput>,
) {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return {
    producerId: ctx.producerId,
    trackId: input.trackId,
    operationKey: input.operationKey,
    changedByClerkUserId: ctx.userId,
    occurredAt: new Date(),
  };
}

export const songPublicationRouter = router({
  producerPortfolioChoices: producerProcedure.query(({ ctx }) =>
    listProducerPortfolioSongChoices(ctx.db, { producerId: ctx.producerId }),
  ),

  producerState: producerProcedure.input(TrackInput).query(async ({ ctx, input }) => {
    try {
      return await readProducerSongPublicationState(ctx.db, {
        producerId: ctx.producerId,
        trackId: input.trackId,
        tokenSecret: songPublicationSecret(),
      });
    } catch (error) {
      mapError(error);
    }
  }),

  artistState: artistProcedure.input(TrackInput).query(async ({ ctx, input }) => {
    try {
      return await readArtistSongPublicationState(ctx.db, {
        artistClerkUserId: ctx.clerkUserId,
        trackId: input.trackId,
        tokenSecret: songPublicationSecret(),
      });
    } catch (error) {
      mapError(error);
    }
  }),

  artistPublish: artistProcedure.input(CommandInput).mutation(async ({ ctx, input }) => {
    try {
      const state = await readArtistSongPublicationState(ctx.db, {
        artistClerkUserId: ctx.clerkUserId,
        trackId: input.trackId,
        tokenSecret: songPublicationSecret(),
      });
      return await publishSongPublicLink(
        songPublicationRepository(ctx.db, { artistClerkUserId: ctx.clerkUserId }),
        {
          producerId: state.producerId,
          trackId: input.trackId,
          operationKey: input.operationKey,
          changedByClerkUserId: ctx.clerkUserId,
          occurredAt: new Date(),
        },
        {
          tokenSecret: songPublicationSecret(),
          canEnableDisabledLink: false,
        },
      );
    } catch (error) {
      mapError(error);
    }
  }),

  publish: producerProcedure.input(CommandInput).mutation(async ({ ctx, input }) => {
    try {
      return await publishSongPublicLink(songPublicationRepository(ctx.db), command(ctx, input), {
        tokenSecret: songPublicationSecret(),
      });
    } catch (error) {
      mapError(error);
    }
  }),

  reset: producerProcedure.input(CommandInput).mutation(async ({ ctx, input }) => {
    try {
      return await resetSongPublicLink(songPublicationRepository(ctx.db), command(ctx, input), {
        tokenSecret: songPublicationSecret(),
      });
    } catch (error) {
      mapError(error);
    }
  }),

  disable: producerProcedure.input(CommandInput).mutation(async ({ ctx, input }) => {
    try {
      return await disableSongPublicLink(songPublicationRepository(ctx.db), command(ctx, input), {
        tokenSecret: songPublicationSecret(),
      });
    } catch (error) {
      mapError(error);
    }
  }),

  setPortfolioPublic: producerProcedure
    .input(CommandInput.extend({ published: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await setPortfolioPublic(
          songPublicationRepository(ctx.db),
          { ...command(ctx, input), published: input.published },
          { tokenSecret: songPublicationSecret() },
        );
      } catch (error) {
        mapError(error);
      }
    }),
});
