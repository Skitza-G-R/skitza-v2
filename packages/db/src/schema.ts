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

export const producers = pgTable("producers", {
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
  // ─── Batch G — Autopilot toggles ─────────────────────────────────
  // Five named behaviors the producer can flip on/off. No rule-builder,
  // no conditions — each column is a discrete outcome. See migration
  // 0027 for the column-level rationale. Defaults:
  //   * welcomeEmail=false / unpaidReminder=false /
  //     requestTestimonial=false / autoArchive=false — opt-in.
  //   * commentNotify=true — matches existing unconditional behavior.
  autopilotWelcomeEmail: boolean("autopilot_welcome_email").notNull().default(false),
  autopilotUnpaidReminder: boolean("autopilot_unpaid_reminder").notNull().default(false),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Producer = typeof producers.$inferSelect;
export type NewProducer = typeof producers.$inferInsert;

export const portfolioTracks = pgTable("portfolio_tracks", {
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
});
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
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    durationMin: integer("duration_min").notNull(),
    status: bookingStatus("status").notNull().default("pending_approval"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    outcome: sessionUseOutcome("outcome").notNull().default("reserved"),
    outcomeChangedAt: timestamp("outcome_changed_at", { withTimezone: true }),
    reminderSent24h: timestamp("reminder_sent_24h", { withTimezone: true }),
    reminderSent1h: timestamp("reminder_sent_1h", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idProducerUnique: unique("bookings_id_producer_unique").on(t.id, t.producerId),
    producerStartsIdx: index("bookings_producer_starts_idx").on(t.producerId, t.startsAt),
    purchaseStartsIdx: index("bookings_purchase_starts_idx").on(t.purchaseId, t.startsAt),
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
    songPurchaseFk: foreignKey({
      columns: [t.songId, t.purchaseId],
      foreignColumns: [projectTracks.id, projectTracks.purchaseId],
      name: "bookings_song_purchase_fk",
    }).onDelete("restrict"),
  }),
);
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;

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
  },
  (t) => ({
    idPurchaseUnique: unique("track_versions_id_purchase_unique").on(t.id, t.purchaseId),
    idProducerUnique: unique("track_versions_id_producer_unique").on(t.id, t.producerId),
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
          AND (${t.pendingAudioPartUrlsExpireAt} IS NULL OR (${t.pendingAudioUploadId} IS NOT NULL AND ${t.pendingAudioPartUrlsExpireAt} >= ${t.pendingAudioCreateAttemptedAt}))
          AND (${t.pendingAudioCancelRequestedAt} IS NULL OR (${t.pendingAudioCancelRequestedAt} >= ${t.pendingAudioStartedAt} AND (${t.pendingAudioCompleteAttemptedAt} IS NULL OR ${t.pendingAudioCancelRequestedAt} >= ${t.pendingAudioCompleteAttemptedAt})))
          AND (${t.pendingAudioCleanupEtag} IS NULL OR (${t.pendingAudioCompleteAttemptedAt} IS NOT NULL AND NULLIF(btrim(${t.pendingAudioCleanupEtag}), '') IS NOT NULL))
          AND ((${t.pendingAudioCancelRequestedAt} IS NULL AND ${t.audioDeletedAt} IS NULL) OR (${t.pendingAudioCancelRequestedAt} IS NOT NULL AND ${t.audioDeletedAt} IS NOT NULL))
        )
      ) IS TRUE`,
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
  }),
);

export type ClientContact = typeof clientContacts.$inferSelect;
export type NewClientContact = typeof clientContacts.$inferInsert;

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
export type PurchaseCommercialSnapshot = {
  version: 1;
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
    sequence: integer("sequence").notNull(),
    previousAmountCents: integer("previous_amount_cents").notNull(),
    newAmountCents: integer("new_amount_cents").notNull(),
    reason: text("reason").notNull(),
    correctedByClerkUserId: text("corrected_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
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
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason").notNull(),
    waivedByClerkUserId: text("waived_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
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
    reason: text("reason").notNull(),
    canceledByClerkUserId: text("canceled_by_clerk_user_id").notNull(),
    canceledAt: timestamp("canceled_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    purchaseUnique: unique("purchase_cancellations_purchase_unique").on(t.purchaseId),
    purchaseProducerFk: foreignKey({
      columns: [t.purchaseId, t.producerId],
      foreignColumns: [purchases.id, purchases.producerId],
      name: "purchase_cancellations_purchase_producer_fk",
    }).onDelete("restrict"),
  }),
);
export type PurchaseCancellation = typeof purchaseCancellations.$inferSelect;
export type NewPurchaseCancellation = typeof purchaseCancellations.$inferInsert;

export const purchaseSessionAllowances = pgTable(
  "purchase_session_allowances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseId: uuid("purchase_id").notNull(),
    producerId: uuid("producer_id").notNull(),
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
    purchaseVersionCreatedIdx: index("purchase_download_overrides_version_created_idx").on(
      t.purchaseId,
      t.versionId,
      t.createdAt,
    ),
  }),
);

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
  }),
);
