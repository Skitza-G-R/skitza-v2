# Batch B — Booking page feature parity follow-ups

Items deferred out of the Batch B delivery (see commits 782ec03,
6793fd2, c23784a, 3041aef, 674838b on `feat/today-cockpit`). Each
entry is self-contained; none block the Batch B ship.

## 1. Google Calendar OAuth integration

**Status:** UI stub shipped (commit 3041aef).

What's there: a "Google Calendar" badge at the top of the Sessions tab
showing "Not connected" with a Connect CTA that opens a "coming soon"
modal with a "Notify me" button.

What's needed for real:
- OAuth 2.0 flow (Google Cloud Console app, consent screen, scopes:
  `calendar.readonly` at minimum; `calendar.events` if we want to
  push Skitza bookings into the producer's calendar).
- Per-producer refresh token storage — new `producer_gcal_tokens`
  table (refresh_token ciphertext, access_token expiry, scope list,
  last_synced_at).
- Sync worker: fetch busy blocks from Google on a cron + close
  matching slots in our slot-grid calculation.
- Flip the `GCalSyncBadge` status prop to "connected" based on the
  real connection check in `page.tsx`.
- Honor the `Disconnect` path (currently a toast-only stub).
- Wire the `Notify me` button in the waitlist modal to a real signal
  source — either the existing landing-page `waitlist` table with a
  `source: "gcal-interest"` tag, or a new `feature_interest` table.

Files involved:
- `apps/web/src/app/(app)/dashboard/booking/gcal-sync-badge.tsx`
- `apps/web/src/app/(app)/dashboard/booking/page.tsx` (hard-coded
  `status="not_connected"`)
- `apps/web/src/server/trpc/routers/booking.ts` (slot-compute would
  need to intersect with Google busy blocks before emitting slots)

## 2. Cancellation policy enforcement

**Status:** Column shipped (migration 0026), value stored, UI editor
shipped (commit c23784a). Enforcement deferred.

What's there: `producers.cancellation_policy_hours` (int, default 24)
surfaced in the `PoliciesEditor` under the Sessions tab. A TODO
comment sits in `booking.publicRequest` at the booking insert site.

What's needed for real:
- Artist-initiated cancel flow — right now the only cancel surface is
  producer-side (the `booking.reject` router) or Clerk-mediated from
  the artist app. Artists need a self-serve "cancel my session" button
  on their `ArtistAppointments` view.
- Enforcement point: the artist cancel mutation reads
  `producers.cancellation_policy_hours`, computes
  `startsAt - now < policy_hours * 3600 * 1000`, and if true
  refuses with a TRPCError (`PRECONDITION_FAILED`, message:
  "Cancellations must be at least {hours}h in advance").
- Surface the policy in the booking confirmation email (currently
  the email templates don't mention it).
- Optional: "cancel with fee" flow — if the artist cancels inside the
  window but still wants to proceed, charge a partial fee via the
  existing deposit on the booking.

Files involved:
- `apps/web/src/server/trpc/routers/artist.ts` (needs `cancelMyBooking`)
- `apps/web/src/server/trpc/routers/booking.ts` (TODO marker in
  `publicRequest` insert path)
- `apps/web/src/server/email/send.tsx` (+ email template renderers in
  the same directory) for the policy copy.

## 3. Default session duration prefill on new products

**Status:** Column shipped (migration 0025), value stored, UI picker
shipped (commit 782ec03).

What's there: `producers.default_session_min` (int, default 60),
editable from the Sessions tab's DurationPicker.

What's needed to complete the loop: when the producer creates a new
package via the PackageForm, prefill `durationMin` from the producer's
`default_session_min` so "2h" doesn't have to be re-typed every time.

Files involved:
- `apps/web/src/app/(app)/dashboard/booking/package-form.tsx`
- `apps/web/src/app/(app)/dashboard/settings/settings-form.tsx` (if
  the settings onboarding wizard hits this code path).

Low priority — the picker writes the value; consumers just haven't
been updated to read it yet.

## 4. Apply Drizzle migrations 0025 + 0026 to production

Migrations `0025_default_session_min.sql` and `0026_booking_policies.sql`
are in-tree but `packages/db/drizzle/meta/_journal.json` hasn't been
regenerated past 0018. User manages Neon / production DB separately
(noted in the Batch B task) — the SQL files are ready to be applied
via `drizzle-kit` or direct `psql` at deploy time.

## 5. Weekly schedule grid interactivity

**Status:** Read-only grid shipped (commit 674838b).

What's there: a visual grid on the Weekly tab showing availability
windows (soft primary-color blocks) with confirmed bookings overlaid
as solid ticks. Read-only — producers still edit on the Sessions tab.

What could come next:
- Click-to-add — clicking an empty slot in the grid spawns a new
  availability window at that start time on that weekday.
- Drag-to-resize — grabbing the top/bottom edge of a window extends
  or shortens it, with live validation against the non-overlap rule
  already enforced server-side.
- Click a confirmed session → navigate to the booking's detail page
  (or open a side-drawer with the booking summary + actions).

Out of Batch B scope; tracked here so the grid doesn't atrophy into a
dead-end view.
