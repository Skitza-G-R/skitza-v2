import { TRPCError } from "@trpc/server";
import { and, asc, eq, producerExternalLinks, type ExternalPlatform } from "@skitza/db";
import { z } from "zod";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";

// Wave 2 of /join flow (PRD §6.2 Section B). Seven supported platforms
// — fixed enum in the schema. Adding a new platform requires migration
// + embed component + Setup UI update + this list. Intentional friction
// so the producer-facing set stays curated.
const PLATFORMS = [
  "spotify",
  "apple_music",
  "youtube",
  "soundcloud",
  "bandcamp",
  "tidal",
  "instagram_reels",
] as const satisfies readonly ExternalPlatform[];

const platformSchema = z.enum(PLATFORMS);

// URL validation: z.string().url() catches malformed. We don't pattern-
// match the URL against the platform at this layer — that's the Setup
// UI's job (the producer picks a platform, then the UI sanity-checks
// the pasted URL). Enforcing it server-side would reject valid edge
// cases like Spotify share links with `?si=` params.
const LinkInput = z.object({
  platform: platformSchema,
  url: z.string().url().min(10).max(500),
  title: z.string().max(120).nullable().optional(),
});

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
   * Create a new link. New rows land at position 0 (top of the list);
   * producers can reorder later via `reorder`. Skipping a uniqueness
   * check on (producer, url) — a producer may legitimately want to
   * link the same artist page twice (e.g. one as a featured single,
   * one in a different context with a different title). UI can warn.
   */
  add: producerProcedure
    .input(LinkInput)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(producerExternalLinks)
        .values({
          producerId: ctx.producerId,
          platform: input.platform,
          url: input.url,
          title: input.title ?? null,
          position: 0,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return row;
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
