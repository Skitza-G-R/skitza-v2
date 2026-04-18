import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  and,
  clientContacts,
  contractRecipients,
  contracts,
  dealTracks,
  deals,
  desc,
  eq,
  inArray,
  magicLinks,
  or,
  sql,
  trackComments,
  trackVersions,
} from "@skitza/db";
import { z } from "zod";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { stripUndefined } from "../strip-undefined";
import { issueMagicToken } from "~/lib/magic-links/token";

// Producer-scoped client CRM.
//
// Grew from a read-only autocomplete feed in C.5 into the full CRUD
// surface that backs /dashboard/clients (G.2). The contact row is
// still the same `client_contacts` table — we just add create/edit/
// delete and an enriched list + detail with per-client aggregates.
//
// Aggregates match against BOTH deals.clientEmail AND deals.artistEmail
// so legacy deals (pre-C.2, when only artistEmail was set) still attach
// to their contact. If a producer later renames a client's email, the
// older deals continue to show up because we compare on email strings,
// not contact IDs.

const TargetEnum = z.enum(["portfolio", "booking"]);

// Matches the linking logic used in every aggregate below — keep in
// sync if we ever add a third email column on deals.
function emailMatchesDeal(email: string) {
  return or(eq(deals.clientEmail, email), eq(deals.artistEmail, email));
}

// Normalize + hash an email the same way recordContact does so the
// dedupe key is stable across every surface that upserts a contact.
function hashEmail(raw: string): { lower: string; hash: string } {
  const lower = raw.trim().toLowerCase();
  return { lower, hash: createHash("sha256").update(lower).digest("hex") };
}

export const clientContactsRouter = router({
  // Read: autocomplete + simple listing. Kept backwards-compatible with
  // the C.5 shape (id/email/name/lastSeenAt only); list enrichment lives
  // on `listWithMeta` so callers that only need the lightweight list
  // don't pay for the aggregates.
  list: producerProcedure
    .input(z.object({ q: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: clientContacts.id,
          email: clientContacts.email,
          name: clientContacts.name,
          lastSeenAt: clientContacts.lastSeenAt,
        })
        .from(clientContacts)
        .where(eq(clientContacts.producerId, ctx.producerId))
        .orderBy(desc(clientContacts.lastSeenAt));

      const q = input?.q?.trim().toLowerCase();
      if (!q) return rows;
      return rows.filter(
        (r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q),
      );
    }),

  // Enriched list for the CRM view. One round-trip for contacts plus
  // one grouped aggregate over deals. N+1 avoided by building a map
  // keyed on lowercased email and looking up each contact in JS.
  listWithMeta: producerProcedure.query(async ({ ctx }) => {
    const contacts = await ctx.db
      .select({
        id: clientContacts.id,
        email: clientContacts.email,
        name: clientContacts.name,
        firstSeenAt: clientContacts.firstSeenAt,
        lastSeenAt: clientContacts.lastSeenAt,
      })
      .from(clientContacts)
      .where(eq(clientContacts.producerId, ctx.producerId))
      .orderBy(desc(clientContacts.lastSeenAt));

    // Aggregate deals by the canonical email pair. Scope to producer so
    // we can safely group by the email expression without worrying
    // about cross-tenant leakage. Compare on LOWER(email) so casing
    // mismatches from legacy rows still join. We compute both active
    // and total counts in one pass using FILTER.
    const dealAgg = await ctx.db
      .select({
        clientEmail: sql<string | null>`lower(${deals.clientEmail})`,
        artistEmail: sql<string | null>`lower(${deals.artistEmail})`,
        totalDeals: sql<number>`count(*)::int`,
        activeDeals: sql<number>`count(*) filter (where ${deals.stage} not in ('paid','archived'))::int`,
        lastActivity: sql<Date | string | null>`max(${deals.updatedAt})`,
      })
      .from(deals)
      .where(eq(deals.producerId, ctx.producerId))
      .groupBy(sql`lower(${deals.clientEmail})`, sql`lower(${deals.artistEmail})`);

    const agg = new Map<
      string,
      { active: number; total: number; lastActivity: Date | null }
    >();
    for (const row of dealAgg) {
      const lastAct =
        row.lastActivity == null
          ? null
          : row.lastActivity instanceof Date
            ? row.lastActivity
            : new Date(row.lastActivity);
      for (const em of [row.clientEmail, row.artistEmail]) {
        if (!em) continue;
        const prev = agg.get(em);
        if (!prev) {
          agg.set(em, { active: row.activeDeals, total: row.totalDeals, lastActivity: lastAct });
        } else {
          agg.set(em, {
            active: prev.active + row.activeDeals,
            total: prev.total + row.totalDeals,
            lastActivity:
              prev.lastActivity && lastAct
                ? prev.lastActivity > lastAct
                  ? prev.lastActivity
                  : lastAct
                : (prev.lastActivity ?? lastAct),
          });
        }
      }
    }

    return contacts.map((c) => {
      const meta = agg.get(c.email.toLowerCase()) ?? {
        active: 0,
        total: 0,
        lastActivity: null,
      };
      // Fall back to lastSeenAt on the contact itself when no deal has
      // ever been linked (manually added client). Keeps the "Last
      // activity" column useful day-one.
      return {
        ...c,
        activeDealCount: meta.active,
        totalDealCount: meta.total,
        lastActivity: meta.lastActivity ?? c.lastSeenAt,
      };
    });
  }),

  // Manually add a client. Idempotent-by-email: if a row already exists
  // for this (producer, emailHash) we return it with `existed: true`
  // so the UI can direct the producer to the existing contact page
  // instead of surfacing a raw constraint error.
  create: producerProcedure
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { lower, hash } = hashEmail(input.email);
      const [existing] = await ctx.db
        .select()
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.producerId, ctx.producerId),
            eq(clientContacts.emailHash, hash),
          ),
        )
        .limit(1);
      if (existing) {
        return {
          id: existing.id,
          email: existing.email,
          name: existing.name,
          existed: true as const,
        };
      }
      const now = new Date();
      const [row] = await ctx.db
        .insert(clientContacts)
        .values({
          producerId: ctx.producerId,
          emailHash: hash,
          email: lower,
          name: input.name.trim(),
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return {
        id: row.id,
        email: row.email,
        name: row.name,
        existed: false as const,
      };
    }),

  // Edit name/email. If email changes we rehash and guard against
  // colliding with another row in the same producer — returning
  // CONFLICT so the UI can offer to open the other contact.
  update: producerProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(200).optional(),
        email: z.string().email().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.id, input.id))
        .limit(1);
      if (!existing || existing.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const patch: { name?: string; email?: string; emailHash?: string } = {};
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.email !== undefined) {
        const { lower, hash } = hashEmail(input.email);
        if (hash !== existing.emailHash) {
          const [clash] = await ctx.db
            .select({ id: clientContacts.id })
            .from(clientContacts)
            .where(
              and(
                eq(clientContacts.producerId, ctx.producerId),
                eq(clientContacts.emailHash, hash),
              ),
            )
            .limit(1);
          if (clash) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A client with that email already exists.",
            });
          }
          patch.email = lower;
          patch.emailHash = hash;
        }
      }
      if (Object.keys(patch).length === 0) {
        return {
          id: existing.id,
          email: existing.email,
          name: existing.name,
        };
      }
      const [row] = await ctx.db
        .update(clientContacts)
        .set(stripUndefined(patch))
        .where(eq(clientContacts.id, input.id))
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return { id: row.id, email: row.email, name: row.name };
    }),

  // Delete a contact. Deals/contracts/comments linked via email stay
  // in place — this is purely a CRM entry removal. The contact may
  // auto-recreate next time the same artist books or comments.
  remove: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ producerId: clientContacts.producerId })
        .from(clientContacts)
        .where(eq(clientContacts.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db.delete(clientContacts).where(eq(clientContacts.id, input.id));
      return { ok: true as const };
    }),

  // Detailed view — contact + linked deals + contracts + recent
  // comments. Consumed by /dashboard/clients/[id].
  detail: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [contact] = await ctx.db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.id, input.id))
        .limit(1);
      if (!contact || contact.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const lower = contact.email.toLowerCase();

      // Deals for this client — by either email column. Producer-scoped
      // so the OR stays tenant-safe.
      const dealRows = await ctx.db
        .select({
          id: deals.id,
          title: deals.title,
          stage: deals.stage,
          createdAt: deals.createdAt,
          updatedAt: deals.updatedAt,
          depositPaid: deals.depositPaid,
          finalPaid: deals.finalPaid,
        })
        .from(deals)
        .where(and(eq(deals.producerId, ctx.producerId), emailMatchesDeal(lower)))
        .orderBy(desc(deals.updatedAt));

      const dealIds = dealRows.map((d) => d.id);

      // Track count: count of track_versions across this client's deals.
      let trackCount = 0;
      if (dealIds.length > 0) {
        const [row] = await ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(trackVersions)
          .innerJoin(dealTracks, eq(dealTracks.id, trackVersions.trackId))
          .where(inArray(dealTracks.dealId, dealIds));
        trackCount = row?.n ?? 0;
      }

      // Contracts sent to this email (via contract_recipients).
      const contractRows = await ctx.db
        .select({
          id: contracts.id,
          title: contracts.title,
          status: contracts.status,
          createdAt: contracts.createdAt,
          sentAt: contracts.sentAt,
          signedAt: contracts.signedAt,
        })
        .from(contracts)
        .innerJoin(contractRecipients, eq(contractRecipients.contractId, contracts.id))
        .where(
          and(
            eq(contracts.producerId, ctx.producerId),
            sql`lower(${contractRecipients.email}) = ${lower}`,
          ),
        )
        .orderBy(desc(contracts.createdAt));

      // Recent comments by this email — scoped to this producer's
      // versions via the deal join (defense-in-depth). Limit 20 — the
      // timeline renders the latest chunk; "load more" can ship later.
      const commentRows =
        dealIds.length > 0
          ? await ctx.db
              .select({
                id: trackComments.id,
                versionId: trackComments.versionId,
                trackId: dealTracks.id,
                dealId: dealTracks.dealId,
                body: trackComments.body,
                timestampMs: trackComments.timestampMs,
                createdAt: trackComments.createdAt,
                fromProducer: trackComments.fromProducer,
              })
              .from(trackComments)
              .innerJoin(trackVersions, eq(trackVersions.id, trackComments.versionId))
              .innerJoin(dealTracks, eq(dealTracks.id, trackVersions.trackId))
              .where(
                and(
                  inArray(dealTracks.dealId, dealIds),
                  sql`lower(${trackComments.authorEmail}) = ${lower}`,
                ),
              )
              .orderBy(desc(trackComments.createdAt))
              .limit(20)
          : [];

      const activeDealCount = dealRows.filter(
        (d) => d.stage !== "paid" && d.stage !== "archived",
      ).length;
      const lastActivity = dealRows[0]?.updatedAt ?? contact.lastSeenAt;

      return {
        contact: {
          id: contact.id,
          email: contact.email,
          name: contact.name,
          firstSeenAt: contact.firstSeenAt,
          lastSeenAt: contact.lastSeenAt,
        },
        stats: {
          activeDealCount,
          totalDealCount: dealRows.length,
          trackCount,
          lastActivity,
        },
        deals: dealRows,
        contracts: contractRows,
        comments: commentRows,
      };
    }),

  // Mint a magic link for this client. Same discipline as
  // magicLink.issue (raw token returned once, only hash persisted) —
  // we inline the minting rather than calling into the other router
  // so we can return a fresh `url` shape tailored for the CRM UI.
  sendMagicLink: producerProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        target: TargetEnum.default("booking"),
        ttlHours: z.number().int().min(1).max(720).default(168),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [contact] = await ctx.db
        .select({ id: clientContacts.id, producerId: clientContacts.producerId })
        .from(clientContacts)
        .where(eq(clientContacts.id, input.id))
        .limit(1);
      if (!contact || contact.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const siteUrlRaw = process.env.SITE_URL;
      if (!siteUrlRaw) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "missing SITE_URL" });
      }
      const siteUrl = siteUrlRaw.endsWith("/") ? siteUrlRaw.slice(0, -1) : siteUrlRaw;

      const ttlSeconds = input.ttlHours * 3600;
      const token = issueMagicToken({
        producerId: ctx.producerId,
        target: input.target,
        ttlSeconds,
      });
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

      const [row] = await ctx.db
        .insert(magicLinks)
        .values({
          producerId: ctx.producerId,
          target: input.target,
          tokenHash,
          expiresAt,
        })
        .returning({ id: magicLinks.id, expiresAt: magicLinks.expiresAt });
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return {
        url: `${siteUrl}/m/${token}`,
        linkId: row.id,
        target: input.target,
        expiresAt: row.expiresAt,
      };
    }),
});
