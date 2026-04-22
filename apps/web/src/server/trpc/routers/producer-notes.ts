import { TRPCError } from "@trpc/server";
import { and, desc, eq, producerNotes } from "@skitza/db";
import { z } from "zod";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";

// Producer Quick Notes (audit Task 11). Promotes the Today cockpit's
// Quick Note modal from localStorage-only to a real DB-backed
// surface. Notes are scoped to the caller's producer — every query
// + mutation is gated by `producerProcedure` which injects
// `ctx.producerId`.
//
// Body length: soft-capped at 4000 chars in the input schema. Past
// that the notes get large enough we'd want a separate
// project-journal feature, not a "quick" note. Easy to tweak later.
//
// Ordering: `listNotes` returns newest-first, leveraging the partial
// (producer_id, created_at desc) index from migration 0032.

const SaveNoteInput = z.object({
  body: z.string().trim().min(1, "empty note").max(4000, "too long"),
});

const DeleteNoteInput = z.object({
  id: z.string().uuid(),
});

export const producerNotesRouter = router({
  /**
   * List all notes for the caller's producer, newest-first. Returns
   * the raw row shape — the Today list is small enough (<=50 recent)
   * that we don't need projection.
   */
  list: producerProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(producerNotes)
      .where(eq(producerNotes.producerId, ctx.producerId))
      .orderBy(desc(producerNotes.createdAt));
    return { notes: rows };
  }),

  /**
   * Insert a new note. Returns the created row so the UI can
   * optimistically append without a refetch.
   */
  save: producerProcedure
    .input(SaveNoteInput)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(producerNotes)
        .values({
          producerId: ctx.producerId,
          body: input.body,
        })
        .returning();
      if (!row) {
        // Shouldn't happen — INSERT ... RETURNING is atomic. Guard
        // anyway to keep the return type non-null for callers.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "note insert returned no row",
        });
      }
      return row;
    }),

  /**
   * Delete a note. Soft deletion would require a column + index
   * change; notes are ephemeral by nature so hard-delete is fine.
   * The WHERE scopes to the caller's producer — can't delete someone
   * else's notes.
   */
  delete: producerProcedure
    .input(DeleteNoteInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(producerNotes)
        .where(
          and(
            eq(producerNotes.id, input.id),
            eq(producerNotes.producerId, ctx.producerId),
          ),
        );
      return { ok: true };
    }),
});
