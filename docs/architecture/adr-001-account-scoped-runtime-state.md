# ADR 001: Account-scoped runtime state

- Status: Accepted
- Date: 2026-07-24
- Issue: SK-111

## Context

Skitza's authenticated producer and artist pages are rendered by Next.js server
components. A small amount of safe UI state should survive reloads and brief
offline periods without allowing one Clerk account, role, or studio to see
another account's content.

Service-worker caches remain unsuitable for authenticated HTML, RSC, API,
audio, booking, payment, or availability data. Persistence therefore needs to
be local, narrow, synchronous, and independently scoped from the server render.

## Decision

Use versioned `localStorage` envelopes behind a typed runtime-state module.

- Every key contains the schema version, Clerk user ID, role, producer/studio
  context, route, and an explicit allowlisted slot.
- Each slot has its own payload validator. Unknown slots and extra fields are
  rejected.
- Booking, payment, availability, audio, signed URLs, API/auth data, and other
  live-action state are never persisted.
- A client provider compares the server-authorized identity with Clerk's live
  identity. It hides stale children during an identity mismatch and
  synchronously clears the previous user's keys on sign-out or account switch.
- Safe view snapshots may render cached-first and refresh silently. A loading
  skeleton is reserved for a truly unseen view; existing content is never
  replaced by a refresh spinner.
- View and navigation snapshots expire after seven days, with navigation
  state limited to the 20 most recently viewed routes. Drafts expire after
  30 days and are removed when submitted or explicitly discarded.
- Navigation restoration stores only approved authenticated routes, safe query
  filters, scroll position, and a bounded back stack.
- Music route metadata may be restored, but audio, signed delivery URLs, and
  player payloads are not view-cache fields.
- Draft persistence is opt-in by form and field. The initial producer settings
  slice stores only the display-name draft.
- Optimistic rollback is limited to ordinary safe edits. Booking, payment,
  availability, and live actions require an online server confirmation and are
  blocked clearly while offline.

## Consequences

Adding a persisted view or draft requires an allowlist entry, a strict
validator, and privacy tests. The initial rollout covers one producer view, one
artist view, the producer display-name draft, and the shared producer/artist
song-comment form; broader route adoption is left to SK-113 and SK-114. Server
data remains authoritative, and no database or service-worker cache policy
changes are required.
