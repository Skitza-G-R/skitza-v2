# Join-link account-split hardening — implementation handoff

## Outcome

A producer's valid Artist link must never lose its Artist purpose, create an
accidental Producer account, or silently move an Artist relationship between
Clerk identities.

This is a narrow follow-up to the already-merged SK-161 and SK-164 work. It
closes the remaining entry gaps; it does not redesign roles or onboarding.

## Current truth

- Audit baseline: latest `origin/v3-clean` reviewed on 2026-08-03
  (`648ca624`). Start implementation from the then-current `v3-clean`, not
  from this hash or the current dirty checkout.
- SK-161 already preserves Book/Unlock join intent through Clerk, prevents a
  valid join-origin signup from provisioning a Producer, supports additive
  Producer + Artist membership, and exposes role switching.
- SK-164 already stops `OWNER_CONFLICT` safely and asks the user to sign into
  the account that owns the Artist relationship. It never reassigns ownership.
- The remaining ways to recreate confusing behavior are:
  1. `/sign-up/join/<slug>` does not apply the returning-device decision, so a
     returning user can create a second Clerk identity instead of signing in.
  2. The dedicated join signup page renders Clerk before proving that the slug
     still belongs to a Producer. An invalid, renamed, or stale direct link can
     create an unconnected account and later fall into Producer onboarding.
  3. An unverified-email or unconfirmed-connection edge currently reaches the
     generic error boundary instead of giving the user a safe retry path.
- SK-170 owns the separate generic-login bug where an established Producer
  retains an exact `/onboarding` destination. That work overlaps auth helper
  tests and must land first.
- SK-157 intentionally allows a Producer to deliberately reopen onboarding.
  Do not add a broad completed-Producer-to-dashboard guard.

## Required workflow

1. Create or use a dedicated Linear issue in project `Skitza v3`, team
   `Skitza`; read it fully, move it to `In Progress`, and use its exact branch
   name.
2. Start from the latest `v3-clean` after SK-170 is merged. Do not implement
   this in the SK-170 worktree or on the current stale/dirty checkout.
3. Check current Clerk redirect/component behavior with Context7 before
   changing Clerk props.
4. Add focused failing tests before each behavior change.
5. Keep the PR limited to the files listed below unless a failing test proves
   one additional dependency is necessary.

## Scope

### 1. Make returning join visitors sign in by default

Reuse the existing returning-device policy; do not create a second cookie or
another account heuristic.

- In
  `apps/web/src/app/(public)/(auth)/sign-up/join/[slug]/[[...rest]]/page.tsx`:
  - read `searchParams.intent` and the `skitza-returning` cookie;
  - call the existing `shouldRedirectReturningDeviceToSignIn` helper;
  - for a signed-out returning device on the top-level join signup entry,
    redirect to `joinSignInHref(slug, action)` so Book/Unlock and the producer
    slug survive;
  - do not redirect an authenticated session, an explicit
    `intent=signup` choice, or Clerk's nested verification/OAuth routes.
- When Sign in offers “Create account,” return to the dedicated Artist signup
  URL with `intent=signup`. Update `joinSignUpHrefFromTarget` /
  `signUpSwitchHref` and their exact URL tests for both Book and Unlock.
- Keep the returning-device cookie advisory only. Never choose, merge, or
  mutate a Clerk identity automatically.

Expected behavior:

- Direct invite + returning device -> Sign in with the exact join destination.
- “Create account” from Sign in -> dedicated join signup with no redirect loop.
- New device -> dedicated join signup as today.
- Shared device -> the person can still explicitly choose Create account.

### 2. Reject invalid or stale links before Clerk signup

The dedicated auth route must prove the target exists before rendering
`<SignUp>`.

- Reuse `joinContinuationHref` for strict slug/action validation.
- Reuse `findJoinTargetProducer` for the database existence check.
- Return `notFound()` for an invalid slug or a Producer that no longer exists.
- Perform this check before rendering Clerk and before stamping join metadata.
- Preserve Clerk nested verification/OAuth paths for a still-valid Producer.
- Mock the target lookup in route tests. Do not use a real database for page
  unit tests.

Expected behavior:

- Valid current link -> unchanged join signup/sign-in flow.
- Invalid, unknown, renamed, or deleted slug -> 404 before an account can be
  created from that page.
- Existing authenticated user + stale link -> 404; never dashboard/onboarding.

### 3. Give verification timing failures a safe retry

Do not process `user.updated` join side effects from client-writable
`unsafe_metadata`; that would let an existing account manufacture a join via
metadata alone.

- In the join continuation action, map only these known domain failures to
  allowlisted same-site recovery states:
  - `UNVERIFIED_EMAIL` -> explain that a verified email is required and offer
    Retry plus account switching;
  - `CONNECTION_NOT_CONFIRMED` -> explain that connection is still finishing
    and offer Retry.
- Retry must call the existing explicit POST action. Once Clerk reports a
  verified email, `connectCurrentUserForJoin` performs the normal ownership
  checks and connection.
- Preserve the current behavior for `SELF_JOIN`, `OWNER_CONFLICT`, and unknown
  errors. Unknown errors must still reach the real error boundary.
- Do not create a Producer as a fallback and do not infer ownership from an
  unverified email.

### 4. Pin the already-correct role behavior

Do not rewrite `resolveUserRole` or the membership model. Add/retain regression
assertions proving:

- an existing Producer confirms before joining another Producer as an Artist;
- the same Clerk identity then has both memberships and can switch roles;
- an incomplete Producer keeps Artist access while Producer setup remains
  resumable;
- a different Clerk owner produces recovery UX with no reassignment;
- self-join remains blocked;
- Artist-only explicit Create-a-studio intent still works.

## Expected file boundary

- `apps/web/src/app/(public)/(auth)/sign-up/join/[slug]/[[...rest]]/page.tsx`
- `apps/web/src/app/(public)/(auth)/sign-up/join/[slug]/[[...rest]]/join-auth-intent.test.ts`
- Prefer a focused `page.test.tsx` beside that route for mocked redirect,
  cookie, and target-existence behavior.
- `apps/web/src/server/auth/post-sign-in.ts`
- `apps/web/src/server/auth/returning-device.ts`
- `apps/web/src/server/auth/__tests__/post-sign-in.test.ts`
- `apps/web/src/server/auth/__tests__/returning-device.test.ts`
- Join continuation page/action tests only if implementing the recovery states.

Do not change onboarding guards, landing-page CTA behavior, the database
schema, role tables, or unrelated navigation.

## Regression matrix

Every row must be pinned by an automated test unless marked Browser.

| Starting state | Entry | Expected result |
|---|---|---|
| New device, no account | Valid Book link | Artist signup; never Producer provisioning |
| New device, no account | Valid Unlock link | Unlock intent survives; never Producer provisioning |
| Returning device, signed out | Direct join signup link | Sign in with exact slug/action |
| Returning device, signed out | Explicit Create account | Join signup opens without a loop |
| Existing Artist | Valid link for another studio | Existing identity gains that studio |
| Existing complete Producer | Valid link | Confirmation, then dual role and role switch |
| Existing incomplete Producer | Valid link | Confirmation; Artist works; Producer setup remains |
| Existing target Producer | Own link | Self-join blocked |
| Artist contact owned by another Clerk ID | Valid link | Account-switch recovery; no overwrite |
| Any user | Invalid/unknown/stale slug | 404 before Clerk form |
| Join account with unverified email | Continue | Safe verification recovery and retry |
| Completed Producer, generic login | SK-170 path | Dashboard behavior remains owned by SK-170 |
| Completed Producer, deliberate onboarding visit | Direct `/onboarding` | SK-157 resumable behavior remains |

## Verification

Run from the clean issue branch with Node `>=20.11`, pnpm `9.12.0`, and
Corepack.

Focused tests first:

```bash
corepack pnpm --filter web exec vitest run \
  'src/app/(public)/(auth)/sign-up/join/[slug]/[[...rest]]/join-auth-intent.test.ts' \
  'src/server/auth/__tests__/post-sign-in.test.ts' \
  'src/server/auth/__tests__/returning-device.test.ts' \
  'src/app/(public)/join/[slug]/continue/page.test.ts' \
  'src/app/(public)/join/[slug]/continue/actions.test.ts' \
  'src/app/api/webhooks/clerk/route.test.ts' \
  'src/components/nav/__tests__/account-role-menu.test.ts'
```

Then use `$skitza-verify` for typecheck, lint, the full test suite, production
build, and browser verification.

Browser-check only these three high-value flows against a disposable
non-production Clerk + database environment:

1. Returning existing Producer opens another Producer's invite, signs in,
   confirms Artist mode, and switches between both roles.
2. New Artist completes a valid invite and lands in the target studio without
   any Producer profile.
3. Wrong Clerk account hits an owned contact and sees safe account-switch
   recovery with ownership unchanged.

Also confirm an invalid/stale slug never renders the Clerk form. Fail on a
same-site 4xx/5xx outside the expected stale-link 404, console error, page
error, or failed same-site request. Never use production for these writes.

If no disposable Clerk/database environment exists, report `PARTIAL`; do not
claim the journey is fully verified.

## Acceptance criteria

- A valid join link always remains Artist intent through every auth switch.
- A valid join-origin signup never creates a Producer profile.
- A returning user is sent to Sign in by default and can explicitly create a
  new Artist account without looping.
- A stale or invalid direct signup link is rejected before Clerk can create an
  account from it.
- Verification timing failures have a bounded retry path and never fall back
  to Producer creation.
- Existing Producer data remains unchanged when Artist membership is added.
- Conflicting Artist ownership is never overwritten or merged.
- SK-170's generic-login fix and SK-157's deliberate onboarding re-entry both
  remain intact.
- Focused tests, full verification, and the three browser flows pass, or the
  handoff clearly reports `PARTIAL` for the unavailable external environment.

## Explicit exclusions

- No repair or merge of Lior's two existing Clerk identities.
- No automatic account consolidation, ownership transfer, or email-based
  reassignment.
- No Producer onboarding redesign or broad completed-Producer redirect.
- No schema migration, deployment, production database write, or production
  promotion.
- Do not merge without Gili's approval.

## Rollback

This task should require no migration or data backfill. Reverting its single PR
restores the previous routing behavior. Existing SK-161/SK-164 protections
must remain in place during rollback.
