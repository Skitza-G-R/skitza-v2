import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  and,
  bookings,
  clientContacts,
  contractRecipients,
  contracts,
  products,
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

  // Phase H.2 — enriched CRM list with two "modes":
  //   view = "by-client"     → one row per contact with aggregate stats
  //   view = "all-projects"  → one row per project, with its client
  //
  // Both modes share the same per-project-package-price join so the
  // outstanding balance + lifetime value numbers stay consistent across
  // views. Outstanding = sum(priceCents) for projects where the package
  // price is known AND the final hasn't been paid AND stage isn't
  // archived. Lifetime = sum(priceCents) for projects where finalPaid
  // is true. Projects with no booking/package contribute 0.
  listWithProjects: producerProcedure
    .input(
      z
        .object({ view: z.enum(["by-client", "all-projects"]).optional() })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const view = input?.view ?? "by-client";

      // One per-project row enriched with product price + last comment
      // time. Uses `max(bookings.product_id)` + `max(products.price_cents)`
      // to collapse the many-to-one booking→product join safely; in
      // practice a project has ≤ 1 booking attached via bookings.project_id.
      const projectRows = await ctx.db
        .select({
          id: projects.id,
          title: projects.title,
          stage: projects.stage,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          clientName: projects.clientName,
          clientEmail: sql<string | null>`lower(${projects.clientEmail})`,
          artistName: projects.artistName,
          artistEmail: sql<string>`lower(${projects.artistEmail})`,
          depositPaid: projects.depositPaid,
          finalPaid: projects.finalPaid,
          priceCents: sql<number | null>`max(${products.priceCents})`,
          currency: sql<string | null>`max(${products.currency})`,
          nextSessionAt: sql<
            Date | string | null
          >`min(case when ${bookings.startsAt} > now() and ${bookings.status} = 'confirmed' then ${bookings.startsAt} end)`,
        })
        .from(projects)
        .leftJoin(bookings, eq(bookings.projectId, projects.id))
        .leftJoin(products, eq(products.id, bookings.productId))
        .where(eq(projects.producerId, ctx.producerId))
        .groupBy(projects.id)
        .orderBy(desc(projects.updatedAt));

      // Pre-compute last-comment timestamp + unresolved count per
      // project email (artistEmail/clientEmail) via a single aggregate.
      const commentAgg = await ctx.db
        .select({
          projectId: projectTracks.projectId,
          lastComment: sql<Date | string | null>`max(${trackComments.createdAt})`,
          unresolved: sql<number>`count(*) filter (where ${trackComments.resolvedAt} is null and ${trackComments.fromProducer} = false)::int`,
        })
        .from(trackComments)
        .innerJoin(trackVersions, eq(trackVersions.id, trackComments.versionId))
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .where(eq(projects.producerId, ctx.producerId))
        .groupBy(projectTracks.projectId);

      const commentMap = new Map<
        string,
        { lastComment: Date | null; unresolved: number }
      >();
      for (const row of commentAgg) {
        const lc =
          row.lastComment == null
            ? null
            : row.lastComment instanceof Date
              ? row.lastComment
              : new Date(row.lastComment);
        commentMap.set(row.projectId, { lastComment: lc, unresolved: row.unresolved });
      }

      // Shape: decorate each project with lastActivity (max of
      // updatedAt / lastComment) + the outstandingCents for itself.
      const enriched = projectRows.map((p) => {
        const cm = commentMap.get(p.id) ?? { lastComment: null, unresolved: 0 };
        const updatedAt = p.updatedAt instanceof Date ? p.updatedAt : new Date(p.updatedAt);
        const lastActivity =
          cm.lastComment && cm.lastComment > updatedAt ? cm.lastComment : updatedAt;
        const nextSessionAt =
          p.nextSessionAt == null
            ? null
            : p.nextSessionAt instanceof Date
              ? p.nextSessionAt
              : new Date(p.nextSessionAt);
        const price = p.priceCents ?? 0;
        const isActive = p.stage !== "paid" && p.stage !== "archived";
        const outstanding = p.finalPaid || p.stage === "archived" ? 0 : price;
        const lifetime = p.finalPaid ? price : 0;
        return {
          id: p.id,
          title: p.title,
          stage: p.stage,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          clientName: p.clientName,
          clientEmail: p.clientEmail ?? p.artistEmail,
          artistName: p.artistName,
          artistEmail: p.artistEmail,
          depositPaid: p.depositPaid,
          finalPaid: p.finalPaid,
          priceCents: price,
          currency: p.currency ?? "USD",
          outstandingCents: outstanding,
          lifetimeCents: lifetime,
          nextSessionAt,
          lastActivity,
          unresolvedComments: cm.unresolved,
          isActive,
        };
      });

      if (view === "all-projects") {
        // Flat list shape. For each project, look up the contact by
        // lowercased email. If none found (legacy rows) return a stub
        // so the UI still renders a row.
        const contacts = await ctx.db
          .select({
            id: clientContacts.id,
            email: clientContacts.email,
            name: clientContacts.name,
            tags: clientContacts.tags,
          })
          .from(clientContacts)
          .where(eq(clientContacts.producerId, ctx.producerId));
        const contactByEmail = new Map<
          string,
          { id: string; email: string; name: string; tags: string[] | null }
        >();
        for (const c of contacts) {
          contactByEmail.set(c.email.toLowerCase(), {
            id: c.id,
            email: c.email,
            name: c.name,
            tags: c.tags,
          });
        }
        return {
          view: "all-projects" as const,
          projects: enriched.map((p) => {
            const matchEmail = p.clientEmail.toLowerCase();
            const ct = contactByEmail.get(matchEmail) ?? null;
            return {
              ...p,
              client: ct
                ? {
                    id: ct.id,
                    email: ct.email,
                    name: ct.name,
                    tags: ct.tags,
                  }
                : {
                    id: null,
                    email: p.clientEmail,
                    name: p.clientName ?? p.artistName,
                    tags: null as string[] | null,
                  },
            };
          }),
        };
      }

      // view === "by-client" — fold projects into their contact.
      const contacts = await ctx.db
        .select({
          id: clientContacts.id,
          email: clientContacts.email,
          name: clientContacts.name,
          firstSeenAt: clientContacts.firstSeenAt,
          lastSeenAt: clientContacts.lastSeenAt,
          tags: clientContacts.tags,
          notes: clientContacts.notes,
          referralSource: clientContacts.referralSource,
        })
        .from(clientContacts)
        .where(eq(clientContacts.producerId, ctx.producerId))
        .orderBy(desc(clientContacts.lastSeenAt));

      type Agg = {
        active: number;
        total: number;
        outstanding: number;
        lifetime: number;
        lastActivity: Date | null;
        unresolved: number;
        hasActive: boolean;
        hasOutstanding: boolean;
      };
      const byEmail = new Map<string, Agg>();
      function ensure(email: string): Agg {
        const existing = byEmail.get(email);
        if (existing) return existing;
        const fresh: Agg = {
          active: 0,
          total: 0,
          outstanding: 0,
          lifetime: 0,
          lastActivity: null,
          unresolved: 0,
          hasActive: false,
          hasOutstanding: false,
        };
        byEmail.set(email, fresh);
        return fresh;
      }
      for (const p of enriched) {
        const la = p.lastActivity instanceof Date ? p.lastActivity : new Date(p.lastActivity);
        for (const em of new Set(
          [p.clientEmail, p.artistEmail].filter((e): e is string => Boolean(e)).map((e) => e.toLowerCase()),
        )) {
          const a = ensure(em);
          a.total += 1;
          if (p.isActive) {
            a.active += 1;
            a.hasActive = true;
          }
          a.outstanding += p.outstandingCents;
          a.lifetime += p.lifetimeCents;
          a.unresolved += p.unresolvedComments;
          if (p.outstandingCents > 0) a.hasOutstanding = true;
          if (!a.lastActivity || la > a.lastActivity) a.lastActivity = la;
        }
      }

      const rows = contacts.map((c) => {
        const agg = byEmail.get(c.email.toLowerCase()) ?? {
          active: 0,
          total: 0,
          outstanding: 0,
          lifetime: 0,
          lastActivity: null,
          unresolved: 0,
          hasActive: false,
          hasOutstanding: false,
        };
        const lastActivity =
          agg.lastActivity ??
          (c.lastSeenAt instanceof Date ? c.lastSeenAt : new Date(c.lastSeenAt));
        // "Needs attention" heuristic — anything a producer would want
        // to look at first thing in the morning.
        const now = Date.now();
        const staleMs = 90 * 24 * 60 * 60 * 1000; // 90 days
        const isStale =
          agg.total === 0
            ? now - (c.lastSeenAt instanceof Date ? c.lastSeenAt : new Date(c.lastSeenAt)).getTime() > staleMs
            : false;
        const needsAttention =
          agg.unresolved > 0 || (agg.hasOutstanding && agg.active > 0);
        return {
          id: c.id,
          email: c.email,
          name: c.name,
          firstSeenAt: c.firstSeenAt,
          lastSeenAt: c.lastSeenAt,
          tags: c.tags,
          notes: c.notes,
          referralSource: c.referralSource,
          activeProjectCount: agg.active,
          totalProjectCount: agg.total,
          outstandingCents: agg.outstanding,
          lifetimeCents: agg.lifetime,
          unresolvedComments: agg.unresolved,
          lastActivity,
          needsAttention,
          isStale,
        };
      });
      return { view: "by-client" as const, clients: rows };
    }),

  // Patch the CRM meta fields in isolation — keeps the existing
  // `update` procedure focused on name/email (which has different
  // dedupe semantics). Any subset of the three fields may be passed;
  // `undefined` means "leave unchanged", while an explicit empty array
  // or empty string clears the field.
  updateClientMeta: producerProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
        notes: z.string().max(5000).optional(),
        referralSource: z.string().max(200).optional(),
      }),
    )
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
      const patch: {
        tags?: string[] | null;
        notes?: string | null;
        referralSource?: string | null;
      } = {};
      if (input.tags !== undefined) {
        // Deduplicate case-insensitively while preserving the first
        // casing seen — producers usually type "Hip-Hop" then "hip-hop"
        // and expect one tag.
        const seen = new Set<string>();
        const cleaned: string[] = [];
        for (const t of input.tags) {
          const key = t.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          cleaned.push(t);
        }
        patch.tags = cleaned.length > 0 ? cleaned : null;
      }
      if (input.notes !== undefined) {
        const trimmed = input.notes.trim();
        patch.notes = trimmed.length > 0 ? trimmed : null;
      }
      if (input.referralSource !== undefined) {
        const trimmed = input.referralSource.trim();
        patch.referralSource = trimmed.length > 0 ? trimmed : null;
      }
      if (Object.keys(patch).length === 0) {
        return { ok: true as const, changed: false };
      }
      await ctx.db
        .update(clientContacts)
        .set(patch)
        .where(eq(clientContacts.id, input.id));
      return { ok: true as const, changed: true };
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
          priceCents: sql<number | null>`max(${products.priceCents})`,
          currency: sql<string | null>`max(${products.currency})`,
          nextSessionAt: sql<
            Date | string | null
          >`min(case when ${bookings.startsAt} > now() and ${bookings.status} = 'confirmed' then ${bookings.startsAt} end)`,
        })
        .from(projects)
        .leftJoin(bookings, eq(bookings.projectId, projects.id))
        .leftJoin(products, eq(products.id, bookings.productId))
        .where(and(eq(projects.producerId, ctx.producerId), emailMatchesProject(lower)))
        .groupBy(projects.id)
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

      // Aggregate outstanding / lifetime across this contact's
      // projects. Same rule as listWithProjects:
      //   outstanding = sum(priceCents) for projects not yet paid +
      //                 not archived (if known)
      //   lifetime    = sum(priceCents) for projects where final is paid
      let outstandingCents = 0;
      let lifetimeCents = 0;
      const enrichedProjects = projectRows.map((p) => {
        const price = p.priceCents ?? 0;
        const isArchived = p.stage === "archived";
        const isPaid = p.finalPaid;
        const outstanding = isPaid || isArchived ? 0 : price;
        const lifetime = isPaid ? price : 0;
        outstandingCents += outstanding;
        lifetimeCents += lifetime;
        return {
          ...p,
          priceCents: price,
          outstandingCents: outstanding,
          lifetimeCents: lifetime,
        };
      });

      return {
        contact: {
          id: contact.id,
          email: contact.email,
          name: contact.name,
          firstSeenAt: contact.firstSeenAt,
          lastSeenAt: contact.lastSeenAt,
          tags: contact.tags,
          notes: contact.notes,
          referralSource: contact.referralSource,
        },
        stats: {
          activeProjectCount,
          totalProjectCount: projectRows.length,
          trackCount,
          lastActivity,
          outstandingCents,
          lifetimeCents,
        },
        projects: enrichedProjects,
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
