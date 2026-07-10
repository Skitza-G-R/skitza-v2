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
  | { kind: "monthly"; installments: number }
  // BE-2 (2026-07-05): named-% schedule. The schedule rows are embedded
  // in the plan value itself (snapshot-safe) — sourced from
  // products.milestones when the product's depositModel is 'milestones'.
  | { kind: "milestones"; milestones: { label: string; pct: number }[] };

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
  // Per-producer Tranzila terminal name. When set, payment redirects
  // route to this terminal so funds flow directly to the producer.
  // Null = use the master sandbox fallback (process.env.TRANZILA_TERMINAL_NAME).
  // Provisioned manually by Skitza admin after the producer submits the
  // connection-request form on Settings → Integrations → Payments.
  tranzilaTerminalName: text("tranzila_terminal_name"),
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
  // product surface AND the Stripe charge amount for 'tax_added'.
  // Three modes (v2 — migration 0019 renamed the prior 'none' /
  // 'vat_included' / 'vat_exempt' tuple):
  //   * 'tax_free'     — no tax. Footnote: "Tax-free." Covers both
  //                      "no tax involved" (non-IL) and the Osek Patur
  //                      legal exemption (small-business IL). No math
  //                      change at checkout.
  //   * 'tax_included' — listed prices already include taxRatePct%.
  //                      Footnote: "Includes {rate}% tax." No math
  //                      change — artist pays the displayed number.
  //   * 'tax_added'    — listed prices are PRE-TAX. Stripe charges
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
  depositPct: integer("deposit_pct").notNull().default(0), // 0..100 for depositModel='flat'
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
  // Optional URL to a contract PDF the producer hosts elsewhere
  // (Dropbox, Drive, their own site). Mirrors the brand.logoUrl
  // pattern — producers paste a link, no file upload.
  contractUrl: text("contract_url"),
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
  "pending_payment",
  "confirmed",
  "rejected",
  "cancelled",
]);

export const bookings = pgTable("bookings", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id")
    .notNull()
    .references(() => producers.id, { onDelete: "cascade" }),
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
  projectId: uuid("project_id").references((): AnyPgColumn => projects.id, {
    onDelete: "set null",
  }),
  artistName: text("artist_name").notNull(),
  artistEmail: text("artist_email").notNull(),
  artistPhone: text("artist_phone"),
  notes: text("notes"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  durationMin: integer("duration_min").notNull(),
  status: bookingStatus("status").notNull().default("pending_approval"),
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
  // Tranzila's transaction confirmation number (the `ConfirmationCode`
  // field from the notify_url POST body). Stored when the booking flips
  // to confirmed so the success page can show "Confirmation #..." back
  // to the artist. Nullable — Stripe-paid bookings won't have one.
  tranzilaConfirmationCode: text("tranzila_confirmation_code"),
  // SK-20 — producer dismisses the "you got paid" banner on /dashboard
  // by stamping this column. NULL = banner still shows + activity row
  // is unread; non-NULL = acknowledged. Mirrors the reminder_sent_*
  // nullable-timestamp pattern above.
  producerAcknowledgedAt: timestamp("producer_acknowledged_at", { withTimezone: true }),
  // Phase 0 of Clients & Projects v3 — links a booking to a specific
  // song so the Song Space's Sessions tab can scope to that song.
  // Nullable to preserve existing booking rows (they pre-date this
  // column and were never tied to a song). ON DELETE SET NULL so a
  // song delete doesn't cascade-delete sessions. Forward reference to
  // `projectTracks` (declared further down) handled via the lazy
  // callback form, same pattern as `projectId` above.
  songId: uuid("song_id").references((): AnyPgColumn => projectTracks.id, {
    onDelete: "set null",
  }),
  // Per-song pricing — populated only when the product had
  // pricingModel='per_song' at booking time. songQty is how many songs
  // the artist picked in the pre-booking stepper; unitPriceCents is the
  // per-song rate they locked in (already after tier discount). Both
  // null for flat-price bookings. Denormalised so the producer
  // dashboard can render "Mixing × 5 songs — $750" without re-running
  // tier math against (possibly mutated) product.volumeTiers.
  songQty: integer("song_qty"),
  unitPriceCents: integer("unit_price_cents"),
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
  "lead", // potential, not yet booked
  "booked", // booking created
  "in_production", // actively working
  "final_review", // final mix sent, awaiting approval
  "paid", // final invoice paid
  "archived", // closed
]);

// New workflow enum introduced by the Clients & Projects v3 redesign
// (design doc: docs/plans/active/2026-05-14-clients-projects-redesign-design.md).
// Drives the per-song stepper + the new Status stat tile on the Album hero.
// Lives alongside `projectStage` — the old enum keeps running billing.
export const workflowStage = pgEnum("workflow_stage", [
  "brief",
  "production",
  "mixing",
  "mastering",
  "done",
]);

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id")
    .notNull()
    .references(() => producers.id, { onDelete: "cascade" }),
  // SET NULL so a booking delete doesn't nuke the collab history.
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  stage: projectStage("stage").notNull().default("lead"),
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
  depositPaid: boolean("deposit_paid").notNull().default(false),
  finalPaid: boolean("final_paid").notNull().default(false),
  // Total sessions covered by the product the artist paid for. 1 for
  // single-session products, >1 for multi-session packages. Snapshotted
  // from products.sessionCount at project-creation time so a producer
  // editing the product later can't retroactively change how many free
  // sessions an artist gets. Drives the credit-system flow: future
  // bookings within the same project skip payment as long as
  // count(confirmed bookings) < sessionCount.
  sessionCount: integer("session_count").default(1),
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
  // Original engagement total (minor units) snapshotted at checkout so
  // the Task-7 off-session final charge can derive the second-half
  // amount via `calculateCharges(plan, totalAmountCents)[1]`. Inferring
  // from the deposit invoice alone is ambiguous for odd totals, so we
  // persist this explicitly. Nullable for legacy rows without a plan.
  totalAmountCents: integer("total_amount_cents"),
  // Currency snapshot at booking time. Single source of truth for any
  // post-checkout monetary surface (chargeFinal, modal display) so a
  // mid-engagement product currency change can't desync the modal from
  // the actual charge. Nullable for legacy rows backfilled from invoices.
  currency: text("currency"),
  // Next scheduled charge (from Stripe subscription schedule). Lets the
  // UI show "next charge on ..." without a Stripe API round-trip.
  nextChargeAt: timestamp("next_charge_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // Stamped once by the Autopilot cron's request-testimonial sweep
  // the first time it emails the artist asking for a testimonial on
  // this project. Null = never asked. Ensures idempotency — no double
  // asks on subsequent ticks. Migration 0033 (audit Task 12).
  testimonialRequestedAt: timestamp("testimonial_requested_at", {
    withTimezone: true,
  }),
  // Stamped by project.setStage the first time this row transitions
  // INTO stage='paid'. Idempotent — once set, subsequent setStage
  // calls don't overwrite it. Drives the "Paid" event in the Project
  // Room → Overview "key activity" timeline (replaces the old
  // surrogate-from-latest-activity hint). Stripe-webhook auto-paid
  // flip is left to Phase H. Migration 0005.
  paidAt: timestamp("paid_at", { withTimezone: true }),
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
  // ─── Phase 1 G7 — New Project modal fields ───────────────────────
  // Producer picks one of their store products at create time. SET
  // NULL on delete so archiving a product doesn't nuke the project's
  // engagement history; the row-level priceCents/depositCents
  // snapshots below preserve what was charged.
  productId: uuid("product_id").references((): AnyPgColumn => products.id, {
    onDelete: "set null",
  }),
  // Optional deliverable due-date the producer commits to. Drives the
  // hero countdown + the Calendar's "deadline" markers. Null = no
  // explicit deadline.
  deadlineAt: timestamp("deadline_at", { withTimezone: true }),
  // Snapshot of the engagement total at create-time (minor units).
  // Defaults from product.priceCents in the modal; producer can edit
  // before submit. Stays stable even if the underlying product price
  // changes later — that's the snapshot guarantee. Nullable for legacy
  // rows pre-G7.
  engagementTotalCents: integer("engagement_total_cents"),
  // Snapshot of the upfront deposit (minor units) the modal computed
  // from product.priceCents * depositPct / 100, with optional manual
  // override. Read downstream by the deposit-collection flow so a
  // mid-engagement product price change can't recalculate what the
  // artist owes. Nullable for legacy rows pre-G7.
  depositCents: integer("deposit_cents"),
  // Per-song pricing — populated only when the project was created
  // via a per-song product checkout. songQty is how many songs the
  // artist picked in the SongCountStepper; unitPriceCents is the
  // per-song rate they locked in (after tier discount). Both null
  // for flat-price projects. Denormalised so the producer dashboard
  // can render "Mixing × 5 songs — $750" without re-running tier
  // math against product.volumeTiers (which may have been edited
  // since the booking).
  songQty: integer("song_qty"),
  unitPriceCents: integer("unit_price_cents"),
});
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

// One named track within a project. `artist` is optional credit line
// (e.g. "feat. Someone"). Position orders tracks on the share page.
export const projectTracks = pgTable("project_tracks", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  artist: text("artist"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Per-song workflow stage. Drives the WorkflowStepper on Song Space
  // and the stage pill on Album tracklist rows. Advances when a new
  // version is uploaded with a higher stage; manual override available
  // from the Song Space.
  workflowStage: workflowStage("workflow_stage").notNull().default("brief"),
});
export type ProjectTrack = typeof projectTracks.$inferSelect;
export type NewProjectTrack = typeof projectTracks.$inferInsert;

// Versions stacked under a track. Producers upload V1 → V2 → master.
// The UI sorts by `uploadedAt` desc so the latest is top-of-stack,
// matching Samply's "latest on top" convention. Label is free-text
// (e.g. "Rough Mix", "Mix v2", "Master", "Instrumental").
export const trackVersions = pgTable("track_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  trackId: uuid("track_id")
    .notNull()
    .references(() => projectTracks.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  audioUrl: text("audio_url"), // nullable during upload — filled by audio.completeMultipart
  durationMs: integer("duration_ms"), // optional; we populate when known
  audioR2Key: text("audio_r2_key"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
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
  versionId: uuid("version_id")
    .notNull()
    .references(() => trackVersions.id, { onDelete: "cascade" }),
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
    clerkUserIdx: index("client_contacts_clerk_user_idx")
      .on(t.clerkUserId)
      .where(sql`${t.clerkUserId} IS NOT NULL`),
  }),
);

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
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    trackVersionId: uuid("track_version_id").references(() => trackVersions.id, {
      onDelete: "cascade",
    }),
    commentId: uuid("comment_id").references(() => trackComments.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    // Purchase-flow click-through (SK-37 / BE-1). Forward reference via the
    // lazy AnyPgColumn callback because `purchaseRequests` is declared
    // further down (same pattern as bookings.projectId → projects).
    purchaseRequestId: uuid("purchase_request_id").references(
      (): AnyPgColumn => purchaseRequests.id,
      {
        onDelete: "cascade",
      },
    ),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
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

export const paymentProofStatus = pgEnum("payment_proof_status", [
  "pending",
  "confirmed",
  "rejected",
]);

export const invoices = pgTable(
  "invoices",
  {
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
    paymentPlanProjectId: uuid("payment_plan_project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
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
    // Stamped once by the Autopilot cron's unpaid-reminder sweep the
    // first time it emails the producer about this invoice. Null =
    // never sent. Idempotency key for the cron. Migration 0033 (audit
    // Task 12).
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    // Purchase linkage for confirmed off-app money. Pending/rejected proofs
    // now live only in paymentProofs; these legacy proof columns remain so
    // migration 0023 can preserve rows created by the short-lived model.
    purchaseRequestId: uuid("purchase_request_id").references(() => purchaseRequests.id, {
      onDelete: "set null",
    }),
    // A confirmed off-app proof creates exactly one paid invoice. The
    // unique partial index below makes producer confirmation idempotent.
    paymentProofId: uuid("payment_proof_id").references((): AnyPgColumn => paymentProofs.id, {
      onDelete: "set null",
    }),
    proofFileUrl: text("proof_file_url"),
    proofNote: text("proof_note"),
    rejectionNote: text("rejection_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Gate-2 queue + running-total reads.
    purchaseRequestIdx: index("invoices_purchase_request_idx").on(t.purchaseRequestId),
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
    proofUnique: uniqueIndex("invoices_payment_proof_unique")
      .on(t.paymentProofId)
      .where(sql`${t.paymentProofId} IS NOT NULL`),
  }),
);

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
export const stripeCustomers = pgTable(
  "stripe_customers",
  {
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "cascade" }),
    clientContactId: uuid("client_contact_id")
      .notNull()
      .references(() => clientContacts.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.producerId, t.clientContactId] }),
    customerIdx: index("stripe_customers_customer_idx").on(t.stripeCustomerId),
  }),
);

export type StripeCustomer = typeof stripeCustomers.$inferSelect;
export type NewStripeCustomer = typeof stripeCustomers.$inferInsert;

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

// ─── Purchase flow (SK-37 / BE-1) ──────────────────────────────────
// The artist purchase journey's keystone. A `purchaseRequest` is the
// spine: the artist commits to a product (Gate-1 in), the producer
// approves/declines (Gate 1), then the artist accepts the agreement.
// Money, sessions, and delivery layer on top in BE-2/3/4 — this table
// owns only the request lifecycle + the PRICE-LOCK snapshot so a later
// product edit can't change the terms the artist agreed to.
//
// Reuse, never fork: producerId/clientContactId/productId/projectId/
// bookingId all reference the existing engagement entities. There is no
// users/artists table — an "artist" is a `clientContacts` row, resolved
// per-producer via resolveClientContact(). `projectId`/`bookingId` are
// nullable and populated downstream (project on approve-undo-elapse,
// booking by the BE-3 session slice) so the purchase attaches to the
// SAME project/booking rows the store + calendar flows use.
export const purchaseRequestStatus = pgEnum("purchase_request_status", [
  "pending", // submitted, awaiting producer's Gate-1 decision
  "approved", // producer approved — doubles as AWAITING PAYMENT (BE-2):
  // the artist is choosing a plan / paying off-app
  "verifying", // first proof of payment submitted, awaiting Gate 2
  "paid", // first payment confirmed — sessions unlocked. Later
  // installments live on `invoices` rows and never regress
  // this status; "paid in full" = SUM(paid invoices) ≥ priceCents
  "declined", // producer declined (artist sees a generic message)
]);

export const purchaseRequests = pgTable(
  "purchase_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "cascade" }),
    // The per-producer "artist" row. Resolved from the signed-in Clerk
    // user via resolveClientContact(clerkUserId, producerId). The same
    // human has N clientContact ids across N producers — never a global
    // user id.
    clientContactId: uuid("client_contact_id")
      .notNull()
      .references(() => clientContacts.id, { onDelete: "cascade" }),
    // SET NULL on product purge so the price-locked history survives
    // (mirrors bookings.productId). The *_snapshot columns below are the
    // source of truth for amounts once the request exists.
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    // Populated when the engagement project is created/attached (deferred
    // until the 5-min undo window elapses — links the SAME projects row,
    // never forks one). SET NULL so a project delete keeps the request.
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    // Stamped by the BE-3 session slice when a session is scheduled
    // against this purchase. SET NULL preserves the request on delete.
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    // Human-readable, artist-facing reference (e.g. "SK-7F3QK2"). Minted
    // in the request mutation; the UNIQUE constraint is the collision
    // guard (the mutation retries on the rare clash).
    refNumber: text("ref_number").notNull().unique(),
    status: purchaseRequestStatus("status").notNull().default("pending"),
    // Stamped new Date() on every transition (mirrors
    // bookings.statusChangedAt). approvedAt also anchors the 5-min undo.
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    // Identity snapshot from clientContacts so the row reads sensibly
    // even after a contact archive / SET NULL (matches bookings/projects).
    artistName: text("artist_name").notNull(),
    artistEmail: text("artist_email").notNull(),
    // ─── Price lock (taken at request time) ───────────────────────────
    // All downstream amount math reads THESE, not the live product —
    // closing the gap where payment.getPaymentDetails recomputes from
    // the live products.paymentPlans[0].
    productNameSnapshot: text("product_name_snapshot").notNull(),
    // Locked headline amount in minor units. flat/bundle → priceCents;
    // per_song → songQty × unitPriceCents; hourly → the locked rate.
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull(),
    // The single chosen plan from products.paymentPlans — reuses the
    // exported PaymentPlan union verbatim (no new shape).
    paymentPlanSnapshot: jsonb("payment_plan_snapshot").$type<PaymentPlan>().notNull(),
    // Every plan offered at request time. S7 reads only this frozen list,
    // so later product edits cannot change the artist's agreement.
    paymentPlanOptionsSnapshot: jsonb("payment_plan_options_snapshot").$type<PaymentPlan[]>(),
    // Null while the request carries only its provisional default. S7 stamps
    // this when the artist explicitly chooses, before any proof is accepted.
    paymentPlanChosenAt: timestamp("payment_plan_chosen_at", {
      withTimezone: true,
    }),
    // Per-song parity with bookings.songQty/unitPriceCents — populated
    // only for pricingModel='per_song' (or the locked rate for hourly).
    songQty: integer("song_qty"),
    unitPriceCents: integer("unit_price_cents"),
    // Snapshot of products.contractUrl so a later product edit can't
    // change the agreement the artist is asked to accept. Nullable — the
    // agreement is an inline checkbox; the URL is the optional reference.
    contractUrlSnapshot: text("contract_url_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Producer hub list: filter by producer + status, newest first.
    producerStatusIdx: index("purchase_requests_producer_status_idx").on(
      t.producerId,
      t.status,
      t.createdAt,
    ),
    // "one pending request per (artist, producer)" guard reads this.
    contactStatusIdx: index("purchase_requests_contact_status_idx").on(t.clientContactId, t.status),
  }),
);
export type PurchaseRequest = typeof purchaseRequests.$inferSelect;
export type NewPurchaseRequest = typeof purchaseRequests.$inferInsert;

// Private proof uploads are not invoices. A pending/rejected proof must
// never appear in revenue, outstanding balance, or reminder queries. Only
// confirmation creates a paid invoice linked through paymentProofId.
export const paymentProofs = pgTable(
  "payment_proofs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseRequestId: uuid("purchase_request_id")
      .notNull()
      .references(() => purchaseRequests.id, { onDelete: "cascade" }),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    kind: text("kind").notNull(),
    // Proof evidence is accepted only from the private docs bucket. Migration
    // 0023 fails closed instead of importing a legacy public-audio object.
    storageBucket: text("storage_bucket").$type<"docs">().notNull().default("docs"),
    storageKey: text("storage_key").notNull().unique(),
    // ETag of the server-finalized object. Nullable only so an interrupted
    // preview deployment can be diagnosed safely; every new proof writes it
    // and review refuses a missing/mismatched value.
    objectEtag: text("object_etag"),
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
    purchaseStatusIdx: index("payment_proofs_purchase_status_idx").on(
      t.purchaseRequestId,
      t.status,
    ),
    producerStatusCreatedIdx: index("payment_proofs_producer_status_created_idx").on(
      t.producerId,
      t.status,
      t.createdAt,
    ),
    // One proof under review per purchase. This is the final database-level
    // race guard after the transaction/advisory lock in the API.
    pendingPerRequest: uniqueIndex("payment_proofs_one_pending_per_request")
      .on(t.purchaseRequestId)
      .where(sql`${t.status} = 'pending'`),
  }),
);
export type PaymentProof = typeof paymentProofs.$inferSelect;
export type NewPaymentProof = typeof paymentProofs.$inferInsert;

// One row per artist acceptance of a producer's agreement, against
// exactly one purchaseRequest. PDF-signing (Documenso) was removed in
// Phase 1 in favour of an inline checkbox — so `agreementUrl` is the
// optional snapshot of the referenced contract (products.contractUrl),
// and the PRESENCE of `acceptedAt` is the "accepted" flag (matching the
// trackVersions.approvedAt idiom). UNIQUE(purchaseRequestId) makes
// acceptance idempotent.
export const agreementAcceptances = pgTable(
  "agreement_acceptances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseRequestId: uuid("purchase_request_id")
      .notNull()
      .references(() => purchaseRequests.id, { onDelete: "cascade" }),
    producerId: uuid("producer_id")
      .notNull()
      .references(() => producers.id, { onDelete: "cascade" }),
    clientContactId: uuid("client_contact_id")
      .notNull()
      .references(() => clientContacts.id, { onDelete: "cascade" }),
    // Audit: the Clerk userId that clicked accept (ctx.clerkUserId).
    acceptedByClerkUserId: text("accepted_by_clerk_user_id").notNull(),
    agreementUrl: text("agreement_url"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqPerRequest: unique("agreement_acceptances_request_unique").on(t.purchaseRequestId),
  }),
);
export type AgreementAcceptance = typeof agreementAcceptances.$inferSelect;
export type NewAgreementAcceptance = typeof agreementAcceptances.$inferInsert;
