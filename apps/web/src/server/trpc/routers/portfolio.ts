import { TRPCError } from "@trpc/server";
import { and, eq, portfolioTracks } from "@skitza/db";
import { z } from "zod";
import { router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { stripUndefined } from "../strip-undefined";

const TrackInput = z.object({
  title: z.string().min(1).max(200),
  artist: z.string().max(200).optional(),
  audioUrl: z.string().url(),
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
      const [row] = await ctx.db
        .insert(portfolioTracks)
        .values({ ...stripUndefined(input), producerId: ctx.producerId })
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
});
