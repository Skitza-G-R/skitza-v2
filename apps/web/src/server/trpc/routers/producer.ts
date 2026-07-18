import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  bookings,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  portfolioTracks,
  producers,
  projectTracks,
  projects,
  purchases,
  sql,
  trackComments,
  trackVersions,
} from "@skitza/db";
import { z } from "zod";

import { producerGradient } from "../../../lib/_phase4-stubs/producer-color";
import type { Stage } from "../../../lib/projects/stages";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { producerPurchaseRouter } from "./purchase";
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
  // Migration 0019 — business-level tax disclosure mode + rate.
  // 'tax_added' is the only mode that changes checkout totals;
  // 'tax_free' and 'tax_included' are display-only. See
  // ~/lib/tax-mode for the helpers (footnote, hint, pricing note,
  // checkout multiplier).
  taxMode: z.enum(["tax_free", "tax_included", "tax_added"]).optional(),
  // Whole-number percent (UI input is integer-only). Clamped [0, 100].
  taxRatePct: z.number().int().min(0).max(100).optional(),
  // BE-2 off-app payments — bank-transfer text + Bit number shown to a
  // paying artist on the payment-instructions screen. Whole-object
  // replace (the settings form submits the complete value).
  paymentDetails: z
    .object({
      bankTransfer: z.string().trim().max(500).optional(),
      bitPhone: z.string().trim().max(32).optional(),
      note: z.string().trim().max(500).optional(),
    })
    .optional(),
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

function formatMoneySubtitle(
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
export type TodayKind = "session" | "payment" | "comment";
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
type PulseCounts = {
  activeProjects: number;
  upcomingSessions7d: number;
  unresolvedItems: number;
};

export type PulseStats = PulseCounts &
  (
    | {
        commercialAvailable: false;
        thisMonthCents: null;
        lastMonthCents: null;
        outstandingCents: null;
        currency: null;
        deltaPct: null;
        sparkline: number[];
      }
    | {
        commercialAvailable: true;
        thisMonthCents: number;
        lastMonthCents: number;
        outstandingCents: number;
        currency: string;
        deltaPct: number | null;
        sparkline: number[];
      }
  );

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

// Strict type ordering: sessions first (time-sensitive), then recent
// payments, then unread comments (artist is waiting).
// Within each kind we sort by occurredAt (asc for upcoming sessions
// — soonest first; desc for everything else — most recent first).
const KIND_PRIORITY: Record<TodayKind, number> = {
  session: 0,
  payment: 1,
  comment: 2,
};

// ─── Overview · Urgent helpers ────────────────────────────────────────
// Project activity is the only safe urgency source available here. Money
// urgency belongs to the purchase ledger: project lifecycle, booking age,
// and removed deposit/final flags must never be used to infer it.
export type UrgencyKind = "stuck";

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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const STUCK_DAYS = 14;

interface ClassifyArgs {
  stage: Stage;
  updatedAt: Date;
  lastUploadAt: Date | null;
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
    updatedAt,
    lastUploadAt,
    now,
  } = args;

  // STUCK — in-production project with no uploads in >STUCK_DAYS.
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
  // Purchase flow (SK-37 / BE-1). approve / decline / undoApproval /
  // list (Gate 1) plus the frozen BE-2/3 stubs. Defined in ./purchase
  // so the backend track stays out of the screens track's files.
  purchase: producerPurchaseRouter,

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
    // Do not expose authentication or provider internals to the client.
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      slug: row.slug,
      defaultCurrency: row.defaultCurrency,
      timezone: row.timezone,
      brand: row.brand ?? {},
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
      // Migration 0019 — business-level tax disclosure mode + rate.
      taxMode: row.taxMode,
      taxRatePct: row.taxRatePct,
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
  // sessions and unread comments). Pattern mirrors
  // `artist.home`: one Promise.all fan-out across the sources, each
  // WHERE-scoped to ctx.producerId, then shape + sort + cap.
  //
  // `savedViews` returns [] — persisting a user's saved filter requires
  // a new table, deferred to a later task.
  today: producerProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const horizon7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Active stages for the KPI counter — excludes terminal states so
    // "archived" projects don't inflate the count.
    const ACTIVE_LIFECYCLES = [
      "waiting_for_payment",
      "active",
      "paused",
    ] as const;

    // Fan out across the data sources in parallel. Each query is
    // independently producer-scoped (WHERE producer_id = ctx.producerId)
    // so a regression in any single sub-query can't leak other
    // producers' data. The producer profile lookup rides along as a
    // separate leg — it has no data dependency on the other queries, so
    // running it sequentially would just add tail latency.
    const [
      activeProjectRows,
      upcomingRows,
      openCommentsCountRows,
      openCommentRows,
      profileRows,
      recentUploadRows,
      recentPaymentRows,
    ] = await Promise.all([
      // (1) Active projects KPI — count by filtering stage in the
      // active set. We fetch ids only; the count is rows.length.
      ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.producerId, ctx.producerId),
            inArray(projects.lifecycleStatus, [...ACTIVE_LIFECYCLES]),
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
          packageNameSnapshot: sql<string>`coalesce(nullif(trim(${purchases.commercialSnapshot}->>'productOrOfferName'), ''), 'Session')`,
          projectId: bookings.projectId,
        })
        .from(bookings)
        .innerJoin(
          purchases,
          and(
            eq(purchases.id, bookings.purchaseId),
            eq(purchases.projectId, bookings.projectId),
            eq(purchases.producerId, bookings.producerId),
          ),
        )
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
          projectLifecycleStatus: projects.lifecycleStatus,
        })
        .from(trackVersions)
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .where(
          and(
            eq(projects.producerId, ctx.producerId),
            inArray(projects.lifecycleStatus, [...ACTIVE_LIFECYCLES]),
            isNotNull(trackVersions.audioUrl),
            isNull(trackVersions.audioDeletedAt),
          ),
        )
        .orderBy(desc(trackVersions.uploadedAt))
        .limit(RECENT_UPLOADS_MAX),

      Promise.resolve([] as Array<{
        id: string;
        artistName: string;
        packageNameSnapshot: string | null;
        unitPriceCents: number | null;
        songQty: number | null;
        statusChangedAt: Date | null;
        producerAcknowledgedAt: Date | null;
        projectId: string | null;
        projectTitle: string | null;
      }>),
    ]);

    // Resolve default currency for KPI display. Fallback to USD keeps
    // the UI honest if the producer row ever has a NULL currency.
    const revenueCurrency = profileRows[0]?.defaultCurrency ?? "USD";

    const kpis = {
      activeProjects: activeProjectRows.length,
      revenueMonthCents: null,
      revenueCurrency: null,
      upcomingSessions7d: upcomingRows.length,
      unresolvedItems: openCommentsCountRows.length,
    };

    // ── Compose the unified items list ──────────────────────────────
    // Each source projects into the common TodayItem shape. occurredAt
    // drives the within-kind sort: future (sessions) use startsAt;
    // past events use createdAt.
    const sessionItems: TodayItem[] = upcomingRows.map((b) => ({
      id: `session:${b.id}`,
      kind: "session",
      title: b.artistName,
      subtitle: `${b.packageNameSnapshot} · ${b.durationMin.toString()} min`,
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

    const commentItems = openCommentRows.map((c) => ({
      id: `comment:${c.id}`,
      kind: "comment" as const,
      title: c.authorName,
      subtitle: truncate(c.body, 120),
      occurredAt: c.createdAt,
      href: `/dashboard/clients-projects/${c.projectId}`,
      unread: true,
    }));

    // Keep the unresolved-work sources outside the mixed 50-row Today feed.
    // A very busy week must not starve comments from the dashboard's
    // explicit View-all queue.
    const needsYouUnresolvedItems = commentItems;

    // SK-20 — confirmed bookings in the last 30 days. Amount =
    // unitPriceCents × songQty for per-song products; flat products
    // skip the multiplier (songQty is null). Currency anchors to the
    // producer's defaultCurrency since bookings don't carry their own
    // currency column. `unread` keeps the dot lit until the producer
    // dismisses the banner — same predicate the banner query uses.
    const paymentItems: TodayItem[] = recentPaymentRows.map((p) => {
      const qty = p.songQty ?? 1;
      const amountCents = (p.unitPriceCents ?? 0) * qty;
      const displayName =
        p.projectTitle ?? p.packageNameSnapshot ?? "Session";
      return {
        id: `payment:${p.id}`,
        kind: "payment" as const,
        title: `${p.artistName} paid for ${displayName}`,
        subtitle: formatMoneySubtitle(amountCents, revenueCurrency, null),
        occurredAt: p.statusChangedAt ?? new Date(0),
        href: p.projectId
          ? `/dashboard/clients-projects/${p.projectId}`
          : "/dashboard/clients-projects",
        unread: p.producerAcknowledgedAt === null,
      };
    });

    const items = [...sessionItems, ...paymentItems, ...commentItems]
      .sort((a, b) => {
        // Primary: kind priority (session → payment → comment).
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
      projectStage:
        row.projectLifecycleStatus === "waiting_for_payment"
          ? "booked"
          : row.projectLifecycleStatus === "completed"
            ? "paid"
            : row.projectLifecycleStatus === "canceled"
              ? "archived"
              : "in_production",
      unreadComments: unreadCommentCounts[i]?.length ?? 0,
    }));

    // Commercial pulse projections remain fail-closed until the corrected
    // purchase ledger powers them. Preserve the stable 30-day chart shape
    // without projecting removed invoice or booking money.
    const sparkline: number[] = Array.from(
      { length: PULSE_SPARKLINE_DAYS },
      () => 0,
    );

    const pulseStats: PulseStats = {
      commercialAvailable: false,
      thisMonthCents: null,
      lastMonthCents: null,
      outstandingCents: null,
      currency: null,
      deltaPct: null,
      sparkline,
      // Footer counts re-project the existing kpis — same source rows,
      // no extra round-trip. Keeping them in sync with `kpis` is the
      // contract the redesign component (PulseCard) relies on.
      activeProjects: kpis.activeProjects,
      upcomingSessions7d: kpis.upcomingSessions7d,
      unresolvedItems: kpis.unresolvedItems,
    };

    return {
      kpis,
      items,
      needsYouUnresolvedItems,
      savedViews,
      recentUploads,
      pulseStats,
    };
  }),

  // ─── Overview sub-router ────────────────────────────────────────────
  // Project-level cards for the Overview screen. The primary surface is
  // `urgent` — the redesigned Urgent card that lists active projects
  // whose real upload activity has gone stale.
  //
  // Why not derive this from `today.items`? Because `today.items` is
  // event-stream-shaped (session / payment / comment). The Overview's
  // Urgent card is project-shaped — a single row PER project, with a
  // status pill ("OVERDUE" / "DEPOSIT DUE" / "STUCK") that captures
  // what's wrong AT THE PROJECT level. Commercial urgency is intentionally
  // absent until it can be projected from the purchase ledger.
  //
  // The router keeps the logic small + entirely in JS:
  // we fetch the producer's live projects + supporting last-activity
  // signals (most-recent track upload per project, most-recent booking
  // end per project), then classify each project against the three
  // urgency rules in priority order. No new tables, no new columns.
  overview: router({
    urgent: producerProcedure
      .input(z.object({ limit: z.number().int().min(1).max(50).optional() }).optional())
      .query(async ({ ctx, input }) => {
        const limit = input?.limit ?? URGENT_DEFAULT_LIMIT;
        const now = new Date();

        const projectRows = await ctx.db
          .select({
            id: projects.id,
            title: projects.title,
            lifecycleStatus: projects.lifecycleStatus,
            clientName: projects.clientName,
            artistName: projects.artistName,
            updatedAt: projects.updatedAt,
          })
          .from(projects)
          .where(
            and(
              eq(projects.producerId, ctx.producerId),
              eq(projects.lifecycleStatus, "active"),
            ),
          );

        if (projectRows.length === 0) {
          return { items: [] as UrgentProjectItem[] };
        }

        const projectIds = projectRows.map((p) => p.id);

        const latestUploadRows = await ctx.db
          .select({
            projectId: projectTracks.projectId,
            uploadedAt: trackVersions.uploadedAt,
          })
          .from(trackVersions)
          .innerJoin(
            projectTracks,
            eq(projectTracks.id, trackVersions.trackId),
          )
          .where(
            and(
              inArray(projectTracks.projectId, projectIds),
              isNotNull(trackVersions.audioUrl),
              isNull(trackVersions.audioDeletedAt),
            ),
          );

        // Reduce activity rows down to per-project signals.
        const lastUploadAt = new Map<string, Date>();
        for (const r of latestUploadRows) {
          if (!r.projectId) continue;
          const cur = lastUploadAt.get(r.projectId);
          if (!cur || r.uploadedAt > cur) lastUploadAt.set(r.projectId, r.uploadedAt);
        }

        // Classify each project. We iterate projects in arbitrary
        // order; title sorting keeps the capped response deterministic.
        const classified: UrgentProjectItem[] = [];
        for (const p of projectRows) {
          if (p.lifecycleStatus !== "active") continue;
          const stage: Stage = "in_production";
          const urgency = classifyUrgency({
            stage,
            updatedAt: p.updatedAt,
            lastUploadAt: lastUploadAt.get(p.id) ?? null,
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
            stage,
            urgency,
          });
        }

        classified.sort((a, b) => a.title.localeCompare(b.title));

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

    // Corrections and waivers make raw-payment aggregation unsafe. The
    // purchase-ledger Payments projection will populate this chart later.
    const rows: Array<{ paidAt: Date; amountCents: number; currency: string }> = [];

    // Bucket the rows. findIndex rather than a map keyed on YYYY-MM
    // because the bucket count is fixed at 6 — linear scan is
    // faster than hash lookup at this size, and the code reads cleaner.
    const points = buckets.map((b) => ({ month: b.month, cents: 0 }));
    for (const r of rows) {
      if (r.currency !== defaultCurrency) continue;
      const paidAt = r.paidAt;
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

  // Music top-level — Spotify-style track library. One row per TRACK
  // (not per version), each carrying the latest version's audio + label
  // for instant playback. Same producer-scoped join as before; the new
  // shape ships unread-notes count so the redesigned library can render
  // the amber "notes badge" in both grid and table views.
  //
  // The query pulls every version under the producer, then collapses to
  // one row per trackId, keeping the newest version per track. Done in
  // JS rather than a window-function SQL query — the per-producer
  // volume is bounded (< a few hundred versions for the vast majority)
  // and the JS reduce is easier to reason about + test.
  music: router({
    list: producerProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          versionId: trackVersions.id,
          versionLabel: trackVersions.label,
          audioUrl: trackVersions.audioUrl,
          durationMs: trackVersions.durationMs,
          uploadedAt: trackVersions.uploadedAt,
          trackId: projectTracks.id,
          trackTitle: projectTracks.title,
          trackArtist: projectTracks.artist,
          projectId: projects.id,
          projectTitle: projects.title,
          clientName: projects.clientName,
          projectLifecycleStatus: projects.lifecycleStatus,
        })
        .from(trackVersions)
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .where(
          and(
            eq(projects.producerId, ctx.producerId),
            isNotNull(trackVersions.audioUrl),
            isNull(trackVersions.audioDeletedAt),
          ),
        )
        .orderBy(desc(trackVersions.uploadedAt));

      // Collapse versions → tracks, keeping the newest per track.
      // The query already orders desc by uploadedAt, so the first
      // occurrence of a trackId is the newest version.
      const byTrack = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        if (!byTrack.has(r.trackId)) byTrack.set(r.trackId, r);
      }
      const trackList = Array.from(byTrack.values()).slice(0, MUSIC_LIST_MAX);

      // Per-version unread-notes count — only matters for the latest
      // version (that's what the library row represents). One IN query
      // is cheaper than N parallel COUNTs.
      const versionIds = trackList.map((t) => t.versionId);
      const noteRows = versionIds.length
        ? await ctx.db
            .select({
              versionId: trackComments.versionId,
              id: trackComments.id,
            })
            .from(trackComments)
            .where(
              and(
                inArray(trackComments.versionId, versionIds),
                eq(trackComments.fromProducer, false),
                isNull(trackComments.resolvedAt),
              ),
            )
        : [];
      const notesByVersion = new Map<string, number>();
      for (const n of noteRows) {
        notesByVersion.set(n.versionId, (notesByVersion.get(n.versionId) ?? 0) + 1);
      }

      const tracks = trackList.map((r) => ({
        // Keep `id` = versionId so existing deep-links into
        // /dashboard/music/<id> (which expects a versionId) still work.
        id: r.versionId,
        trackId: r.trackId,
        trackTitle: r.trackTitle,
        trackArtist: r.trackArtist,
        label: r.versionLabel,
        projectId: r.projectId,
        projectTitle: r.projectTitle,
        clientName: r.clientName,
        projectLifecycleStatus: r.projectLifecycleStatus,
        uploadedAt: r.uploadedAt,
        audioUrl: r.audioUrl,
        durationMs: r.durationMs,
        unreadComments: notesByVersion.get(r.versionId) ?? 0,
        // Plays — schema has no counter yet; design.md renders em-dash
        // for zero, so 0 is the correct placeholder.
        plays: 0,
      }));

      return { tracks };
    }),

    // Project page — hero + tracklist data for /dashboard/music/project/[id].
    // Producer-scoped (auth boundary: projects.producerId = ctx.producerId).
    // Returns the project meta + one row per track with the latest
    // version's playable info. Mirrors the shape `list` uses so consumers
    // can reuse the same row primitives.
    project: producerProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        // (1) Project meta — single row, gated by producer scope.
        const [head] = await ctx.db
          .select({
            id: projects.id,
            title: projects.title,
            clientName: projects.clientName,
            createdAt: projects.createdAt,
            lifecycleStatus: projects.lifecycleStatus,
          })
          .from(projects)
          .where(
            and(
              eq(projects.id, input.projectId),
              eq(projects.producerId, ctx.producerId),
            ),
          )
          .limit(1);
        if (!head) throw new TRPCError({ code: "NOT_FOUND" });

        // (2) Every version under this project, newest first. We collapse
        // to one row per track in JS (same trick as `list`).
        const versionRows = await ctx.db
          .select({
            versionId: trackVersions.id,
            versionLabel: trackVersions.label,
            audioUrl: trackVersions.audioUrl,
            durationMs: trackVersions.durationMs,
            uploadedAt: trackVersions.uploadedAt,
            trackId: projectTracks.id,
            trackTitle: projectTracks.title,
            trackArtist: projectTracks.artist,
          })
          .from(trackVersions)
          .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
          .where(
            and(
              eq(projectTracks.projectId, input.projectId),
              isNotNull(trackVersions.audioUrl),
              isNull(trackVersions.audioDeletedAt),
            ),
          )
          .orderBy(desc(trackVersions.uploadedAt));

        const byTrack = new Map<string, (typeof versionRows)[number]>();
        for (const v of versionRows) {
          if (!byTrack.has(v.trackId)) byTrack.set(v.trackId, v);
        }
        const trackList = Array.from(byTrack.values());

        // (3) Notes count per latest-version, single IN query.
        const versionIds = trackList.map((t) => t.versionId);
        const noteRows = versionIds.length
          ? await ctx.db
              .select({
                versionId: trackComments.versionId,
                id: trackComments.id,
              })
              .from(trackComments)
              .where(
                and(
                  inArray(trackComments.versionId, versionIds),
                  eq(trackComments.fromProducer, false),
                  isNull(trackComments.resolvedAt),
                ),
              )
          : [];
        const notesByVersion = new Map<string, number>();
        for (const n of noteRows) {
          notesByVersion.set(
            n.versionId,
            (notesByVersion.get(n.versionId) ?? 0) + 1,
          );
        }

        const tracks = trackList.map((r) => ({
          id: r.versionId,
          trackId: r.trackId,
          title: r.trackTitle,
          artist: r.trackArtist,
          versionLabel: r.versionLabel,
          audioUrl: r.audioUrl,
          durationMs: r.durationMs,
          uploadedAt: r.uploadedAt,
          unreadComments: notesByVersion.get(r.versionId) ?? 0,
          plays: 0,
        }));

        return {
          project: {
            id: head.id,
            title: head.title,
            clientName: head.clientName,
            createdAt: head.createdAt,
            lifecycleStatus: head.lifecycleStatus,
          },
          tracks,
        };
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
            projectLifecycleStatus: projects.lifecycleStatus,
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
        //    show the green checkmark on the approved version, and
        //    `peaks` so the song-page renders the real envelope on
        //    first frame without a client-side decode round-trip.
        const versions = await ctx.db
          .select({
            id: trackVersions.id,
            label: trackVersions.label,
            audioUrl: trackVersions.audioUrl,
            durationMs: trackVersions.durationMs,
            uploadedAt: trackVersions.uploadedAt,
            approvedAt: trackVersions.producerMarkedFinalAt,
            peaks: trackVersions.peaks,
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
            projectLifecycleStatus: head.projectLifecycleStatus,
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

  // Edit profile. brand and notificationPrefs merge over the existing
  // JSONB (we fetch → spread → set) so a UI patch can ship only the
  // keys that changed without wiping the rest of the object.
  update: producerProcedure.input(UpdateInput).mutation(async ({ ctx, input }) => {
    const {
      brand: brandPatch,
      notificationPrefs: notifPatch,
      paymentDetails: paymentDetailsPatch,
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
            ...(paymentDetailsPatch === undefined
              ? {}
              : { paymentDetails: stripUndefined(paymentDetailsPatch) }),
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
