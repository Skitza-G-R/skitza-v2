import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { desc, eq, magicLinks, magicLinkViews, sql } from "@skitza/db";
import { z } from "zod";
import { router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { stripUndefined } from "../strip-undefined";
import { issueMagicToken } from "~/lib/magic-links/token";

// `target` is `text` in the DB (forward-compat for "project:<uuid>"),
// but the router gates the input to the only two values v1 supports.
// Widen the enum here when a new target ships, never accept arbitrary
// strings — the column is unindexed and tenants could fingerprint it.
const TargetEnum = z.enum(["portfolio", "booking"]);

// Cap ttlHours at 720 (30 days) to defend against Number.MAX_SAFE_INTEGER
// overflowing into ttlSeconds inside `issueMagicToken` (would also blow
// past the timestamp column's representable range).
const IssueInput = z.object({
  leadId: z.string().uuid().optional(),
  target: TargetEnum,
  ttlHours: z.number().int().min(1).max(720),
});

// `tokenHash` must never reach the wire — the raw token is already in
// the URL the caller receives, so the hash adds no value to the client
// and would help an attacker correlate DB-leaked rows back to URLs.
type MagicLinkPublic = Omit<typeof magicLinks.$inferSelect, "tokenHash">;
const stripTokenHash = (row: typeof magicLinks.$inferSelect): MagicLinkPublic => {
  // Build a fresh object explicitly rather than `delete row.tokenHash`
  // (would mutate the drizzle row) or destructure-and-discard (linted
  // as unused-var). Listing every column makes the public surface
  // grep-able when the schema grows.
  return {
    id: row.id,
    producerId: row.producerId,
    leadId: row.leadId,
    target: row.target,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
};

export const magicLinkRouter = router({
  issue: producerProcedure
    .input(IssueInput)
    .mutation(async ({ ctx, input }) => {
      const siteUrlRaw = process.env.SITE_URL;
      if (!siteUrlRaw) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "missing SITE_URL" });
      }
      // Strip a single trailing slash defensively so the resulting URL
      // never has `//m/<token>` (some hosts/proxies silently rewrite,
      // others 404). One slash only — anything else is an operator typo
      // we'd rather surface than paper over.
      const siteUrl = siteUrlRaw.endsWith("/") ? siteUrlRaw.slice(0, -1) : siteUrlRaw;

      const ttlSeconds = input.ttlHours * 3600;
      const token = issueMagicToken({
        producerId: ctx.producerId,
        target: input.target,
        ttlSeconds,
        ...(input.leadId === undefined ? {} : { context: { leadId: input.leadId } }),
      });
      // hex (not base64url) — human-readable in psql/drizzle-studio
      // when debugging which row a leaked URL corresponds to.
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

      const [row] = await ctx.db
        .insert(magicLinks)
        .values(
          stripUndefined({
            producerId: ctx.producerId,
            leadId: input.leadId,
            target: input.target,
            tokenHash,
            expiresAt,
          }),
        )
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return { url: `${siteUrl}/m/${token}`, link: stripTokenHash(row) };
    }),

  list: producerProcedure.query(async ({ ctx }) => {
    // LEFT JOIN + max(viewedAt) so links with zero views still appear
    // (their lastViewedAt comes back as null). GROUP BY the link's
    // primary key so the projected non-aggregated columns are legal.
    return ctx.db
      .select({
        id: magicLinks.id,
        target: magicLinks.target,
        leadId: magicLinks.leadId,
        expiresAt: magicLinks.expiresAt,
        revokedAt: magicLinks.revokedAt,
        createdAt: magicLinks.createdAt,
        lastViewedAt: sql<Date | null>`max(${magicLinkViews.viewedAt})`,
      })
      .from(magicLinks)
      .leftJoin(magicLinkViews, eq(magicLinkViews.magicLinkId, magicLinks.id))
      .where(eq(magicLinks.producerId, ctx.producerId))
      .groupBy(magicLinks.id)
      .orderBy(desc(magicLinks.createdAt));
  }),

  analytics: producerProcedure.query(async ({ ctx }) => {
    // Single LEFT JOIN aggregation — one row per link, including links
    // with zero views. Notes:
    // - COUNT(views.id) (not COUNT(*)) so unmatched LEFT JOIN rows
    //   yield 0, not 1.
    // - COUNT returns bigint, which the pg driver hands back as a
    //   string; ::int cast keeps the wire type a JS number (safe — a
    //   single producer's view tally won't exceed 2^31).
    // - PERCENTILE_CONT(0.5) is the only ordered-set aggregate that
    //   gives true median (AVG would be skewed by a few long tails);
    //   over an empty set it returns NULL, which we propagate as-is so
    //   the UI can distinguish "no data" from "0ms".
    // - GROUP BY just magicLinks.id — PG infers the rest of the
    //   selected magic_links columns via PK functional dependency.
    //   (None are selected here, but the same rule lets us add them
    //   later without touching GROUP BY.)
    return ctx.db
      .select({
        id: magicLinks.id,
        viewCount: sql<number>`count(${magicLinkViews.id})::int`,
        lastViewedAt: sql<Date | null>`max(${magicLinkViews.viewedAt})`,
        medianDwellMs: sql<number | null>`percentile_cont(0.5) within group (order by ${magicLinkViews.dwellMs})`,
      })
      .from(magicLinks)
      .leftJoin(magicLinkViews, eq(magicLinkViews.magicLinkId, magicLinks.id))
      .where(eq(magicLinks.producerId, ctx.producerId))
      .groupBy(magicLinks.id)
      .orderBy(desc(magicLinks.createdAt));
  }),

  revoke: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Two-step load → verify ownership → update — same pattern as
      // portfolio.update/delete. Single-statement UPDATE WHERE
      // producer_id = ... would conflate not-found vs not-yours.
      const [existing] = await ctx.db
        .select()
        .from(magicLinks)
        .where(eq(magicLinks.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.producerId !== ctx.producerId) throw new TRPCError({ code: "FORBIDDEN" });
      // Already revoked: return the existing row untouched so
      // `revokedAt` keeps its original timestamp (the *first* revoke
      // is the authoritative one — re-revoking is a no-op, not a fresh
      // event).
      if (existing.revokedAt !== null) return stripTokenHash(existing);

      const [updated] = await ctx.db
        .update(magicLinks)
        .set({ revokedAt: new Date() })
        .where(eq(magicLinks.id, input.id))
        .returning();
      // Existence proven above; race-deletion lands here.
      if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return stripTokenHash(updated);
    }),
});
