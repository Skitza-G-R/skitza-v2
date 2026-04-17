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

// ─── Project Rooms (Samply-equivalent) ──────────────────────────────
// A project room is the post-booking collaboration surface. One
// confirmed booking → one project room; the artist accesses it via
// a signed share_token (shareable URL). The token's sha256 is stored,
// never the raw token itself — matches magicLinks privacy posture.
//
// depositPaid + finalPaid are v1 proxies for Stripe state (Phase C
// wires the actual flip). Download buttons on the artist side are
// gated by finalPaid; the deposit gate is informational only.
export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  // SET NULL so a booking delete doesn't nuke the collab history.
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  shareTokenHash: text("share_token_hash").notNull().unique(),
  artistName: text("artist_name").notNull(),
  artistEmail: text("artist_email").notNull(),
  depositPaid: boolean("deposit_paid").notNull().default(false),
  finalPaid: boolean("final_paid").notNull().default(false),
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

// ─── Contracts v2 (PDF editor, DocuSign/Dropbox Sign-equivalent) ─────
// A four-table model:
// 1. contracts — each uploaded PDF (draft) or sent contract instance.
//    PDF templates ARE contracts in draft state (re-uploadable from
//    their R2 key). No separate templates table.
// 2. contract_recipients — signer(s) with routing order + per-recipient
//    token hash for the signing link.
// 3. contract_fields — editor-placed fields on the PDF pages (signature,
//    initial, date, text, checkbox, dropdown, number). Coords are
//    percentage-of-page (0..100) so they survive PDF re-render.
// 4. contract_events — audit trail (created, sent, viewed, field_filled,
//    signed, completed, cancelled, downloaded).
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
  dealId: uuid("deal_id"), // FK wired in Phase C (deals rename). Nullable for now.
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
