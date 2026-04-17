import { pgTable, text, timestamp, jsonb, uuid, integer } from "drizzle-orm/pg-core";

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
  audioUrl: text("audio_url").notNull(),  // for v1, an external URL (Spotify CDN, R2 later)
  artworkUrl: text("artwork_url"),
  position: integer("position").notNull().default(0), // for ordering
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
