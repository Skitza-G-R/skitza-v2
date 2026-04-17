import { z } from "zod";
import { and, desc, eq, isNull, isNotNull, notifications, type Db } from "@skitza/db";
import { TRPCError } from "@trpc/server";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";

// Unified inbox over the `notifications` table. Active and archived
// buckets are two queries over the same index
// (producerId, archivedAt, createdAt). Emit helpers in
// server/notifications/emit.ts insert rows; this router only reads
// and mutates state (read/archive flags).

export const inboxRouter = router({
  // Active (non-archived) by default; pass { archived: true } for the
  // archive tab. 100-row cap keeps the page snappy; older entries are
  // effectively paginated out until someone actually asks for scroll.
  list: producerProcedure
    .input(z.object({ archived: z.boolean().default(false) }).optional())
    .query(async ({ ctx, input }) => {
      const archived = input?.archived ?? false;
      const rows = await ctx.db
        .select()
        .from(notifications)
        .where(and(
          eq(notifications.producerId, ctx.producerId),
          archived ? isNotNull(notifications.archivedAt) : isNull(notifications.archivedAt),
        ))
        .orderBy(desc(notifications.createdAt))
        .limit(100);
      return rows;
    }),

  // Count of non-archived unread rows. Used for the sidebar badge.
  // Cheap — the index covers all three predicates.
  unreadCount: producerProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.producerId, ctx.producerId),
        isNull(notifications.readAt),
        isNull(notifications.archivedAt),
      ));
    return rows.length;
  }),

  markRead: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnsNotification(ctx, input.id);
      await ctx.db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(eq(notifications.id, input.id));
      return { ok: true as const };
    }),

  markAllRead: producerProcedure.mutation(async ({ ctx }) => {
    const now = new Date();
    await ctx.db
      .update(notifications)
      .set({ readAt: now })
      .where(and(
        eq(notifications.producerId, ctx.producerId),
        isNull(notifications.readAt),
      ));
    return { ok: true as const };
  }),

  archive: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnsNotification(ctx, input.id);
      const now = new Date();
      // Archiving implies read — no reason to keep bold/unread state
      // on a row the producer explicitly dismissed.
      await ctx.db
        .update(notifications)
        .set({ archivedAt: now, readAt: now })
        .where(eq(notifications.id, input.id));
      return { ok: true as const };
    }),

  unarchive: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnsNotification(ctx, input.id);
      await ctx.db
        .update(notifications)
        .set({ archivedAt: null })
        .where(eq(notifications.id, input.id));
      return { ok: true as const };
    }),
});

// Tenant-scoped ownership check. Keeps the mutation handlers small
// and consistent. NOT_FOUND when missing, FORBIDDEN when it belongs
// to a different producer — the UI can render a helpful toast either
// way, and the two codes give the producer a clue.
async function assertOwnsNotification(
  ctx: { db: Db; producerId: string },
  id: string,
): Promise<void> {
  const [row] = await ctx.db
    .select({ producerId: notifications.producerId })
    .from(notifications)
    .where(eq(notifications.id, id))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  if (row.producerId !== ctx.producerId) throw new TRPCError({ code: "FORBIDDEN" });
}
