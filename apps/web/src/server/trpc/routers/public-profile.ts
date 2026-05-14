import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  asc,
  createDb,
  desc,
  eq,
  portfolioTracks,
  producerExternalLinks,
  producers,
  type Db,
  type ProducerExternalLink,
} from "@skitza/db";
import { headers } from "next/headers";
import { z } from "zod";
import { publicProcedure, router } from "../init";

// `/join/<slug>` is the Instagram-bio-friendly public surface a stranger
// hits before they sign up. The payload we return is deliberately
// minimal: just enough to render the hero + 3 playable samples +
// external streaming embeds + a signup CTA. Sensitive fields on the
// Producer row (email, Stripe IDs, Clerk user id, Autopilot toggles,
// timezone, currency) are NEVER returned here — leaking any of them
// reveals operational detail about the producer to an anonymous
// visitor. The curated shape below is the contract; the underlying
// row never touches the wire.
//
// Wave 2 (this file): `externalLinks` now returns real rows from the
// producer_external_links table (migration 0031). Wave 1 held the
// shape as `never[]`; Wave 2 promotes it to the proper typed array so
// the /join page can render its Section B (external embeds, PRD §6.2).
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
      //
      // Marketing meta fields (genres / releasedSummary / streamsSummary
      // / responseHours) are part of the public surface — the producer
      // explicitly authors them for their /join page and they're meant
      // to ride out to anonymous visitors. Migration 0006.
      const [producerRow] = await db
        .select({
          id: producers.id,
          slug: producers.slug,
          displayName: producers.displayName,
          brand: producers.brand,
          genres: producers.genres,
          releasedSummary: producers.releasedSummary,
          streamsSummary: producers.streamsSummary,
          responseHours: producers.responseHours,
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

      // Step 2: fetch the 3 most-recent portfolio tracks. The original
      // shape filtered by `is_public_sample = true` (per-track opt-in
      // for unsigned-in visitors), but the producer surface no longer
      // exposes that toggle — every track in the portfolio is the
      // public profile, full stop. We left the column on the schema
      // (migration cost vs. rollback safety) but stopped reading it.
      // Order by `created_at desc` so the producer's newest portfolio
      // additions surface at the top of the teaser.
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
        .where(eq(portfolioTracks.producerId, producerRow.id))
        .orderBy(desc(portfolioTracks.createdAt))
        .limit(3);

      // Step 3: fetch external streaming links (Wave 2, PRD §6.2
      // Section B). Ordered by the producer-curated `position` field
      // so the Setup-UI reorder is respected here. Hits the
      // (producer_id, position) index from migration 0031. No limit —
      // a producer with 12 links gets all 12. The UI can choose to
      // paginate or truncate if reasonable cap is needed.
      //
      // Defensive wrapper: the /join page is our primary cold-visitor
      // surface — a stranger pasting the URL from an IG bio. External
      // links are a progressive enhancement (Section B of the PRD);
      // the samples + signup CTA (Sections A + C) carry the page on
      // their own. If this query fails for ANY reason — migration
      // drift, partial DB outage, schema-change-in-flight — we log
      // server-side (future Sentry will pick it up) and fall back to
      // an empty list. The page still renders, no 500 reaches the
      // user. See docs/audit-report.md Tasks 1 + 2 for the production
      // incident that motivated this wrapper (2026-04-22).
      let externalLinkRows: Array<
        Pick<
          ProducerExternalLink,
          "id" | "platform" | "url" | "title" | "position"
        >
      > = [];
      try {
        externalLinkRows = await db
          .select({
            id: producerExternalLinks.id,
            platform: producerExternalLinks.platform,
            url: producerExternalLinks.url,
            title: producerExternalLinks.title,
            position: producerExternalLinks.position,
          })
          .from(producerExternalLinks)
          .where(eq(producerExternalLinks.producerId, producerRow.id))
          .orderBy(asc(producerExternalLinks.position));
      } catch (err) {
        console.error(
          "[publicProfile.forJoin] externalLinks query failed; most likely migration 0031 not applied. Falling back to [] so /join still renders:",
          err,
        );
      }

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
        // Marketing meta — null on freshly-created producer rows; the
        // /join meta-strip hides a stat block whose value is null. We
        // pass these straight through so the component doesn't have
        // to re-derive shape from a default-laden producer payload.
        meta: {
          genres: producerRow.genres ?? null,
          releasedSummary: producerRow.releasedSummary,
          streamsSummary: producerRow.streamsSummary,
          responseHours: producerRow.responseHours,
        },
        publicSamples: sampleRows.map((row) => ({
          id: row.id,
          title: row.title,
          artist: row.artist,
          audioUrl: row.audioUrl,
          durationMs: row.durationMs,
          peaksR2Key: row.peaksR2Key,
        })),
        externalLinks: externalLinkRows.map((row) => ({
          id: row.id,
          platform: row.platform,
          url: row.url,
          title: row.title,
          position: row.position,
        })),
      };
    }),
});
