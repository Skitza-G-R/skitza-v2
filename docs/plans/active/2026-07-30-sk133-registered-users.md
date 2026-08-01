# SK-133 — Registered users and profiles

## Outcome

Give Gili one fast, read-only place to find every registered Clerk person and understand their Skitza roles and business context. Producer-created contacts without a Clerk user ID never enter this surface.

## Data model

- Add `registered_accounts` in migration `0037`, keyed by `clerk_user_id`.
- Store only the minimum Clerk lifecycle snapshot needed by support: primary email, display name, verification state, provider state, signup, last sign-in, provider update time, and sync time.
- Backfill only existing `producers.clerk_user_id` and non-null `client_contacts.clerk_user_id` mappings. Mark them `needs_sync`; do not invent provider-active, verified-email, signup, or last-sign-in facts.
- Treat `user.deleted` as a terminal minimal tombstone: clear copied PII and retain only the Clerk ID plus lifecycle timestamps needed for reconciliation.
- Extend the already verified Clerk webhook for `user.created`, `user.updated`, and `user.deleted`. Ignore older lifecycle snapshots and make exact retries idempotent.

## Read architecture

- Bind every read service to one already-resolved Live or Test database URL. The selected environment is passed explicitly and mismatches fail closed.
- Build one database query for the directory with server-side search, filters, allowlisted sorting, a stable Clerk-ID tie-break, count, and 25-row pagination.
- Calculate roles from real relationships: Producer from `producers`, Artist only from an active `client_contacts` relationship (`archived_at IS NULL`), and Both from both facts. Archived studio relationships remain visible in Business history but do not grant the current Artist role. `producer_archived_at` changes producer-side list placement only and does not remove Artist.
- Load the profile header plus exactly one selected tab:
  - Summary: identity, lifecycle, onboarding, activation, and provider state.
  - Activity: safe named domain-event metadata plus a bounded fallback of safe business record creation facts when an older flow did not emit a domain event.
  - Business: role-aware counts and studio relationships.
  - Support: admin notes/history, provider references, and sensitive-content metadata only.
- Private contact notes never enter the initial HTML, server-component props, or prefetched profile payload. A separate same-origin founder-only POST first records an audited reason and only then returns the requested content with `private, no-store`.

## Interface

- Preserve the approved Skitza Admin palette, type, shell, and Live/Test ribbon.
- Signature: the environment ribbon remains the strongest visual signal; the Users page adds a quiet `Real data · Read only` ledger label.
- Directory: one visible search field, four role choices, status, and one inline `More filters` disclosure for onboarding, activation, signup, and meaningful activity.
- URL owns directory state: `q`, `role`, `status`, `onboarding`, `activation`, `signup`, `activity`, `sort`, `dir`, and the opaque `cursor`.
- Desktop uses a compact table; 390px and 360px use labelled cards. Profile navigation uses links and a compact identity header.
- Empty, loading, not-found, and error states say what happened and what Gili can do next.

## Explicit exclusions

No suspend/reactivate, public-page change, onboarding correction, email retry, deletion, payment operations, analytics, health work, impersonation, provider mutation, production migration, deployment, or authentication bypass.
