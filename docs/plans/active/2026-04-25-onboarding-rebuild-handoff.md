# Producer Onboarding Wizard Rebuild — QA Handoff

> Status: READY FOR YOUR QA
> Branch: feat/onboarding-rebuild-recovery (pushed to origin)
> Final commit: 37e2226 (Story 9 — nextStepFor helper)
> PR URL: https://github.com/giasraf/skitza-v2/pull/new/feat/onboarding-rebuild-recovery

## TL;DR

The 4-step wizard is functionally complete with one deferral. Steps 1, 2, 3 work end-to-end. Step 4 is trimmed to links only — the track-upload widget was deferred because of a schema FK blocker (track_versions.trackId hardwired to projectTracks, not portfolioTracks). Producers can still upload portfolio tracks via Setup → Portfolio.

## What's done

| # | Story | Commit | Tests |
|---|---|---|---|
| 1 | Pure helpers — slugFromDisplayName + currencyFromCountry | 63c2274 | 22 |
| 2 | Shell + progress bar + action bar | 28c287c | 17 |
| 3 | Step 1: studio name + completeStudio server action | d2154b8 | 12 |
| 4 | Step 2: NewPackageForm reuse + step-aware decideOnboardingRedirect | 8af6163 | 27 |
| 5 | Step 3: AvailabilitySection reuse | 15af3d5 | 9 |
| 6 | External links editor + bulk-save + migration 0034 | 7f9cdbf | 35 |
| 7 | DEFERRED — portfolio uploader card (schema FK blocker) | — | — |
| 8 | Step 4 (trimmed): links + "upload from Setup" hint | 7006b58 | 9 |
| 9 | nextStepFor centralized helper | 37e2226 | 5 |
| 10 | This handoff doc + push | (this commit) | — |

Total: 9 of 10 stories shipped. ~136 new tests on top of pre-rebuild baseline.

## QA checklist (5 minutes for the happy path)

1. Sign up as a fresh producer (clear DB row OR new Clerk dev user).
2. Step 1 (/onboarding/studio): type "Test Studio" → submit. Verify producers row has display_name set, slug auto-generated (NOT shown), currency + timezone populated.
3. Step 2 (/onboarding/service): name "Mix" + price 200 → submit. Verify products row exists.
4. Step 3 (/onboarding/availability): set Mon 10–18 + change duration to 90 → Continue. Verify availability_blocks rows + producers.default_session_min = 90.
5. Step 4 (/onboarding/portfolio): type one Spotify URL → Continue → /dashboard. Verify producer_external_links has 1 row.

### Skip-flow (2 min)

6. Fresh producer: complete Step 1 only → close tab → revisit /onboarding. Should redirect to /dashboard.
7. Walk to /onboarding/availability → click "Skip for now" → /onboarding/portfolio → Skip again → /dashboard.

### Mobile + reduced-motion

8. 360px Chrome DevTools: walk all 4 steps. Confirm no horizontal scroll, all CTAs ≥ 44px, sticky bottom bar respects iOS safe area.
9. Enable prefers-reduced-motion: walk Steps 1-4. No janky transitions.

## Story 7 deferral details

Schema fact: track_versions.trackId is FK to projectTracks (cascade delete). The audio.completeMultipart pipeline walks trackVersion → projectTrack → project → producerId for ownership. It physically cannot accept a portfolio track.

Three options for resolving later:
- β: schema migration adding portfolioTrackId column or polymorphic owner_kind. ~3-4h, touches payment-critical pipeline.
- γ: parallel portfolio-audio router + actions. ~3h, no schema change, ~50% code duplication.
- (current) Setup → Portfolio handles portfolio uploads. Wizard ships with links only.

## Branch reconciliation

The branch is feat/onboarding-rebuild-recovery (note -recovery suffix). The original feat/onboarding-rebuild got tangled with feat/today-redesign mid-session. The recovery branch has all 9 commits but interleaved with 2 today-redesign docs commits (12db104 + 0b7fb99) — not breaking but they pollute history.

To clean before merging to main:
- A (recommended): squash-merge from feat/onboarding-rebuild-recovery to main. The squash absorbs everything cleanly.
- B: interactive rebase to drop the 2 contaminating commits before PR. ~10 min.
- C: cherry-pick my 9 commits onto a fresh branch from origin/feat/onboarding-rebuild. ~15 min.

## Migration to apply at deploy

After merge:

```bash
cd "/Users/giliasraf/Skitza 16.4"
set -a && . apps/web/.env.local && set +a
node packages/db/apply-migrations.mjs
```

Migration 0034_external_links_unique_per_platform.sql is idempotent.

## Open product questions

1. Calendar OAuth (PRD §18.1) — still deferred. Step 3's badge stays "coming soon — notify me".
2. Telemetry — each step has // TODO(telemetry) markers. ~30 min follow-up to add a recordOnboardingEvent helper.
3. Track upload in onboarding — pick β / γ when ready, or leave Setup → Portfolio as the upload surface.
4. Branch reconciliation — pick A / B / C above when opening the PR.

## How to start QA

```bash
cd "/Users/giliasraf/Skitza 16.4"
git checkout feat/onboarding-rebuild-recovery
pnpm install
pnpm -F web dev
# Sign up at http://localhost:3000/sign-up — walk Steps 1-4
```

End of handoff. — Claude, 2026-04-25
