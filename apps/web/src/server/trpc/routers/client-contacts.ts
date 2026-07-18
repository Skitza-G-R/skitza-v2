import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  bookings,
  clientContacts,
  producers,
  projectTracks,
  projects,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  trackComments,
  trackVersions,
} from "@skitza/db";
import { z } from "zod";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { emailHashFor } from "~/server/artist/identity";
import { clientManagementRepository } from "~/server/domain/client-management/db";
import {
  archiveClient,
  ClientManagementDomainError,
  editClient,
  inviteClient,
  restoreClient,
} from "~/server/domain/client-management/service";
import { clientMoneyRepository } from "~/server/domain/client-money/db";
import { ClientMoneyDomainError, getClientMoneyLedger } from "~/server/domain/client-money/service";
import { historicalDeletionRepository } from "~/server/domain/history-deletion/db";
import {
  canPermanentlyDeleteEmptyDraftClient,
  HistoricalDeletionDomainError,
  permanentlyDeleteEmptyDraftClient,
} from "~/server/domain/history-deletion/service";
import { SITE_URL, sendClientInviteEmail } from "~/server/email/send";

// Producer-scoped client CRM.
//
// Read-only autocomplete feed grew into the full CRUD surface that
// backs /dashboard/clients. Project ownership is always resolved through
// projects.clientContactId inside the authenticated producer boundary.

function hashEmail(raw: string): { lower: string; hash: string } {
  const lower = raw.trim().toLowerCase();
  return { lower, hash: emailHashFor(raw) };
}

export type ClientCommercialProjection = {
  availability: "unavailable";
  reason: "purchase_payments_projection_pending";
  currency: null;
  totalCents: null;
  outstandingCents: null;
  lifetimeCents: null;
  paidThisMonthCents: null;
};

function unavailableCommercialProjection(): ClientCommercialProjection {
  return {
    availability: "unavailable",
    reason: "purchase_payments_projection_pending",
    currency: null,
    totalCents: null,
    outstandingCents: null,
    lifetimeCents: null,
    paidThisMonthCents: null,
  };
}

function mapHistoricalDeletionDomainError(error: unknown): never {
  if (!(error instanceof HistoricalDeletionDomainError)) throw error;
  if (error.code === "NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND" });
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
}

function mapClientManagementDomainError(error: unknown): never {
  if (!(error instanceof ClientManagementDomainError)) throw error;
  if (error.code === "NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND" });
  if (error.code === "DUPLICATE_EMAIL") {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error.code === "BLOCKING_PROJECT") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
}

function mapClientMoneyDomainError(error: unknown): never {
  if (!(error instanceof ClientMoneyDomainError)) throw error;
  if (error.code === "NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND" });
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
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
        .where(
          and(
            eq(clientContacts.producerId, ctx.producerId),
            isNull(clientContacts.producerArchivedAt),
          ),
        )
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
  // Commercial totals are deliberately unavailable until the Payments work
  // defines the purchase-ledger projection. Project-row flags and invoice
  // compatibility tables are not valid commercial sources.
  listWithProjects: producerProcedure
    .input(z.object({ view: z.enum(["by-client", "all-projects"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const view = input?.view ?? "by-client";

      // One producer-scoped row per project. The clientContactId is the
      // ownership key; email snapshots below are display-only.
      const projectRows = await ctx.db
        .select({
          id: projects.id,
          title: projects.title,
          lifecycleStatus: projects.lifecycleStatus,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          clientContactId: projects.clientContactId,
          clientName: projects.clientName,
          clientEmail: projects.clientEmail,
          artistName: projects.artistName,
          artistEmail: projects.artistEmail,
          nextSessionAt: sql<
            Date | string | null
          >`min(case when ${bookings.startsAt} > now() and ${bookings.status} = 'confirmed' then ${bookings.startsAt} end)`,
        })
        .from(projects)
        .leftJoin(bookings, eq(bookings.projectId, projects.id))
        .where(eq(projects.producerId, ctx.producerId))
        .groupBy(projects.id)
        // Custom drag-to-reorder takes precedence (`position` asc).
        // For un-dragged rows (all default to position=0), fall back
        // to most-recently-updated so existing behavior is preserved.
        .orderBy(asc(projects.position), desc(projects.updatedAt));

      // Pre-compute last-comment timestamp + unresolved count per
      // producer-owned project via a single aggregate.
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

      const commentMap = new Map<string, { lastComment: Date | null; unresolved: number }>();
      for (const row of commentAgg) {
        const lc =
          row.lastComment == null
            ? null
            : row.lastComment instanceof Date
              ? row.lastComment
              : new Date(row.lastComment);
        commentMap.set(row.projectId, { lastComment: lc, unresolved: row.unresolved });
      }

      // Shape: decorate each project with lastActivity and an explicit
      // commercial projection that fails closed until purchase Payments owns
      // the ledger fold.
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
        const isActive = p.lifecycleStatus !== "completed" && p.lifecycleStatus !== "canceled";
        return {
          id: p.id,
          title: p.title,
          lifecycleStatus: p.lifecycleStatus,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          clientContactId: p.clientContactId,
          clientName: p.clientName,
          clientEmail: p.clientEmail ?? p.artistEmail,
          artistName: p.artistName,
          artistEmail: p.artistEmail,
          commercial: unavailableCommercialProjection(),
          nextSessionAt,
          lastActivity,
          unresolvedComments: cm.unresolved,
          isActive,
        };
      });

      if (view === "all-projects") {
        // Flat list shape. Resolve the client only through the project's
        // stable contact id. The snapshot fallback is display-only.
        const contacts = await ctx.db
          .select({
            id: clientContacts.id,
            email: clientContacts.email,
            name: clientContacts.name,
            phone: clientContacts.phone,
            tags: clientContacts.tags,
            notes: clientContacts.notes,
            producerArchivedAt: clientContacts.producerArchivedAt,
            invitedAt: clientContacts.invitedAt,
            clerkUserId: clientContacts.clerkUserId,
          })
          .from(clientContacts)
          .where(eq(clientContacts.producerId, ctx.producerId));
        const contactById = new Map<
          string,
          {
            id: string;
            email: string;
            name: string;
            phone: string | null;
            tags: string[] | null;
            notes: string | null;
            producerArchivedAt: Date | null;
            invitedAt: Date | null;
            clerkUserId: string | null;
          }
        >();
        for (const c of contacts) {
          contactById.set(c.id, {
            id: c.id,
            email: c.email,
            name: c.name,
            phone: c.phone,
            tags: c.tags,
            notes: c.notes,
            producerArchivedAt: c.producerArchivedAt,
            invitedAt: c.invitedAt,
            clerkUserId: c.clerkUserId,
          });
        }
        return {
          view: "all-projects" as const,
          projects: enriched.map((p) => {
            const ct = contactById.get(p.clientContactId) ?? null;
            return {
              ...p,
              client: ct
                ? {
                    id: ct.id,
                    email: ct.email,
                    name: ct.name,
                    phone: ct.phone,
                    tags: ct.tags,
                    notes: ct.notes,
                    producerArchivedAt: ct.producerArchivedAt,
                    invitedAt: ct.invitedAt,
                    clerkUserId: ct.clerkUserId,
                  }
                : {
                    id: null,
                    email: p.clientEmail,
                    name: p.clientName ?? p.artistName,
                    phone: null as string | null,
                    tags: null as string[] | null,
                    notes: null as string | null,
                    producerArchivedAt: null as Date | null,
                    invitedAt: null as Date | null,
                    clerkUserId: null as string | null,
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
          phone: clientContacts.phone,
          firstSeenAt: clientContacts.firstSeenAt,
          lastSeenAt: clientContacts.lastSeenAt,
          tags: clientContacts.tags,
          notes: clientContacts.notes,
          producerArchivedAt: clientContacts.producerArchivedAt,
          referralSource: clientContacts.referralSource,
          // Phase 1 (clients-projects redesign) — drives LinkPill state.
          // `clerkUserId` set ⇒ "active" (artist signed up), else
          // `invitedAt` set ⇒ "pending", else "none".
          invitedAt: clientContacts.invitedAt,
          clerkUserId: clientContacts.clerkUserId,
        })
        .from(clientContacts)
        .where(eq(clientContacts.producerId, ctx.producerId))
        // Custom drag order first, then most-recently-seen for the
        // un-dragged (position=0) tail.
        .orderBy(asc(clientContacts.position), desc(clientContacts.lastSeenAt));

      type Agg = {
        active: number;
        archiveBlocking: number;
        total: number;
        lastActivity: Date | null;
        unresolved: number;
      };
      const byClientContactId = new Map<string, Agg>();
      function ensure(clientContactId: string): Agg {
        const existing = byClientContactId.get(clientContactId);
        if (existing) return existing;
        const fresh: Agg = {
          active: 0,
          archiveBlocking: 0,
          total: 0,
          lastActivity: null,
          unresolved: 0,
        };
        byClientContactId.set(clientContactId, fresh);
        return fresh;
      }
      for (const p of enriched) {
        const la = p.lastActivity instanceof Date ? p.lastActivity : new Date(p.lastActivity);
        const aggregate = ensure(p.clientContactId);
        aggregate.total += 1;
        if (p.isActive) {
          aggregate.active += 1;
        }
        if (p.lifecycleStatus === "active" || p.lifecycleStatus === "waiting_for_payment") {
          aggregate.archiveBlocking += 1;
        }
        aggregate.unresolved += p.unresolvedComments;
        if (!aggregate.lastActivity || la > aggregate.lastActivity) {
          aggregate.lastActivity = la;
        }
      }

      const rows = contacts.map((c) => {
        const agg = byClientContactId.get(c.id) ?? {
          active: 0,
          archiveBlocking: 0,
          total: 0,
          lastActivity: null,
          unresolved: 0,
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
            ? now -
                (c.lastSeenAt instanceof Date ? c.lastSeenAt : new Date(c.lastSeenAt)).getTime() >
              staleMs
            : false;
        const needsAttention = agg.unresolved > 0;
        return {
          id: c.id,
          email: c.email,
          name: c.name,
          firstSeenAt: c.firstSeenAt,
          lastSeenAt: c.lastSeenAt,
          tags: c.tags,
          notes: c.notes,
          phone: c.phone,
          referralSource: c.referralSource,
          producerArchivedAt: c.producerArchivedAt,
          invitedAt: c.invitedAt,
          clerkUserId: c.clerkUserId,
          activeProjectCount: agg.active,
          archiveBlockingProjectCount: agg.archiveBlocking,
          totalProjectCount: agg.total,
          commercial: unavailableCommercialProjection(),
          unresolvedComments: agg.unresolved,
          lastActivity,
          needsAttention,
          isStale,
        };
      });
      return { view: "by-client" as const, clients: rows };
    }),

  // Batch D — overwrite the tags array on a single contact. Lighter
  // than `updateClientMeta` (which can also touch notes / referral):
  // the Project Room tag editor only ever cares about tags, so a
  // dedicated procedure keeps the wire shape + Zod parse minimal.
  //
  // Tags are normalized before write: trimmed, lower-cased for the
  // dedupe key but the first casing seen is preserved for display.
  // An empty input array drops every tag (the column is non-null
  // since 0028 so we store '{}' rather than NULL).
  setTags: producerProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        tags: z.array(z.string().trim().min(1).max(80)).max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ producerId: clientContacts.producerId })
        .from(clientContacts)
        .where(and(eq(clientContacts.id, input.id), eq(clientContacts.producerId, ctx.producerId)))
        .limit(1);
      if (!existing || existing.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // Case-insensitive dedupe, first-casing-wins. Matches the
      // updateClientMeta normalizer so a producer doesn't end up with
      // "VIP" + "vip" as two separate tags after flipping paths.
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const t of input.tags) {
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cleaned.push(t);
      }
      await ctx.db
        .update(clientContacts)
        .set({ tags: cleaned })
        .where(and(eq(clientContacts.id, input.id), eq(clientContacts.producerId, ctx.producerId)));
      return { ok: true as const, tags: cleaned };
    }),

  // Batch D — autocomplete source for the tag editor. Returns the
  // distinct set of tags the producer has used across all their
  // contacts, sorted by most-used first. Keeps the tag vocabulary
  // consistent ("#vip" vs "#VIP") and encourages reuse of prior
  // labels. Caps the returned list at 40; producers with bigger
  // vocabularies can still add fresh tags — autocomplete is a nudge,
  // not a constraint.
  listTags: producerProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ tags: clientContacts.tags })
      .from(clientContacts)
      .where(eq(clientContacts.producerId, ctx.producerId));
    // Count occurrences case-insensitively; preserve the first-seen
    // casing per key so the UI has a single canonical spelling to
    // display for each tag.
    const counts = new Map<string, { canonical: string; n: number }>();
    for (const row of rows) {
      const arr = row.tags;
      for (const raw of arr) {
        const t = raw.trim();
        if (!t) continue;
        const key = t.toLowerCase();
        const prev = counts.get(key);
        if (prev) {
          prev.n += 1;
        } else {
          counts.set(key, { canonical: t, n: 1 });
        }
      }
    }
    const sorted = Array.from(counts.values())
      .sort((a, b) => b.n - a.n || a.canonical.localeCompare(b.canonical))
      .slice(0, 40)
      .map((e) => e.canonical);
    return sorted;
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
        .where(and(eq(clientContacts.id, input.id), eq(clientContacts.producerId, ctx.producerId)))
        .limit(1);
      if (!existing || existing.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const patch: {
        tags?: string[];
        notes?: string | null;
        referralSource?: string | null;
      } = {};
      if (input.tags !== undefined) {
        // Deduplicate case-insensitively while preserving the first
        // casing seen — producers usually type "Hip-Hop" then "hip-hop"
        // and expect one tag. Since 0028 tags is NOT NULL + default
        // '{}', we store an empty array (rather than null) to clear.
        const seen = new Set<string>();
        const cleaned: string[] = [];
        for (const t of input.tags) {
          const key = t.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          cleaned.push(t);
        }
        patch.tags = cleaned;
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
        .where(and(eq(clientContacts.id, input.id), eq(clientContacts.producerId, ctx.producerId)));
      return { ok: true as const, changed: true };
    }),

  // Enriched list for the CRM view. One round-trip for contacts plus
  // one grouped aggregate over projects. N+1 avoided by building a map
  // keyed on the stable client contact id.
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
        clientContactId: projects.clientContactId,
        totalProjects: sql<number>`count(*)::int`,
        activeProjects: sql<number>`count(*) filter (where ${projects.lifecycleStatus} not in ('completed','canceled'))::int`,
        lastActivity: sql<Date | string | null>`max(${projects.updatedAt})`,
      })
      .from(projects)
      .where(eq(projects.producerId, ctx.producerId))
      .groupBy(projects.clientContactId);

    const agg = new Map<string, { active: number; total: number; lastActivity: Date | null }>();
    for (const row of projectAgg) {
      const lastAct =
        row.lastActivity == null
          ? null
          : row.lastActivity instanceof Date
            ? row.lastActivity
            : new Date(row.lastActivity);
      agg.set(row.clientContactId, {
        active: row.activeProjects,
        total: row.totalProjects,
        lastActivity: lastAct,
      });
    }

    return contacts.map((c) => {
      const meta = agg.get(c.id) ?? {
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

  // Phase 1 (G6) — accepts optional `phone` + `notes` to back the New
  // Client modal in the Clients & Projects v3 redesign (DESIGN.md §6.1).
  // The fields are nullable in the schema, so missing inputs map to
  // NULL via `?? null` rather than skipping the column. If the email
  // already exists for this producer we return the existing row
  // UNCHANGED — we deliberately do NOT overwrite phone/notes here to
  // avoid stomping data the producer entered through Edit. The modal
  // detects `existed: true` and redirects to the client's space.
  create: producerProcedure
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().trim().min(1).max(200),
        phone: z.string().trim().max(40).optional(),
        notes: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { lower, hash } = hashEmail(input.email);
      const [existing] = await ctx.db
        .select()
        .from(clientContacts)
        .where(
          and(eq(clientContacts.producerId, ctx.producerId), eq(clientContacts.emailHash, hash)),
        )
        .limit(1);
      if (existing) {
        // Existing-row branch: return as-is. Phone/notes from the modal
        // are intentionally NOT applied so a careless duplicate-add
        // doesn't blow away the producer's existing CRM data. The UI
        // surfaces this via `existed: true` and routes to the client.
        return {
          id: existing.id,
          email: existing.email,
          name: existing.name,
          existed: true as const,
        };
      }
      const now = new Date();
      const phone = input.phone?.trim();
      const notes = input.notes?.trim();
      const [row] = await ctx.db
        .insert(clientContacts)
        .values({
          producerId: ctx.producerId,
          emailHash: hash,
          email: lower,
          name: input.name.trim(),
          phone: phone && phone.length > 0 ? phone : null,
          notes: notes && notes.length > 0 ? notes : null,
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
        phone: z.string().trim().max(40).nullable().optional(),
        notes: z.string().trim().max(5000).nullable().optional(),
        tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const editInput: {
        producerId: string;
        clientId: string;
        name?: string;
        email?: string;
        phone?: string | null;
        notes?: string | null;
        tags?: string[];
      } = { producerId: ctx.producerId, clientId: input.id };
      if (input.name !== undefined) editInput.name = input.name;
      if (input.email !== undefined) editInput.email = input.email;
      if (input.phone !== undefined) editInput.phone = input.phone;
      if (input.notes !== undefined) editInput.notes = input.notes;
      if (input.tags !== undefined) editInput.tags = input.tags;

      try {
        const { client } = await editClient(clientManagementRepository(ctx.db), editInput);
        return {
          id: client.id,
          email: client.email,
          name: client.name,
          phone: client.phone,
          notes: client.notes,
          tags: [...client.tags],
        };
      } catch (error) {
        mapClientManagementDomainError(error);
      }
    }),

  archive: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await archiveClient(clientManagementRepository(ctx.db), {
          producerId: ctx.producerId,
          clientId: input.id,
          archivedAt: new Date(),
        });
        return {
          id: result.client.id,
          producerArchivedAt: result.client.producerArchivedAt,
          changed: result.changed,
        };
      } catch (error) {
        mapClientManagementDomainError(error);
      }
    }),

  restore: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await restoreClient(clientManagementRepository(ctx.db), {
          producerId: ctx.producerId,
          clientId: input.id,
        });
        return {
          id: result.client.id,
          producerArchivedAt: result.client.producerArchivedAt,
          changed: result.changed,
        };
      } catch (error) {
        mapClientManagementDomainError(error);
      }
    }),

  // Permanent deletion is a domain operation: only a never-invited,
  // unowned draft with no project or commercial history may be removed.
  remove: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await permanentlyDeleteEmptyDraftClient(historicalDeletionRepository(ctx.db), {
          producerId: ctx.producerId,
          clientId: input.id,
        });
      } catch (error) {
        mapHistoricalDeletionDomainError(error);
      }
    }),

  // Clients & Projects v3 redesign — Phase 1 Task 14. Drag-to-reorder
  // for the CRM list. Writes the new ordinals (position == index in
  // orderedIds) inside a single ctx.db.transaction so a partial failure
  // can't leave the list half-reordered. Ownership is verified by
  // selecting all matching row producerIds in one query and asserting
  // equality before any write. Idempotent: calling with the same order
  // is a no-op DB write (setting position to its current value).
  //
  // Mirrors the precedent in booking.products.reorder.
  reorder: producerProcedure
    .input(
      z.object({
        orderedIds: z
          .array(z.string().uuid())
          .min(1)
          .refine((arr) => new Set(arr).size === arr.length, "duplicate ids are not allowed"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: clientContacts.id,
          producerId: clientContacts.producerId,
        })
        .from(clientContacts)
        .where(
          and(
            inArray(clientContacts.id, input.orderedIds),
            eq(clientContacts.producerId, ctx.producerId),
          ),
        );
      if (
        rows.length !== input.orderedIds.length ||
        rows.some((row) => row.producerId !== ctx.producerId)
      ) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db.transaction(async (tx) => {
        for (const [idx, id] of input.orderedIds.entries()) {
          await tx
            .update(clientContacts)
            .set({ position: idx })
            .where(and(eq(clientContacts.id, id), eq(clientContacts.producerId, ctx.producerId)));
        }
      });
      return { count: input.orderedIds.length };
    }),

  // Clients & Projects v3 redesign — Phase 1 Task 13. Stamps invited_at
  // on the contact and (when via='email') dispatches the invite email
  // via Resend. The link path is a no-op send — the producer copied the
  // URL to their clipboard from the modal — but we still stamp
  // invited_at so the LinkPill flips to "Invited" either way.
  //
  // Notification emit is deliberately skipped: this is a producer-
  // initiated action, so notifying the producer about their own click
  // would just add inbox noise. The visible feedback is the LinkPill
  // state change. (Deviation from the brief; documented in PR notes.)
  //
  // Email failure is surfaced (the modal needs to know whether the send
  // succeeded) — we do NOT swallow Resend errors here. If the producer
  // wants the link path as a fallback, that's a separate click.
  sendInvite: producerProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        via: z.enum(["email", "link"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const producer =
        input.via === "email"
          ? (
              await ctx.db
                .select({
                  slug: producers.slug,
                  displayName: producers.displayName,
                })
                .from(producers)
                .where(eq(producers.id, ctx.producerId))
                .limit(1)
            )[0]
          : undefined;

      try {
        return await inviteClient(clientManagementRepository(ctx.db), {
          producerId: ctx.producerId,
          clientId: input.id,
          via: input.via,
          invitedAt: new Date(),
          // The domain commits invitedAt under the shared deletion lock before
          // this callback runs. A failed send remains safely retryable without
          // letting permanent deletion create a dead invite.
          deliverEmail: async (client) => {
            const slug = producer?.slug ?? "";
            const producerName = producer?.displayName ?? "Your producer";
            const inviteUrl = `${SITE_URL}/invite/${slug}-${client.id}`;
            await sendClientInviteEmail(client.email, {
              clientName: client.name,
              producerName,
              inviteUrl,
            });
          },
        });
      } catch (error) {
        mapClientManagementDomainError(error);
      }
    }),

  // Detailed view — contact + linked projects + contracts + recent
  // comments. Consumed by /dashboard/clients/[id].
  detail: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [contact] = await ctx.db
        .select()
        .from(clientContacts)
        .where(and(eq(clientContacts.id, input.id), eq(clientContacts.producerId, ctx.producerId)))
        .limit(1);
      if (!contact || contact.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const canPermanentlyDelete = await canPermanentlyDeleteEmptyDraftClient(
        historicalDeletionRepository(ctx.db),
        { producerId: ctx.producerId, clientId: input.id },
      );
      const projectRows = await ctx.db
        .select({
          id: projects.id,
          title: projects.title,
          lifecycleStatus: projects.lifecycleStatus,
          clientContactId: projects.clientContactId,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          nextSessionAt: sql<
            Date | string | null
          >`min(case when ${bookings.startsAt} > now() and ${bookings.status} = 'confirmed' then ${bookings.startsAt} end)`,
        })
        .from(projects)
        .leftJoin(bookings, eq(bookings.projectId, projects.id))
        .where(and(eq(projects.producerId, ctx.producerId), eq(projects.clientContactId, input.id)))
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
                  eq(trackComments.fromProducer, false),
                ),
              )
              .orderBy(desc(trackComments.createdAt))
              .limit(20)
          : [];

      const activeProjectCount = projectRows.filter(
        (project) =>
          project.lifecycleStatus !== "completed" && project.lifecycleStatus !== "canceled",
      ).length;
      const archiveBlockingProjectCount = projectRows.filter(
        (project) =>
          project.lifecycleStatus === "active" || project.lifecycleStatus === "waiting_for_payment",
      ).length;
      const lastActivity = projectRows[0]?.updatedAt ?? contact.lastSeenAt;

      const enrichedProjects = projectRows.map((project) => ({
        ...project,
        commercial: unavailableCommercialProjection(),
      }));

      let money;
      try {
        money = await getClientMoneyLedger(clientMoneyRepository(ctx.db), {
          producerId: ctx.producerId,
          clientContactId: input.id,
        });
      } catch (error) {
        mapClientMoneyDomainError(error);
      }

      return {
        contact: {
          id: contact.id,
          email: contact.email,
          name: contact.name,
          // PR #130 — phone surfaces the optional phone column so the
          // Client Space hero's Edit modal can prefill it. Null when
          // the producer hasn't filled it in.
          phone: contact.phone,
          firstSeenAt: contact.firstSeenAt,
          lastSeenAt: contact.lastSeenAt,
          tags: contact.tags,
          notes: contact.notes,
          producerArchivedAt: contact.producerArchivedAt,
          referralSource: contact.referralSource,
          // Phase 1 (clients-projects redesign) — drives LinkPill state
          // on the Client Space hero.
          invitedAt: contact.invitedAt,
          clerkUserId: contact.clerkUserId,
          canPermanentlyDelete,
        },
        stats: {
          activeProjectCount,
          archiveBlockingProjectCount,
          totalProjectCount: projectRows.length,
          trackCount,
          lastActivity,
          commercial: unavailableCommercialProjection(),
        },
        projects: enrichedProjects,
        money,
        comments: commentRows,
      };
    }),
});
