import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  bookings,
  createDb,
  dealTracks,
  deals,
  desc,
  eq,
  notifications,
  producers,
  trackComments,
  trackVersions,
  type Db,
} from "@skitza/db";
import { z } from "zod";

import { publicProcedure, router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { recordContact } from "~/server/contacts/record";
import { emitCommentCreated } from "~/server/notifications/emit";
import { checkRateLimit } from "~/lib/rate-limit/in-memory";

// ─── Helpers ─────────────────────────────────────────────────────────
async function publicCtx(): Promise<{ db: Db; ipHash: string }> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "missing DATABASE_URL" });
  }
  const hdrs = await headers();
  const ipRaw = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return { db: createDb(dbUrl), ipHash: createHash("sha256").update(ipRaw).digest("hex") };
}

// Generate a fresh share token for deal rooms. 32 bytes → 43
// base64url chars. Raw token shown to producer ONCE when created;
// only sha256(token) persisted. Mirrors magicLinks token discipline.
function mintShareToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

// Shape we expose publicly. Strips shareTokenHash from the wire — the
// artist already holds the raw token in their URL; exposing the hash
// gives no benefit and lets an attacker correlate DB leaks.
type DealPublic = Omit<typeof deals.$inferSelect, "shareTokenHash">;
function stripHash(row: typeof deals.$inferSelect): DealPublic {
  return {
    id: row.id,
    producerId: row.producerId,
    bookingId: row.bookingId,
    title: row.title,
    stage: row.stage,
    clientName: row.clientName,
    clientEmail: row.clientEmail,
    artistName: row.artistName,
    artistEmail: row.artistEmail,
    depositPaid: row.depositPaid,
    finalPaid: row.finalPaid,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Deal stages mirror the deal_stage pg enum. Kept here as a const so
// the Zod input and listByStage grouped init stay in sync.
const STAGES = [
  "lead",
  "booked",
  "contract_sent",
  "in_production",
  "final_review",
  "paid",
  "archived",
] as const;
type Stage = (typeof STAGES)[number];

// Rate limits for public endpoints
const COMMENT_LIMIT = 20;
const COMMENT_WINDOW_MS = 60_000;
const VIEW_LIMIT = 60;
const VIEW_WINDOW_MS = 60_000;

// ─── Inputs ──────────────────────────────────────────────────────────
const CreateDealInput = z.object({
  title: z.string().min(1).max(120),
  artistName: z.string().min(1).max(80),
  artistEmail: z.string().email(),
  bookingId: z.string().uuid().optional(),
});

const AddTrackInput = z.object({
  dealId: z.string().uuid(),
  title: z.string().min(1).max(120),
  artist: z.string().max(120).optional(),
});

const AddVersionInput = z.object({
  trackId: z.string().uuid(),
  label: z.string().min(1).max(40),
  // Nullable: when creating a row for "upload pending" the audioUrl is
  // filled later by audio.completeMultipart patching the same row.
  audioUrl: z.string().url().nullable(),
  durationMs: z.number().int().min(1).max(1000 * 60 * 60 * 3).optional(), // cap 3h
});

const SetPaidInput = z.object({
  dealId: z.string().uuid(),
  kind: z.enum(["deposit", "final"]),
  value: z.boolean(),
});

const SetStageInput = z.object({
  id: z.string().uuid(),
  stage: z.enum(STAGES),
});

// Artist-side: submit a timestamped comment.
const SubmitCommentInput = z.object({
  token: z.string().min(16).max(128),
  versionId: z.string().uuid(),
  authorName: z.string().min(1).max(80),
  authorEmail: z.string().email(),
  body: z.string().min(1).max(2000),
  timestampMs: z.number().int().min(0).max(1000 * 60 * 60 * 3),
});

const ResolveCommentInput = z.object({
  id: z.string().uuid(),
  resolved: z.boolean(),
});

// ─── Router ──────────────────────────────────────────────────────────
export const dealRouter = router({
  // ── Producer-side ───────────────────────────────────────────────
  list: producerProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(deals)
      .where(eq(deals.producerId, ctx.producerId))
      .orderBy(desc(deals.updatedAt));
  }),

  // Returns rows grouped by stage for the Kanban board. Seven buckets
  // keyed by the deal_stage enum; each bucket ordered by updatedAt
  // desc so the most-recently-touched deal floats to the top of its
  // column.
  listByStage: producerProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(deals)
      .where(eq(deals.producerId, ctx.producerId))
      .orderBy(desc(deals.updatedAt));

    const grouped: Record<Stage, (typeof rows)[number][]> = {
      lead: [],
      booked: [],
      contract_sent: [],
      in_production: [],
      final_review: [],
      paid: [],
      archived: [],
    };
    for (const r of rows) {
      // r.stage is the deal_stage pg enum → always a valid key of
      // `grouped` above. ESLint flags the defensive `?? grouped.lead`
      // as unreachable, which it is.
      grouped[r.stage].push(r);
    }
    return grouped;
  }),

  // Returns the deal + its full tracks/versions/comments tree.
  // Producer-side read; artist-side uses publicByToken below.
  detail: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(deals)
        .where(eq(deals.id, input.id))
        .limit(1);
      if (!row || row.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const tracksList = await ctx.db
        .select()
        .from(dealTracks)
        .where(eq(dealTracks.dealId, row.id))
        .orderBy(asc(dealTracks.position), asc(dealTracks.createdAt));
      // Fetch all versions + comments with JS-side filter. Producers
      // with dozens of deals wouldn't win from a SQL inArray here
      // because the set of trackIds is already small (typically 1-5
      // tracks per deal). Refactor to inArray when a deal
      // routinely carries >20 tracks.
      const trackIds = tracksList.map((t) => t.id);
      const allVersions = trackIds.length
        ? (
            await ctx.db
              .select()
              .from(trackVersions)
              .orderBy(desc(trackVersions.uploadedAt))
          ).filter((v) => trackIds.includes(v.trackId))
        : [];
      // Comments for all versions in this deal.
      const versionIds = allVersions.map((v) => v.id);
      const allComments = versionIds.length
        ? (
            await ctx.db
              .select()
              .from(trackComments)
              .orderBy(asc(trackComments.timestampMs))
          ).filter((c) => versionIds.includes(c.versionId))
        : [];
      return {
        deal: stripHash(row),
        tracks: tracksList,
        versions: allVersions,
        comments: allComments,
      };
    }),

  create: producerProcedure.input(CreateDealInput).mutation(async ({ ctx, input }) => {
    const token = mintShareToken();
    const [row] = await ctx.db
      .insert(deals)
      .values({
        producerId: ctx.producerId,
        ...(input.bookingId ? { bookingId: input.bookingId } : {}),
        title: input.title,
        artistName: input.artistName,
        artistEmail: input.artistEmail.toLowerCase(),
        shareTokenHash: token.hash,
      })
      .returning();
    if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    // Best-effort contact cache upsert. A failure MUST NOT break the
    // deal create flow — the deal row is already persisted above.
    try {
      await recordContact(ctx.db, {
        producerId: ctx.producerId,
        email: input.artistEmail,
        name: input.artistName,
      });
    } catch (err) {
      console.warn("[contacts] recordContact failed in deal.create", err);
    }

    // Return the RAW token exactly once — caller must persist/share
    // it immediately; we don't store it and can't regenerate an
    // existing deal's link without rotating.
    return { deal: stripHash(row), shareToken: token.raw };
  }),

  // Moves a deal between kanban columns. Ownership-checked; bumps
  // updatedAt so the column re-sorts to float the dragged card.
  // Event logging lands when contract_events (or a deal_events
  // cousin) is wired — for now we only touch the row.
  setStage: producerProcedure.input(SetStageInput).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select({ producerId: deals.producerId })
      .from(deals)
      .where(eq(deals.id, input.id))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    if (row.producerId !== ctx.producerId) throw new TRPCError({ code: "FORBIDDEN" });
    const now = new Date();
    await ctx.db
      .update(deals)
      .set({ stage: input.stage, updatedAt: now })
      .where(eq(deals.id, input.id));
    return { ok: true as const };
  }),

  addTrack: producerProcedure.input(AddTrackInput).mutation(async ({ ctx, input }) => {
    const [deal] = await ctx.db
      .select()
      .from(deals)
      .where(eq(deals.id, input.dealId))
      .limit(1);
    if (!deal || deal.producerId !== ctx.producerId) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    const existing = await ctx.db
      .select({ position: dealTracks.position })
      .from(dealTracks)
      .where(eq(dealTracks.dealId, input.dealId))
      .orderBy(asc(dealTracks.position));
    const nextPos =
      existing.length === 0 ? 0 : (existing[existing.length - 1]?.position ?? 0) + 1;
    const [row] = await ctx.db
      .insert(dealTracks)
      .values({
        dealId: input.dealId,
        title: input.title,
        ...(input.artist ? { artist: input.artist } : {}),
        position: nextPos,
      })
      .returning();
    if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    // Touch the parent deal so it sorts to the top of list views.
    await ctx.db
      .update(deals)
      .set({ updatedAt: new Date() })
      .where(eq(deals.id, input.dealId));
    return row;
  }),

  addVersion: producerProcedure.input(AddVersionInput).mutation(async ({ ctx, input }) => {
    // Verify ownership via the track → deal → producer chain.
    const [track] = await ctx.db
      .select({ id: dealTracks.id, dealId: dealTracks.dealId })
      .from(dealTracks)
      .where(eq(dealTracks.id, input.trackId))
      .limit(1);
    if (!track) throw new TRPCError({ code: "NOT_FOUND" });
    const [deal] = await ctx.db
      .select({ producerId: deals.producerId })
      .from(deals)
      .where(eq(deals.id, track.dealId))
      .limit(1);
    if (!deal || deal.producerId !== ctx.producerId) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    const [row] = await ctx.db
      .insert(trackVersions)
      .values({
        trackId: input.trackId,
        label: input.label,
        audioUrl: input.audioUrl,
        ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
      })
      .returning();
    if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await ctx.db
      .update(deals)
      .set({ updatedAt: new Date() })
      .where(eq(deals.id, track.dealId));
    return row;
  }),

  setPaid: producerProcedure.input(SetPaidInput).mutation(async ({ ctx, input }) => {
    const [deal] = await ctx.db
      .select({ producerId: deals.producerId })
      .from(deals)
      .where(eq(deals.id, input.dealId))
      .limit(1);
    if (!deal || deal.producerId !== ctx.producerId) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    await ctx.db
      .update(deals)
      .set(
        input.kind === "deposit"
          ? { depositPaid: input.value, updatedAt: new Date() }
          : { finalPaid: input.value, updatedAt: new Date() },
      )
      .where(eq(deals.id, input.dealId));
    return { ok: true as const };
  }),

  resolveComment: producerProcedure
    .input(ResolveCommentInput)
    .mutation(async ({ ctx, input }) => {
      // Ownership is transitive: comment → version → track → deal → producer.
      // Fetch the chain to verify. If any link fails, NOT_FOUND.
      const [c] = await ctx.db
        .select({ id: trackComments.id, versionId: trackComments.versionId })
        .from(trackComments)
        .where(eq(trackComments.id, input.id))
        .limit(1);
      if (!c) throw new TRPCError({ code: "NOT_FOUND" });
      const [v] = await ctx.db
        .select({ trackId: trackVersions.trackId })
        .from(trackVersions)
        .where(eq(trackVersions.id, c.versionId))
        .limit(1);
      if (!v) throw new TRPCError({ code: "NOT_FOUND" });
      const [t] = await ctx.db
        .select({ dealId: dealTracks.dealId })
        .from(dealTracks)
        .where(eq(dealTracks.id, v.trackId))
        .limit(1);
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      const [p] = await ctx.db
        .select({ producerId: deals.producerId })
        .from(deals)
        .where(eq(deals.id, t.dealId))
        .limit(1);
      if (!p || p.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db
        .update(trackComments)
        .set({ resolvedAt: input.resolved ? new Date() : null })
        .where(eq(trackComments.id, input.id));
      return { ok: true as const };
    }),

  // G.11 — mark a track version approved / un-approved. Approving emits
  // a `track_approved` notification for the producer ("don't forget to
  // send the stems"). The notify is best-effort; a failure there must
  // never roll back the approval itself.
  approveVersion: producerProcedure
    .input(z.object({ versionId: z.string().uuid(), approved: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      // Walk ownership: version → track → deal → producer.
      const [v] = await ctx.db
        .select({
          id: trackVersions.id,
          label: trackVersions.label,
          trackId: trackVersions.trackId,
        })
        .from(trackVersions)
        .where(eq(trackVersions.id, input.versionId))
        .limit(1);
      if (!v) throw new TRPCError({ code: "NOT_FOUND" });
      const [t] = await ctx.db
        .select({ title: dealTracks.title, dealId: dealTracks.dealId })
        .from(dealTracks)
        .where(eq(dealTracks.id, v.trackId))
        .limit(1);
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      const [d] = await ctx.db
        .select({
          producerId: deals.producerId,
          title: deals.title,
          artistName: deals.artistName,
        })
        .from(deals)
        .where(eq(deals.id, t.dealId))
        .limit(1);
      if (!d || d.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const nowOrNull = input.approved ? new Date() : null;
      await ctx.db
        .update(trackVersions)
        .set({ approvedAt: nowOrNull })
        .where(eq(trackVersions.id, input.versionId));

      // Float the parent deal to the top of list views.
      await ctx.db
        .update(deals)
        .set({ updatedAt: new Date() })
        .where(eq(deals.id, t.dealId));

      // Only emit the stems-prompt notification on the approve step.
      // Un-approving is a silent reversal.
      if (input.approved) {
        try {
          await ctx.db.insert(notifications).values({
            producerId: ctx.producerId,
            kind: "track_approved",
            title: "Version approved — send stems?",
            body: `${d.artistName} · ${t.title} (${v.label}). Click to open the deal and upload stems.`,
            dealId: t.dealId,
            trackVersionId: v.id,
          });
        } catch (err) {
          console.warn("[notify] emitTrackApproved failed in deal.approveVersion", err);
        }
      }

      return { ok: true as const, approvedAt: nowOrNull };
    }),

  // Producer-side comment (responds to artist).
  addProducerComment: producerProcedure
    .input(
      z.object({
        versionId: z.string().uuid(),
        body: z.string().min(1).max(2000),
        timestampMs: z.number().int().min(0).max(1000 * 60 * 60 * 3),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership chain.
      const [v] = await ctx.db
        .select({ trackId: trackVersions.trackId })
        .from(trackVersions)
        .where(eq(trackVersions.id, input.versionId))
        .limit(1);
      if (!v) throw new TRPCError({ code: "NOT_FOUND" });
      const [t] = await ctx.db
        .select({ dealId: dealTracks.dealId })
        .from(dealTracks)
        .where(eq(dealTracks.id, v.trackId))
        .limit(1);
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      const [p] = await ctx.db
        .select({ producerId: deals.producerId, artistName: deals.artistName, artistEmail: deals.artistEmail })
        .from(deals)
        .where(eq(deals.id, t.dealId))
        .limit(1);
      if (!p || p.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      // Fetch producer's display name for authorName.
      const [producerRow] = await ctx.db
        .select({ displayName: producers.displayName })
        .from(producers)
        .where(eq(producers.id, ctx.producerId))
        .limit(1);
      const [row] = await ctx.db
        .insert(trackComments)
        .values({
          versionId: input.versionId,
          authorName: producerRow?.displayName ?? "Producer",
          authorEmail: p.artistEmail, // placeholder — producer doesn't expose own email to artist
          body: input.body,
          timestampMs: input.timestampMs,
          fromProducer: true,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return row;
    }),

  // Auto-provisioned when a booking is confirmed. Returns the share
  // token (shown once to the producer). Called by Server Action in
  // the booking confirm flow.
  createFromBooking: producerProcedure
    .input(z.object({ bookingId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [booking] = await ctx.db
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .limit(1);
      if (!booking || booking.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // Idempotent: if a deal already points at this booking, return it.
      const [existing] = await ctx.db
        .select()
        .from(deals)
        .where(
          and(
            eq(deals.producerId, ctx.producerId),
            eq(deals.bookingId, booking.id),
          ),
        )
        .limit(1);
      if (existing) {
        return { deal: stripHash(existing), shareToken: null, existing: true };
      }
      const token = mintShareToken();
      const title = booking.packageNameSnapshot ?? "Deal";
      const [row] = await ctx.db
        .insert(deals)
        .values({
          producerId: ctx.producerId,
          bookingId: booking.id,
          title,
          artistName: booking.artistName,
          artistEmail: booking.artistEmail,
          shareTokenHash: token.hash,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return { deal: stripHash(row), shareToken: token.raw, existing: false };
    }),

  // ── Artist-side (public via token) ─────────────────────────────
  publicByToken: publicProcedure
    .input(z.object({ token: z.string().min(16).max(128) }))
    .query(async ({ input }) => {
      const { db, ipHash } = await publicCtx();
      const rl = checkRateLimit(`deal-view:${ipHash}`, VIEW_LIMIT, VIEW_WINDOW_MS);
      if (!rl.ok) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });

      const tokenHash = createHash("sha256").update(input.token).digest("hex");
      const [deal] = await db
        .select()
        .from(deals)
        .where(eq(deals.shareTokenHash, tokenHash))
        .limit(1);
      if (!deal) throw new TRPCError({ code: "NOT_FOUND" });

      const tracksList = await db
        .select()
        .from(dealTracks)
        .where(eq(dealTracks.dealId, deal.id))
        .orderBy(asc(dealTracks.position), asc(dealTracks.createdAt));

      const trackIds = tracksList.map((t) => t.id);
      const allVersions = trackIds.length
        ? (
            await db.select().from(trackVersions).orderBy(desc(trackVersions.uploadedAt))
          ).filter((v) => trackIds.includes(v.trackId))
        : [];

      const versionIds = allVersions.map((v) => v.id);
      const allComments = versionIds.length
        ? (
            await db
              .select()
              .from(trackComments)
              .orderBy(asc(trackComments.timestampMs))
          ).filter((c) => versionIds.includes(c.versionId))
        : [];

      // Fetch producer name for display.
      const [producer] = await db
        .select({ displayName: producers.displayName, slug: producers.slug })
        .from(producers)
        .where(eq(producers.id, deal.producerId))
        .limit(1);

      return {
        deal: {
          id: deal.id,
          title: deal.title,
          artistName: deal.artistName,
          depositPaid: deal.depositPaid,
          finalPaid: deal.finalPaid,
          createdAt: deal.createdAt,
          producerName: producer?.displayName ?? "Producer",
          producerSlug: producer?.slug ?? "",
        },
        tracks: tracksList,
        versions: allVersions,
        comments: allComments,
      };
    }),

  publicComment: publicProcedure
    .input(SubmitCommentInput)
    .mutation(async ({ input }) => {
      const { db, ipHash } = await publicCtx();
      const rl = checkRateLimit(`deal-comment:${ipHash}`, COMMENT_LIMIT, COMMENT_WINDOW_MS);
      if (!rl.ok) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });

      const tokenHash = createHash("sha256").update(input.token).digest("hex");
      const [deal] = await db
        .select({ id: deals.id, producerId: deals.producerId })
        .from(deals)
        .where(eq(deals.shareTokenHash, tokenHash))
        .limit(1);
      if (!deal) throw new TRPCError({ code: "NOT_FOUND" });

      // Verify the version is one of this deal's (defense in depth).
      const [version] = await db
        .select({ trackId: trackVersions.trackId })
        .from(trackVersions)
        .where(eq(trackVersions.id, input.versionId))
        .limit(1);
      if (!version) throw new TRPCError({ code: "NOT_FOUND" });
      const [track] = await db
        .select({ dealId: dealTracks.dealId })
        .from(dealTracks)
        .where(eq(dealTracks.id, version.trackId))
        .limit(1);
      if (!track || track.dealId !== deal.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const [row] = await db
        .insert(trackComments)
        .values({
          versionId: input.versionId,
          authorName: input.authorName,
          authorEmail: input.authorEmail.toLowerCase(),
          body: input.body,
          timestampMs: input.timestampMs,
          fromProducer: false,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .update(deals)
        .set({ updatedAt: new Date() })
        .where(eq(deals.id, deal.id));

      // Best-effort contact cache upsert. The artist identified
      // themselves via the comment form; treat that as a touch so
      // the producer sees them in autocomplete next time.
      try {
        await recordContact(db, {
          producerId: deal.producerId,
          email: input.authorEmail,
          name: input.authorName,
        });
      } catch (err) {
        console.warn("[contacts] recordContact failed in deal.publicComment", err);
      }

      // Best-effort inbox notification. Must never block the
      // comment insert above — wrapped in try/catch.
      try {
        await emitCommentCreated(db, {
          producerId: deal.producerId,
          commentId: row.id,
          trackVersionId: input.versionId,
          dealId: deal.id,
          authorName: input.authorName,
          preview: input.body,
        });
      } catch (err) {
        console.warn("[notify] emitCommentCreated failed in deal.publicComment", err);
      }

      return { id: row.id };
    }),
});
