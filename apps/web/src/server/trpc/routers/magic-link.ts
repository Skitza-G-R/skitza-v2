import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { desc, eq, magicLinks, magicLinkViews, sql } from "@skitza/db";
import { z } from "zod";
import { router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { stripUndefined } from "../strip-undefined";
import { issueMagicToken } from "~/lib/magic-links/token";
import { checkRateLimit } from "~/lib/rate-limit/in-memory";

// Per-producer issue cap. Real producers issue a few links a day; >20
// per minute is either a bug or abuse. The limiter is in-memory so this
// is best-effort per container — cross-instance limiting lands when we
// move to Upstash (Phase 2). For now the cap catches scripted loops.
const ISSUE_LIMIT = 20;
const ISSUE_WINDOW_MS = 60_000;

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

// Per-link view detail input — callers identify the link by its ID
// (which is already public-visible in the dashboard table).
const ViewsInput = z.object({ id: z.string().uuid() });

export const magicLinkRouter = router({
  issue: producerProcedure
    .input(IssueInput)
    .mutation(async ({ ctx, input }) => {
      // Rate limit per producer. Raises TOO_MANY_REQUESTS (mapped to a
      // user-readable error in the Server Action). See comment on
      // ISSUE_LIMIT above for rationale.
      const rl = checkRateLimit(`issue:${ctx.producerId}`, ISSUE_LIMIT, ISSUE_WINDOW_MS);
      if (!rl.ok) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Slow down — try again in ${String(Math.ceil(rl.resetMs / 1000))}s.`,
        });
      }

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
    //
    // Neon's pg driver parses non-aggregate timestamptz columns into
    // Date, but `MAX(timestamptz)` inside a raw `sql` template comes
    // back as an ISO string. Coerce at the edge so consumers can rely
    // on the declared `Date | null` return type.
    const rows = await ctx.db
      .select({
        id: magicLinks.id,
        target: magicLinks.target,
        leadId: magicLinks.leadId,
        expiresAt: magicLinks.expiresAt,
        revokedAt: magicLinks.revokedAt,
        createdAt: magicLinks.createdAt,
        lastViewedAt: sql<Date | string | null>`max(${magicLinkViews.viewedAt})`,
      })
      .from(magicLinks)
      .leftJoin(magicLinkViews, eq(magicLinkViews.magicLinkId, magicLinks.id))
      .where(eq(magicLinks.producerId, ctx.producerId))
      .groupBy(magicLinks.id)
      .orderBy(desc(magicLinks.createdAt));
    return rows.map((r) => ({
      ...r,
      lastViewedAt: r.lastViewedAt == null ? null : new Date(r.lastViewedAt),
    }));
  }),

  analytics: producerProcedure.query(async ({ ctx }) => {
    // Single LEFT JOIN aggregation — one row per link, including links
    // with zero views. Notes:
    // - COUNT(views.id) (not COUNT(*)) so unmatched LEFT JOIN rows
    //   yield 0, not 1.
    // - Both COUNT and PERCENTILE_CONT are cast to ::int for the same
    //   reason: COUNT returns bigint and PERCENTILE_CONT returns
    //   double precision, either of which the pg driver may hand back
    //   as a string; the cast keeps the wire type a JS number. Safe
    //   here because a single producer's view tally won't exceed 2^31,
    //   and dwell_ms is stored as integer milliseconds (sub-ms median
    //   precision is noise — rounding is lossless).
    // - PERCENTILE_CONT(0.5) is the only ordered-set aggregate that
    //   gives true median (AVG would be skewed by a few long tails);
    //   over an empty set it returns NULL, which we propagate as-is so
    //   the UI can distinguish "no data" from "0ms".
    // - GROUP BY just magicLinks.id — PG infers the rest of the
    //   selected magic_links columns via PK functional dependency.
    // Same MAX(timestamptz)-returns-string quirk as magicLink.list —
    // coerce lastViewedAt at the edge.
    const rows = await ctx.db
      .select({
        id: magicLinks.id,
        viewCount: sql<number>`count(${magicLinkViews.id})::int`,
        lastViewedAt: sql<Date | string | null>`max(${magicLinkViews.viewedAt})`,
        medianDwellMs: sql<number | null>`percentile_cont(0.5) within group (order by ${magicLinkViews.dwellMs})::int`,
      })
      .from(magicLinks)
      .leftJoin(magicLinkViews, eq(magicLinkViews.magicLinkId, magicLinks.id))
      .where(eq(magicLinks.producerId, ctx.producerId))
      .groupBy(magicLinks.id)
      .orderBy(desc(magicLinks.createdAt));
    return rows.map((r) => ({
      ...r,
      lastViewedAt: r.lastViewedAt == null ? null : new Date(r.lastViewedAt),
    }));
  }),

  // Detail view: one magic_link + its full view timeline. Scoped to
  // the caller's producer (cross-tenant drill-in returns NOT_FOUND, not
  // FORBIDDEN — we prefer not to confirm existence of another
  // producer's link IDs even to an authenticated caller).
  detail: producerProcedure.input(ViewsInput).query(async ({ ctx, input }) => {
    const [link] = await ctx.db
      .select()
      .from(magicLinks)
      .where(eq(magicLinks.id, input.id))
      .limit(1);
    if (!link || link.producerId !== ctx.producerId) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    // Views ordered newest-first so the most recent open is at the top
    // of the timeline. Cap at 200 — dashboards don't benefit from
    // infinite scroll in v1, and the producer can tell their top lead
    // by looking at the top row.
    const views = await ctx.db
      .select()
      .from(magicLinkViews)
      .where(eq(magicLinkViews.magicLinkId, input.id))
      .orderBy(desc(magicLinkViews.viewedAt))
      .limit(200);
    return {
      link: stripTokenHash(link),
      views: views.map((v) => ({
        id: v.id,
        ip: v.ip,
        userAgent: v.userAgent,
        referer: v.referer,
        dwellMs: v.dwellMs,
        viewedAt: v.viewedAt,
      })),
    };
  }),

  // "Recent opens" feed across ALL of the caller's links — shown on
  // the dashboard overview so producers see fresh activity without
  // drilling into a single link. Same tenant-scoping as analytics.
  recentViews: producerProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: magicLinkViews.id,
        magicLinkId: magicLinkViews.magicLinkId,
        target: magicLinks.target,
        viewedAt: magicLinkViews.viewedAt,
        dwellMs: magicLinkViews.dwellMs,
        referer: magicLinkViews.referer,
      })
      .from(magicLinkViews)
      .innerJoin(magicLinks, eq(magicLinks.id, magicLinkViews.magicLinkId))
      .where(eq(magicLinks.producerId, ctx.producerId))
      .orderBy(desc(magicLinkViews.viewedAt))
      .limit(10);
    return rows;
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
