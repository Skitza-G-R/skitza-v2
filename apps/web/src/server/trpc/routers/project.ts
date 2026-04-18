import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  bookings,
  createDb,
  invoices,
  projectTracks,
  projects,
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
import { calculateCharges } from "~/server/payments/plan";
import { getStripe } from "~/server/stripe/client";

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
  // Destructure to drop shareTokenHash; spreading the rest keeps us in
  // sync as new columns land on the projects table without having to
  // re-list every field here.
  const { shareTokenHash: _hash, ...rest } = row;
  void _hash;
  return rest;
}

// Project stages mirror the project_stage pg enum. Kept here as a
// const so the Zod input and listByStage grouped init stay in sync.
// Note: `payment_paused` and `cancelled` are valid DB stages but are
// NOT included in the Kanban view — they're terminal/paused states
// handled separately in the CRM. `ALL_STAGES` enumerates every enum
// value so Zod accepts them on setStage; `STAGES` is the Kanban-only
// subset used by listByStage grouping.
const ALL_STAGES = [
  "lead",
  "booked",
  "contract_sent",
  "in_production",
  "final_review",
  "paid",
  "archived",
  "payment_paused",
  "cancelled",
] as const;
// Kanban-visible subset of ALL_STAGES. Kept as a type-only alias
// since the runtime guard in listByStage excludes the two terminal
// stages directly rather than iterating this list.
type Stage = Exclude<
  (typeof ALL_STAGES)[number],
  "payment_paused" | "cancelled"
>;

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
  // Nullable: when creating a row for "upload pending" the audioUrl is
  // filled later by audio.completeMultipart patching the same row.
  audioUrl: z.string().url().nullable(),
  durationMs: z.number().int().min(1).max(1000 * 60 * 60 * 3).optional(), // cap 3h
});

const SetPaidInput = z.object({
  projectId: z.string().uuid(),
  kind: z.enum(["deposit", "final"]),
  value: z.boolean(),
});

const ChargeFinalInput = z.object({
  projectId: z.string().uuid(),
});

const SetStageInput = z.object({
  id: z.string().uuid(),
  stage: z.enum(ALL_STAGES),
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

  // Returns rows grouped by stage for the Kanban board. Seven buckets
  // keyed by the project_stage enum; each bucket ordered by updatedAt
  // desc so the most-recently-touched project floats to the top of
  // its column.
  listByStage: producerProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(projects)
      .where(eq(projects.producerId, ctx.producerId))
      .orderBy(desc(projects.updatedAt));

    // Narrow each row's stage to the Kanban-visible subset. Drizzle
    // returns the full enum as the static type, but we filter out the
    // two terminal stages below so the assertion is safe at runtime.
    type KanbanRow = Omit<(typeof rows)[number], "stage"> & { stage: Stage };
    const grouped: Record<Stage, KanbanRow[]> = {
      lead: [],
      booked: [],
      contract_sent: [],
      in_production: [],
      final_review: [],
      paid: [],
      archived: [],
    };
    for (const r of rows) {
      // payment_paused + cancelled are valid DB stages but intentionally
      // excluded from the Kanban view — the CRM surfaces them elsewhere.
      if (r.stage === "payment_paused" || r.stage === "cancelled") continue;
      const stage: Stage = r.stage;
      grouped[stage].push({ ...r, stage });
    }
    return grouped;
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
      // tracks per project).
      const trackIds = tracksList.map((t) => t.id);
      const allVersions = trackIds.length
        ? (
            await ctx.db
              .select()
              .from(trackVersions)
              .orderBy(desc(trackVersions.uploadedAt))
          ).filter((v) => trackIds.includes(v.trackId))
        : [];
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

    try {
      await recordContact(ctx.db, {
        producerId: ctx.producerId,
        email: input.artistEmail,
        name: input.artistName,
      });
    } catch (err) {
      console.warn("[contacts] recordContact failed in project.create", err);
    }

    return { project: stripHash(row), shareToken: token.raw };
  }),

  // Moves a project between kanban columns. Ownership-checked; bumps
  // updatedAt so the column re-sorts to float the dragged card.
  setStage: producerProcedure.input(SetStageInput).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select({ producerId: projects.producerId })
      .from(projects)
      .where(eq(projects.id, input.id))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    if (row.producerId !== ctx.producerId) throw new TRPCError({ code: "FORBIDDEN" });
    const now = new Date();
    await ctx.db
      .update(projects)
      .set({ stage: input.stage, updatedAt: now })
      .where(eq(projects.id, input.id));
    return { ok: true as const };
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
    await ctx.db
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, input.projectId));
    return row;
  }),

  addVersion: producerProcedure.input(AddVersionInput).mutation(async ({ ctx, input }) => {
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

  // ── Task 7 ─────────────────────────────────────────────────────────
  // Fire the off-session final charge for a split_50_50 plan. The
  // deposit has already landed (chargesCompleted === 1) and the card
  // was saved via setup_future_usage at checkout, so we create a
  // PaymentIntent that reuses the customer + payment method and
  // confirms immediately.
  //
  // CRITICAL: this mutation does NOT insert an invoice row. The
  // payment_intent.succeeded webhook (handlers.ts) reconciles state
  // and writes the ledger entry — keeping invoice insertion in one
  // place makes duplicate-protection tractable (the partial unique
  // index on invoices.stripe_payment_intent_id enforces at-most-one).
  //
  // Idempotency: `proj_<id>_charge_2` scopes the key to this project
  // + this charge number. Double-click or replay returns the same PI
  // instead of charging twice.
  chargeFinal: producerProcedure
    .input(ChargeFinalInput)
    .mutation(async ({ ctx, input }) => {
      // 1. Project exists + belongs to caller.
      const [project] = await ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);
      if (!project || project.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // 2. Plan must be split_50_50 — the only shape with a producer-
      //    triggered second charge. Monthly is Stripe-driven; full is
      //    single-charge at checkout.
      if (project.paymentPlanKind !== "split_50_50") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Final charge only applies to 50/50 plans.",
        });
      }

      // 3. Deposit paid, final not yet fired (chargesCompleted === 1).
      if (project.chargesCompleted !== 1) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Final charge already processed or deposit not yet paid.",
        });
      }

      // 4. Saved customer + payment method must exist — populated by
      //    the checkout.session.completed webhook when the deposit
      //    landed. Absence means something went wrong upstream.
      if (!project.stripeCustomerId || !project.stripePaymentMethodId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Missing saved payment method — re-run checkout.",
        });
      }

      if (project.totalAmountCents === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Project total not recorded — re-run checkout.",
        });
      }

      // 5. Producer's Connect account must be live + charges-enabled.
      //    destination-charges require a healthy account.
      const [producer] = await ctx.db
        .select({
          stripeAccountId: producers.stripeAccountId,
          stripeChargesEnabled: producers.stripeChargesEnabled,
        })
        .from(producers)
        .where(eq(producers.id, ctx.producerId))
        .limit(1);
      if (
        !producer ||
        !producer.stripeAccountId ||
        !producer.stripeChargesEnabled
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Stripe account not ready — finish onboarding first.",
        });
      }

      // Derive the second-half amount via calculateCharges so the
      // cents math stays in one place (handles odd-total remainders).
      const charges = calculateCharges(
        { kind: "split_50_50" },
        project.totalAmountCents,
      );
      const finalAmountCents = charges[1];
      if (finalAmountCents === undefined || finalAmountCents <= 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Invalid final charge amount.",
        });
      }

      // Look up the deposit invoice for currency — the producer could
      // have edited the product currency since checkout, but the
      // invoice snapshot is the source of truth for this engagement.
      const [depositInvoice] = await ctx.db
        .select({ currency: invoices.currency })
        .from(invoices)
        .where(
          and(
            eq(invoices.projectId, project.id),
            eq(invoices.kind, "deposit"),
          ),
        )
        .orderBy(desc(invoices.createdAt))
        .limit(1);
      const currency = (depositInvoice?.currency ?? "USD").toLowerCase();

      const stripe = getStripe();
      const pi = await stripe.paymentIntents.create(
        {
          amount: finalAmountCents,
          currency,
          customer: project.stripeCustomerId,
          payment_method: project.stripePaymentMethodId,
          off_session: true,
          confirm: true,
          transfer_data: { destination: producer.stripeAccountId },
          metadata: {
            projectId: project.id,
            kind: "final",
            producerId: ctx.producerId,
          },
        },
        {
          idempotencyKey: `proj_${project.id}_charge_2`,
        },
      );

      return { paymentIntentId: pi.id };
    }),

  resolveComment: producerProcedure
    .input(ResolveCommentInput)
    .mutation(async ({ ctx, input }) => {
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

  // G.11 — mark a track version approved. Approving emits a
  // `track_approved` notification for the producer ("don't forget to
  // send the stems"). Fire-and-forget; a failure there must never roll
  // back the approval.
  approveVersion: producerProcedure
    .input(z.object({ versionId: z.string().uuid(), approved: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
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
        .select({ title: projectTracks.title, projectId: projectTracks.projectId })
        .from(projectTracks)
        .where(eq(projectTracks.id, v.trackId))
        .limit(1);
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      const [d] = await ctx.db
        .select({
          producerId: projects.producerId,
          title: projects.title,
          artistName: projects.artistName,
        })
        .from(projects)
        .where(eq(projects.id, t.projectId))
        .limit(1);
      if (!d || d.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const nowOrNull = input.approved ? new Date() : null;
      await ctx.db
        .update(trackVersions)
        .set({ approvedAt: nowOrNull })
        .where(eq(trackVersions.id, input.versionId));

      await ctx.db
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, t.projectId));

      if (input.approved) {
        try {
          await ctx.db.insert(notifications).values({
            producerId: ctx.producerId,
            kind: "track_approved",
            title: "Version approved — send stems?",
            body: `${d.artistName} · ${t.title} (${v.label}). Click to open the project and upload stems.`,
            projectId: t.projectId,
            trackVersionId: v.id,
          });
        } catch (err) {
          console.warn("[notify] emitTrackApproved failed in project.approveVersion", err);
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
          authorEmail: p.artistEmail,
          body: input.body,
          timestampMs: input.timestampMs,
          fromProducer: true,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return row;
    }),

  // Auto-provisioned when a booking is confirmed.
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
        .select({ id: projects.id, producerId: projects.producerId })
        .from(projects)
        .where(eq(projects.shareTokenHash, tokenHash))
        .limit(1);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

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

      try {
        await recordContact(db, {
          producerId: project.producerId,
          email: input.authorEmail,
          name: input.authorName,
        });
      } catch (err) {
        console.warn("[contacts] recordContact failed in project.publicComment", err);
      }

      try {
        await emitCommentCreated(db, {
          producerId: project.producerId,
          commentId: row.id,
          trackVersionId: input.versionId,
          projectId: project.id,
          authorName: input.authorName,
          preview: input.body,
        });
      } catch (err) {
        console.warn("[notify] emitCommentCreated failed in project.publicComment", err);
      }

      return { id: row.id };
    }),
});
