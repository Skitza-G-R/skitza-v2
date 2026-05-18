import { TRPCError } from "@trpc/server";
import { and, asc, eq, producerExternalLinks } from "@skitza/db";
import { z } from "zod";

import { detectPlatform } from "~/lib/external-links/detect-platform";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";

// Wave 2 of /join flow (PRD §6.2 Section B). Smart-paste add: producer
// pastes any Spotify / Apple Music / YouTube / SoundCloud / Bandcamp /
// Tidal / Instagram URL and the server detects the platform via
// `detectPlatform`. Title field dropped (it was never rendered on the
// public page).
//
// Schema enforces UNIQUE(producer_id, platform) — one row per platform
// per producer — and the add path rewraps that pg violation into a
// producer-readable BAD_REQUEST so the smart-paste input can show inline
// copy without leaking pg internals.

// Human-readable labels for the friendly duplicate-platform error.
// Kept in sync with the seven supported platforms in the
// `externalPlatform` enum.
const PLATFORM_LABEL = {
  spotify: "Spotify",
  apple_music: "Apple Music",
  youtube: "YouTube",
  soundcloud: "SoundCloud",
  bandcamp: "Bandcamp",
  tidal: "Tidal",
  instagram_reels: "Instagram Reels",
} as const;

const AddInput = z.object({
  url: z.string().url().min(10).max(500),
});

// PostgreSQL unique-violation code. Matches the pattern used in
// apps/web/src/app/api/stripe/webhook/handlers.ts for the same kind of
// "catch a known constraint violation and rewrap it" flow.
function isPgUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === "23505";
}

export const producerExternalLinksRouter = router({
  /**
   * List all external links for the caller's producer, ordered by
   * render position. Hits the per-producer index from migration 0031.
   */
  list: producerProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(producerExternalLinks)
      .where(eq(producerExternalLinks.producerId, ctx.producerId))
      .orderBy(asc(producerExternalLinks.position));
  }),

  /**
   * Smart-paste add. Producer pastes a URL; server detects the
   * platform from the host. New rows land at position 0 (top of the
   * list); producers can reorder later via `reorder`.
   */
  add: producerProcedure
    .input(AddInput)
    .mutation(async ({ ctx, input }) => {
      const platform = detectPlatform(input.url);
      if (!platform) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "We don't recognise that platform yet.",
        });
      }
      try {
        const [row] = await ctx.db
          .insert(producerExternalLinks)
          .values({
            producerId: ctx.producerId,
            platform,
            url: input.url,
            title: null,
            position: 0,
          })
          .returning();
        if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return row;
      } catch (err) {
        if (isPgUniqueViolation(err)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `You already have a ${PLATFORM_LABEL[platform]} link. Remove the old one first.`,
          });
        }
        throw err;
      }
    }),

  /**
   * Delete a link scoped by (id, producer_id). A non-existent id and a
   * cross-tenant id both collapse to the same zero-row outcome, which
   * surfaces as NOT_FOUND — enumeration-proof.
   */
  remove: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .delete(producerExternalLinks)
        .where(
          and(
            eq(producerExternalLinks.id, input.id),
            eq(producerExternalLinks.producerId, ctx.producerId),
          ),
        )
        .returning({ id: producerExternalLinks.id });
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),

  /**
   * Bulk-reorder via idx-in-array → position. Each UPDATE is scoped
   * by (id, producer_id) so a cross-tenant id in the list is a no-op.
   * Matches the portfolio.reorder contract for consistency.
   */
  reorder: producerProcedure
    .input(z.object({ orderedIds: z.array(z.string().uuid()).min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      await Promise.all(
        input.orderedIds.map((id, idx) =>
          ctx.db
            .update(producerExternalLinks)
            .set({ position: idx })
            .where(
              and(
                eq(producerExternalLinks.id, id),
                eq(producerExternalLinks.producerId, ctx.producerId),
              ),
            )
            .returning({ id: producerExternalLinks.id }),
        ),
      );
      return { ok: true as const };
    }),
});
