# Skitza Booking v1 — Design

**Date:** 2026-04-17
**Status:** Design (approved by user — "make yourself a plan, implement on the software")
**Phase:** B, feature 1 of the 6-step flow

## Context

Booking is the second step in Skitza's canonical pipeline:
`Lead → Booking → Session → Invoice → Delivery → Follow-up`. It's what turns a magic link click into a confirmed paid engagement. Calendly was the original Task K in the Phase 1 plan, but the user wants a **native music-producer-specific** booking system, not a Cal.com Atoms wrapper.

## Positioning vs. Calendly

| Calendly | Skitza Booking v1 |
|---|---|
| Events = 30-min meetings | **Packages** = services (Full Production, Mix & Master, Single Session) with price + session count |
| Payment optional | Deposit expected (v2 enforces via Stripe; v1 collects "will pay after confirmation" intent) |
| Meeting-first vocab | Session-first vocab ("session," "studio availability," "studio closed") |
| Availability = work hours | Availability = studio blocks (morning/evening per weekday + override dates) |
| No contract linkage | v2: contract auto-sent + signed before session |
| Corporate UI | Warm cream + amber, Syne + Outfit, matches landing |

## User flows (v1)

### Producer (setup)

1. Visits `/dashboard/booking`.
2. **Packages tab**: creates 1-N packages (name, description, duration, session count, price, deposit %).
3. **Availability tab**: sets weekly availability per weekday. Each day can have up to 2 blocks (morning / evening). Default duration + min lead time.
4. **Requests tab**: sees incoming pending requests, approves or rejects.
5. **Upcoming tab**: sees confirmed sessions in chronological order.

### Visitor (booking)

1. Lands on `/p/<slug>` (public portfolio) → sees new "Book a session" CTA.
2. Clicks → `/p/<slug>/book` shows packages as cards.
3. Selects a package → slot picker shows next 14 days of available slots (respecting availability + existing confirmed bookings + min lead time).
4. Clicks a slot → form (name, email, optional phone, optional notes).
5. Submits → "Request submitted — [producer] will confirm within 24h. You'll get an email at [email]."
6. Producer approves from dashboard → booking becomes CONFIRMED. (No email yet — producer manually tells the client for v1.)

## Non-goals for v1 (explicitly deferred)

- Stripe deposit enforcement (deferred to Phase C with Resend + Stripe).
- Digital contract signing (Phase C).
- Automated email/SMS notifications (needs Resend; Phase C).
- Google Calendar sync (Phase C+).
- Reschedule / cancel via self-serve link (Phase C).
- Artist-side accounts (Phase C).
- Visitor-timezone conversion — v1 displays slots in the **producer's** timezone with a visible label ("times shown in Europe/Berlin"). Visitor TZ conversion arrives in v2.
- Buffer times, per-day booking caps, complex availability rules — v1 uses sensible defaults (15-min increments, 60-min session default, 12h min notice, 14-day forward window, no buffers).
- Multi-session package flows — v1 books one session at a time. A 4-session package means the client books session 1 and their `session_count` is tracked on the booking row for future UX.
- Location / studio-address UI — v1 displays producer's studio name (from profile) only.

## Schema

Three new tables under `packages/db/src/schema.ts`:

```ts
// Services a producer offers. Price in minor units (cents) so we stay
// integer-safe across currencies. Deposit % is 0-100 (inclusive 0).
export const packages = pgTable("packages", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  durationMin: integer("duration_min").notNull(),            // per session
  sessionCount: integer("session_count").notNull().default(1),
  priceCents: integer("price_cents").notNull().default(0),   // 0 = free (discovery)
  currency: text("currency").notNull().default("USD"),
  depositPct: integer("deposit_pct").notNull().default(0),   // 0-100
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),        // ordering
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Weekly recurring availability. One row per (producer, weekday, block).
// `weekday`: 0 (Sun) through 6 (Sat) — matches JS Date.getDay().
// `startMin` / `endMin`: minutes from start of day (0..1440). Inclusive
// start, exclusive end.
export const availabilityBlocks = pgTable("availability_blocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  startMin: integer("start_min").notNull(),
  endMin: integer("end_min").notNull(),
});

// Bookings span both "pending" (visitor submitted, producer hasn't
// acted) and "confirmed" (producer approved). Rejected/cancelled also
// live here with different status for audit.
export const bookingStatus = pgEnum("booking_status", ["pending", "confirmed", "rejected", "cancelled"]);

export const bookings = pgTable("bookings", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  packageId: uuid("package_id").references(() => packages.id, { onDelete: "set null" }),
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
```

Rationale:

- **`packages`** is the "product" entity. Separate from `bookings` because one package can generate many bookings. `position` makes reordering cheap (mirror portfolio tracks).
- **`availabilityBlocks`** is deliberately simple: 0-2 rows per weekday. No cron-style expressions, no rule language. Extensibility for overrides lands as a `availability_overrides` table later (date, closed bool, start_min, end_min).
- **`bookings.status` as enum** prevents typo drift. Storing rejected/cancelled in-place (not a separate table) keeps the producer's audit trail intact and lets the dashboard show "3 rejected this month" if we ever want.
- **Price in cents** because sooner-or-later we hit Stripe and it integers in minor units.

## tRPC router (`apps/web/src/server/trpc/routers/booking.ts`)

Procedures (all producer-scoped unless noted):

**Package procedures:**
- `booking.packages.list` (producer) — returns all packages sorted by position
- `booking.packages.create` (producer) — name, description, duration, sessionCount, priceCents, currency, depositPct
- `booking.packages.update` (producer) — partial patch
- `booking.packages.delete` (producer) — soft via `active = false`; hard delete would cascade to bookings

**Availability procedures:**
- `booking.availability.list` (producer) — returns 0-14 rows (2 per weekday max)
- `booking.availability.setWeek` (producer) — replaces the whole week atomically (easier UX than per-row editing)

**Booking procedures:**
- `booking.listForProducer` (producer) — filtered by status, paginated
- `booking.request` (**public**, by slug) — visitor submits a request. Zod-validated. Rate-limited per IP. Returns `{ ok: true, id }`.
- `booking.confirm` / `booking.reject` (producer) — status transitions with `statusChangedAt` bump
- `booking.slotsFor` (public, by slug + packageId + start date) — returns available 15-min start times for the next 14 days. Computes from availability blocks − existing confirmed bookings − min lead time.

## Public UX

- `/p/<slug>/book` = new public route inside the `(public)` group (so it inherits chrome-dark theming).
- Producer's "Book a session" CTA at the top of `/p/<slug>` portfolio page links to `/p/<slug>/book`.
- 3-step booking flow: **Select package → Pick slot → Submit**.
- Each step has its own URL (`/book` → `/book/pkg/<id>` → confirmation) or lives in one page with search-param state. Chose single page with URL query state (`?pkg=<id>&slot=<iso>`) so refresh preserves progress + back button works.

## Producer UX

- `/dashboard/booking` adds a 4th tab to the shell nav (after "Lead Links").
- Sub-routes via tab-style inner nav: **Overview | Packages | Availability | Requests**.
- Page layout: tab bar at top, content below. Tab state lives in URL (`/dashboard/booking?tab=packages`) for link-sharing.

## Non-obvious decisions + why

1. **Weekday as int 0–6.** Matches JS `Date.getDay()`. Saves converting between "Mon" strings and numbers in every query.
2. **Minutes from start of day, not `time` type.** PG has `time`, but we need integer arithmetic for slot math and integers are trivially serializable to the client. Tradeoff: we lose PG's built-in time validation, so zod/JS clamps to `[0, 1440]`.
3. **Slot picker defaults to 15-min increments.** Calendly's default. Smaller increments feel spammy for a 60-min session; bigger (30 min) misses the "3:15pm is open" case.
4. **No visitor timezone conversion in v1.** Honest punt: TZ handling is a rabbit hole. Booking page displays a bold "Times shown in Europe/Berlin (producer's studio timezone)" banner. Visitor is expected to handle their own math. v2 adds `Intl.DateTimeFormat` on the client.
5. **Rate limit public `booking.request` endpoint.** Same primitive as `magicLink.issue` + `waitlist.join`. 5/min/IP. Prevents someone spamming 100 fake requests.
6. **No Artist accounts yet.** `artist_email` is free-text. Phase C upgrades: when an existing Clerk user's email matches, link the booking to their user_id for cross-session view.

## Success criteria

- Producer can create a package + set weekly availability + receive a booking request + approve it — all from the dashboard.
- Visitor (signed out, incognito) can land on `/p/skitza-smoke-test`, click "Book a session", pick a package + slot + submit a request, see a confirmation page.
- Row appears in Neon `bookings` table with status `pending`.
- Producer sees it in `/dashboard/booking?tab=requests` and can confirm → status flips to `confirmed`.
- 95+ existing tests still pass; 8+ new tests for package CRUD, availability set, booking request, slot computation.
- Typecheck clean, lint clean, build succeeds.

## What this unlocks

Once Booking v1 ships, the next three features in the 6-step flow have natural homes:

- **Contracts**: attach `contract_template_url` to a package; auto-generate a signable PDF on booking confirmation.
- **Payments**: add Stripe Connect → `deposit_paid_at` column on bookings → CONFIRMED requires paid deposit.
- **Project Rooms**: auto-create a project room when a booking becomes CONFIRMED, seeded with the package's session_count sessions.

Each is additive, not structural. That's the test of good schema.
