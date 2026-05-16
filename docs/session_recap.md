# Session Recap

## Active branches and PRs

| Branch | PR | Subject | Status |
|---|---|---|---|
| `per-song-pricing-design` | [#134](https://github.com/Skitza-G-R/skitza-v2/pull/134) | feat: per-song pricing for storefront products | Pipeline green (2417 tests), **migrations 0015 + 0016 pending apply** — see [handoff](plans/active/2026-05-16-per-song-pricing-handoff.md) |
| `settings-redesign` | [#116](https://github.com/Skitza-G-R/skitza-v2/pull/116) | feat(settings): 5-section sub-nav with savebar | Pipeline green, schema migration 0012 pending apply |
| `clients-projects-redesign` | [#113](https://github.com/Skitza-G-R/skitza-v2/pull/113) | Phase 0 (schema) | Pipeline green, waiting on Raz review |
| `overview-first-week-empty` | — | Overview first-week empty state (predicate landed) | 1 commit ahead of `v3-clean`, pushed to origin |

---

## Per-song pricing (2026-05-16, branch `per-song-pricing-design`, PR #134)

Adds **per-song pricing** to storefront products. Producer toggles "Per song" in the wizard's Pricing step → rate-card ladder (base + optional discount tiers) → "Artists will see" preview renders the exact store-card copy live. Artist sees "From $X/song · Discounts for bigger projects" on the store list, taps a `– / +` stepper to pick song count, checks out. Producer dashboard shows "Mixing × N songs" on the resulting project.

**Math foundation:** new `apps/web/src/lib/pricing.ts` — pure helpers (`unitPriceFor`, `totalFor`, `fromPrice`, `validateTiers`) used by the wizard preview, artist card, artist stepper, AND server-side checkout re-validation. Single source for all tier math — no drift possible across the five paths.

**Schema added (migrations 0015 + 0016):**
- `bookings.song_qty` integer NULL + `bookings.unit_price_cents` integer NULL
- `projects.song_qty` integer NULL + `projects.unit_price_cents` integer NULL

Per-song checkouts denormalise qty + locked-in rate onto the project row so the producer dashboard renders "× N songs" without re-running tier math against possibly-edited `volumeTiers`.

**Security:** the checkout mutation re-validates `unitPriceCents` server-side against `product.volumeTiers` using the same `unitPriceFor()` helper. A tampered client payload can't lock in an unauthorised rate — `BAD_REQUEST: "Pricing changed — refresh the page and try again."`

**Files:** see the full list in the [handoff doc](plans/active/2026-05-16-per-song-pricing-handoff.md). Touches the producer wizard, the producer dashboard project hero, both artist-side store pages, the shared `checkout-initiator.ts` helper, and the `artist.store` tRPC router. 13 commits.

**Worktree:** all work happened in `/Users/giliasraf/skitza-per-song-pricing` (a `git worktree` of the same repo pinned to `per-song-pricing-design`) because a parallel Claude session kept `git checkout`ing the main repo mid-task. Clean up with `git worktree remove /Users/giliasraf/skitza-per-song-pricing` after the PR merges.

**Sensitive env var gotcha:** Vercel's `DATABASE_URL_NEON` is marked "Sensitive" — `vercel env pull` returns the name but not the value. Migrations need the URL passed inline (`DATABASE_URL="..." node apply-migrations.mjs`). Documented in `apply-migrations.mjs` which now accepts any of `DATABASE_URL` / `DATABASE_URL_NEON` / `POSTGRES_URL_NON_POOLING` / `POSTGRES_URL`.

**After merge:** Gili applies migrations 0015 + 0016 to production with the same inline-paste workflow.

---

## Settings redesign (2026-05-14, branch `settings-redesign`, PR #116)

Replaced the 2-branch chip surface with the design's 5-section sub-nav layout from `/Volumes/KINGSTON/Downloads/scratch/settings-handoff/`. Five live sections (Profile · Plan & billing · Notifications · Integrations · Language & region). Studio is intentionally deferred — schema columns (business name, city, country, tax ID) don't exist yet.

**Schema added (migration 0012):**
- `producers.plan` text NOT NULL DEFAULT 'free'
- `producers.week_start` text NOT NULL DEFAULT 'sun'
- `producers.notification_prefs` jsonb NOT NULL DEFAULT '{}'

**Removed from Settings UI** (data stays in DB, future `/dashboard/public-page` route picks them up): slug, brand colors, logo, portfolio image picks, marketing copy (genres/response/streams), Autopilot toggles, data-export button, replay-tour button.

**Plan & Notifications are UI-only:** Plan reads `producers.plan` and renders fake free/pro hero + usage. CTAs toast "Coming soon." Notifications saves the 6-event × 2-channel matrix but the actual email/in-app delivery wiring lands feature-by-feature.

**Payments unified:** one "Payments" row covers both Tranzila (Israel) and Stripe (rest of world). The existing PaymentCard + StripeCard render below the integrations card for actual connect flows.

**Files:** `apps/web/src/app/(producer)/dashboard/settings/{page,settings-client,settings-keys,settings.css}.{tsx,ts,css}` + migration `packages/db/drizzle/0012_settings_redesign.sql`. Old `settings-form.tsx` deleted. `settings-cleanup.test.ts` rewritten.

**After merge:** Gili runs `DATABASE_URL=… node packages/db/apply-migrations.mjs` to apply 0012.

---

# Earlier: Clients & Projects v3 Redesign

> **For the next Claude session:** READ THIS FIRST. Phases 1-4 are DONE on PR #117. Awaiting Gili's manual Incognito QA + merge. Phase 5 (optional player visual polish) is deferred.

**Last updated:** 2026-05-15 (evening)
**Branch:** `clients-projects-phase-1` (pushed to origin; worktree at `/Users/giliasraf/skitza-phase-1`)
**PR:** [#117](https://github.com/Skitza-G-R/skitza-v2/pull/117) — Full Phase 1-4 redesign as one deliverable
**Status:** All gates green (typecheck clean, lint zero warnings, **2209 tests passing**). Awaiting manual QA + 2 prod migrations + merge.

---

## TL;DR

5-phase faithful port of the Clients Projects Room prototype into the producer app. New IA: List → Client Space → Album Page → Song Space (with Single-Space rule for 1-song projects). PR #117 ships Phase 1-4 as one deliverable per Gili's "100% the design" request on 2026-05-15.

## Phase status

| Phase | Status | Where | Commits |
|---|---|---|---|
| 0 — Schema migrations | ✅ Merged | [#113](https://github.com/Skitza-G-R/skitza-v2/pull/113) (in `v3-clean`) | 10 |
| 1 — List view + Client Space + invite + drag | ✅ In PR #117 | + G6 New Client modal | ~30 |
| 2 — Album Page (replaces Project Room) | ✅ In PR #117 | New 4-tab IA | 18 |
| 3 — Song Space + Single-Space rule | ✅ In PR #117 | New route + WorkflowStepper + VersionRow | 19 |
| 4 — Upload Track modal + manual stage edit | ✅ In PR #117 | Full multipart orchestration | 16 |
| 5 (optional) — PersistentPlayer visual polish | ⏳ Deferred | Fast-follow PR if/when wanted | — |

## Design and plan documents (source of truth)

| File | Purpose |
|---|---|
| `docs/plans/active/2026-05-14-clients-projects-redesign-design.md` | Master design brief. Approved by Gili 2026-05-14. |
| `docs/plans/active/2026-05-14-clients-projects-redesign-phase-1.md` | Original Phase 1 plan (Tasks 1-20). Executed 2026-05-14. |
| `docs/plans/active/2026-05-15-clients-projects-phase-1-punch-list.md` | G1-G6 punch list. Executed 2026-05-15. |
| `docs/plans/active/2026-05-15-clients-projects-phase-2-album-page.md` | Phase 2 plan. Executed 2026-05-15. |
| `docs/plans/active/2026-05-15-clients-projects-phase-3-song-space.md` | Phase 3 plan. Executed 2026-05-15. |
| `docs/plans/active/2026-05-15-clients-projects-phase-4-upload-modal.md` | Phase 4 plan. Executed 2026-05-15. |
| `/Volumes/KINGSTON/Downloads/Clients Projects Room.html` | HTML prototype (source of truth for visuals). |
| `/Volumes/KINGSTON/Downloads/DESIGN.md` | Design tokens + component spec. |
| `/Volumes/KINGSTON/Downloads/BUILD-NOTES.md` | Engineering handoff. |

## What's on PR #117 — the full picture

### Phase 1 — List view + Client Space + invite + drag

- Helpers: `deriveGradient`, `heroBg`
- Atoms: `LinkPill`, `StatTile`, `HeroCTA`
- Rows: `ProjectRow`, `ClientCard`
- Composed: `ClientSpaceHero`, `WorkspaceListView` (with KPI strip, tab segmented control, filter chips, sort dropdown, layout switcher)
- `InviteToAppModal` (email via Resend + copy-link via clipboard)
- `NewClientModal` (G6 — added 2026-05-15)
- tRPC mutations: `clientContacts.sendInvite/reorder/create`, `projects.reorder`
- G1-G5 punch list applied
- Demo seed deleted; 13 obsolete files deleted

### Phase 2 — Album Page

- `workflow-stage.ts` helper — 5 stages (brief / production / mixing / mastering / done)
- `TrackRow` component — new 8-col grid tracklist row
- `AlbumHero` + `AlbumStatStrip` + `AlbumTabs` + `AlbumSpace` shell
- 4 tab panels: Songs / Files / Payments / Studio Log
- `[id]/page.tsx` rewritten to render AlbumSpace
- 15 legacy files deleted (old Project Room sub-tabs)

### Phase 3 — Song Space + Single-Space rule

- New route `[id]/songs/[songId]/page.tsx`
- `VersionRow` wired to PersistentPlayer (`playerPlay` + `useNowPlaying`)
- `AddVersionDropZone` (first row of Versions tab)
- `WorkflowStepper` (5-stage horizontal with green fill + amber pulse, motion-reduce gated)
- `SongSpaceHero` (mode-aware: SONG vs SINGLE eyebrow) + `SongSpaceStatStrip` + `SongTabs`
- 4 tab panels: Overview / Versions / Sessions / Payments (single-mode only)
- `SongSpace` shell
- Single-Space redirect in `[id]/page.tsx` (1-track projects → song space)
- `loading.tsx` for the songs route
- Shared `formatDuration` helper at `~/lib/format/duration.ts`

### Phase 4 — Upload Track modal + manual stage edit

- DB migration **0013** — `track_versions.description` column
- `project.setTrackStage` + `project.deleteVersion` mutations
- `upload-actions.ts` — 8 Server Action wrappers around audio multipart API
- `UploadTrackModal` — Radix Dialog with **full client-side multipart upload orchestration** (5MB chunks, presigned PUT to R2, progress bar, abort on close, optional duration probe, orphan cleanup on failure)
- `ChangeStageMenu` — hand-rolled accessible dropdown for manual stage edit, mounted IN the Status stat tile
- All 3 upload entry points wired (Album Songs "+ Add song", Song Space "Upload new version", AddVersionDropZone)
- **Critical fix**: artist email moved from `addVersion` to `completeMultipart` (no more premature "uploaded" emails)
- Version description threaded modal → action → mutation → DB
- Whitespace-tolerant tests, friendly Zod error messages, MIME-empty file fallback

## ⚠️ Before merging PR #117 — apply migrations to prod DB

Two migrations are pending application to prod (Vercel doesn't auto-apply):
- `0012_client_contacts_phone.sql` (Phase 1 G6 — adds `client_contacts.phone`)
- `0013_track_versions_description.sql` (Phase 4 C2 — adds `track_versions.description`)

```bash
cd packages/db
DATABASE_URL=<unpooled-url-from-Neon> node apply-migrations.mjs
```

Both are idempotent (`ADD COLUMN IF NOT EXISTS`). Safe to re-run.

## Decisions baked into the redesign (do not re-litigate)

Carried over from 2026-05-14:
1. Full faithful port (replace current Project Room IA; add Song Space; add Single-Space rule)
2. Gili authorized Claude to write the schema migrations directly for this redesign
3. Drop Notes tab entirely
4. Add new `workflow_stage` column rather than replace the legacy `stage` enum
5. 5-stage workflow (Brief → Production → Mixing → Mastering → Done — Gili dropped Review + Delivery)
6. Reuse existing `PersistentPlayer` for audio

From 2026-05-15 punch list:
7. Clients tab is first + default
8. Layout switcher hidden on Projects tab
9. No URL hydration for `?tab=` / `?sort=` / `?filter=`

From 2026-05-15 Phase 4:
10. Upload modal handles full multipart orchestration client-side (5MB chunks)
11. ChangeStageMenu lives IN the Status stat tile (no duplicate row)

## What still needs to happen for PR #117 to merge

1. **Apply migrations 0012 + 0013** to prod DB.
2. **Manual Incognito QA** against the design (no comprehensive checklist exists for the full PR yet — recommend walking through:
   - List view → Client Space → click into a multi-track project → Album Page → click a track → Song Space (album mode)
   - Visit a 1-track project directly → should redirect to Song Space (single mode)
   - Upload a new version via the drop zone OR the hero CTA — full multipart upload
   - Use ChangeStageMenu to manually advance a stage
   - Create a new client via the modal
   - Drag-reorder projects + clients in the list view
   - Verify the LinkPill states (Active / Invited / Invite to app)
3. **On QA pass:** merge PR #117 into v3-clean. Vercel deploys.
4. **Start Phase 5** (optional player visual polish) on a fresh branch IF wanted.

## Open follow-ups (NOT in this PR — picked up later)

- **Phase 5: PersistentPlayer visual polish** — restyle the dock to match `#player` spec (waveform, EQ bars, larger duration mono). Pure CSS/DOM.
- Real Projects table mode with sortable column headers
- URL hydration (`?tab=`, `?sort=`, `?filter=`)
- Drag accessibility (keyboard arrow navigation)
- Re-upload a failed/partial upload (currently abort + manual retry)
- Drag-to-reorder versions within the Versions tab
- "Edit version" affordance (rename, change description after upload)
- Real-time progress sync across tabs

## How to resume in a new session

1. Read this recap first.
2. Confirm branch: `git rev-parse --abbrev-ref HEAD` should be `clients-projects-phase-1` until PR #117 merges.
3. Confirm pipeline: `pnpm typecheck && pnpm -F web lint && pnpm test` — all green.
4. Ask Gili what's next (Phase 5? Move to Phase 6+ work after merge?).

## Token reality check (carry forward)

The Skitza app uses ONLY these CSS custom properties:

```
--brand-primary       (212 150 10 — amber)
--bg-background       (242 237 230 — warm off-white page bg)
--bg-elevated         (255 255 255 — white)
--bg-sidebar          (17 16 9 — near-black)
--fg-default          (17 16 9 — body text)
--fg-muted            (107 99 89 — secondary text)
--fg-faint            (165 158 145 — placeholder)
--fg-success / --fg-danger / --fg-warning
--border-subtle / --border-strong
```

**Forbidden:** `--surface-card`, `--surface-hover`, `--text-muted`, `--text-strong`, `--brand-primary-on`. `--bg-base` and `--fg-primary` are backward-compat aliases that resolve to `--bg-background` and `--fg-default`.

## Testing convention (carry forward)

Vitest in `node` env, no jsdom, no `@testing-library/react`.

1. **Pure-function unit tests** — standard `expect(...)` on helpers.
2. **Source-grep tests on JSX shells** — `readFileSync` the `.tsx`, assert imports/classNames/structure. **Use `\s*` in regexes** to stay whitespace-tolerant.
3. **Server Actions are the ONLY way client components call tRPC** — enforced by `invite-modal.test.tsx` asserting `expect(SRC).not.toMatch(/useMutation/)`. Mirror this pattern for any new client modals.
