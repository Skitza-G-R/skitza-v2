import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  and,
  clientContacts,
  contractRecipients,
  contracts,
  projectTracks,
  projects,
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
// Read-only autocomplete feed grew into the full CRUD surface that
// backs /dashboard/clients. Aggregates match against BOTH
// projects.clientEmail AND projects.artistEmail so legacy projects
// (when only artistEmail was set) still attach to their contact. If a
// producer later renames a client's email, the older projects continue
// to show up because we compare on email strings, not contact IDs.

const TargetEnum = z.enum(["portfolio", "booking"]);

function emailMatchesProject(email: string) {
  return or(eq(projects.clientEmail, email), eq(projects.artistEmail, email));
}

function hashEmail(raw: string): { lower: string; hash: string } {
  const lower = raw.trim().toLowerCase();
  return { lower, hash: createHash("sha256").update(lower).digest("hex") };
}

export const clientContactsRouter = router({
  // Read: autocomplete + simple listing.
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
  // one grouped aggregate over projects. N+1 avoided by building a map
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

    const projectAgg = await ctx.db
      .select({
        clientEmail: sql<string | null>`lower(${projects.clientEmail})`,
        artistEmail: sql<string | null>`lower(${projects.artistEmail})`,
        totalProjects: sql<number>`count(*)::int`,
        activeProjects: sql<number>`count(*) filter (where ${projects.stage} not in ('paid','archived'))::int`,
        lastActivity: sql<Date | string | null>`max(${projects.updatedAt})`,
      })
      .from(projects)
      .where(eq(projects.producerId, ctx.producerId))
      .groupBy(sql`lower(${projects.clientEmail})`, sql`lower(${projects.artistEmail})`);

    const agg = new Map<
      string,
      { active: number; total: number; lastActivity: Date | null }
    >();
    for (const row of projectAgg) {
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
          agg.set(em, { active: row.activeProjects, total: row.totalProjects, lastActivity: lastAct });
        } else {
          agg.set(em, {
            active: prev.active + row.activeProjects,
            total: prev.total + row.totalProjects,
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
      return {
        ...c,
        activeProjectCount: meta.active,
        totalProjectCount: meta.total,
        lastActivity: meta.lastActivity ?? c.lastSeenAt,
      };
    });
  }),

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

  // Delete a contact. Projects/contracts/comments linked via email
  // stay in place — this is purely a CRM entry removal.
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

  // Detailed view — contact + linked projects + contracts + recent
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

      const projectRows = await ctx.db
        .select({
          id: projects.id,
          title: projects.title,
          stage: projects.stage,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          depositPaid: projects.depositPaid,
          finalPaid: projects.finalPaid,
        })
        .from(projects)
        .where(and(eq(projects.producerId, ctx.producerId), emailMatchesProject(lower)))
        .orderBy(desc(projects.updatedAt));

      const projectIds = projectRows.map((d) => d.id);

      let trackCount = 0;
      if (projectIds.length > 0) {
        const [row] = await ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(trackVersions)
          .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
          .where(inArray(projectTracks.projectId, projectIds));
        trackCount = row?.n ?? 0;
      }

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

      const commentRows =
        projectIds.length > 0
          ? await ctx.db
              .select({
                id: trackComments.id,
                versionId: trackComments.versionId,
                trackId: projectTracks.id,
                projectId: projectTracks.projectId,
                body: trackComments.body,
                timestampMs: trackComments.timestampMs,
                createdAt: trackComments.createdAt,
                fromProducer: trackComments.fromProducer,
              })
              .from(trackComments)
              .innerJoin(trackVersions, eq(trackVersions.id, trackComments.versionId))
              .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
              .where(
                and(
                  inArray(projectTracks.projectId, projectIds),
                  sql`lower(${trackComments.authorEmail}) = ${lower}`,
                ),
              )
              .orderBy(desc(trackComments.createdAt))
              .limit(20)
          : [];

      const activeProjectCount = projectRows.filter(
        (d) => d.stage !== "paid" && d.stage !== "archived",
      ).length;
      const lastActivity = projectRows[0]?.updatedAt ?? contact.lastSeenAt;

      return {
        contact: {
          id: contact.id,
          email: contact.email,
          name: contact.name,
          firstSeenAt: contact.firstSeenAt,
          lastSeenAt: contact.lastSeenAt,
        },
        stats: {
          activeProjectCount,
          totalProjectCount: projectRows.length,
          trackCount,
          lastActivity,
        },
        projects: projectRows,
        contracts: contractRows,
        comments: commentRows,
      };
    }),

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
