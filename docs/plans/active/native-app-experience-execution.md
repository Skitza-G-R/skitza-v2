# Native App Experience — Autonomous Execution Plan

**Status:** Ready for execution

**Date:** 2026-07-24

**Parent issue:** [SK-107](https://linear.app/raz-stamper/issue/SK-107/deliver-the-skitza-native-app-experience)

**Product contract:**

- [Repository brief](../../product/native-app-experience.md)
- [Linear brief](https://linear.app/raz-stamper/document/skitza-native-app-experience-b73a0f92bf5e)

## Intended handoff

One root Codex chat owns this program from start to finish. It delegates bounded work to three
reusable worker chats, integrates their commits, verifies the combined result, captures the final
screenshots, opens and merges one PR to `v3-clean`, waits for the automatic `v3-clean` deployment,
and gives Gili one URL to test on a real iPhone.

Gili's expected hands-on work is the final iPhone test. Her request in the planning session is
approval to merge the single in-scope SK-107 PR after every gate in this document passes.

That approval does **not** cover:

- a production database migration;
- promotion of a deployment or pointing `skitza.app` at it;
- a material product or scope change caused by conflicting source-of-truth information.

Those actions require exact approval if they become necessary.

## Root-chat start instruction

Give the orchestrating chat this document and say:

> Execute SK-107 from this plan. Do not return another plan. Stay as the root owner until the
> integrated PR is merged and the automatic `v3-clean` deployment is READY. Reuse three worker
> chats, follow the issue dependencies and file ownership exactly, keep the dirty SK-82 checkout
> untouched, and make normal technical decisions yourself. Report to me only if a listed stop
> condition occurs; otherwise my only task is the final iPhone test.

The root should create an internal task checklist from the execution waves, then begin Wave 0
immediately. It should not ask Gili to repeat decisions already recorded here or in the product
contract.

## Product defaults locked for autonomous execution

These choices close the remaining discovery questions without changing the confirmed experience:

1. Keep the producer and artist navigation approved in SK-99. Discovery tab lists were examples,
   not a new information architecture.
2. A signed-in repeat client is treated as an artist. Anonymous visitors never receive install
   guidance or signed-in app tabs.
3. Push notifications default off. Permission is requested only after the user deliberately
   enables a real alert.
4. Push categories are limited to events the product actually has: bookings, payments or payment
   proofs, comments, and important project/song/purchase status changes. Do not create fake
   messages or notification switches.
5. Installation guidance is eligible after a signed-in producer or artist completes a meaningful
   successful action. It appears on a later visit, never over the success moment or on first
   launch. Dismissal suppresses it for 90 days; installation suppresses it permanently for that
   browser profile.
6. iPhone uses a short Add to Home Screen explanation. Browsers with a native install prompt use
   that prompt.
7. View snapshots are an allowlist, not a blanket cache. Keep at most the 20 most recently viewed
   route states for seven days. Transactional state may be readable offline with its last-updated
   time, but its actions remain disabled until live confirmation.
8. Drafts remain until submitted, explicitly discarded, or 30 days old.
9. Recent unlocked audio uses least-recently-used eviction: at most 10 items, at most 30 days, and
   no more than the smaller of 250 MB or 20% of the browser's reported storage quota.
10. Locked audio, protected delivery responses, signed URLs, auth responses, payments, bookings,
    and authenticated HTML/RSC/API traffic are never placed in a shared service-worker cache.
11. No vibration is implemented. Native feedback comes from immediate visual response, motion,
    and local status.

If a technical limit makes one of these numbers unsafe, the root may reduce retention without a
product checkpoint. It may not expand private caching or weaken an authorization boundary.

## Runtime shape

```text
tap / reopen
     |
     v
persistent role shell ---------------------> player + upload managers
     |                                               |
     v                                               v
account-scoped view store                       app-level activity
     |  show safe cached context
     |  refresh silently
     v
current server data

service worker: install assets + explicit safe public resources only
```

The service worker provides installation, static assets, safe public caching, offline boundaries,
push handling, and coordinated updates. It does not become a general authenticated response cache.

Private repeat-use continuity belongs to an app-owned, versioned data store keyed by Clerk user,
role, and studio/producer context. SK-111 must write a short ADR choosing the smallest approach
compatible with the current Next.js server-page architecture, then prove it on one producer and
one artist route before expanding it.

## Orchestrator and worker model

The root keeps three worker chats alive and reuses them across waves.

| Owner             | Work                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root orchestrator | Linear state, clean integration worktree, source conflicts, shared mounts, commit review, cherry-picks, final fixes, QA, screenshots, PR, merge, deployment handoff |
| Worker A          | PWA/update foundation, then Web Push/install guidance, then public route pass                                                                                       |
| Worker B          | Interaction primitives, then instant state/drafts/navigation, then producer route pass                                                                              |
| Worker C          | Audio/upload continuity, then artist route pass                                                                                                                     |

### Exclusive ownership

- Worker A: manifest, icons, service worker, registration, update/offline runtime, push backend and
  subscription settings. It does not mount providers into shared shells without the root.
- Worker B: shared native UI primitives/CSS, persistence/restoration/draft utilities, shell and
  navigation continuity, producer pages.
- Worker C: audio and upload modules, Media Session, recent-audio cache, artist pages.
- Root: shared composition files, anonymous/public pages if Worker A is still busy, integration
  conflicts, and final QA-only corrections.

If a worker needs a file outside its ownership, it asks the root to make or reassign that change.
Workers never resolve shared-file conflicts by themselves.

## Git and worktree model

The current checkout is a dirty SK-82 worktree. Do not modify, clean, stash, commit, or reuse it.

1. Fetch `origin/v3-clean`.
2. Create a clean integration worktree under `/private/tmp` from current `origin/v3-clean`.
3. Check out Linear's exact parent branch:
   `giasraf/sk-107-deliver-the-skitza-native-app-experience`.
4. Create each worker's clean worktree from the integration base and check out that child issue's
   exact Linear branch.
5. One worker is the only writer in each worktree.
6. Before code on an issue: read its full Linear description, move it to `In Progress`, and confirm
   its branch and owned files.
7. Workers make conventional commits containing their issue ID and run focused checks. They do not
   open PRs or merge.
8. The root reviews each diff and cherry-picks accepted commits into the SK-107 integration branch.
9. After each wave, later worker branches start from the updated integration commit.
10. Only the root pushes the final integration branch and opens one PR to `v3-clean`:
    `SK-107: deliver the native app experience`.
11. Move an accepted child issue to `In Review`; move SK-108–SK-116 and SK-107 to `Done` only
    after the final PR is merged. Record any intentional deviation in both the affected issue and
    this plan.

This produces one combined CI run, one Vercel preview, one screenshot set, and one merge while every
code change remains owned by a Linear issue.

## Issue graph

| Issue                                                                                                                                              | Owner     | Depends on     |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------- |
| [SK-108](https://linear.app/raz-stamper/issue/SK-108/build-the-safe-installable-pwa-and-update-foundation) — PWA and safe updates                  | A         | —              |
| [SK-109](https://linear.app/raz-stamper/issue/SK-109/build-native-interaction-primitives-and-screen-behavior) — native interaction primitives      | B         | —              |
| [SK-110](https://linear.app/raz-stamper/issue/SK-110/make-audio-and-uploads-persist-across-navigation) — audio and uploads                         | C         | SK-108         |
| [SK-111](https://linear.app/raz-stamper/issue/SK-111/add-instant-account-scoped-state-restoration-and-drafts) — instant state, restoration, drafts | B         | SK-108, SK-109 |
| [SK-112](https://linear.app/raz-stamper/issue/SK-112/add-contextual-web-push-and-installation-guidance) — push and install guidance                | A         | SK-108, SK-111 |
| [SK-113](https://linear.app/raz-stamper/issue/SK-113/apply-the-native-experience-across-producer-flows) — producer pass                            | B         | SK-109–SK-112  |
| [SK-114](https://linear.app/raz-stamper/issue/SK-114/apply-the-native-experience-across-artist-flows) — artist pass                                | C         | SK-109–SK-112  |
| [SK-115](https://linear.app/raz-stamper/issue/SK-115/apply-the-native-experience-across-anonymous-public-flows) — public pass                      | A or root | SK-108–SK-111  |
| [SK-116](https://linear.app/raz-stamper/issue/SK-116/integrate-verify-screenshot-and-release-the-native-experience) — integration and release      | Root      | SK-108–SK-115  |

## Execution waves

### Wave 0 — Root preflight

1. Read AGENTS.md, SK-107–SK-116, the product contract, current PRD sections, and current code.
2. Inspect active Linear work for route/file overlap. Do not touch the dirty SK-82 worktree.
3. Record the exact `origin/v3-clean` SHA and run a baseline typecheck plus the relevant existing
   tests. Attribute any baseline failure before implementation.
4. Build a route/state matrix covering producer, artist, and anonymous/public route families.
5. Confirm Vercel preview deployment and auth access before relying on it for QA.
6. Resolve the conflicting Neon production guidance before any database action. Code and an
   additive migration file may be prepared without migrating production.
7. Create the integration and first two worker worktrees.

### Wave 1 — Foundations in parallel

**Worker A — SK-108**

- Manifest, install icons, Apple/standalone metadata, status-bar and theme metadata.
- Replace the obsolete service worker.
- Explicit cache allow/deny policy and useful offline boundary.
- Foreground/reconnect refresh signal.
- Safe waiting-worker update protocol.

**Worker B — SK-109**

- Press feedback, touch targets, safe areas, dynamic viewport and keyboard behavior.
- Bottom-sheet/full-screen primitives.
- Directional screen motion and restoration hooks.
- Local progress/error patterns and native share adapter.
- Theme override, larger text, and reduced-motion behavior.

**Worker C**

- Read SK-110 and audit the two current audio systems and multipart upload paths.
- Write a no-code handoff naming the exact files and integration adapter needed after SK-108.

The root reviews and integrates SK-108 and SK-109. Do not start broad screen edits yet.

### Wave 2 — Continuity in parallel

**Worker B — SK-111**

1. Write the runtime ADR.
2. Prove account-isolated cached-first rendering, silent refresh, offline boundary, exact
   back/scroll restoration, and draft recovery on one producer and one artist route.
3. Add sign-out and account-switch clearing tests.
4. Expand only after the vertical slice passes.

**Worker C — SK-110**

- Unify playback under one app-level engine.
- Persist the mini-player/listening state and add Media Session.
- Add the bounded unlocked-audio cache and protected-audio exclusions.
- Add the app-level upload manager, persistent progress, retry/error, and leave warning.

The root mounts worker adapters into shared shells, reviews security boundaries, and integrates both
issues.

### Wave 3 — Push and install guidance

**Worker A — SK-112**

- Add multi-device subscription ownership and cleanup.
- Deliver only real event categories with validated same-origin deep links.
- Add contextual opt-in and the locked install-guidance timing/suppression behavior.
- Reconcile/remove fake preference controls.
- Prepare and test any additive schema migration only against an approved safe target.

The root integrates SK-112. If real push cannot be exercised without a production migration, record
the exact migration and risk, ask for that exact approval, and continue all non-database work.

### Wave 4 — Whole-app role passes in parallel

Each worker starts from the same updated integration SHA and uses the route/state matrix. Shared
primitives are frozen unless the root approves a cross-cutting correction.

**Worker B — SK-113:** all producer route families.

**Worker C — SK-114:** all signed-in artist route families.

**Worker A or root — SK-115:** anonymous listening, join, share, booking, and public pages.

For every affected screen, check:

- persistent shell/player/nav as appropriate;
- immediate tap feedback and touch-target size;
- safe areas and fixed controls;
- keyboard and input mode;
- sheet versus full-screen choice;
- cached/refresh/offline/empty/error state;
- exact back, scroll, filter, and draft restoration;
- local progress and failure recovery;
- 360px, 390px, desktop, large text, dark mode, and reduced motion;
- no horizontal overflow, blank transition, full-page spinner, or unrelated design change.

### Wave 5 — SK-116 integration and release

1. Review the complete integration diff against every child issue and the product contract.
2. Run focused tests for each changed subsystem.
3. Run `$skitza-verify` on the final integration SHA.
4. Perform the browser, service-worker, security, and visual checks below.
5. Capture final evidence only after the SHA is frozen.
6. Push the SK-107 branch, open the one PR to `v3-clean`, and wait for GitHub CI and Vercel preview.
7. Inspect CI, Vercel build/runtime logs, and the final diff.
8. If all named gates pass and scope has not changed, merge under Gili's instruction in this
   planning session.
9. Wait for the automatic `v3-clean` deployment to reach `READY`.
10. Give Gili the merged SHA, READY preview URL, concise evidence, and iPhone checklist.
11. Reconcile every child issue and the parent in Linear.
12. Do not promote that deployment to production.

## Token-efficient verification

### Worker handoff

Workers run only:

- focused Vitest files for their behavior;
- ESLint on changed files;
- web typecheck before handoff.

They report:

```text
ISSUE: SK-N
COMMIT: <sha>
FOCUSED TESTS: PASS | FAIL — <count or first error>
LINT CHANGED FILES: PASS | FAIL
WEB TYPECHECK: PASS | FAIL
OWNED FILES ONLY: YES | NO
RISK: <one line or none>
```

They do not paste logs, take acceptance screenshots, run the full suite/build repeatedly, open PRs,
or call their slice fully verified.

### One final code gate

The root runs once on the integrated SHA, stopping at the first real failure:

1. `corepack pnpm typecheck`
2. `corepack pnpm lint`
3. focused native-experience tests
4. `corepack pnpm test`
5. `corepack pnpm --filter web build`

Keep full command output in `.playwright-mcp/native-app/<short-sha>/logs/`. Report only pass/fail,
useful counts, and the first diagnostic.

### Browser journeys

Use transient browser/Chrome automation; do not add a browser framework dependency only for this
program. Test the frozen integration SHA at:

- 360 × 800;
- 390 × 844;
- 1440 × 900.

Run three journeys:

1. **Producer continuity:** navigation, pushed item/back, exact scroll, cached reopen, draft
   restore, sheet/long form, upload across navigation, offline live-action block.
2. **Artist continuity:** audio across routes, persistent/restored player, Media Session, recent
   unlocked audio offline, locked audio exclusion, booking/payment live confirmation.
3. **Lifecycle and security:** anonymous public flow has no app tabs/install prompt; signed install
   guidance timing; push exact-item deep link; sign-out/account switch clears private state; update
   waits through an active form/audio/upload and activates safely later.

Fail an online journey on a page error, console error, unexpected same-site 4xx/5xx, failed
same-site request, broken URL/result, or horizontal overflow. Expected offline request failures must
produce the designed offline state.

### Service-worker and privacy drill

Use a production build or HTTPS preview, never `next dev`:

1. Fresh profile: cold install and registration.
2. Warm online navigation and cached-context reopen.
3. Offline reopen of previously viewed producer and artist screens.
4. Useful boundary for an uncached screen.
5. Confirm Cache Storage excludes auth responses, authenticated HTML/RSC/API responses, payment and
   booking traffic, signed URLs, and locked audio.
6. Sign out, sign in as another account/role, and confirm no previous private content appears.
7. Test build A to build B on one origin: no mid-action takeover; safe activation after reopen.

Do not use production data for write-flow verification.

## Screenshot evidence

All final images belong to the frozen integrated SHA and live under:

`.playwright-mcp/native-app/<short-sha>/screenshots/`

Name them:

`<sha>-<role>-<route-or-flow>-<m360|m390|d1440>-<state>.png`

Capture:

- every major route family once at 390px;
- representative dense list, long form, sheet, player, offline/error/empty state, and each role
  shell at 360px and desktop;
- one final-state screenshot for each of the three journeys at each viewport: nine acceptance
  screenshots.

Generate compact contact sheets by role and viewport. The root visually reviews the contact sheets,
opens individual screenshots only where something looks wrong, and reports paths instead of sending
dozens of images through chat. Keep automatic failure screenshots and traces.

Final report:

```text
NATIVE QA: VERIFIED | PARTIAL | FAILED @ <sha>
Code: typecheck PASS; lint PASS; tests <count> PASS; build PASS
Producer continuity: m360/m390/d1440 PASS — <paths>
Artist continuity: m360/m390/d1440 PASS — <paths>
Lifecycle/security: m360/m390/d1440 PASS — <paths>
Visual sweep: <route count> reviewed; overflow 0 — <contact-sheet paths>
CI: PASS
Vercel: READY — <preview URL>
Merged to v3-clean: <sha>
Device-only: awaiting Gili | PASS
First failure: <single useful error and log path>
```

## Gili's final iPhone test

Install the final `v3-clean` preview from Safari and check:

1. Home Screen launch has no address/search bar and the status/safe areas look natural.
2. Reopen returns to the exact screen, scroll, filters, draft, and player context.
3. Navigation, tap response, sheets, swipe-back where offered, and the keyboard feel native.
4. Audio survives navigation; lock-screen controls and artwork work.
5. An upload remains visible and continues while moving around Skitza.
6. A cached screen and recent unlocked song remain useful offline; live actions clearly stop.
7. A real push opens the exact related item.
8. Light/dark mode and larger text do not break the layout.

Her result is either:

- **Pass:** the merged preview is accepted; production promotion remains a separate decision.
- **Problems found:** the root records only reproducible defects in a new corrective Linear issue,
  fixes them in a focused PR, verifies them, and provides a replacement preview.

## Stop conditions

The root continues without product questions for normal implementation choices. It stops and asks
only when:

- a production migration is required;
- Gili must approve promoting an exact deployment;
- a current Linear issue or PR owns conflicting behavior/files and cannot safely coexist;
- the confirmed product contract conflicts with current code/PRD in a way that changes behavior;
- completing the scope would require weakening authentication, authorization, private-cache, audio
  entitlement, payment, booking, or data-loss protections.

Difficulty, a long test run, or a recoverable implementation failure is not a reason to stop.
