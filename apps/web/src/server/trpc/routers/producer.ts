import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  bookings,
  desc,
  eq,
  gte,
  inArray,
  invoices,
  isNotNull,
  isNull,
  lte,
  portfolioTracks,
  producers,
  projectTracks,
  projects,
  sql,
  trackComments,
  trackVersions,
} from "@skitza/db";
import { z } from "zod";

import { producerGradient } from "../../../lib/_phase4-stubs/producer-color";
import type { Stage } from "../../../lib/projects/stages";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { stripUndefined } from "../strip-undefined";

// Accepts a subset of producer-editable fields. The schema's cascade is
// designed so any of these can change without orphaning related data.
// Slug uniqueness is enforced at the DB level; we catch + rethrow with
// a friendlier message in the update mutation.
const BrandInput = z.object({
  // Hex colors stored as "#rrggbb" — the theme-resolver reads this into
  // CSS `--brand-primary` at request time (apps/web/src/lib/branding/
  // theme-resolver.ts). No other shape is honored.
  primary: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "primary must be a 6-digit hex color (#rrggbb)")
    .optional(),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "accent must be a 6-digit hex color (#rrggbb)")
    .optional(),
  // Logo URL — external for v1; R2 uploads land in weeks 6-8. Trim to
  // keep the jsonb payload small.
  logoUrl: z.string().url().max(512).optional(),
  // Font is a forward-looking slot; currently read by theme-resolver but
  // not yet exposed to the UI. Keep the input shape stable.
  font: z.string().max(64).optional(),
});

// Settings redesign — known notification event keys. Lives next to the
// router so the input validator can pin the allowed keys at the wire
// layer. Adding a new event is a one-line entry here + one row in the
// client's NOTIFICATION_EVENTS list. Six events match the design spec
// (booking, approval, payment, overdue, comment, weekly).
export const NOTIFICATION_EVENT_KEYS = [
  "booking",
  "approval",
  "payment",
  "overdue",
  "comment",
  "weekly",
] as const;
export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number];

// Single-channel state for one event. Shape mirrors the jsonb column.
const NotificationChannelInput = z.object({
  email: z.boolean(),
  app: z.boolean(),
});

// Full notification-prefs map — partial: a save can ship only the keys
// that changed. The DB column merges (we fetch → spread → write) so
// missing keys keep their existing values. Unknown keys are stripped
// by the zod parser so a future event rename can't smuggle in stale
// data via an old client.
const NotificationPrefsInput = z
  .object(
    Object.fromEntries(
      NOTIFICATION_EVENT_KEYS.map((k) => [k, NotificationChannelInput.optional()]),
    ) as Record<NotificationEventKey, z.ZodOptional<typeof NotificationChannelInput>>,
  )
  .partial();

const UpdateInput = z.object({
  displayName: z.string().min(1).max(80).optional(),
  slug: z
    .string()
    .min(3)
    .max(48)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, numbers, and dashes")
    .optional(),
  defaultCurrency: z.enum(["USD", "EUR", "GBP", "ILS"]).optional(),
  timezone: z.string().min(1).max(64).optional(),
  brand: BrandInput.optional(),
  // Settings redesign — calendar week orientation. Two values only;
  // the segmented control in Settings → Language & region writes here.
  // Also written by the Calendar availability panel and the onboarding
  // availability step (via useWeekStartPref).
  weekStart: z.enum(["sunday", "monday"]).optional(),
  // Settings redesign — per-event notification preferences. Partial
  // merge: only the event keys present in the payload get rewritten.
  notificationPrefs: NotificationPrefsInput.optional(),
});

// Marketing-grade meta the producer surfaces on their public /join page.
// Each field is independently nullable so a producer can clear one stat
// without wiping the others. `genres` is a free-text array — capped at
// 8 entries × 32 chars to keep the band compact and the column small.
// `responseHours` is a constrained enum (24 | 48 | 168) so the
// formatter has a known set of friendly strings to render; passing
// `null` clears the response stat entirely (the dropdown's "Hidden"
// option). Migration 0006.
const MarketingInput = z.object({
  genres: z
    .array(z.string().trim().min(1).max(32))
    .max(8)
    .nullable()
    .optional(),
  releasedSummary: z.string().trim().max(80).nullable().optional(),
  streamsSummary: z.string().trim().max(80).nullable().optional(),
  responseHours: z
    .union([z.literal(24), z.literal(48), z.literal(168), z.null()])
    .optional(),
});

// ─── Autopilot toggles (Batch G) ───────────────────────────────────
// The UI contract is deliberately tiny: one key + one boolean per
// switch flip. No rule-builder, no conditions. The router maps the
// five known keys onto the matching drizzle column. Adding a new
// autopilot is a one-line entry here + a column in the schema.
const AUTOPILOT_COLUMN_MAP = {
  welcomeEmail: "autopilotWelcomeEmail",
  unpaidReminder: "autopilotUnpaidReminder",
  requestTestimonial: "autopilotRequestTestimonial",
  commentNotify: "autopilotCommentNotify",
  autoArchive: "autopilotAutoArchive",
} as const satisfies Record<string, keyof typeof producers.$inferInsert>;

export type AutopilotKey = keyof typeof AUTOPILOT_COLUMN_MAP;

const AutopilotInput = z.object({
  key: z.enum(
    Object.keys(AUTOPILOT_COLUMN_MAP) as [AutopilotKey, ...AutopilotKey[]],
  ),
  enabled: z.boolean(),
});

// ─── Helpers (producer.today item shaping) ─────────────────────────
function truncate(s: string, max: number): string {
  const trimmed = s.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function formatInvoiceSubtitle(
  amountCents: number,
  currency: string,
  description: string | null,
): string {
  // cents → display units via Intl. Explicit 0-digit formatter keeps
  // whole-dollar amounts compact (“$250”), which reads better in a
  // list row than “$250.00”.
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amountCents / 100);
  return description ? `${amount} · ${description}` : amount;
}

// Shape returned by `producer.today`. One row per actionable thing the
// producer should look at in the current day. KPI counts ride
// alongside so the UI renders the strip + the inbox in a single call.
export type TodayKind = "session" | "comment" | "invoice";
export interface TodayItem {
  id: string;
  kind: TodayKind;
  title: string;
  subtitle: string;
  occurredAt: Date;
  href: string;
  unread: boolean;
}

// Items list is capped at 50 in total. Big enough to avoid pagination
// for an active producer, small enough that the DOM stays honest.
const TODAY_ITEMS_MAX = 50;

// Recent-uploads shelf cap. 5 cards visible + 2 buffer for scroll.
// Capped server-side so a producer with hundreds of versions doesn't
// pay the JSON-serialization cost of rows that won't render.
const RECENT_UPLOADS_MAX = 7;

// Pulse sparkline length — fixed at 30 daily buckets, oldest at index
// 0 and today at index 29. Always exactly 30 entries: missing days are
// zero-filled rather than skipped, so the chart geometry is stable.
const PULSE_SPARKLINE_DAYS = 30;

// One row of the recent-uploads shelf. Renders as a card in the Today
// dashboard's STUDIO · RECENT UPLOADS rail (Story 3 of the redesign).
// `audioUrl` is non-null because the SQL filter excludes in-flight
// uploads via `isNotNull(trackVersions.audioUrl)`. `unreadComments` is
// the per-row count of artist-side, unresolved comments posted after
// `uploadedAt` — fetched as a follow-up sub-query.
export type RecentUpload = {
  versionId: string;
  trackId: string;
  title: string;
  versionLabel: string;
  uploadedAt: Date;
  audioUrl: string;
  durationMs: number | null;
  projectId: string;
  projectClientName: string;
  projectStage: Stage;
  unreadComments: number;
};

// Single-card payload powering the Pulse summary on the redesigned
// Today dashboard (Story 2). Footer counts re-project the existing
// `kpis` fields so the renderer doesn't drift from the strip — they're
// derived from the same fan-out legs, no extra round-trips.
//
// `deltaPct === null` is the "no comparison possible" signal — used
// when last month had no paid invoices, to avoid `+∞%` rendering.
// `sparkline` is always exactly PULSE_SPARKLINE_DAYS long (zero-filled
// missing days), so the SVG geometry is stable for the consuming
// component regardless of producer activity.
export type PulseStats = {
  thisMonthCents: number;
  lastMonthCents: number;
  currency: string;
  deltaPct: number | null;
  sparkline: number[];
  activeProjects: number;
  upcomingSessions7d: number;
  unresolvedItems: number;
};

// Music library cap — Samply-style cross-project list of every track
// version the producer has uploaded, newest first. 100 rows is enough
// to cover the last few months of even a busy mix engineer; pagination
// is deferred until someone actually overflows.
const MUSIC_LIST_MAX = 100;
// Upper bound on rows pulled PER source in the fan-out. Matches the
// overall TODAY_ITEMS_MAX so a single active kind (e.g. 50 upcoming
// sessions in a busy week) can fill the entire payload. The outer
// .slice(0, TODAY_ITEMS_MAX) still caps the total; this just prevents
// a runaway "SELECT all comments for this producer" from returning
// thousands of rows.
const TODAY_PER_SOURCE_CAP = 50;

// Strict type ordering: sessions first (time-sensitive), then
// unread comments (artist is waiting), then unpaid invoices (money).
// Within each kind we sort by occurredAt (asc for upcoming sessions
// — soonest first; desc for everything else — most recent first).
// This matches the plan's documented "session > unread comment >
// invoice" rule without inventing a composite score.
const KIND_PRIORITY: Record<TodayKind, number> = {
  session: 0,
  comment: 1,
  invoice: 2,
};

// ─── Overview · Urgent helpers ────────────────────────────────────────
// Project-level urgency classification. The Overview's Urgent card
// surfaces three rules in priority order:
//
//   1. `overdue`      — a booked project whose final invoice is unpaid
//                       AND the last session ended >7 days ago AND
//                       there's no future session on the calendar.
//   2. `deposit_due`  — project is in the `booked` stage but the
//                       producer hasn't recorded a deposit yet, and the
//                       project has been sitting for >2 days.
//   3. `stuck`        — project is in `in_production` but no track
//                       version has been uploaded in >14 days.
//
// Sort order in the response is overdue → deposit_due → stuck. The
// surface caps at 3 by default but accepts an optional `limit` input
// for non-default consumers (e.g. a future "all urgent" page).
export type UrgencyKind = "overdue" | "deposit_due" | "stuck";

export interface UrgentProjectItem {
  id: string;
  title: string;
  clientName: string;
  /** Linear-gradient string usable as a `style.background` value. */
  gradient: string;
  stage: Stage;
  urgency: UrgencyKind;
}

const URGENT_DEFAULT_LIMIT = 3;

const URGENCY_PRIORITY: Record<UrgencyKind, number> = {
  overdue: 0,
  deposit_due: 1,
  stuck: 2,
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_DAYS = 7;
const DEPOSIT_DUE_DAYS = 2;
const STUCK_DAYS = 14;

interface ClassifyArgs {
  stage: Stage;
  depositPaid: boolean;
  finalPaid: boolean;
  updatedAt: Date;
  lastUploadAt: Date | null;
  lastBookingEndAt: Date | null;
  hasFutureSession: boolean;
  now: Date;
}

/**
 * Classify a single project into one of the three urgency buckets, or
 * `null` if the project isn't currently urgent. Pure function — no DB
 * access — so tests can drive it directly without mocking.
 *
 * Rules apply in priority order: the first matching rule wins.
 */
export function classifyUrgency(args: ClassifyArgs): UrgencyKind | null {
  const {
    stage,
    depositPaid,
    finalPaid,
    updatedAt,
    lastUploadAt,
    lastBookingEndAt,
    hasFutureSession,
    now,
  } = args;

  // 1. OVERDUE — final isn't paid, the last booking ended more than
  //    OVERDUE_DAYS ago, and there's nothing on the calendar to bring
  //    the project back into motion.
  if (
    !finalPaid &&
    !hasFutureSession &&
    lastBookingEndAt !== null &&
    now.getTime() - lastBookingEndAt.getTime() > OVERDUE_DAYS * ONE_DAY_MS
  ) {
    return "overdue";
  }

  // 2. DEPOSIT DUE — the project is booked but no deposit has been
  //    recorded, and the row has been idle for at least DEPOSIT_DUE_DAYS.
  //    The idle check uses `updatedAt` rather than `createdAt` so a
  //    project the producer is actively poking at doesn't immediately
  //    light up red — we give them ~2 days to log the deposit.
  if (
    stage === "booked" &&
    !depositPaid &&
    now.getTime() - updatedAt.getTime() > DEPOSIT_DUE_DAYS * ONE_DAY_MS
  ) {
    return "deposit_due";
  }

  // 3. STUCK — in-production project with no uploads in >STUCK_DAYS.
  //    A project that has NEVER had an upload still counts as stuck if
  //    it's been in production for that long; we use the project's
  //    updatedAt as the floor so brand-new projects don't trigger.
  if (stage === "in_production") {
    const reference = lastUploadAt ?? updatedAt;
    if (now.getTime() - reference.getTime() > STUCK_DAYS * ONE_DAY_MS) {
      return "stuck";
    }
  }

  return null;
}

export const producerRouter = router({
  // Current producer's profile — used by Settings to populate the form.
  // Same producerProcedure middleware so the SELECT is tenant-scoped
  // (UserId → Producer row) + the empty-row race is already handled by
  // the middleware throwing UNAUTHORIZED.
  me: producerProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select()
      .from(producers)
      .where(eq(producers.id, ctx.producerId))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    // Don't leak Stripe/Clerk IDs to the client — the UI only needs the
    // editable + display surface.
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      slug: row.slug,
      defaultCurrency: row.defaultCurrency,
      timezone: row.timezone,
      brand: row.brand ?? {},
      // Phase H.5 — surface Stripe Connect status flags so the
      // settings page can render "not connected / pending / connected"
      // without an extra round-trip. We don't surface the raw
      // accountId — the dashboard link mutation hands out a one-shot
      // signed URL when the producer asks for it.
      stripeConnected: Boolean(row.stripeAccountId),
      stripeChargesEnabled: row.stripeChargesEnabled,
      // Batch G — five Autopilot flags. Returned as a single nested
      // object so the client can spread `autopilot` into state without
      // pulling each field individually.
      autopilot: {
        welcomeEmail: row.autopilotWelcomeEmail,
        unpaidReminder: row.autopilotUnpaidReminder,
        requestTestimonial: row.autopilotRequestTestimonial,
        commentNotify: row.autopilotCommentNotify,
        autoArchive: row.autopilotAutoArchive,
      },
      // Marketing meta surfaced on the public /join page (migration
      // 0005). Settings → Profile renders the editor against this
      // shape and producer.updateMarketing is the write path.
      marketing: {
        genres: row.genres ?? null,
        releasedSummary: row.releasedSummary,
        streamsSummary: row.streamsSummary,
        responseHours: row.responseHours,
      },
      // Settings redesign — plan tier (UI-only for v1; no Stripe
      // subscription wiring yet). Returned as a string the client
      // narrows to 'free' | 'pro'.
      plan: row.plan,
      // Calendar week orientation. UI flips this between 'sun' / 'mon'.
      weekStart: row.weekStart,
      // Per-event notification preferences. Empty object when the
      // producer hasn't touched the matrix yet — the client fills in
      // design defaults for missing keys (see resolveNotificationPrefs
      // on the client).
      notificationPrefs: row.notificationPrefs,
    };
  }),

  // ─── Marketing meta editor (Settings → Profile) ─────────────────────
  // Single mutation that accepts a partial of the marketing fields and
  // writes them onto the producers row. We accept `null` per-field so
  // the producer can clear an individual stat (e.g. "Hidden" on the
  // response-time picker). `undefined` means "don't touch this field" —
  // letting the form ship a minimal patch the same way `update` does.
  updateMarketing: producerProcedure
    .input(MarketingInput)
    .mutation(async ({ ctx, input }) => {
      // stripUndefined drops keys whose value is undefined, but keeps
      // explicit nulls — Drizzle's update() then writes NULL into the
      // column for those keys. That's the contract this surface needs:
      // null = "clear this stat", omitted = "leave it alone".
      const patch: Record<string, unknown> = {};
      if (input.genres !== undefined) patch.genres = input.genres;
      if (input.releasedSummary !== undefined) {
        const trimmed = input.releasedSummary?.trim() ?? null;
        patch.releasedSummary = trimmed === "" ? null : trimmed;
      }
      if (input.streamsSummary !== undefined) {
        const trimmed = input.streamsSummary?.trim() ?? null;
        patch.streamsSummary = trimmed === "" ? null : trimmed;
      }
      if (input.responseHours !== undefined) {
        patch.responseHours = input.responseHours;
      }

      // Empty patch is a no-op — early return avoids a needless
      // updatedAt bump on the producer row.
      if (Object.keys(patch).length === 0) {
        return { ok: true as const };
      }

      patch.updatedAt = new Date();
      await ctx.db
        .update(producers)
        .set(patch)
        .where(eq(producers.id, ctx.producerId));
      return { ok: true as const };
    }),

  // Batch G — flip a single Autopilot switch. Tiny, named mutation:
  // the client sends { key, enabled }, we map key → column, stamp it.
  // Scoping: producer-procedure already resolved ctx.producerId from
  // the caller's Clerk userId; the UPDATE's WHERE clause pins the
  // write to that row and nothing else.
  updateAutopilot: producerProcedure
    .input(AutopilotInput)
    .mutation(async ({ ctx, input }) => {
      const column = AUTOPILOT_COLUMN_MAP[input.key];
      // Dynamic column assignment — each of the 5 columns is a plain
      // boolean so the shape of the payload is known at compile time.
      // `[column]: input.enabled` is the whole payload.
      await ctx.db
        .update(producers)
        .set({ [column]: input.enabled, updatedAt: new Date() })
        .where(eq(producers.id, ctx.producerId));
      return { ok: true as const };
    }),

  // Producer's "Today" dashboard — one call returns the four KPI
  // counters AND the unified inbox of actionable items (upcoming
  // sessions, unread comments, unpaid invoices). Pattern mirrors
  // `artist.home`: one Promise.all fan-out across the sources, each
  // WHERE-scoped to ctx.producerId, then shape + sort + cap.
  //
  // `savedViews` returns [] — persisting a user's saved filter requires
  // a new table, deferred to a later task.
  today: producerProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const horizon7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    // Calendar-month boundaries in UTC. Matches the booking.revenue
    // pattern so producers who flip between surfaces see consistent
    // numbers across month rollovers.
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const nextMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    // Last calendar-month boundary — for the Pulse "vs last month"
    // delta. paidAt in [lastMonthStart, monthStart) is the prior
    // month's revenue.
    const lastMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    // 30-day window for the Pulse sparkline. Anchored to the start of
    // today (UTC) so the rightmost bucket consistently includes today's
    // partial-day revenue without rolling over at noon.
    const sparklineStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    sparklineStart.setUTCDate(
      sparklineStart.getUTCDate() - (PULSE_SPARKLINE_DAYS - 1),
    );

    // Active stages for the KPI counter — excludes terminal states so
    // "archived" projects don't inflate the count.
    const ACTIVE_STAGES = [
      "lead",
      "booked",
      "in_production",
      "final_review",
    ] as const;

    // Unpaid = anything NOT in {paid, refunded, void}. Matches the
    // artist-home outstanding-balance heuristic — draft + sent +
    // uncollectible all represent money the producer is still owed.
    const UNPAID_STATUSES = ["draft", "sent", "uncollectible"] as const;

    // Fan out across the data sources in parallel. Each query is
    // independently producer-scoped (WHERE producer_id = ctx.producerId)
    // so a regression in any single sub-query can't leak other
    // producers' data. The producer profile lookup rides along as a
    // separate leg — it has no data dependency on the other queries, so
    // running it sequentially would just add tail latency.
    const [
      activeProjectRows,
      revenueRows,
      unpaidCountRows,
      upcomingRows,
      openCommentsCountRows,
      unpaidInvoiceRows,
      openCommentRows,
      profileRows,
      recentUploadRows,
      lastMonthRows,
      sparklineRows,
    ] = await Promise.all([
      // (1) Active projects KPI — count by filtering stage in the
      // active set. We fetch ids only; the count is rows.length.
      ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.producerId, ctx.producerId),
            inArray(projects.stage, [...ACTIVE_STAGES]),
          ),
        ),

      // (2) Revenue-this-month KPI — sum of paid invoices whose
      // paidAt falls in the current calendar month. Fetch raw
      // amountCents/currency so currency-mismatched rows can be
      // filtered in JS (the producer's defaultCurrency is the anchor).
      ctx.db
        .select({
          amountCents: invoices.amountCents,
          currency: invoices.currency,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.producerId, ctx.producerId),
            eq(invoices.status, "paid"),
            gte(invoices.paidAt, monthStart),
            lte(invoices.paidAt, nextMonthStart),
          ),
        ),

      // (3) Unpaid-invoices count (feeds unresolvedItems KPI piece #1).
      ctx.db
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.producerId, ctx.producerId),
            inArray(invoices.status, [...UNPAID_STATUSES]),
          ),
        ),

      // (4) Upcoming sessions — confirmed bookings in [now, now+7d].
      // Also reused for the items list so we pull full fields.
      // projectId is nullable on bookings (the FK is `set null` so a
      // deleted project leaves its sessions in place); the session
      // item's `href` falls back to the calendar when no project is
      // attached so a click never lands on a dead URL.
      ctx.db
        .select({
          id: bookings.id,
          startsAt: bookings.startsAt,
          durationMin: bookings.durationMin,
          artistName: bookings.artistName,
          packageNameSnapshot: bookings.packageNameSnapshot,
          projectId: bookings.projectId,
        })
        .from(bookings)
        .where(
          and(
            eq(bookings.producerId, ctx.producerId),
            eq(bookings.status, "confirmed"),
            gte(bookings.startsAt, now),
            lte(bookings.startsAt, horizon7d),
          ),
        )
        .orderBy(asc(bookings.startsAt))
        .limit(TODAY_PER_SOURCE_CAP),

      // (5) Open-comments count (feeds unresolvedItems KPI piece #2).
      // Comments live on track_versions → project_tracks → projects;
      // we join through to scope on projects.producerId. Only
      // *artist-side* unresolved comments count — producer's own
      // comments are their own notes, not a to-do.
      ctx.db
        .select({ id: trackComments.id })
        .from(trackComments)
        .innerJoin(trackVersions, eq(trackVersions.id, trackComments.versionId))
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .where(
          and(
            eq(projects.producerId, ctx.producerId),
            isNull(trackComments.resolvedAt),
            eq(trackComments.fromProducer, false),
          ),
        ),

      // (6) Unpaid invoice rows (for items list).
      ctx.db
        .select({
          id: invoices.id,
          amountCents: invoices.amountCents,
          currency: invoices.currency,
          description: invoices.description,
          customerName: invoices.customerName,
          createdAt: invoices.createdAt,
          projectId: invoices.projectId,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.producerId, ctx.producerId),
            inArray(invoices.status, [...UNPAID_STATUSES]),
          ),
        )
        .orderBy(desc(invoices.createdAt))
        .limit(TODAY_PER_SOURCE_CAP),

      // (7) Open comment rows (for items list) — same join chain as (5)
      // but now with projection the UI needs.
      ctx.db
        .select({
          id: trackComments.id,
          body: trackComments.body,
          authorName: trackComments.authorName,
          createdAt: trackComments.createdAt,
          projectId: projects.id,
        })
        .from(trackComments)
        .innerJoin(trackVersions, eq(trackVersions.id, trackComments.versionId))
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .where(
          and(
            eq(projects.producerId, ctx.producerId),
            isNull(trackComments.resolvedAt),
            eq(trackComments.fromProducer, false),
          ),
        )
        .orderBy(desc(trackComments.createdAt))
        .limit(TODAY_PER_SOURCE_CAP),

      // (8) Producer's default currency — needed for the KPI payload's
      // revenue display. No data dependency on the other legs, so we
      // run it in parallel instead of after the fan-out.
      ctx.db
        .select({ defaultCurrency: producers.defaultCurrency })
        .from(producers)
        .where(eq(producers.id, ctx.producerId))
        .limit(1),

      // (9) Recent uploads shelf (Today redesign Story 3). Up to 7
      // most-recent track versions across the producer's *active*
      // projects, with audioUrl present (in-flight uploads excluded).
      // Joins through projectTracks → projects so the producer-scope
      // predicate sits on `projects.producerId` — same pattern as
      // legs 5 + 7.
      ctx.db
        .select({
          versionId: trackVersions.id,
          trackId: projectTracks.id,
          title: projectTracks.title,
          versionLabel: trackVersions.label,
          uploadedAt: trackVersions.uploadedAt,
          audioUrl: trackVersions.audioUrl,
          durationMs: trackVersions.durationMs,
          projectId: projects.id,
          projectClientName: projects.clientName,
          projectStage: projects.stage,
        })
        .from(trackVersions)
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .where(
          and(
            eq(projects.producerId, ctx.producerId),
            inArray(projects.stage, [...ACTIVE_STAGES]),
            isNotNull(trackVersions.audioUrl),
          ),
        )
        .orderBy(desc(trackVersions.uploadedAt))
        .limit(RECENT_UPLOADS_MAX),

      // (10) Last-month paid revenue (Pulse delta-vs-last-month).
      // Same shape as leg 2, just shifted one calendar month back.
      // We sum in JS so currency-mismatched legacy rows can be
      // dropped (defaultCurrency is the anchor).
      ctx.db
        .select({
          amountCents: invoices.amountCents,
          currency: invoices.currency,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.producerId, ctx.producerId),
            eq(invoices.status, "paid"),
            gte(invoices.paidAt, lastMonthStart),
            lte(invoices.paidAt, monthStart),
          ),
        ),

      // (11) 30-day daily sparkline (Pulse ambient chart). Aggregates
      // paid-invoice revenue into one row per UTC day. Days with no
      // revenue are absent from this result and zero-filled JS-side
      // before serializing — the consumer always gets a fixed-length
      // array so the SVG geometry is stable.
      ctx.db
        .select({
          day: sql<string>`date_trunc('day', ${invoices.paidAt})::date`,
          cents: sql<number>`COALESCE(SUM(${invoices.amountCents}), 0)::integer`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.producerId, ctx.producerId),
            eq(invoices.status, "paid"),
            gte(invoices.paidAt, sparklineStart),
          ),
        )
        .groupBy(sql`date_trunc('day', ${invoices.paidAt})`),
    ]);

    // Resolve default currency for KPI display. Fallback to USD keeps
    // the UI honest if the producer row ever has a NULL currency.
    const revenueCurrency = profileRows[0]?.defaultCurrency ?? "USD";

    // Sum only the rows whose currency matches the default. Legacy
    // mixed-currency ledgers aren't common but we don't want to add
    // 500 EUR to 500 USD and call it 1000.
    const revenueMonthCents = revenueRows.reduce((acc, r) => {
      return r.currency === revenueCurrency ? acc + r.amountCents : acc;
    }, 0);

    const kpis = {
      activeProjects: activeProjectRows.length,
      revenueMonthCents,
      revenueCurrency,
      upcomingSessions7d: upcomingRows.length,
      unresolvedItems: unpaidCountRows.length + openCommentsCountRows.length,
    };

    // ── Compose the unified items list ──────────────────────────────
    // Each source projects into the common TodayItem shape. occurredAt
    // drives the within-kind sort: future (sessions) use startsAt;
    // past events use createdAt.
    const sessionItems: TodayItem[] = upcomingRows.map((b) => ({
      id: `session:${b.id}`,
      kind: "session",
      title: b.artistName,
      subtitle: `${b.packageNameSnapshot ?? "Session"} · ${b.durationMin.toString()} min`,
      occurredAt: b.startsAt,
      // "Open client room" on the Overview screen routes here. The
      // legacy `/dashboard/booking?id=...` URL was retired in v3-clean
      // (D9 demolition) and now redirects to /dashboard/calendar via
      // middleware — the side-effect being that "Open client room"
      // was opening the calendar instead of the actual project room.
      // Routing through the project page (when a project is attached)
      // matches the button's promise; bookings without a project fall
      // back to the calendar where the producer can still see the
      // session detail.
      href: b.projectId
        ? `/dashboard/clients-projects/${b.projectId}`
        : `/dashboard/calendar`,
      unread: true,
    }));

    const commentItems: TodayItem[] = openCommentRows.map((c) => ({
      id: `comment:${c.id}`,
      kind: "comment",
      title: c.authorName,
      subtitle: truncate(c.body, 120),
      occurredAt: c.createdAt,
      href: `/dashboard/clients-projects/${c.projectId}`,
      unread: true,
    }));

    const invoiceItems: TodayItem[] = unpaidInvoiceRows.map((inv) => ({
      id: `invoice:${inv.id}`,
      kind: "invoice",
      title: inv.customerName ?? inv.description ?? "Invoice",
      subtitle: formatInvoiceSubtitle(
        inv.amountCents,
        inv.currency,
        inv.description,
      ),
      occurredAt: inv.createdAt,
      href: inv.projectId
        ? `/dashboard/clients-projects/${inv.projectId}`
        : "/dashboard/clients-projects",
      unread: false,
    }));

    const items = [...sessionItems, ...commentItems, ...invoiceItems]
      .sort((a, b) => {
        // Primary: kind priority (session → comment → invoice).
        const kp = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
        if (kp !== 0) return kp;
        // Within kind: sessions sort asc (soonest first), others desc.
        const at = a.occurredAt.getTime();
        const bt = b.occurredAt.getTime();
        return a.kind === "session" ? at - bt : bt - at;
      })
      .slice(0, TODAY_ITEMS_MAX);

    // Saved views aren't persisted yet — the UI treats [] as "no
    // saved views" and hides the chip rail. Shape stays so the client
    // doesn't have to special-case the missing field once views land.
    const savedViews: Array<{ id: string; label: string; filter: Record<string, string> }> = [];

    // ── Recent uploads shelf — unread-comments follow-up ────────────
    // Belt-and-braces cap: the SQL .limit(RECENT_UPLOADS_MAX) above
    // already constrains the result, but slicing here guarantees the
    // response shape holds even if a future query path drops the
    // DB-side limit (mirrors the same pattern used in producer.music.list).
    const recentUploadRowsCapped = recentUploadRows.slice(
      0,
      RECENT_UPLOADS_MAX,
    );

    // For each version returned by leg 10, count artist-side unresolved
    // comments posted after the version uploaded. We do this as N
    // sub-queries in parallel rather than a single GROUP BY: bound is
    // RECENT_UPLOADS_MAX (=7) so worst-case ~7 round-trips, well within
    // Today's p95 budget. If this ever climbs, batch as a single SELECT
    // with GROUP BY versionId.
    const unreadCommentCounts = await Promise.all(
      recentUploadRowsCapped.map((row) =>
        ctx.db
          .select({ id: trackComments.id })
          .from(trackComments)
          .where(
            and(
              eq(trackComments.versionId, row.versionId),
              eq(trackComments.fromProducer, false),
              isNull(trackComments.resolvedAt),
              gte(trackComments.createdAt, row.uploadedAt),
            ),
          ),
      ),
    );

    // Build the RecentUpload[] payload. audioUrl is non-null after the
    // isNotNull WHERE filter, but TypeScript doesn't know that — coerce
    // with `?? ""` and trust the DB-side filter. (We verified the SQL
    // predicate in tests.)
    const recentUploads: RecentUpload[] = recentUploadRowsCapped.map((row, i) => ({
      versionId: row.versionId,
      trackId: row.trackId,
      title: row.title,
      versionLabel: row.versionLabel,
      uploadedAt: row.uploadedAt,
      audioUrl: row.audioUrl ?? "",
      durationMs: row.durationMs,
      projectId: row.projectId,
      projectClientName: row.projectClientName ?? "",
      projectStage: row.projectStage,
      unreadComments: unreadCommentCounts[i]?.length ?? 0,
    }));

    // ── Pulse stats — assemble the single-card payload ──────────────
    // Last-month revenue: same currency-matched sum as leg 2's
    // revenueMonthCents. Mixed-currency rows are dropped (anchor =
    // producer's default currency).
    const lastMonthCents = lastMonthRows.reduce((acc, r) => {
      return r.currency === revenueCurrency ? acc + r.amountCents : acc;
    }, 0);

    // deltaPct: integer % change. null when last month was 0 — a
    // producer with no prior-month revenue has no comparison anchor,
    // and we'd render a meaningless +∞% otherwise.
    const deltaPct =
      lastMonthCents === 0
        ? null
        : Math.round(
            ((revenueMonthCents - lastMonthCents) / lastMonthCents) * 100,
          );

    // Sparkline: project DB rows into the fixed 30-bucket array.
    // Index 0 = (PULSE_SPARKLINE_DAYS - 1) days ago; index 29 = today.
    // The DB returns one row per day with revenue; days with no rows
    // get zero-filled.
    const sparkline: number[] = Array.from(
      { length: PULSE_SPARKLINE_DAYS },
      () => 0,
    );
    // Today (UTC midnight) — used as the zero-point for index math.
    const todayUtcMidnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    for (const row of sparklineRows) {
      // The driver may return `day` as a Date or as an ISO date string
      // (`YYYY-MM-DD`) depending on the postgres connector. Handle both.
      const dayValue: unknown = row.day;
      let dayDate: Date | null = null;
      if (dayValue instanceof Date) {
        dayDate = dayValue;
      } else if (typeof dayValue === "string") {
        const parsed = new Date(`${dayValue.slice(0, 10)}T00:00:00Z`);
        if (!Number.isNaN(parsed.getTime())) dayDate = parsed;
      }
      if (!dayDate) continue;
      // Days-from-today (negative = past). dayDate is at UTC midnight
      // already (date_trunc + ::date), so the diff is exact.
      const diffDays = Math.round(
        (dayDate.getTime() - todayUtcMidnight.getTime()) /
          (24 * 60 * 60 * 1000),
      );
      const idx = PULSE_SPARKLINE_DAYS - 1 + diffDays;
      if (idx >= 0 && idx < PULSE_SPARKLINE_DAYS) {
        sparkline[idx] = row.cents;
      }
    }

    const pulseStats: PulseStats = {
      thisMonthCents: revenueMonthCents,
      lastMonthCents,
      currency: revenueCurrency,
      deltaPct,
      sparkline,
      // Footer counts re-project the existing kpis — same source rows,
      // no extra round-trip. Keeping them in sync with `kpis` is the
      // contract the redesign component (PulseCard) relies on.
      activeProjects: kpis.activeProjects,
      upcomingSessions7d: kpis.upcomingSessions7d,
      unresolvedItems: kpis.unresolvedItems,
    };

    return { kpis, items, savedViews, recentUploads, pulseStats };
  }),

  // ─── Overview sub-router ────────────────────────────────────────────
  // Project-level cards for the Overview screen. The primary surface is
  // `urgent` — the redesigned Urgent card that lists projects (not
  // event-stream items) currently demanding the producer's attention.
  //
  // Why not derive this from `today.items`? Because `today.items` is
  // event-stream-shaped (session / comment / invoice). The Overview's
  // Urgent card is project-shaped — a single row PER project, with a
  // status pill ("OVERDUE" / "DEPOSIT DUE" / "STUCK") that captures
  // what's wrong AT THE PROJECT level. Two unpaid invoices on the same
  // project should collapse into one row, not two; a project that's
  // stuck in `in_production` shouldn't need a synthetic comment to
  // surface. Different shape, different query.
  //
  // The router keeps the logic small + entirely in JS:
  // we fetch the producer's live projects + supporting last-activity
  // signals (most-recent track upload per project, most-recent booking
  // end per project), then classify each project against the three
  // urgency rules in priority order. No new tables, no new columns.
  overview: router({
    urgent: producerProcedure
      .input(z.object({ limit: z.number().int().min(1).max(10).optional() }).optional())
      .query(async ({ ctx, input }) => {
        const limit = input?.limit ?? URGENT_DEFAULT_LIMIT;
        const now = new Date();

        // Live projects only — same set the Pulse + Projects list filter
        // by. We want stages that the producer can still take action on:
        // archived + paid are terminal, so a stuck-in-production rule
        // would never fire on them anyway.
        const ACTIVE_STAGES = [
          "lead",
          "booked",
          "in_production",
          "final_review",
        ] as const;

        const projectRows = await ctx.db
          .select({
            id: projects.id,
            title: projects.title,
            stage: projects.stage,
            clientName: projects.clientName,
            artistName: projects.artistName,
            depositPaid: projects.depositPaid,
            finalPaid: projects.finalPaid,
            updatedAt: projects.updatedAt,
          })
          .from(projects)
          .where(
            and(
              eq(projects.producerId, ctx.producerId),
              inArray(projects.stage, [...ACTIVE_STAGES]),
            ),
          );

        if (projectRows.length === 0) {
          return { items: [] as UrgentProjectItem[] };
        }

        const projectIds = projectRows.map((p) => p.id);

        // Two parallel sub-queries to gather the activity signals we
        // need for the urgency rules. Each one is producer-scoped via
        // the inArray on projectIds (which we already filtered by
        // producerId above).
        const [latestUploadRows, lastBookingEndRows, futureBookingRows] =
          await Promise.all([
            // (a) Most-recent track upload per project. Drives the
            // "stuck in production" rule (no upload in >14 days) and
            // tracks general project liveness.
            ctx.db
              .select({
                projectId: projectTracks.projectId,
                uploadedAt: trackVersions.uploadedAt,
              })
              .from(trackVersions)
              .innerJoin(
                projectTracks,
                eq(projectTracks.id, trackVersions.trackId),
              )
              .where(inArray(projectTracks.projectId, projectIds)),

            // (b) Last booking-end timestamp per project. Drives the
            // "overdue" rule (project's last session ended >7 days ago
            // and final isn't paid).
            ctx.db
              .select({
                projectId: bookings.projectId,
                startsAt: bookings.startsAt,
                durationMin: bookings.durationMin,
                status: bookings.status,
              })
              .from(bookings)
              .where(
                and(
                  eq(bookings.producerId, ctx.producerId),
                  inArray(bookings.projectId, projectIds),
                ),
              ),

            // (c) Any future-or-current confirmed sessions, used to
            // suppress the "overdue" rule when the producer has
            // something already on the calendar — they're not late if
            // there's a session coming up.
            ctx.db
              .select({
                projectId: bookings.projectId,
                startsAt: bookings.startsAt,
                status: bookings.status,
              })
              .from(bookings)
              .where(
                and(
                  eq(bookings.producerId, ctx.producerId),
                  inArray(bookings.projectId, projectIds),
                  eq(bookings.status, "confirmed"),
                  gte(bookings.startsAt, now),
                ),
              ),
          ]);

        // Reduce activity rows down to per-project signals.
        const lastUploadAt = new Map<string, Date>();
        for (const r of latestUploadRows) {
          if (!r.projectId) continue;
          const cur = lastUploadAt.get(r.projectId);
          if (!cur || r.uploadedAt > cur) lastUploadAt.set(r.projectId, r.uploadedAt);
        }

        const lastBookingEndAt = new Map<string, Date>();
        for (const b of lastBookingEndRows) {
          if (!b.projectId) continue;
          // booking end ≈ startsAt + durationMin. We only count
          // bookings that have actually happened (status confirmed +
          // end-time in the past) — pending requests don't tell us
          // anything about whether the project is overdue.
          const end = new Date(b.startsAt.getTime() + b.durationMin * 60_000);
          if (b.status !== "confirmed") continue;
          if (end > now) continue;
          const cur = lastBookingEndAt.get(b.projectId);
          if (!cur || end > cur) lastBookingEndAt.set(b.projectId, end);
        }

        const hasFutureSession = new Set<string>();
        for (const f of futureBookingRows) {
          if (f.projectId) hasFutureSession.add(f.projectId);
        }

        // Classify each project. We iterate projects in arbitrary
        // order; sorting + slicing happens AFTER classification because
        // we want urgency-priority order, not stage/createdAt order.
        const classified: Array<UrgentProjectItem & { sortKey: number }> = [];
        for (const p of projectRows) {
          const urgency = classifyUrgency({
            stage: p.stage,
            depositPaid: p.depositPaid,
            finalPaid: p.finalPaid,
            updatedAt: p.updatedAt,
            lastUploadAt: lastUploadAt.get(p.id) ?? null,
            lastBookingEndAt: lastBookingEndAt.get(p.id) ?? null,
            hasFutureSession: hasFutureSession.has(p.id),
            now,
          });
          if (urgency === null) continue;

          // Display name for the avatar gradient + primary line. Prefer
          // clientName (set by the producer); fall back to legacy
          // artistName (NOT NULL in the schema) so projects without a
          // client snapshot still render a sensible row.
          const displayClient = (p.clientName ?? p.artistName).trim();
          classified.push({
            id: p.id,
            title: p.title,
            clientName: displayClient,
            gradient: producerGradient(displayClient || p.title),
            stage: p.stage,
            urgency,
            sortKey: URGENCY_PRIORITY[urgency],
          });
        }

        // Sort by urgency priority (overdue → deposit_due → stuck).
        // Within an urgency, fall back to title for stability so the
        // same call returns the same order between renders.
        classified.sort((a, b) => {
          if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
          return a.title.localeCompare(b.title);
        });

        const items: UrgentProjectItem[] = classified
          .slice(0, limit)
          .map((c) => ({
            id: c.id,
            title: c.title,
            clientName: c.clientName,
            gradient: c.gradient,
            stage: c.stage,
            urgency: c.urgency,
          }));

        return { items };
      }),
  }),

  // Six-month paid-revenue trend. Feeds the compact SVG line chart on
  // Today so producers can see their trajectory at a glance without
  // leaving the page. Each point is a calendar month (UTC boundaries,
  // matching the KPI strip's "Revenue · month" tile) and revenue is
  // only counted for invoices whose currency matches the producer's
  // default — mixed-currency rows are dropped rather than naively
  // summed (same rule as producer.today's revenue KPI).
  //
  // The shape is deliberately tiny: six { month, cents } tuples, zero
  // when no invoices were paid in that window. The chart component
  // relies on the array being exactly 6 rows sorted oldest → newest,
  // so the producer sees the same "this month is the rightmost point"
  // orientation every time.
  revenueTrend: producerProcedure.query(async ({ ctx }) => {
    const now = new Date();
    // Six consecutive month buckets, oldest first. The current month
    // is the 6th (rightmost) point so the chart's "today" is always
    // pinned to the right edge. We compute [start, end) pairs in UTC
    // so month boundaries match the KPI calculation.
    const buckets: { month: string; start: Date; end: Date }[] = [];
    for (let offset = 5; offset >= 0; offset -= 1) {
      const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1),
      );
      const end = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 1),
      );
      // "YYYY-MM" — the UI labels X-axis ticks with the short month name.
      const month = `${String(start.getUTCFullYear())}-${String(
        start.getUTCMonth() + 1,
      ).padStart(2, "0")}`;
      buckets.push({ month, start, end });
    }

    // Producer default currency (for the mixed-currency filter).
    const [profile] = await ctx.db
      .select({ defaultCurrency: producers.defaultCurrency })
      .from(producers)
      .where(eq(producers.id, ctx.producerId))
      .limit(1);
    const defaultCurrency = profile?.defaultCurrency ?? "USD";

    // Single SELECT over the 6-month window. Cheaper than 6 parallel
    // queries + still fits in the producer_id index. We aggregate in
    // JS so we can apply the currency filter + forget the rows once
    // bucketed — no additional round-trip for the SUM.
    const windowStart = buckets[0]?.start ?? now;
    const windowEnd = buckets[buckets.length - 1]?.end ?? now;
    const rows = await ctx.db
      .select({
        paidAt: invoices.paidAt,
        amountCents: invoices.amountCents,
        currency: invoices.currency,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.producerId, ctx.producerId),
          eq(invoices.status, "paid"),
          gte(invoices.paidAt, windowStart),
          lte(invoices.paidAt, windowEnd),
        ),
      );

    // Bucket the rows. findIndex rather than a map keyed on YYYY-MM
    // because the bucket count is fixed at 6 — linear scan is
    // faster than hash lookup at this size, and the code reads cleaner.
    const points = buckets.map((b) => ({ month: b.month, cents: 0 }));
    for (const r of rows) {
      if (r.currency !== defaultCurrency) continue;
      const paidAt = r.paidAt;
      if (!paidAt) continue;
      const idx = buckets.findIndex(
        (b) => paidAt >= b.start && paidAt < b.end,
      );
      if (idx !== -1) {
        const p = points[idx];
        if (p) p.cents += r.amountCents;
      }
    }

    return { points, currency: defaultCurrency };
  }),

  // Music top-level — Samply-style cross-project library. One row per
  // track version across every project this producer owns, sorted
  // newest-upload-first. The UI deep-links a row tap to
  // /dashboard/projects/<projectId>?tab=music&version=<versionId>, so
  // the producer can listen to anything they've ever uploaded without
  // hunting through the Projects list for the right client.
  //
  // The single query joins outward from track_versions → project_tracks
  // → projects, then filters by projects.producerId. No separate
  // count query — the list is capped at MUSIC_LIST_MAX rows, which is
  // enough to not need pagination for the vast majority of producers.
  music: router({
    list: producerProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          id: trackVersions.id,
          trackTitle: projectTracks.title,
          label: trackVersions.label,
          projectId: projects.id,
          projectTitle: projects.title,
          clientName: projects.clientName,
          uploadedAt: trackVersions.uploadedAt,
          audioUrl: trackVersions.audioUrl,
        })
        .from(trackVersions)
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .where(eq(projects.producerId, ctx.producerId))
        .orderBy(desc(trackVersions.uploadedAt))
        .limit(MUSIC_LIST_MAX);

      // Belt-and-braces cap. The .limit() above already constrains the
      // SQL result, but slicing here guarantees the response shape
      // holds even if a future query path skips the DB-side limit.
      return { tracks: rows.slice(0, MUSIC_LIST_MAX) };
    }),

    // L3 song page detail — single track with its full version stack +
    // timestamped comments, scoped to the producer's tenant. Resolves
    // by VERSION id (the same identifier the L1 list rows use), so the
    // route /dashboard/music/<versionId> deep-links cleanly. Auth gate:
    // the version must belong to a track on a project owned by
    // ctx.producerId — anything else returns NOT_FOUND (we don't
    // differentiate "doesn't exist" from "not yours" to avoid leaking
    // existence). Mirrors the data shape of artist.music.project so
    // the L3 UI can render the same waveform + comments primitives.
    detail: producerProcedure
      .input(z.object({ versionId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        // 1. Resolve the version row + its parent track + project, all
        //    in one join. Filters by projects.producerId — the auth
        //    boundary. If the join returns 0 rows, NOT_FOUND.
        const [head] = await ctx.db
          .select({
            versionId: trackVersions.id,
            trackId: projectTracks.id,
            trackTitle: projectTracks.title,
            trackArtist: projectTracks.artist,
            projectId: projects.id,
            projectTitle: projects.title,
            clientName: projects.clientName,
          })
          .from(trackVersions)
          .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
          .innerJoin(projects, eq(projects.id, projectTracks.projectId))
          .where(
            and(
              eq(trackVersions.id, input.versionId),
              eq(projects.producerId, ctx.producerId),
            ),
          )
          .limit(1);
        if (!head) throw new TRPCError({ code: "NOT_FOUND" });

        // 2. Full version stack for the track, desc by uploadedAt so
        //    the latest is first (matches the design's "v3 · current"
        //    label position). Includes approvedAt so the L3 UI can
        //    show the green checkmark on the approved version.
        const versions = await ctx.db
          .select({
            id: trackVersions.id,
            label: trackVersions.label,
            audioUrl: trackVersions.audioUrl,
            durationMs: trackVersions.durationMs,
            uploadedAt: trackVersions.uploadedAt,
            approvedAt: trackVersions.approvedAt,
          })
          .from(trackVersions)
          .where(eq(trackVersions.trackId, head.trackId))
          .orderBy(desc(trackVersions.uploadedAt));

        // 3. Comments across all versions of this track. Asc by
        //    timestampMs so the comment thread reads in track order
        //    (same convention as the artist Now Playing screen).
        const versionIds = versions.map((v) => v.id);
        const comments = versionIds.length
          ? await ctx.db
              .select({
                id: trackComments.id,
                versionId: trackComments.versionId,
                timeMs: trackComments.timestampMs,
                body: trackComments.body,
                fromProducer: trackComments.fromProducer,
                authorName: trackComments.authorName,
                createdAt: trackComments.createdAt,
                resolvedAt: trackComments.resolvedAt,
              })
              .from(trackComments)
              .where(inArray(trackComments.versionId, versionIds))
              .orderBy(asc(trackComments.timestampMs))
          : [];

        return {
          track: {
            id: head.trackId,
            title: head.trackTitle,
            artist: head.trackArtist,
            projectId: head.projectId,
            projectTitle: head.projectTitle,
            clientName: head.clientName,
          },
          versions,
          comments,
          // Selected version id — first version that matches the input,
          // or the latest if the input version was somehow filtered out
          // (shouldn't happen given the head check above, but defensive).
          selectedVersionId: input.versionId,
        };
      }),
  }),

  // Full data export — everything Skitza stores tied to this producer.
  // GDPR-friendly: the producer can hit this at any time, get their
  // data as a self-contained JSON, and walk away. Explicitly excludes
  // the token hashes (they're one-way; no value in the export) and
  // internal IDs that only matter to Skitza's join graph.
  export: producerProcedure.query(async ({ ctx }) => {
    const [profile] = await ctx.db
      .select()
      .from(producers)
      .where(eq(producers.id, ctx.producerId))
      .limit(1);
    if (!profile) throw new TRPCError({ code: "NOT_FOUND" });

    const tracks = await ctx.db
      .select()
      .from(portfolioTracks)
      .where(eq(portfolioTracks.producerId, ctx.producerId))
      .orderBy(portfolioTracks.position);

    return {
      exportedAt: new Date().toISOString(),
      schema: "skitza-export-v1",
      profile: {
        id: profile.id,
        email: profile.email,
        displayName: profile.displayName,
        slug: profile.slug,
        defaultCurrency: profile.defaultCurrency,
        timezone: profile.timezone,
        brand: profile.brand ?? {},
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
      portfolioTracks: tracks,
    };
  }),

  // ─── Payment connection (per-producer Tranzila terminal) ─────────
  // Read the current connection status. `connected` flips true once a
  // Skitza admin manually provisions a terminal name onto the producer
  // row; the request itself is captured by `requestPaymentConnection`
  // below (today: console.log; future: email Skitza admin via Resend).
  paymentConnection: producerProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ tranzilaTerminalName: producers.tranzilaTerminalName })
      .from(producers)
      .where(eq(producers.id, ctx.producerId))
      .limit(1);
    return {
      connected: Boolean(row?.tranzilaTerminalName),
      terminalName: row?.tranzilaTerminalName ?? null,
    };
  }),

  // Producer submits a "connect my Tranzila terminal" request from
  // Settings → Integrations → Payments. We log it for now — a Skitza
  // admin watches the logs, provisions the terminal at Tranzila, then
  // writes the terminal name onto the producer row out-of-band. Future:
  // wire a Resend notification to the admin inbox.
  requestPaymentConnection: producerProcedure
    .input(
      z.object({
        businessName: z.string().min(1).max(200),
        contactEmail: z.string().email(),
        phone: z.string().min(5).max(30),
      }),
    )
    .mutation(({ ctx, input }) => {
      console.log("[payment-connection-request]", {
        producerId: ctx.producerId,
        businessName: input.businessName,
        contactEmail: input.contactEmail,
        phone: input.phone,
        timestamp: new Date().toISOString(),
      });
      // TODO: send email notification to Skitza admin.
      return { ok: true as const };
    }),

  // Edit profile. brand and notificationPrefs merge over the existing
  // JSONB (we fetch → spread → set) so a UI patch can ship only the
  // keys that changed without wiping the rest of the object.
  update: producerProcedure.input(UpdateInput).mutation(async ({ ctx, input }) => {
    const {
      brand: brandPatch,
      notificationPrefs: notifPatch,
      ...fields
    } = input;

    // Merge brand + notificationPrefs JSONB with existing. Drizzle's
    // jsonb helpers do NOT support a built-in partial-update, so we
    // fetch + spread + write. Two columns to merge → one SELECT covers
    // both (cheaper than two round-trips).
    let brand: typeof producers.$inferSelect.brand | undefined;
    let notificationPrefs:
      | typeof producers.$inferSelect.notificationPrefs
      | undefined;
    if (brandPatch !== undefined || notifPatch !== undefined) {
      const [existing] = await ctx.db
        .select({
          brand: producers.brand,
          notificationPrefs: producers.notificationPrefs,
        })
        .from(producers)
        .where(eq(producers.id, ctx.producerId))
        .limit(1);
      if (brandPatch !== undefined) {
        brand = { ...(existing?.brand ?? {}), ...stripUndefined(brandPatch) };
      }
      if (notifPatch !== undefined) {
        notificationPrefs = {
          ...(existing?.notificationPrefs ?? {}),
          ...stripUndefined(notifPatch),
        };
      }
    }

    try {
      const [updated] = await ctx.db
        .update(producers)
        .set(
          stripUndefined({
            ...fields,
            ...(brand === undefined ? {} : { brand }),
            ...(notificationPrefs === undefined ? {} : { notificationPrefs }),
            updatedAt: new Date(),
          }),
        )
        .where(eq(producers.id, ctx.producerId))
        .returning();
      if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return { ok: true as const };
    } catch (err) {
      // Slug UNIQUE collision at the DB surfaces as a generic postgres
      // error string; map to a clean BAD_REQUEST so the Server Action
      // can show a readable message.
      if (
        err instanceof Error &&
        /duplicate key value/.test(err.message) &&
        /slug/.test(err.message)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That slug is already taken — please choose another.",
        });
      }
      throw err;
    }
  }),
});
