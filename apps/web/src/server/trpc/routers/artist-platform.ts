import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  ArtistDisconnectError,
  commitArtistStudioDisconnect,
  previewArtistStudioDisconnect,
} from "~/server/artist/disconnect";
import {
  hasArtistHistoricalGrant,
  loadArtistHistoricalProof,
  loadArtistHistoricalSession,
  loadArtistHistoricalVersion,
  listArtistPastStudios,
  loadArtistPastStudio,
} from "~/server/artist/history";
import {
  acknowledgeArtistTrackVersionNotification,
  artistNotificationStudioDotProducerIds,
  artistNotificationUnreadCount,
  listArtistNotifications,
  markAllArtistNotificationsRead,
  markArtistNotificationRead,
  openArtistNotification,
} from "~/server/artist/notifications";
import {
  getArtistProfile,
  saveArtistNotificationPreferences,
  saveArtistTimezone,
} from "~/server/artist/profile";

import { artistProcedure } from "../artist-procedure";
import { router } from "../init";

const categoryPreference = z.object({
  inApp: z.boolean(),
  transactionalEmail: z.boolean(),
  activityEmail: z.boolean(),
});

const notificationPreferences = z.object({
  purchase: categoryPreference,
  proof: categoryPreference,
  booking: categoryPreference,
  session_reminder: categoryPreference,
  new_music: categoryPreference,
  producer_comment: categoryPreference,
});

function proofServerSecret(): string {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Private proof delivery is not configured",
    });
  }
  return secret;
}

function mapDisconnectError(error: unknown): never {
  if (!(error instanceof ArtistDisconnectError)) throw error;
  if (error.code === "NOT_FOUND") {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error.code === "CONCURRENT_CHANGE") {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: error.message,
    cause: { blockers: error.blockers },
  });
}

export const artistPlatformRouter = router({
  profile: router({
    get: artistProcedure.query(({ ctx }) => getArtistProfile(ctx.db, ctx.clerkUserId)),
    updateTimezone: artistProcedure
      .input(z.object({ timezone: z.string().min(1).max(100) }))
      .mutation(async ({ ctx, input }) => {
        try {
          return {
            timezone: await saveArtistTimezone(ctx.db, ctx.clerkUserId, input.timezone),
          };
        } catch (error) {
          if (error instanceof Error && error.message === "INVALID_TIMEZONE") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Choose a valid timezone.",
            });
          }
          throw error;
        }
      }),
    updateNotifications: artistProcedure
      .input(notificationPreferences)
      .mutation(({ ctx, input }) =>
        saveArtistNotificationPreferences(ctx.db, ctx.clerkUserId, input),
      ),
  }),

  notifications: router({
    list: artistProcedure
      .input(
        z
          .object({
            filter: z.enum(["all", "unread"]).default("all"),
            limit: z.number().int().min(1).max(50).default(30),
          })
          .default({ filter: "all", limit: 30 }),
      )
      .query(({ ctx, input }) =>
        listArtistNotifications(ctx.db, {
          clerkUserId: ctx.clerkUserId,
          filter: input.filter,
          limit: input.limit,
        }),
      ),
    unreadCount: artistProcedure.query(({ ctx }) =>
      artistNotificationUnreadCount(ctx.db, ctx.clerkUserId),
    ),
    studioDots: artistProcedure.query(({ ctx }) =>
      artistNotificationStudioDotProducerIds(ctx.db, ctx.clerkUserId),
    ),
    acknowledgeTrackVersion: artistProcedure
      .input(z.object({ trackVersionId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => ({
        acknowledgedCount: await acknowledgeArtistTrackVersionNotification(
          ctx.db,
          ctx.clerkUserId,
          input.trackVersionId,
        ),
      })),
    markRead: artistProcedure
      .input(z.object({ notificationId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const owned = await markArtistNotificationRead(
          ctx.db,
          ctx.clerkUserId,
          input.notificationId,
        );
        if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
        return { ok: true as const };
      }),
    markAllRead: artistProcedure.mutation(async ({ ctx }) => ({
      markedCount: await markAllArtistNotificationsRead(ctx.db, ctx.clerkUserId),
    })),
    open: artistProcedure
      .input(z.object({ notificationId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const href = await openArtistNotification(ctx.db, ctx.clerkUserId, input.notificationId);
        if (!href) throw new TRPCError({ code: "NOT_FOUND" });
        return { href };
      }),
  }),

  history: router({
    studios: artistProcedure.query(({ ctx }) => listArtistPastStudios(ctx.db, ctx.clerkUserId)),
    studio: artistProcedure
      .input(z.object({ producerId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const studio = await loadArtistPastStudio(ctx.db, ctx.clerkUserId, input.producerId);
        if (!studio) throw new TRPCError({ code: "NOT_FOUND" });
        return studio;
      }),
    version: artistProcedure
      .input(
        z.object({
          producerId: z.string().uuid(),
          versionId: z.string().uuid(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const version = await loadArtistHistoricalVersion(ctx.db, {
          clerkUserId: ctx.clerkUserId,
          ...input,
        });
        if (!version) throw new TRPCError({ code: "NOT_FOUND" });
        return version;
      }),
    proof: artistProcedure
      .input(
        z.object({
          producerId: z.string().uuid(),
          proofId: z.string().uuid(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const proof = await loadArtistHistoricalProof(ctx.db, {
          clerkUserId: ctx.clerkUserId,
          ...input,
          serverSecret: proofServerSecret(),
        });
        if (!proof) throw new TRPCError({ code: "NOT_FOUND" });
        return proof;
      }),
    session: artistProcedure
      .input(
        z.object({
          producerId: z.string().uuid(),
          sessionId: z.string().uuid(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const session = await loadArtistHistoricalSession(ctx.db, {
          clerkUserId: ctx.clerkUserId,
          ...input,
        });
        if (!session) throw new TRPCError({ code: "NOT_FOUND" });
        return session;
      }),
    hasGrant: artistProcedure
      .input(
        z.object({
          producerId: z.string().uuid(),
          resourceType: z.enum([
            "studio",
            "purchase",
            "project",
            "track",
            "track_version",
            "track_comment",
            "payment_proof",
            "booking",
            "track_version_download",
          ]),
          resourceId: z.string().uuid(),
        }),
      )
      .query(({ ctx, input }) =>
        hasArtistHistoricalGrant(ctx.db, {
          clerkUserId: ctx.clerkUserId,
          ...input,
        }),
      ),
  }),

  disconnect: router({
    preview: artistProcedure
      .input(z.object({ producerId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const preview = await previewArtistStudioDisconnect(ctx.db, {
          clerkUserId: ctx.clerkUserId,
          producerId: input.producerId,
        });
        if (!preview) throw new TRPCError({ code: "NOT_FOUND" });
        return preview;
      }),
    commit: artistProcedure
      .input(z.object({ producerId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await commitArtistStudioDisconnect(ctx.db, {
            clerkUserId: ctx.clerkUserId,
            producerId: input.producerId,
          });
        } catch (error) {
          mapDisconnectError(error);
        }
      }),
  }),
});
