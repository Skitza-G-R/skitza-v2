import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  bookings,
  createDb,
  desc,
  eq,
  producers,
  projectTracks,
  projects,
  trackComments,
  trackVersions,
  type Db,
} from "@skitza/db";
import { z } from "zod";

import { publicProcedure, router } from "../init";
import { producerProcedure } from "../producer-procedure";
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

// Generate a fresh share token for project rooms. 32 bytes → 43
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
type ProjectPublic = Omit<typeof projects.$inferSelect, "shareTokenHash">;
function stripHash(row: typeof projects.$inferSelect): ProjectPublic {
  return {
    id: row.id,
    producerId: row.producerId,
    bookingId: row.bookingId,
    title: row.title,
    artistName: row.artistName,
    artistEmail: row.artistEmail,
    depositPaid: row.depositPaid,
    finalPaid: row.finalPaid,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Rate limits for public endpoints
const COMMENT_LIMIT = 20;
const COMMENT_WINDOW_MS = 60_000;
const VIEW_LIMIT = 60;
const VIEW_WINDOW_MS = 60_000;

// ─── Inputs ──────────────────────────────────────────────────────────
const CreateProjectInput = z.object({
  title: z.string().min(1).max(120),
  artistName: z.string().min(1).max(80),
  artistEmail: z.string().email(),
  bookingId: z.string().uuid().optional(),
});

const AddTrackInput = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(120),
  artist: z.string().max(120).optional(),
});

const AddVersionInput = z.object({
  trackId: z.string().uuid(),
  label: z.string().min(1).max(40),
  audioUrl: z.string().url(),
  durationMs: z.number().int().min(1).max(1000 * 60 * 60 * 3).optional(), // cap 3h
});

const SetPaidInput = z.object({
  projectId: z.string().uuid(),
  kind: z.enum(["deposit", "final"]),
  value: z.boolean(),
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
export const projectRouter = router({
  // ── Producer-side ───────────────────────────────────────────────
  list: producerProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(projects)
      .where(eq(projects.producerId, ctx.producerId))
      .orderBy(desc(projects.updatedAt));
  }),

  // Returns the project + its full tracks/versions/comments tree.
  // Producer-side read; artist-side uses publicByToken below.
  detail: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, input.id))
        .limit(1);
      if (!row || row.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const tracksList = await ctx.db
        .select()
        .from(projectTracks)
        .where(eq(projectTracks.projectId, row.id))
        .orderBy(asc(projectTracks.position), asc(projectTracks.createdAt));
      // Fetch all versions + comments with JS-side filter. Producers
      // with dozens of projects wouldn't win from a SQL inArray here
      // because the set of trackIds is already small (typically 1-5
      // tracks per project). Refactor to inArray when a project
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
      // Comments for all versions in this project.
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
        project: stripHash(row),
        tracks: tracksList,
        versions: allVersions,
        comments: allComments,
      };
    }),

  create: producerProcedure.input(CreateProjectInput).mutation(async ({ ctx, input }) => {
    const token = mintShareToken();
    const [row] = await ctx.db
      .insert(projects)
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
    // Return the RAW token exactly once — caller must persist/share
    // it immediately; we don't store it and can't regenerate an
    // existing project's link without rotating.
    return { project: stripHash(row), shareToken: token.raw };
  }),

  addTrack: producerProcedure.input(AddTrackInput).mutation(async ({ ctx, input }) => {
    const [project] = await ctx.db
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project || project.producerId !== ctx.producerId) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    const existing = await ctx.db
      .select({ position: projectTracks.position })
      .from(projectTracks)
      .where(eq(projectTracks.projectId, input.projectId))
      .orderBy(asc(projectTracks.position));
    const nextPos =
      existing.length === 0 ? 0 : (existing[existing.length - 1]?.position ?? 0) + 1;
    const [row] = await ctx.db
      .insert(projectTracks)
      .values({
        projectId: input.projectId,
        title: input.title,
        ...(input.artist ? { artist: input.artist } : {}),
        position: nextPos,
      })
      .returning();
    if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    // Touch the parent project so it sorts to the top of list views.
    await ctx.db
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, input.projectId));
    return row;
  }),

  addVersion: producerProcedure.input(AddVersionInput).mutation(async ({ ctx, input }) => {
    // Verify ownership via the track → project → producer chain.
    const [track] = await ctx.db
      .select({ id: projectTracks.id, projectId: projectTracks.projectId })
      .from(projectTracks)
      .where(eq(projectTracks.id, input.trackId))
      .limit(1);
    if (!track) throw new TRPCError({ code: "NOT_FOUND" });
    const [project] = await ctx.db
      .select({ producerId: projects.producerId })
      .from(projects)
      .where(eq(projects.id, track.projectId))
      .limit(1);
    if (!project || project.producerId !== ctx.producerId) {
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
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, track.projectId));
    return row;
  }),

  setPaid: producerProcedure.input(SetPaidInput).mutation(async ({ ctx, input }) => {
    const [project] = await ctx.db
      .select({ producerId: projects.producerId })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project || project.producerId !== ctx.producerId) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    await ctx.db
      .update(projects)
      .set(
        input.kind === "deposit"
          ? { depositPaid: input.value, updatedAt: new Date() }
          : { finalPaid: input.value, updatedAt: new Date() },
      )
      .where(eq(projects.id, input.projectId));
    return { ok: true as const };
  }),

  resolveComment: producerProcedure
    .input(ResolveCommentInput)
    .mutation(async ({ ctx, input }) => {
      // Ownership is transitive: comment → version → track → project → producer.
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
        .select({ projectId: projectTracks.projectId })
        .from(projectTracks)
        .where(eq(projectTracks.id, v.trackId))
        .limit(1);
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      const [p] = await ctx.db
        .select({ producerId: projects.producerId })
        .from(projects)
        .where(eq(projects.id, t.projectId))
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
        .select({ projectId: projectTracks.projectId })
        .from(projectTracks)
        .where(eq(projectTracks.id, v.trackId))
        .limit(1);
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      const [p] = await ctx.db
        .select({ producerId: projects.producerId, artistName: projects.artistName, artistEmail: projects.artistEmail })
        .from(projects)
        .where(eq(projects.id, t.projectId))
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
      // Idempotent: if a project already points at this booking, return it.
      const [existing] = await ctx.db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.producerId, ctx.producerId),
            eq(projects.bookingId, booking.id),
          ),
        )
        .limit(1);
      if (existing) {
        return { project: stripHash(existing), shareToken: null, existing: true };
      }
      const token = mintShareToken();
      const title = booking.packageNameSnapshot ?? "Project";
      const [row] = await ctx.db
        .insert(projects)
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
      return { project: stripHash(row), shareToken: token.raw, existing: false };
    }),

  // ── Artist-side (public via token) ─────────────────────────────
  publicByToken: publicProcedure
    .input(z.object({ token: z.string().min(16).max(128) }))
    .query(async ({ input }) => {
      const { db, ipHash } = await publicCtx();
      const rl = checkRateLimit(`project-view:${ipHash}`, VIEW_LIMIT, VIEW_WINDOW_MS);
      if (!rl.ok) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });

      const tokenHash = createHash("sha256").update(input.token).digest("hex");
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.shareTokenHash, tokenHash))
        .limit(1);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const tracksList = await db
        .select()
        .from(projectTracks)
        .where(eq(projectTracks.projectId, project.id))
        .orderBy(asc(projectTracks.position), asc(projectTracks.createdAt));

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
        .where(eq(producers.id, project.producerId))
        .limit(1);

      return {
        project: {
          id: project.id,
          title: project.title,
          artistName: project.artistName,
          depositPaid: project.depositPaid,
          finalPaid: project.finalPaid,
          createdAt: project.createdAt,
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
      const rl = checkRateLimit(`project-comment:${ipHash}`, COMMENT_LIMIT, COMMENT_WINDOW_MS);
      if (!rl.ok) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });

      const tokenHash = createHash("sha256").update(input.token).digest("hex");
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.shareTokenHash, tokenHash))
        .limit(1);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      // Verify the version is one of this project's (defense in depth).
      const [version] = await db
        .select({ trackId: trackVersions.trackId })
        .from(trackVersions)
        .where(eq(trackVersions.id, input.versionId))
        .limit(1);
      if (!version) throw new TRPCError({ code: "NOT_FOUND" });
      const [track] = await db
        .select({ projectId: projectTracks.projectId })
        .from(projectTracks)
        .where(eq(projectTracks.id, version.trackId))
        .limit(1);
      if (!track || track.projectId !== project.id) {
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
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, project.id));
      return { id: row.id };
    }),
});
