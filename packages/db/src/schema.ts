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
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

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

// ─── Booking v1 ─────────────────────────────────────────────────────
// A producer's offered services. Price in minor units (cents). `active`
// is a soft-delete (false = hidden from public + dashboard lists) so
// we never lose historical bookings' package names. `position` gives
// drag-free ordering.
export const packages = pgTable("packages", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  durationMin: integer("duration_min").notNull(),            // per session
  sessionCount: integer("session_count").notNull().default(1),
  priceCents: integer("price_cents").notNull().default(0),   // 0 = free / discovery
  currency: text("currency").notNull().default("USD"),       // ISO 4217
  depositPct: integer("deposit_pct").notNull().default(0),   // 0..100
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
  // Booking v2 additions — classification + per-package policy so a
  // single producer can sell mixing (2h, remote, no deposit) alongside
  // tracking (4h, studio, 50% deposit) without either overflowing into
  // the other's slot grid.
  // `kind` is free-text so we're not locked to an enum — common values:
  // "session" | "mixing" | "mastering" | "producing". UI offers a
  // dropdown + "Other" escape hatch.
  kind: text("kind").notNull().default("session"),
  // Where the session physically happens. Surfaces as a pill on the
  // public booking card so visitors don't show up to a locked door.
  locationType: text("location_type").notNull().default("studio"), // "studio" | "remote" | "client_space"
  // Gap the producer wants between back-to-back sessions. Added to the
  // existing booking's duration when checking overlap.
  bufferMinutes: integer("buffer_minutes").notNull().default(0),
  // Minimum notice in hours. Previously hard-coded at 12; now per-pkg
  // so "mixing revision calls" (2h lead) differ from "4h tracking"
  // (48h lead).
  minLeadHours: integer("min_lead_hours").notNull().default(12),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Package = typeof packages.$inferSelect;
export type NewPackage = typeof packages.$inferInsert;

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
  // packageId nullable + SET NULL on delete so a package purge doesn't
  // obliterate the historical booking. We copy package snapshots onto
  // the booking row (see packageNameSnapshot) to preserve history too.
  packageId: uuid("package_id").references(() => packages.id, { onDelete: "set null" }),
  packageNameSnapshot: text("package_name_snapshot"),
  // Nullable link to the Deal this booking feeds. Existing rows are
  // back-filled to NULL; C.2 will wire confirm → createDeal so new
  // confirmed bookings get a deal attached automatically. SET NULL on
  // deal delete so the booking history survives.
  dealId: uuid("deal_id").references((): AnyPgColumn => deals.id, { onDelete: "set null" }),
  artistName: text("artist_name").notNull(),
  artistEmail: text("artist_email").notNull(),
  artistPhone: text("artist_phone"),
  notes: text("notes"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  durationMin: integer("duration_min").notNull(),
  status: bookingStatus("status").notNull().default("pending"),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;

// ─── Deals (unified Booking + Contract + Project Room) ─────────────
// A Deal ties every artifact for one engagement under a single row:
// the booking that kicked it off, the contract that formalised it,
// the project room where files + feedback live, and the client cache
// (name/email snapshot so we can display a recent-activity feed even
// after a booking is deleted). `stage` moves the deal through a
// lightweight funnel (lead → booked → contract_sent → in_production →
// final_review → paid → archived). We rename the legacy `projects`
// table (and its child `project_tracks`) to `deals` / `deal_tracks`
// so the data model matches the language. The share_token surface
// and depositPaid/finalPaid v1 proxies survive verbatim.
export const dealStage = pgEnum("deal_stage", [
  "lead",          // potential, not yet booked
  "booked",        // booking created
  "contract_sent", // contract sent to artist
  "in_production", // actively working
  "final_review",  // final mix sent, awaiting approval
  "paid",          // final invoice paid
  "archived",      // closed
]);

export const deals = pgTable("deals", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  // SET NULL so a booking delete doesn't nuke the collab history.
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  stage: dealStage("stage").notNull().default("lead"),
  // Client identity snapshot — duplicated onto the deal so the feed
  // still renders a sensible row after a booking row is purged.
  clientName: text("client_name"),
  clientEmail: text("client_email"),
  shareTokenHash: text("share_token_hash").notNull().unique(),
  // Legacy artistName/artistEmail kept for now — C.2 will fold them
  // into clientName/clientEmail, but today they're required by the
  // share-page render path and we avoid churning them here.
  artistName: text("artist_name").notNull(),
  artistEmail: text("artist_email").notNull(),
  depositPaid: boolean("deposit_paid").notNull().default(false),
  finalPaid: boolean("final_paid").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;

// One named track within a deal. `artist` is optional credit line
// (e.g. "feat. Someone"). Position orders tracks on the share page.
export const dealTracks = pgTable("deal_tracks", {
  id: uuid("id").defaultRandom().primaryKey(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  artist: text("artist"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type DealTrack = typeof dealTracks.$inferSelect;
export type NewDealTrack = typeof dealTracks.$inferInsert;

// Versions stacked under a track. Producers upload V1 → V2 → master.
// The UI sorts by `uploadedAt` desc so the latest is top-of-stack,
// matching Samply's "latest on top" convention. Label is free-text
// (e.g. "Rough Mix", "Mix v2", "Master", "Instrumental").
export const trackVersions = pgTable("track_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  trackId: uuid("track_id").notNull().references(() => dealTracks.id, { onDelete: "cascade" }),
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
  dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
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
// producer creates a deal, we upsert an entry here so send-forms can
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
  dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
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
