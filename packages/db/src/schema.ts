import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  integer,
  bigint,
  boolean,
  numeric,
  pgEnum,
  unique,
  uniqueIndex,
  index,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Payment-plan shape offered by a product and (after activation)
// pinned onto the project. `full` = pay-in-full at checkout,
// `split_50_50` = 50% upfront + 50% on delivery, `monthly` = upfront
// charge followed by N-1 monthly installments. `installments` on the
// monthly variant is the total number of charges (upfront + recurring).
export type PaymentPlan =
  | { kind: "full" }
  | { kind: "split_50_50" }
  | { kind: "monthly"; installments: number };

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
  stripeAccountId: text("stripe_account_id"),
  // Phase H.5 — cached `charges_enabled` from Stripe Connect. Producers
  // create a Stripe account before they finish KYC, so the account-id
  // existing isn't enough — we also need to know whether Stripe will
  // accept charges on it. Refreshed on the `account.updated` webhook
  // and from the `stripe.refreshAccount` mutation when the producer
  // returns from the onboarding flow.
  stripeChargesEnabled: boolean("stripe_charges_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Producer = typeof producers.$inferSelect;
export type NewProducer = typeof producers.$inferInsert;

export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  source: text("source"), // free-text for v1: "instagram dm", "referral from X", etc.
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;

export const portfolioTracks = pgTable("portfolio_tracks", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  artist: text("artist"),                 // optional credit line
  audioUrl: text("audio_url"),            // nullable during upload — filled by audio.completeMultipart
  artworkUrl: text("artwork_url"),
  position: integer("position").notNull().default(0), // for ordering
  audioR2Key: text("audio_r2_key"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  durationMs: integer("duration_ms"),
  peaksR2Key: text("peaks_r2_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type PortfolioTrack = typeof portfolioTracks.$inferSelect;
export type NewPortfolioTrack = typeof portfolioTracks.$inferInsert;

export const magicLinks = pgTable("magic_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  target: text("target").notNull(),     // "portfolio" | "booking" | "project:<uuid>" — string-typed for forward compat
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 of the issued token; never store the token itself
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type MagicLink = typeof magicLinks.$inferSelect;
export type NewMagicLink = typeof magicLinks.$inferInsert;

export const magicLinkViews = pgTable("magic_link_views", {
  id: uuid("id").defaultRandom().primaryKey(),
  magicLinkId: uuid("magic_link_id").notNull().references(() => magicLinks.id, { onDelete: "cascade" }),
  ip: text("ip"),               // captured from x-forwarded-for; nullable for tests
  userAgent: text("user_agent"),
  referer: text("referer"),
  dwellMs: integer("dwell_ms"), // populated by client-side beacon on unload; nullable
  viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
});
export type MagicLinkView = typeof magicLinkViews.$inferSelect;
export type NewMagicLinkView = typeof magicLinkViews.$inferInsert;

export const waitlist = pgTable("waitlist", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  source: text("source"),          // e.g. "landing-hero", "landing-final-cta"
  userAgent: text("user_agent"),
  ipHash: text("ip_hash"),         // sha256(ip); raw IPs never stored
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type WaitlistEntry = typeof waitlist.$inferSelect;
export type NewWaitlistEntry = typeof waitlist.$inferInsert;

// ─── Products (formerly packages — Phase H.3 rebuild) ──────────────
// A producer's offerings — anything they sell, not just time-bound
// sessions. Producers don't sell hours; they sell deliverables: a mix,
// a master, a full production, an album, a beat lease. `pricingModel`
// picks how the price is computed (flat / per-song volume tier /
// hourly / bundle); `depositModel` picks how money is collected
// upfront (flat % / milestones / pay-in-full). The old `packages`
// table was renamed in-place via ALTER TABLE so existing bookings keep
// their product_id intact.
//
// Soft-delete: `archivedAt` is the newer Phase H shape. The legacy
// `active` boolean stays for back-compat while we migrate callers.
// `position` gives drag-free ordering.
export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  // For session-style products (mix-in-person, live tracking) duration
  // is still meaningful — it drives the slot grid. For pure-deliverable
  // products (a mix bought for $2k) duration is effectively "how long
  // the producer needs to block on their calendar"; we keep it
  // required at the DB level but the dashboard surfaces it as
  // "Duration (optional)".
  durationMin: integer("duration_min").notNull(),            // per session
  sessionCount: integer("session_count").notNull().default(1),
  // Flat/bundle price. Still the canonical price for flat products.
  // Per-song products read from volumeTiers instead; hourly reads from
  // hourlyRateCents.
  priceCents: integer("price_cents").notNull().default(0),   // 0 = free / discovery
  currency: text("currency").notNull().default("USD"),       // ISO 4217
  depositPct: integer("deposit_pct").notNull().default(0),   // 0..100 for depositModel='flat'
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
  volumeTiers: jsonb("volume_tiers").$type<
    { minQty: number; pricePerUnitCents: number }[]
  >(),
  // Hourly rate in cents. Only populated for pricingModel='hourly'.
  hourlyRateCents: integer("hourly_rate_cents"),
  // Deliverables chip list — "Mixed master", "Stems", "Credit",
  // "WAV files". Rendered on the product card. Null/empty = "not
  // specified".
  deliverables: text("deliverables").array(),
  // How deposit is collected: 'flat' (depositPct upfront),
  // 'milestones' (multiple named % rows), 'paid_in_full' (nothing
  // up front).
  depositModel: text("deposit_model").notNull().default("flat"),
  // Milestone schedule for depositModel='milestones'. Array of
  // [{ label, pct }] summing to 100. Null otherwise.
  milestones: jsonb("milestones").$type<{ label: string; pct: number }[]>(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

// Weekly recurring availability. One row per (producer, weekday, block)
// — max 2 blocks per weekday (morning/evening). weekday uses JS's
// Date.getDay() numbering: 0 = Sunday … 6 = Saturday. Minutes from
// start of day: 0..1440 (inclusive start, exclusive end).
export const availabilityBlocks = pgTable("availability_blocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
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
export const availabilityBlackouts = pgTable("availability_blackouts", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  startDate: text("start_date").notNull(),  // ISO date YYYY-MM-DD in producer's TZ
  endDate: text("end_date").notNull(),      // inclusive
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Fast producer-scoped lookup, ordered by startDate — the slot
  // computation lists every blackout for a producer, so this index
  // covers both the filter + the sort.
  producerStartIdx: index("availability_blackouts_producer_start_idx").on(t.producerId, t.startDate),
}));

export type Blackout = typeof availabilityBlackouts.$inferSelect;
export type NewBlackout = typeof availabilityBlackouts.$inferInsert;

// Booking status — enum so typos can't drift into the column. Holding
// all statuses in one table (vs. a separate `booking_requests`) keeps
// the audit trail + producer dashboard single-source-of-truth.
export const bookingStatus = pgEnum("booking_status", [
  "pending",
  "confirmed",
  "rejected",
  "cancelled",
]);

export const bookings = pgTable("bookings", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  // productId nullable + SET NULL on delete so a product purge doesn't
  // obliterate the historical booking. We copy product snapshots onto
  // the booking row (see packageNameSnapshot) to preserve history too.
  // Column name is `product_id` post-rename; the snapshot column keeps
  // its legacy name for data-preservation (`package_name_snapshot`).
  productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
  packageNameSnapshot: text("package_name_snapshot"),
  // Nullable link to the Project this booking feeds. Existing rows are
  // back-filled to NULL; confirm → createProject wires new confirmed
  // bookings to a project automatically. SET NULL on project delete so
  // the booking history survives.
  projectId: uuid("project_id").references((): AnyPgColumn => projects.id, { onDelete: "set null" }),
  artistName: text("artist_name").notNull(),
  artistEmail: text("artist_email").notNull(),
  artistPhone: text("artist_phone"),
  notes: text("notes"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  durationMin: integer("duration_min").notNull(),
  status: bookingStatus("status").notNull().default("pending"),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
  // Phase H.4c — reminder dispatch markers. Nullable timestamp = "not
  // sent yet"; the cron at /api/cron/session-reminders stamps the
  // current time after a successful Resend send so we never double-mail
  // the same booking. Two columns (vs. one JSON map) keeps the cron
  // SELECT tight: WHERE reminder_sent_24h IS NULL AND starts_at … .
  reminderSent24h: timestamp("reminder_sent_24h", { withTimezone: true }),
  reminderSent1h: timestamp("reminder_sent_1h", { withTimezone: true }),
  // Phase H.5 — Stripe Checkout session id when this booking was paid
  // for via Stripe (deposit or full). Mirrored on the invoice row too,
  // but having it inline lets the booking detail page link straight to
  // the Stripe dashboard without a join.
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;

// ─── Projects (unified Booking + Contract + Project Room) ─────────
// A Project ties every artifact for one engagement under a single row:
// the booking that kicked it off, the contract that formalised it,
// the project room where files + feedback live, and the client cache
// (name/email snapshot so we can display a recent-activity feed even
// after a booking is deleted). `stage` moves the project through a
// lightweight funnel (lead → booked → contract_sent → in_production →
// final_review → paid → archived). The share_token surface and
// depositPaid/finalPaid v1 proxies live on this row as well.
export const projectStage = pgEnum("project_stage", [
  "lead",          // potential, not yet booked
  "booked",        // booking created
  "contract_sent", // contract sent to artist
  "in_production", // actively working
  "final_review",  // final mix sent, awaiting approval
  "paid",          // final invoice paid
  "archived",      // closed
  "payment_paused", // monthly retries exhausted — locks self-booking until PM updated
  "cancelled",     // producer cancelled mid-plan
]);

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  // SET NULL so a booking delete doesn't nuke the collab history.
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  stage: projectStage("stage").notNull().default("lead"),
  // Client identity snapshot — duplicated onto the project so the feed
  // still renders a sensible row after a booking row is purged.
  clientName: text("client_name"),
  clientEmail: text("client_email"),
  shareTokenHash: text("share_token_hash").notNull().unique(),
  // Legacy artistName/artistEmail kept for now — the share-page render
  // path still reads them and we avoid churning that here.
  artistName: text("artist_name").notNull(),
  artistEmail: text("artist_email").notNull(),
  depositPaid: boolean("deposit_paid").notNull().default(false),
  finalPaid: boolean("final_paid").notNull().default(false),
  // ─── Auto-installments (Stripe) execution state ───────────────────
  // One plan per project — we don't model a separate instance table
  // because the relationship is 1:1 and a join would be pure overhead.
  // `paymentPlanKind` stays text so we can add plan variants later
  // without an enum migration: 'full' | 'split_50_50' | 'monthly'.
  paymentPlanKind: text("payment_plan_kind"),
  // Total charges for monthly plans (2..12). Null for full/split.
  installments: integer("installments"),
  // Stripe references. customerId + paymentMethodId are set when the
  // client completes the first (or only) Checkout; subscriptionScheduleId
  // is populated only for 'monthly' plans driving future charges.
  stripeCustomerId: text("stripe_customer_id"),
  stripePaymentMethodId: text("stripe_payment_method_id"),
  stripeSubscriptionScheduleId: text("stripe_subscription_schedule_id"),
  // Progress counters driven by webhook handlers. chargesCompleted
  // increments on invoice.paid; chargesTotal is the target (1 for full,
  // 2 for split, N for monthly).
  chargesCompleted: integer("charges_completed").notNull().default(0),
  chargesTotal: integer("charges_total"),
  // Next scheduled charge (from Stripe subscription schedule). Lets the
  // UI show "next charge on ..." without a Stripe API round-trip.
  nextChargeAt: timestamp("next_charge_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

// One named track within a project. `artist` is optional credit line
// (e.g. "feat. Someone"). Position orders tracks on the share page.
export const projectTracks = pgTable("project_tracks", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  artist: text("artist"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ProjectTrack = typeof projectTracks.$inferSelect;
export type NewProjectTrack = typeof projectTracks.$inferInsert;

// Versions stacked under a track. Producers upload V1 → V2 → master.
// The UI sorts by `uploadedAt` desc so the latest is top-of-stack,
// matching Samply's "latest on top" convention. Label is free-text
// (e.g. "Rough Mix", "Mix v2", "Master", "Instrumental").
export const trackVersions = pgTable("track_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  trackId: uuid("track_id").notNull().references(() => projectTracks.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  audioUrl: text("audio_url"),             // nullable during upload — filled by audio.completeMultipart
  durationMs: integer("duration_ms"),       // optional; we populate when known
  audioR2Key: text("audio_r2_key"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  peaksR2Key: text("peaks_r2_key"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  // G.11 — producer marks a version "final/approved". Presence of a
  // timestamp is the approved flag; null means unapproved. When the
  // producer sets this we also emit a `track_approved` notification
  // ("don't forget to send Maya the stems").
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});
export type TrackVersion = typeof trackVersions.$inferSelect;
export type NewTrackVersion = typeof trackVersions.$inferInsert;

// Timestamped comments on a version. `timestampMs` is the ms offset
// into the track where the pin sits. Author is free-text (no Artist
// accounts). Producers can resolve comments from the producer UI —
// `resolvedAt` is the audit trail + the UI filter.
export const trackComments = pgTable("track_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  versionId: uuid("version_id").notNull().references(() => trackVersions.id, { onDelete: "cascade" }),
  authorName: text("author_name").notNull(),
  authorEmail: text("author_email").notNull(),
  body: text("body").notNull(),
  timestampMs: integer("timestamp_ms").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  // Tracks which side posted — producer (internal) vs. artist
  // (from the share page). Lets the UI style them differently.
  fromProducer: boolean("from_producer").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type TrackComment = typeof trackComments.$inferSelect;
export type NewTrackComment = typeof trackComments.$inferInsert;

// ─── Contracts (PandaDoc-equivalent) ────────────────────────────────
// A two-table model:
// 1. contract_templates — reusable producer templates (markdown body
//    with {{placeholder}} tokens).
// 2. contracts — each "sent for signing" instance. Template snapshot
//    on send so edits to the template don't mutate sent contracts.
// 3. contract_events — audit trail (sent, viewed, signed) with IP hash.
//
// Contract state: draft → sent → viewed → signed → expired|cancelled.
// Stored as text instead of enum for looser forward-compat.
export const contractStatus = pgEnum("contract_status", [
  "draft",
  "sent",
  "viewed",
  "signed",
  "completed",
  "cancelled",
  "expired",
]);

export const contractFieldType = pgEnum("contract_field_type", [
  "signature",
  "initial",
  "date",
  "text",
  "checkbox",
  "dropdown",
  "number",
]);

export const contractEventKind = pgEnum("contract_event_kind", [
  "created",
  "sent",
  "viewed",
  "field_filled",
  "signed",
  "completed",
  "cancelled",
  "downloaded",
]);

export const contracts = pgTable("contracts", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  pdfR2Key: text("pdf_r2_key").notNull(),
  finalPdfR2Key: text("final_pdf_r2_key"),
  status: contractStatus("status").notNull().default("draft"),
  shareTokenHash: text("share_token_hash").unique(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  viewedAt: timestamp("viewed_at", { withTimezone: true }),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contractRecipients = pgTable("contract_recipients", {
  id: uuid("id").defaultRandom().primaryKey(),
  contractId: uuid("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("signer"),
  routingOrder: integer("routing_order").notNull().default(1),
  signingTokenHash: text("signing_token_hash").unique().notNull(),
  viewedAt: timestamp("viewed_at", { withTimezone: true }),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contractFields = pgTable("contract_fields", {
  id: uuid("id").defaultRandom().primaryKey(),
  contractId: uuid("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  recipientId: uuid("recipient_id").references(() => contractRecipients.id, { onDelete: "set null" }),
  page: integer("page").notNull(),
  x: numeric("x", { precision: 5, scale: 2 }).notNull(),
  y: numeric("y", { precision: 5, scale: 2 }).notNull(),
  w: numeric("w", { precision: 5, scale: 2 }).notNull(),
  h: numeric("h", { precision: 5, scale: 2 }).notNull(),
  type: contractFieldType("type").notNull(),
  required: boolean("required").notNull().default(true),
  prefilledValue: text("prefilled_value"),
  signedValue: text("signed_value"),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  options: jsonb("options"),
});

export const contractEvents = pgTable("contract_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  contractId: uuid("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  recipientId: uuid("recipient_id").references(() => contractRecipients.id, { onDelete: "set null" }),
  event: contractEventKind("event").notNull(),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Contract = typeof contracts.$inferSelect;
export type NewContract = typeof contracts.$inferInsert;
export type ContractRecipient = typeof contractRecipients.$inferSelect;
export type NewContractRecipient = typeof contractRecipients.$inferInsert;
export type ContractField = typeof contractFields.$inferSelect;
export type NewContractField = typeof contractFields.$inferInsert;
export type ContractEvent = typeof contractEvents.$inferSelect;
export type NewContractEvent = typeof contractEvents.$inferInsert;
// ─── Client contacts cache ──────────────────────────────────────────
// When an artist signs a contract, submits a booking request, or the
// producer creates a project, we upsert an entry here so send-forms can
// pre-fill returning-artist details. `emailHash` is sha256(lower) and
// is the dedupe key alongside producerId; the raw lowercase email is
// kept for display. Scoped per-producer so contacts don't leak.
export const clientContacts = pgTable("client_contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  emailHash: text("email_hash").notNull(),       // sha256 of lowercased email — privacy + dedupe key
  email: text("email").notNull(),                 // raw lowercase email — displayed in UI
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
  tags: text("tags").array(),
  notes: text("notes"),
  referralSource: text("referral_source"),
}, (t) => ({
  uniqPerProducer: unique("client_contacts_producer_email_unique").on(t.producerId, t.emailHash),
}));

export type ClientContact = typeof clientContacts.$inferSelect;
export type NewClientContact = typeof clientContacts.$inferInsert;

// ─── Notifications / Inbox (Phase E) ────────────────────────────────
// One unified feed of everything that needs the producer's attention:
// artist comments on track versions, new booking requests, contract
// status changes, paid invoices. The inbox at /dashboard/inbox reads
// from this single table and supports j/k navigation, read/archive
// state, and click-through to the source context. Emit helpers in
// apps/web/src/server/notifications/emit.ts insert rows fire-and-
// forget so a notify failure can never block the primary flow.
export const notificationKind = pgEnum("notification_kind", [
  "comment_created",     // visitor commented on a track version
  "contract_signed",     // all-signers-complete OR an individual signer
  "booking_requested",   // visitor submitted a booking
  "contract_viewed",     // signer opened the contract link (optional; could be noisy)
  "track_approved",      // (future) artist marked a version approved
]);

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  kind: notificationKind("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  // Related refs — nullable FKs for click-through. Only one is
  // populated per row; the UI routes to the right page based on
  // which id is present.
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  trackVersionId: uuid("track_version_id").references(() => trackVersions.id, { onDelete: "cascade" }),
  commentId: uuid("comment_id").references(() => trackComments.id, { onDelete: "cascade" }),
  contractId: uuid("contract_id").references(() => contracts.id, { onDelete: "cascade" }),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
  readAt: timestamp("read_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Covers the inbox list query: filter by producer + active/archived
  // bucket, order by createdAt desc.
  producerActiveIdx: index("notifications_producer_active_idx").on(t.producerId, t.archivedAt, t.createdAt),
}));

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

// ─── Invoices (Phase H.5 — Stripe integration) ──────────────────────
// One row per Stripe Checkout Session created on behalf of a producer.
// We snapshot Stripe identifiers (session id + payment intent id) so
// we can correlate webhook events back to a Skitza row without
// round-tripping the API. `kind` records the producer's intent
// (deposit | final | milestone | full) — we don't enforce a state
// machine on it, so producers can layer multiple invoices against the
// same booking (deposit, then final). Amounts are minor units (cents).
export const invoiceStatus = pgEnum("invoice_status", [
  "draft",
  "sent",
  "paid",
  "refunded",
  "void",
  "uncollectible",
]);

export const invoices = pgTable("invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id")
    .notNull()
    .references(() => producers.id, { onDelete: "cascade" }),
  // Loose links — a producer might invoice a project before a booking
  // exists, or stand-alone. SET NULL on delete so the invoice ledger
  // survives a project/booking purge.
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  // Auto-installments — points back at the project whose payment plan
  // generated this invoice. Separate from projectId because a legacy
  // project may have invoices without a plan. SET NULL preserves the
  // ledger if the project is deleted.
  paymentPlanProjectId: uuid("payment_plan_project_id")
    .references(() => projects.id, { onDelete: "set null" }),
  // Stripe linkage. checkoutSessionId is set immediately on Checkout
  // creation; paymentIntentId arrives later via the
  // checkout.session.completed webhook (it doesn't exist until the
  // visitor actually starts paying).
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  description: text("description"),
  // Free-text role within the engagement: 'deposit' | 'final' |
  // 'milestone' | 'full'. Kept as text so we can introduce new kinds
  // (e.g. 'rush_fee') without an enum migration.
  kind: text("kind").notNull(),
  status: invoiceStatus("status").notNull().default("draft"),
  customerEmail: text("customer_email"),
  customerName: text("customer_name"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Covers the dashboard list query: producer-scoped, ordered desc.
  producerCreatedIdx: index("invoices_producer_created_idx").on(t.producerId, t.createdAt),
  // Partial unique index — Stripe fires invoice.paid +
  // payment_intent.succeeded near-parallel for subscription invoices.
  // Without this, both handlers pass the SELECT-check and both INSERT,
  // producing duplicate ledger rows. WHERE clause keeps legacy rows
  // without a PI (deposits pre-checkout, manual invoices) unaffected.
  piUnique: uniqueIndex("invoices_stripe_payment_intent_unique")
    .on(t.stripePaymentIntentId)
    .where(sql`${t.stripePaymentIntentId} IS NOT NULL`),
}));

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;

// ─── Stripe customer cache ──────────────────────────────────────────
// One Stripe Customer per (producer, client_contact) pair. Stored
// outside `client_contacts` because a single contact might be a
// customer of multiple producers (multi-tenant future), each with
// their own Stripe Customer on their own Connect account.
// Composite primary key prevents duplicates without needing a separate
// surrogate id. Cascade on either side — if the producer or contact
// goes away, the Stripe customer mapping has no meaning.
export const stripeCustomers = pgTable("stripe_customers", {
  producerId: uuid("producer_id")
    .notNull()
    .references(() => producers.id, { onDelete: "cascade" }),
  clientContactId: uuid("client_contact_id")
    .notNull()
    .references(() => clientContacts.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.producerId, t.clientContactId] }),
  customerIdx: index("stripe_customers_customer_idx").on(t.stripeCustomerId),
}));

export type StripeCustomer = typeof stripeCustomers.$inferSelect;
export type NewStripeCustomer = typeof stripeCustomers.$inferInsert;
