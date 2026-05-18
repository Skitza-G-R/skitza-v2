import { TRPCError } from "@trpc/server";
import { and, eq, portfolioTracks } from "@skitza/db";
import { z } from "zod";
import { router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { stripUndefined } from "../strip-undefined";

const TrackInput = z.object({
  title: z.string().min(1).max(200),
  artist: z.string().max(200).optional(),
  // Nullable: when creating a row for "upload pending" the audioUrl is
  // filled later by audio.completeMultipart patching the same row.
  audioUrl: z.string().url().nullable(),
  artworkUrl: z.string().url().optional(),
  position: z.number().int().min(0).optional(),
});

export const portfolioRouter = router({
  list: producerProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(portfolioTracks)
      .where(eq(portfolioTracks.producerId, ctx.producerId))
      .orderBy(portfolioTracks.position);
  }),

  create: producerProcedure
    .input(TrackInput)
    .mutation(async ({ ctx, input }) => {
      // F9 dedup — when the caller provides an audioUrl, refuse to
      // insert a second portfolio row pointing at the same R2 object
      // for this producer. Matches the "Add from music library" picker
      // contract: the same library track shouldn't appear twice in the
      // public playlist. audioUrl is the stable identity (R2 keys are
      // unique per upload). Skipped when audioUrl is null so pre-upload
      // placeholder rows from the audio.completeMultipart flow can
      // still be created.
      if (input.audioUrl) {
        const [dup] = await ctx.db
          .select({ id: portfolioTracks.id })
          .from(portfolioTracks)
          .where(
            and(
              eq(portfolioTracks.producerId, ctx.producerId),
              eq(portfolioTracks.audioUrl, input.audioUrl),
            ),
          )
          .limit(1);
        if (dup) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This track is already in your portfolio.",
          });
        }
      }
      const [row] = await ctx.db
        .insert(portfolioTracks)
        .values({
          ...stripUndefined(input),
          producerId: ctx.producerId,
          // Portfolio redesign 2026-05-17 §0.2 Q1=B: the curated
          // portfolio IS the public face on /join, so new featured
          // tracks default to public. Existing rows keep their stored
          // value — only the create path is opinionated. The
          // `togglePublicSample` mutation below still works if a
          // future surface wants to opt a track back out.
          isPublicSample: true,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return row;
    }),

  update: producerProcedure
    .input(TrackInput.partial().extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      // Two-step: load → verify ownership → update. A single-statement
      // UPDATE ... WHERE producer_id = ... would be cheaper but the
      // 0-row outcome would be ambiguous (not-found vs not-yours).
      const [existing] = await ctx.db
        .select({ producerId: portfolioTracks.producerId })
        .from(portfolioTracks)
        .where(eq(portfolioTracks.id, id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.producerId !== ctx.producerId) throw new TRPCError({ code: "FORBIDDEN" });
      const [updated] = await ctx.db
        .update(portfolioTracks)
        .set(stripUndefined(patch))
        .where(eq(portfolioTracks.id, id))
        .returning();
      // Existence proven above (NOT_FOUND check); race-deletion between
      // SELECT and UPDATE would land here as INTERNAL_SERVER_ERROR.
      if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return updated;
    }),

  delete: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ producerId: portfolioTracks.producerId })
        .from(portfolioTracks)
        .where(eq(portfolioTracks.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.producerId !== ctx.producerId) throw new TRPCError({ code: "FORBIDDEN" });
      await ctx.db.delete(portfolioTracks).where(eq(portfolioTracks.id, input.id));
      return { ok: true as const };
    }),

  reorder: producerProcedure
    .input(z.object({ orderedIds: z.array(z.string().uuid()).min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      // Bulk update via Promise.all; each WHERE filters by id AND
      // producerId so any id from a different tenant slipped into
      // orderedIds is a no-op. `.returning({ id })` is called purely
      // to keep the drizzle chain shape uniform with the other
      // mutations (cheap: discarded array of ≤200 ids).
      await Promise.all(
        input.orderedIds.map((id, idx) =>
          ctx.db
            .update(portfolioTracks)
            .set({ position: idx })
            .where(
              and(
                eq(portfolioTracks.id, id),
                eq(portfolioTracks.producerId, ctx.producerId),
              ),
            )
            .returning({ id: portfolioTracks.id }),
        ),
      );
      return { ok: true as const };
    }),

  // Story 01 of /join flow (PRD §6.2). Producers flip the
  // `is_public_sample` flag one track at a time to opt that track
  // into the `/join/<slug>` teaser for unsigned-in visitors.
  //
  // Single-statement UPDATE scoped by `id AND producer_id` — both a
  // non-existent id and a cross-tenant id collapse to the same zero-
  // row outcome, which we surface as NOT_FOUND. This is deliberately
  // enumeration-proof: a caller can't distinguish "this track exists
  // but you don't own it" from "this track doesn't exist."
  togglePublicSample: producerProcedure
    .input(z.object({ trackId: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .update(portfolioTracks)
        .set({ isPublicSample: input.enabled })
        .where(
          and(
            eq(portfolioTracks.id, input.trackId),
            eq(portfolioTracks.producerId, ctx.producerId),
          ),
        )
        .returning({ id: portfolioTracks.id });
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),
});
