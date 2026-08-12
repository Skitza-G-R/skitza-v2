# Producer invitation access and public-site rollout

**Status:** Accepted
**Date:** 12 August 2026
**Decider:** Gili Asraf
**Linear:** SK-229

**Local implementation state:** preserved in an isolated worktree and rebased
onto exact production-stable `v3-clean` commit `2208049b`. Local code and
PostgreSQL 17 migration verification are complete. Keep migration 0049,
production settings, `ACCESS_TOKEN` removal, and Google verification behind
their explicit release gates below.

## Goal

Make the Skitza website public for Google verification while keeping Producer
access invitation-only and Artist signup available through Producer join links.

## Locked product rules

1. Clerk stays in Public mode. Restricted mode is global and would also block
   Artists.
2. Clerk application invitations are reserved for Producer access.
3. A new Producer receives a Clerk invitation from Gili.
4. An existing Artist becomes a Producer only after Gili sends a Clerk
   invitation to the exact verified email used by that Artist's Clerk account.
5. The same Clerk user may hold Artist and Producer memberships. Adding
   Producer membership never deletes or replaces Artist access.
6. **Become a Producer** is informational until an invitation is accepted. It
   does not grant access or start Producer onboarding.
7. An ordinary Clerk signup, `?intent=create-studio`, a browser value, or
   `unsafe_metadata` is never proof of Producer authorization.
8. Artist access is written only by the authenticated join continuation after
   it rechecks the exact Clerk user, verified email, and target Producer. A
   signed webhook synchronizes account lifecycle but does not grant either role.
9. The production launch token is removed only after the Producer gate and
   protected-route checks pass.

## Clerk operating flow

### New person becoming a Producer

Gili creates an application invitation in Clerk Dashboard. The person accepts
the Clerk email, Skitza verifies the accepted invitation on the server, creates
one Producer membership, and opens Producer onboarding.

### Existing Artist becoming a Producer

The standard Clerk Dashboard form normally rejects an email that already owns
a Clerk account. Skitza therefore needs one private, Gili-only action that calls
Clerk's Backend API with `ignoreExisting: true`. Clerk still generates and sends
the invitation email and link.

The Artist accepts with the same account. Skitza verifies the invitation, adds
one Producer membership, preserves all Artist memberships, and exposes the
existing role switcher.

The admin invitation sender must pass Clerk an explicit application redirect.

- `ADMIN_LIVE_WEB_APP_URL` is pinned to `https://skitza.app`.
- `ADMIN_TEST_WEB_APP_URL` is the distinct HTTPS origin of the isolated Test
  web deployment.

Clerk appends the secret invitation ticket to that origin&apos;s `/sign-up` page.
If the link opens while another Clerk session is active, Skitza shows an
explicit account switch, safely signs that session out, and returns to the same
local invitation URL so Clerk can consume the ticket. The server-rendered page
never serializes the ticket into component props.
The Live/Test URL, database, Clerk secret, and Clerk instance bindings must all
describe the same selected environment. Revoke any marked pending invitation
created before this redirect binding before running the real acceptance test;
the safe reuse path intentionally does not replace an existing invitation.

Deleting the Artist account, asking for a second email, or guessing that two
emails belong to one person is not an accepted workaround.

## Authorization rule

Producer membership may be created only when the server proves all of the
following:

- the Clerk application invitation exists and is accepted;
- it is not expired or revoked;
- the invited email matches a verified email on the authenticated Clerk user;
- that invitation/grant has not already been applied; and
- the check runs in trusted server code.

The role grant must be idempotent so retries, simultaneous requests, or delayed
webhooks cannot create duplicate Producer rows. Webhooks may synchronize state,
but an asynchronous webhook is not the only immediate authorization check.
Never store or log the secret invitation ticket.
Application telemetry redacts the case-insensitive `__clerk_ticket` query/key
across PostHog and every Sentry payload channel. Browser analytics and replay
are disabled while an invitation-ticket URL is open. Sentry Replay is disabled
globally for this release because the installed SDK can retain a raw URL before
page code stops recording; error and performance telemetry remain enabled. The global
`Referrer-Policy: no-referrer` also protects direct and client-side navigation,
so same-origin telemetry proxies cannot receive the ticket in a Referer header.

## User flows

### Artist signup

Producer shares `/join/[slug]` -> Artist signs up -> Skitza validates the target
Producer -> Artist membership/connection is created -> no Producer membership.

### Uninvited Artist clicks Become a Producer

Show: **Producer access is invitation-only. Use the invitation email sent by
Skitza.** Nothing else changes.

### Direct signup without a valid Producer invitation

The person cannot create a Producer or enter Producer onboarding. If a generic
Clerk account exists without an Artist join or accepted Producer invitation, it
has no application role and cannot enter either app workspace.

## Failure and recovery rules

- Wrong signed-in account or email mismatch: deny and explain how to switch to
  the invited account.
- Expired or revoked invitation: deny Producer access; Gili can send a new one.
- Reused or double-clicked invitation: no duplicate role or Producer record.
- Forwarded invitation: matching verified email is still required.
- Signed-in and signed-out existing-Artist acceptance must both be tested in the
  exact Clerk production configuration.
- A later email change does not remove an already granted role because the
  durable membership is tied to Clerk user ID.
- Revoking the Clerk invitation after its accepted grant does not silently
  remove Producer access. Invitation acceptance is a one-time authorization;
  revoking an existing Producer is a separate founder action.
- Historical or non-Producer invitations must not authorize a role. Reserving
  application invitations for Producers and recording the verified grant is the
  migration boundary.
- Incomplete Producer onboarding keeps Artist access and shows Finish studio
  setup only after Producer membership exists.

## Route policy

Public without application membership:

- `/`, `/about`, `/privacy`, `/terms`, and `/sign-in`;
- `/join/[slug]` and its dedicated Artist signup continuation;
- the Producer invitation entry/acceptance flow; and
- existing unguessable tokenized listening routes.

Membership protected:

- Producer dashboard, projects, settings, and onboarding;
- Artist platform and Artist welcome routes; and
- Google Calendar connection, which remains Producer-only.

Google OAuth callbacks and webhooks remain externally reachable but validate
their signed state, browser binding, and stored channel secrets.

## Google verification rollout

1. Implement and test invitation-backed Producer authorization.
2. Remove every automatic Producer and self-service Create-a-studio fallback.
3. Update signup, landing, and role-menu copy.
4. Replace placeholder Privacy and Terms content. Privacy must explain Calendar
   list access, free/busy checks, Skitza event create/update/cancel/reconcile,
   storage, sharing, disconnection, and deletion.
5. SK-225 is preserved in current production-stable commit `2208049b`. Its external
   Clerk-development proof exception is documented separately; rollback cannot
   correct that external environment.
6. Verify `skitza.app` in Search Console using the Google Cloud project owner,
   and remove unused authorized domains and redirects.
7. Test incognito plus true 360px, 390px, and desktop layouts.
8. Remove the production launch token only after all authorization checks pass.
9. Record the end-to-end Google demo and give the reviewer an invited Producer
   account.
10. Submit OAuth verification.

## Google policy contract

The following is part of the release contract, based on Google&apos;s current
official requirements checked on 12 August 2026:

- The production homepage must work in an incognito browser without a launch
  token, clearly identify Skitza, accurately describe its real functionality,
  and link the same Privacy and Terms URLs used in the OAuth consent screen.
- The production domain and every authorized domain must be owned and verified
  in Google Search Console by an owner or editor of the matching Google Cloud
  project.
- Development/testing and production use separate Google Cloud projects and
  OAuth clients. Production redirects use HTTPS and contain no private test
  origins.
- Skitza requests only `openid`, `email`,
  `calendar.calendarlist.readonly`, `calendar.events.freebusy`, and
  `calendar.events`. Calendar-list access lets a Producer choose calendars;
  free/busy access protects booking availability; event access creates,
  updates, reads, deletes, watches, and reconciles Skitza session events on the
  writable calendar the Producer chooses. The narrower owned-events scope is
  insufficient because Skitza supports writable shared calendars.
- These Calendar permissions are sensitive scopes and need Google sensitive-
  scope verification. They are not restricted scopes, so the current scope set
  should not require a restricted-scope CASA assessment. The final scope
  classification must still be confirmed in the production Cloud Console.
- Immediately before every Connect, Reconnect, or Switch action, Skitza shows a
  complete in-product disclosure of the Google identity, calendar-list,
  free/busy, event, token, storage, sharing, and deletion behavior. The user
  must then deliberately choose the Google action; no data is collected before
  that consent.
- The public Privacy Notice explains what Google data Skitza accesses, uses,
  stores, shares, retains, and deletes; the actions Skitza takes on the user&apos;s
  behalf; how to disconnect; how to request deletion; and Google&apos;s Limited Use
  requirements.
- Disconnect makes a best-effort Google revocation request, clears the stored
  access/refresh tokens, and deletes calendar selections. Existing Google
  events remain. The connection email and limited event/sync history may remain
  to preserve safe reconnection and the shared Skitza booking record.
- Google user data is never sold, used for advertising or credit decisions, or
  used to train a generalized AI model. Human access is limited to explicit
  support consent, security/abuse response, legal requirements, or aggregated
  and de-identified internal operations.
- The reviewer demo uses the real submitted app and English consent screen,
  shows the address bar/client ID and exact requested scopes, and demonstrates
  calendar selection, busy-time protection, event creation/update/cancel,
  reconciliation, and disconnect. The reviewer receives an invited Producer
  account.

Official references:

- [OAuth 2.0 Policies](https://developers.google.com/identity/protocols/oauth2/policies)
- [Google Workspace API User Data and Developer Policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [Sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth)
- [OAuth token revocation](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke)
- [Verification demo requirements](https://support.google.com/cloud/answer/13804565?hl=en)

## Public copy and legal truth

- Public pages describe Skitza as it exists: Producer access is invitation-only;
  Artists join through a Producer link; products and prices are private until
  Artist sign-in; beta Producer access is free; and Skitza records external
  payments but never takes, holds, routes, splits, refunds, or processes money.
- Privacy names the actual data categories and operational providers visible in
  the product: Clerk, Neon, Vercel, Cloudflare R2, Resend, Google, PostHog,
  and Sentry when those services are configured or used. The retired waitlist
  no longer sends public information to Make.
- Privacy does not promise deletion of every record within seven days. Shared
  accepted agreements, purchases, external-payment records, proofs, sessions,
  approvals, and audit/security history may need to remain.
- Terms do not invent a company entity, jurisdiction, age threshold, future
  subscription price, refund policy, or retention deadline. Before public
  release, Gili must confirm the legal operator identity and address, monitored
  legal/privacy inboxes, jurisdiction and dispute rules, age/minor policy, and
  any jurisdiction-specific retention or consumer terms. Final legal wording
  should receive qualified legal review.

## Release coordination

- SK-229 stays only in `/private/tmp/skitza-sk229` during local work.
- Its only direct changed-path overlap is SK-225 in
  `apps/web/src/middleware.ts` and `apps/web/src/middleware.test.ts`.
- SK-225 and SK-219 are preserved in production-stable `v3-clean` commit
  `2208049b`. SK-229 has been rebased onto that exact commit with no path
  overlap against SK-219, SK-222, or SK-226.
- Combined middleware and authorization behavior still requires independent
  review, full verification, exact previews, and the release gates below.
- Migration 0049, production environment changes, and `ACCESS_TOKEN` removal
  remain separately controlled even after the code PR is ready.

## Required test matrix

- New invited Producer; new uninvited signup; new Artist join.
- Existing Artist accepts while signed out and while already signed in.
- Wrong account, mismatched email, forwarded, expired, revoked, and reused link.
- Concurrent acceptance and webhook retry create exactly one Producer.
- Existing Artist data remains and role switching works.
- Direct onboarding URL and raw server-action call cannot grant Producer.
- Public pages return 200 without the launch cookie; protected routes redirect or
  deny correctly.
- Retired `/get-started(.*)` waitlist and `/changelog` routes stay 404 and the
  waitlist mutation remains unmounted/inert after the launch token is removed.
- Every `/dev` fixture page returns 404 in Vercel Production while remaining
  available in local development and Vercel Preview.
- Invitation tickets never appear in server-rendered HTML, analytics payloads,
  error/replay payloads, or browser Referer headers.
- Google connect, callback, calendar selection, free/busy protection, event
  create/update/cancel, reconciliation, and disconnect work end to end.

## Superseded behavior

Older documents or issues that describe open Producer signup or an Artist
self-authorizing through Create a studio are superseded for account access. In
particular, SK-152 and SK-157 remain historical context but do not override this
decision. SK-161 and SK-172 remain authoritative for additive roles and Artist
join-link behavior where they do not conflict with SK-229.
