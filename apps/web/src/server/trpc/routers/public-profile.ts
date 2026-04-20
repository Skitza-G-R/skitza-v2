import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  and,
  createDb,
  desc,
  eq,
  portfolioTracks,
  producers,
  type Db,
} from "@skitza/db";
import { headers } from "next/headers";
import { z } from "zod";
import { publicProcedure, router } from "../init";

// `/join/<slug>` is the Instagram-bio-friendly public surface a stranger
// hits before they sign up. The payload we return is deliberately
// minimal: just enough to render the hero + 3 playable samples + a
// signup CTA. Sensitive fields on the Producer row (email, Stripe IDs,
// Clerk user id, Autopilot toggles, timezone, currency) are NEVER
// returned here — leaking any of them reveals operational detail about
// the producer to an anonymous visitor. The curated shape below is the
// contract; the underlying row never touches the wire.
//
// Wave 1 scope: `externalLinks` is always empty; the table + CRUD ships
// in Wave 2 (see `docs/plans/2026-04-20-join-flow-architecture.md`).
//
// Rate-limiting: same shape as booking's public procedures — IP-hashed
// in-memory bucket is possible here, but since the payload is tiny and
// read-only and the page will be CDN-cached in production, Wave 1 skips
// it. If we see abuse, add it at the same point as booking.publicSlots.
async function publicCtx(): Promise<{ db: Db; ipHash: string }> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "missing DATABASE_URL",
    });
  }
  const hdrs = await headers();
  const ipRaw = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return {
    db: createDb(dbUrl),
    ipHash: createHash("sha256").update(ipRaw).digest("hex"),
  };
}

export const publicProfileRouter = router({
  /**
   * Fetch the minimal public-teaser payload for `/join/<slug>`.
   *
   * Returned shape is deliberately stable + narrow — the page is server-
   * rendered, so any field we add here is immediately in the HTML source
   * of a public page. Treat this as a contract with the UI, not a
   * projection of the producer row.
   */
  forJoin: publicProcedure
    .input(z.object({ slug: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const { db } = await publicCtx();

      // Step 1: resolve the producer by slug. Select ONLY the fields
      // that are safe to expose — no email, no stripe ids, no autopilot
      // flags, no timezone, no clerk user id. Reading the full row and
      // then destructuring would work but risks a future schema addition
      // accidentally landing on the wire; projecting here keeps the
      // contract explicit.
      const [producerRow] = await db
        .select({
          id: producers.id,
          slug: producers.slug,
          displayName: producers.displayName,
          brand: producers.brand,
        })
        .from(producers)
        .where(eq(producers.slug, input.slug))
        .limit(1);

      if (!producerRow) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Brand is a jsonb blob in the schema; its shape is partial. Pull
      // what we render on the hero (logo + primary hex/rgb string) and
      // leave accent / font unused for Wave 1.
      const brand = producerRow.brand ?? {};

      // Step 2: fetch the 3 most-recent public-sample tracks. The
      // `AND producer_id = ? AND is_public_sample = true` predicate
      // hits the partial index added in migration 0030. Order by
      // `created_at desc` so producers see the track they most
      // recently flagged rise to the top of the teaser.
      const sampleRows = await db
        .select({
          id: portfolioTracks.id,
          title: portfolioTracks.title,
          artist: portfolioTracks.artist,
          audioUrl: portfolioTracks.audioUrl,
          durationMs: portfolioTracks.durationMs,
          peaksR2Key: portfolioTracks.peaksR2Key,
        })
        .from(portfolioTracks)
        .where(
          and(
            eq(portfolioTracks.producerId, producerRow.id),
            eq(portfolioTracks.isPublicSample, true),
          ),
        )
        .orderBy(desc(portfolioTracks.createdAt))
        .limit(3);

      return {
        producer: {
          id: producerRow.id,
          slug: producerRow.slug,
          displayName: producerRow.displayName,
          // `bio` isn't on the producers table in the current schema;
          // producers.brand holds presentation metadata (logo, primary,
          // accent). Until a `bio` column ships, send null so the page
          // can render the hero without it. The shape the UI expects
          // is already wired for null via PRD §6.2's "Producer's name,
          // logo, bio" being progressive (hero can render without bio).
          bio: null as string | null,
          logoUrl: brand.logoUrl ?? null,
          brandColor: brand.primary ?? null,
        },
        publicSamples: sampleRows.map((row) => ({
          id: row.id,
          title: row.title,
          artist: row.artist,
          audioUrl: row.audioUrl,
          durationMs: row.durationMs,
          peaksR2Key: row.peaksR2Key,
        })),
        // Wave 1: no external-links table yet. Typed as never[] so a
        // Wave 2 addition has to update the type here explicitly and
        // the UI can't accidentally depend on a field shape that
        // doesn't exist yet.
        externalLinks: [] as Array<never>,
      };
    }),
});
