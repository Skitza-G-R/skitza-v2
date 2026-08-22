# Safe release sequence — authoritative checklist

**Last updated:** 2026-08-12, Asia/Jerusalem  
**Project:** Skitza v3  
**Development and PR base:** `v3-clean` only  
**Status:** Lanes A–C are stable in production. Calendar UI/auth recovery, the
secured Google Calendar callback, the Payments Project column, and the 30-day
booking window are merged and live on `skitza.app` at exact SHA `8595206a`.
Current production deployment `dpl_4X6RoK3NNj3GJALJLKjsNsPAmxST` passed its
corrected token-aware 15+ minute watch with repeated healthy database checks,
zero 5xx, zero warning/error/fatal logs, and no rollback trigger. The production
Google provider proof remains deferred to the dedicated Clerk-production rollout
because both current and rollback builds still use Clerk's development instance;
this is an environment issue, not an SK-225 regression. SK-219 Private Offers
merged exactly as `2208049b`; its exact merged previews passed, and approved
production deployment `dpl_6nmbEU37kapmbTcg7agu3sKcbhC5` is now READY and live
on `skitza.app`, promoted from verified preview `dpl_7cg2z1...`. Immediate
token-aware route, health, and database checks passed. The 15+ minute production
watch is active; prior `dpl_4X6Ro...` / `8595206a` is the rollback. SK-229 is the
final lane and remains held until this watch passes.

This document is the single source of truth for the current recovery and release
sequence. Update it after every rebase, PR-head change, merge, deployment
verification, promotion, rollback, or newly discovered blocker. Do not rely on
old task messages or old Vercel previews.

## Non-negotiable safety rules

- Never integrate from the dirty root checkout or GitHub's default `main` branch.
- Never reuse an old preview after its branch base changes. A deployment contains
  the whole repository snapshot, not only one feature's changed files.
- Resolve the live deployment from the exact `skitza.app` alias before and after
  every promotion or rollback. Vercel's project-level `targets.production` and
  default `skitza-v2-web.vercel.app` alias currently still reference the prior
  build and are not authoritative for live traffic.
- Process the lanes below in order. One lane must be stable before the next enters
  release.
- Every changed PR head must repeat its required review, CI, preview, and visual
  checks.
- Gili must approve each exact PR head before merge.
- After merge, verify the exact merged `v3-clean` SHA and its deployment.
- Gili must separately approve the exact deployment before `skitza.app` points to
  it.
- No production database migration is included. Any migration needs separate,
  exact approval.
- Roll back to the immediately previous verified production deployment if a
  rollback trigger fires.

## Known production baseline

- Current production commit:
  `8595206abf1cf16caad25fc682a5ae96dfddebac` (stable Lanes A/B, SK-222 Payment
  Project column, and SK-226 30-day booking window).
- Current production deployment: `dpl_4X6RoK3NNj3GJALJLKjsNsPAmxST`, READY.
- `/api/health`: HTTP 200 and database reachable at the final Lane A audit.
- Current production contains the Gili-approved simple desktop booking drawer,
  approved hover behavior, current mobile bottom sheet, and the populated
  closed-drawer Upcoming sessions rail.
- The immediately prior verified production deployment
  `dpl_H6PZJaaeUbLipxFm2NtRJNmDRxKy` at `b814d132` is the current rollback target.
- Historical signal to keep monitoring: the prior deployment logged four Google
  Calendar callback 401s and two calendar repair-wake failures. Lane A's
  post-cutover watch logged neither; SK-225 fixes the callback flow but does not
  claim to fix repair-wake failures.
- Revised SK-217 same-address guest listening is not live. Current production
  still uses `/listen/<token>`.
- SK-219 Private Offer was briefly promoted, then overwritten; it is not in
  current production.

## Lane ownership

- **Immediate integration:** SK-227 and SK-228.
- **OAuth security:** SK-225 only.
- **Deferred feature queue:** SK-222, then SK-226, then SK-219.
- **Release coordinator:** keeps this file current, checks combined repository and
  deployment state, and stops at every approval gate.
- **Parallel SK-229 task:** may continue scoped implementation and local
  verification only in `/private/tmp/skitza-sk229`. This release coordinator owns
  its later integration gate; no rebase, push, PR update, merge, deployment,
  production/preview migration, Clerk/Vercel/Google setting change, or launch-
  token removal occurs from that task while SK-225 is unfinished.

These are the only active release lanes. SK-229 is parallel implementation work
held outside the release queue until handoff. Do not add another coordination
layer or release lane unless a blocker requires it.

### Parallel-work collision map — SK-229

- SK-229 starts from stable Lane A SHA `85049ab8` in its own worktree and is not
  part of the current promotion queue yet.
- Its only direct changed-path overlap with SK-225 is
  `apps/web/src/middleware.ts` and `apps/web/src/middleware.test.ts`. Therefore
  SK-225 must stabilize first; SK-229 must then rebase and re-review the combined
  middleware behavior before integration.
- It has zero direct changed-path overlap with the SK-222 Payment-column patch,
  the eight-file SK-226 booking-window patch, or the single SK-219 Private-Offer
  feature commit.
- SK-219 still has a whole-snapshot risk: its old branch and previews contain
  stale authentication/signup code. Never deploy that old snapshot. Replay only
  its feature commit onto the final current base, so SK-225, SK-228, and eventual
  SK-229 auth behavior are retained.
- SK-229 adds database migration `0049_producer_invitation_grants.sql`; no
  database environment may receive it without a separate explicit target/run
  decision and the required `$skitza-migrate` process.

## Lane A — restore the safe base

### A1. SK-227 calendar correction — PR #337

- Exact reviewed head: `3d2ad1bcc5d850e6b2ebbd1fb5f6e2919c18a4cf`.
- Base: current production `b1e12657`; 1 ahead / 0 behind.
- State: draft, mergeable, GitHub CI green, web/admin Vercel checks green.
- Independent review and desktop/390px/360px verification passed.
- Historical scope: restored both the pre-SK-224 drawer and hover files while
  retaining SK-218 mobile behavior. Gili later confirmed that this combined the
  correct hover with the wrong desktop drawer. Only the hover part is approved.
- Merged `v3-clean` commit:
  `682610cfc20ff9e01d7b7c20ec8e0bcedf4a21a7`.
- Post-merge web deployment: `dpl_CyAiHaVbd8VkgVxgdBAvsMeTdER7`, currently
  READY and non-production. `skitza.app` remains on `b1e12657`.

- [x] Review, local verification, CI, and previews green for the recorded head.
- [x] Gili approves merging exact head `3d2ad1bc`.
- [x] Merge PR #337 into `v3-clean`.
- [x] Record resulting `v3-clean` SHA `682610cf`. Do not promote it by itself.

### A2. SK-228 legacy invite routes to Home — PR #336

- Current head: `5fde13613b4195fbf250a93209026a48e415bf23`.
- Current base: `682610cf`; 1 ahead / 0 behind.
- State: merged. New-head GitHub CI #776 passed; web/admin Vercel previews were
  READY, and Gili approved the exact head before merge.
- No changed-path overlap with SK-227.
- Stale SK-219 auth files contain the superseded inverse behavior. SK-219 must
  retain SK-228 semantics when it is rebased later.
- Stable patch ID matches the original reviewed head exactly; scope remains the
  same 13 auth/join files.
- Current-base local verification passed: typecheck, lint, 182 focused auth/join
  tests, 7,544 full tests with 90 skipped, and production build.
- Merged `v3-clean` commit:
  `5696b3dd57a88183a4a296abc58c12d33df07f99`.

- [x] Original-head review, local verification, CI, and previews were green.
- [x] After SK-227 merges, update/rebase SK-228 onto exact `v3-clean` `682610cf`.
- [x] Rerun affected tests, full required local verification, and build.
- [x] New-head GitHub CI #776 passes, including web/admin build.
- [x] New-head web preview `dpl_82hBZqNqywfS22kft1fmNP9LwGGU` and admin
  preview `dpl_7MaGB3WVJMpxbUXg7Ayz4VFZJB8X` are READY.
- [x] Complete browser verification on the new HTTPS preview: bare invite →
  Home, explicit Book → Book, Unlock preserved, stale Store → Home, with no
  console errors.
- [x] Confirm bare legacy signup goes Home; explicit Book stays Book; Unlock and
  route guards remain intact.
- [x] Gili approves exact PR head `5fde1361`.
- [x] Merge PR #336 into `v3-clean` as `5696b3dd`.

### A3. Combined production gate

- Exact combined `v3-clean` SHA:
  `5696b3dd57a88183a4a296abc58c12d33df07f99`.
- Its tree exactly matches reviewed SK-228 head `5fde1361`; therefore it contains
  merged SK-227 plus the exact reviewed 13-file SK-228 patch and no extra code.
- Web deployment `dpl_5VEhY6Qkbm2R9BELnGwNq1qgRrPE`: READY,
  `target: null`.
- Admin deployment `dpl_2YYqdXhH3UdNJoVPPvSH5Kau8dNM`: READY,
  `target: null`.

- [x] Verify the exact combined merged `v3-clean` SHA and READY deployments.
- [x] Smoke-test the authenticated calendar on the exact combined deployment.
  This proved that desktop opened a 440 px right drawer with the mobile-style
  progressive picker; Gili rejected that desktop presentation. The current
  390x844 and 360x800 bottom sheet remained correct with no horizontal overflow.
  The hover affordance was independently browser-verified and is approved.
- [x] Capture visual proof from the exact combined preview at desktop and true
  390x844 mobile, plus the independently captured hover affordance. These images
  exposed the desktop mismatch; no save or data mutation was performed.
- [x] Resolve the desktop visual source conflict. Gili supplied and approved the
  exact desktop reference: selected date/time at the top, then normal Client and
  Project dropdowns in the right drawer. The screenshot is attached to SK-227 in
  Linear as **Gili-approved desktop Calendar booking UI**. Keep the SK-227 hover
  and current mobile sheet.
- [x] Create the minimal corrected head from current `v3-clean`: restore only the
  SK-224/current-production desktop drawer presentation, retain the merged
  SK-227 schedule-grid hover, and retain the current mobile presentation.
- Corrected pushed head: `317d1353f4eb41d2ae8aa741f6fb784c6ab2e665`,
  directly based on `5696b3dd`. Its only changes are the modal source and its
  matching interaction test. The four locked source/test blob identities match
  the approved hybrid exactly.
- Local code gates passed: typecheck, lint, 19 focused Calendar tests, 6,908 full
  tests with 79 skipped, and production web build. The first build attempt was
  blocked only by sandbox DNS for Google Fonts; the permitted network rerun
  passed.
- Exact web preview `dpl_dc1R24SNqoKbs32wWjZtY62XuLZu` is READY with
  `target: preview`; web and admin Vercel checks are green. The exact preview's
  existing no-account-data Calendar gallery imports the real changed modal. At
  1440×900 it showed the approved right drawer and native Client/Project
  dropdowns. At 390×844 and 360×800 it showed the current bottom sheet at y=12,
  with document width exactly equal to viewport width and no app console errors.
  The new desktop and 390px screenshots are attached to SK-227 in Linear; the
  360px proof is recorded locally. No booking or onboarding data was created.
- The hover runtime source and interaction test remain byte-identical to the
  browser-approved SK-227 versions; the prior approved hover screenshot remains
  the proof for that unchanged behavior.
- Replacement PR #339 merged into `v3-clean` as
  `85049ab820fe857ff575175cfda649d1d11b7b49`. Its tree is byte-identical to
  reviewed head `317d1353`, with exactly the same two changed files. GitHub CI
  run #31527913464 passed in full on that reviewed tree.
- Fresh exact-merge web deployment
  `dpl_BpGT5fcw4o2dEeix3qMKACjzLXfq` and admin deployment
  `dpl_7PUXURrUc6Caz62TK6FkypmRXPJv` are READY, Git-sourced from `v3-clean`,
  exact SHA `85049ab8`, and preview-only. GitHub's combined deployment status is
  green; the web deployment has no error/fatal runtime log entries in its first
  30-minute window.
- [x] Finish the changed-modal browser and exact-preview checks at 1440×900,
  390×844, and 360×800. Retain the already-approved hover proof because its
  source and test blobs did not change.
- [x] GitHub CI passes on exact head `317d1353`.
- [x] Capture a closed-drawer 1440x900 proof with populated fake data, showing
  the fixed 260px **Upcoming sessions** rail and Upcoming / Past / All controls.
  Because exact PR preview #339 has no safe populated account fixture, the proof
  used a temporary preview built from candidate `317d1353` plus one uncommitted
  dev-only route. It rendered the exact `SchedulePanel`, `ScheduleWeekGrid`,
  `ScheduleSessionsCard`, and production grid/rail layout. Browser metrics:
  1440x900 viewport, 260px rail, two rows, drawer closed, no horizontal overflow,
  and no app console errors (only baseline Clerk development warnings). The
  route was removed locally after capture; the candidate worktree is clean and
  PR #339's head/diff never changed. Screenshot:
  `lane-a-session-rail-proof-1440x900.png`, attached to Linear SK-227.
- Exact-head focused rail tests also passed 11/11, including the real populated
  `ScheduleSessionsCard` row and desktop
  `allSessions` -> `SchedulePanel` -> 260px rail wiring.
- A temporary, non-production proof deployment was created from candidate
  `317d1353` plus one uncommitted dev-only route:
  `dpl_96UUVzrfj9J8LVNrU6nRUco6Xyqb` (`target: preview`, READY). The route
  renders the exact `SchedulePanel`, `ScheduleWeekGrid`,
  `ScheduleSessionsCard`, and 260px production layout with fake sessions. It is
  for visual evidence only and must never be merged or promoted. Its only extra
  route was removed locally after capture.
- [x] Gili approves corrected exact PR head `317d1353`; merge it into
  `v3-clean` as `85049ab8`.
- [x] Verify the corrected exact merged SHA, deployment provenance, terminal
  web/admin status, combined GitHub status, and initial web runtime logs.
- [x] Authenticated browser check on the exact merge: the closed Calendar shows
  the real **Upcoming sessions** rail and an existing session; **New session**
  opens the approved simple desktop drawer with date/time summary and native
  Client/Project dropdowns. `/api/health` returned HTTP 200 with DB reachable
  (363 ms). No application console errors appeared; only known Clerk preview
  warnings and Google's own sign-in console notices.
- [x] Save and attach fresh exact-merge screenshots to SK-227:
  `lane-a-merged-85049-calendar-closed.jpg` and
  `lane-a-merged-85049-calendar-drawer.jpg`. No booking or product data was
  changed.
- [x] Gili approves exact web deployment
  `dpl_BpGT5fcw4o2dEeix3qMKACjzLXfq` for production promotion.
- [x] Production rebuild `dpl_BK1pBmgpqMJVtC3AvBaCFEsUf4fV`, created from the
  approved preview, reached READY with exact SHA `85049ab8` and verified
  `source=cli`, `action=promote`, and
  `originalDeploymentId=dpl_BpGT5fcw4o2dEeix3qMKACjzLXfq`.
- [x] Vercel's production rebuild completed staged without moving the custom
  domain. Confirm no project deployment checks or in-progress promotion, then
  explicitly assign `skitza.app` to exact READY deployment
  `dpl_BK1pBmgpqMJVtC3AvBaCFEsUf4fV`. Alias verification succeeded; immediate
  health was HTTP 200/DB reachable (378 ms).
- [x] Repeat invite routing on the exact combined deployment using the valid
  producer slug: bare, Book, and Unlock retain their distinct signed-out routes;
  stale Store normalizes to `action=home`. Completion behavior was already
  browser-verified on the reviewed head whose tree is identical to this merge.
- [x] Confirm `/api/health`: HTTP 200, DB reachable (897 ms at check time).
- [x] Inspect combined-deployment runtime logs: no error/fatal logs found.
- [x] Historical approval: Gili explicitly approved promoting exact web deployment
  `dpl_5VEhY6Qkbm2R9BELnGwNq1qgRrPE` to `skitza.app` after its Calendar-and-invite
  contents were explained. Gili's later desktop correction invalidates this build
  for any new promotion; it must not be promoted again. The separate admin
  deployment remains unapproved.
- [x] First promotion attempt created production deployment
  `dpl_B7a7P2V7ukryhPqqgv72LPRn4RgN` from approved deployment
  `dpl_5VEhY6Qkbm2R9BELnGwNq1qgRrPE`; it was READY at exact SHA `5696b3dd`.
- [x] Immediate candidate `/api/health`: HTTP 200 and DB reachable (1,021 ms).
- [x] Roll back to prior deployment `dpl_H5bY1uU8MeA7uSSJes6J3KCWd8JT` after
  unauthenticated page requests returned the middleware's deliberate `Not found.`
  access-gate response. Rollback completed at 20:52 IDT and restored SHA
  `b1e12657`; health remained HTTP 200 and DB reachable.
- [x] Confirm the same 404 response exists on the prior deployment and identify
  its source: production `ACCESS_TOKEN` intentionally gates every non-API page.
  This was not evidence that Lane A broke routing.
- [x] Gili explicitly authorized use of the existing Vercel `ACCESS_TOKEN` for
  read-only release checks without displaying it. Vercel marks this variable
  `sensitive` and refuses to decrypt or inject it locally; its value was never
  printed or saved.
- [x] Confirm the access-gate code has an empty diff between production
  `b1e12657` and candidate `5696b3dd`. Through Vercel deployment protection, the
  rolled-back candidate returns 200 for `/get-started`, 200 for `/api/health`,
  and the expected gate 404 for `/`; it has no error/fatal runtime logs.
- [x] Gili provided the private pre-launch link; its private value is not recorded
  here. On the exact production-target candidate behind both protections: Home,
  Sign in, public Join, bare invite, Book invite, and Unlock invite all respond
  successfully; Calendar redirects to Sign in while preserving Calendar; stale
  Store redirects to Sign in with `action=home` and no remaining Store intent.
- [x] Attempt the existing Chrome profile as a no-token fallback. Chrome is
  running, the ChatGPT browser extension is installed and enabled, and the
  native connection setup is valid; however, it remained unavailable after
  Gili approved opening a fresh Chrome window and one supported retry.
- [x] Attempt the authenticated gated browser check. The in-app browser entered
  the private gate but its environment could not reach Clerk's handshake host;
  this is a browser-network limitation, not an application response. The exact
  authenticated Calendar UI already passed on the identical reviewed preview,
  and the production-target server routes above passed with the private gate.
- [ ] Obtain exact approval for a new promotion attempt and promote the Lane A
  build again.
- [x] Monitor health, 5xx, auth/join, and calendar logs for at least 15 minutes.
  Final independent post-cutover audit through 08:40 IDT: health HTTP 200/DB
  reachable (301 ms); 52 unique requests, all successful 200 responses; zero 5xx; zero error/fatal entries; zero Google
  callback 401s; zero repair-wake errors. Six 404s were the expected private
  access gate, not failures.
- [x] Mark Lane A stable. No rollback trigger fired; retain prior deployment
  `dpl_H5bY1uU8MeA7uSSJes6J3KCWd8JT` as the recorded rollback target.

## Lane B — SK-225 Google OAuth security

The old pushed head `e3328655` and its preview are blocked and must never be
merged or promoted. It allowed an OAuth transaction initiated for one producer
to be completed by another browser, and its public tRPC completion path could
bypass a route-only fix.

- Prior pushed head:
  `51f247701e4b46fb1f3d1e0b3e5ce81a623ea3de`, based on `b1e12657`.
- Current local rebased head:
  `75a4fca3992a2fcc7985a24670e2e137f832a7e4`, based directly on stable Lane A
  SHA `85049ab8`. Rebase was clean; its stable patch ID remains exactly
  `a1f819c0866c011f7deb5ff4777520f51a0c1125`. Full current-base verification and
  independent security review passed, then the branch was lease-safely updated;
  draft PR #338 now shows exact head `75a4fca3` / base `85049ab8`.
- Independent exact-head security review found no blocking issue; 96 focused
  tests, web typecheck, focused lint, and `git diff --check` passed. The code and
  automated security lanes are complete, but the PR is not yet approved to merge
  or promote.
- Existing old-base release evidence: CI run #775 passed; its per-package totals
  were 7,590 passed with 45 skipped (7,635 total); admin/web builds passed; web preview
  `dpl_83Y7fpfRkspnojeWi15wvDQUQNXk` is READY. Browser OAuth verification remains
  partial and all release evidence must be refreshed after the rebase.

- [x] Short-lived initiating-browser proof is HttpOnly, Secure, SameSite=Lax and
  bound to signed state.
- [x] Callback verifies and atomically consumes state and browser proof without
  requiring a live Clerk session.
- [x] Public tRPC cannot bypass the same proof and returns no unnecessary
  account/calendar metadata.
- [x] After Lane A is stable, rebase onto exact `v3-clean` SHA `85049ab8` and
  inspect the final 16-file diff. No conflict or patch drift; 96 focused tests
  pass locally on exact rebased head `75a4fca3`.
- [x] Exact current-base code lane VERIFIED: typecheck and lint pass; 96 focused
  tests; 7,553 full workspace tests pass with 90 skipped; web/admin production
  builds pass; clean worktree and diff check. Independent security review found
  no blocker and approved the exact diff.
- [x] Lease-safe force-push exact head `75a4fca3` to draft PR #338. Fresh GitHub
  CI and exact web/admin previews started; old-base evidence is retired.
- [x] Fresh exact-head CI run #31567471932 passed typecheck, lint, full tests,
  and web/admin builds. Exact-SHA web preview
  `dpl_HYdVFExKkQD3AJANuoWM3RmSS4rz` and admin preview
  `dpl_72VGucWUVvW4wubUvcFdTLctyqjf` are READY/STAGED with correct ref, SHA, and
  PR #338 provenance; initial web logs contain no error/fatal entries.
- [x] Audit whether a real OAuth proof can run on exact web preview
  `dpl_HYdVFExKkQD3AJANuoWM3RmSS4rz`. It cannot without an out-of-scope settings
  change: `GOOGLE_CALENDAR_ENABLED`, client credentials, state/encryption keys,
  and the fixed redirect URI exist only in Vercel Production, while the candidate
  runs in Preview. Google must return to the configured `skitza.app` callback, so
  a preview success would not exercise the candidate callback or its host-only
  transaction cookie. Do not fake this gate or copy production secrets into
  Preview.
- [x] Browser login to the exact preview succeeds with Gili's authorized Google
  account and has no console errors. It lands on an empty Preview-environment
  onboarding profile, not the real studio; no onboarding form, slug, product,
  Calendar connection, or other profile data was submitted.
- [x] Full `$skitza-verify`, CI, and fresh previews are green for exact head
  `75a4fca3`.
- [ ] On the exact HTTPS preview, complete real Google OAuth with an expired Clerk
  session; forward the authorization URL to a separate browser and confirm a safe
  rejection, no database mutation, and cookie deletion.
- [x] Create draft PR #338 on the initial base.
- [x] Update PR #338 to the current Lane A base.
- [x] Gili approves exact head `75a4fca3`; squash-merge PR #338 as
  `e1886d1d8221e4ece06844c2d577bcb244e32ba2`. The merge parent is exact prior
  stable SHA `85049ab8`, and its tree SHA `3a08d395` exactly equals the reviewed
  head tree; no extra code entered the merge.
- [x] Verify the exact merged deployment and provenance. Exact merged web
  deployment `dpl_7dsqNctbgCMZdTiPzrF6d6QzEYHW` and admin deployment
  `dpl_HeZsqhgfiY9syUmCX59xoSzY1BHa` are READY/STAGED and preview-only, with
  verified `v3-clean` / `e1886d1d` provenance. GitHub web/admin checks are green;
  `/api/health` is HTTP 200 with the database reachable; the signed-out Calendar
  route correctly redirects to sign-in; and 17 deployment-scoped requests show
  zero 5xx and zero error/fatal entries. `skitza.app` remains isolated on stable
  Lane A deployment `dpl_BK1p...`. The Preview surface can prove health/routes
  but cannot prove the Production-only Google callback.
- [x] Gili approves exact merged web deployment
  `dpl_7dsqNctbgCMZdTiPzrF6d6QzEYHW`; promote it. Vercel created exact verified
  production copy `dpl_9NiLkFBqu2qaWf3Zj9i8XHJznRWC`, and the custom domain was
  explicitly assigned after READY because Vercel again left it staged.
- [ ] Immediately test a real
  `skitza.app` OAuth connection with the callback lacking live Clerk, then test
  replay/safe error behavior and monitor callback 401s plus calendar repair-wake
  errors for at least 15 minutes. Roll back at once on any callback, binding,
  producer-scope, health, or Calendar regression.
- [x] Independently verify the authoritative custom-domain cutover and extended
  watch. `skitza.app` resolves READY production deployment `dpl_9NiLk...` at
  exact SHA `e1886d1d`; health and DB remain green, with zero 5xx and zero
  callback 401s. Retain prior stable `dpl_BK1p...` as the rollback target.
- [x] Mark Lane B stable with the documented Clerk-environment exception. Keep
  `e1886d1d` live; rollback would retain the same `pk_test_` Clerk development
  setup and would not address the blocked sign-in handoff.

Current live-proof status: the authenticated Calendar and connected
`giasraf@gmail.com` account rendered correctly; the approved drawer, hover, and
Upcoming sessions rail remained intact. The real connect route returned the
expected 303 and reached Google's account chooser. A first attempt expired while
browser sign-out was being recovered and never called the Skitza callback. A
fresh attempt is paused at Google's human sign-in confirmation because browser
safety policy forbids the agent from pressing that button. Gili or her wife must
press the visible Hebrew **המשך** button in the queued browser tab; then the
coordinator can finish the no-live-Clerk callback, replay, and connection checks.
The existing Google Calendar connection has not changed. Independent diagnosis
proved that the failed continuation stopped at Clerk's own shared development
callback, before Skitza received either its auth resolution or Calendar callback.
Current and rollback deployments both use the same Clerk development instance;
the SK-225 diff did not change Clerk auth UI or instance configuration. Do not
keep Lane C blocked on this unrelated external-environment problem. Repeat the
real provider proof as part of the separately approved production-Clerk rollout,
which needs full auth regression testing and must not be flipped casually.

The post-cutover watch passed: exact alias/SHA remained correct; health and DB
stayed green; zero 5xx and zero callback 401s. Four intermittent known
`Google Calendar repair wake failed` entries appeared among dozens of successful
HTTP 200 Calendar polls. SK-225 did not change that repair path, the Calendar UI
continued working, and the existing one-session sync warning remained visible;
record this as separate pre-existing Calendar reliability work, not an SK-225
rollback trigger unless it becomes a user-visible failure or spike.

## Lane C — small deferred features, one at a time

### C1. SK-222 Payment project column — stable in production

Approved head `1bc62e58a2a265dd9f8dff7c963fc318684c8f83` was squash-merged
directly onto stable `v3-clean` `e1886d1d` as exact merge commit
`b814d132e5d38f6d991e1339d9bd76cfb3118493`. The merged tree is byte-for-byte
identical to the approved head and changes only the two reviewed Payments files.
The old preview is retired.

- Exact scope is two Payments files with no direct overlap with Lanes A/B,
  SK-226, or SK-219. The old admin preview failed only while fetching the Google
  Outfit font; fresh current-base evidence is still mandatory.
- Read-only current-base audit found no code blocker. Stable Lane A has the same
  two pre-patch file blobs as the old base, a virtual merge onto `85049ab8` is
  clean and changes only those two files, and the focused old-head test passes
  7/7. The implementation puts Project before Artist only in desktop Overview,
  deduplicates projects by ID, and leaves grouping, values, filters, pagination,
  status, navigation, mobile, and History code untouched.

- [x] Lane B is stable with the documented Clerk-environment proof exception.
- [x] Rebase/update onto exact `v3-clean` `e1886d1d` as head `1bc62e58`.
- [x] Rerun `$skitza-verify`, CI, and fresh previews; visually check normal and
  narrow desktop around the `md` breakpoint, true 390px/360px mobile, and
  History. Confirm the unchanged payment behavior as well as Project mapping.
  Typecheck/lint, focused 7/7, full 7,554 tests with 90 skipped, web/admin
  builds, and GitHub CI #31617196664 all pass. Exact web deployment
  `dpl_GHaSvv4cR5xfx9v6t1t6TJXUKLYB` and admin deployment
  `dpl_FjoZqQ2gpHYD9AtsftJnRd9CcnDY` are READY. Browser proof passed at 1280,
  800, 390, and 360px with no overflow/errors or data writes; mobile and History
  remain unchanged. Before merge, PR #335 was CLEAN/MERGEABLE and changed
  exactly two Payments files with no overlap against any other release lane.
- [x] Gili approved exact head `1bc62e58`; PR #335 was squash-merged as
  `b814d132` with exact approved tree identity.
- [x] Verify the exact merged deployment. Exact web preview
  `dpl_GZG28S65n3Stk1fQeLiAoi1aEZhb` and admin preview
  `dpl_AgzUbGEywcmT4qc5s3C5F7tjpTbh` are READY with verified `b814d132`
  provenance, green checks, healthy DB, and no runtime/build errors.
- [x] Gili approved exact web deployment `dpl_GZG28S65n3Stk1fQeLiAoi1aEZhb`.
  Vercel created exact production copy `dpl_H6PZJaaeUbLipxFm2NtRJNmDRxKy`, and
  `skitza.app` was cut over after it reached READY.
- [x] Smoke-test `/dashboard/payments` and runtime logs; mark stable or roll back.
  The 15m58s live watch passed with exact alias/SHA, six healthy DB samples,
  zero 5xx, zero warning/error/fatal entries, and normal Payments, Calendar,
  sign-in, and access-link behavior. SK-222 is stable.

### C2. SK-226 30-day booking window — stable in production

The reviewed eight-file patch is merged and live as exact SHA `8595206a`.
Production deployment `dpl_4X6RoK3NNj3GJALJLKjsNsPAmxST` is stable.

- Two related old 14-day ceilings were found and corrected: the horizon helper
  and the producer-local date-range guard now both allow the new 30-day window
  while preserving the existing maximum 365-day lead-time rule. A real Artist
  slot-generator regression proved the second failure before its fix.
- Non-browser code gates are green: 73 focused tests; full web suite with 6,904
  passed and 79 skipped; typecheck; lint; `git diff --check`; and production web
  build. Tests cover inclusive day 30/day 31 exclusion, 48-hour minimum lead,
  producer/Artist timezone boundaries, Google-busy filtering after day 14, and
  the maximum 365-day lead-time integration path.

- [x] SK-222 is stable.
- [x] Update onto current `v3-clean` without losing the eight scoped changes.
  Draft PR #340 now has exact head `7bad8b69` directly on stable `b814d132`.
  Its scope remains eight booking files with no overlap with SK-222/SK-219.
- [x] Verify real 390px, 360px, and desktop booking, including days 15–30,
  inclusive day 30/day 31 exclusion, producer/artist timezone edges, minimum
  lead-time behavior, and Google-busy filtering across days 15–30. A guarded,
  deterministic, database-free proof passed at 1440, 390, and 360px with no
  horizontal overflow or data writes; day 30 was selectable, day 31 disabled,
  a day-20 Google-busy gap absent, and Artist/Studio timezone review correct.
- [x] Run `$skitza-verify`; commit only scoped files; open a current-base PR;
  require green CI and fresh previews. Exact head `7bad8b69` passed 82 focused
  tests, full DB/admin/web suites, typecheck, lint, both builds, CI
  #31631618082, and exact READY web/admin previews.
- [x] Gili approved the verified entire serial plan. Exact head `7bad8b69` was
  squash-merged as `8595206abf1cf16caad25fc682a5ae96dfddebac`; its parent is
  `b814d132` and its tree is byte-for-byte identical to the approved head.
- [x] Verify the exact merged deployment. Exact web preview
  `dpl_ENLxxbbBWom9VgUsQHyb6vRdnxUy` and admin preview
  `dpl_773vUegjhgCBoUYaVriR9fviHq7G` are READY with verified `8595206a`
  provenance, healthy DB, clean scoped logs, and no build errors.
- [x] Under Gili's standing approval, promote exact web preview
  `dpl_ENLxxbbBWom9VgUsQHyb6vRdnxUy`. Vercel production copy
  `dpl_4X6RoK3NNj3GJALJLKjsNsPAmxST` reached READY and `skitza.app` resolved to
  exact `8595206a`.
- [x] Complete the restarted 15-minute watch on exact `dpl_4X6...`. An initial
  unauthenticated probe incorrectly treated the intentional production
  `ACCESS_TOKEN` plain-404 gate as broken routing, so the release was
  conservatively rolled back. Comparing the old deployment proved identical
  behavior. The same exact candidate was re-promoted and token-aware probes now
  pass: Home 200, sign-in 200, protected Calendar/booking routes expected 307,
  and health/DB 200. Unauthenticated plain 404 is expected, not a trigger. The
  corrected watch passed for 15+ minutes: exact alias/SHA stayed READY, repeated
  health checks were HTTP 200 with DB reachable, exact-deployment logs had zero
  5xx and zero warning/error/fatal entries, and no rollback trigger occurred.
- [x] Smoke-test booking/calendar access protection and mark stable. Token-aware
  Home and sign-in returned 200; protected Calendar and Artist booking routes
  returned the expected 307 to sign-in. The reviewed browser proof already
  covered days 15–30, day 30/day 31, busy-time filtering, and timezones.

## Lane D — SK-219 Private Offer, last and alone

Old commit `b377c01a` and every old preview/deployment are obsolete and must
never be reused. A local-only corrected preparation exists in
`/private/tmp/skitza-sk219-replay-e188`. It was cleanly rebased onto stable
`8595206a` as feature replay `70aed7d8`, quick-flow fix `dafa3ca7`, and hardening
fix `9473fa21`. The product patch identity matches the reviewed pre-rebase patch;
there was no changed-path overlap or conflict. Exact head `9473fa21` is pushed
on Linear's branch and draft PR #341 targets `v3-clean`; it is not yet an
approved release head. The six
review blockers are fixed: separate rights/agreement completion, safe legacy
per-song pricing, archived-client acceptance protection, frozen archived-
recipient identity, stable send ID when browser storage fails, and field-level
validation focus/ARIA. Independent review found no remaining code blocker.
Current-base verification passed 262 focused tests with 14 isolated DB skips;
the full workspace passed 7,657 tests with 96 skips; typecheck, lint, web/admin
builds, and diff checks also passed. A two-line optional-chain lint mismatch found
after rebase was fixed without changing behavior and included in exact head
`9473fa21`. The fingerprint-gated disposable PostgreSQL suite then passed 14/14.
Its first real run found only order-dependent fixture pollution and an invalid
paid-project completion setup; the test fixtures were isolated without changing
product behavior. The owned local database was stopped and moved to Trash, with
no cloud/production write. Signed-in browser proof remains required before a
merge.

- [x] Lanes A–C are stable.
- [x] Rebase the feature onto final current `v3-clean`, preserving SK-228
  auth/Home behavior and every intervening production fix.
- [x] Finish exact-head CI and new previews. Independent current-base code
  review, local `$skitza-verify`, GitHub CI, exact web/admin previews, preview
  health, and scoped runtime logs are green on `9473fa21`.
- [x] Test the normal Store wizard, every Private Offer entry path, existing/new
  recipient and project, refresh/draft recovery, duplicate-send/email
  idempotency, Artist acceptance, account exit, desktop, and mobile. Exact
  product UI was visually checked without writes at 1280, 390, and true 360;
  focused/full tests cover draft recovery, existing/new targets, send/email
  idempotency, acceptance, and account exit; the disposable DB suite covers the
  acceptance/race invariants.
- [x] Run the fingerprint-gated disposable-DB race/invariant suite, including
  archive-before-accept, concurrent send/accept/cancel, recipient binding,
  product provenance, and zero-price/payment-state rejection. Never use
  production for this proof.
- [x] After acceptance, verify the correct new/existing Project appears in
  SK-222's Payments Project column. The disposable acceptance proof locks the
  purchase to the accepted Project; the current ledger adapter forwards that
  exact Project ID/title, and SK-222's interaction test locks Project as the
  first desktop column with project de-duplication.
- [x] Gili approves the exact head; merge. Standing approval covers the serial
  plan once every gate is green. Exact head `9473fa21` merged as `2208049b`;
  the trees are identical and the sole parent is stable `8595206a`.
- [x] Verify the exact merged deployment; Gili approves the exact deployment;
  promote. Exact merged web preview `dpl_7cg2z1mkBmEFB7qMeBRVorUMqE4G` and
  admin preview `dpl_Gxa1eDCPC83qB69EsSem3JPL9SXJ` are READY with verified
  `v3-clean` SHA `2208049b`. Web health is HTTP 200 with DB reachable; protected
  route checks are correct; scoped logs contain zero 5xx or warning/error/fatal
  entries. Gili's standing approval covers promoting this verified serial-plan
  deployment. Production is still the prior stable `dpl_4X6Ro...` until cutover.
- [x] Monitor Store, Private Offer, auth, and email errors; confirm the feature is
  actually live; mark stable or roll back. Cutover is confirmed on exact
  production `dpl_6nmbEU37kapmbTcg7agu3sKcbhC5` / `2208049b`; immediate Home,
  sign-in, protected Store/Payments/Calendar, health, DB, 5xx, and error checks
  passed. Independent monitoring ran for more than 16 minutes: exact alias/SHA
  stayed READY, health and DB stayed green (287–353 ms), token-aware Home,
  sign-in, dashboard, Store, and Payments passed each round, and the final
  counts were zero 5xx, warnings, errors, fatals, Store/Private Offer/auth/email
  signals. No rollback trigger; SK-219 is stable.

## Lane E — SK-229 invitation-only Producer access and public launch

This is the final lane and must not overlap SK-219's cutover/watch. The isolated
worktree is `/private/tmp/skitza-sk229` on Linear's exact branch
`giasraf/sk-229-make-producer-access-invitation-only-and-open-the-public`.
Exact pushed head `6c89253d` is one commit directly on production-stable
`v3-clean` `2208049b` in draft PR #342. The final integration correction is
included in that exact clean head and independently reviewed. It makes Clerk
webhooks lifecycle-only, protects the
no-role Artist gate, retires stale public waitlist/changelog entry points, binds
invitation redirects to the selected environment, preserves signed-in
invitation tickets through an explicit account switch, production-gates every
`/dev` fixture, and prevents invitation tickets from reaching telemetry,
replay, or Referer headers. The patch has zero changed-path overlap with
SK-219, SK-222, or SK-226, and a merge simulation is clean. `artifacts/`
contains eight untracked screenshots and must not enter the product commit.

Current Clerk documentation confirms application-invitation statuses include
`pending`, `accepted`, `revoked`, and `expired`; `ignoreExisting: true` permits
an invitation for an existing user; and invitations default to a 30-day expiry.
The real Test Clerk environment must still prove those semantics in this app.

- [x] Finish integration review of the rebased SK-229 patch. SK-219 is stable;
  the local-only branch was rebased without conflict onto exact `2208049b` as
  `c1eb686c`; stable patch ID remained `875c9948`, scope remained 60 files, and
  it was 1 ahead / 0 behind. Review found one real role-grant defect: an
  ordinary Clerk signup could inherit matching unowned Artist contacts. The
  focused correction makes the signed webhook lifecycle-only and leaves Artist
  grants to the authenticated join continuation, which rechecks the exact
  Clerk user, verified email, and target Producer. Independent role and public-
  invite and ticket-privacy reviews approved the exact correction. Final head
  `6c89253d` is clean except for the excluded old `artifacts/` folder and has
  zero changed-path overlap with the stable release lanes.
- [x] Run `$skitza-verify` on the exact rebased head. On `6c89253d`, workspace
  typecheck and lint passed; DB 257, admin 404, and web 7,088 tests passed
  (7,749 total; 96 intentional skips); web/admin production builds, formatting,
  and diff check passed. Independent auth, public-route, invitation-ticket, and
  telemetry reviews report no remaining code blocker. Real Clerk/browser and
  production migration gates remain separate.
- [x] Finish migration `0049_producer_invitation_grants.sql` proof on an
  explicitly fingerprinted PostgreSQL 17 target verified through exact 0048.
  An owned Unix-socket-only PostgreSQL 17.10 target passed the exact 0027–0048
  ledger/replay, concurrent 0049 apply, replay, catalog/append-only constraints,
  invalid/duplicate rejection, and the real application claim path including
  concurrency, idempotency, conflict, and transaction rollback. DB typecheck,
  257 DB tests with 11 skips, and 6/6 grant tests passed; the cluster was stopped
  and removed. The archived tree is missing historical 0021, so the rehearsal
  used its exact reviewed Git blob/digest before 0027's strict source check.
  Final digests: 0048 `46abbd4c...f83d95`; 0049 `67386b9d...0c986`. Never use
  `quiet-sun-92221754`; never touch production without separate approval for
  that exact migration run.
- [ ] In real Test Clerk, verify new Producer, existing Artist signed-in and
  signed-out, exact-email matching, wrong account/email, expired, revoked,
  forwarded, reused, duplicate, and webhook-retry cases. Confirm invitation
  status/expiry behavior from Clerk itself, not mocks. Preserve Artist access and
  dual-role switching; generic signup/create-studio must grant no Producer role.
  Bind the isolated Test web, Test DB, and Test Clerk instance together. Set
  `ADMIN_TEST_WEB_APP_URL` to that distinct HTTPS web origin; Live remains
  pinned by `ADMIN_LIVE_WEB_APP_URL=https://skitza.app`. Clerk must redirect the
  secret invitation ticket to that origin&apos;s `/sign-up`. Revoke/ignore marked
  pending invitations created before this redirect binding.
- [ ] Push only Linear's exact branch; open a draft PR; require fresh exact-head
  CI, exact web/admin previews, health/log checks, and an independent security/
  authorization review. Exact branch/head are pushed and draft PR #342 is open;
  independent reviews passed. Fresh CI and exact preview gates are running.
- [ ] Browser-check exact preview at desktop, true 390, and true 360. Verify Home,
  About, Privacy, Terms, sign-in, Artist join, Producer invitation entry,
  protected app routes, Google Calendar connect/callback, normal Store/Private
  Offer, and no launch-token removal yet.
  Confirm retired `/get-started(.*)` and `/changelog` remain 404 and that the
  public waitlist mutation is unavailable. Confirm every `/dev` fixture is 404
  in Production. Confirm invitation URLs use `no-referrer`, do not initialize
  PostHog/Sentry Replay, and redact `__clerk_ticket` from every payload channel.
- [ ] Confirm the legal operator/address, monitored `legal@skitza.app` and
  `privacy@skitza.app` inboxes, jurisdiction/age language, and final legal review
  before opening public traffic. This is a real public-launch gate, not a code
  test.
- [ ] Approve and merge the exact reviewed head. Verify the exact merged
  deployment while the current production and launch gate remain unchanged.
- [ ] Obtain separate exact approval, then apply additive migration 0049 to
  production before new code. Verify schema and idempotency; stop and roll back
  the release if the migration does not match the disposable proof.
- [ ] Promote the exact merged build behind the existing launch gate; verify real
  production invitations, Artist role preservation, auth, and Google Calendar.
- [ ] Only after every preceding gate passes, remove the launch-token gate, build
  and verify a fresh exact-SHA deployment, promote it, and monitor public pages,
  invitations, auth, Calendar, Store/Private Offer, health/DB, 5xx, and error
  signals for at least 15 minutes.

## Explicitly blocked or excluded

- **Revised SK-217:** blocked. A public version UUID can reveal private versions,
  token reset/disable no longer revokes access, anonymous RSC data exposes
  financial state, and signed-in nonowners can lose guest access. Keep current
  `/listen/<token>` behavior until Gili resolves the product/security conflict and
  a safe implementation is reviewed. Its current middleware also exempts every
  sign-in/sign-up URL from the prelaunch access gate and directly overlaps
  SK-225; do not stack or rebase it into the release queue.
- **Orphaned SK-220 UI cleanup:** dangling commit `18060d37`, based on stale
  calendar code. Do not merge as-is. It is not a fix for the live repair-wake
  failures.
- **Old/stale open PRs:** do not enter the release queue. Patch-equivalent PRs
  must not be merged again; superseded/conflicting work must be reimplemented on
  current `v3-clean` only if separately requested.
- **Dirty root checkout:** quarantined. It is hundreds of commits behind and
  contains overlapping user-owned changes and untracked files.

## Rollback triggers

Roll back immediately to the previous verified deployment if any of these occur
after promotion:

- `/api/health` fails or database reachability changes.
- Sustained new 5xx responses or a clear error spike in the changed flow.
- Google OAuth links the wrong producer/browser, permits replay, or callback
  success materially regresses.
- Calendar desktop drawer/hover or 390px/360px mobile behavior breaks.
- Legacy invite, Book, Unlock, or owner/artist route guards route incorrectly.
- Payments cannot load or shows incorrect project mapping.
- Booking exposes unavailable dates, exceeds the intended 30-day window, or
  ignores busy-time protection.
- Private Offer breaks normal Store, authentication, recipient/project selection,
  acceptance, or email idempotency.

## Change log

- 2026-08-11: Initial authoritative plan created. Production left unchanged. PR
  #337 and #336 confirmed green, mergeable, draft, and held for approval.
- 2026-08-11: Corrected SK-225 head `51f24770` passed focused independent
  security review. Both earlier blockers are fixed; full current-base release
  gates remain pending.
- 2026-08-11: Gili approved exact SK-227 head `3d2ad1bc`; PR #337 was squash
  merged into `v3-clean` as `682610cf`. Production was not promoted. SK-228
  current-base update and reverification started.
- 2026-08-11: Corrected SK-225 work is now draft PR #338 with old-base CI and
  builds green. It remains held behind Lane A and its real HTTPS OAuth browser
  gate is still incomplete.
- 2026-08-11: SK-228 was cleanly rebased and lease-safe pushed as `5fde1361` on
  `682610cf`. Its patch identity and 13-file scope are unchanged; current-base
  local verification is green while new-head CI, previews, and browser checks run.
- 2026-08-11: SK-228 web/admin previews became READY and the four-route HTTPS
  browser verification passed without console errors. GitHub CI #776 remains the
  only automated gate before requesting merge approval.
- 2026-08-11: GitHub CI #776 completed successfully. SK-228 exact head
  `5fde1361` is fully verified and held for Gili's merge approval. Production is
  unchanged.
- 2026-08-11: Gili approved exact SK-228 head `5fde1361`; PR #336 was squash
  merged into `v3-clean` as `5696b3dd`. Combined deployment verification began;
  production remained unchanged.
- 2026-08-11: Combined web/admin deployments became READY and non-production.
  Exact tree identity, health, and runtime-error checks passed. Exact-preview
  authenticated calendar and valid-producer invite smoke remain PARTIAL because
  no suitable preview session/data exists; prior reviewed previews passed both
  feature flows.
- 2026-08-11: Gili rejected the merged SK-227 desktop booking panel, approved
  its hover behavior, and supplied the exact correct desktop screenshot. SK-227
  was reopened and its Linear description corrected; the screenshot is attached
  there as the durable visual source of truth. Production remains rolled back at
  `b1e12657`. Forensic blob comparison found the minimal target combination:
  SK-224 modal `fbc4c656` + current SK-227 grid hover `a54bea5c`, with current
  mobile behavior preserved. No existing historical commit contains this hybrid.
- 2026-08-11: Corrected SK-227 head `317d1353` was created directly on
  `5696b3dd` and pushed for preview only. It changes one runtime file and one
  matching test. Local typecheck, lint, 19 focused tests, 6,908 full tests, and
  production build passed. Nothing was merged or promoted; exact-preview visual
  verification is pending.
- 2026-08-11: Corrected preview `dpl_dc1R24SNqoKbs32wWjZtY62XuLZu` became
  READY. Exact-component browser checks passed at desktop, 390px, and 360px;
  screenshots were captured and the desktop/390px proofs attached to SK-227.
  Draft replacement PR #339 opened with one commit and two files. GitHub CI is
  running; nothing was merged or promoted.
- 2026-08-11: PR #339 GitHub CI run #31527913464 passed after typecheck, lint,
  full tests, and web/admin builds. Exact head `317d1353` passed its code,
  changed-drawer, mobile, and hover gates, but is held before merge because the
  complete closed-drawer desktop Calendar still lacks session-rail proof.
  Production is unchanged.
- 2026-08-11: Gili caught that the desktop evidence did not show the session
  list. PR #339 does not alter it: the real desktop Calendar still renders the
  260px **Upcoming sessions** rail and the same files/blobs exist in production,
  merged Lane A, and the candidate. However, all corrected screenshots used the
  no-account-data gallery and/or had the booking drawer open over that rail.
  Merge is paused until an exact-preview, closed-drawer, populated screenshot
  proves the full Calendar. Production remains unchanged.
- 2026-08-11: A fresh Lane A audit reconfirmed PR #339 is exact-head, clean,
  mergeable, and fully green. Exact-head focused rail tests passed 11/11 and
  prove populated rendering plus the real desktop wiring. A no-write local
  authenticated check was attempted with the available environment, but the
  in-app browser could not follow the local Clerk redirect; the visual gate
  remains honestly `PARTIAL`. Nothing was merged or promoted.
- 2026-08-12: Missing desktop session-rail proof completed through temporary
  preview `dpl_96UUVzrfj9J8LVNrU6nRUco6Xyqb`, built from candidate `317d1353`
  plus one uncommitted dev-only proof route. At 1440x900 the exact Calendar
  components showed the closed 260px **Upcoming sessions** rail, two fake-data
  rows, Upcoming/Past/All controls, no overflow, and no app console errors. The
  screenshot is attached to SK-227; the route was deleted locally and PR #339
  remains unchanged, clean, and held for exact-head merge approval. Production
  is unchanged.
- 2026-08-12: SK-226 old-base preparation now contains eight scoped uncommitted
  files. Independent review caught both stale 14-day range ceilings; both are
  fixed, including a generator-level regression that failed before the second
  fix. Seventy-three focused tests and all non-browser code gates are green.
  It remains uncommitted and held behind SK-222 for current-base rebase,
  previews, and real desktop/390px/360px browser verification.
- 2026-08-12: Fresh release-state audit found no new `v3-clean` commit after
  `5696b3dd` and no new production alias change. `skitza.app` still resolves to
  `dpl_H5bY1uU8MeA7uSSJes6J3KCWd8JT`; `/api/health` returned HTTP 200 with the
  database reachable. PR #339 remains exact head `317d1353`, open, ready for
  review, clean, mergeable, and fully green.
- 2026-08-12: Gili approved exact PR #339 head `317d1353`. It merged by squash
  into `v3-clean` as `85049ab8`; the merged tree exactly equals the reviewed
  head and changes only the modal source and matching interaction test.
  Production remains on `dpl_H5bY1uU8MeA7uSSJes6J3KCWd8JT` / `b1e12657`
  while the fresh merged deployment is verified.
- 2026-08-12: Exact merged SHA `85049ab8` produced READY, preview-only web
  deployment `dpl_BpGT5fcw4o2dEeix3qMKACjzLXfq` and admin deployment
  `dpl_7PUXURrUc6Caz62TK6FkypmRXPJv`. Both report exact `v3-clean` provenance;
  GitHub deployment statuses are green and initial web runtime logs contain no
  error/fatal entries. No alias or production change has occurred.
- 2026-08-12: Gili-authorized Google sign-in completed the exact merged web
  preview check. The real authenticated Calendar showed its populated Upcoming
  sessions rail with the drawer closed, and the approved simple right drawer
  with native Client/Project dropdowns when opened. Exact-preview health was
  HTTP 200/DB reachable; no application console errors appeared. Both fresh
  screenshots are attached to SK-227. Production is still unchanged pending
  exact deployment approval.
- 2026-08-12: Gili approved exact preview deployment
  `dpl_BpGT5fcw4o2dEeix3qMKACjzLXfq`. `vercel promote` created production build
  `dpl_BK1pBmgpqMJVtC3AvBaCFEsUf4fV`; during its build, `skitza.app` correctly
  remained on prior deployment `dpl_H5bY1uU8MeA7uSSJes6J3KCWd8JT`, whose health
  remained HTTP 200/DB reachable. The new build must reach READY and prove exact
  SHA before the alias movement is accepted.
- 2026-08-12: Production build `dpl_BK1pBmgpqMJVtC3AvBaCFEsUf4fV` reached READY
  with exact approved SHA/provenance but stayed staged; `vercel promote status`
  reported no operation in progress and the project had no blocking deployment
  checks. `skitza.app` was therefore explicitly assigned to that exact READY
  deployment at about 07:32 IDT. Vercel inspect now resolves `skitza.app` to
  `dpl_BK1p...`; immediate health is HTTP 200/DB reachable. The previous
  deployment `dpl_H5bY1uU8MeA7uSSJes6J3KCWd8JT` remains the rollback target.
- 2026-08-12: Lane A production monitoring completed well beyond the required
  15 minutes. `skitza.app` remained on exact approved deployment `dpl_BK1p...`;
  final health was HTTP 200/DB reachable (102 ms). The one-hour deployment log
  audit contained 52 successful 200s, zero 5xx, zero error/fatal entries, zero
  Google callback 401s, and zero repair-wake errors. The only six 404s were the
  known private access gate. Lane A is stable; no rollback occurred.
- 2026-08-12: Independent final production audit extended the watch past 50
  minutes after cutover. All 52 deduplicated post-cutover requests were HTTP
  200; health/DB remained green, and every rollback counter stayed zero. This
  independently confirms Lane A stable.
- 2026-08-12: SK-225 rebased cleanly to stable SHA `85049ab8` as exact head
  `75a4fca3`; unchanged patch identity, independent security approval, 96 focused
  tests, 7,553 full tests, typecheck/lint, and web/admin builds all passed. Fresh
  exact-head CI and web/admin previews are green. The live Calendar OAuth test has
  not yet begun; PR #338 remains draft and unmerged.
- 2026-08-12: The live-proof boundary was tightened without touching Google,
  code, PRs, deployments, or data. Exact-head tests already prove invalid,
  expired, replayed, wrong-producer, and wrong-browser state handling, producer-
  scoped tRPC completion, fixed-origin redirects, and transaction-cookie
  clearing. The remaining real proof is intentionally narrow: finish the Google
  phone challenge, confirm a callback without live Clerk, use one genuinely
  isolated browser/device to prove a forwarded URL rejects without consuming the
  initiator's state, then confirm the initiator can still finish. A second tab is
  not valid isolation because it shares the same cookie jar.
- 2026-08-12: A fresh read-only drift audit found no overwrite. `origin/v3-clean`
  and live `skitza.app` remain exact Lane A SHA `85049ab8`; PR #338 is unchanged,
  draft, mergeable, and green; PR #335 is unchanged and held; no newer production-
  target web deployment or active promotion exists. Vercel's project-level
  production target and default project alias still reference prior deployment
  `dpl_H5b...`, while `skitza.app` correctly resolves `dpl_BK1p...`; future
  release actions must verify the custom domain directly and never infer live
  traffic from that stale internal pointer.
- 2026-08-12: On resumed browser verification, Google's earlier trusted-device
  challenge had expired safely. No Calendar OAuth transaction completed and no
  connection was changed. The browser safety gate denied automatic navigation
  back to the private exact preview, so verification is paused until Gili opens
  that preview directly; no alternate browser or indirect workaround was used.
- 2026-08-12: Cross-task audit found one other active Skitza task, SK-229
  invitation-only Producer access. It is isolated in `/private/tmp/skitza-sk229`
  on Lane A base `85049ab8`. The task was explicitly held at local implementation
  and verification: no rebase/push/PR/merge/deploy/migration/settings change.
  Direct overlap is limited to SK-225's middleware source and test; SK-222,
  SK-226, and the SK-219 feature commit have no direct changed-path overlap.
  Old SK-219 previews remain forbidden because their full repository snapshot
  contains stale auth code. The SK-229 task received this exact collision map.
- 2026-08-12: Independent release-boundary review confirmed a real SK-225 Google
  callback cannot run on the exact Preview without changing Google/Vercel
  settings or using Production state. Preview does not inherit the Production-
  only Calendar configuration; Google requires an exact authorized redirect; and
  the fixed Production redirect returns to live `skitza.app`, not the candidate
  host. This pre-promotion browser gate is recorded as configuration-blocked, not
  passed. The controlled exception and rollback plan are recorded on PR #338 in
  comment `5266939194`.
- 2026-08-12: Final pre-approval drift check: PR #338 is still OPEN/DRAFT/CLEAN/
  MERGEABLE at exact head `75a4fca3992a2fcc7985a24670e2e137f832a7e4`
  directly on unchanged `origin/v3-clean` `85049ab8`; GitHub CI and both current
  Vercel checks are SUCCESS, the branch worktree is clean, and `git diff --check`
  passes. It is now held only for Gili's explicit approval of that exact head.
- 2026-08-12: Gili approved exact SK-225 head `75a4fca3`. PR #338 was marked
  ready and squash-merged into `v3-clean` as `e1886d1d8221e4ece06844c2d577bcb244e32ba2`.
  The merge parent is exact Lane A `85049ab8`; merged tree `3a08d395` is byte-for-
  byte identical to the approved head tree; the exact 16-file scope and clean
  diff are preserved. Production and its alias were not changed.
- 2026-08-12: The exact merged SK-225 deployment gate passed. Web deployment
  `dpl_7dsqNctbgCMZdTiPzrF6d6QzEYHW` and admin deployment
  `dpl_HeZsqhgfiY9syUmCX59xoSzY1BHa` are READY/STAGED, preview-only, and verified
  as exact `v3-clean` SHA `e1886d1d`; GitHub web/admin checks are successful.
  Health is HTTP 200 with DB reachable, signed-out Calendar redirects correctly,
  and 17 scoped requests contain no 5xx or error/fatal entries. Live
  `skitza.app` remains unchanged on stable Lane A `dpl_BK1p...`; no production
  deployment or promotion is in progress. The real Google proof remains the
  documented Production-only post-promotion gate.
- 2026-08-12: Gili explicitly approved promotion of exact web deployment
  `dpl_7dsqNctbgCMZdTiPzrF6d6QzEYHW`. Vercel created verified production copy
  `dpl_9NiLkFBqu2qaWf3Zj9i8XHJznRWC` from it; after READY, `skitza.app` was
  explicitly cut over and independently confirmed at exact SHA `e1886d1d`.
  The extended watch stayed healthy with zero 5xx and zero callback 401s. The
  real Google proof reached Google but is paused at a human-only confirmation;
  no callback or connection change has occurred yet. Four intermittent repair-
  wake failures repeated a known pre-SK-225 background issue without page/HTTP
  failure; track separately unless it becomes functional.
- 2026-08-12: Parallel SK-229 remains isolated and held. Its local worktree is
  `/private/tmp/skitza-sk229`, still based on `85049ab8`, with 44 modified and 21
  new uncommitted files. Typecheck, lint, builds, 335 focused tests, 7,610 full
  tests with 90 skipped, and desktop/390/360 visual checks passed. It has not
  rebased, pushed, opened a PR, migrated, deployed, or changed external settings.
  After Lane B is stable it must rebase onto exact current `v3-clean`, re-review
  `middleware.ts` plus its test, test migration 0049 only on a disposable Test
  database, and complete real Clerk invitation checks before any integration.
- 2026-08-12: Gili approved exact SK-222 head `1bc62e58`. PR #335 was marked
  ready and squash-merged into `v3-clean` as
  `b814d132e5d38f6d991e1339d9bd76cfb3118493`. Its parent is exact prior stable
  `e1886d1d`; merged tree `6fbbb10b` is byte-for-byte identical to the approved
  head tree, and the merged diff remains exactly the two reviewed Payments
  files. Production remains unchanged pending exact merged-deployment proof and
  separate approval.
- 2026-08-12: The exact merged SK-222 deployment gate passed. Web preview
  `dpl_GZG28S65n3Stk1fQeLiAoi1aEZhb` and admin preview
  `dpl_AgzUbGEywcmT4qc5s3C5F7tjpTbh` are READY with exact `b814d132` provenance
  and successful GitHub checks. Web health is HTTP 200 with DB reachable; the
  Project-first fixture is present; scoped web/admin logs and build logs contain
  no errors. Live `skitza.app` remains unchanged on `dpl_9NiLk...` / `e1886d1d`
  pending Gili's separate approval for the exact web deployment.
- 2026-08-12: Gili approved the entire verified serial plan, including exact
  SK-222 web preview `dpl_GZG28S65n3Stk1fQeLiAoi1aEZhb`. Vercel created exact
  production copy `dpl_H6PZJaaeUbLipxFm2NtRJNmDRxKy`; after READY it was
  explicitly promoted, and `skitza.app` resolved to exact SHA `b814d132`.
  Initial health and DB checks pass with no 5xx or error/fatal entries; the
  required production watch is in progress. Rollback remains `dpl_9NiLk...`.
- 2026-08-12: SK-222's production watch passed after 15m58s. `skitza.app`
  stayed READY on exact `dpl_H6PZJaaeUbLipxFm2NtRJNmDRxKy` / `b814d132`;
  six health samples were HTTP 200 with DB reachable, runtime had zero 5xx and
  zero warning/error/fatal entries, and Payments, Calendar, sign-in, and access
  links behaved normally. SK-222 is stable; no rollback was needed.
- 2026-08-12: SK-226 reached draft PR #340 at exact head `88597f80` on
  `b814d132`, with full local gates, CI, and exact previews green. An independent
  pre-merge review correctly blocked that head: intraday `now` values can yield
  only 29 bookable dates because the range count rounds lead time by whole days
  and then exact filtering removes the first partial day. The established SK-190
  semantics and Linear's “one month of bookable dates” require a full configured
  choice window after the exact lead-time cutoff. Merge remains held while the
  boundary fix and intraday regression are completed and reverified.
- 2026-08-12: The first intraday patch `3cda0403` was also rejected before merge
  because its carry-day heuristic returned 29/31 dates across daylight-saving
  changes and 31 dates for a one-hour UTC lead. It was never merged or promoted.
  The replacement derives the exact lead boundary, chooses the first producer-
  local civil date, and generates exactly 30 dates without a carry heuristic.
  Independent review passed spring/fall/repeated-clock adversaries, zero/short/
  maximum leads, no-weekday cases, producer-path isolation, 82 focused tests,
  and 972 timezone/lead/slot combinations. The exact approved correction was
  amended and lease-safe pushed as PR #340 head `7bad8b69`; fresh full CI and
  previews passed. Under Gili's approval of the verified serial plan, PR #340
  was squash-merged as `8595206a`; parent is exact stable `b814d132`, merged tree
  is identical to the approved head, and production remains unchanged pending
  exact merged-deployment verification.
- 2026-08-12: Exact merged SK-226 preview passed and was promoted under Gili's
  standing approval as production deployment `dpl_4X6RoK3NNj3GJALJLKjsNsPAmxST`.
  An unauthenticated monitor then raised a false routing alarm because production
  intentionally returns plain 404 without the prelaunch `ACCESS_TOKEN`; the old
  deployment behaved identically. Root conservatively rolled back, proved the
  cause, re-promoted the same exact candidate, and corrected the gate. Token-aware
  Home/sign-in checks are 200, protected Calendar/booking checks are expected
  307, and health/DB is 200. The corrected 15-minute watch restarted; later lanes
  remain held until it finishes.
- 2026-08-12: The corrected SK-226 production watch passed after 15+ minutes.
  `skitza.app` stayed READY on exact `dpl_4X6RoK3NNj3GJALJLKjsNsPAmxST` /
  `8595206a`; repeated health checks were HTTP 200 with DB reachable, exact
  deployment logs had zero 5xx and zero warning/error/fatal entries, and
  token-aware Home/sign-in/Calendar/Artist-booking access behavior was correct.
  No rollback trigger occurred. Lanes A–C are stable; SK-219 is next and alone.
- 2026-08-12: SK-219's three reviewed commits were rebased cleanly onto exact
  stable `v3-clean` `8595206a` as `70aed7d8`, `dafa3ca7`, and `4e2e7b5c`.
  Combined patch identity is preserved and there is no changed-path overlap with
  the intervening releases. Current-base verification passed 262 focused tests,
  7,657 full workspace tests, typecheck, lint, web/admin builds, and diff checks.
  Nothing has been pushed or deployed; disposable-DB and browser proof remain.
- 2026-08-12: SK-219's fingerprint-gated disposable PostgreSQL suite passed
  14/14 on exact head `9473fa21`. The first real run exposed order-dependent
  test-fixture state and an invalid paid-project completion setup; only those
  fixtures were corrected. The local schema retained all four ownership
  constraints, two recipient columns, and two required triggers. The owned local
  cluster was stopped and moved to Trash; no cloud database was written.
- 2026-08-12: Exact reviewed SK-219 head `9473fa21` replaced the obsolete remote
  snapshot on Linear's exact branch and draft PR #341 was opened against
  `v3-clean`. Linear records the exact head/base, 14/14 disposable-DB result,
  and the fact that no production data/email/payment/migration was touched.
  Fresh exact-head CI/previews and signed-in browser proof are now the active
  gates; nothing has been merged or promoted.
- 2026-08-12: SK-219 PR #341 passed its exact-head online gate. GitHub CI passed
  typecheck, lint, tests, and both builds. Exact READY previews are web
  `dpl_4osstJCLAhe8eRyJDvMBkLSDH9sh` and admin
  `dpl_Dy6rqGULyH8wf7tPyZTzjRfe3siN`; web health returned HTTP 200 with DB
  reachable and scoped runtime logs contained no 5xx or warning/error/fatal
  entries. Browser proof remains the only pre-merge gate.
- 2026-08-12: SK-219 browser gate passed with the real Store card and Private
  Offer composer at desktop/1280, 390, and true 360 using a guarded data-free
  route. Fixed price, per-song independent subtotal, missing rights, missing
  agreement, and all eight custom-offer steps reached Review; final Send was
  disabled and no server/data/email/payment action ran. There was no horizontal
  overflow and browser errors were zero. The temporary route was deleted and
  the feature worktree is clean at exact remote head `9473fa21`.
- 2026-08-12: SK-219 PR #341 merged as exact `v3-clean` commit `2208049b`.
  Its sole parent is stable `8595206a` and its tree exactly equals approved
  head `9473fa21`; production remains unchanged while exact merged previews are
  verified.
- 2026-08-13: SK-219's exact merged-deployment gate passed. Web
  `dpl_7cg2z1mkBmEFB7qMeBRVorUMqE4G` and admin
  `dpl_Gxa1eDCPC83qB69EsSem3JPL9SXJ` are READY preview deployments with verified
  SHA `2208049b`. Health/DB and access-route checks passed; deployment-scoped
  logs had zero 5xx or warning/error/fatal entries. The prior production
  `dpl_4X6Ro...` remains the rollback while the approved cutover begins.
- 2026-08-13: Final-lane SK-229 audit completed without changing its branch.
  Local head `38aabec6` is one commit on stale base `e1886d1d`, three commits
  behind merged `v3-clean`, with zero changed-path overlap and a clean merge
  simulation. It remains held until SK-219 is production-stable. Migration 0049,
  real Test Clerk invitation flows, true 360/390/desktop preview evidence, and
  the legal/public-launch decisions are recorded above as hard gates.
- 2026-08-13: SK-219 cut over to exact production
  `dpl_6nmbEU37kapmbTcg7agu3sKcbhC5` / `2208049b`, promoted from approved
  `dpl_7cg2z1...`. The custom domain resolves the exact READY build; token-aware
  Home/sign-in returned 200, protected Store/Payments/Calendar redirected to
  sign-in, and health returned 200 with DB reachable. Initial 5xx and runtime
  error checks are empty; the 15+ minute watch is active with `dpl_4X6Ro...` as
  rollback.
- 2026-08-13: SK-219 production watch passed from about 00:05 through 00:21 IDT
  (>16 minutes). `skitza.app` stayed exact READY on `dpl_6nmb...` / `2208049b`;
  health/DB and all token-aware route checks remained green, with zero 5xx,
  warning, error, fatal, Store, Private Offer, auth, or email failure signals.
  Rollback was not used. Lane D is stable and Lane E is now the only release
  lane.
- 2026-08-13: During the clean SK-219 watch, SK-229's isolated local commit was
  rebased without conflict onto exact merged base `2208049b` as `c1eb686c`.
  Stable patch ID remains `875c9948`, the 60-file scope is unchanged, and the
  branch is now 1 ahead / 0 behind. It remains local-only and held; independent
  combined auth/middleware review and all other final-lane gates are still open.
- 2026-08-13: SK-229 exact rebased head `c1eb686c` passed its local code gate:
  workspace typecheck/lint, 7,723 tests with 96 intentional skips, web/admin
  production builds, and diff check. The branch remains local-only; this does
  not replace disposable migration, real Clerk, preview/browser, legal, or
  release verification.
- 2026-08-13: SK-229 migration 0049 passed an owned local socket-only PostgreSQL
  18 audit: concurrent/idempotent runner behavior, catalog constraints,
  append-only trigger, invalid/duplicate rejection, claim concurrency/conflict,
  and rollback all passed; the target was destroyed. This is partial only:
  immutable migration 0027 correctly rejects PG18's different source catalog,
  so a PostgreSQL 17 or isolated Neon preview already certified through exact
  0048 remains the required end-to-end migration rehearsal.
- 2026-08-13: The final PostgreSQL 17.10 rehearsal passed the exact through-0048
  baseline, concurrent/idempotent 0049 application, and the real invitation-
  grant claim path; the owned socket-only target was destroyed. Independent
  auth review also found and stopped a generic-signup Artist-role leak before
  push. The focused lifecycle-only webhook correction and trusted join path pass
  62/62 tests; independent review and full verification are still required
  before amending the local commit.
- 2026-08-13: SK-229 integration is now frozen as exact pushed head `6c89253d`
  on stable base `2208049b` in draft PR #342. Final local verification passed
  workspace typecheck/lint, 7,749 tests with 96 intentional skips, both
  production builds, formatting, and diff checks. Independent role, route,
  signed-in invitation, migration, and ticket-privacy reviews found no remaining
  code blocker. Production is unchanged; fresh exact-head CI/previews and the
  isolated Test Clerk/browser matrix are the active gates.
