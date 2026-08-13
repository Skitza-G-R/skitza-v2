import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  integer,
  bigint,
  boolean,
  pgEnum,
  unique,
  uniqueIndex,
  primaryKey,
  index,
  foreignKey,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// The approved off-app payment-plan choices. A purchase snapshots one plan
// and materializes its exact schedule in purchaseInstallments. Milestone and
// processor-backed plans are intentionally absent.
export type PaymentPlan =
  | { kind: "full" }
  | { kind: "split_50_50" }
  | { kind: "monthly"; installments: number };

// Headline commercial-rights terms for one product. Percentages are
// stored as integer basis points (250 = 2.5%) so producer edits and
// purchase snapshots round-trip without floating-point drift.
export type ProductRoyaltyTerms = {
  master: { mode: "none" } | { mode: "percentage"; bps: number } | { mode: "agreement" };
  composition:
    | { mode: "none" }
    | {
        mode: "percentage";
        bps: number;
        role?: "composer" | "lyricist" | "arranger" | "publisher" | "other";
        collectingSociety?: string;
      }
    | { mode: "agreement" };
  notes?: string;
};

export const producers = pgTable(
  "producers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    slug: text("slug").notNull().unique(),
    brand: jsonb("brand")
      .$type<{ logoUrl?: string; primary?: string; accent?: string; font?: string }>()
      .default({}),
    defaultCurrency: text("default_currency").notNull().default("USD"),
    timezone: text("timezone").notNull().default("UTC"),
    // Batch B — availability editor defaults. `defaultSessionMin` is the
    // producer's preferred session length in minutes; used to prefill the
    // duration picker when creating new products and as a global default
    // for the slot grid when a product omits its own duration. Common
    // presets in the UI: 60 / 90 / 120 / 180 / 240 (or custom integer).
    defaultSessionMin: integer("default_session_min").notNull().default(60),
    // When true, incoming public booking requests transition straight to
    // `confirmed` instead of `pending` — saves the producer a manual
    // approval click per request. Read by the booking.publicRequest path.
    autoConfirmBookings: boolean("auto_confirm_bookings").notNull().default(false),
    // Hours of advance notice required to cancel a confirmed booking.
    // Stored today; enforcement (cancel-by-artist flow) is a follow-up.
    cancellationPolicyHours: integer("cancellation_policy_hours").notNull().default(24),
    // Optional producer-local daily booking cap. NULL keeps the calendar
    // unlimited; positive values participate in the shared availability rules.
    maxSessionsPerDay: integer("max_sessions_per_day"),
    // ─── Batch G — Autopilot toggles ─────────────────────────────────
    // Five named behaviors the producer can flip on/off. No rule-builder,
    // no conditions — each column is a discrete outcome. See migration
    // 0027 for the column-level rationale. Defaults:
    //   * welcomeEmail=false / requestTestimonial=false /
    //     autoArchive=false — opt-in.
    //   * unpaidReminder=true — approved purchase reminders default on.
    //   * commentNotify=true — matches existing unconditional behavior.
    autopilotWelcomeEmail: boolean("autopilot_welcome_email").notNull().default(false),
    autopilotUnpaidReminder: boolean("autopilot_unpaid_reminder").notNull().default(true),
    autopilotRequestTestimonial: boolean("autopilot_request_testimonial").notNull().default(false),
    autopilotCommentNotify: boolean("autopilot_comment_notify").notNull().default(true),
    autopilotAutoArchive: boolean("autopilot_auto_archive").notNull().default(false),
    serviceRoles: text("service_roles").array().default([]),
    // ─── Marketing-grade meta fields ─────────────────────────────────
    // Surfaced by the 4-stat band on /join/<slug> ("Genres / Released /
    // Streams / Response"). Curated freeform strings — NOT computed from
    // real bookings/streams data (Phase H owns that). Nullable so a
    // producer who never opens Settings keeps the static React defaults
    // in place; the meta-strip hides any block whose value is null.
    // Migration 0006.
    genres: text("genres").array(),
    releasedSummary: text("released_summary"),
    streamsSummary: text("streams_summary"),
    // Hours of typical response time. 24/48/168 cover the dropdown
    // options "Within 24h" / "Within 48h" / "Within 1 week"; null hides
    // the response stat block entirely (the producer chose "Hidden").
    responseHours: integer("response_hours"),
    // BE-2 off-app payments (v1): free-text bank-transfer details + Bit
    // phone number the artist sees on the payment-instructions screen.
    // Empty object → the screen shows the "producer will send details"
    // variant. Migration 0022.
    paymentDetails: jsonb("payment_details")
      .$type<{ bankTransfer?: string; bitPhone?: string; note?: string }>()
      .notNull()
      .default({}),
    // Settings redesign — plan tier for the Plan & billing section.
    // UI-only for v1 (no Stripe subscription wiring yet): the section
    // renders a hard-coded 'free' / 'pro' hero + usage meters but does
    // not gate features. Real billing follows in a separate task.
    plan: text("plan").notNull().default("free"),
    // Calendar week-grid orientation. Used by the Calendar's week view
    // and the onboarding availability step. Two values: 'sunday' | 'monday'
    // — long form matches the existing `useWeekStartPref` hook in
    // lib/time/week-start.ts so the same string flows from DB → server →
    // client without translation. Settings → Currency & region writes
    // here; Calendar / Onboarding read from here.
    weekStart: text("week_start").notNull().default("sunday"),
    // Per-event notification preferences. Shape:
    //   { booking: { email: bool, app: bool }, approval: {...}, ... }
    // Six known event keys (booking, approval, payment, overdue, comment,
    // weekly) — see NOTIFICATION_EVENTS in the settings client. Empty
    // object means "use defaults" (the UI fills in the design's defaults
    // when a key is missing). Wiring each event to a real email/in-app
    // dispatch follows in a separate task; for v1 the toggles just
    // persist.
    notificationPrefs: jsonb("notification_prefs")
      .$type<Record<string, { email: boolean; app: boolean }>>()
      .notNull()
      .default({}),
    // Business-level tax disclosure. Drives buyer-facing copy on every
    // product surface and the frozen accepted-purchase total.
    // Three modes (v2 — migration 0019 renamed the prior 'none' /
    // 'vat_included' / 'vat_exempt' tuple):
    //   * 'tax_free'     — no tax. Footnote: "Tax-free." Covers both
    //                      "no tax involved" (non-IL) and the Osek Patur
    //                      legal exemption (small-business IL). No math
    //                      change at checkout.
    //   * 'tax_included' — listed prices already include taxRatePct%.
    //                      Footnote: "Includes {rate}% tax." No math
    //                      change — artist pays the displayed number.
    //   * 'tax_added'    — listed prices are PRE-TAX. The owed total is
    //                      price × (1 + rate/100). Footnote:
    //                      "+ {rate}% tax at checkout." The product
    //                      editor's Pricing step shows a live preview
    //                      so the producer sees the after-tax amount
    //                      the artist actually pays.
    // Free-text on disk (not pgEnum) so adding regional / per-currency
    // tax variants later is a single-row UPDATE rather than a CREATE
    // TYPE dance.
    taxMode: text("tax_mode").notNull().default("tax_free"),
    // Tax rate the producer declares as a percentage (whole-number int
    // — fractional rates are rare and the UI input is integer-only).
    // Default 18 matches Israeli VAT. Irrelevant when taxMode='tax_free',
    // but the column stays populated so the value sticks if the producer
    // toggles modes back and forth.
    taxRatePct: integer("tax_rate_pct").notNull().default(18),
    // Account closure is identity-preserving: the normal workspace and public
    // profile hide when closure starts, while shared business/audit rows keep
    // their stable Producer foreign key and Clerk attribution.
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    adminEmailSearchIdx: index("producers_admin_email_search_idx").on(
      sql`lower(${t.email}) text_pattern_ops`,
      t.clerkUserId,
    ),
    adminNameSearchIdx: index("producers_admin_name_search_idx").on(
      sql`lower(${t.displayName}) text_pattern_ops`,
      t.clerkUserId,
    ),
    maxSessionsPerDayShape: check(
      "producers_max_sessions_per_day_shape",
      sql`${t.maxSessionsPerDay} IS NULL OR ${t.maxSessionsPerDay} > 0`,
    ),
  }),
);

export type Producer = typeof producers.$inferSelect;
export type NewProducer = typeof producers.$inferInsert;

// Short-lived replay protection for the desktop system-browser sign-in
// handoff. Raw authorization codes, PKCE verifiers, state values, and Clerk
// tickets never enter the database. A matching row may make exactly one
// NULL -> consumed_at transition before its sixty-second expiry.
export const desktopAuthCodes = pgTable(
  "desktop_auth_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    codeDigest: text("code_digest").notNull(),
    stateDigest: text("state_digest").notNull(),
    producerId: uuid("producer_id").notNull(),
    pkceChallenge: text("pkce_challenge").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    producerFk: foreignKey({
      columns: [t.producerId],
      foreignColumns: [producers.id],
      name: "desktop_auth_codes_producer_fk",
    }).onDelete("cascade"),
    codeDigestUnique: unique("desktop_auth_codes_code_digest_unique").on(t.codeDigest),
    expiresIdx: index("desktop_auth_codes_expires_idx").on(t.expiresAt, t.id),
    codeDigestShape: check(
      "desktop_auth_codes_code_digest_shape",
      sql`${t.codeDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    stateDigestShape: check(
      "desktop_auth_codes_state_digest_shape",
      sql`${t.stateDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    pkceChallengeShape: check(
      "desktop_auth_codes_pkce_challenge_shape",
      sql`${t.pkceChallenge} ~ '^[A-Za-z0-9_-]{43}$'`,
    ),
    lifetimeShape: check(
      "desktop_auth_codes_lifetime_shape",
      sql`(
        ${t.expiresAt} > ${t.createdAt}
        AND ${t.expiresAt} <= ${t.createdAt} + interval '60 seconds'
        AND (
          ${t.consumedAt} IS NULL
          OR (
            ${t.consumedAt} >= ${t.createdAt}
            AND ${t.consumedAt} < ${t.expiresAt}
          )
        )
      ) IS TRUE`,
    ),
  }),
);
export type DesktopAuthCode = typeof desktopAuthCodes.$inferSelect;
export type NewDesktopAuthCode = typeof desktopAuthCodes.$inferInsert;

export const portfolioTracks = pgTable(
  "portfolio_tracks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    artist: text("artist"), // optional credit line
    audioUrl: text("audio_url"), // nullable during upload — filled by audio.completeMultipart
    artworkUrl: text("artwork_url"),
    position: integer("position").notNull().default(0), // for ordering
    audioR2Key: text("audio_r2_key"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    durationMs: integer("duration_ms"),
    peaksR2Key: text("peaks_r2_key"),
    // Story 01 of /join flow (PRD §6.2): only tracks with this flag
    // play for unsigned-in visitors on `/join/<slug>`. Default false —
    // producers opt tracks in one at a time. Partial index on
    // (producer_id) WHERE is_public_sample = true keeps per-producer
    // sample lookups on the public teaser cheap.
    isPublicSample: boolean("is_public_sample").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    protectedOwnedAudioUrl: check(
      "portfolio_tracks_protected_owned_audio_url",
      sql`${t.audioR2Key} IS NULL OR ${t.audioUrl} = '/api/audio/public/portfolio/' || ${t.id}::text`,
    ),
  }),
);
export type PortfolioTrack = typeof portfolioTracks.$inferSelect;
export type NewPortfolioTrack = typeof portfolioTracks.$inferInsert;

// ─── Products (formerly packages — Phase H.3 rebuild) ──────────────
// A producer's offerings — anything they sell, not just time-bound
// sessions. Producers don't sell hours; they sell deliverables: a mix,
// a master, a full production, an album, a beat lease. `pricingModel`
// picks how the price is computed (flat / per-song volume tier /
// hourly / bundle). Products expose only Full, 50/50, and Monthly plan
// templates; accepted purchases materialize and freeze the exact schedule.
//
// Soft-delete: `archivedAt` is the newer Phase H shape. The legacy
// `active` boolean stays for back-compat while we migrate callers.
// `position` gives drag-free ordering.
export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // For session-style products (mix-in-person, live tracking) duration
    // is still meaningful — it drives the slot grid. For pure-deliverable
    // products (a mix bought for $2k) duration is effectively "how long
    // the producer needs to block on their calendar"; we keep it
    // required at the DB level but the dashboard surfaces it as
    // "Duration (optional)".
    durationMin: integer("duration_min").notNull(), // per session
    sessionCount: integer("session_count").notNull().default(1),
    // Session duration/count are commercial details, not booking permission.
    // A product must opt in explicitly before a new purchase can materialize
    // an artist booking allowance.
    bookingEnabled: boolean("booking_enabled").notNull().default(false),
    // Flat/bundle price. Still the canonical price for flat products.
    // Per-song products read from volumeTiers instead; hourly reads from
    // hourlyRateCents.
    priceCents: integer("price_cents").notNull().default(0), // 0 = free / discovery
    currency: text("currency").notNull().default("USD"), // ISO 4217
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    // `kind` classifies the offering: "mix" | "master" | "production" |
    // "album" | "beat_lease" | "hourly" | "custom" — plus the legacy
    // Booking v2 values ("session" | "mixing" | "mastering" |
    // "producing" | "other") which the UI keeps rendering for older
    // rows. Kept as free-text so we don't lock the taxonomy down.
    kind: text("kind").notNull().default("session"),
    locationType: text("location_type").notNull().default("studio"), // "studio" | "remote" | "client_space"
    bufferMinutes: integer("buffer_minutes").notNull().default(0),
    minLeadHours: integer("min_lead_hours").notNull().default(12),
    // ─── H.3 additions ────────────────────────────────────────────────
    // How price is computed: 'flat' (priceCents), 'per_song' (volume
    // tiers * qty), 'hourly' (hourlyRateCents * hours), 'bundle'
    // (priceCents + implied sessionCount).
    pricingModel: text("pricing_model").notNull().default("flat"),
    // Per-song tiers: [{ minQty, pricePerUnitCents }, ...], ascending
    // on minQty. Null for non-per-song products.
    volumeTiers: jsonb("volume_tiers").$type<{ minQty: number; pricePerUnitCents: number }[]>(),
    // Hourly rate in cents. Only populated for pricingModel='hourly'.
    hourlyRateCents: integer("hourly_rate_cents"),
    // Deliverables chip list — "Mixed master", "Stems", "Credit",
    // "WAV files". Rendered on the product card. Null/empty = "not
    // specified".
    deliverables: text("deliverables").array(),
    // Soft-delete. Null = live; timestamp = no longer offered (kept for
    // historical booking rows to resolve).
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // Payment plans the producer exposes for this product. Array order
    // is UI order. Default `[{kind:"full"}]` keeps legacy products working
    // untouched until the producer explicitly opts into split/monthly.
    paymentPlans: jsonb("payment_plans")
      .$type<PaymentPlan[]>()
      .notNull()
      .default([{ kind: "full" }]),
    // Nullable for products created before structured rights terms shipped.
    // New product authoring requires an explicit choice for both branches.
    royaltyTerms: jsonb("royalty_terms").$type<ProductRoyaltyTerms>(),
    // Optional URL to a contract PDF the producer hosts elsewhere
    // (Dropbox, Drive, their own site). Mirrors the brand.logoUrl
    // pattern — producers paste a link, no file upload.
    contractUrl: text("contract_url"),
    // Optional inline agreement. Legacy rows may still carry contract_text
    // inside description; reads retain a compatibility fallback until each
    // row is edited into this dedicated field.
    agreementText: text("agreement_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idProducerUnique: unique("products_id_producer_unique").on(t.id, t.producerId),
  }),
);
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

// Weekly recurring availability. One row per (producer, weekday, block)
// — max 2 blocks per weekday (morning/evening). weekday uses JS's
// Date.getDay() numbering: 0 = Sunday … 6 = Saturday. Minutes from
// start of day: 0..1440 (inclusive start, exclusive end).
export const availabilityBlocks = pgTable("availability_blocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id")
    .notNull()
    .references(() => producers.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  startMin: integer("start_min").notNull(),
  endMin: integer("end_min").notNull(),
});
export type AvailabilityBlock = typeof availabilityBlocks.$inferSelect;
export type NewAvailabilityBlock = typeof availabilityBlocks.$inferInsert;

// Blackout ranges — producer-authored "I'm not available, period" windows.
// Stored as YYYY-MM-DD text (not timestamp) because the window is
// conceptual calendar-days in the producer's TZ, not a specific UTC
// instant: Apr 20–24 means "the whole of those days in my TZ", not
// "00:00 UTC on the 20th". Inclusive on both ends. `reason` is a free-
// text hint the producer sees in the dashboard (never shown to the
// visitor — visitor just sees "fully booked").
export const availabilityBlackouts = pgTable(
  "availability_blackouts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "cascade" }),
    startDate: text("start_date").notNull(), // ISO date YYYY-MM-DD in producer's TZ
    endDate: text("end_date").notNull(), // inclusive
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Fast producer-scoped lookup, ordered by startDate — the slot
    // computation lists every blackout for a producer, so this index
    // covers both the filter + the sort.
    producerStartIdx: index("availability_blackouts_producer_start_idx").on(
      t.producerId,
      t.startDate,
    ),
  }),
);

export type Blackout = typeof availabilityBlackouts.$inferSelect;
export type NewBlackout = typeof availabilityBlackouts.$inferInsert;

// Booking status — enum so typos can't drift into the column. Holding
// all statuses in one table (vs. a separate `booking_requests`) keeps
// the audit trail + producer dashboard single-source-of-truth.
export const bookingOrigin = pgEnum("booking_origin", [
  "legacy",
  "artist_request",
  "producer_manual",
]);

export const bookingBillingTreatment = pgEnum("booking_billing_treatment", [
  "included",
  "complimentary",
  "billable_extra",
]);

export const bookingArtistRsvpStatus = pgEnum("booking_artist_rsvp_status", [
  "needs_action",
  "accepted",
  "declined",
  "tentative",
]);

export const bookingStatus = pgEnum("booking_status", [
  "pending_approval",
  "confirmed",
  "rejected",
  "cancelled",
  "completed",
  "no_show",
]);

export const sessionUseOutcome = pgEnum("session_use_outcome", [
  "reserved",
  "completed",
  "cancelled_on_time",
  "cancelled_by_producer",
  "cancelled_late",
  "no_show",
]);

export const bookingTransitionKind = pgEnum("booking_transition_kind", [
  "created",
  "confirmed",
  "rejected",
  "artist_cancelled",
  "producer_cancelled",
  "rescheduled",
  "completed",
  "no_show",
]);

export const bookingTransitionActorKind = pgEnum("booking_transition_actor_kind", [
  "artist",
  "producer",
  "system",
]);

export const bookingHeldExpiryReason = pgEnum("booking_held_expiry_reason", ["approval_timeout"]);

export const bookingChangeRequestKind = pgEnum("booking_change_request_kind", [
  "cancel",
  "reschedule",
]);

export const bookingChangeRequestStatus = pgEnum("booking_change_request_status", [
  "pending",
  "approved",
  "rejected",
]);

export const calendarSyncJobOperation = pgEnum("calendar_sync_job_operation", [
  "send_ics",
  "upsert_google_event",
  "delete_google_event",
  "reconcile_google_event",
]);

export const calendarSyncDeliveryChannel = pgEnum("calendar_sync_delivery_channel", [
  "ics",
  "google",
]);

export const calendarSyncJobStatus = pgEnum("calendar_sync_job_status", [
  "pending",
  "processing",
  "completed",
  "terminal",
]);

export const googleCalendarConnectionStatus = pgEnum("google_calendar_connection_status", [
  "needs_selection",
  "connected",
  "reconnect_required",
  "disconnected",
]);

export const googleCalendarAccessRole = pgEnum("google_calendar_access_role", [
  "freeBusyReader",
  "reader",
  "writerWithoutPrivateAccess",
  "writer",
  "owner",
]);

export const googleCalendarOAuthIntent = pgEnum("google_calendar_oauth_intent", [
  "connect",
  "reconnect",
  "switch_account",
]);

export const bookingCalendarLinkProviderState = pgEnum("booking_calendar_link_provider_state", [
  "uncreated",
  "active",
  "deleted",
]);

export const bookingCalendarLinkSyncState = pgEnum("booking_calendar_link_sync_state", [
  "pending",
  "synced",
  "not_synced",
  "conflict",
  "missing",
  "disconnected",
]);

export const googleCalendarWatchState = pgEnum("google_calendar_watch_state", [
  "renewing",
  "active",
  "retired",
  "expired",
]);

// Closed, non-sensitive failure vocabulary shared by watch health and linked
// event health. Provider response bodies and identifiers never belong here.
export const googleCalendarSyncErrorCode = pgEnum("google_calendar_sync_error_code", [
  "provider_unavailable",
  "rate_limited",
  "permission_denied",
  "reconnect_required",
  "invalid_provider_event",
  "stale_skitza_revision",
  "skitza_overlap",
  "watch_create_failed",
  "watch_renew_failed",
  "watch_stop_failed",
  "reconciliation_failed",
  "unknown",
]);

// Immutable delivery input captured in the same transaction as the booking
// revision it represents. Workers render this snapshot instead of rereading
// mutable producer/contact data, so every retry sends the same RFC 5545 event.
export type CalendarSyncJobPayloadSnapshot = Readonly<{
  schemaVersion: 1;
  method: "REQUEST" | "CANCEL";
  uid: string;
  sequence: number;
  dtstampUtc: string;
  startsAtUtc: string;
  endsAtUtc: string;
  summary: string;
  // System-generated event context only; producer-authored notes are not part
  // of the manual-session contract.
  description: string;
  organizer: Readonly<{ name: string; email: string }>;
  attendee: Readonly<{ name: string; email: string }>;
}>;

export type GoogleCalendarEventPrivateProperties = Readonly<{
  skitzaLink: string;
  skitzaRevision: string;
  skitzaSchema: "1";
}>;

// Google jobs keep only the approved event projection. Opaque holds contain
// no attendee or session URL. Deletes need only private reconciliation
// metadata because the stable provider event identity lives on the link row.
export type GoogleCalendarSyncJobPayloadSnapshot =
  | Readonly<{
      schemaVersion: 2;
      action: "upsert";
      eventKind: "opaque_hold" | "confirmed";
      notificationMode: "none" | "all";
      sequence: number;
      startsAtUtc: string;
      endsAtUtc: string;
      summary: string;
      artistSafeUrl: string | null;
      attendee: Readonly<{ name: string; email: string }> | null;
      privateProperties: GoogleCalendarEventPrivateProperties;
    }>
  | Readonly<{
      schemaVersion: 2;
      action: "delete";
      notificationMode: "none" | "all";
      sequence: number;
      privateProperties: GoogleCalendarEventPrivateProperties;
    }>;

export type GoogleCalendarReconcileJobPayloadSnapshot = Readonly<{
  schemaVersion: 3;
  action: "reconcile";
  source: "webhook" | "recovery";
  watchId: string | null;
  messageNumber: string | null;
}>;

export type CalendarOutboxPayloadSnapshot =
  | CalendarSyncJobPayloadSnapshot
  | GoogleCalendarSyncJobPayloadSnapshot
  | GoogleCalendarReconcileJobPayloadSnapshot;

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references((): AnyPgColumn => projects.id, { onDelete: "restrict" }),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references((): AnyPgColumn => purchases.id, { onDelete: "restrict" }),
    sessionAllowanceId: uuid("session_allowance_id")
      .notNull()
      .references((): AnyPgColumn => purchaseSessionAllowances.id, { onDelete: "restrict" }),
    songId: uuid("song_id").references((): AnyPgColumn => projectTracks.id, {
      onDelete: "restrict",
    }),
    artistName: text("artist_name").notNull(),
    artistEmail: text("artist_email").notNull(),
    artistPhone: text("artist_phone"),
    notes: text("notes"),
    // Legacy rows may retain NULL and use the purchase/project fallback in
    // application reads. Every new booking command writes a normalized title.
    title: text("title"),
    origin: bookingOrigin("origin").notNull().default("legacy"),
    billingTreatment: bookingBillingTreatment("billing_treatment").notNull().default("included"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    durationMin: integer("duration_min").notNull(),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    rescheduledFromBookingId: uuid("rescheduled_from_booking_id"),
    // Reschedule replacements share the original allowance-use identity so
    // both calendar holds reserve capacity while consuming one purchased use.
    allowanceUseId: uuid("allowance_use_id").notNull().defaultRandom(),
    cancellationPolicyHoursSnapshot: integer("cancellation_policy_hours_snapshot").notNull(),
    cancellationPolicySnapshottedAt: timestamp("cancellation_policy_snapshotted_at", {
      withTimezone: true,
    }).notNull(),
    cancellationPolicyBackfilled: boolean("cancellation_policy_backfilled")
      .notNull()
      .default(false),
    // Held requests expire at min(createdAt + 24h, startsAt). Confirmed-at-
    // creation bookings never enter Held and therefore keep this NULL.
    heldExpiresAt: timestamp("held_expires_at", { withTimezone: true }),
    heldExpiredAt: timestamp("held_expired_at", { withTimezone: true }),
    heldExpiryReason: bookingHeldExpiryReason("held_expiry_reason"),
    status: bookingStatus("status").notNull().default("pending_approval"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    outcome: sessionUseOutcome("outcome").notNull().default("reserved"),
    outcomeChangedAt: timestamp("outcome_changed_at", { withTimezone: true }),
    // Monotonic Skitza-side version used by future calendar delivery and
    // reconciliation. Legacy inserts begin at zero; current app commands
    // explicitly start new bookings at revision one.
    calendarRevision: integer("calendar_revision").notNull().default(0),
    artistRsvpStatus: bookingArtistRsvpStatus("artist_rsvp_status"),
    artistRsvpRespondedAt: timestamp("artist_rsvp_responded_at", {
      withTimezone: true,
    }),
    reminderSent24h: timestamp("reminder_sent_24h", { withTimezone: true }),
    reminderSent1h: timestamp("reminder_sent_1h", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idProducerUnique: unique("bookings_id_producer_unique").on(t.id, t.producerId),
    idProducerAllowanceUseUnique: unique("bookings_id_producer_allowance_use_unique").on(
      t.id,
      t.producerId,
      t.allowanceUseId,
    ),
    idProducerRescheduledFromUnique: unique("bookings_id_producer_rescheduled_from_unique").on(
      t.id,
      t.producerId,
      t.rescheduledFromBookingId,
    ),
    idLifecycleUnique: unique("bookings_id_lifecycle_unique").on(
      t.id,
      t.producerId,
      t.purchaseId,
      t.sessionAllowanceId,
    ),
    producerOperationKeyUnique: unique("bookings_producer_operation_key_unique").on(
      t.producerId,
      t.operationKey,
    ),
    rescheduledFromUnique: unique("bookings_rescheduled_from_unique").on(
      t.rescheduledFromBookingId,
    ),
    producerStartsIdx: index("bookings_producer_starts_idx").on(t.producerId, t.startsAt),
    adminActivationIdx: index("bookings_admin_activation_idx").on(
      t.producerId,
      t.createdAt,
      t.purchaseId,
    ),
    purchaseStartsIdx: index("bookings_purchase_starts_idx").on(t.purchaseId, t.startsAt),
    allowanceUseIdx: index("bookings_allowance_use_idx").on(t.sessionAllowanceId, t.allowanceUseId),
    purchaseProjectFk: foreignKey({
      columns: [t.purchaseId, t.projectId],
      foreignColumns: [purchases.id, purchases.projectId],
      name: "bookings_purchase_project_fk",
    }).onDelete("restrict"),
    purchaseProducerFk: foreignKey({
      columns: [t.purchaseId, t.producerId],
      foreignColumns: [purchases.id, purchases.producerId],
      name: "bookings_purchase_producer_fk",
    }).onDelete("restrict"),
    allowancePurchaseFk: foreignKey({
      columns: [t.sessionAllowanceId, t.purchaseId],
      foreignColumns: [purchaseSessionAllowances.id, purchaseSessionAllowances.purchaseId],
      name: "bookings_allowance_purchase_fk",
    }).onDelete("restrict"),
    rescheduledFromFk: foreignKey({
      columns: [t.rescheduledFromBookingId, t.producerId, t.purchaseId, t.sessionAllowanceId],
      foreignColumns: [t.id, t.producerId, t.purchaseId, t.sessionAllowanceId],
      name: "bookings_rescheduled_from_producer_fk",
    }).onDelete("restrict"),
    songPurchaseFk: foreignKey({
      columns: [t.songId, t.purchaseId],
      foreignColumns: [projectTracks.id, projectTracks.purchaseId],
      name: "bookings_song_purchase_fk",
    }).onDelete("restrict"),
    positiveDuration: check("bookings_positive_duration", sql`${t.durationMin} > 0`),
    titleShape: check(
      "bookings_title_shape",
      sql`${t.title} IS NULL OR NULLIF(btrim(${t.title}), '') IS NOT NULL`,
    ),
    calendarRevisionShape: check(
      "bookings_calendar_revision_shape",
      sql`${t.calendarRevision} >= 0`,
    ),
    artistRsvpShape: check(
      "bookings_artist_rsvp_shape",
      sql`(
        (${t.artistRsvpStatus} IS NULL AND ${t.artistRsvpRespondedAt} IS NULL)
        OR (${t.artistRsvpStatus} = 'needs_action' AND ${t.artistRsvpRespondedAt} IS NULL)
        OR (${t.artistRsvpStatus} IN ('accepted', 'declined', 'tentative') AND ${t.artistRsvpRespondedAt} IS NOT NULL)
      ) IS TRUE`,
    ),
    updatedAtShape: check("bookings_updated_at_shape", sql`${t.updatedAt} >= ${t.createdAt}`),
    operationShape: check(
      "bookings_operation_shape",
      sql`NULLIF(btrim(${t.operationKey}), '') IS NOT NULL AND NULLIF(btrim(${t.operationDigest}), '') IS NOT NULL`,
    ),
    rescheduleShape: check(
      "bookings_reschedule_shape",
      sql`${t.rescheduledFromBookingId} IS NULL OR ${t.rescheduledFromBookingId} <> ${t.id}`,
    ),
    cancellationPolicySnapshotShape: check(
      "bookings_cancellation_policy_snapshot_shape",
      sql`${t.cancellationPolicyHoursSnapshot} >= 0
        AND ${t.cancellationPolicySnapshottedAt} >= ${t.createdAt}`,
    ),
    heldExpiryShape: check(
      "bookings_held_expiry_shape",
      sql`(
        (${t.status} <> 'pending_approval' OR ${t.heldExpiresAt} IS NOT NULL)
        AND (
          ${t.heldExpiresAt} IS NULL
          OR ${t.heldExpiresAt} = LEAST(${t.createdAt} + interval '24 hours', ${t.startsAt})
        )
        AND (
          (${t.heldExpiredAt} IS NULL AND ${t.heldExpiryReason} IS NULL)
          OR (
            ${t.heldExpiredAt} IS NOT NULL
            AND ${t.heldExpiryReason} = 'approval_timeout'
            AND ${t.heldExpiresAt} IS NOT NULL
            AND ${t.heldExpiredAt} >= ${t.heldExpiresAt}
            AND ${t.status} = 'cancelled'
            AND ${t.outcome} = 'cancelled_by_producer'
          )
        )
      )`,
    ),
    statusOutcomeShape: check(
      "bookings_status_outcome_shape",
      sql`(
        (${t.status} IN ('pending_approval', 'confirmed') AND ${t.outcome} = 'reserved')
        OR (${t.status} = 'rejected' AND ${t.outcome} = 'cancelled_by_producer')
        OR (${t.status} = 'cancelled' AND ${t.outcome} IN ('cancelled_on_time', 'cancelled_by_producer', 'cancelled_late'))
        OR (${t.status} = 'completed' AND ${t.outcome} = 'completed')
        OR (${t.status} = 'no_show' AND ${t.outcome} = 'no_show')
      )`,
    ),
  }),
);
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;

export const bookingTransitionEvents = pgTable(
  "booking_transition_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    kind: bookingTransitionKind("kind").notNull(),
    actorKind: bookingTransitionActorKind("actor_kind").notNull(),
    actorId: text("actor_id"),
    fromStatus: bookingStatus("from_status"),
    toStatus: bookingStatus("to_status").notNull(),
    fromOutcome: sessionUseOutcome("from_outcome"),
    toOutcome: sessionUseOutcome("to_outcome").notNull(),
    oldStartsAt: timestamp("old_starts_at", { withTimezone: true }),
    newStartsAt: timestamp("new_starts_at", { withTimezone: true }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    operationKeyUnique: unique("booking_transition_events_operation_key_unique").on(
      t.bookingId,
      t.operationKey,
    ),
    bookingProducerFk: foreignKey({
      columns: [t.bookingId, t.producerId],
      foreignColumns: [bookings.id, bookings.producerId],
      name: "booking_transition_events_booking_producer_fk",
    }).onDelete("restrict"),
    bookingOccurredIdx: index("booking_transition_events_booking_occurred_idx").on(
      t.bookingId,
      t.occurredAt,
      t.id,
    ),
    producerOccurredIdx: index("booking_transition_events_producer_occurred_idx").on(
      t.producerId,
      t.occurredAt,
      t.id,
    ),
    operationShape: check(
      "booking_transition_events_operation_shape",
      sql`NULLIF(btrim(${t.operationKey}), '') IS NOT NULL AND NULLIF(btrim(${t.operationDigest}), '') IS NOT NULL`,
    ),
    actorShape: check(
      "booking_transition_events_actor_shape",
      sql`(
        (${t.actorKind} = 'system' AND ${t.actorId} IS NULL)
        OR (${t.actorKind} IN ('artist', 'producer') AND NULLIF(btrim(${t.actorId}), '') IS NOT NULL)
      )`,
    ),
    stateShape: check(
      "booking_transition_events_state_shape",
      sql`((
        (${t.kind} = 'created' AND ${t.fromStatus} IS NULL AND ${t.fromOutcome} IS NULL AND ${t.toStatus} IN ('pending_approval', 'confirmed') AND ${t.toOutcome} = 'reserved')
        OR (${t.kind} = 'confirmed' AND ${t.fromStatus} = 'pending_approval' AND ${t.toStatus} = 'confirmed' AND ${t.fromOutcome} = 'reserved' AND ${t.toOutcome} = 'reserved')
        OR (${t.kind} = 'rejected' AND ${t.fromStatus} = 'pending_approval' AND ${t.toStatus} = 'rejected' AND ${t.fromOutcome} = 'reserved' AND ${t.toOutcome} = 'cancelled_by_producer')
        OR (${t.kind} = 'artist_cancelled' AND ${t.fromStatus} IN ('pending_approval', 'confirmed') AND ${t.toStatus} = 'cancelled' AND ${t.fromOutcome} = 'reserved' AND ${t.toOutcome} IN ('cancelled_on_time', 'cancelled_late'))
        OR (${t.kind} = 'producer_cancelled' AND ${t.fromStatus} IN ('pending_approval', 'confirmed') AND ${t.toStatus} = 'cancelled' AND ${t.fromOutcome} = 'reserved' AND ${t.toOutcome} = 'cancelled_by_producer')
        OR (${t.kind} = 'rescheduled' AND ((
          ${t.fromStatus} IN ('pending_approval', 'confirmed') AND ${t.toStatus} = 'cancelled' AND ${t.fromOutcome} = 'reserved' AND ${t.toOutcome} = 'cancelled_on_time'
        ) OR (
          ${t.fromStatus} IS NULL AND ${t.fromOutcome} IS NULL AND ${t.toStatus} IN ('pending_approval', 'confirmed') AND ${t.toOutcome} = 'reserved'
        )))
        OR (${t.kind} = 'completed' AND ${t.fromStatus} = 'confirmed' AND ${t.toStatus} = 'completed' AND ${t.fromOutcome} = 'reserved' AND ${t.toOutcome} = 'completed')
        OR (${t.kind} = 'no_show' AND ${t.fromStatus} = 'confirmed' AND ${t.toStatus} = 'no_show' AND ${t.fromOutcome} = 'reserved' AND ${t.toOutcome} = 'no_show')
      ) IS TRUE)`,
    ),
    rescheduleShape: check(
      "booking_transition_events_reschedule_shape",
      sql`(
        (${t.kind} = 'created' AND ${t.oldStartsAt} IS NULL AND ${t.newStartsAt} IS NOT NULL)
        OR (${t.kind} = 'rescheduled' AND ${t.newStartsAt} IS NOT NULL AND (
          (${t.fromStatus} IS NULL AND ${t.oldStartsAt} IS NULL)
          OR (${t.fromStatus} IS NOT NULL AND ${t.oldStartsAt} IS NOT NULL)
        ))
        OR (${t.kind} NOT IN ('created', 'rescheduled') AND ${t.oldStartsAt} IS NOT NULL AND ${t.newStartsAt} IS NULL)
      )`,
    ),
  }),
);
export type BookingTransitionEvent = typeof bookingTransitionEvents.$inferSelect;
export type NewBookingTransitionEvent = typeof bookingTransitionEvents.$inferInsert;

// Artist cancellation/reschedule intent is durable and separate from the
// booking lifecycle. A pending request leaves the confirmed booking unchanged;
// only an approved producer decision may point at a reschedule replacement.
export const bookingChangeRequests = pgTable(
  "booking_change_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    kind: bookingChangeRequestKind("kind").notNull(),
    status: bookingChangeRequestStatus("status").notNull().default("pending"),
    proposedStartsAt: timestamp("proposed_starts_at", { withTimezone: true }),
    requestOperationKey: text("request_operation_key").notNull(),
    requestOperationDigest: text("request_operation_digest").notNull(),
    requestedByClerkUserId: text("requested_by_clerk_user_id").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    decisionOperationKey: text("decision_operation_key"),
    decisionOperationDigest: text("decision_operation_digest"),
    decidedByClerkUserId: text("decided_by_clerk_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    replacementBookingId: uuid("replacement_booking_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    requestOperationUnique: unique("booking_change_requests_request_operation_unique").on(
      t.bookingId,
      t.requestOperationKey,
    ),
    decisionOperationUnique: uniqueIndex("booking_change_requests_decision_operation_unique")
      .on(t.bookingId, t.decisionOperationKey)
      .where(sql`${t.decisionOperationKey} IS NOT NULL`),
    onePendingPerBooking: uniqueIndex("booking_change_requests_one_pending_per_booking")
      .on(t.bookingId)
      .where(sql`${t.status} = 'pending'`),
    replacementBookingUnique: uniqueIndex("booking_change_requests_replacement_booking_unique")
      .on(t.replacementBookingId)
      .where(sql`${t.replacementBookingId} IS NOT NULL`),
    bookingProducerFk: foreignKey({
      columns: [t.bookingId, t.producerId],
      foreignColumns: [bookings.id, bookings.producerId],
      name: "booking_change_requests_booking_producer_fk",
    }).onDelete("restrict"),
    replacementBookingProducerFk: foreignKey({
      columns: [t.replacementBookingId, t.producerId],
      foreignColumns: [bookings.id, bookings.producerId],
      name: "booking_change_requests_replacement_booking_producer_fk",
    }).onDelete("restrict"),
    replacementBookingLineageFk: foreignKey({
      columns: [t.replacementBookingId, t.producerId, t.bookingId],
      foreignColumns: [bookings.id, bookings.producerId, bookings.rescheduledFromBookingId],
      name: "booking_change_requests_replacement_booking_lineage_fk",
    }).onDelete("restrict"),
    producerStatusRequestedIdx: index("booking_change_requests_producer_status_requested_idx").on(
      t.producerId,
      t.status,
      t.requestedAt,
      t.id,
    ),
    bookingRequestedIdx: index("booking_change_requests_booking_requested_idx").on(
      t.bookingId,
      t.requestedAt,
      t.id,
    ),
    requestIdentityShape: check(
      "booking_change_requests_request_identity_shape",
      sql`(
        NULLIF(btrim(${t.requestOperationKey}), '') IS NOT NULL
        AND char_length(${t.requestOperationKey}) <= 200
        AND NULLIF(btrim(${t.requestOperationDigest}), '') IS NOT NULL
        AND ${t.requestedByClerkUserId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      ) IS TRUE`,
    ),
    proposedStartShape: check(
      "booking_change_requests_proposed_start_shape",
      sql`(
        (${t.kind} = 'cancel' AND ${t.proposedStartsAt} IS NULL)
        OR (${t.kind} = 'reschedule' AND ${t.proposedStartsAt} IS NOT NULL)
      ) IS TRUE`,
    ),
    replacementIdentityShape: check(
      "booking_change_requests_replacement_identity_shape",
      sql`${t.replacementBookingId} IS NULL OR ${t.replacementBookingId} <> ${t.bookingId}`,
    ),
    decisionShape: check(
      "booking_change_requests_decision_shape",
      sql`(
        (
          ${t.status} = 'pending'
          AND ${t.decisionOperationKey} IS NULL
          AND ${t.decisionOperationDigest} IS NULL
          AND ${t.decidedByClerkUserId} IS NULL
          AND ${t.decidedAt} IS NULL
          AND ${t.replacementBookingId} IS NULL
        )
        OR (
          ${t.status} IN ('approved', 'rejected')
          AND NULLIF(btrim(${t.decisionOperationKey}), '') IS NOT NULL
          AND char_length(${t.decisionOperationKey}) <= 200
          AND NULLIF(btrim(${t.decisionOperationDigest}), '') IS NOT NULL
          AND ${t.decidedByClerkUserId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
          AND ${t.decidedAt} IS NOT NULL
          AND ${t.decidedAt} >= ${t.requestedAt}
          AND (
            (${t.status} = 'approved' AND ${t.kind} = 'reschedule' AND ${t.replacementBookingId} IS NOT NULL)
            OR (${t.status} = 'approved' AND ${t.kind} = 'cancel' AND ${t.replacementBookingId} IS NULL)
            OR (${t.status} = 'rejected' AND ${t.replacementBookingId} IS NULL)
          )
        )
      ) IS TRUE`,
    ),
    timestampShape: check(
      "booking_change_requests_timestamp_shape",
      sql`${t.updatedAt} >= ${t.createdAt}`,
    ),
  }),
);
export type BookingChangeRequest = typeof bookingChangeRequests.$inferSelect;
export type NewBookingChangeRequest = typeof bookingChangeRequests.$inferInsert;

// Transactional base outbox for recoverable calendar invitation delivery.
// Google-specific connection/link state intentionally does not belong here.
export const calendarSyncJobs = pgTable(
  "calendar_sync_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    deliveryChannel: calendarSyncDeliveryChannel("delivery_channel").notNull().default("ics"),
    bookingCalendarLinkId: uuid("booking_calendar_link_id"),
    googleCalendarWatchId: uuid("google_calendar_watch_id"),
    webhookMessageNumber: text("webhook_message_number"),
    operation: calendarSyncJobOperation("operation").notNull(),
    status: calendarSyncJobStatus("status").notNull().default("pending"),
    desiredRevision: integer("desired_revision").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadSnapshot: jsonb("payload_snapshot").$type<CalendarOutboxPayloadSnapshot>().notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    providerDedupeExpiresAt: timestamp("provider_dedupe_expires_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow(),
    leaseToken: text("lease_token"),
    leaseAcquiredAt: timestamp("lease_acquired_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    terminalAt: timestamp("terminal_at", { withTimezone: true }),
    terminalError: text("terminal_error"),
    manualRetryCount: integer("manual_retry_count").notNull().default(0),
    lastManualRetryAt: timestamp("last_manual_retry_at", { withTimezone: true }),
    lastManualRetryActor: text("last_manual_retry_actor"),
    lastManualRetryOperationKey: text("last_manual_retry_operation_key"),
    lastManualRetryOperationDigest: text("last_manual_retry_operation_digest"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idempotencyUnique: unique("calendar_sync_jobs_idempotency_unique").on(t.idempotencyKey),
    idProducerUnique: unique("calendar_sync_jobs_id_producer_unique").on(t.id, t.producerId),
    icsBookingOperationRevisionUnique: uniqueIndex(
      "calendar_sync_jobs_ics_booking_operation_revision_unique",
    )
      .on(t.bookingId, t.operation, t.desiredRevision)
      .where(sql`${t.deliveryChannel} = 'ics'`),
    linkOutboundRevisionUnique: uniqueIndex("calendar_sync_jobs_link_outbound_revision_unique")
      .on(t.bookingCalendarLinkId, t.desiredRevision)
      .where(
        sql`${t.bookingCalendarLinkId} IS NOT NULL AND ${t.operation} IN ('upsert_google_event', 'delete_google_event')`,
      ),
    watchMessageLinkUnique: uniqueIndex("calendar_sync_jobs_watch_message_link_unique")
      .on(t.googleCalendarWatchId, t.webhookMessageNumber, t.bookingCalendarLinkId)
      .where(
        sql`${t.operation} = 'reconcile_google_event' AND ${t.googleCalendarWatchId} IS NOT NULL`,
      ),
    uidRevisionUnique: uniqueIndex("calendar_sync_jobs_uid_revision_unique").on(
      sql`(${t.payloadSnapshot}->>'uid')`,
      t.desiredRevision,
    ),
    bookingProducerFk: foreignKey({
      columns: [t.bookingId, t.producerId],
      foreignColumns: [bookings.id, bookings.producerId],
      name: "calendar_sync_jobs_booking_producer_fk",
    }).onDelete("restrict"),
    bookingCalendarLinkProducerFk: foreignKey({
      columns: [t.bookingCalendarLinkId, t.producerId],
      foreignColumns: [bookingCalendarLinks.id, bookingCalendarLinks.producerId],
      name: "calendar_sync_jobs_booking_calendar_link_producer_fk",
    }).onDelete("restrict"),
    googleCalendarWatchProducerFk: foreignKey({
      columns: [t.googleCalendarWatchId, t.producerId],
      foreignColumns: [googleCalendarWatches.id, googleCalendarWatches.producerId],
      name: "calendar_sync_jobs_google_calendar_watch_producer_fk",
    }).onDelete("restrict"),
    claimIdx: index("calendar_sync_jobs_claim_idx").on(
      t.status,
      t.nextAttemptAt,
      t.leaseExpiresAt,
      t.id,
    ),
    bookingRevisionIdx: index("calendar_sync_jobs_booking_revision_idx").on(
      t.bookingId,
      t.desiredRevision,
      t.createdAt,
      t.id,
    ),
    producerUpdatedIdx: index("calendar_sync_jobs_producer_updated_idx").on(
      t.producerId,
      t.updatedAt,
      t.id,
    ),
    identityShape: check(
      "calendar_sync_jobs_identity_shape",
      sql`(
        ${t.desiredRevision} > 0
        AND NULLIF(btrim(${t.idempotencyKey}), '') IS NOT NULL
        AND char_length(${t.idempotencyKey}) <= 256
        AND ${t.attemptCount} >= 0
        AND ${t.manualRetryCount} >= 0
      ) IS TRUE`,
    ),
    channelShape: check(
      "calendar_sync_jobs_channel_shape",
      sql`(
        (
          ${t.operation} = 'send_ics'
          AND ${t.deliveryChannel} = 'ics'
        )
        OR (
          ${t.operation} IN ('upsert_google_event', 'delete_google_event', 'reconcile_google_event')
          AND ${t.deliveryChannel} = 'google'
          AND ${t.bookingCalendarLinkId} IS NOT NULL
        )
      ) IS TRUE`,
    ),
    payloadShape: check(
      "calendar_sync_jobs_payload_shape",
      sql`(
        jsonb_typeof(${t.payloadSnapshot}) = 'object'
        AND (
          (
            ${t.operation} = 'send_ics'
            AND ${t.payloadSnapshot}->>'schemaVersion' = '1'
            AND ${t.payloadSnapshot}->>'method' IN ('REQUEST', 'CANCEL')
            AND (${t.payloadSnapshot}->>'sequence') ~ '^[0-9]+$'
            AND (${t.payloadSnapshot}->>'sequence')::integer = ${t.desiredRevision}
            AND NULLIF(btrim(${t.payloadSnapshot}->>'uid'), '') IS NOT NULL
            AND char_length(${t.payloadSnapshot}->>'uid') <= 255
            AND NULLIF(btrim(${t.payloadSnapshot}->>'dtstampUtc'), '') IS NOT NULL
            AND right(${t.payloadSnapshot}->>'dtstampUtc', 1) = 'Z'
            AND NULLIF(btrim(${t.payloadSnapshot}->>'startsAtUtc'), '') IS NOT NULL
            AND right(${t.payloadSnapshot}->>'startsAtUtc', 1) = 'Z'
            AND NULLIF(btrim(${t.payloadSnapshot}->>'endsAtUtc'), '') IS NOT NULL
            AND right(${t.payloadSnapshot}->>'endsAtUtc', 1) = 'Z'
            AND NULLIF(btrim(${t.payloadSnapshot}->>'summary'), '') IS NOT NULL
            AND jsonb_typeof(${t.payloadSnapshot}->'description') = 'string'
            AND jsonb_typeof(${t.payloadSnapshot}->'organizer') = 'object'
            AND NULLIF(btrim(${t.payloadSnapshot}->'organizer'->>'name'), '') IS NOT NULL
            AND NULLIF(btrim(${t.payloadSnapshot}->'organizer'->>'email'), '') IS NOT NULL
            AND jsonb_typeof(${t.payloadSnapshot}->'attendee') = 'object'
            AND NULLIF(btrim(${t.payloadSnapshot}->'attendee'->>'name'), '') IS NOT NULL
            AND NULLIF(btrim(${t.payloadSnapshot}->'attendee'->>'email'), '') IS NOT NULL
          )
          OR (
            ${t.operation} IN ('upsert_google_event', 'delete_google_event')
            AND ${t.payloadSnapshot}->>'schemaVersion' = '2'
            AND (${t.payloadSnapshot}->>'sequence') ~ '^[0-9]+$'
            AND (${t.payloadSnapshot}->>'sequence')::integer = ${t.desiredRevision}
            AND jsonb_typeof(${t.payloadSnapshot}->'privateProperties') = 'object'
            AND ((${t.payloadSnapshot}->'privateProperties') - ARRAY[
              'skitzaLink', 'skitzaRevision', 'skitzaSchema'
            ]::text[]) = '{}'::jsonb
            AND ${t.payloadSnapshot}->'privateProperties'->>'skitzaLink'
              = ${t.bookingCalendarLinkId}::text
            AND ${t.payloadSnapshot}->'privateProperties'->>'skitzaRevision'
              = ${t.desiredRevision}::text
            AND ${t.payloadSnapshot}->'privateProperties'->>'skitzaSchema' = '1'
            AND (
              (
                ${t.operation} = 'upsert_google_event'
                AND ${t.payloadSnapshot}->>'action' = 'upsert'
                AND (${t.payloadSnapshot} - ARRAY[
                  'schemaVersion', 'action', 'eventKind', 'notificationMode', 'sequence',
                  'startsAtUtc', 'endsAtUtc', 'summary', 'artistSafeUrl',
                  'attendee', 'privateProperties'
                ]::text[]) = '{}'::jsonb
                AND ${t.payloadSnapshot}->>'eventKind' IN ('opaque_hold', 'confirmed')
                AND ${t.payloadSnapshot}->>'notificationMode' IN ('none', 'all')
                AND NULLIF(btrim(${t.payloadSnapshot}->>'startsAtUtc'), '') IS NOT NULL
                AND right(${t.payloadSnapshot}->>'startsAtUtc', 1) = 'Z'
                AND char_length(${t.payloadSnapshot}->>'startsAtUtc') <= 64
                AND NULLIF(btrim(${t.payloadSnapshot}->>'endsAtUtc'), '') IS NOT NULL
                AND right(${t.payloadSnapshot}->>'endsAtUtc', 1) = 'Z'
                AND char_length(${t.payloadSnapshot}->>'endsAtUtc') <= 64
                AND ${t.payloadSnapshot}->>'endsAtUtc' <> ${t.payloadSnapshot}->>'startsAtUtc'
                AND NULLIF(btrim(${t.payloadSnapshot}->>'summary'), '') IS NOT NULL
                AND char_length(${t.payloadSnapshot}->>'summary') <= 1024
                AND (
                  (
                    ${t.payloadSnapshot}->>'eventKind' = 'opaque_hold'
                    AND ${t.payloadSnapshot}->>'summary' = 'Reserved'
                    AND ${t.payloadSnapshot}->>'notificationMode' = 'none'
                    AND jsonb_typeof(${t.payloadSnapshot}->'artistSafeUrl') = 'null'
                    AND jsonb_typeof(${t.payloadSnapshot}->'attendee') = 'null'
                  )
                  OR (
                    ${t.payloadSnapshot}->>'eventKind' = 'confirmed'
                    AND jsonb_typeof(${t.payloadSnapshot}->'artistSafeUrl') = 'string'
                    AND ${t.payloadSnapshot}->>'artistSafeUrl' ~ '^https://[^[:space:]]+$'
                    AND char_length(${t.payloadSnapshot}->>'artistSafeUrl') <= 2048
                    AND jsonb_typeof(${t.payloadSnapshot}->'attendee') = 'object'
                    AND ((${t.payloadSnapshot}->'attendee') - ARRAY['name', 'email']::text[])
                      = '{}'::jsonb
                    AND NULLIF(btrim(${t.payloadSnapshot}->'attendee'->>'name'), '') IS NOT NULL
                    AND char_length(${t.payloadSnapshot}->'attendee'->>'name') <= 320
                    AND NULLIF(btrim(${t.payloadSnapshot}->'attendee'->>'email'), '') IS NOT NULL
                    AND char_length(${t.payloadSnapshot}->'attendee'->>'email') <= 320
                  )
                )
              )
              OR (
                ${t.operation} = 'delete_google_event'
                AND ${t.payloadSnapshot}->>'action' = 'delete'
                AND (${t.payloadSnapshot} - ARRAY[
                  'schemaVersion', 'action', 'notificationMode', 'sequence', 'privateProperties'
                ]::text[]) = '{}'::jsonb
                AND ${t.payloadSnapshot}->>'notificationMode' IN ('none', 'all')
              )
            )
          )
          OR (
            ${t.operation} = 'reconcile_google_event'
            AND ${t.payloadSnapshot}->>'schemaVersion' = '3'
            AND ${t.payloadSnapshot}->>'action' = 'reconcile'
            AND (${t.payloadSnapshot} - ARRAY[
              'schemaVersion', 'action', 'source', 'watchId', 'messageNumber'
            ]::text[]) = '{}'::jsonb
            AND ${t.payloadSnapshot}->>'source' IN ('webhook', 'recovery')
            AND (
              (
                ${t.payloadSnapshot}->>'source' = 'webhook'
                AND ${t.googleCalendarWatchId} IS NOT NULL
                AND ${t.webhookMessageNumber} ~ '^[1-9][0-9]{0,38}$'
                AND ${t.payloadSnapshot}->>'watchId' = ${t.googleCalendarWatchId}::text
                AND ${t.payloadSnapshot}->>'messageNumber' = ${t.webhookMessageNumber}
              )
              OR (
                ${t.payloadSnapshot}->>'source' = 'recovery'
                AND ${t.googleCalendarWatchId} IS NULL
                AND ${t.webhookMessageNumber} IS NULL
                AND jsonb_typeof(${t.payloadSnapshot}->'watchId') = 'null'
                AND jsonb_typeof(${t.payloadSnapshot}->'messageNumber') = 'null'
              )
            )
          )
        )
      ) IS TRUE`,
    ),
    attemptShape: check(
      "calendar_sync_jobs_attempt_shape",
      sql`(
        (
          ${t.attemptCount} = 0
          AND ${t.firstAttemptAt} IS NULL
          AND ${t.lastAttemptAt} IS NULL
          AND ${t.providerDedupeExpiresAt} IS NULL
        )
        OR (
          ${t.attemptCount} > 0
          AND ${t.firstAttemptAt} IS NOT NULL
          AND ${t.lastAttemptAt} >= ${t.firstAttemptAt}
          AND (
            (
              ${t.deliveryChannel} = 'ics'
              AND ${t.providerDedupeExpiresAt} > ${t.firstAttemptAt}
            )
            OR (
              ${t.deliveryChannel} = 'google'
              AND ${t.providerDedupeExpiresAt} IS NULL
            )
          )
        )
      ) IS TRUE`,
    ),
    stateShape: check(
      "calendar_sync_jobs_state_shape",
      sql`(
        (
          ${t.status} = 'pending'
          AND ${t.nextAttemptAt} IS NOT NULL
          AND ${t.leaseToken} IS NULL
          AND ${t.leaseAcquiredAt} IS NULL
          AND ${t.leaseExpiresAt} IS NULL
          AND ${t.providerMessageId} IS NULL
          AND ${t.completedAt} IS NULL
          AND ${t.terminalAt} IS NULL
          AND ${t.terminalError} IS NULL
        )
        OR (
          ${t.status} = 'processing'
          AND ${t.nextAttemptAt} IS NULL
          AND NULLIF(btrim(${t.leaseToken}), '') IS NOT NULL
          AND ${t.leaseAcquiredAt} IS NOT NULL
          AND ${t.leaseAcquiredAt} = ${t.lastAttemptAt}
          AND ${t.leaseExpiresAt} > ${t.leaseAcquiredAt}
          AND ${t.attemptCount} > 0
          AND ${t.providerMessageId} IS NULL
          AND ${t.completedAt} IS NULL
          AND ${t.terminalAt} IS NULL
          AND ${t.terminalError} IS NULL
        )
        OR (
          ${t.status} = 'completed'
          AND ${t.nextAttemptAt} IS NULL
          AND ${t.leaseToken} IS NULL
          AND ${t.leaseAcquiredAt} IS NULL
          AND ${t.leaseExpiresAt} IS NULL
          AND ${t.attemptCount} > 0
          AND NULLIF(btrim(${t.providerMessageId}), '') IS NOT NULL
          AND ${t.completedAt} IS NOT NULL
          AND ${t.terminalAt} IS NULL
          AND ${t.terminalError} IS NULL
        )
        OR (
          ${t.status} = 'terminal'
          AND ${t.nextAttemptAt} IS NULL
          AND ${t.leaseToken} IS NULL
          AND ${t.leaseAcquiredAt} IS NULL
          AND ${t.leaseExpiresAt} IS NULL
          AND ${t.attemptCount} > 0
          AND ${t.providerMessageId} IS NULL
          AND ${t.completedAt} IS NULL
          AND ${t.terminalAt} IS NOT NULL
          AND NULLIF(btrim(${t.terminalError}), '') IS NOT NULL
        )
      ) IS TRUE`,
    ),
    timestampShape: check(
      "calendar_sync_jobs_timestamp_shape",
      sql`(
        ${t.updatedAt} >= ${t.createdAt}
        AND (${t.firstAttemptAt} IS NULL OR ${t.firstAttemptAt} >= ${t.createdAt})
        AND (${t.lastAttemptAt} IS NULL OR ${t.lastAttemptAt} >= ${t.firstAttemptAt})
        AND (${t.completedAt} IS NULL OR ${t.completedAt} >= ${t.lastAttemptAt})
        AND (${t.terminalAt} IS NULL OR ${t.terminalAt} >= ${t.lastAttemptAt})
        AND (${t.lastManualRetryAt} IS NULL OR ${t.lastManualRetryAt} >= ${t.createdAt})
        AND (${t.lastManualRetryAt} IS NULL OR ${t.updatedAt} >= ${t.lastManualRetryAt})
      ) IS TRUE`,
    ),
    manualRetryShape: check(
      "calendar_sync_jobs_manual_retry_shape",
      sql`(
        (
          ${t.manualRetryCount} = 0
          AND ${t.lastManualRetryAt} IS NULL
          AND ${t.lastManualRetryActor} IS NULL
          AND ${t.lastManualRetryOperationKey} IS NULL
          AND ${t.lastManualRetryOperationDigest} IS NULL
        )
        OR (
          ${t.manualRetryCount} > 0
          AND ${t.lastManualRetryAt} IS NOT NULL
          AND NULLIF(btrim(${t.lastManualRetryActor}), '') IS NOT NULL
          AND NULLIF(btrim(${t.lastManualRetryOperationKey}), '') IS NOT NULL
          AND ${t.lastManualRetryOperationDigest} ~ '^sha256:[0-9a-f]{64}$'
        )
      ) IS TRUE`,
    ),
    errorShape: check(
      "calendar_sync_jobs_error_shape",
      sql`(
        (
          ${t.lastError} IS NULL
          OR (
            NULLIF(btrim(${t.lastError}), '') IS NOT NULL
            AND char_length(${t.lastError}) <= 4000
          )
        )
        AND (
          ${t.terminalError} IS NULL
          OR char_length(${t.terminalError}) <= 4000
        )
        AND (
          ${t.leaseToken} IS NULL
          OR char_length(${t.leaseToken}) <= 200
        )
        AND (
          ${t.lastManualRetryActor} IS NULL
          OR char_length(${t.lastManualRetryActor}) <= 200
        )
        AND (
          ${t.lastManualRetryOperationKey} IS NULL
          OR char_length(${t.lastManualRetryOperationKey}) <= 200
        )
      ) IS TRUE`,
    ),
  }),
);
export type CalendarSyncJob = typeof calendarSyncJobs.$inferSelect;
export type NewCalendarSyncJob = typeof calendarSyncJobs.$inferInsert;

// Append-only audit of each deliberate operator reissue. The current job row
// holds the active provider identity; this table preserves every prior
// terminal delivery cycle so rotating the Resend idempotency key never erases
// the ambiguous failure that required human intervention.
export const calendarSyncJobManualRetries = pgTable(
  "calendar_sync_job_manual_retries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    retryNumber: integer("retry_number").notNull(),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    actorIdentity: text("actor_identity").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    priorIdempotencyKey: text("prior_idempotency_key").notNull(),
    newIdempotencyKey: text("new_idempotency_key").notNull(),
    priorAttemptCount: integer("prior_attempt_count").notNull(),
    priorFirstAttemptAt: timestamp("prior_first_attempt_at", { withTimezone: true }).notNull(),
    priorLastAttemptAt: timestamp("prior_last_attempt_at", { withTimezone: true }).notNull(),
    priorProviderDedupeExpiresAt: timestamp("prior_provider_dedupe_expires_at", {
      withTimezone: true,
    }),
    priorLastError: text("prior_last_error"),
    priorTerminalAt: timestamp("prior_terminal_at", { withTimezone: true }).notNull(),
    priorTerminalError: text("prior_terminal_error").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    jobRetryUnique: unique("calendar_sync_job_manual_retries_job_retry_unique").on(
      t.jobId,
      t.retryNumber,
    ),
    operationUnique: unique("calendar_sync_job_manual_retries_operation_unique").on(t.operationKey),
    newIdempotencyUnique: unique("calendar_sync_job_manual_retries_new_idempotency_unique").on(
      t.newIdempotencyKey,
    ),
    jobProducerFk: foreignKey({
      columns: [t.jobId, t.producerId],
      foreignColumns: [calendarSyncJobs.id, calendarSyncJobs.producerId],
      name: "calendar_sync_job_manual_retries_job_producer_fk",
    }).onDelete("restrict"),
    producerRequestedIdx: index("calendar_sync_job_manual_retries_producer_requested_idx").on(
      t.producerId,
      t.requestedAt,
      t.id,
    ),
    identityShape: check(
      "calendar_sync_job_manual_retries_identity_shape",
      sql`(
        ${t.retryNumber} > 0
        AND NULLIF(btrim(${t.operationKey}), '') IS NOT NULL
        AND char_length(${t.operationKey}) <= 200
        AND ${t.operationDigest} ~ '^sha256:[0-9a-f]{64}$'
        AND NULLIF(btrim(${t.actorIdentity}), '') IS NOT NULL
        AND char_length(${t.actorIdentity}) <= 200
        AND NULLIF(btrim(${t.priorIdempotencyKey}), '') IS NOT NULL
        AND char_length(${t.priorIdempotencyKey}) <= 256
        AND NULLIF(btrim(${t.newIdempotencyKey}), '') IS NOT NULL
        AND char_length(${t.newIdempotencyKey}) <= 256
        AND ${t.newIdempotencyKey} <> ${t.priorIdempotencyKey}
      ) IS TRUE`,
    ),
    priorAttemptShape: check(
      "calendar_sync_job_manual_retries_prior_attempt_shape",
      sql`(
        ${t.priorAttemptCount} > 0
        AND ${t.priorLastAttemptAt} >= ${t.priorFirstAttemptAt}
        AND (
          ${t.priorProviderDedupeExpiresAt} IS NULL
          OR ${t.priorProviderDedupeExpiresAt} > ${t.priorFirstAttemptAt}
        )
      ) IS TRUE`,
    ),
    timestampShape: check(
      "calendar_sync_job_manual_retries_timestamp_shape",
      sql`(
        ${t.priorTerminalAt} >= ${t.priorLastAttemptAt}
        AND ${t.requestedAt} >= ${t.priorTerminalAt}
        AND ${t.createdAt} = ${t.requestedAt}
      ) IS TRUE`,
    ),
    errorShape: check(
      "calendar_sync_job_manual_retries_error_shape",
      sql`(
        NULLIF(btrim(${t.priorTerminalError}), '') IS NOT NULL
        AND char_length(${t.priorTerminalError}) <= 4000
        AND (
          ${t.priorLastError} IS NULL
          OR (
            NULLIF(btrim(${t.priorLastError}), '') IS NOT NULL
            AND char_length(${t.priorLastError}) <= 4000
          )
        )
      ) IS TRUE`,
    ),
  }),
);
export type CalendarSyncJobManualRetry = typeof calendarSyncJobManualRetries.$inferSelect;
export type NewCalendarSyncJobManualRetry = typeof calendarSyncJobManualRetries.$inferInsert;

// Producer-only Google Calendar credentials. Access and refresh tokens are
// encrypted by the web server before they cross the database boundary. The
// row keeps one stable Google subject per account version so an explicit
// account switch cannot reuse state from the previous Google account.
export const googleCalendarConnections = pgTable(
  "google_calendar_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // The explicitly named producer FK below preserves the same CASCADE
    // ownership rule while keeping schema and migration constraint names equal.
    producerId: uuid("producer_id").notNull(),
    googleSubject: text("google_subject").notNull(),
    googleAccountEmail: text("google_account_email").notNull(),
    accountVersion: integer("account_version").notNull().default(1),
    status: googleCalendarConnectionStatus("status").notNull().default("needs_selection"),
    grantedScopes: text("granted_scopes").array().notNull(),
    accessTokenCiphertext: text("access_token_ciphertext"),
    accessTokenIv: text("access_token_iv"),
    accessTokenAuthTag: text("access_token_auth_tag"),
    accessTokenKeyVersion: integer("access_token_key_version"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    refreshTokenIv: text("refresh_token_iv"),
    refreshTokenAuthTag: text("refresh_token_auth_tag"),
    refreshTokenKeyVersion: integer("refresh_token_key_version"),
    refreshTokenUpdatedAt: timestamp("refresh_token_updated_at", { withTimezone: true }),
    lastAuthorizedAt: timestamp("last_authorized_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reconnectRequiredAt: timestamp("reconnect_required_at", { withTimezone: true }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    lastSuccessfulAvailabilitySyncAt: timestamp("last_successful_availability_sync_at", {
      withTimezone: true,
    }),
    lastSuccessfulEventSyncAt: timestamp("last_successful_event_sync_at", {
      withTimezone: true,
    }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    producerFk: foreignKey({
      columns: [t.producerId],
      foreignColumns: [producers.id],
      name: "google_calendar_connections_producer_fk",
    }).onDelete("cascade"),
    producerUnique: unique("google_calendar_connections_producer_unique").on(t.producerId),
    idProducerUnique: unique("google_calendar_connections_id_producer_unique").on(
      t.id,
      t.producerId,
    ),
    idProducerAccountUnique: unique("google_calendar_connections_id_producer_account_unique").on(
      t.id,
      t.producerId,
      t.accountVersion,
    ),
    identityShape: check(
      "google_calendar_connections_identity_shape",
      sql`(
        NULLIF(btrim(${t.googleSubject}), '') IS NOT NULL
        AND char_length(${t.googleSubject}) <= 255
        AND ${t.googleAccountEmail} = lower(btrim(${t.googleAccountEmail}))
        AND ${t.googleAccountEmail} ~ '^[^[:space:]@]+@[^[:space:]@]+$'
        AND char_length(${t.googleAccountEmail}) <= 320
        AND ${t.accountVersion} > 0
        AND cardinality(${t.grantedScopes}) > 0
        AND array_position(${t.grantedScopes}, NULL) IS NULL
      ) IS TRUE`,
    ),
    tokenShape: check(
      "google_calendar_connections_token_shape",
      sql`(
        (
          (
            ${t.accessTokenCiphertext} IS NULL
            AND ${t.accessTokenIv} IS NULL
            AND ${t.accessTokenAuthTag} IS NULL
            AND ${t.accessTokenKeyVersion} IS NULL
            AND ${t.accessTokenExpiresAt} IS NULL
          )
          OR (
            ${t.accessTokenCiphertext} ~ '^[A-Za-z0-9_-]+$'
            AND char_length(${t.accessTokenCiphertext}) <= 8192
            AND ${t.accessTokenIv} ~ '^[A-Za-z0-9_-]{16}$'
            AND ${t.accessTokenAuthTag} ~ '^[A-Za-z0-9_-]{22}$'
            AND ${t.accessTokenKeyVersion} > 0
            AND ${t.accessTokenExpiresAt} > ${t.createdAt}
          )
        )
        AND (
          (
            ${t.refreshTokenCiphertext} IS NULL
            AND ${t.refreshTokenIv} IS NULL
            AND ${t.refreshTokenAuthTag} IS NULL
            AND ${t.refreshTokenKeyVersion} IS NULL
            AND ${t.refreshTokenUpdatedAt} IS NULL
          )
          OR (
            ${t.refreshTokenCiphertext} ~ '^[A-Za-z0-9_-]+$'
            AND char_length(${t.refreshTokenCiphertext}) <= 8192
            AND ${t.refreshTokenIv} ~ '^[A-Za-z0-9_-]{16}$'
            AND ${t.refreshTokenAuthTag} ~ '^[A-Za-z0-9_-]{22}$'
            AND ${t.refreshTokenKeyVersion} > 0
            AND ${t.refreshTokenUpdatedAt} >= ${t.createdAt}
          )
        )
        AND (
          ${t.status} NOT IN ('needs_selection', 'connected')
          OR (
            ${t.accessTokenCiphertext} IS NOT NULL
            AND ${t.refreshTokenCiphertext} IS NOT NULL
          )
        )
        AND (
          ${t.status} <> 'disconnected'
          OR (
            ${t.accessTokenCiphertext} IS NULL
            AND ${t.refreshTokenCiphertext} IS NULL
          )
        )
      ) IS TRUE`,
    ),
    stateShape: check(
      "google_calendar_connections_state_shape",
      sql`(
        (
          ${t.status} = 'reconnect_required'
          AND ${t.reconnectRequiredAt} IS NOT NULL
          AND ${t.disconnectedAt} IS NULL
        )
        OR (
          ${t.status} = 'disconnected'
          AND ${t.reconnectRequiredAt} IS NULL
          AND ${t.disconnectedAt} IS NOT NULL
        )
        OR (
          ${t.status} IN ('needs_selection', 'connected')
          AND ${t.reconnectRequiredAt} IS NULL
          AND ${t.disconnectedAt} IS NULL
        )
      ) IS TRUE`,
    ),
    timestampShape: check(
      "google_calendar_connections_timestamp_shape",
      sql`(
        ${t.lastAuthorizedAt} >= ${t.createdAt}
        AND ${t.updatedAt} >= ${t.createdAt}
        AND (${t.reconnectRequiredAt} IS NULL OR ${t.reconnectRequiredAt} >= ${t.createdAt})
        AND (${t.disconnectedAt} IS NULL OR ${t.disconnectedAt} >= ${t.createdAt})
        AND (
          ${t.lastSuccessfulAvailabilitySyncAt} IS NULL
          OR ${t.lastSuccessfulAvailabilitySyncAt} >= ${t.createdAt}
        )
        AND (
          ${t.lastSuccessfulEventSyncAt} IS NULL
          OR ${t.lastSuccessfulEventSyncAt} >= ${t.createdAt}
        )
      ) IS TRUE`,
    ),
    safeErrorShape: check(
      "google_calendar_connections_safe_error_shape",
      sql`${t.lastErrorCode} IS NULL OR ${t.lastErrorCode} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
  }),
);
export type GoogleCalendarConnection = typeof googleCalendarConnections.$inferSelect;
export type NewGoogleCalendarConnection = typeof googleCalendarConnections.$inferInsert;

// One stable Google event per purchased allowance-use lineage and Google
// account version. The destination envelope is snapshotted because disconnect
// and account switch remove current selections. Its original selection ID is
// retained because that ID is part of the encryption AAD.
export const bookingCalendarLinks = pgTable(
  "booking_calendar_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerId: uuid("producer_id").notNull(),
    allowanceUseId: uuid("allowance_use_id").notNull(),
    originBookingId: uuid("origin_booking_id").notNull(),
    currentBookingId: uuid("current_booking_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    accountVersion: integer("account_version").notNull(),
    destinationSelectionId: uuid("destination_selection_id").notNull(),
    destinationCalendarIdCiphertext: text("destination_calendar_id_ciphertext").notNull(),
    destinationCalendarIdIv: text("destination_calendar_id_iv").notNull(),
    destinationCalendarIdAuthTag: text("destination_calendar_id_auth_tag").notNull(),
    destinationCalendarIdKeyVersion: integer("destination_calendar_id_key_version").notNull(),
    destinationCalendarIdFingerprint: text("destination_calendar_id_fingerprint").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    providerEventEtag: text("provider_event_etag"),
    providerEventUpdatedAt: timestamp("provider_event_updated_at", { withTimezone: true }),
    providerState: bookingCalendarLinkProviderState("provider_state")
      .notNull()
      .default("uncreated"),
    syncState: bookingCalendarLinkSyncState("sync_state").notNull().default("pending"),
    syncStateChangedAt: timestamp("sync_state_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastInboundReconciledAt: timestamp("last_inbound_reconciled_at", { withTimezone: true }),
    lastSyncErrorCode: googleCalendarSyncErrorCode("last_sync_error_code"),
    desiredRevision: integer("desired_revision").notNull(),
    lastGoogleRevision: integer("last_google_revision").notNull().default(0),
    lastGoogleSyncedAt: timestamp("last_google_synced_at", { withTimezone: true }),
    invitationRevision: integer("invitation_revision").notNull().default(0),
    invitationChannel: calendarSyncDeliveryChannel("invitation_channel"),
    invitationReservedAt: timestamp("invitation_reserved_at", { withTimezone: true }),
    invitationAttemptedAt: timestamp("invitation_attempted_at", { withTimezone: true }),
    invitationDeliveredAt: timestamp("invitation_delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idProducerUnique: unique("booking_calendar_links_id_producer_unique").on(t.id, t.producerId),
    lineageAccountUnique: unique("booking_calendar_links_lineage_account_unique").on(
      t.producerId,
      t.allowanceUseId,
      t.connectionId,
      t.accountVersion,
    ),
    providerEventUnique: unique("booking_calendar_links_provider_event_unique").on(
      t.connectionId,
      t.providerEventId,
    ),
    originBookingLineageFk: foreignKey({
      columns: [t.originBookingId, t.producerId, t.allowanceUseId],
      foreignColumns: [bookings.id, bookings.producerId, bookings.allowanceUseId],
      name: "booking_calendar_links_origin_booking_lineage_fk",
    }).onDelete("restrict"),
    currentBookingLineageFk: foreignKey({
      columns: [t.currentBookingId, t.producerId, t.allowanceUseId],
      foreignColumns: [bookings.id, bookings.producerId, bookings.allowanceUseId],
      name: "booking_calendar_links_current_booking_lineage_fk",
    }).onDelete("restrict"),
    connectionProducerFk: foreignKey({
      columns: [t.connectionId, t.producerId],
      foreignColumns: [googleCalendarConnections.id, googleCalendarConnections.producerId],
      name: "booking_calendar_links_connection_producer_fk",
    }).onDelete("restrict"),
    currentBookingIdx: index("booking_calendar_links_current_booking_idx").on(
      t.producerId,
      t.currentBookingId,
      t.id,
    ),
    reconciliationIdx: index("booking_calendar_links_reconciliation_idx").on(
      t.connectionId,
      t.accountVersion,
      t.providerState,
      t.syncState,
      t.lastInboundReconciledAt,
      t.desiredRevision,
      t.id,
    ),
    encryptedDestinationShape: check(
      "booking_calendar_links_encrypted_destination_shape",
      sql`(
        ${t.destinationCalendarIdCiphertext} ~ '^[A-Za-z0-9_-]+$'
        AND char_length(${t.destinationCalendarIdCiphertext}) <= 8192
        AND ${t.destinationCalendarIdIv} ~ '^[A-Za-z0-9_-]{16}$'
        AND ${t.destinationCalendarIdAuthTag} ~ '^[A-Za-z0-9_-]{22}$'
        AND ${t.destinationCalendarIdKeyVersion} > 0
        AND ${t.destinationCalendarIdFingerprint} ~ '^hmac-sha256:[0-9a-f]{64}$'
      ) IS TRUE`,
    ),
    identityShape: check(
      "booking_calendar_links_identity_shape",
      sql`(
        ${t.accountVersion} > 0
        AND ${t.providerEventId} ~ '^[0-9a-v]+$'
        AND char_length(${t.providerEventId}) BETWEEN 5 AND 1024
        AND ${t.desiredRevision} > 0
      ) IS TRUE`,
    ),
    providerStateShape: check(
      "booking_calendar_links_provider_state_shape",
      sql`(
        (
          ${t.providerState} = 'uncreated'
          AND ${t.providerEventEtag} IS NULL
          AND ${t.lastGoogleRevision} = 0
          AND ${t.lastGoogleSyncedAt} IS NULL
        )
        OR (
          ${t.providerState} = 'active'
          AND NULLIF(btrim(${t.providerEventEtag}), '') IS NOT NULL
          AND char_length(${t.providerEventEtag}) <= 2048
          AND ${t.lastGoogleRevision} > 0
          AND ${t.lastGoogleSyncedAt} IS NOT NULL
        )
        OR (
          ${t.providerState} = 'deleted'
          AND ${t.providerEventEtag} IS NULL
          AND ${t.lastGoogleRevision} > 0
          AND ${t.lastGoogleSyncedAt} IS NOT NULL
        )
      ) IS TRUE`,
    ),
    revisionShape: check(
      "booking_calendar_links_revision_shape",
      sql`(
        ${t.lastGoogleRevision} >= 0
        AND ${t.invitationRevision} >= 0
        AND ${t.desiredRevision} >= ${t.lastGoogleRevision}
        AND ${t.desiredRevision} >= ${t.invitationRevision}
      ) IS TRUE`,
    ),
    syncStateShape: check(
      "booking_calendar_links_sync_state_shape",
      sql`(
        (
          ${t.syncState} IN ('pending', 'synced', 'missing', 'disconnected')
          AND ${t.lastSyncErrorCode} IS NULL
        )
        OR (
          ${t.syncState} = 'conflict'
          AND ${t.lastSyncErrorCode} IN ('stale_skitza_revision', 'skitza_overlap')
        )
        OR (
          ${t.syncState} = 'not_synced'
          AND ${t.lastSyncErrorCode} IS NOT NULL
          AND ${t.lastSyncErrorCode} NOT IN ('stale_skitza_revision', 'skitza_overlap')
        )
      ) IS TRUE`,
    ),
    invitationShape: check(
      "booking_calendar_links_invitation_shape",
      sql`(
        (
          ${t.invitationRevision} = 0
          AND ${t.invitationChannel} IS NULL
          AND ${t.invitationReservedAt} IS NULL
          AND ${t.invitationAttemptedAt} IS NULL
          AND ${t.invitationDeliveredAt} IS NULL
        )
        OR (
          ${t.invitationRevision} > 0
          AND ${t.invitationChannel} IS NOT NULL
          AND ${t.invitationReservedAt} IS NOT NULL
          AND (
            ${t.invitationAttemptedAt} IS NULL
            OR ${t.invitationAttemptedAt} >= ${t.invitationReservedAt}
          )
          AND (
            ${t.invitationDeliveredAt} IS NULL
            OR (
              ${t.invitationDeliveredAt} >= ${t.invitationReservedAt}
              AND (
                ${t.invitationAttemptedAt} IS NULL
                OR ${t.invitationDeliveredAt} >= ${t.invitationAttemptedAt}
              )
              AND (
                ${t.invitationChannel} <> 'google'
                OR ${t.invitationAttemptedAt} IS NOT NULL
              )
            )
          )
        )
      ) IS TRUE`,
    ),
    timestampShape: check(
      "booking_calendar_links_timestamp_shape",
      sql`(
        ${t.updatedAt} >= ${t.createdAt}
        AND ${t.syncStateChangedAt} >= ${t.createdAt}
        AND (
          ${t.lastInboundReconciledAt} IS NULL
          OR ${t.lastInboundReconciledAt} >= ${t.createdAt}
        )
        AND (${t.lastGoogleSyncedAt} IS NULL OR ${t.lastGoogleSyncedAt} >= ${t.createdAt})
        AND (${t.invitationReservedAt} IS NULL OR ${t.invitationReservedAt} >= ${t.createdAt})
        AND (${t.invitationAttemptedAt} IS NULL OR ${t.invitationAttemptedAt} >= ${t.createdAt})
        AND (${t.invitationDeliveredAt} IS NULL OR ${t.invitationDeliveredAt} >= ${t.createdAt})
      ) IS TRUE`,
    ),
  }),
);
export type BookingCalendarLink = typeof bookingCalendarLinks.$inferSelect;
export type NewBookingCalendarLink = typeof bookingCalendarLinks.$inferInsert;

// One provider push channel per row. A renewing successor overlaps the old
// active row until provider creation succeeds, then activation and retirement
// happen atomically. Only digests of high-entropy channel tokens are stored.
export const googleCalendarWatches = pgTable(
  "google_calendar_watches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerId: uuid("producer_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    accountVersion: integer("account_version").notNull(),
    destinationSelectionId: uuid("destination_selection_id").notNull(),
    destinationCalendarIdCiphertext: text("destination_calendar_id_ciphertext").notNull(),
    destinationCalendarIdIv: text("destination_calendar_id_iv").notNull(),
    destinationCalendarIdAuthTag: text("destination_calendar_id_auth_tag").notNull(),
    destinationCalendarIdKeyVersion: integer("destination_calendar_id_key_version").notNull(),
    destinationCalendarIdFingerprint: text("destination_calendar_id_fingerprint").notNull(),
    renewalOfWatchId: uuid("renewal_of_watch_id"),
    providerChannelId: uuid("provider_channel_id").notNull(),
    providerResourceId: text("provider_resource_id"),
    channelTokenDigest: text("channel_token_digest").notNull(),
    state: googleCalendarWatchState("state").notNull().default("renewing"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastMessageNumber: text("last_message_number").notNull().default("0"),
    lastNotificationAt: timestamp("last_notification_at", { withTimezone: true }),
    lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    lastErrorCode: googleCalendarSyncErrorCode("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idProducerUnique: unique("google_calendar_watches_id_producer_unique").on(t.id, t.producerId),
    channelUnique: unique("google_calendar_watches_channel_unique").on(t.providerChannelId),
    connectionProducerFk: foreignKey({
      columns: [t.connectionId, t.producerId],
      foreignColumns: [googleCalendarConnections.id, googleCalendarConnections.producerId],
      name: "google_calendar_watches_connection_producer_fk",
    }).onDelete("restrict"),
    renewalProducerFk: foreignKey({
      columns: [t.renewalOfWatchId, t.producerId],
      foreignColumns: [t.id, t.producerId],
      name: "google_calendar_watches_renewal_producer_fk",
    }).onDelete("restrict"),
    oneActive: uniqueIndex("google_calendar_watches_one_active")
      .on(t.connectionId, t.accountVersion, t.destinationCalendarIdFingerprint)
      .where(sql`${t.state} = 'active'`),
    oneRenewing: uniqueIndex("google_calendar_watches_one_renewing")
      .on(t.connectionId, t.accountVersion, t.destinationCalendarIdFingerprint)
      .where(sql`${t.state} = 'renewing'`),
    renewalDueIdx: index("google_calendar_watches_renewal_due_idx").on(t.state, t.expiresAt, t.id),
    webhookLookupIdx: index("google_calendar_watches_webhook_lookup_idx").on(
      t.providerChannelId,
      t.state,
    ),
    encryptedDestinationShape: check(
      "google_calendar_watches_encrypted_destination_shape",
      sql`(
        ${t.destinationCalendarIdCiphertext} ~ '^[A-Za-z0-9_-]+$'
        AND char_length(${t.destinationCalendarIdCiphertext}) <= 8192
        AND ${t.destinationCalendarIdIv} ~ '^[A-Za-z0-9_-]{16}$'
        AND ${t.destinationCalendarIdAuthTag} ~ '^[A-Za-z0-9_-]{22}$'
        AND ${t.destinationCalendarIdKeyVersion} > 0
        AND ${t.destinationCalendarIdFingerprint} ~ '^hmac-sha256:[0-9a-f]{64}$'
      ) IS TRUE`,
    ),
    trustShape: check(
      "google_calendar_watches_trust_shape",
      sql`(
        ${t.accountVersion} > 0
        AND ${t.channelTokenDigest} ~ '^sha256:[0-9a-f]{64}$'
        AND (
          ${t.providerResourceId} IS NULL
          OR (
            NULLIF(btrim(${t.providerResourceId}), '') IS NOT NULL
            AND ${t.providerResourceId} !~ '[[:space:]]'
            AND char_length(${t.providerResourceId}) <= 2048
          )
        )
        AND ${t.lastMessageNumber} ~ '^(0|[1-9][0-9]{0,38})$'
      ) IS TRUE`,
    ),
    stateShape: check(
      "google_calendar_watches_state_shape",
      sql`(
        (
          ${t.state} = 'renewing'
          AND ${t.activatedAt} IS NULL
          AND ${t.endedAt} IS NULL
          AND ${t.lastErrorCode} IS NULL
          AND (
            (${t.providerResourceId} IS NULL AND ${t.expiresAt} IS NULL)
            OR (${t.providerResourceId} IS NOT NULL AND ${t.expiresAt} IS NOT NULL)
          )
        )
        OR (
          ${t.state} = 'active'
          AND ${t.providerResourceId} IS NOT NULL
          AND ${t.expiresAt} IS NOT NULL
          AND ${t.activatedAt} IS NOT NULL
          AND ${t.endedAt} IS NULL
          AND ${t.lastErrorCode} IS NULL
        )
        OR (
          ${t.state} IN ('retired', 'expired')
          AND ${t.endedAt} IS NOT NULL
        )
      ) IS TRUE`,
    ),
    messageShape: check(
      "google_calendar_watches_message_shape",
      sql`(
        (${t.lastMessageNumber} = '0' AND ${t.lastNotificationAt} IS NULL)
        OR (${t.lastMessageNumber} <> '0' AND ${t.lastNotificationAt} IS NOT NULL)
      ) IS TRUE`,
    ),
    timestampShape: check(
      "google_calendar_watches_timestamp_shape",
      sql`(
        ${t.updatedAt} >= ${t.createdAt}
        AND (${t.expiresAt} IS NULL OR ${t.expiresAt} > ${t.createdAt})
        AND (${t.activatedAt} IS NULL OR ${t.activatedAt} >= ${t.createdAt})
        AND (${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.createdAt})
        AND (${t.endedAt} IS NULL OR ${t.activatedAt} IS NULL OR ${t.endedAt} >= ${t.activatedAt})
        AND (
          ${t.lastNotificationAt} IS NULL
          OR ${t.lastNotificationAt} >= ${t.createdAt}
        )
        AND (${t.lastReconciledAt} IS NULL OR ${t.lastReconciledAt} >= ${t.createdAt})
      ) IS TRUE`,
    ),
  }),
);
export type GoogleCalendarWatch = typeof googleCalendarWatches.$inferSelect;
export type NewGoogleCalendarWatch = typeof googleCalendarWatches.$inferInsert;

// Complete CalendarList candidates for the current Google account version.
// Provider IDs are encrypted for recovery and separately HMAC-fingerprinted
// for equality and uniqueness without placing a raw calendar ID in an index.
export const googleCalendarSelections = pgTable(
  "google_calendar_selections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    accountVersion: integer("account_version").notNull(),
    providerCalendarIdCiphertext: text("provider_calendar_id_ciphertext").notNull(),
    providerCalendarIdIv: text("provider_calendar_id_iv").notNull(),
    providerCalendarIdAuthTag: text("provider_calendar_id_auth_tag").notNull(),
    providerCalendarIdKeyVersion: integer("provider_calendar_id_key_version").notNull(),
    providerCalendarIdFingerprint: text("provider_calendar_id_fingerprint").notNull(),
    displayName: text("display_name").notNull(),
    timezone: text("timezone"),
    accessRole: googleCalendarAccessRole("access_role").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    isDestination: boolean("is_destination").notNull().default(false),
    blocksAvailability: boolean("blocks_availability").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    connectionProducerAccountFk: foreignKey({
      columns: [t.connectionId, t.producerId, t.accountVersion],
      foreignColumns: [
        googleCalendarConnections.id,
        googleCalendarConnections.producerId,
        googleCalendarConnections.accountVersion,
      ],
      name: "google_calendar_selections_connection_producer_account_fk",
    }).onDelete("cascade"),
    calendarFingerprintUnique: unique("google_calendar_selections_calendar_fingerprint_unique").on(
      t.connectionId,
      t.accountVersion,
      t.providerCalendarIdFingerprint,
    ),
    oneDestination: uniqueIndex("google_calendar_selections_one_destination")
      .on(t.connectionId, t.accountVersion)
      .where(sql`${t.isDestination} = true`),
    onePrimary: uniqueIndex("google_calendar_selections_one_primary")
      .on(t.connectionId, t.accountVersion)
      .where(sql`${t.isPrimary} = true`),
    producerBusyIdx: index("google_calendar_selections_producer_busy_idx")
      .on(t.producerId, t.connectionId, t.accountVersion, t.id)
      .where(sql`${t.blocksAvailability} = true`),
    encryptedIdShape: check(
      "google_calendar_selections_encrypted_id_shape",
      sql`(
        ${t.providerCalendarIdCiphertext} ~ '^[A-Za-z0-9_-]+$'
        AND char_length(${t.providerCalendarIdCiphertext}) <= 8192
        AND ${t.providerCalendarIdIv} ~ '^[A-Za-z0-9_-]{16}$'
        AND ${t.providerCalendarIdAuthTag} ~ '^[A-Za-z0-9_-]{22}$'
        AND ${t.providerCalendarIdKeyVersion} > 0
        AND ${t.providerCalendarIdFingerprint} ~ '^hmac-sha256:[0-9a-f]{64}$'
      ) IS TRUE`,
    ),
    metadataShape: check(
      "google_calendar_selections_metadata_shape",
      sql`(
        ${t.accountVersion} > 0
        AND NULLIF(btrim(${t.displayName}), '') IS NOT NULL
        AND char_length(${t.displayName}) <= 1024
        AND (
          ${t.timezone} IS NULL
          OR (
            NULLIF(btrim(${t.timezone}), '') IS NOT NULL
            AND char_length(${t.timezone}) <= 255
          )
        )
      ) IS TRUE`,
    ),
    destinationAccessShape: check(
      "google_calendar_selections_destination_access_shape",
      sql`${t.isDestination} = false OR ${t.accessRole} IN ('writer', 'owner')`,
    ),
    timestampShape: check(
      "google_calendar_selections_timestamp_shape",
      sql`${t.updatedAt} >= ${t.createdAt}`,
    ),
  }),
);
export type GoogleCalendarSelection = typeof googleCalendarSelections.$inferSelect;
export type NewGoogleCalendarSelection = typeof googleCalendarSelections.$inferInsert;

// Replay protection for the signed OAuth state token. The signed token and
// deterministic, domain-separated PKCE verifier are never stored: only the
// token digest and the producer/account concurrency expectations are durable.
export const googleCalendarOAuthStates = pgTable(
  "google_calendar_oauth_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stateTokenDigest: text("state_token_digest").notNull(),
    producerId: uuid("producer_id").notNull(),
    intent: googleCalendarOAuthIntent("intent").notNull(),
    connectionId: uuid("connection_id"),
    expectedAccountVersion: integer("expected_account_version"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    producerFk: foreignKey({
      columns: [t.producerId],
      foreignColumns: [producers.id],
      name: "google_calendar_oauth_states_producer_fk",
    }).onDelete("cascade"),
    stateDigestUnique: unique("google_calendar_oauth_states_state_digest_unique").on(
      t.stateTokenDigest,
    ),
    connectionProducerFk: foreignKey({
      columns: [t.connectionId, t.producerId],
      foreignColumns: [googleCalendarConnections.id, googleCalendarConnections.producerId],
      name: "google_calendar_oauth_states_connection_producer_fk",
    }).onDelete("cascade"),
    expiresIdx: index("google_calendar_oauth_states_expires_idx").on(t.expiresAt, t.id),
    digestShape: check(
      "google_calendar_oauth_states_digest_shape",
      sql`${t.stateTokenDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    intentShape: check(
      "google_calendar_oauth_states_intent_shape",
      sql`(
        (
          ${t.intent} = 'connect'
          AND ${t.connectionId} IS NULL
          AND ${t.expectedAccountVersion} IS NULL
        )
        OR (
          ${t.intent} IN ('reconnect', 'switch_account')
          AND ${t.connectionId} IS NOT NULL
          AND ${t.expectedAccountVersion} > 0
        )
      ) IS TRUE`,
    ),
    lifetimeShape: check(
      "google_calendar_oauth_states_lifetime_shape",
      sql`(
        ${t.expiresAt} > ${t.createdAt}
        AND ${t.expiresAt} <= ${t.createdAt} + interval '15 minutes'
        AND (
          ${t.consumedAt} IS NULL
          OR (
            ${t.consumedAt} >= ${t.createdAt}
            AND ${t.consumedAt} <= ${t.expiresAt}
          )
        )
      ) IS TRUE`,
    ),
  }),
);
export type GoogleCalendarOAuthState = typeof googleCalendarOAuthStates.$inferSelect;
export type NewGoogleCalendarOAuthState = typeof googleCalendarOAuthStates.$inferInsert;

// ─── Projects (stable client-owned workspaces) ─────────────────────
// A project is the durable container for one producer/client relationship.
// It may own many purchases, while each purchase owns its own commercial,
// song, version, session, and payment history.
export const projectLifecycleStatus = pgEnum("project_lifecycle_status", [
  "waiting_for_payment",
  "active",
  "paused",
  "completed",
  "canceled",
]);

// New workflow enum introduced by the Clients & Projects v3 redesign
// (design doc: docs/plans/active/2026-05-14-clients-projects-redesign-design.md).
// Drives the per-song stepper + the new Status stat tile on the Album hero.
// Creative progress is independent from the commercial project lifecycle.
export const workflowStage = pgEnum("workflow_stage", [
  "brief",
  "production",
  "mixing",
  "mastering",
  "done",
]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "restrict" }),
    clientContactId: uuid("client_contact_id").notNull(),
    title: text("title").notNull(),
    lifecycleStatus: projectLifecycleStatus("lifecycle_status")
      .notNull()
      .default("waiting_for_payment"),
    lifecycleChangedAt: timestamp("lifecycle_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Client identity snapshot — duplicated onto the project so the feed
    // still renders a sensible row after a booking row is purged.
    clientName: text("client_name"),
    clientEmail: text("client_email"),
    // Legacy artistName/artistEmail kept for now — the share-page render
    // path still reads them and we avoid churning that here.
    artistName: text("artist_name").notNull(),
    artistEmail: text("artist_email").notNull(),
    // Project-room invite token. Minted at create time; embedded in the
    // share URL the producer copies (`/join/[slug]?invite=<token>`).
    // Unique so a guess collision can't land an artist in someone
    // else's room. Nullable so legacy rows pre-migration stay valid.
    inviteToken: text("invite_token").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Stamped once by the Autopilot cron's request-testimonial sweep
    // the first time it emails the artist asking for a testimonial on
    // this project. Null = never asked. Ensures idempotency — no double
    // asks on subsequent ticks. Migration 0033 (audit Task 12).
    testimonialRequestedAt: timestamp("testimonial_requested_at", {
      withTimezone: true,
    }),
    // Producer-only private notes for this project. Free-text, nullable
    // (a project with no notes is the default). Surface: Project Room →
    // Notes tab; producer types and we autosave debounced. Capped at 5000
    // chars at the procedure layer; the column itself is `text` so we can
    // raise the cap later without a migration.
    notes: text("notes"),
    // Drag-to-reorder slot for the Projects list. Same pattern as
    // client_contacts.position.
    position: integer("position").notNull().default(0),
    // Creative workflow stage for the new redesign hero + Status stat
    // tile. Decoupled from the legacy `stage` (lifecycle) column — both
    // co-exist; the new UI only ever shows this one.
    workflowStage: workflowStage("workflow_stage").notNull().default("brief"),
    // Optional deliverable due-date the producer commits to. Drives the
    // hero countdown + the Calendar's "deadline" markers. Null = no
    // explicit deadline.
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
  },
  (t) => ({
    idProducerUnique: unique("projects_id_producer_unique").on(t.id, t.producerId),
    idOwnerUnique: unique("projects_id_owner_unique").on(t.id, t.producerId, t.clientContactId),
    clientProducerFk: foreignKey({
      columns: [t.clientContactId, t.producerId],
      foreignColumns: [clientContacts.id, clientContacts.producerId],
      name: "projects_client_producer_fk",
    }).onDelete("restrict"),
    producerLifecycleIdx: index("projects_producer_lifecycle_idx").on(
      t.producerId,
      t.lifecycleStatus,
      t.createdAt,
    ),
    adminClientActivityIdx: index("projects_admin_client_activity_idx").on(
      t.clientContactId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  }),
);
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

// One named track within a project. `artist` is optional credit line
// (e.g. "feat. Someone"). Position orders tracks on the share page.
export const projectTracks = pgTable(
  "project_tracks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references((): AnyPgColumn => purchases.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    artist: text("artist"),
    position: integer("position").notNull().default(0),
    workflowStage: workflowStage("workflow_stage").notNull().default("brief"),
    // Optional, private per-song cover identity. The browser only receives a
    // same-origin authenticated route; raw R2 keys and object metadata stay on
    // the server. All four fields transition together (migration 0037).
    artworkR2Key: text("artwork_r2_key"),
    artworkContentType: text("artwork_content_type"),
    artworkSizeBytes: bigint("artwork_size_bytes", { mode: "number" }),
    artworkObjectEtag: text("artwork_object_etag"),
    // Release is a producer-confirmed product state, separate from creative
    // progress (Done / Delivered). Once set, application code treats it as
    // irreversible because protected audio may be permanently deleted.
    releasedAt: timestamp("released_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    portfolioPublishedAt: timestamp("portfolio_published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idPurchaseUnique: unique("project_tracks_id_purchase_unique").on(t.id, t.purchaseId),
    idProjectUnique: unique("project_tracks_id_project_unique").on(t.id, t.projectId),
    purchaseProjectFk: foreignKey({
      columns: [t.purchaseId, t.projectId],
      foreignColumns: [purchases.id, purchases.projectId],
      name: "project_tracks_purchase_project_fk",
    }).onDelete("restrict"),
    purchasePositionIdx: index("project_tracks_purchase_position_idx").on(t.purchaseId, t.position),
    projectPortfolioPublishedIdx: index("project_tracks_project_portfolio_published_idx")
      .on(t.projectId, t.portfolioPublishedAt.desc(), t.id)
      .where(sql`${t.portfolioPublishedAt} IS NOT NULL`),
    artworkIdentityShape: check(
      "project_tracks_artwork_identity_shape",
      sql`(
        (
          ${t.artworkR2Key} IS NULL
          AND ${t.artworkContentType} IS NULL
          AND ${t.artworkSizeBytes} IS NULL
          AND ${t.artworkObjectEtag} IS NULL
        )
        OR
        (
          NULLIF(btrim(${t.artworkR2Key}), '') IS NOT NULL
          AND char_length(${t.artworkR2Key}) <= 1024
          AND ${t.artworkContentType} IN ('image/jpeg', 'image/png', 'image/webp')
          AND ${t.artworkSizeBytes} > 0
          AND ${t.artworkSizeBytes} <= 5242880
          AND NULLIF(btrim(${t.artworkObjectEtag}), '') IS NOT NULL
          AND char_length(${t.artworkObjectEtag}) <= 512
        )
      ) IS TRUE`,
    ),
  }),
);
export type ProjectTrack = typeof projectTracks.$inferSelect;
export type NewProjectTrack = typeof projectTracks.$inferInsert;

// Versions stacked under a track. Producers upload V1 → V2 → master.
// The UI sorts by `uploadedAt` desc so the latest is top-of-stack,
// matching Samply's "latest on top" convention. Label is free-text
// (e.g. "Rough Mix", "Mix v2", "Master", "Instrumental").
export const trackVersions = pgTable(
  "track_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => projectTracks.id, { onDelete: "restrict" }),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references((): AnyPgColumn => purchases.id, { onDelete: "restrict" }),
    producerId: uuid("producer_id").notNull(),
    label: text("label").notNull(),
    audioUrl: text("audio_url"),
    durationMs: integer("duration_ms"),
    audioR2Key: text("audio_r2_key"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    // R2's exact completed-object identity plus a server-derived SHA-256
    // fingerprint. All five audio-identity fields stay null on a placeholder,
    // then complete together exactly once. Migration 0027 enforces the
    // one-way transition and freezes completed identity before any approval.
    audioObjectEtag: text("audio_object_etag"),
    audioIdentityFingerprint: text("audio_identity_fingerprint"),
    // Durable multipart journal. A placeholder may carry this complete tuple
    // while an R2 upload is in flight. Successful completion clears it in the
    // same database write that installs the immutable live-object identity.
    pendingAudioR2Key: text("pending_audio_r2_key"),
    // Exact R2 multipart handle needed to resume an abort after a server crash.
    pendingAudioUploadId: text("pending_audio_upload_id"),
    // Stable hash of filename/content-type/size. A retry can resume only the
    // same initiation request even before R2 returns its upload id.
    pendingAudioInitiationDigest: text("pending_audio_initiation_digest"),
    pendingAudioCompletionToken: text("pending_audio_completion_token"),
    pendingAudioSizeBytes: bigint("pending_audio_size_bytes", { mode: "number" }),
    pendingAudioStartedAt: timestamp("pending_audio_started_at", { withTimezone: true }),
    // Persisted before CreateMultipartUpload so a crash cannot immediately
    // create a second upload or clear an upload whose remote result is late.
    pendingAudioCreateAttemptedAt: timestamp("pending_audio_create_attempted_at", {
      withTimezone: true,
    }),
    // Persisted and committed before the sole CompleteMultipartUpload call.
    // A retry with this marker may observe/reconcile, but may never replay it.
    pendingAudioCompleteAttemptedAt: timestamp("pending_audio_complete_attempted_at", {
      withTimezone: true,
    }),
    // New CompleteMultipart capabilities are conditional writes. Equality to
    // complete-attempted-at proves the protection marker committed in the same
    // CAS; legacy attempted rows deliberately retain NULL and stay fail-closed.
    pendingAudioCompleteWriteOnceProtectedAt: timestamp(
      "pending_audio_complete_write_once_protected_at",
      { withTimezone: true },
    ),
    // Latest expiry of any server-issued UploadPart capability. It is evidence
    // that cancellation must retain the exact recovery journal; expiry alone
    // cannot prove an already-started request has finished.
    pendingAudioPartUrlsExpireAt: timestamp("pending_audio_part_urls_expire_at", {
      withTimezone: true,
    }),
    // Durable cancel intent. It is written before AbortMultipartUpload and
    // makes completion retries reconcile cancellation instead of replaying.
    pendingAudioCancelRequestedAt: timestamp("pending_audio_cancel_requested_at", {
      withTimezone: true,
    }),
    // Durable cleanup intent for an exact completed object. It is written only
    // after authoritative key/token/size/ETag verification and before deletion,
    // so a retry can safely finish clearing a consumed multipart upload.
    pendingAudioCleanupEtag: text("pending_audio_cleanup_etag"),
    peaksR2Key: text("peaks_r2_key"),
    // Pre-computed waveform peaks — 200 normalized RMS bars [0..1].
    // Populated by audio.completeMultipart once the multipart upload
    // finalises; nullable so legacy rows + decoder-misses keep working
    // (the L3 song page degrades to the existing client-side decode
    // path when this is null). Migration 0017.
    peaks: jsonb("peaks").$type<number[]>(),
    // Phase 4 Upload Track modal — optional notes the producer types when
    // uploading a new version (DESIGN.md §6.4). Nullable; surfaces on the
    // artist-facing version page.
    description: text("description"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    producerMarkedFinalAt: timestamp("producer_marked_final_at", { withTimezone: true }),
    // One-way tombstone for both failed placeholders and completed audio.
    audioDeletedAt: timestamp("audio_deleted_at", { withTimezone: true }),
    // Set only after the exact R2 object is confirmed absent. Keeping this
    // separate from the logical tombstone prevents quota from being released
    // during a partial storage-deletion failure.
    audioStorageDeletedAt: timestamp("audio_storage_deleted_at", { withTimezone: true }),
  },
  (t) => ({
    idPurchaseUnique: unique("track_versions_id_purchase_unique").on(t.id, t.purchaseId),
    idProducerUnique: unique("track_versions_id_producer_unique").on(t.id, t.producerId),
    exactScopeUnique: unique("track_versions_id_track_purchase_producer_unique").on(
      t.id,
      t.trackId,
      t.purchaseId,
      t.producerId,
    ),
    audioIdentityUnique: unique("track_versions_audio_identity_unique").on(
      t.id,
      t.purchaseId,
      t.audioIdentityFingerprint,
    ),
    pendingAudioR2KeyUnique: uniqueIndex("track_versions_pending_audio_r2_key_unique")
      .on(t.pendingAudioR2Key)
      .where(sql`${t.pendingAudioR2Key} IS NOT NULL`),
    trackPurchaseFk: foreignKey({
      columns: [t.trackId, t.purchaseId],
      foreignColumns: [projectTracks.id, projectTracks.purchaseId],
      name: "track_versions_track_purchase_fk",
    }).onDelete("restrict"),
    purchaseProducerFk: foreignKey({
      columns: [t.purchaseId, t.producerId],
      foreignColumns: [purchases.id, purchases.producerId],
      name: "track_versions_purchase_producer_fk",
    }).onDelete("restrict"),
    purchaseUploadedIdx: index("track_versions_purchase_uploaded_idx").on(
      t.purchaseId,
      t.uploadedAt,
    ),
    trackLiveUploadedIdx: index("track_versions_track_live_uploaded_idx")
      .on(t.trackId, t.uploadedAt.desc(), t.id.desc())
      .where(sql`${t.audioDeletedAt} IS NULL AND ${t.audioUrl} IS NOT NULL`),
    producerStoredAudioIdx: index("track_versions_producer_stored_audio_idx")
      .on(t.producerId)
      .where(sql`${t.sizeBytes} IS NOT NULL AND ${t.audioStorageDeletedAt} IS NULL`),
    producerPendingAudioIdx: index("track_versions_producer_pending_audio_idx")
      .on(t.producerId)
      .where(sql`${t.pendingAudioSizeBytes} IS NOT NULL`),
    audioIdentityShape: check(
      "track_versions_audio_identity_shape",
      sql`(
        (${t.audioUrl} IS NULL AND ${t.audioR2Key} IS NULL AND ${t.sizeBytes} IS NULL AND ${t.audioObjectEtag} IS NULL AND ${t.audioIdentityFingerprint} IS NULL)
        OR
        (
          ${t.audioUrl} IS NOT NULL
          AND ${t.audioR2Key} IS NOT NULL
          AND ${t.sizeBytes} > 0
          AND ${t.audioObjectEtag} <> ''
          AND ${t.pendingAudioR2Key} IS NULL
          AND ${t.pendingAudioUploadId} IS NULL
          AND ${t.pendingAudioInitiationDigest} IS NULL
          AND ${t.pendingAudioCompletionToken} IS NULL
          AND ${t.pendingAudioSizeBytes} IS NULL
          AND ${t.pendingAudioStartedAt} IS NULL
          AND ${t.pendingAudioCreateAttemptedAt} IS NULL
          AND ${t.pendingAudioCompleteAttemptedAt} IS NULL
          AND ${t.pendingAudioCompleteWriteOnceProtectedAt} IS NULL
          AND ${t.pendingAudioPartUrlsExpireAt} IS NULL
          AND ${t.pendingAudioCancelRequestedAt} IS NULL
          AND ${t.pendingAudioCleanupEtag} IS NULL
          AND ${t.audioIdentityFingerprint} = 'sha256:' || encode(sha256(convert_to(
            'skitza-track-audio-v1|'
            || octet_length(${t.audioR2Key})::text || ':' || ${t.audioR2Key}
            || '|' || octet_length(${t.audioObjectEtag})::text || ':' || ${t.audioObjectEtag}
            || '|' || octet_length(${t.sizeBytes}::text)::text || ':' || ${t.sizeBytes}::text,
            'UTF8'
          )), 'hex')
        )
      ) IS TRUE`,
    ),
    pendingAudioShape: check(
      "track_versions_pending_audio_shape",
      sql`(
        (
          ${t.pendingAudioR2Key} IS NULL
          AND ${t.pendingAudioUploadId} IS NULL
          AND ${t.pendingAudioInitiationDigest} IS NULL
          AND ${t.pendingAudioCompletionToken} IS NULL
          AND ${t.pendingAudioSizeBytes} IS NULL
          AND ${t.pendingAudioStartedAt} IS NULL
          AND ${t.pendingAudioCreateAttemptedAt} IS NULL
          AND ${t.pendingAudioCompleteAttemptedAt} IS NULL
          AND ${t.pendingAudioCompleteWriteOnceProtectedAt} IS NULL
          AND ${t.pendingAudioPartUrlsExpireAt} IS NULL
          AND ${t.pendingAudioCancelRequestedAt} IS NULL
          AND ${t.pendingAudioCleanupEtag} IS NULL
        )
        OR
        (
          NULLIF(btrim(${t.pendingAudioR2Key}), '') IS NOT NULL
          AND (${t.pendingAudioUploadId} IS NULL OR NULLIF(btrim(${t.pendingAudioUploadId}), '') IS NOT NULL)
          AND ${t.pendingAudioInitiationDigest} ~ '^sha256:[0-9a-f]{64}$'
          AND ${t.pendingAudioCompletionToken} ~ '^[0-9a-f]{64}$'
          AND ${t.pendingAudioSizeBytes} > 0
          AND ${t.pendingAudioStartedAt} IS NOT NULL
          AND (${t.pendingAudioCreateAttemptedAt} IS NULL OR ${t.pendingAudioCreateAttemptedAt} >= ${t.pendingAudioStartedAt})
          AND (${t.pendingAudioUploadId} IS NULL OR ${t.pendingAudioCreateAttemptedAt} IS NOT NULL)
          AND (${t.pendingAudioCompleteAttemptedAt} IS NULL OR (${t.pendingAudioUploadId} IS NOT NULL AND ${t.pendingAudioPartUrlsExpireAt} IS NOT NULL AND ${t.pendingAudioCompleteAttemptedAt} >= ${t.pendingAudioCreateAttemptedAt}))
          AND (${t.pendingAudioCompleteWriteOnceProtectedAt} IS NULL OR (${t.pendingAudioCompleteAttemptedAt} IS NOT NULL AND ${t.pendingAudioCompleteWriteOnceProtectedAt} = ${t.pendingAudioCompleteAttemptedAt}))
          AND (${t.pendingAudioPartUrlsExpireAt} IS NULL OR (${t.pendingAudioUploadId} IS NOT NULL AND ${t.pendingAudioPartUrlsExpireAt} >= ${t.pendingAudioCreateAttemptedAt}))
          AND (${t.pendingAudioCancelRequestedAt} IS NULL OR (${t.pendingAudioCancelRequestedAt} >= ${t.pendingAudioStartedAt} AND (${t.pendingAudioCompleteAttemptedAt} IS NULL OR ${t.pendingAudioCancelRequestedAt} >= ${t.pendingAudioCompleteAttemptedAt})))
          AND (${t.pendingAudioCleanupEtag} IS NULL OR (${t.pendingAudioCompleteAttemptedAt} IS NOT NULL AND NULLIF(btrim(${t.pendingAudioCleanupEtag}), '') IS NOT NULL))
          AND ((${t.pendingAudioCancelRequestedAt} IS NULL AND ${t.audioDeletedAt} IS NULL) OR (${t.pendingAudioCancelRequestedAt} IS NOT NULL AND ${t.audioDeletedAt} IS NOT NULL))
        )
      ) IS TRUE`,
    ),
    pendingAudioCompleteWriteOnceShape: check(
      "track_versions_pending_audio_complete_write_once_shape",
      sql`${t.pendingAudioCompleteWriteOnceProtectedAt} IS NULL OR (${t.pendingAudioCompleteAttemptedAt} IS NOT NULL AND ${t.pendingAudioCompleteWriteOnceProtectedAt} = ${t.pendingAudioCompleteAttemptedAt})`,
    ),
    audioStorageDeletedShape: check(
      "track_versions_audio_storage_deleted_shape",
      sql`${t.audioStorageDeletedAt} IS NULL OR (${t.audioDeletedAt} IS NOT NULL AND ${t.audioStorageDeletedAt} >= ${t.audioDeletedAt})`,
    ),
    protectedAudioUrl: check(
      "track_versions_protected_audio_url",
      sql`${t.audioUrl} IS NULL OR ${t.audioUrl} = '/api/audio/stream/' || ${t.id}::text`,
    ),
  }),
);
export type TrackVersion = typeof trackVersions.$inferSelect;
export type NewTrackVersion = typeof trackVersions.$inferInsert;

// Timestamped comments on a version. `timestampMs` is the ms offset
// into the track where the pin sits. Author is free-text (no Artist
// accounts). Producers can resolve comments from the producer UI —
// `resolvedAt` is the audit trail + the UI filter.
export const trackComments = pgTable(
  "track_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => trackVersions.id, { onDelete: "restrict" }),
    producerId: uuid("producer_id").notNull(),
    authorName: text("author_name").notNull(),
    authorEmail: text("author_email").notNull(),
    body: text("body").notNull(),
    timestampMs: integer("timestamp_ms").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    // Tracks which side posted — producer (internal) vs. artist
    // (from the share page). Lets the UI style them differently.
    fromProducer: boolean("from_producer").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idProducerUnique: unique("track_comments_id_producer_unique").on(t.id, t.producerId),
    versionProducerFk: foreignKey({
      columns: [t.versionId, t.producerId],
      foreignColumns: [trackVersions.id, trackVersions.producerId],
      name: "track_comments_version_producer_fk",
    }).onDelete("restrict"),
  }),
);
export type TrackComment = typeof trackComments.$inferSelect;
export type NewTrackComment = typeof trackComments.$inferInsert;

// ─── Client contacts cache ──────────────────────────────────────────
// When an artist signs a contract, submits a booking request, or the
// producer creates a project, we upsert an entry here so send-forms can
// pre-fill returning-artist details. `emailHash` is sha256(lower) and
// is the dedupe key alongside producerId; the raw lowercase email is
// kept for display. Scoped per-producer so contacts don't leak.
export const clientContacts = pgTable(
  "client_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "cascade" }),
    emailHash: text("email_hash").notNull(), // sha256 of lowercased email — privacy + dedupe key
    email: text("email").notNull(), // raw lowercase email — displayed in UI
    name: text("name").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    // Phase H.2 meta fields — nullable so existing rows (and every
    // auto-upsert path) can ignore them. Producers fill these in from the
    // CRM hub for classification + private context. `tags` is an array of
    // short free-text labels ("label: Universal", "genre: hip-hop"), drawn
    // with chips; `notes` is a multi-line producer-only field; and
    // `referralSource` captures "how did they hear about me" for
    // marketing intelligence.
    //
    // Batch D (0028) narrowed `tags` from nullable → NOT NULL DEFAULT
    // '{}'. Every read site can now treat the array as present, which
    // simplifies the tag-pill renderers on Project Room + CRM.
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'`),
    notes: text("notes"),
    // Optional phone-of-record, captured by the New Client modal in the
    // Clients & Projects v3 redesign (DESIGN.md §6.1). Nullable so every
    // pre-existing row + auto-upsert path can ignore it. Free-text — we
    // don't validate format server-side beyond a 40-char ceiling because
    // producers paste WhatsApp / international strings in many shapes.
    phone: text("phone"),
    referralSource: text("referral_source"),
    // Stamped by the Clerk user.created webhook on first artist sign-in.
    // Null = client has never signed in. Once stamped, the artist app can
    // resolve all studios for this person via a single index lookup on
    // (clerkUserId).
    clerkUserId: text("clerk_user_id"),
    // Soft-delete marker for artist-initiated disconnect (Settings →
    // Disconnect). Set timestamp = "this artist removed the connection";
    // null = active. Producer-side queries IGNORE this flag (CRM keeps
    // history); artist-side queries filter `IS NULL` so a disconnected
    // studio disappears from the switcher / music / store / book.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // Producer CRM archive is deliberately separate from the artist's
    // disconnect marker above. Producer archive changes list placement only;
    // artist ownership and access continue through the stable client id.
    producerArchivedAt: timestamp("producer_archived_at", { withTimezone: true }),
    // Linkpill "Invited" state for the Clients & Projects v3 redesign.
    // Stamped when the producer triggers Send Invite (email or copy-link)
    // from the Invite-to-App modal. Cleared when Clerk webhook resolves
    // `clerkUserId`. NULL means "no invite ever sent".
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    // Drag-to-reorder slot for the Clients list. NOT NULL with default 0
    // so existing rows back-fill safely. Reorder mutations update many
    // rows in a single transaction.
    position: integer("position").notNull().default(0),
  },
  (t) => ({
    uniqPerProducer: unique("client_contacts_producer_email_unique").on(t.producerId, t.emailHash),
    idProducerUnique: unique("client_contacts_id_producer_unique").on(t.id, t.producerId),
    clerkUserIdx: index("client_contacts_clerk_user_idx")
      .on(t.clerkUserId)
      .where(sql`${t.clerkUserId} IS NOT NULL`),
    activeClerkUserIdx: index("client_contacts_active_clerk_user_idx")
      .on(t.clerkUserId, t.lastSeenAt.desc(), t.id)
      .where(sql`${t.clerkUserId} IS NOT NULL AND ${t.archivedAt} IS NULL`),
    adminEmailSearchIdx: index("client_contacts_admin_email_search_idx")
      .on(sql`lower(${t.email}) text_pattern_ops`, t.clerkUserId)
      .where(sql`${t.clerkUserId} IS NOT NULL`),
    adminNameSearchIdx: index("client_contacts_admin_name_search_idx")
      .on(sql`lower(${t.name}) text_pattern_ops`, t.clerkUserId)
      .where(sql`${t.clerkUserId} IS NOT NULL`),
  }),
);

export type ClientContact = typeof clientContacts.$inferSelect;
export type NewClientContact = typeof clientContacts.$inferInsert;

// ─── Registered Clerk accounts (SK-133) ────────────────────────────
// One person appears once, keyed by the provider's immutable Clerk user ID.
// Producer and Artist roles remain derived from producers/client_contacts.
// Rows backfilled from those mappings stay `needs_sync`; only a verified
// Clerk lifecycle webhook may assert current provider state and timestamps.
export const registeredAccounts = pgTable(
  "registered_accounts",
  {
    clerkUserId: text("clerk_user_id").primaryKey(),
    // Stable application identity. During a Clerk instance cutover this
    // remains the historical id used by role and audit rows, while the two
    // provider columns identify the currently synchronized Clerk account.
    providerClerkUserId: text("provider_clerk_user_id"),
    clerkInstanceId: text("clerk_instance_id"),
    primaryEmail: text("primary_email"),
    displayName: text("display_name"),
    emailVerified: boolean("email_verified"),
    audienceType: text("audience_type").notNull().default("unknown"),
    providerState: text("provider_state").notNull().default("needs_sync"),
    providerCreatedAt: timestamp("provider_created_at", { withTimezone: true }),
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    lastWebhookEventId: text("last_webhook_event_id"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerIdentityUnique: uniqueIndex("registered_accounts_provider_identity_unique")
      .on(t.clerkInstanceId, t.providerClerkUserId)
      .where(sql`${t.clerkInstanceId} IS NOT NULL AND ${t.providerClerkUserId} IS NOT NULL`),
    providerStateIdx: index("registered_accounts_provider_state_idx").on(
      t.providerState,
      t.clerkUserId,
    ),
    providerCreatedIdx: index("registered_accounts_provider_created_idx")
      .on(
        sql`CASE WHEN ${t.providerCreatedAt} IS NULL THEN 1 ELSE 0 END`,
        t.providerCreatedAt.desc().nullsLast(),
        t.clerkUserId.desc(),
      )
      .where(sql`${t.providerState} <> 'deleted'`),
    emailSearchIdx: index("registered_accounts_email_search_idx").on(
      sql`lower(${t.primaryEmail}) text_pattern_ops`,
      t.clerkUserId,
    ),
    nameSearchIdx: index("registered_accounts_name_search_idx").on(
      sql`lower(${t.displayName}) text_pattern_ops`,
      t.clerkUserId,
    ),
    clerkIdSearchIdx: index("registered_accounts_clerk_id_search_idx").on(
      sql`lower(${t.clerkUserId}) text_pattern_ops`,
      t.clerkUserId,
    ),
    identityShape: check(
      "registered_accounts_identity_shape",
      sql`${t.clerkUserId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
        AND (${t.providerClerkUserId} IS NULL OR ${t.providerClerkUserId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$')
        AND (${t.clerkInstanceId} IS NULL OR ${t.clerkInstanceId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$')
        AND (${t.primaryEmail} IS NULL OR (
          ${t.primaryEmail} = lower(btrim(${t.primaryEmail}))
          AND char_length(${t.primaryEmail}) BETWEEN 3 AND 320
        ))
        AND (${t.displayName} IS NULL OR (
          NULLIF(btrim(${t.displayName}), '') IS NOT NULL
          AND char_length(${t.displayName}) <= 160
        ))
        AND (${t.lastWebhookEventId} IS NULL OR (
          NULLIF(btrim(${t.lastWebhookEventId}), '') IS NOT NULL
          AND char_length(${t.lastWebhookEventId}) <= 255
        ))`,
    ),
    providerStateShape: check(
      "registered_accounts_provider_state_shape",
      sql`${t.providerState} IN ('active', 'banned', 'locked', 'deleted', 'needs_sync')`,
    ),
    audienceTypeShape: check(
      "registered_accounts_audience_type_shape",
      sql`${t.audienceType} IN ('external', 'internal', 'unknown')`,
    ),
    syncShape: check(
      "registered_accounts_sync_shape",
      sql`(
        ${t.providerState} = 'needs_sync'
        AND ${t.providerClerkUserId} IS NULL
        AND ${t.clerkInstanceId} IS NULL
        AND ${t.providerUpdatedAt} IS NULL
        AND ${t.lastWebhookEventId} IS NULL
        AND ${t.syncedAt} IS NULL
      ) OR (
        ${t.providerState} <> 'needs_sync'
        AND ${t.providerClerkUserId} IS NOT NULL
        AND ${t.clerkInstanceId} IS NOT NULL
        AND ${t.providerUpdatedAt} IS NOT NULL
        AND ${t.lastWebhookEventId} IS NOT NULL
        AND ${t.syncedAt} IS NOT NULL
      )`,
    ),
    deletedPiiShape: check(
      "registered_accounts_deleted_pii_shape",
      sql`${t.providerState} <> 'deleted' OR (
        ${t.primaryEmail} IS NULL
        AND ${t.displayName} IS NULL
        AND ${t.emailVerified} IS NULL
        AND ${t.audienceType} = 'unknown'
        AND ${t.lastSignInAt} IS NULL
      )`,
    ),
    timestampShape: check(
      "registered_accounts_timestamp_shape",
      sql`(${t.providerCreatedAt} IS NULL OR ${t.providerUpdatedAt} IS NULL OR ${t.providerCreatedAt} <= ${t.providerUpdatedAt})
        AND ${t.updatedAt} >= ${t.createdAt}`,
    ),
  }),
);

export type RegisteredAccount = typeof registeredAccounts.$inferSelect;
export type NewRegisteredAccount = typeof registeredAccounts.$inferInsert;

// Signed Clerk lifecycle webhook receipts are immutable and claimed inside
// the same transaction as their account and role-mapping side effects.
export const clerkUserSyncReceipts = pgTable(
  "clerk_user_sync_receipts",
  {
    eventId: text("event_id").primaryKey(),
    eventDigest: text("event_digest").notNull(),
    eventType: text("event_type").notNull(),
    // Raw id from the signed payload and the canonical application id are
    // recorded separately so replay proof survives provider relinking.
    clerkUserId: text("clerk_user_id").notNull(),
    canonicalClerkUserId: text("canonical_clerk_user_id").notNull(),
    clerkInstanceId: text("clerk_instance_id").notNull(),
    providerUpdatedAt: timestamp("provider_updated_at", {
      withTimezone: true,
    }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("clerk_user_sync_receipts_user_idx").on(
      t.clerkUserId,
      t.providerUpdatedAt.desc(),
      t.eventId,
    ),
    canonicalUserIdx: index("clerk_user_sync_receipts_canonical_user_idx").on(
      t.canonicalClerkUserId,
      t.providerUpdatedAt.desc(),
      t.eventId,
    ),
    shape: check(
      "clerk_user_sync_receipts_shape",
      sql`NULLIF(btrim(${t.eventId}), '') IS NOT NULL
        AND char_length(${t.eventId}) <= 255
        AND ${t.eventDigest} ~ '^sha256:[0-9a-f]{64}$'
        AND ${t.eventType} IN ('user.created', 'user.updated', 'user.deleted')
        AND ${t.clerkUserId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
        AND ${t.canonicalClerkUserId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
        AND ${t.clerkInstanceId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'`,
    ),
  }),
);

export type ClerkUserSyncReceipt = typeof clerkUserSyncReceipts.$inferSelect;
export type NewClerkUserSyncReceipt = typeof clerkUserSyncReceipts.$inferInsert;

// Accepted Clerk Producer invitations are claimed exactly once before the
// Producer role is created. The immutable receipt keeps the external
// invitation, Clerk instance, Clerk user, and verified email identity bound
// together without depending on webhook delivery order.
export const producerInvitationGrants = pgTable(
  "producer_invitation_grants",
  {
    clerkInvitationId: text("clerk_invitation_id").primaryKey(),
    // clerk_user_id stays canonical; provider_clerk_user_id is the account
    // Clerk proved accepted the invitation in the configured instance.
    clerkUserId: text("clerk_user_id").notNull(),
    providerClerkUserId: text("provider_clerk_user_id").notNull(),
    clerkInstanceId: text("clerk_instance_id").notNull(),
    invitedEmailHash: text("invited_email_hash").notNull(),
    invitationCreatedAt: timestamp("invitation_created_at", {
      withTimezone: true,
    }).notNull(),
    providerUpdatedAt: timestamp("provider_updated_at", {
      withTimezone: true,
    }).notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clerkUserUnique: unique("producer_invitation_grants_clerk_user_unique").on(t.clerkUserId),
    identityShape: check(
      "producer_invitation_grants_identity_shape",
      sql`${t.clerkInvitationId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
        AND ${t.clerkUserId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
        AND ${t.providerClerkUserId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
        AND ${t.clerkInstanceId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
        AND ${t.invitedEmailHash} ~ '^[0-9a-f]{64}$'`,
    ),
    timestampShape: check(
      "producer_invitation_grants_timestamp_shape",
      sql`${t.providerUpdatedAt} >= ${t.invitationCreatedAt}`,
    ),
  }),
);

export type ProducerInvitationGrant = typeof producerInvitationGrants.$inferSelect;
export type NewProducerInvitationGrant = typeof producerInvitationGrants.$inferInsert;

// ─── Clerk provider-to-application identity bindings (SK-229) ─────
// Existing application rows keep their historical Clerk id. Each provider
// instance can bind its raw Clerk id to that stable canonical id; native and
// relink bindings may remain active together to make key rollback reversible.
export const clerkIdentityBindingKind = pgEnum("clerk_identity_binding_kind", ["native", "relink"]);

export const clerkIdentityBindingStatus = pgEnum("clerk_identity_binding_status", [
  "staged",
  "active",
  "revoked",
]);

export const clerkIdentityBindings = pgTable(
  "clerk_identity_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clerkInstanceId: text("clerk_instance_id").notNull(),
    providerClerkUserId: text("provider_clerk_user_id").notNull(),
    canonicalClerkUserId: text("canonical_clerk_user_id").notNull(),
    kind: clerkIdentityBindingKind("kind").notNull(),
    status: clerkIdentityBindingStatus("status").notNull().default("staged"),
    batchId: uuid("batch_id").notNull(),
    verifiedEmailHash: text("verified_email_hash").notNull(),
    sourceClerkInstanceId: text("source_clerk_instance_id"),
    sourceProviderClerkUserId: text("source_provider_clerk_user_id"),
    manifestDigest: text("manifest_digest").notNull(),
    evidenceRef: text("evidence_ref").notNull(),
    stagedAt: timestamp("staged_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    providerLiveUnique: uniqueIndex("clerk_identity_bindings_provider_live_unique")
      .on(t.clerkInstanceId, t.providerClerkUserId)
      .where(sql`${t.status} IN ('staged', 'active')`),
    canonicalActiveUnique: uniqueIndex("clerk_identity_bindings_canonical_active_unique")
      .on(t.clerkInstanceId, t.canonicalClerkUserId)
      .where(sql`${t.status} = 'active'`),
    canonicalLookupIdx: index("clerk_identity_bindings_canonical_lookup_idx").on(
      t.canonicalClerkUserId,
      t.status,
      t.clerkInstanceId,
    ),
    batchIdx: index("clerk_identity_bindings_batch_idx").on(t.batchId, t.status, t.id),
    identityShape: check(
      "clerk_identity_bindings_identity_shape",
      sql`${t.clerkInstanceId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
        AND ${t.providerClerkUserId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
        AND ${t.canonicalClerkUserId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
        AND ${t.verifiedEmailHash} ~ '^sha256:[0-9a-f]{64}$'
        AND ${t.manifestDigest} ~ '^sha256:[0-9a-f]{64}$'
        AND NULLIF(btrim(${t.evidenceRef}), '') IS NOT NULL
        AND char_length(${t.evidenceRef}) <= 255`,
    ),
    sourceShape: check(
      "clerk_identity_bindings_source_shape",
      sql`(
        ${t.kind} = 'native'
        AND ${t.sourceClerkInstanceId} IS NULL
        AND ${t.sourceProviderClerkUserId} IS NULL
        AND ${t.canonicalClerkUserId} = ${t.providerClerkUserId}
      ) OR (
        ${t.kind} = 'relink'
        AND ${t.sourceClerkInstanceId} IS NOT NULL
        AND ${t.sourceProviderClerkUserId} IS NOT NULL
        AND ${t.sourceClerkInstanceId} <> ${t.clerkInstanceId}
        AND ${t.sourceProviderClerkUserId} = ${t.canonicalClerkUserId}
      )`,
    ),
    lifecycleShape: check(
      "clerk_identity_bindings_lifecycle_shape",
      sql`(
        ${t.status} = 'staged'
        AND ${t.activatedAt} IS NULL
        AND ${t.revokedAt} IS NULL
      ) OR (
        ${t.status} = 'active'
        AND ${t.activatedAt} IS NOT NULL
        AND ${t.activatedAt} >= ${t.stagedAt}
        AND ${t.revokedAt} IS NULL
      ) OR (
        ${t.status} = 'revoked'
        AND ${t.revokedAt} IS NOT NULL
        AND ${t.revokedAt} >= coalesce(${t.activatedAt}, ${t.stagedAt})
      ) IS TRUE`,
    ),
  }),
);

export type ClerkIdentityBinding = typeof clerkIdentityBindings.$inferSelect;
export type NewClerkIdentityBinding = typeof clerkIdentityBindings.$inferInsert;

// ─── Operator-managed account closure (SK-229) ───────────────────
// Verification immediately hides Producer/public role surfaces without
// rewriting Clerk identity. Full access revocation, provider deletion, and
// object deletion require explicit, resumable task evidence.
export const accountClosureStatus = pgEnum("account_closure_status", [
  "requested",
  "processing",
  "blocked",
  "completed",
  "cancelled",
]);

export const accountClosureTaskKind = pgEnum("account_closure_task_kind", [
  "google_calendar_disconnect",
  "device_and_artist_preferences_cleanup",
  "clerk_account_delete",
  "public_and_capability_link_revoke",
  "account_profile_deidentification",
  "storage_review_and_cleanup",
  "retained_record_review",
  "diagnostic_provider_cleanup",
  "backup_expiry_tracking",
]);

export const accountClosureTaskStatus = pgEnum("account_closure_task_status", [
  "pending",
  "running",
  "blocked",
  "succeeded",
  "not_applicable",
]);

export const accountClosureEventType = pgEnum("account_closure_event_type", [
  "requested",
  "identity_verified",
  "closure_started",
  "access_revoked",
  "task_started",
  "task_blocked",
  "task_succeeded",
  "task_not_applicable",
  "legal_hold_applied",
  "legal_hold_released",
  "completed",
  "cancelled",
]);

export const accountClosureRequests = pgTable(
  "account_closure_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    requesterEmailHash: text("requester_email_hash").notNull(),
    status: accountClosureStatus("status").notNull().default("requested"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    identityVerifiedAt: timestamp("identity_verified_at", { withTimezone: true }),
    closureStartedAt: timestamp("closure_started_at", { withTimezone: true }),
    accessRevokedAt: timestamp("access_revoked_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    verifiedByClerkUserId: text("verified_by_clerk_user_id"),
    legalHoldAt: timestamp("legal_hold_at", { withTimezone: true }),
    legalHoldReasonCode: text("legal_hold_reason_code"),
    legalHoldByClerkUserId: text("legal_hold_by_clerk_user_id"),
    legalHoldReleasedAt: timestamp("legal_hold_released_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clerkUserUnique: unique("account_closure_requests_clerk_user_unique").on(t.clerkUserId),
    statusDueIdx: index("account_closure_requests_status_due_idx").on(t.status, t.dueAt, t.id),
    closureStartedIdx: index("account_closure_requests_started_idx")
      .on(t.clerkUserId, t.closureStartedAt)
      .where(sql`${t.closureStartedAt} IS NOT NULL`),
    identityShape: check(
      "account_closure_requests_identity_shape",
      sql`${t.clerkUserId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
        AND ${t.requesterEmailHash} ~ '^sha256:[0-9a-f]{64}$'
        AND (${t.verifiedByClerkUserId} IS NULL OR ${t.verifiedByClerkUserId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$')
        AND (${t.legalHoldByClerkUserId} IS NULL OR ${t.legalHoldByClerkUserId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$')`,
    ),
    lifecycleShape: check(
      "account_closure_requests_lifecycle_shape",
      sql`(
        ${t.status} = 'requested'
        AND ${t.identityVerifiedAt} IS NULL
        AND ${t.closureStartedAt} IS NULL
        AND ${t.accessRevokedAt} IS NULL
        AND ${t.dueAt} IS NULL
        AND ${t.verifiedByClerkUserId} IS NULL
        AND ${t.completedAt} IS NULL
        AND ${t.cancelledAt} IS NULL
      ) OR (
        ${t.status} IN ('processing', 'blocked')
        AND ${t.identityVerifiedAt} IS NOT NULL
        AND ${t.closureStartedAt} IS NOT NULL
        AND ${t.dueAt} = ${t.identityVerifiedAt} + interval '30 days'
        AND ${t.verifiedByClerkUserId} IS NOT NULL
        AND ${t.completedAt} IS NULL
        AND ${t.cancelledAt} IS NULL
      ) OR (
        ${t.status} = 'completed'
        AND ${t.identityVerifiedAt} IS NOT NULL
        AND ${t.closureStartedAt} IS NOT NULL
        AND ${t.accessRevokedAt} IS NOT NULL
        AND ${t.dueAt} = ${t.identityVerifiedAt} + interval '30 days'
        AND ${t.verifiedByClerkUserId} IS NOT NULL
        AND ${t.completedAt} >= ${t.identityVerifiedAt}
        AND ${t.cancelledAt} IS NULL
        AND (${t.legalHoldAt} IS NULL OR ${t.legalHoldReleasedAt} IS NOT NULL)
      ) OR (
        ${t.status} = 'cancelled'
        AND ${t.identityVerifiedAt} IS NULL
        AND ${t.closureStartedAt} IS NULL
        AND ${t.accessRevokedAt} IS NULL
        AND ${t.dueAt} IS NULL
        AND ${t.verifiedByClerkUserId} IS NULL
        AND ${t.completedAt} IS NULL
        AND ${t.cancelledAt} IS NOT NULL
      )`,
    ),
    legalHoldShape: check(
      "account_closure_requests_legal_hold_shape",
      sql`(
        ${t.legalHoldAt} IS NULL
        AND ${t.legalHoldReasonCode} IS NULL
        AND ${t.legalHoldByClerkUserId} IS NULL
        AND ${t.legalHoldReleasedAt} IS NULL
      ) OR (
        ${t.legalHoldAt} IS NOT NULL
        AND NULLIF(btrim(${t.legalHoldReasonCode}), '') IS NOT NULL
        AND char_length(${t.legalHoldReasonCode}) <= 100
        AND ${t.legalHoldReasonCode} ~ '^[a-z][a-z0-9_.-]{0,99}$'
        AND ${t.legalHoldByClerkUserId} IS NOT NULL
        AND (${t.legalHoldReleasedAt} IS NULL OR ${t.legalHoldReleasedAt} >= ${t.legalHoldAt})
      )`,
    ),
    timestampShape: check(
      "account_closure_requests_timestamp_shape",
      sql`${t.updatedAt} >= ${t.createdAt}
        AND ${t.receivedAt} >= ${t.createdAt}
        AND (${t.identityVerifiedAt} IS NULL OR ${t.identityVerifiedAt} >= ${t.receivedAt})
        AND (${t.closureStartedAt} IS NULL OR ${t.closureStartedAt} >= ${t.identityVerifiedAt})
        AND (${t.accessRevokedAt} IS NULL OR ${t.accessRevokedAt} >= ${t.closureStartedAt})
        AND (${t.cancelledAt} IS NULL OR ${t.cancelledAt} >= ${t.receivedAt})`,
    ),
  }),
);

export type AccountClosureRequest = typeof accountClosureRequests.$inferSelect;
export type NewAccountClosureRequest = typeof accountClosureRequests.$inferInsert;

export const accountClosureTasks = pgTable(
  "account_closure_tasks",
  {
    requestId: uuid("request_id").notNull(),
    kind: accountClosureTaskKind("kind").notNull(),
    status: accountClosureTaskStatus("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    evidenceRef: text("evidence_ref"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ name: "account_closure_tasks_pk", columns: [t.requestId, t.kind] }),
    requestFk: foreignKey({
      name: "account_closure_tasks_request_fk",
      columns: [t.requestId],
      foreignColumns: [accountClosureRequests.id],
    }).onDelete("restrict"),
    statusUpdatedIdx: index("account_closure_tasks_status_updated_idx").on(
      t.status,
      t.updatedAt,
      t.requestId,
      t.kind,
    ),
    attemptShape: check("account_closure_tasks_attempt_shape", sql`${t.attemptCount} >= 0`),
    resultShape: check(
      "account_closure_tasks_result_shape",
      sql`(
        ${t.status} = 'pending'
        AND ${t.startedAt} IS NULL
        AND ${t.completedAt} IS NULL
        AND ${t.lastErrorCode} IS NULL
        AND ${t.evidenceRef} IS NULL
      ) OR (
        ${t.status} = 'running'
        AND ${t.attemptCount} > 0
        AND ${t.startedAt} IS NOT NULL
        AND ${t.completedAt} IS NULL
        AND ${t.lastErrorCode} IS NULL
        AND ${t.evidenceRef} IS NULL
      ) OR (
        ${t.status} = 'blocked'
        AND ${t.attemptCount} > 0
        AND ${t.startedAt} IS NOT NULL
        AND ${t.completedAt} IS NULL
        AND NULLIF(btrim(${t.lastErrorCode}), '') IS NOT NULL
        AND char_length(${t.lastErrorCode}) <= 100
        AND ${t.evidenceRef} IS NULL
      ) OR (
        ${t.status} IN ('succeeded', 'not_applicable')
        AND ${t.startedAt} IS NOT NULL
        AND ${t.completedAt} >= ${t.startedAt}
        AND ${t.lastErrorCode} IS NULL
        AND NULLIF(btrim(${t.evidenceRef}), '') IS NOT NULL
        AND char_length(${t.evidenceRef}) <= 255
      )`,
    ),
  }),
);

export type AccountClosureTask = typeof accountClosureTasks.$inferSelect;
export type NewAccountClosureTask = typeof accountClosureTasks.$inferInsert;

export const accountClosureEvents = pgTable(
  "account_closure_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id").notNull(),
    eventType: accountClosureEventType("event_type").notNull(),
    taskKind: accountClosureTaskKind("task_kind"),
    actorClerkUserId: text("actor_clerk_user_id").notNull(),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    evidenceRef: text("evidence_ref"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    requestFk: foreignKey({
      name: "account_closure_events_request_fk",
      columns: [t.requestId],
      foreignColumns: [accountClosureRequests.id],
    }).onDelete("restrict"),
    operationUnique: unique("account_closure_events_operation_unique").on(
      t.requestId,
      t.operationKey,
    ),
    requestOccurredIdx: index("account_closure_events_request_occurred_idx").on(
      t.requestId,
      t.occurredAt,
      t.id,
    ),
    identityShape: check(
      "account_closure_events_identity_shape",
      sql`${t.actorClerkUserId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
        AND NULLIF(btrim(${t.operationKey}), '') IS NOT NULL
        AND char_length(${t.operationKey}) <= 255
        AND ${t.operationDigest} ~ '^sha256:[0-9a-f]{64}$'
        AND (${t.evidenceRef} IS NULL OR (NULLIF(btrim(${t.evidenceRef}), '') IS NOT NULL AND char_length(${t.evidenceRef}) <= 255))`,
    ),
    taskShape: check(
      "account_closure_events_task_shape",
      sql`(
        ${t.eventType} IN ('task_started', 'task_blocked', 'task_succeeded', 'task_not_applicable')
        AND ${t.taskKind} IS NOT NULL
      ) OR (
        ${t.eventType} NOT IN ('task_started', 'task_blocked', 'task_succeeded', 'task_not_applicable')
        AND ${t.taskKind} IS NULL
      )`,
    ),
    timestampShape: check(
      "account_closure_events_timestamp_shape",
      sql`${t.createdAt} >= ${t.occurredAt}`,
    ),
  }),
);

export type AccountClosureEvent = typeof accountClosureEvents.$inferSelect;
export type NewAccountClosureEvent = typeof accountClosureEvents.$inferInsert;

// ─── Artist platform account preferences (SK-153) ──────────────────
// Clerk remains the source of truth for profile identity and photo. This
// single global row stores only product-owned artist preferences.
export type ArtistNotificationPreferenceCategory =
  | "purchase"
  | "proof"
  | "booking"
  | "session_reminder"
  | "new_music"
  | "producer_comment";

export type ArtistNotificationPreferences = Partial<
  Record<
    ArtistNotificationPreferenceCategory,
    {
      inApp?: boolean;
      transactionalEmail?: boolean;
      activityEmail?: boolean;
    }
  >
>;

export const artistProfiles = pgTable(
  "artist_profiles",
  {
    clerkUserId: text("clerk_user_id").primaryKey(),
    // NULL means first-use browser detection has not been persisted yet.
    // The application validates the value against the runtime IANA registry.
    timezone: text("timezone"),
    notificationPreferences: jsonb("notification_preferences")
      .$type<ArtistNotificationPreferences>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    identityShape: check(
      "artist_profiles_identity_shape",
      sql`${t.clerkUserId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'`,
    ),
    timezoneShape: check(
      "artist_profiles_timezone_shape",
      sql`${t.timezone} IS NULL OR (
        ${t.timezone} = btrim(${t.timezone})
        AND char_length(${t.timezone}) BETWEEN 1 AND 100
      )`,
    ),
    timestampShape: check("artist_profiles_timestamp_shape", sql`${t.updatedAt} >= ${t.createdAt}`),
  }),
);

export type ArtistProfile = typeof artistProfiles.$inferSelect;
export type NewArtistProfile = typeof artistProfiles.$inferInsert;

// Artist notification records are intentionally separate from the producer
// inbox table below. Recipient ownership is the signed-in Clerk account;
// producerId is only the studio association used for filtering and dots.
export const artistNotificationKind = pgEnum("artist_notification_kind", [
  "purchase_approved",
  "purchase_declined",
  "proof_verified",
  "proof_rejected",
  "booking_confirmed",
  "booking_declined",
  "booking_changed",
  "booking_cancelled",
  "session_reminder_24h",
  "session_reminder_1h",
  "track_version_created",
  "producer_comment_created",
]);

export const artistNotificationSubjectType = pgEnum("artist_notification_subject_type", [
  "purchase_request",
  "payment_proof",
  "booking",
  "track_version",
]);

export const artistNotifications = pgTable(
  "artist_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipientClerkUserId: text("recipient_clerk_user_id").notNull(),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "restrict" }),
    kind: artistNotificationKind("kind").notNull(),
    subjectType: artistNotificationSubjectType("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    // Exact same-origin destination built and validated by the server.
    destinationHref: text("destination_href").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    // Stable source-event identity. Retried emitters use this key instead of
    // creating duplicate feed rows.
    dedupeKey: text("dedupe_key").notNull(),
    // Channel choice is snapshotted at event creation. Dot state remains
    // independent so disabling the in-app feed cannot clear another studio.
    inAppVisible: boolean("in_app_visible").notNull().default(true),
    switcherDotWorthy: boolean("switcher_dot_worthy").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    recipientDedupeUnique: unique("artist_notifications_recipient_dedupe_unique").on(
      t.recipientClerkUserId,
      t.dedupeKey,
    ),
    feedIdx: index("artist_notifications_recipient_feed_idx").on(
      t.recipientClerkUserId,
      t.inAppVisible,
      t.archivedAt,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    unreadIdx: index("artist_notifications_recipient_unread_idx")
      .on(t.recipientClerkUserId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.inAppVisible} IS TRUE AND ${t.archivedAt} IS NULL AND ${t.readAt} IS NULL`),
    unseenDotIdx: index("artist_notifications_recipient_studio_dot_idx")
      .on(t.recipientClerkUserId, t.producerId, t.createdAt.desc(), t.id.desc())
      .where(
        sql`${t.switcherDotWorthy} IS TRUE AND ${t.archivedAt} IS NULL AND ${t.openedAt} IS NULL`,
      ),
    identityShape: check(
      "artist_notifications_identity_shape",
      sql`${t.recipientClerkUserId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
        AND NULLIF(btrim(${t.dedupeKey}), '') IS NOT NULL
        AND char_length(${t.dedupeKey}) <= 255`,
    ),
    destinationShape: check(
      "artist_notifications_destination_shape",
      sql`char_length(${t.destinationHref}) BETWEEN 1 AND 512
        AND ${t.destinationHref} LIKE '/artist/%'
        AND ${t.destinationHref} NOT LIKE '//%'
        AND position(chr(92) in ${t.destinationHref}) = 0
        AND position('://' in ${t.destinationHref}) = 0`,
    ),
    timestampShape: check(
      "artist_notifications_timestamp_shape",
      sql`(${t.readAt} IS NULL OR ${t.readAt} >= ${t.createdAt})
        AND (${t.openedAt} IS NULL OR ${t.openedAt} >= ${t.createdAt})`,
    ),
    archivedTimestampShape: check(
      "artist_notifications_archived_timestamp_shape",
      sql`${t.archivedAt} IS NULL OR ${t.archivedAt} >= ${t.createdAt}`,
    ),
  }),
);

export type ArtistNotification = typeof artistNotifications.$inferSelect;
export type NewArtistNotification = typeof artistNotifications.$inferInsert;

// Immutable authorization captured at disconnect. Active connection checks
// never consult this table; only dedicated read-only Past studio surfaces do.
export const artistHistoricalResourceType = pgEnum("artist_historical_resource_type", [
  "studio",
  "purchase",
  "project",
  "track",
  "track_version",
  "track_comment",
  "payment_proof",
  "booking",
  "track_version_download",
]);

export const artistHistoricalAccessGrants = pgTable(
  "artist_historical_access_grants",
  {
    artistClerkUserId: text("artist_clerk_user_id").notNull(),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "restrict" }),
    resourceType: artistHistoricalResourceType("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({
      name: "artist_historical_access_grants_pk",
      columns: [t.artistClerkUserId, t.producerId, t.resourceType, t.resourceId],
    }),
    artistStudioIdx: index("artist_historical_access_grants_artist_studio_idx").on(
      t.artistClerkUserId,
      t.producerId,
      t.resourceType,
    ),
    artistResourceIdx: index("artist_historical_access_grants_artist_resource_idx").on(
      t.artistClerkUserId,
      t.resourceType,
      t.resourceId,
    ),
    identityShape: check(
      "artist_historical_access_grants_identity_shape",
      sql`${t.artistClerkUserId} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'`,
    ),
    timestampShape: check(
      "artist_historical_access_grants_timestamp_shape",
      sql`${t.createdAt} >= ${t.disconnectedAt}`,
    ),
  }),
);

export type ArtistHistoricalAccessGrant = typeof artistHistoricalAccessGrants.$inferSelect;
export type NewArtistHistoricalAccessGrant = typeof artistHistoricalAccessGrants.$inferInsert;

// ─── Notifications / Inbox (Phase E) ────────────────────────────────
// One unified feed of everything that needs the producer's attention:
// artist comments on track versions, new work requests, session requests,
// agreement acceptance, and proof review. The inbox at /dashboard/inbox reads
// from this single table and supports j/k navigation, read/archive
// state, and click-through to the source context. Emit helpers in
// apps/web/src/server/notifications/emit.ts insert rows fire-and-
// forget so a notify failure can never block the primary flow.
export const notificationKind = pgEnum("notification_kind", [
  "comment_created", // visitor commented on a track version
  "booking_requested", // visitor submitted a booking
  "track_approved", // (future) artist marked a version approved
  // ─── Purchase flow (SK-37 / BE-1) ─────────────────────────────────
  // Producer-facing inbox events for the artist purchase journey.
  // Emitted from server/notifications/emit.ts at each Gate-1 transition.
  "purchase_requested", // artist submitted a purchase request (Gate 1 in)
  "purchase_approved", // producer approved the request
  "purchase_declined", // producer declined the request
  "agreement_accepted", // artist accepted the producer's agreement
  "proof_submitted", // artist uploaded a proof of payment (Gate 2 in)
]);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "cascade" }),
    kind: notificationKind("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    // Related refs — nullable FKs for click-through. Only one is
    // populated per row; the UI routes to the right page based on
    // which id is present.
    projectId: uuid("project_id"),
    trackVersionId: uuid("track_version_id"),
    commentId: uuid("comment_id"),
    bookingId: uuid("booking_id"),
    purchaseRequestId: uuid("purchase_request_id"),
    purchaseId: uuid("purchase_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectProducerFk: foreignKey({
      columns: [t.projectId, t.producerId],
      foreignColumns: [projects.id, projects.producerId],
      name: "notifications_project_producer_fk",
    }).onDelete("restrict"),
    trackVersionProducerFk: foreignKey({
      columns: [t.trackVersionId, t.producerId],
      foreignColumns: [trackVersions.id, trackVersions.producerId],
      name: "notifications_track_version_producer_fk",
    }).onDelete("restrict"),
    commentProducerFk: foreignKey({
      columns: [t.commentId, t.producerId],
      foreignColumns: [trackComments.id, trackComments.producerId],
      name: "notifications_comment_producer_fk",
    }).onDelete("restrict"),
    bookingProducerFk: foreignKey({
      columns: [t.bookingId, t.producerId],
      foreignColumns: [bookings.id, bookings.producerId],
      name: "notifications_booking_producer_fk",
    }).onDelete("restrict"),
    purchaseRequestProducerFk: foreignKey({
      columns: [t.purchaseRequestId, t.producerId],
      foreignColumns: [purchaseRequests.id, purchaseRequests.producerId],
      name: "notifications_purchase_request_producer_fk",
    }).onDelete("restrict"),
    purchaseProducerFk: foreignKey({
      columns: [t.purchaseId, t.producerId],
      foreignColumns: [purchases.id, purchases.producerId],
      name: "notifications_purchase_producer_fk",
    }).onDelete("restrict"),
    // Covers the inbox list query: filter by producer + active/archived
    // bucket, order by createdAt desc.
    producerActiveIdx: index("notifications_producer_active_idx").on(
      t.producerId,
      t.archivedAt,
      t.createdAt,
    ),
  }),
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

// ─── Web Push subscriptions (SK-112) ───────────────────────────────
// One row represents one browser/device subscription. Clerk's stable user id
// is the ownership boundary because the same signed-in person may be a
// producer, an artist across several studios, or both. Endpoints remain
// globally unique by their server-computed SHA-256 digest: a browser endpoint
// already owned by one account can never be silently reassigned to another.
//
// Categories are deliberately limited to real product events with delivery
// paths. An empty array is the default and means no push is sent until the
// user explicitly opts in from that browser.
export type PushSubscriptionCategory =
  | "booking"
  | "payment"
  | "comment"
  | "project_status"
  | "song_status"
  | "purchase_status";

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    endpointHash: text("endpoint_hash").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    categories: text("categories")
      .array()
      .$type<PushSubscriptionCategory[]>()
      .notNull()
      .default(sql`'{}'`),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    endpointHashUnique: unique("push_subscriptions_endpoint_hash_unique").on(t.endpointHash),
    idOwnerUnique: unique("push_subscriptions_id_owner_unique").on(t.id, t.clerkUserId),
    ownerUpdatedIdx: index("push_subscriptions_owner_updated_idx").on(t.clerkUserId, t.updatedAt),
    expiresIdx: index("push_subscriptions_expires_idx")
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} IS NOT NULL`),
    endpointIsHttps: check(
      "push_subscriptions_endpoint_https",
      sql`${t.endpoint} ~ '^https://[^[:space:]]+$'`,
    ),
    endpointHashShape: check(
      "push_subscriptions_endpoint_hash_shape",
      sql`${t.endpointHash} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    keyShape: check(
      "push_subscriptions_key_shape",
      sql`char_length(${t.p256dh}) BETWEEN 32 AND 256 AND char_length(${t.auth}) BETWEEN 8 AND 128`,
    ),
    categoriesAllowlist: check(
      "push_subscriptions_categories_allowlist",
      sql`${t.categories} <@ ARRAY['booking', 'payment', 'comment', 'project_status', 'song_status', 'purchase_status']::text[]`,
    ),
    futureExpiry: check(
      "push_subscriptions_future_expiry",
      sql`${t.expiresAt} IS NULL OR ${t.expiresAt} > ${t.createdAt}`,
    ),
  }),
);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;

// ─── Producer external links (Wave 2 of /join flow) ────────────────
// PRD §6.2 Section B: the `/join/<slug>` teaser has two audio sections.
// Section A (portfolioTracks + is_public_sample) holds Skitza-uploaded
// tracks. Section B is this table — external streaming URLs from 7
// supported platforms that render as inline embeds on the teaser.
// These tracks are already public on their origin platforms, so no
// gating. Producer can curate up to N links (UI enforces reasonable
// cap; schema permits any number). Render order comes from `position`
// — the Setup UI exposes reorder, CRUD, and platform-picker.
//
// Platform enum is intentionally fixed. Adding a platform requires
// migration + embed component + Setup UI update. Keeps the producer-
// facing platform list curated, not a free-form URL bucket.
export const externalPlatform = pgEnum("external_platform", [
  "spotify",
  "apple_music",
  "youtube",
  "soundcloud",
  "bandcamp",
  "tidal",
  "instagram_reels",
]);

export const producerExternalLinks = pgTable(
  "producer_external_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "cascade" }),
    platform: externalPlatform("platform").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Per-producer list-by-position lookup hits this directly. Ordering
    // columns in the index to match the ORDER BY on the render path
    // avoids a sort on rows.
    producerIdx: index("producer_external_links_producer_idx").on(t.producerId, t.position),
    // Story 06 of onboarding rebuild — one URL per platform per
    // producer. The onboarding wizard's portfolio editor exposes 3
    // platform inputs (Spotify / YouTube / Instagram); each producer
    // gets exactly one row per platform, and saving a new URL upserts
    // (ON CONFLICT (producer_id, platform) DO UPDATE) — which requires
    // this constraint to target. Migration 0034 backfills + adds it.
    uniqPerPlatform: unique("producer_external_links_producer_platform_unique").on(
      t.producerId,
      t.platform,
    ),
  }),
);

export type ProducerExternalLink = typeof producerExternalLinks.$inferSelect;
export type NewProducerExternalLink = typeof producerExternalLinks.$inferInsert;
export type ExternalPlatform = (typeof externalPlatform.enumValues)[number];

// ─── Producer notes (Today cockpit Quick Note backing) ─────────────
// Audit Task 11 (2026-04-22). Was localStorage-only; promoted to a
// real DB-backed surface so producers' ad-hoc jots persist across
// devices + cache clears. Indexed on (producer_id, created_at desc)
// so the Today list reads newest-first in one page-scope query.
export const producerNotes = pgTable(
  "producer_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byProducerCreated: index("producer_notes_producer_created_idx").on(t.producerId, t.createdAt),
  }),
);

export type ProducerNote = typeof producerNotes.$inferSelect;
export type NewProducerNote = typeof producerNotes.$inferInsert;

// ─── Purchase foundation (SK-90) ───────────────────────────────────
// Requests remain a pre-acceptance new-work queue. A Purchase begins when
// final terms are accepted and owns the frozen commercial snapshot, exact
// installment schedule, proofs, ledger history, songs, versions, sessions,
// approval events, and download entitlement for that accepted work.
type PurchaseCommercialSnapshotBody = {
  productOrOfferName: string;
  tagline?: string;
  service?: string;
  deliverables: string[];
  lineItems: Array<{
    label: string;
    quantity: number;
    listUnitPriceCents: number;
    unitPriceCents: number;
    totalCents: number;
  }>;
  listSubtotalCents: number;
  discountCents: number;
  subtotalCents: number;
  tax: { mode: "tax_free" | "tax_included" | "tax_added"; ratePct: number; amountCents: number };
  totalCents: number;
  currency: string;
  includedSongSpaces: number;
  session: null | {
    limit: { kind: "fixed"; count: number } | { kind: "unlimited" };
    durationMin: number;
    locationType: string;
    bufferMinutes: number;
    minLeadHours: number;
  };
  revisionRule: { kind: "fixed"; count: number } | { kind: "unlimited" } | null;
  royaltyTerms: ProductRoyaltyTerms | null;
  rights: string[];
  // A true zero-total purchase has no payment plan and no installments.
  // Paid purchases must select exactly one of the approved plan shapes.
  selectedPaymentPlan: PaymentPlan | null;
  offeredPaymentPlans: PaymentPlan[];
  agreementText: string;
};

export type PurchaseCommercialSnapshot = PurchaseCommercialSnapshotBody & {
  // Version 1 is immutable legacy history and never creates a new allowance.
  // The acceptance validator requires version 2 to carry bookingEnabled.
  version: 1 | 2;
  bookingEnabled?: boolean;
};

export const purchaseSourceKind = pgEnum("purchase_source_kind", [
  "store_product",
  "private_offer",
  "session_product",
  "paid_add_on",
  "no_charge_add_on",
]);

export const privateOfferStatus = pgEnum("private_offer_status", [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
  "canceled",
]);

export const purchaseLifecycleStatus = pgEnum("purchase_lifecycle_status", [
  "waiting_for_payment",
  "active",
  "canceled",
]);

export const purchaseRequestStatus = pgEnum("purchase_request_status", [
  "pending",
  "approved",
  "declined",
  "canceled",
  "converted",
]);

export const purchasePaymentPlanKind = pgEnum("purchase_payment_plan_kind", [
  "full",
  "split_50_50",
  "monthly",
]);

export const purchaseInstallmentDueTrigger = pgEnum("purchase_installment_due_trigger", [
  "acceptance",
  "monthly_anniversary",
  "artist_approval",
]);

export const purchaseInstallmentStatus = pgEnum("purchase_installment_status", [
  "not_paid",
  "awaiting_review",
  "partially_paid",
  "confirmed",
  "overdue",
  "waived",
  "canceled",
]);

export const paymentProofStatus = pgEnum("payment_proof_status", [
  "pending",
  "confirmed",
  "rejected",
]);

export const purchasePaymentSource = pgEnum("purchase_payment_source", ["proof", "manual"]);

export const purchaseReminderKind = pgEnum("purchase_reminder_kind", [
  "automatic_3_days_before",
  "automatic_due",
  "automatic_3_days_late",
  "automatic_weekly_late",
  "manual",
]);

export const purchaseReminderDeliveryStatus = pgEnum("purchase_reminder_delivery_status", [
  "reserved",
  "sending",
  "sent",
  "reservation_expired",
  "dedupe_expired",
]);

export const projectPaymentPauseAction = pgEnum("project_payment_pause_action", [
  "paused",
  "resumed",
]);

export const sessionAllowanceKind = pgEnum("session_allowance_kind", ["fixed", "unlimited"]);

export const sessionAllowanceCloseReason = pgEnum("session_allowance_close_reason", [
  "project_completed",
  "project_canceled",
  "purchase_canceled",
]);

export const versionApprovalAction = pgEnum("version_approval_action", ["approved", "revoked"]);

// Requests are the pre-acceptance new-work queue. They deliberately do
// not own prices, plans, accepted terms, proofs, or payment state. Those
// records begin at Purchase once the artist accepts the final terms.
export const purchaseRequests = pgTable(
  "purchase_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "restrict" }),
    clientContactId: uuid("client_contact_id").notNull(),
    productId: uuid("product_id").notNull(),
    projectId: uuid("project_id"),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    refNumber: text("ref_number").notNull().unique(),
    status: purchaseRequestStatus("status").notNull().default("pending"),
    artistName: text("artist_name").notNull(),
    artistEmail: text("artist_email").notNull(),
    requestedSongQty: integer("requested_song_qty"),
    brief: text("brief"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    operationUnique: unique("purchase_requests_operation_key_unique").on(
      t.producerId,
      t.clientContactId,
      t.operationKey,
    ),
    idOwnerUnique: unique("purchase_requests_id_owner_unique").on(
      t.id,
      t.producerId,
      t.clientContactId,
    ),
    idProducerUnique: unique("purchase_requests_id_producer_unique").on(t.id, t.producerId),
    idProjectOwnerUnique: unique("purchase_requests_id_project_owner_unique").on(
      t.id,
      t.productId,
      t.projectId,
      t.producerId,
      t.clientContactId,
    ),
    clientProducerFk: foreignKey({
      columns: [t.clientContactId, t.producerId],
      foreignColumns: [clientContacts.id, clientContacts.producerId],
      name: "purchase_requests_client_producer_fk",
    }).onDelete("restrict"),
    productProducerFk: foreignKey({
      columns: [t.productId, t.producerId],
      foreignColumns: [products.id, products.producerId],
      name: "purchase_requests_product_producer_fk",
    }).onDelete("restrict"),
    projectOwnerFk: foreignKey({
      columns: [t.projectId, t.producerId, t.clientContactId],
      foreignColumns: [projects.id, projects.producerId, projects.clientContactId],
      name: "purchase_requests_project_owner_fk",
    }).onDelete("restrict"),
    producerStatusCreatedIdx: index("purchase_requests_producer_status_created_idx").on(
      t.producerId,
      t.status,
      t.createdAt,
    ),
    adminActivationIdx: index("purchase_requests_admin_activation_idx").on(
      t.producerId,
      t.createdAt,
      t.clientContactId,
    ),
    adminClientActivityIdx: index("purchase_requests_admin_client_activity_idx").on(
      t.clientContactId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    requestedSongQtyPositive: check(
      "purchase_requests_requested_song_qty_positive",
      sql`${t.requestedSongQty} IS NULL OR ${t.requestedSongQty} > 0`,
    ),
    statusTimestampShape: check(
      "purchase_requests_status_timestamp_shape",
      sql`((${t.status} = 'pending' AND ${t.approvedAt} IS NULL AND ${t.declinedAt} IS NULL AND ${t.canceledAt} IS NULL AND ${t.convertedAt} IS NULL) OR (${t.status} = 'approved' AND ${t.approvedAt} IS NOT NULL AND ${t.declinedAt} IS NULL AND ${t.canceledAt} IS NULL AND ${t.convertedAt} IS NULL) OR (${t.status} = 'declined' AND ${t.approvedAt} IS NULL AND ${t.declinedAt} IS NOT NULL AND ${t.canceledAt} IS NULL AND ${t.convertedAt} IS NULL) OR (${t.status} = 'canceled' AND ${t.declinedAt} IS NULL AND ${t.canceledAt} IS NOT NULL AND ${t.convertedAt} IS NULL) OR (${t.status} = 'converted' AND ${t.declinedAt} IS NULL AND ${t.canceledAt} IS NULL AND ${t.convertedAt} IS NOT NULL)) IS TRUE`,
    ),
  }),
);
export type PurchaseRequest = typeof purchaseRequests.$inferSelect;
export type NewPurchaseRequest = typeof purchaseRequests.$inferInsert;

export const privateOffers = pgTable(
  "private_offers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "restrict" }),
    clientContactId: uuid("client_contact_id").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    recipientEmailHash: text("recipient_email_hash").notNull(),
    targetProjectId: uuid("target_project_id"),
    productId: uuid("product_id"),
    status: privateOfferStatus("status").notNull().default("draft"),
    commercialDraft: jsonb("commercial_draft").$type<PurchaseCommercialSnapshot>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idOwnerUnique: unique("private_offers_id_owner_unique").on(
      t.id,
      t.producerId,
      t.clientContactId,
    ),
    idProjectOwnerUnique: unique("private_offers_id_project_owner_unique").on(
      t.id,
      t.targetProjectId,
      t.producerId,
      t.clientContactId,
    ),
    clientProducerFk: foreignKey({
      columns: [t.clientContactId, t.producerId],
      foreignColumns: [clientContacts.id, clientContacts.producerId],
      name: "private_offers_client_producer_fk",
    }).onDelete("restrict"),
    projectOwnerFk: foreignKey({
      columns: [t.targetProjectId, t.producerId, t.clientContactId],
      foreignColumns: [projects.id, projects.producerId, projects.clientContactId],
      name: "private_offers_project_owner_fk",
    }).onDelete("restrict"),
    productProducerFk: foreignKey({
      columns: [t.productId, t.producerId],
      foreignColumns: [products.id, products.producerId],
      name: "private_offers_product_producer_fk",
    }).onDelete("restrict"),
    producerStatusExpiryIdx: index("private_offers_producer_status_expiry_idx").on(
      t.producerId,
      t.status,
      t.expiresAt,
    ),
    recipientStatusExpiryIdx: index("private_offers_recipient_status_expiry_idx").on(
      t.recipientEmailHash,
      t.status,
      t.expiresAt,
    ),
    recipientEmailHashShape: check(
      "private_offers_recipient_email_hash_shape",
      sql`${t.recipientEmailHash} ~ '^[0-9a-f]{64}$'`,
    ),
  }),
);

export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").notNull(),
    clientContactId: uuid("client_contact_id").notNull(),
    productId: uuid("product_id"),
    privateOfferId: uuid("private_offer_id"),
    purchaseRequestId: uuid("purchase_request_id"),
    sourceKind: purchaseSourceKind("source_kind").notNull(),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    refNumber: text("ref_number").notNull().unique(),
    lifecycleStatus: purchaseLifecycleStatus("lifecycle_status")
      .notNull()
      .default("waiting_for_payment"),
    paymentPlanKind: purchasePaymentPlanKind("payment_plan_kind"),
    snapshotVersion: integer("snapshot_version").notNull().default(1),
    snapshotDigest: text("snapshot_digest").notNull(),
    commercialSnapshot: jsonb("commercial_snapshot").$type<PurchaseCommercialSnapshot>().notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    taxCents: integer("tax_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    operationUnique: unique("purchases_operation_key_unique").on(
      t.producerId,
      t.clientContactId,
      t.operationKey,
    ),
    idProducerUnique: unique("purchases_id_producer_unique").on(t.id, t.producerId),
    idProducerClientUnique: unique("purchases_id_producer_client_unique").on(
      t.id,
      t.producerId,
      t.clientContactId,
    ),
    idProjectUnique: unique("purchases_id_project_unique").on(t.id, t.projectId),
    idCurrencyUnique: unique("purchases_id_currency_unique").on(t.id, t.currency),
    idSnapshotUnique: unique("purchases_id_snapshot_unique").on(t.id, t.snapshotDigest),
    idOwnerUnique: unique("purchases_id_owner_unique").on(
      t.id,
      t.projectId,
      t.producerId,
      t.clientContactId,
    ),
    privateOfferUnique: uniqueIndex("purchases_private_offer_unique")
      .on(t.privateOfferId)
      .where(sql`${t.privateOfferId} IS NOT NULL`),
    purchaseRequestUnique: uniqueIndex("purchases_purchase_request_unique")
      .on(t.purchaseRequestId)
      .where(sql`${t.purchaseRequestId} IS NOT NULL`),
    projectOwnerFk: foreignKey({
      columns: [t.projectId, t.producerId, t.clientContactId],
      foreignColumns: [projects.id, projects.producerId, projects.clientContactId],
      name: "purchases_project_owner_fk",
    }).onDelete("restrict"),
    clientProducerFk: foreignKey({
      columns: [t.clientContactId, t.producerId],
      foreignColumns: [clientContacts.id, clientContacts.producerId],
      name: "purchases_client_producer_fk",
    }).onDelete("restrict"),
    productProducerFk: foreignKey({
      columns: [t.productId, t.producerId],
      foreignColumns: [products.id, products.producerId],
      name: "purchases_product_producer_fk",
    }).onDelete("restrict"),
    privateOfferOwnerFk: foreignKey({
      columns: [t.privateOfferId, t.producerId, t.clientContactId],
      foreignColumns: [privateOffers.id, privateOffers.producerId, privateOffers.clientContactId],
      name: "purchases_private_offer_owner_fk",
    }).onDelete("restrict"),
    privateOfferProjectOwnerFk: foreignKey({
      columns: [t.privateOfferId, t.projectId, t.producerId, t.clientContactId],
      foreignColumns: [
        privateOffers.id,
        privateOffers.targetProjectId,
        privateOffers.producerId,
        privateOffers.clientContactId,
      ],
      name: "purchases_private_offer_project_owner_fk",
    }).onDelete("restrict"),
    purchaseRequestOwnerFk: foreignKey({
      columns: [t.purchaseRequestId, t.productId, t.projectId, t.producerId, t.clientContactId],
      foreignColumns: [
        purchaseRequests.id,
        purchaseRequests.productId,
        purchaseRequests.projectId,
        purchaseRequests.producerId,
        purchaseRequests.clientContactId,
      ],
      name: "purchases_purchase_request_owner_fk",
    }).onDelete("restrict"),
    projectCreatedIdx: index("purchases_project_created_idx").on(t.projectId, t.createdAt),
    clientCreatedIdx: index("purchases_client_created_idx").on(t.clientContactId, t.createdAt),
    producerLifecycleIdx: index("purchases_producer_lifecycle_idx").on(
      t.producerId,
      t.lifecycleStatus,
      t.createdAt,
    ),
    adminActivationIdx: index("purchases_admin_activation_idx").on(
      t.producerId,
      t.createdAt,
      t.clientContactId,
    ),
    nonnegativeAmounts: check(
      "purchases_nonnegative_amounts",
      sql`${t.subtotalCents} >= 0 AND ${t.taxCents} >= 0 AND ${t.totalCents} >= 0`,
    ),
    paymentPlanShape: check(
      "purchases_payment_plan_shape",
      sql`(${t.totalCents} = 0 AND ${t.paymentPlanKind} IS NULL) OR (${t.totalCents} > 0 AND ${t.paymentPlanKind} IS NOT NULL)`,
    ),
    zeroTotalActivationShape: check(
      "purchases_zero_total_activation_shape",
      sql`(${t.totalCents} > 0 OR (${t.lifecycleStatus} IN ('active', 'canceled') AND ${t.activatedAt} = ${t.acceptedAt})) IS TRUE`,
    ),
    lifecycleTimestampShape: check(
      "purchases_lifecycle_timestamp_shape",
      sql`((${t.lifecycleStatus} = 'waiting_for_payment' AND ${t.activatedAt} IS NULL AND ${t.canceledAt} IS NULL) OR (${t.lifecycleStatus} = 'active' AND ${t.activatedAt} >= ${t.acceptedAt} AND ${t.canceledAt} IS NULL) OR (${t.lifecycleStatus} = 'canceled' AND ((${t.activatedAt} IS NULL AND ${t.canceledAt} >= ${t.acceptedAt}) OR (${t.activatedAt} >= ${t.acceptedAt} AND ${t.canceledAt} >= ${t.activatedAt})))) IS TRUE`,
    ),
    snapshotScalarConsistency: check(
      "purchases_snapshot_scalar_consistency",
      sql`((${t.commercialSnapshot}->>'version')::integer = ${t.snapshotVersion} AND (${t.commercialSnapshot}->>'subtotalCents')::integer = ${t.subtotalCents} AND (${t.commercialSnapshot}->'tax'->>'amountCents')::integer = ${t.taxCents} AND (${t.commercialSnapshot}->>'totalCents')::integer = ${t.totalCents} AND ${t.commercialSnapshot}->>'currency' = ${t.currency} AND ((${t.totalCents} = 0 AND jsonb_typeof(${t.commercialSnapshot}->'selectedPaymentPlan') = 'null') OR (${t.totalCents} > 0 AND ${t.commercialSnapshot}->'selectedPaymentPlan'->>'kind' = ${t.paymentPlanKind}::text))) IS TRUE`,
    ),
    agreementTextShape: check(
      "purchases_agreement_text_shape",
      sql`(jsonb_typeof(${t.commercialSnapshot}->'agreementText') = 'string' AND NULLIF(btrim(${t.commercialSnapshot}->>'agreementText'), '') IS NOT NULL) IS TRUE`,
    ),
    taxShape: check(
      "purchases_tax_shape",
      sql`(((${t.commercialSnapshot}->'tax'->>'ratePct')::integer BETWEEN 0 AND 100) AND ((${t.commercialSnapshot}->'tax'->>'mode' = 'tax_free' AND ${t.taxCents} = 0 AND ${t.totalCents} = ${t.subtotalCents}) OR (${t.commercialSnapshot}->'tax'->>'mode' = 'tax_included' AND ${t.totalCents} = ${t.subtotalCents} AND ${t.taxCents} = round(${t.totalCents}::numeric * (${t.commercialSnapshot}->'tax'->>'ratePct')::integer / (100 + (${t.commercialSnapshot}->'tax'->>'ratePct')::integer)::numeric)::integer) OR (${t.commercialSnapshot}->'tax'->>'mode' = 'tax_added' AND ${t.taxCents} = round(${t.subtotalCents}::numeric * (${t.commercialSnapshot}->'tax'->>'ratePct')::integer / 100::numeric)::integer AND ${t.totalCents}::bigint = ${t.subtotalCents}::bigint + ${t.taxCents}::bigint))) IS TRUE`,
    ),
    discountShape: check(
      "purchases_discount_shape",
      sql`(((${t.commercialSnapshot}->>'listSubtotalCents')::bigint >= 0) AND ((${t.commercialSnapshot}->>'discountCents')::bigint >= 0) AND (${t.commercialSnapshot}->>'listSubtotalCents')::bigint = ${t.subtotalCents}::bigint + (${t.commercialSnapshot}->>'discountCents')::bigint) IS TRUE`,
    ),
    sourceLinkShape: check(
      "purchases_source_link_shape",
      sql`(((${t.sourceKind} IN ('store_product', 'session_product')) AND ${t.productId} IS NOT NULL AND ${t.purchaseRequestId} IS NOT NULL AND ${t.privateOfferId} IS NULL) OR (${t.sourceKind} = 'private_offer' AND ${t.privateOfferId} IS NOT NULL AND ${t.purchaseRequestId} IS NULL) OR (${t.sourceKind} IN ('paid_add_on', 'no_charge_add_on') AND (${t.productId} IS NOT NULL OR ${t.privateOfferId} IS NOT NULL OR ${t.purchaseRequestId} IS NOT NULL))) IS TRUE`,
    ),
    sourceAmountShape: check(
      "purchases_source_amount_shape",
      sql`((${t.sourceKind} IN ('store_product', 'session_product', 'paid_add_on') AND ${t.totalCents} > 0) OR (${t.sourceKind} = 'no_charge_add_on' AND ${t.totalCents} = 0) OR ${t.sourceKind} = 'private_offer') IS TRUE`,
    ),
  }),
);
export type Purchase = typeof purchases.$inferSelect;
export type NewPurchase = typeof purchases.$inferInsert;

// File-first audio uploads live here until storage has verified the exact
// object. Despite the historical table name, these rows are generic upload
// intents, not Songs or Versions: destination and metadata are bound only
// when finalization succeeds.
export const firstVersionUploadIntents = pgTable(
  "first_version_upload_intents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "cascade" }),
    projectId: uuid("project_id"),
    purchaseId: uuid("purchase_id"),
    operationKey: text("operation_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    finalizationDigest: text("finalization_digest"),
    createsTrack: boolean("creates_track"),
    trackId: uuid("track_id").notNull(),
    versionId: uuid("version_id").notNull(),
    title: text("title"),
    artist: text("artist"),
    label: text("label"),
    description: text("description"),
    stagingAudioR2Key: text("staging_audio_r2_key").notNull(),
    audioR2Key: text("audio_r2_key").notNull(),
    audioContentType: text("audio_content_type").notNull(),
    audioSizeBytes: bigint("audio_size_bytes", { mode: "number" }).notNull(),
    durationMs: integer("duration_ms"),
    completionToken: text("completion_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    latestUploadUrlExpiresAt: timestamp("latest_upload_url_expires_at", { withTimezone: true }),
    // Operator-only post-cutover gate. Application code never infers or writes
    // this timestamp. Rollout must first rotate/revoke the legacy R2 signing
    // credential; only then may an operator mark exact rows and invoke the
    // explicit reconciliation path. Until then the rows remain quota-reserved
    // and hard-deletion-blocked.
    legacyUploadCapabilitiesRevokedAt: timestamp("legacy_upload_capabilities_revoked_at", {
      withTimezone: true,
    }),
    uploadUrlWriteOnceProtectedAt: timestamp("upload_url_write_once_protected_at", {
      withTimezone: true,
    }),
    stagingSealedAt: timestamp("staging_sealed_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    producerOperationUnique: unique("first_version_upload_intents_operation_unique").on(
      t.producerId,
      t.operationKey,
    ),
    versionUnique: unique("first_version_upload_intents_version_unique").on(t.versionId),
    stagingAudioKeyUnique: unique("first_version_upload_intents_staging_audio_key_unique").on(
      t.stagingAudioR2Key,
    ),
    audioKeyUnique: unique("first_version_upload_intents_audio_key_unique").on(t.audioR2Key),
    projectProducerFk: foreignKey({
      columns: [t.projectId, t.producerId],
      foreignColumns: [projects.id, projects.producerId],
      name: "first_version_upload_intents_project_producer_fk",
    }).onDelete("cascade"),
    purchaseProjectFk: foreignKey({
      columns: [t.purchaseId, t.projectId],
      foreignColumns: [purchases.id, purchases.projectId],
      name: "first_version_upload_intents_purchase_project_fk",
    }).onDelete("cascade"),
    purchaseProducerFk: foreignKey({
      columns: [t.purchaseId, t.producerId],
      foreignColumns: [purchases.id, purchases.producerId],
      name: "first_version_upload_intents_purchase_producer_fk",
    }).onDelete("cascade"),
    producerStateIdx: index("first_version_upload_intents_producer_state_idx").on(
      t.producerId,
      t.completedAt,
      t.canceledAt,
      t.expiresAt,
    ),
    trackIdx: index("first_version_upload_intents_track_idx").on(t.trackId),
    producerUnsealedIdx: index("first_version_upload_intents_producer_unsealed_idx")
      .on(t.producerId, t.expiresAt)
      .where(sql`${t.stagingSealedAt} IS NULL`),
    identityShape: check(
      "first_version_upload_intents_identity_shape",
      sql`${t.requestDigest} ~ '^sha256:[0-9a-f]{64}$' AND ${t.completionToken} ~ '^[0-9a-f]{64}$' AND NULLIF(btrim(${t.stagingAudioR2Key}), '') IS NOT NULL AND char_length(${t.stagingAudioR2Key}) <= 1024 AND NULLIF(btrim(${t.audioR2Key}), '') IS NOT NULL AND char_length(${t.audioR2Key}) <= 1024 AND ${t.stagingAudioR2Key} <> ${t.audioR2Key}`,
    ),
    contentShape: check(
      "first_version_upload_intents_content_shape",
      sql`${t.audioSizeBytes} > 0 AND ${t.audioSizeBytes} <= 524288000 AND (${t.durationMs} IS NULL OR ${t.durationMs} BETWEEN 1 AND 86400000) AND char_length(${t.title}) BETWEEN 1 AND 120 AND char_length(${t.label}) BETWEEN 1 AND 40 AND (${t.artist} IS NULL OR char_length(${t.artist}) BETWEEN 1 AND 120) AND (${t.description} IS NULL OR char_length(${t.description}) BETWEEN 1 AND 500)`,
    ),
    stateShape: check(
      "first_version_upload_intents_state_shape",
      sql`NOT (${t.canceledAt} IS NOT NULL AND ${t.completedAt} IS NOT NULL) AND ${t.expiresAt} > ${t.createdAt} AND ${t.updatedAt} >= ${t.createdAt}`,
    ),
    finalizationShape: check(
      "first_version_upload_intents_finalization_shape",
      sql`((${t.finalizationDigest} IS NULL AND ${t.createsTrack} IS NULL AND ${t.projectId} IS NULL AND ${t.purchaseId} IS NULL AND ${t.title} IS NULL AND ${t.label} IS NULL) OR (${t.finalizationDigest} ~ '^sha256:[0-9a-f]{64}$' AND ${t.createsTrack} IS NOT NULL AND ${t.projectId} IS NOT NULL AND ${t.purchaseId} IS NOT NULL AND ${t.title} IS NOT NULL AND ${t.label} IS NOT NULL)) AND (${t.completedAt} IS NULL OR ${t.finalizationDigest} IS NOT NULL)`,
    ),
    stagingSealShape: check(
      "first_version_upload_intents_staging_seal_shape",
      sql`(${t.legacyUploadCapabilitiesRevokedAt} IS NULL OR ${t.legacyUploadCapabilitiesRevokedAt} >= ${t.createdAt}) AND (${t.uploadUrlWriteOnceProtectedAt} IS NULL OR (${t.latestUploadUrlExpiresAt} IS NOT NULL AND ${t.uploadUrlWriteOnceProtectedAt} >= ${t.createdAt} AND ${t.uploadUrlWriteOnceProtectedAt} <= ${t.latestUploadUrlExpiresAt})) AND (${t.stagingSealedAt} IS NULL OR (${t.stagingSealedAt} >= ${t.createdAt} AND ((${t.latestUploadUrlExpiresAt} IS NULL AND ${t.uploadUrlWriteOnceProtectedAt} IS NULL) OR (${t.latestUploadUrlExpiresAt} IS NOT NULL AND ((${t.uploadUrlWriteOnceProtectedAt} IS NOT NULL AND ${t.stagingSealedAt} >= ${t.uploadUrlWriteOnceProtectedAt}) OR (${t.legacyUploadCapabilitiesRevokedAt} IS NOT NULL AND ${t.stagingSealedAt} >= ${t.legacyUploadCapabilitiesRevokedAt}))))))`,
    ),
  }),
);
export type FirstVersionUploadIntent = typeof firstVersionUploadIntents.$inferSelect;
export type NewFirstVersionUploadIntent = typeof firstVersionUploadIntents.$inferInsert;

export const purchaseAcceptances = pgTable(
  "purchase_acceptances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseId: uuid("purchase_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    clientContactId: uuid("client_contact_id").notNull(),
    acceptedByClerkUserId: text("accepted_by_clerk_user_id").notNull(),
    acceptedSnapshot: jsonb("accepted_snapshot").$type<PurchaseCommercialSnapshot>().notNull(),
    snapshotDigest: text("snapshot_digest").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    purchaseUnique: unique("purchase_acceptances_purchase_unique").on(t.purchaseId),
    purchaseOwnerFk: foreignKey({
      columns: [t.purchaseId, t.producerId, t.clientContactId],
      foreignColumns: [purchases.id, purchases.producerId, purchases.clientContactId],
      name: "purchase_acceptances_purchase_owner_fk",
    }).onDelete("restrict"),
    purchaseSnapshotFk: foreignKey({
      columns: [t.purchaseId, t.snapshotDigest],
      foreignColumns: [purchases.id, purchases.snapshotDigest],
      name: "purchase_acceptances_purchase_snapshot_fk",
    }).onDelete("restrict"),
  }),
);
export type PurchaseAcceptance = typeof purchaseAcceptances.$inferSelect;
export type NewPurchaseAcceptance = typeof purchaseAcceptances.$inferInsert;

export const purchaseInstallments = pgTable(
  "purchase_installments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseId: uuid("purchase_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    position: integer("position").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    dueTrigger: purchaseInstallmentDueTrigger("due_trigger").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }),
    requiredForActivation: boolean("required_for_activation").notNull().default(false),
    status: purchaseInstallmentStatus("status").notNull().default("not_paid"),
    remindersEnabled: boolean("reminders_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    purchasePositionUnique: unique("purchase_installments_purchase_position_unique").on(
      t.purchaseId,
      t.position,
    ),
    idPurchaseUnique: unique("purchase_installments_id_purchase_unique").on(t.id, t.purchaseId),
    idPurchaseCurrencyUnique: unique("purchase_installments_id_purchase_currency_unique").on(
      t.id,
      t.purchaseId,
      t.currency,
    ),
    oneActivationInstallment: uniqueIndex("purchase_installments_one_activation_required")
      .on(t.purchaseId)
      .where(sql`${t.requiredForActivation} = true`),
    purchaseProducerFk: foreignKey({
      columns: [t.purchaseId, t.producerId],
      foreignColumns: [purchases.id, purchases.producerId],
      name: "purchase_installments_purchase_producer_fk",
    }).onDelete("restrict"),
    purchaseCurrencyFk: foreignKey({
      columns: [t.purchaseId, t.currency],
      foreignColumns: [purchases.id, purchases.currency],
      name: "purchase_installments_purchase_currency_fk",
    }).onDelete("restrict"),
    dueStatusIdx: index("purchase_installments_due_status_idx").on(t.status, t.dueAt),
    positivePosition: check("purchase_installments_positive_position", sql`${t.position} > 0`),
    positiveAmount: check("purchase_installments_positive_amount", sql`${t.amountCents} > 0`),
  }),
);
export type PurchaseInstallment = typeof purchaseInstallments.$inferSelect;
export type NewPurchaseInstallment = typeof purchaseInstallments.$inferInsert;

export const paymentProofs = pgTable(
  "payment_proofs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseId: uuid("purchase_id").notNull(),
    installmentId: uuid("installment_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    projectId: uuid("project_id").notNull(),
    clientContactId: uuid("client_contact_id").notNull(),
    replacesProofId: uuid("replaces_proof_id"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    storageBucket: text("storage_bucket").$type<"docs">().notNull().default("docs"),
    storageKey: text("storage_key").notNull().unique(),
    objectEtag: text("object_etag").notNull(),
    originalFileName: text("original_file_name"),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: paymentProofStatus("status").notNull().default("pending"),
    note: text("note"),
    rejectionNote: text("rejection_note"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idPurchaseInstallmentProducerUnique: unique(
      "payment_proofs_id_purchase_installment_producer_unique",
    ).on(t.id, t.purchaseId, t.installmentId, t.producerId),
    idPurchaseInstallmentProducerCurrencyUnique: unique(
      "payment_proofs_id_purchase_installment_producer_currency_unique",
    ).on(t.id, t.purchaseId, t.installmentId, t.producerId, t.currency),
    purchaseOwnerFk: foreignKey({
      columns: [t.purchaseId, t.projectId, t.producerId, t.clientContactId],
      foreignColumns: [
        purchases.id,
        purchases.projectId,
        purchases.producerId,
        purchases.clientContactId,
      ],
      name: "payment_proofs_purchase_owner_fk",
    }).onDelete("restrict"),
    installmentPurchaseFk: foreignKey({
      columns: [t.installmentId, t.purchaseId, t.currency],
      foreignColumns: [
        purchaseInstallments.id,
        purchaseInstallments.purchaseId,
        purchaseInstallments.currency,
      ],
      name: "payment_proofs_installment_purchase_currency_fk",
    }).onDelete("restrict"),
    replacementIdentityFk: foreignKey({
      columns: [t.replacesProofId, t.purchaseId, t.installmentId, t.producerId],
      foreignColumns: [t.id, t.purchaseId, t.installmentId, t.producerId],
      name: "payment_proofs_replacement_identity_fk",
    }).onDelete("restrict"),
    pendingPerInstallment: uniqueIndex("payment_proofs_one_pending_per_installment")
      .on(t.installmentId)
      .where(sql`${t.status} = 'pending'`),
    replacementUnique: uniqueIndex("payment_proofs_replaces_proof_unique")
      .on(t.replacesProofId)
      .where(sql`${t.replacesProofId} IS NOT NULL`),
    producerStatusCreatedIdx: index("payment_proofs_producer_status_created_idx").on(
      t.producerId,
      t.status,
      t.createdAt,
    ),
    adminClientActivityIdx: index("payment_proofs_admin_client_activity_idx").on(
      t.clientContactId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    positiveAmount: check("payment_proofs_positive_amount", sql`${t.amountCents} > 0`),
    nonnegativeSize: check("payment_proofs_nonnegative_size", sql`${t.sizeBytes} >= 0`),
    privateBucketOnly: check(
      "payment_proofs_private_bucket_only",
      sql`${t.storageBucket} = 'docs'`,
    ),
    doesNotReplaceSelf: check(
      "payment_proofs_does_not_replace_self",
      sql`${t.replacesProofId} IS NULL OR ${t.replacesProofId} <> ${t.id}`,
    ),
    statusShape: check(
      "payment_proofs_status_shape",
      sql`(${t.status} = 'pending' AND ${t.confirmedAt} IS NULL AND ${t.rejectedAt} IS NULL AND ${t.rejectionNote} IS NULL) OR (${t.status} = 'confirmed' AND ${t.confirmedAt} IS NOT NULL AND ${t.rejectedAt} IS NULL AND ${t.rejectionNote} IS NULL) OR (${t.status} = 'rejected' AND ${t.confirmedAt} IS NULL AND ${t.rejectedAt} IS NOT NULL AND NULLIF(btrim(${t.rejectionNote}), '') IS NOT NULL)`,
    ),
  }),
);
export type PaymentProof = typeof paymentProofs.$inferSelect;
export type NewPaymentProof = typeof paymentProofs.$inferInsert;

export const purchasePayments = pgTable(
  "purchase_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseId: uuid("purchase_id").notNull(),
    installmentId: uuid("installment_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    proofId: uuid("proof_id"),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    source: purchasePaymentSource("source").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    addedByClerkUserId: text("added_by_clerk_user_id").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idPurchaseUnique: unique("purchase_payments_id_purchase_unique").on(t.id, t.purchaseId),
    operationUnique: unique("purchase_payments_operation_key_unique").on(
      t.purchaseId,
      t.operationKey,
    ),
    proofUnique: uniqueIndex("purchase_payments_proof_unique")
      .on(t.proofId)
      .where(sql`${t.proofId} IS NOT NULL`),
    purchaseProducerFk: foreignKey({
      columns: [t.purchaseId, t.producerId],
      foreignColumns: [purchases.id, purchases.producerId],
      name: "purchase_payments_purchase_producer_fk",
    }).onDelete("restrict"),
    installmentPurchaseFk: foreignKey({
      columns: [t.installmentId, t.purchaseId, t.currency],
      foreignColumns: [
        purchaseInstallments.id,
        purchaseInstallments.purchaseId,
        purchaseInstallments.currency,
      ],
      name: "purchase_payments_installment_purchase_currency_fk",
    }).onDelete("restrict"),
    proofPurchaseInstallmentFk: foreignKey({
      columns: [t.proofId, t.purchaseId, t.installmentId, t.producerId, t.currency],
      foreignColumns: [
        paymentProofs.id,
        paymentProofs.purchaseId,
        paymentProofs.installmentId,
        paymentProofs.producerId,
        paymentProofs.currency,
      ],
      name: "purchase_payments_proof_purchase_installment_currency_fk",
    }).onDelete("restrict"),
    purchasePaidIdx: index("purchase_payments_purchase_paid_idx").on(t.purchaseId, t.paidAt),
    positiveAmount: check("purchase_payments_positive_amount", sql`${t.amountCents} > 0`),
    sourceProofConsistency: check(
      "purchase_payments_source_proof_consistency",
      sql`${t.source} = 'manual' OR (${t.source} = 'proof' AND ${t.proofId} IS NOT NULL)`,
    ),
  }),
);
export type PurchasePayment = typeof purchasePayments.$inferSelect;
export type NewPurchasePayment = typeof purchasePayments.$inferInsert;

export const purchasePaymentCorrections = pgTable(
  "purchase_payment_corrections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseId: uuid("purchase_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    sequence: integer("sequence").notNull(),
    previousAmountCents: integer("previous_amount_cents").notNull(),
    newAmountCents: integer("new_amount_cents").notNull(),
    reason: text("reason").notNull(),
    correctedByClerkUserId: text("corrected_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    operationUnique: unique("purchase_payment_corrections_operation_key_unique").on(
      t.purchaseId,
      t.operationKey,
    ),
    paymentSequenceUnique: unique("purchase_payment_corrections_payment_sequence_unique").on(
      t.paymentId,
      t.sequence,
    ),
    paymentPurchaseFk: foreignKey({
      columns: [t.paymentId, t.purchaseId],
      foreignColumns: [purchasePayments.id, purchasePayments.purchaseId],
      name: "purchase_payment_corrections_payment_purchase_fk",
    }).onDelete("restrict"),
    purchaseProducerFk: foreignKey({
      columns: [t.purchaseId, t.producerId],
      foreignColumns: [purchases.id, purchases.producerId],
      name: "purchase_payment_corrections_purchase_producer_fk",
    }).onDelete("restrict"),
    purchaseCreatedIdx: index("purchase_payment_corrections_purchase_created_idx").on(
      t.purchaseId,
      t.createdAt,
      t.id,
    ),
    operationShape: check(
      "purchase_payment_corrections_operation_shape",
      sql`NULLIF(btrim(${t.operationKey}), '') IS NOT NULL AND NULLIF(btrim(${t.operationDigest}), '') IS NOT NULL`,
    ),
    reasonShape: check(
      "purchase_payment_corrections_reason_shape",
      sql`NULLIF(btrim(${t.reason}), '') IS NOT NULL`,
    ),
    amountChanged: check(
      "purchase_payment_corrections_amount_changed",
      sql`${t.previousAmountCents} <> ${t.newAmountCents}`,
    ),
    positiveSequence: check(
      "purchase_payment_corrections_positive_sequence",
      sql`${t.sequence} > 0`,
    ),
    nonnegativeAmounts: check(
      "purchase_payment_corrections_nonnegative_amounts",
      sql`${t.previousAmountCents} >= 0 AND ${t.newAmountCents} >= 0`,
    ),
  }),
);
export type PurchasePaymentCorrection = typeof purchasePaymentCorrections.$inferSelect;
export type NewPurchasePaymentCorrection = typeof purchasePaymentCorrections.$inferInsert;

export const purchaseWaivers = pgTable(
  "purchase_waivers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseId: uuid("purchase_id").notNull(),
    installmentId: uuid("installment_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason").notNull(),
    waivedByClerkUserId: text("waived_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    operationUnique: unique("purchase_waivers_operation_key_unique").on(
      t.purchaseId,
      t.operationKey,
    ),
    installmentPurchaseFk: foreignKey({
      columns: [t.installmentId, t.purchaseId],
      foreignColumns: [purchaseInstallments.id, purchaseInstallments.purchaseId],
      name: "purchase_waivers_installment_purchase_fk",
    }).onDelete("restrict"),
    purchaseProducerFk: foreignKey({
      columns: [t.purchaseId, t.producerId],
      foreignColumns: [purchases.id, purchases.producerId],
      name: "purchase_waivers_purchase_producer_fk",
    }).onDelete("restrict"),
    purchaseCreatedIdx: index("purchase_waivers_purchase_created_idx").on(
      t.purchaseId,
      t.createdAt,
      t.id,
    ),
    operationShape: check(
      "purchase_waivers_operation_shape",
      sql`NULLIF(btrim(${t.operationKey}), '') IS NOT NULL AND NULLIF(btrim(${t.operationDigest}), '') IS NOT NULL`,
    ),
    reasonShape: check(
      "purchase_waivers_reason_shape",
      sql`NULLIF(btrim(${t.reason}), '') IS NOT NULL`,
    ),
    positiveAmount: check("purchase_waivers_positive_amount", sql`${t.amountCents} > 0`),
  }),
);
export type PurchaseWaiver = typeof purchaseWaivers.$inferSelect;
export type NewPurchaseWaiver = typeof purchaseWaivers.$inferInsert;

export const purchaseCancellations = pgTable(
  "purchase_cancellations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseId: uuid("purchase_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    reason: text("reason").notNull(),
    canceledByClerkUserId: text("canceled_by_clerk_user_id").notNull(),
    canceledAt: timestamp("canceled_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    purchaseUnique: unique("purchase_cancellations_purchase_unique").on(t.purchaseId),
    operationUnique: unique("purchase_cancellations_operation_key_unique").on(
      t.purchaseId,
      t.operationKey,
    ),
    purchaseProducerFk: foreignKey({
      columns: [t.purchaseId, t.producerId],
      foreignColumns: [purchases.id, purchases.producerId],
      name: "purchase_cancellations_purchase_producer_fk",
    }).onDelete("restrict"),
    operationShape: check(
      "purchase_cancellations_operation_shape",
      sql`NULLIF(btrim(${t.operationKey}), '') IS NOT NULL AND NULLIF(btrim(${t.operationDigest}), '') IS NOT NULL`,
    ),
    reasonShape: check(
      "purchase_cancellations_reason_shape",
      sql`NULLIF(btrim(${t.reason}), '') IS NOT NULL`,
    ),
  }),
);
export type PurchaseCancellation = typeof purchaseCancellations.$inferSelect;
export type NewPurchaseCancellation = typeof purchaseCancellations.$inferInsert;

export type PurchaseReminderMessageSnapshot = {
  to: string;
  props: {
    artistName: string;
    producerName: string;
    purchaseName: string;
    refNumber: string;
    currency: string;
    amountCents: number;
    dueAt: string;
    producerTimezone: string;
    paymentUrl: string;
  };
};

// Durable reservation/outbox for reminder delivery. A row is committed before
// email I/O. A stable provider idempotency key makes a stale-claim retry safe
// during the provider's 24-hour dedupe window; once that window expires the
// row becomes dedupe_expired and requires an explicit new reminder operation.
export const purchaseReminderDeliveries = pgTable(
  "purchase_reminder_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseId: uuid("purchase_id").notNull(),
    installmentId: uuid("installment_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    kind: purchaseReminderKind("kind").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    amountDueCents: integer("amount_due_cents").notNull(),
    currency: text("currency").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    messageSnapshot: jsonb("message_snapshot").$type<PurchaseReminderMessageSnapshot>().notNull(),
    sentByClerkUserId: text("sent_by_clerk_user_id"),
    providerIdempotencyKey: text("provider_idempotency_key").notNull(),
    status: purchaseReminderDeliveryStatus("status").notNull().default("reserved"),
    claimToken: text("claim_token"),
    claimUntil: timestamp("claim_until", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    providerDedupeExpiresAt: timestamp("provider_dedupe_expires_at", { withTimezone: true }),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    operationUnique: unique("purchase_reminder_deliveries_operation_key_unique").on(
      t.purchaseId,
      t.operationKey,
    ),
    providerIdempotencyUnique: unique(
      "purchase_reminder_deliveries_provider_idempotency_unique",
    ).on(t.providerIdempotencyKey),
    automaticOccurrenceUnique: uniqueIndex(
      "purchase_reminder_deliveries_automatic_occurrence_unique",
    )
      .on(t.installmentId, t.kind, t.scheduledFor)
      .where(sql`${t.kind} <> 'manual'`),
    purchaseProducerFk: foreignKey({
      columns: [t.purchaseId, t.producerId],
      foreignColumns: [purchases.id, purchases.producerId],
      name: "purchase_reminder_deliveries_purchase_producer_fk",
    }).onDelete("restrict"),
    installmentPurchaseCurrencyFk: foreignKey({
      columns: [t.installmentId, t.purchaseId, t.currency],
      foreignColumns: [
        purchaseInstallments.id,
        purchaseInstallments.purchaseId,
        purchaseInstallments.currency,
      ],
      name: "purchase_reminder_deliveries_installment_purchase_currency_fk",
    }).onDelete("restrict"),
    claimIdx: index("purchase_reminder_deliveries_claim_idx").on(t.status, t.claimUntil, t.id),
    producerUpdatedIdx: index("purchase_reminder_deliveries_producer_updated_idx").on(
      t.producerId,
      t.updatedAt,
      t.id,
    ),
    positiveAmount: check(
      "purchase_reminder_deliveries_positive_amount",
      sql`${t.amountDueCents} > 0`,
    ),
    operationShape: check(
      "purchase_reminder_deliveries_operation_shape",
      sql`NULLIF(btrim(${t.operationKey}), '') IS NOT NULL AND NULLIF(btrim(${t.operationDigest}), '') IS NOT NULL AND NULLIF(btrim(${t.providerIdempotencyKey}), '') IS NOT NULL`,
    ),
    actorShape: check(
      "purchase_reminder_deliveries_actor_shape",
      sql`((${t.kind} = 'manual' AND NULLIF(btrim(${t.sentByClerkUserId}), '') IS NOT NULL) OR (${t.kind} <> 'manual' AND ${t.sentByClerkUserId} IS NULL)) IS TRUE`,
    ),
    snapshotShape: check(
      "purchase_reminder_deliveries_snapshot_shape",
      sql`(NULLIF(btrim(${t.currency}), '') IS NOT NULL AND NULLIF(btrim(${t.recipientEmail}), '') IS NOT NULL AND char_length(${t.providerIdempotencyKey}) <= 256 AND ${t.messageSnapshot}->>'to' = ${t.recipientEmail} AND ${t.messageSnapshot}->'props'->>'currency' = ${t.currency} AND (${t.messageSnapshot}->'props'->>'amountCents')::integer = ${t.amountDueCents}) IS TRUE`,
    ),
    attemptShape: check(
      "purchase_reminder_deliveries_attempt_shape",
      sql`((${t.attemptCount} = 0 AND ${t.firstAttemptAt} IS NULL AND ${t.lastAttemptAt} IS NULL AND ${t.providerDedupeExpiresAt} IS NULL) OR (${t.attemptCount} > 0 AND ${t.firstAttemptAt} IS NOT NULL AND ${t.lastAttemptAt} IS NOT NULL AND ${t.providerDedupeExpiresAt} IS NOT NULL)) IS TRUE`,
    ),
    stateShape: check(
      "purchase_reminder_deliveries_state_shape",
      sql`((${t.status} = 'reserved' AND ${t.claimToken} IS NULL AND ${t.claimUntil} IS NULL AND ${t.providerMessageId} IS NULL AND ${t.sentAt} IS NULL) OR (${t.status} = 'sending' AND NULLIF(btrim(${t.claimToken}), '') IS NOT NULL AND ${t.claimUntil} IS NOT NULL AND ${t.attemptCount} > 0 AND ${t.providerMessageId} IS NULL AND ${t.sentAt} IS NULL) OR (${t.status} = 'sent' AND ${t.claimToken} IS NULL AND ${t.claimUntil} IS NULL AND NULLIF(btrim(${t.providerMessageId}), '') IS NOT NULL AND ${t.sentAt} IS NOT NULL) OR (${t.status} = 'reservation_expired' AND ${t.claimToken} IS NULL AND ${t.claimUntil} IS NULL AND ${t.attemptCount} = 0 AND ${t.providerMessageId} IS NULL AND ${t.sentAt} IS NULL) OR (${t.status} = 'dedupe_expired' AND ${t.claimToken} IS NULL AND ${t.claimUntil} IS NULL AND ${t.attemptCount} > 0 AND ${t.providerMessageId} IS NULL AND ${t.sentAt} IS NULL)) IS TRUE`,
    ),
  }),
);
export type PurchaseReminderDelivery = typeof purchaseReminderDeliveries.$inferSelect;
export type NewPurchaseReminderDelivery = typeof purchaseReminderDeliveries.$inferInsert;

// One immutable row per successfully sent payment reminder. Automatic rows
// are uniquely keyed by their deterministic schedule occurrence; manual rows
// use the caller's operation key. The amount/currency/recipient snapshot makes
// the delivery log useful even after the live balance or contact changes.
export const purchaseReminderLogs = pgTable(
  "purchase_reminder_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseId: uuid("purchase_id").notNull(),
    installmentId: uuid("installment_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    kind: purchaseReminderKind("kind").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    amountDueCents: integer("amount_due_cents").notNull(),
    currency: text("currency").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    sentByClerkUserId: text("sent_by_clerk_user_id"),
    providerMessageId: text("provider_message_id").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    operationUnique: unique("purchase_reminder_logs_operation_key_unique").on(
      t.purchaseId,
      t.operationKey,
    ),
    automaticOccurrenceUnique: uniqueIndex("purchase_reminder_logs_automatic_occurrence_unique")
      .on(t.installmentId, t.kind, t.scheduledFor)
      .where(sql`${t.kind} <> 'manual'`),
    purchaseProducerFk: foreignKey({
      columns: [t.purchaseId, t.producerId],
      foreignColumns: [purchases.id, purchases.producerId],
      name: "purchase_reminder_logs_purchase_producer_fk",
    }).onDelete("restrict"),
    installmentPurchaseCurrencyFk: foreignKey({
      columns: [t.installmentId, t.purchaseId, t.currency],
      foreignColumns: [
        purchaseInstallments.id,
        purchaseInstallments.purchaseId,
        purchaseInstallments.currency,
      ],
      name: "purchase_reminder_logs_installment_purchase_currency_fk",
    }).onDelete("restrict"),
    deliveryOperationFk: foreignKey({
      columns: [t.purchaseId, t.operationKey],
      foreignColumns: [
        purchaseReminderDeliveries.purchaseId,
        purchaseReminderDeliveries.operationKey,
      ],
      name: "purchase_reminder_logs_delivery_operation_fk",
    }).onDelete("restrict"),
    producerSentIdx: index("purchase_reminder_logs_producer_sent_idx").on(
      t.producerId,
      t.sentAt,
      t.id,
    ),
    installmentSentIdx: index("purchase_reminder_logs_installment_sent_idx").on(
      t.installmentId,
      t.sentAt,
      t.id,
    ),
    positiveAmount: check("purchase_reminder_logs_positive_amount", sql`${t.amountDueCents} > 0`),
    operationShape: check(
      "purchase_reminder_logs_operation_shape",
      sql`NULLIF(btrim(${t.operationKey}), '') IS NOT NULL AND NULLIF(btrim(${t.operationDigest}), '') IS NOT NULL`,
    ),
    deliveryShape: check(
      "purchase_reminder_logs_delivery_shape",
      sql`NULLIF(btrim(${t.currency}), '') IS NOT NULL AND NULLIF(btrim(${t.recipientEmail}), '') IS NOT NULL AND NULLIF(btrim(${t.providerMessageId}), '') IS NOT NULL`,
    ),
    actorShape: check(
      "purchase_reminder_logs_actor_shape",
      sql`((${t.kind} = 'manual' AND NULLIF(btrim(${t.sentByClerkUserId}), '') IS NOT NULL) OR (${t.kind} <> 'manual' AND ${t.sentByClerkUserId} IS NULL)) IS TRUE`,
    ),
  }),
);
export type PurchaseReminderLog = typeof purchaseReminderLogs.$inferSelect;
export type NewPurchaseReminderLog = typeof purchaseReminderLogs.$inferInsert;

// Audits producer-controlled pause/resume commands caused by overdue money.
// Current state remains on projects.lifecycleStatus; this is immutable history.
export const projectPaymentPauseEvents = pgTable(
  "project_payment_pause_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseId: uuid("purchase_id").notNull(),
    projectId: uuid("project_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    action: projectPaymentPauseAction("action").notNull(),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    reason: text("reason").notNull(),
    changedByClerkUserId: text("changed_by_clerk_user_id").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    operationUnique: unique("project_payment_pause_events_operation_key_unique").on(
      t.projectId,
      t.operationKey,
    ),
    projectProducerFk: foreignKey({
      columns: [t.projectId, t.producerId],
      foreignColumns: [projects.id, projects.producerId],
      name: "project_payment_pause_events_project_producer_fk",
    }).onDelete("restrict"),
    purchaseProjectFk: foreignKey({
      columns: [t.purchaseId, t.projectId],
      foreignColumns: [purchases.id, purchases.projectId],
      name: "project_payment_pause_events_purchase_project_fk",
    }).onDelete("restrict"),
    projectChangedIdx: index("project_payment_pause_events_project_changed_idx").on(
      t.projectId,
      t.changedAt,
      t.id,
    ),
    purchaseChangedIdx: index("project_payment_pause_events_purchase_changed_idx").on(
      t.purchaseId,
      t.changedAt,
      t.id,
    ),
    operationShape: check(
      "project_payment_pause_events_operation_shape",
      sql`NULLIF(btrim(${t.operationKey}), '') IS NOT NULL AND NULLIF(btrim(${t.operationDigest}), '') IS NOT NULL`,
    ),
    reasonShape: check(
      "project_payment_pause_events_reason_shape",
      sql`NULLIF(btrim(${t.reason}), '') IS NOT NULL`,
    ),
    actorShape: check(
      "project_payment_pause_events_actor_shape",
      sql`NULLIF(btrim(${t.changedByClerkUserId}), '') IS NOT NULL`,
    ),
  }),
);
export type ProjectPaymentPauseEvent = typeof projectPaymentPauseEvents.$inferSelect;
export type NewProjectPaymentPauseEvent = typeof projectPaymentPauseEvents.$inferInsert;

export const purchaseSessionAllowances = pgTable(
  "purchase_session_allowances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseId: uuid("purchase_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    bookingEnabledSnapshot: boolean("booking_enabled_snapshot").notNull().default(false),
    kind: sessionAllowanceKind("kind").notNull(),
    sessionLimit: integer("session_limit"),
    durationMin: integer("duration_min").notNull(),
    locationType: text("location_type").notNull(),
    bufferMinutes: integer("buffer_minutes").notNull(),
    minLeadHours: integer("min_lead_hours").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closeReason: sessionAllowanceCloseReason("close_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    purchaseUnique: unique("purchase_session_allowances_purchase_unique").on(t.purchaseId),
    idPurchaseUnique: unique("purchase_session_allowances_id_purchase_unique").on(
      t.id,
      t.purchaseId,
    ),
    purchaseProducerFk: foreignKey({
      columns: [t.purchaseId, t.producerId],
      foreignColumns: [purchases.id, purchases.producerId],
      name: "purchase_session_allowances_purchase_producer_fk",
    }).onDelete("restrict"),
    limitShape: check(
      "purchase_session_allowances_limit_shape",
      sql`((${t.kind} = 'fixed' AND ${t.sessionLimit} > 0) OR (${t.kind} = 'unlimited' AND ${t.sessionLimit} IS NULL)) IS TRUE`,
    ),
    closeShape: check(
      "purchase_session_allowances_close_shape",
      sql`(${t.closedAt} IS NULL AND ${t.closeReason} IS NULL) OR (${t.closedAt} IS NOT NULL AND ${t.closeReason} IS NOT NULL)`,
    ),
    termsShape: check(
      "purchase_session_allowances_terms_shape",
      sql`${t.durationMin} > 0 AND ${t.bufferMinutes} >= 0 AND ${t.minLeadHours} >= 0 AND NULLIF(btrim(${t.locationType}), '') IS NOT NULL`,
    ),
  }),
);
export type PurchaseSessionAllowance = typeof purchaseSessionAllowances.$inferSelect;
export type NewPurchaseSessionAllowance = typeof purchaseSessionAllowances.$inferInsert;

export const purchaseDownloadOverrideEvents = pgTable(
  "purchase_download_override_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseId: uuid("purchase_id").notNull(),
    versionId: uuid("version_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    enabled: boolean("enabled").notNull(),
    sequence: integer("sequence").notNull(),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    changedByClerkUserId: text("changed_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    purchaseProducerFk: foreignKey({
      columns: [t.purchaseId, t.producerId],
      foreignColumns: [purchases.id, purchases.producerId],
      name: "purchase_download_overrides_purchase_producer_fk",
    }).onDelete("restrict"),
    versionPurchaseFk: foreignKey({
      columns: [t.versionId, t.purchaseId],
      foreignColumns: [trackVersions.id, trackVersions.purchaseId],
      name: "purchase_download_overrides_version_purchase_fk",
    }).onDelete("restrict"),
    purchaseVersionSequenceUnique: unique(
      "purchase_download_overrides_purchase_version_sequence_unique",
    ).on(t.purchaseId, t.versionId, t.sequence),
    operationKeyUnique: unique("purchase_download_overrides_operation_key_unique").on(
      t.purchaseId,
      t.operationKey,
    ),
    positiveSequence: check(
      "purchase_download_overrides_positive_sequence",
      sql`${t.sequence} > 0`,
    ),
    operationShape: check(
      "purchase_download_overrides_operation_shape",
      sql`NULLIF(btrim(${t.operationKey}), '') IS NOT NULL AND NULLIF(btrim(${t.operationDigest}), '') IS NOT NULL`,
    ),
    actorShape: check(
      "purchase_download_overrides_actor_shape",
      sql`NULLIF(btrim(${t.changedByClerkUserId}), '') IS NOT NULL`,
    ),
    purchaseVersionSequenceIdx: index("purchase_download_overrides_version_sequence_idx").on(
      t.purchaseId,
      t.versionId,
      t.sequence,
    ),
  }),
);
export type PurchaseDownloadOverrideEvent = typeof purchaseDownloadOverrideEvents.$inferSelect;
export type NewPurchaseDownloadOverrideEvent = typeof purchaseDownloadOverrideEvents.$inferInsert;

export const versionApprovalEvents = pgTable(
  "version_approval_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    versionId: uuid("version_id").notNull(),
    purchaseId: uuid("purchase_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    clientContactId: uuid("client_contact_id").notNull(),
    audioIdentityFingerprint: text("audio_identity_fingerprint").notNull(),
    action: versionApprovalAction("action").notNull(),
    actedByClerkUserId: text("acted_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    versionPurchaseFk: foreignKey({
      columns: [t.versionId, t.purchaseId],
      foreignColumns: [trackVersions.id, trackVersions.purchaseId],
      name: "version_approval_events_version_purchase_fk",
    }).onDelete("restrict"),
    audioIdentityFk: foreignKey({
      columns: [t.versionId, t.purchaseId, t.audioIdentityFingerprint],
      foreignColumns: [
        trackVersions.id,
        trackVersions.purchaseId,
        trackVersions.audioIdentityFingerprint,
      ],
      name: "version_approval_events_audio_identity_fk",
    }).onDelete("restrict"),
    purchaseOwnerFk: foreignKey({
      columns: [t.purchaseId, t.producerId, t.clientContactId],
      foreignColumns: [purchases.id, purchases.producerId, purchases.clientContactId],
      name: "version_approval_events_purchase_owner_fk",
    }).onDelete("restrict"),
    versionCreatedIdx: index("version_approval_events_version_created_idx").on(
      t.versionId,
      t.createdAt,
    ),
  }),
);

export const songPublicLinks = pgTable(
  "song_public_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackId: uuid("track_id").notNull(),
    purchaseId: uuid("purchase_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenVersion: integer("token_version").notNull().default(1),
    enabledAt: timestamp("enabled_at", { withTimezone: true }).notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    trackUnique: unique("song_public_links_track_unique").on(t.trackId),
    exactScopeUnique: unique("song_public_links_exact_scope_unique").on(
      t.id,
      t.trackId,
      t.purchaseId,
      t.producerId,
    ),
    trackPurchaseFk: foreignKey({
      columns: [t.trackId, t.purchaseId],
      foreignColumns: [projectTracks.id, projectTracks.purchaseId],
      name: "song_public_links_track_purchase_fk",
    }).onDelete("restrict"),
    purchaseProducerFk: foreignKey({
      columns: [t.purchaseId, t.producerId],
      foreignColumns: [purchases.id, purchases.producerId],
      name: "song_public_links_purchase_producer_fk",
    }).onDelete("restrict"),
    positiveTokenVersion: check(
      "song_public_links_positive_token_version",
      sql`${t.tokenVersion} > 0`,
    ),
    tokenHashShape: check(
      "song_public_links_token_hash_shape",
      sql`${t.tokenHash} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    timestampShape: check(
      "song_public_links_timestamp_shape",
      sql`${t.updatedAt} >= ${t.enabledAt} AND (${t.disabledAt} IS NULL OR (${t.disabledAt} >= ${t.enabledAt} AND ${t.updatedAt} >= ${t.disabledAt}))`,
    ),
  }),
);

export const songPublicAccessEvents = pgTable(
  "song_public_access_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackId: uuid("track_id").notNull(),
    purchaseId: uuid("purchase_id").notNull(),
    producerId: uuid("producer_id").notNull(),
    linkId: uuid("link_id"),
    versionId: uuid("version_id"),
    action: text("action").notNull(),
    sequence: integer("sequence").notNull(),
    tokenVersion: integer("token_version"),
    tokenHash: text("token_hash"),
    changed: boolean("changed").notNull().default(false),
    linkEnabled: boolean("link_enabled").notNull(),
    portfolioPublished: boolean("portfolio_published").notNull(),
    remainingAudioCount: integer("remaining_audio_count").notNull(),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    changedByClerkUserId: text("changed_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    trackSequenceUnique: unique("song_public_access_events_track_sequence_unique").on(
      t.trackId,
      t.sequence,
    ),
    trackOperationUnique: unique("song_public_access_events_track_operation_unique").on(
      t.trackId,
      t.operationKey,
    ),
    trackPurchaseFk: foreignKey({
      columns: [t.trackId, t.purchaseId],
      foreignColumns: [projectTracks.id, projectTracks.purchaseId],
      name: "song_public_access_events_track_purchase_fk",
    }).onDelete("restrict"),
    purchaseProducerFk: foreignKey({
      columns: [t.purchaseId, t.producerId],
      foreignColumns: [purchases.id, purchases.producerId],
      name: "song_public_access_events_purchase_producer_fk",
    }).onDelete("restrict"),
    linkScopeFk: foreignKey({
      columns: [t.linkId, t.trackId, t.purchaseId, t.producerId],
      foreignColumns: [
        songPublicLinks.id,
        songPublicLinks.trackId,
        songPublicLinks.purchaseId,
        songPublicLinks.producerId,
      ],
      name: "song_public_access_events_link_scope_fk",
    }).onDelete("restrict"),
    versionScopeFk: foreignKey({
      columns: [t.versionId, t.trackId, t.purchaseId, t.producerId],
      foreignColumns: [
        trackVersions.id,
        trackVersions.trackId,
        trackVersions.purchaseId,
        trackVersions.producerId,
      ],
      name: "song_public_access_events_version_scope_fk",
    }).onDelete("restrict"),
    actionShape: check(
      "song_public_access_events_action_shape",
      sql`${t.action} IN ('link_published', 'link_reset', 'link_disabled', 'audio_deleted', 'portfolio_published', 'portfolio_unpublished')`,
    ),
    positiveSequence: check("song_public_access_events_positive_sequence", sql`${t.sequence} > 0`),
    tokenSnapshotShape: check(
      "song_public_access_events_token_snapshot_shape",
      sql`(${t.tokenVersion} IS NULL AND ${t.tokenHash} IS NULL) OR (${t.tokenVersion} > 0 AND ${t.tokenHash} ~ '^sha256:[0-9a-f]{64}$')`,
    ),
    linkSnapshotShape: check(
      "song_public_access_events_link_snapshot_shape",
      sql`(${t.linkId} IS NULL AND ${t.tokenVersion} IS NULL AND ${t.tokenHash} IS NULL AND ${t.linkEnabled} = false) OR (${t.linkId} IS NOT NULL AND ${t.tokenVersion} IS NOT NULL AND ${t.tokenHash} IS NOT NULL)`,
    ),
    targetShape: check(
      "song_public_access_events_target_shape",
      sql`((${t.action} IN ('link_published', 'link_reset', 'link_disabled') AND ${t.linkId} IS NOT NULL AND ${t.versionId} IS NULL) OR (${t.action} = 'audio_deleted' AND ${t.versionId} IS NOT NULL) OR (${t.action} IN ('portfolio_published', 'portfolio_unpublished') AND ${t.versionId} IS NULL))`,
    ),
    nonnegativeRemainingAudio: check(
      "song_public_access_events_remaining_audio_nonnegative",
      sql`${t.remainingAudioCount} >= 0`,
    ),
    operationShape: check(
      "song_public_access_events_operation_shape",
      sql`NULLIF(btrim(${t.operationKey}), '') IS NOT NULL AND NULLIF(btrim(${t.operationDigest}), '') IS NOT NULL`,
    ),
    actorShape: check(
      "song_public_access_events_actor_shape",
      sql`NULLIF(btrim(${t.changedByClerkUserId}), '') IS NOT NULL`,
    ),
    trackSequenceIdx: index("song_public_access_events_track_sequence_idx").on(
      t.trackId,
      t.sequence,
    ),
  }),
);
export type SongPublicAccessEvent = typeof songPublicAccessEvents.$inferSelect;
export type NewSongPublicAccessEvent = typeof songPublicAccessEvents.$inferInsert;

// Durable recovery receipt for a producer-authorized hard delete. Target Song
// and Version ids intentionally have no FK: the receipt must survive the
// history rows it removes so retries can prove the exact R2 objects were
// already deleted and return the committed result idempotently.
export type SongDeletionAudioManifestItem = Readonly<{
  versionId: string;
  key: string;
  objectEtag: string;
  sizeBytes: number;
  fingerprint: string;
}>;

export type SongDeletionArtworkManifestItem = Readonly<{
  key: string;
  contentType: string;
  sizeBytes: number;
  objectEtag: string;
}>;

export type SongDeletionFirstVersionStagingManifestItem = Readonly<{
  versionId: string;
  key: string;
  contentType: string;
  sizeBytes: number;
  completionToken: string;
}>;

export type SongDeletionFirstVersionFinalManifestItem = Readonly<{
  versionId: string;
  key: string;
  contentType: string;
  sizeBytes: number;
  completionToken: string;
}>;

export type SongDeletionPeaksManifestItem = Readonly<{
  versionId: string;
  key: string;
}>;

export const songDeletionOperations = pgTable(
  "song_deletion_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "cascade" }),
    operationKey: text("operation_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    kind: text("kind").$type<"version" | "song">().notNull(),
    projectId: uuid("project_id").notNull(),
    purchaseId: uuid("purchase_id").notNull(),
    trackId: uuid("track_id").notNull(),
    versionId: uuid("version_id"),
    targetVersionIds: jsonb("target_version_ids").$type<string[]>().notNull(),
    actorClerkUserId: text("actor_clerk_user_id").notNull(),
    audioManifest: jsonb("audio_manifest").$type<SongDeletionAudioManifestItem[]>().notNull(),
    artworkManifest: jsonb("artwork_manifest")
      .$type<SongDeletionArtworkManifestItem[]>()
      .default([])
      .notNull(),
    firstVersionStagingManifest: jsonb("first_version_staging_manifest")
      .$type<SongDeletionFirstVersionStagingManifestItem[]>()
      .default([])
      .notNull(),
    firstVersionFinalManifest: jsonb("first_version_final_manifest")
      .$type<SongDeletionFirstVersionFinalManifestItem[]>()
      .default([])
      .notNull(),
    peaksManifest: jsonb("peaks_manifest")
      .$type<SongDeletionPeaksManifestItem[]>()
      .default([])
      .notNull(),
    audioBytes: bigint("audio_bytes", { mode: "number" }).notNull(),
    preparedAt: timestamp("prepared_at", { withTimezone: true }).notNull().defaultNow(),
    storageVerifiedAt: timestamp("storage_verified_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    producerOperationUnique: unique("song_deletion_operations_producer_operation_unique").on(
      t.producerId,
      t.operationKey,
    ),
    producerStateIdx: index("song_deletion_operations_producer_state_idx").on(
      t.producerId,
      t.completedAt,
      t.preparedAt,
    ),
    producerTrackIdx: index("song_deletion_operations_producer_track_idx").on(
      t.producerId,
      t.trackId,
      t.preparedAt,
    ),
    identityShape: check(
      "song_deletion_operations_identity_shape",
      sql`${t.requestDigest} ~ '^sha256:[0-9a-f]{64}$' AND NULLIF(btrim(${t.operationKey}), '') IS NOT NULL AND char_length(${t.operationKey}) <= 200 AND NULLIF(btrim(${t.actorClerkUserId}), '') IS NOT NULL AND char_length(${t.actorClerkUserId}) <= 200`,
    ),
    targetShape: check(
      "song_deletion_operations_target_shape",
      sql`jsonb_typeof(${t.targetVersionIds}) = 'array' AND ((${t.kind} = 'version' AND ${t.versionId} IS NOT NULL AND ${t.targetVersionIds} = jsonb_build_array(${t.versionId}::text)) OR (${t.kind} = 'song' AND ${t.versionId} IS NULL))`,
    ),
    manifestShape: check(
      "song_deletion_operations_manifest_shape",
      sql`jsonb_typeof(${t.audioManifest}) = 'array' AND jsonb_typeof(${t.artworkManifest}) = 'array' AND jsonb_typeof(${t.firstVersionStagingManifest}) = 'array' AND jsonb_typeof(${t.firstVersionFinalManifest}) = 'array' AND jsonb_typeof(${t.peaksManifest}) = 'array' AND ${t.audioBytes} >= 0`,
    ),
    timestampShape: check(
      "song_deletion_operations_timestamp_shape",
      sql`(${t.storageVerifiedAt} IS NULL OR ${t.storageVerifiedAt} >= ${t.preparedAt}) AND (${t.completedAt} IS NULL OR (${t.storageVerifiedAt} IS NOT NULL AND ${t.completedAt} >= ${t.storageVerifiedAt}))`,
    ),
  }),
);
export type SongDeletionOperation = typeof songDeletionOperations.$inferSelect;
export type NewSongDeletionOperation = typeof songDeletionOperations.$inferInsert;

// ─── SK-132: founder-admin safety and operational data ─────────────
// These records are deliberately independent from customer-facing routes.
// Every row carries an explicit Live/Test environment, and every retry-safe
// write carries both a caller-scoped operation key and an intent digest.

export type AdminSafeJsonValue = string | number | boolean | null;
export type AdminSafeJsonObject = { [key: string]: AdminSafeJsonValue };

export const adminDataEnvironment = pgEnum("admin_data_environment", ["live", "test"]);

export const adminActionOutcome = pgEnum("admin_action_outcome", [
  "succeeded",
  "failed",
  "partial",
  "no_change",
]);

export const adminSensitiveRevealReason = pgEnum("admin_sensitive_reveal_reason", [
  "support_investigation",
  "safety_issue",
]);

export const operationalRunKind = pgEnum("operational_run_kind", [
  "job",
  "email",
  "webhook",
  "provider_investigation",
]);

export const operationalRunStatus = pgEnum("operational_run_status", [
  "running",
  "succeeded",
  "failed",
  "partial",
]);

export const systemProblemState = pgEnum("system_problem_state", ["new", "seen", "resolved"]);

export const adminActionReceipts = pgTable(
  "admin_action_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    environment: adminDataEnvironment("environment").notNull(),
    action: text("action").notNull(),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    resultId: text("result_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    environmentActionOperationUnique: unique(
      "admin_action_receipts_environment_action_operation_unique",
    ).on(t.environment, t.action, t.operationKey),
    environmentCreatedIdx: index("admin_action_receipts_environment_created_idx").on(
      t.environment,
      t.createdAt.desc(),
      t.id,
    ),
    environmentShape: check(
      "admin_action_receipts_environment_shape",
      sql`${t.environment} IN ('live', 'test')`,
    ),
    identityShape: check(
      "admin_action_receipts_identity_shape",
      sql`NULLIF(btrim(${t.action}), '') IS NOT NULL AND char_length(${t.action}) <= 100 AND NULLIF(btrim(${t.operationKey}), '') IS NOT NULL AND char_length(${t.operationKey}) <= 255 AND NULLIF(btrim(${t.resultId}), '') IS NOT NULL AND char_length(${t.resultId}) <= 255`,
    ),
    digestShape: check(
      "admin_action_receipts_digest_shape",
      sql`${t.operationDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
  }),
);
export type AdminActionReceipt = typeof adminActionReceipts.$inferSelect;
export type NewAdminActionReceipt = typeof adminActionReceipts.$inferInsert;

export const adminActionHistory = pgTable(
  "admin_action_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    environment: adminDataEnvironment("environment").notNull(),
    actorClerkUserId: text("actor_clerk_user_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    targetAccountClerkUserId: text("target_account_clerk_user_id"),
    action: text("action").notNull(),
    safeBeforeState: jsonb("safe_before_state").$type<AdminSafeJsonObject>(),
    safeAfterState: jsonb("safe_after_state").$type<AdminSafeJsonObject>(),
    revealReason: adminSensitiveRevealReason("reveal_reason"),
    revealContentKind: text("reveal_content_kind"),
    outcome: adminActionOutcome("outcome").notNull(),
    failureCode: text("failure_code"),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    environmentOperationUnique: unique("admin_action_history_environment_operation_unique").on(
      t.environment,
      t.action,
      t.operationKey,
    ),
    environmentOccurredIdx: index("admin_action_history_environment_occurred_idx").on(
      t.environment,
      t.occurredAt.desc(),
      t.id,
    ),
    targetOccurredIdx: index("admin_action_history_target_occurred_idx").on(
      t.environment,
      t.targetType,
      t.targetId,
      t.occurredAt.desc(),
      t.id,
    ),
    targetAccountOccurredIdx: index("admin_action_history_target_account_occurred_idx")
      .on(t.environment, t.targetAccountClerkUserId, t.occurredAt.desc(), t.id.desc())
      .where(sql`${t.targetAccountClerkUserId} IS NOT NULL`),
    environmentShape: check(
      "admin_action_history_environment_shape",
      sql`${t.environment} IN ('live', 'test')`,
    ),
    actorShape: check(
      "admin_action_history_actor_shape",
      sql`NULLIF(btrim(${t.actorClerkUserId}), '') IS NOT NULL AND (${t.targetAccountClerkUserId} IS NULL OR NULLIF(btrim(${t.targetAccountClerkUserId}), '') IS NOT NULL)`,
    ),
    targetShape: check(
      "admin_action_history_target_shape",
      sql`NULLIF(btrim(${t.targetType}), '') IS NOT NULL AND NULLIF(btrim(${t.targetId}), '') IS NOT NULL AND NULLIF(btrim(${t.action}), '') IS NOT NULL`,
    ),
    operationShape: check(
      "admin_action_history_operation_shape",
      sql`NULLIF(btrim(${t.operationKey}), '') IS NOT NULL`,
    ),
    digestShape: check(
      "admin_action_history_digest_shape",
      sql`${t.operationDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    safeStateShape: check(
      "admin_action_history_safe_state_shape",
      sql`(
        ${t.safeBeforeState} IS NULL
        OR (
          ${t.action} = 'system_problem.update'
          AND skitza_is_safe_admin_json(
            ${t.safeBeforeState},
            ARRAY['hasPrivateNote', 'state']
          )
          AND COALESCE(
            jsonb_typeof(${t.safeBeforeState} -> 'hasPrivateNote') = 'boolean',
            false
          )
          AND COALESCE(
            ${t.safeBeforeState} ->> 'state' IN ('new', 'seen', 'resolved'),
            false
          )
        )
      ) AND (
        ${t.safeAfterState} IS NULL
        OR (
          ${t.action} = 'support_note.create'
          AND skitza_is_safe_admin_json(
            ${t.safeAfterState},
            ARRAY['noteCreated']
          )
          AND ${t.safeAfterState} = '{"noteCreated": true}'::jsonb
        )
        OR (
          ${t.action} = 'system_problem.update'
          AND skitza_is_safe_admin_json(
            ${t.safeAfterState},
            ARRAY['hasPrivateNote', 'state']
          )
          AND COALESCE(
            jsonb_typeof(${t.safeAfterState} -> 'hasPrivateNote') = 'boolean',
            false
          )
          AND COALESCE(
            ${t.safeAfterState} ->> 'state' IN ('new', 'seen', 'resolved'),
            false
          )
        )
      )`,
    ),
    revealShape: check(
      "admin_action_history_reveal_shape",
      sql`(
        (
          ${t.action} = 'sensitive_content.reveal'
          AND ${t.revealReason} IS NOT NULL
          AND NULLIF(btrim(${t.revealContentKind}), '') IS NOT NULL
          AND char_length(${t.revealContentKind}) <= 100
          AND ${t.revealContentKind} ~ '^[a-z][a-z0-9_.-]{0,99}$'
          AND ${t.outcome} = 'succeeded'
          AND ${t.failureCode} IS NULL
          AND ${t.safeBeforeState} IS NULL
          AND ${t.safeAfterState} IS NULL
        )
        OR (
          ${t.action} <> 'sensitive_content.reveal'
          AND ${t.revealReason} IS NULL
          AND ${t.revealContentKind} IS NULL
        )
      )`,
    ),
    failureShape: check(
      "admin_action_history_failure_shape",
      sql`${t.failureCode} IS NULL OR NULLIF(btrim(${t.failureCode}), '') IS NOT NULL`,
    ),
  }),
);
export type AdminActionHistory = typeof adminActionHistory.$inferSelect;
export type NewAdminActionHistory = typeof adminActionHistory.$inferInsert;

export const adminSupportNotes = pgTable(
  "admin_support_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    environment: adminDataEnvironment("environment").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    body: text("body").notNull(),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    environmentOperationUnique: unique("admin_support_notes_environment_operation_unique").on(
      t.environment,
      t.operationKey,
    ),
    targetCreatedIdx: index("admin_support_notes_target_created_idx").on(
      t.environment,
      t.targetType,
      t.targetId,
      t.createdAt.desc(),
      t.id,
    ),
    environmentShape: check(
      "admin_support_notes_environment_shape",
      sql`${t.environment} IN ('live', 'test')`,
    ),
    targetShape: check(
      "admin_support_notes_target_shape",
      sql`NULLIF(btrim(${t.targetType}), '') IS NOT NULL AND NULLIF(btrim(${t.targetId}), '') IS NOT NULL AND NULLIF(btrim(${t.createdByClerkUserId}), '') IS NOT NULL`,
    ),
    bodyShape: check(
      "admin_support_notes_body_shape",
      sql`NULLIF(btrim(${t.body}), '') IS NOT NULL AND char_length(${t.body}) <= 10000`,
    ),
    operationShape: check(
      "admin_support_notes_operation_shape",
      sql`NULLIF(btrim(${t.operationKey}), '') IS NOT NULL`,
    ),
    digestShape: check(
      "admin_support_notes_digest_shape",
      sql`${t.operationDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
  }),
);
export type AdminSupportNote = typeof adminSupportNotes.$inferSelect;
export type NewAdminSupportNote = typeof adminSupportNotes.$inferInsert;

export const domainEvents = pgTable(
  "domain_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    environment: adminDataEnvironment("environment").notNull(),
    eventName: text("event_name").notNull(),
    eventVersion: integer("event_version").notNull().default(1),
    producerId: uuid("producer_id"),
    actorClerkUserId: text("actor_clerk_user_id"),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    safeMetadata: jsonb("safe_metadata").$type<AdminSafeJsonObject>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    environmentOperationUnique: unique("domain_events_environment_operation_unique").on(
      t.environment,
      t.eventName,
      t.operationKey,
    ),
    environmentOccurredIdx: index("domain_events_environment_occurred_idx").on(
      t.environment,
      t.occurredAt.desc(),
      t.id,
    ),
    producerOccurredIdx: index("domain_events_producer_occurred_idx").on(
      t.environment,
      t.producerId,
      t.occurredAt.desc(),
      t.id,
    ),
    targetOccurredIdx: index("domain_events_target_occurred_idx").on(
      t.environment,
      t.targetType,
      t.targetId,
      t.occurredAt.desc(),
      t.id.desc(),
    ),
    actorOccurredIdx: index("domain_events_actor_occurred_idx")
      .on(t.environment, t.actorClerkUserId, t.occurredAt.desc(), t.id.desc())
      .where(sql`${t.actorClerkUserId} IS NOT NULL`),
    environmentShape: check(
      "domain_events_environment_shape",
      sql`${t.environment} IN ('live', 'test')`,
    ),
    eventShape: check(
      "domain_events_event_shape",
      sql`NULLIF(btrim(${t.eventName}), '') IS NOT NULL AND (${t.actorClerkUserId} IS NULL OR NULLIF(btrim(${t.actorClerkUserId}), '') IS NOT NULL)`,
    ),
    positiveVersion: check("domain_events_positive_version", sql`${t.eventVersion} > 0`),
    targetShape: check(
      "domain_events_target_shape",
      sql`NULLIF(btrim(${t.targetType}), '') IS NOT NULL AND NULLIF(btrim(${t.targetId}), '') IS NOT NULL`,
    ),
    operationShape: check(
      "domain_events_operation_shape",
      sql`NULLIF(btrim(${t.operationKey}), '') IS NOT NULL`,
    ),
    digestShape: check(
      "domain_events_digest_shape",
      sql`${t.operationDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    safeMetadataShape: check(
      "domain_events_safe_metadata_shape",
      sql`
        skitza_is_safe_admin_json(
          ${t.safeMetadata},
          ARRAY['changed', 'fieldCount']
        )
        AND (
          NOT (${t.safeMetadata} ? 'changed')
          OR jsonb_typeof(${t.safeMetadata} -> 'changed') = 'boolean'
        )
        AND CASE
          WHEN ${t.safeMetadata} ? 'fieldCount' THEN
            CASE
              WHEN jsonb_typeof(${t.safeMetadata} -> 'fieldCount') = 'number'
              THEN (
                (${t.safeMetadata} ->> 'fieldCount')::numeric >= 0
                AND (${t.safeMetadata} ->> 'fieldCount')::numeric
                  = trunc((${t.safeMetadata} ->> 'fieldCount')::numeric)
              )
              ELSE false
            END
          ELSE true
        END
      `,
    ),
  }),
);
export type DomainEvent = typeof domainEvents.$inferSelect;
export type NewDomainEvent = typeof domainEvents.$inferInsert;

export const operationalRuns = pgTable(
  "operational_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    environment: adminDataEnvironment("environment").notNull(),
    kind: operationalRunKind("kind").notNull(),
    operationName: text("operation_name").notNull(),
    operationKey: text("operation_key").notNull(),
    operationDigest: text("operation_digest").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    provider: text("provider"),
    providerReference: text("provider_reference"),
    safeMetadata: jsonb("safe_metadata").$type<AdminSafeJsonObject>().notNull().default({}),
    status: operationalRunStatus("status").notNull().default("running"),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    environmentOperationAttemptUnique: unique(
      "operational_runs_environment_operation_attempt_unique",
    ).on(t.environment, t.kind, t.operationName, t.operationKey, t.attemptNumber),
    environmentStartedIdx: index("operational_runs_environment_started_idx").on(
      t.environment,
      t.startedAt.desc(),
      t.id,
    ),
    targetStartedIdx: index("operational_runs_target_started_idx").on(
      t.environment,
      t.targetType,
      t.targetId,
      t.startedAt.desc(),
      t.id,
    ),
    environmentKindStatusIdx: index("operational_runs_environment_kind_status_idx").on(
      t.environment,
      t.kind,
      t.status,
      t.startedAt.desc(),
      t.id.desc(),
    ),
    environmentShape: check(
      "operational_runs_environment_shape",
      sql`${t.environment} IN ('live', 'test')`,
    ),
    operationShape: check(
      "operational_runs_operation_shape",
      sql`NULLIF(btrim(${t.operationName}), '') IS NOT NULL AND NULLIF(btrim(${t.operationKey}), '') IS NOT NULL`,
    ),
    digestShape: check(
      "operational_runs_digest_shape",
      sql`${t.operationDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    positiveAttempt: check("operational_runs_positive_attempt", sql`${t.attemptNumber} > 0`),
    targetShape: check(
      "operational_runs_target_shape",
      sql`(${t.targetType} IS NULL AND ${t.targetId} IS NULL) OR (NULLIF(btrim(${t.targetType}), '') IS NOT NULL AND NULLIF(btrim(${t.targetId}), '') IS NOT NULL)`,
    ),
    providerShape: check(
      "operational_runs_provider_shape",
      sql`(${t.provider} IS NULL OR NULLIF(btrim(${t.provider}), '') IS NOT NULL) AND (${t.providerReference} IS NULL OR (${t.provider} IS NOT NULL AND NULLIF(btrim(${t.providerReference}), '') IS NOT NULL))`,
    ),
    safeMetadataShape: check(
      "operational_runs_safe_metadata_shape",
      sql`
        skitza_is_safe_admin_json(
          ${t.safeMetadata},
          ARRAY['batchSize', 'durationMs']
        )
        AND CASE
          WHEN ${t.safeMetadata} ? 'batchSize' THEN
            CASE
              WHEN jsonb_typeof(${t.safeMetadata} -> 'batchSize') = 'number'
              THEN (
                (${t.safeMetadata} ->> 'batchSize')::numeric >= 0
                AND (${t.safeMetadata} ->> 'batchSize')::numeric
                  = trunc((${t.safeMetadata} ->> 'batchSize')::numeric)
              )
              ELSE false
            END
          ELSE true
        END
        AND CASE
          WHEN ${t.safeMetadata} ? 'durationMs' THEN
            CASE
              WHEN jsonb_typeof(${t.safeMetadata} -> 'durationMs') = 'number'
              THEN (
                (${t.safeMetadata} ->> 'durationMs')::numeric >= 0
                AND (${t.safeMetadata} ->> 'durationMs')::numeric
                  = trunc((${t.safeMetadata} ->> 'durationMs')::numeric)
              )
              ELSE false
            END
          ELSE true
        END
      `,
    ),
    statusShape: check(
      "operational_runs_status_shape",
      sql`(
        (
          ${t.status} = 'running'
          AND ${t.finishedAt} IS NULL
          AND ${t.errorCode} IS NULL
          AND ${t.providerReference} IS NULL
        )
        OR (
          ${t.status} IN ('succeeded', 'failed', 'partial')
          AND ${t.finishedAt} IS NOT NULL
          AND ${t.finishedAt} >= greatest(${t.startedAt}, ${t.createdAt})
          AND (
            (${t.status} = 'succeeded' AND ${t.errorCode} IS NULL)
            OR (
              ${t.status} IN ('failed', 'partial')
              AND NULLIF(btrim(${t.errorCode}), '') IS NOT NULL
              AND ${t.errorCode} ~ '^[a-z][a-z0-9_.-]{0,99}$'
            )
          )
        )
      )
      AND ${t.createdAt} >= ${t.startedAt}
      AND ${t.updatedAt} >= COALESCE(${t.finishedAt}, ${t.createdAt})`,
    ),
  }),
);
export type OperationalRun = typeof operationalRuns.$inferSelect;
export type NewOperationalRun = typeof operationalRuns.$inferInsert;

export const systemProblems = pgTable(
  "system_problems",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    environment: adminDataEnvironment("environment").notNull(),
    fingerprint: text("fingerprint").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    status: systemProblemState("status").notNull().default("new"),
    privateNote: text("private_note"),
    provider: text("provider"),
    providerReference: text("provider_reference"),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    seenByClerkUserId: text("seen_by_clerk_user_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByClerkUserId: text("resolved_by_clerk_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    environmentFingerprintUnique: unique("system_problems_environment_fingerprint_unique").on(
      t.environment,
      t.fingerprint,
    ),
    environmentStatusIdx: index("system_problems_environment_status_idx").on(
      t.environment,
      t.status,
      t.lastObservedAt.desc(),
      t.id,
    ),
    environmentShape: check(
      "system_problems_environment_shape",
      sql`${t.environment} IN ('live', 'test')`,
    ),
    fingerprintShape: check(
      "system_problems_fingerprint_shape",
      sql`${t.fingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    identityShape: check(
      "system_problems_identity_shape",
      sql`NULLIF(btrim(${t.category}), '') IS NOT NULL AND NULLIF(btrim(${t.title}), '') IS NOT NULL AND (${t.privateNote} IS NULL OR (NULLIF(btrim(${t.privateNote}), '') IS NOT NULL AND char_length(${t.privateNote}) <= 10000))`,
    ),
    providerShape: check(
      "system_problems_provider_shape",
      sql`(${t.provider} IS NULL OR NULLIF(btrim(${t.provider}), '') IS NOT NULL) AND (${t.providerReference} IS NULL OR (${t.provider} IS NOT NULL AND NULLIF(btrim(${t.providerReference}), '') IS NOT NULL))`,
    ),
    observationShape: check(
      "system_problems_observation_shape",
      sql`${t.lastObservedAt} >= ${t.firstObservedAt} AND ${t.createdAt} >= ${t.firstObservedAt} AND ${t.updatedAt} >= greatest(${t.createdAt}, ${t.lastObservedAt}) AND (${t.seenAt} IS NULL OR ${t.seenAt} >= ${t.createdAt}) AND (${t.seenAt} IS NULL OR ${t.updatedAt} >= ${t.seenAt}) AND (${t.resolvedAt} IS NULL OR ${t.resolvedAt} >= ${t.createdAt}) AND (${t.resolvedAt} IS NULL OR ${t.updatedAt} >= ${t.resolvedAt})`,
    ),
    stateShape: check(
      "system_problems_state_shape",
      sql`(
        (
          ${t.status} = 'new'
          AND ${t.seenAt} IS NULL
          AND ${t.seenByClerkUserId} IS NULL
          AND ${t.resolvedAt} IS NULL
          AND ${t.resolvedByClerkUserId} IS NULL
        )
        OR (
          ${t.status} = 'seen'
          AND ${t.seenAt} IS NOT NULL
          AND ${t.seenAt} >= ${t.firstObservedAt}
          AND NULLIF(btrim(${t.seenByClerkUserId}), '') IS NOT NULL
          AND ${t.resolvedAt} IS NULL
          AND ${t.resolvedByClerkUserId} IS NULL
        )
        OR (
          ${t.status} = 'resolved'
          AND (
            (${t.seenAt} IS NULL AND ${t.seenByClerkUserId} IS NULL)
            OR (
              ${t.seenAt} IS NOT NULL
              AND ${t.seenAt} >= ${t.firstObservedAt}
              AND NULLIF(btrim(${t.seenByClerkUserId}), '') IS NOT NULL
            )
          )
          AND ${t.resolvedAt} IS NOT NULL
          AND ${t.resolvedAt} >= ${t.firstObservedAt}
          AND ${t.resolvedAt} >= ${t.lastObservedAt}
          AND (${t.seenAt} IS NULL OR ${t.resolvedAt} >= ${t.seenAt})
          AND NULLIF(btrim(${t.resolvedByClerkUserId}), '') IS NOT NULL
        )
      )`,
    ),
  }),
);
export type SystemProblem = typeof systemProblems.$inferSelect;
export type NewSystemProblem = typeof systemProblems.$inferInsert;
