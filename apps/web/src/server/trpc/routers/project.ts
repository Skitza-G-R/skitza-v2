import { createHash, randomBytes } from "node:crypto";
import { after } from "next/server";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  bookings,
  inArray,
  invoices,
  projectTracks,
  projects,
  desc,
  eq,
  notifications,
  producers,
  trackComments,
  trackVersions,
} from "@skitza/db";
import { z } from "zod";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { recordContact } from "~/server/contacts/record";
import {
  SITE_URL,
  sendPaymentReceivedEmail,
  sendProducerRepliedToCommentEmail,
} from "~/server/email/send";
import { calculateCharges } from "~/server/payments/plan";
import { getStripe } from "~/server/stripe/client";

// ─── Helpers ─────────────────────────────────────────────────────────

// Generate a fresh share token for project rooms. 32 bytes → 43
// base64url chars. Raw token shown to producer ONCE when created;
// only sha256(token) persisted.
function mintShareToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

type ProjectPublic = typeof projects.$inferSelect;
function stripHash(row: typeof projects.$inferSelect): ProjectPublic {
  return row;
}

// Project stages mirror the project_stage pg enum. Kept here as a
// const so the Zod input and listByStage grouped init stay in sync.
const ALL_STAGES = [
  "lead",
  "booked",
  "in_production",
  "final_review",
  "paid",
  "archived",
] as const;
type Stage = (typeof ALL_STAGES)[number];

// ─── Inputs ──────────────────────────────────────────────────────────
const CreateProjectInput = z.object({
  title: z.string().min(1).max(120),
  artistName: z.string().min(1).max(80),
  artistEmail: z.string().email(),
  bookingId: z.string().uuid().optional(),
});

// Edit-project modal payload. All fields optional so the modal can
// PATCH only what the producer changed; at least one must be present
// for the procedure to do anything (no-op return otherwise).
const UpdateProjectInput = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(120).optional(),
  artistName: z.string().min(1).max(80).optional(),
  artistEmail: z.string().email().optional(),
});

// Manual line-item charge inserted from the Money sub-tab. Skips
// Stripe entirely — the row exists for record-keeping; producer
// reconciles payment outside the app and flips status later.
const AddInvoiceInput = z.object({
  projectId: z.string().uuid(),
  amountCents: z.number().int().positive().max(100_000_000),
  currency: z.string().length(3),
  description: z.string().min(1).max(280),
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

const CancelProjectInput = z.object({
  projectId: z.string().uuid(),
  // Type-to-confirm guard. The UI requires the producer to type the
  // project's title verbatim before the cancel button enables; we
  // re-check server-side because client guards aren't security.
  confirmTitle: z.string().min(1),
});

const SetStageInput = z.object({
  id: z.string().uuid(),
  stage: z.enum(ALL_STAGES),
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
      in_production: [],
      final_review: [],
      paid: [],
      archived: [],
    };
    for (const r of rows) {
      const stage: Stage = r.stage;
      grouped[stage].push({ ...r, stage });
    }
    return grouped;
  }),

  // Batch G — money summary for the Project Room's Money sub-tab.
  // Returns Paid / Outstanding totals plus the next scheduled charge
  // date. Keeps the payload tiny (3 numbers + 1 timestamp) and the
  // query lean — one producer-scoped SELECT over invoices filtered by
  // projectId. We intentionally don't return the full invoice list
  // here: the Money sub-tab no longer pretends to reproduce Stripe's
  // ledger (see Task 4 commit); producers who want the full row-by-row
  // view click "Open in Stripe" to land in the Connect dashboard.
  money: producerProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Auth-scoping — same pattern as detail: load the project row
      // first and assert producer ownership before we read invoices.
      const [row] = await ctx.db
        .select({
          producerId: projects.producerId,
          currency: projects.currency,
          nextChargeAt: projects.nextChargeAt,
        })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);
      if (!row || row.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const rows = await ctx.db
        .select({
          amountCents: invoices.amountCents,
          currency: invoices.currency,
          status: invoices.status,
        })
        .from(invoices)
        .where(eq(invoices.projectId, input.projectId));

      // Paid = status 'paid' AND 'refunded' excluded. Outstanding =
      // draft + sent + uncollectible (matches the today.KPI rollup so
      // counts align between Today and the per-project surface).
      let paidCents = 0;
      let outstandingCents = 0;
      // Resolve display currency from the project row (set at booking
      // time); fall back to the first invoice's currency for legacy
      // rows without a persisted `currency`. Mixed-currency ledgers
      // are excluded from the sums to avoid adding USD + EUR.
      const currency = row.currency ?? rows[0]?.currency ?? "USD";
      for (const inv of rows) {
        if (inv.currency !== currency) continue;
        if (inv.status === "paid") {
          paidCents += inv.amountCents;
        } else if (
          inv.status === "draft" ||
          inv.status === "sent" ||
          inv.status === "uncollectible"
        ) {
          outstandingCents += inv.amountCents;
        }
      }

      return {
        paidCents,
        outstandingCents,
        currency,
        nextChargeAt: row.nextChargeAt,
      };
    }),

  // Returns the project + its full tracks/versions/comments tree.
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
        // Persist the raw token so the project-room landing page can
        // verify the URL the artist clicked. Unique constraint at the
        // schema level guards against guess collisions.
        inviteToken: token.raw,
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

    return { project: stripHash(row), inviteToken: token.raw };
  }),

  // Producer-only private notes for the Project Room → Notes tab.
  // Free-text body, capped at 5000 chars; empty string is allowed
  // (acts as "clear the notes"). Ownership-scoped — the project must
  // belong to the calling producer or we return NOT_FOUND (no
  // enumeration leak). Bumps `updatedAt` and returns it so the UI
  // can render "Saved <relative>" without a refetch.
  updateNotes: producerProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        // Empty string is valid (clearing notes). Cap at 5000 chars —
        // soft warning at 4500 lives in the UI; hard reject here.
        notes: z.string().max(5000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ producerId: projects.producerId })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);
      if (!row || row.producerId !== ctx.producerId) {
        // NOT_FOUND for both "missing" and "owned by someone else" so
        // a tampered id can't enumerate the project space.
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const updatedAt = new Date();
      await ctx.db
        .update(projects)
        .set({ notes: input.notes, updatedAt })
        .where(eq(projects.id, input.projectId));
      return { updatedAt };
    }),

  // Edit-project modal handler. Ownership-checked; only the fields
  // present in the input are written, so the modal can PATCH a single
  // field without nulling the others. No-op when nothing changed.
  update: producerProcedure.input(UpdateProjectInput).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select({ producerId: projects.producerId })
      .from(projects)
      .where(eq(projects.id, input.id))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    if (row.producerId !== ctx.producerId) throw new TRPCError({ code: "FORBIDDEN" });

    const updates: Partial<typeof projects.$inferInsert> = {};
    if (input.title !== undefined) updates.title = input.title;
    if (input.artistName !== undefined) updates.artistName = input.artistName;
    if (input.artistEmail !== undefined) {
      updates.artistEmail = input.artistEmail.toLowerCase();
    }
    if (Object.keys(updates).length === 0) {
      return { ok: true as const };
    }
    updates.updatedAt = new Date();
    await ctx.db.update(projects).set(updates).where(eq(projects.id, input.id));
    return { ok: true as const };
  }),

  // Manual charge inserted from the Money sub-tab. Status defaults to
  // 'sent' so the row counts toward Outstanding in the money strip
  // until the producer marks it paid out-of-band.
  addInvoice: producerProcedure.input(AddInvoiceInput).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select({ producerId: projects.producerId })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    if (row.producerId !== ctx.producerId) throw new TRPCError({ code: "FORBIDDEN" });

    const [inserted] = await ctx.db
      .insert(invoices)
      .values({
        producerId: ctx.producerId,
        projectId: input.projectId,
        amountCents: input.amountCents,
        currency: input.currency.toUpperCase(),
        description: input.description,
        // Free-text role: 'manual' for entries the producer punches in
        // by hand from the Money sub-tab. Distinct from 'deposit' /
        // 'final' / 'milestone' which are wired to Stripe lifecycle
        // events.
        kind: "manual",
        status: "sent",
      })
      .returning();
    if (!inserted) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return { ok: true as const, id: inserted.id };
  }),

  // Moves a project between kanban columns. Ownership-checked; bumps
  // updatedAt so the column re-sorts to float the dragged card.
  //
  // BLOCKED stages: `cancelled` + `payment_paused`. Both have Stripe
  // side-effects that this mutation does NOT handle.
  //   - cancelled: must call subscriptionSchedules.cancel BEFORE the DB
  //     write to stop future installment charges. Producer-driven cancel
  //     belongs in the dedicated `cancel` mutation (Cancel project button)
  //     which orchestrates Stripe + DB together.
  //   - payment_paused: set automatically by `customer.subscription.paused`
  //     after Smart Retries exhaust. Letting the producer flip this
  //     manually detaches Skitza state from Stripe state.
  // The stage column accepts both values (a project CAN be in those
  // stages — just not via this dropdown), so the dropdown UI also drops
  // them as selectable options.
  setStage: producerProcedure.input(SetStageInput).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select({
        producerId: projects.producerId,
        paidAt: projects.paidAt,
      })
      .from(projects)
      .where(eq(projects.id, input.id))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    if (row.producerId !== ctx.producerId) throw new TRPCError({ code: "FORBIDDEN" });
    const now = new Date();
    // Stamp paid_at on FIRST transition into stage='paid'. Idempotent:
    // re-calling setStage with stage='paid' on a row that already has
    // paid_at set leaves the original timestamp untouched. This keeps
    // the "first time the producer marked this paid" signal stable for
    // the Overview timeline. Stripe-webhook auto-flip is intentionally
    // not wired here — that's Phase H's surface.
    // Loose nullish check covers both `null` (canonical never-paid) and
    // `undefined` (column missing from a partial select projection).
    const setPaidAt = input.stage === "paid" && row.paidAt == null;
    await ctx.db
      .update(projects)
      .set({
        stage: input.stage,
        updatedAt: now,
        ...(setPaidAt ? { paidAt: now } : {}),
      })
      .where(eq(projects.id, input.id));
    return { ok: true as const };
  }),

  // Bulk variant of setStage for the Projects-list multi-select.
  // UPDATE is scoped to producer_id so a tampered id array can't mutate
  // another producer's projects — the WHERE clause on the UPDATE itself
  // is the auth boundary, cheaper than N round-trips to verify each id
  // first.
  setStageBulk: producerProcedure
    .input(
      z.object({
        ids: z.array(z.string().uuid()).min(1).max(200),
        stage: SetStageInput.shape.stage,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      await ctx.db
        .update(projects)
        .set({ stage: input.stage, updatedAt: now })
        .where(
          and(
            eq(projects.producerId, ctx.producerId),
            inArray(projects.id, input.ids),
          ),
        );
      return { ok: true as const, count: input.ids.length };
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

  // Manual stage advance for a single track. Used by both the Upload
  // Track modal (when the producer opts to bump the stage on upload)
  // and the standalone ChangeStageMenu on Song Space. Ownership chain:
  // track → project → producer. NOT_FOUND if the track id is bogus;
  // FORBIDDEN if the producer doesn't own the parent project.
  setTrackStage: producerProcedure
    .input(
      z.object({
        trackId: z.string().uuid(),
        workflowStage: z.enum([
          "brief",
          "production",
          "mixing",
          "mastering",
          "done",
        ]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [track] = await ctx.db
        .select({
          id: projectTracks.id,
          projectId: projectTracks.projectId,
        })
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

      await ctx.db
        .update(projectTracks)
        .set({ workflowStage: input.workflowStage })
        .where(eq(projectTracks.id, input.trackId));

      await ctx.db
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, track.projectId));

      return { ok: true as const, workflowStage: input.workflowStage };
    }),

  // Inline-edit a track title from the Project Room music sub-tab.
  // Ownership-scoped via the UPDATE's WHERE clause (id + projectId +
  // producerId chain) so a tampered trackId from another project
  // cannot land here.
  updateTrackTitle: producerProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        trackId: z.string().uuid(),
        title: z.string().min(1).max(120),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [proj] = await ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.producerId, ctx.producerId),
          ),
        )
        .limit(1);
      if (!proj) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db
        .update(projectTracks)
        .set({ title: input.title })
        .where(
          and(
            eq(projectTracks.id, input.trackId),
            eq(projectTracks.projectId, input.projectId),
          ),
        );
      await ctx.db
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, input.projectId));
      return { ok: true as const };
    }),

  // Inline-edit a version label. Ownership chain: version → track →
  // project → producer. We verify all three links so neither a foreign
  // versionId nor a foreign projectId can route through this mutation.
  updateVersionLabel: producerProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        versionId: z.string().uuid(),
        label: z.string().min(1).max(40),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({
          projectId: projectTracks.projectId,
          producerId: projects.producerId,
        })
        .from(trackVersions)
        .innerJoin(
          projectTracks,
          eq(projectTracks.id, trackVersions.trackId),
        )
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .where(eq(trackVersions.id, input.versionId))
        .limit(1);
      if (
        !row ||
        row.producerId !== ctx.producerId ||
        row.projectId !== input.projectId
      ) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db
        .update(trackVersions)
        .set({ label: input.label })
        .where(eq(trackVersions.id, input.versionId));
      await ctx.db
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, input.projectId));
      return { ok: true as const };
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

    // NOTE: artist email moved to audio.completeMultipart (C1). When the
    // modal creates this row with audioUrl=null and patches the URL after
    // R2 completion, sending the email here would point the artist at a
    // missing file.

    return row;
  }),

  setPaid: producerProcedure.input(SetPaidInput).mutation(async ({ ctx, input }) => {
    const [project] = await ctx.db
      .select({
        producerId: projects.producerId,
        title: projects.title,
        artistName: projects.artistName,
        artistEmail: projects.artistEmail,
        totalAmountCents: projects.totalAmountCents,
        currency: projects.currency,
      })
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

    if (input.value) {
      const [producerRow] = await ctx.db
        .select({ displayName: producers.displayName })
        .from(producers)
        .where(eq(producers.id, ctx.producerId))
        .limit(1);
      const total = project.totalAmountCents ?? 0;
      const amountCents =
        input.kind === "deposit" ? Math.floor(total / 2) : total - Math.floor(total / 2);
      after(async () => {
        try {
          await sendPaymentReceivedEmail(project.artistEmail, {
            producerName: producerRow?.displayName ?? "Your producer",
            artistName: project.artistName,
            projectName: project.title,
            amountCents,
            platformFeeCents: 0,
            currency: project.currency ?? "USD",
            viewUrl: `${SITE_URL}/artist`,
          });
        } catch (err) {
          console.error("[email] payment-received failed", err);
        }
      });
    }

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

      // Currency: read from the project row directly (Important 3 —
      // single source of truth). Snapshotted at publicRequest time so
      // a mid-engagement product currency change can't desync the modal
      // from the actual charge. Falls back to deposit-invoice currency
      // for legacy rows that pre-date migration 0023.
      let currency = (project.currency ?? "").toLowerCase();
      if (!currency) {
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
        currency = (depositInvoice?.currency ?? "USD").toLowerCase();
      }

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

  // ── Task 9 ─────────────────────────────────────────────────────────
  // Producer cancels a project mid-flight. Money-handling — we MUST
  // stop future Stripe charges before the next billing cycle hits.
  //
  // Behaviour by plan kind:
  //   - monthly: cancel the Subscription Schedule on the platform
  //     account (destination charges, so no `{ stripeAccount }` header).
  //     Stripe fires `customer.subscription.deleted`, which Task 6's
  //     handler also coerces to stage='cancelled' — idempotent with the
  //     direct DB write we do here.
  //   - full / split_50_50 / never-paid: no schedule to cancel; just
  //     update the stage. Full was charged at checkout; split's second
  //     half is producer-triggered (chargeFinal), so neither has any
  //     auto-future-charge to stop.
  //
  // Idempotency:
  //   - If project.stage is already 'cancelled', return success without
  //     re-calling Stripe (avoid noisy logs + unnecessary API calls).
  //   - Stripe's subscriptionSchedules.cancel is itself idempotent on
  //     their side, but if the schedule was already released/ended we
  //     get a thrown error — caught + treated as success below.
  //
  // No refund action. Refund policy lives in the contract; producers
  // refund via Stripe Dashboard manually if they want to.
  cancel: producerProcedure
    .input(CancelProjectInput)
    .mutation(async ({ ctx, input }) => {
      // 1. Project exists + ownership check.
      const [project] = await ctx.db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.producerId, ctx.producerId),
          ),
        )
        .limit(1);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      // 2. Type-to-confirm guard. Exact, case-sensitive match — no
      //    trim, no fuzz. The producer typed it; we honor it.
      if (project.title !== input.confirmTitle) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Confirmation title mismatch",
        });
      }

      // 3. Already-finalized projects can't be cancelled; the engagement
      //    is over. Refund flows through Stripe Dashboard.
      if (project.stage === "paid" || project.stage === "archived") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Project is already finished; cannot cancel.",
        });
      }

      // 4. If a monthly schedule is in flight, stop it. Schedule lives
      //    on the platform account (we use destination charges for the
      //    Connect split), so the call is a plain platform API call —
      //    no `{ stripeAccount }` header.
      if (project.stripeSubscriptionScheduleId) {
        const stripe = getStripe();
        try {
          await stripe.subscriptionSchedules.cancel(
            project.stripeSubscriptionScheduleId,
          );
        } catch (err) {
          // Stripe returns an InvalidRequestError if the schedule has
          // already been released/cancelled/ended. Treat as success so
          // a webhook race doesn't surface a false failure to the UI.
          const message = err instanceof Error ? err.message : String(err);
          if (/already.*(cancel|release|ended|completed)/i.test(message)) {
            // fall through — the schedule is already in a terminal state
          } else {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Stripe cancel failed: ${message}`,
              cause: err,
            });
          }
        }
      }

      // 5. Set stage to archived so the producer sees the result without
      //    waiting for the webhook roundtrip.
      await ctx.db
        .update(projects)
        .set({ stage: "archived", updatedAt: new Date() })
        .where(eq(projects.id, project.id));

      return { ok: true as const };
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
        .select({ projectId: projectTracks.projectId, title: projectTracks.title })
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

      after(async () => {
        try {
          await sendProducerRepliedToCommentEmail(p.artistEmail, {
            artistName: p.artistName,
            producerName: producerRow?.displayName ?? "Your producer",
            trackTitle: t.title,
            replyBody: input.body,
            threadUrl: `${SITE_URL}/artist/music`,
          });
        } catch (err) {
          console.error("[email] producer-replied-to-comment failed", err);
        }
      });

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
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return { project: stripHash(row), shareToken: token.raw, existing: false };
    }),

  // Clients & Projects v3 redesign — Phase 1 Task 15. Drag-to-reorder
  // for the Projects list. Writes the new ordinals (position == index
  // in orderedIds) inside a single ctx.db.transaction so a partial
  // failure can't leave the list half-reordered. Ownership verified by
  // selecting all matching producerIds in one query before any write.
  // Idempotent: calling with the same order is a no-op DB write.
  // Mirrors the precedents in booking.products.reorder and
  // clientContacts.reorder.
  reorder: producerProcedure
    .input(
      z.object({
        orderedIds: z
          .array(z.string().uuid())
          .min(1)
          .refine(
            (arr) => new Set(arr).size === arr.length,
            "duplicate ids are not allowed",
          ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ id: projects.id, producerId: projects.producerId })
        .from(projects)
        .where(inArray(projects.id, input.orderedIds));
      if (rows.length !== input.orderedIds.length) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (rows.some((r) => r.producerId !== ctx.producerId)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db.transaction(async (tx) => {
        for (const [idx, id] of input.orderedIds.entries()) {
          await tx
            .update(projects)
            .set({ position: idx })
            .where(eq(projects.id, id));
        }
      });
      return { count: input.orderedIds.length };
    }),

});
