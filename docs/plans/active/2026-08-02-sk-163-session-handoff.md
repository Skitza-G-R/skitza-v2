# SK-163 Fresh-Chat Handoff

> Read this first. Last checked: 2026-08-02.
>
> Current outcome: implementation and CI are complete, and the corrected Preview deployment is
> `READY`. The required real-user Preview gate has **not** run. Nothing is merged, migrated in
> production, or promoted to `skitza.app`.

## Start here

- Linear: [SK-163](https://linear.app/raz-stamper/issue/SK-163/redesign-uploads-and-libraries-around-durable-songs-and-versions) (`In Progress`)
- Safety follow-up: [SK-165](https://linear.app/raz-stamper/issue/SK-165/verify-pinned-historical-0027-cutover-compatibility) (`In Progress`)
- Draft PR: [#277](https://github.com/Skitza-G-R/skitza-v2/pull/277), open and targeting `v3-clean`
- Branch: `giasraf/sk-163-redesign-uploads-and-libraries-around-durable-songs-and`
- Exact head: `eb98159dc3269809c04ad754fa51efaa63411bea`
- SK-163 worktree: `/Users/giliasraf/.codex/worktrees/54a1/Skitza 16.4`
- Worktree status: clean; local and upstream match.
- Corrected Preview: <https://skitza-v2-3efmhz77r-gili-asrafs-projects.vercel.app>
- Deployment: `dpl_8PNmVxBdRj9x5kpTEFeg4E9AtwcL`, `READY`, exact head `eb98159d`

Do not call the Preview working yet. Vercel `READY` proves only that it built and deployed.

## Gili's confirmed product model

- A Project contains Songs.
- A Song belongs to exactly one Project and contains Versions.
- A Version is exactly one uploaded audio file.
- A purchase may link to a Project or Song, but must not create the Song or be the producer's
  starting point for adding music.
- A new Song becomes durable only after its first Version upload succeeds.
- A failed or canceled first upload must not leave an empty Song or Version.
- Upload is file-first: choose/drop the audio file before asking for missing destination details.
- Library entry: **Upload audio**.
- Project entry: **Add Song**; Project is already known.
- Song entry: **Upload new Version**; Project and Song are already known.
- Successful Versions are automatically visible to the correct artist under the existing access
  guards. There is no Share click and no Draft step.
- Producer and artist Libraries are Song-first. Project is a filter, not a forced drill-down.
- Keep Library rows and Version history simple and uncrowded.
- Keep the existing Song page player, waveform, Notes layout, and visual style.
- Stems remain links and are not part of this work.
- Do not add unconfirmed stage placement, notification behavior, or unrelated status changes.

### What Gili declined or kept unchanged

- No manual Share flow.
- No private Draft state.
- No Song-page redesign.
- No crowded Library rows or Version history.
- No native stems upload/storage in this issue.

## What the branch implements

- One file-first upload modal serves all three contextual entry points.
- The first Version uses a temporary upload intent. The staged R2 object is verified before Song +
  V1 are committed together.
- Cancellation, failure, and retry paths prevent ghost Songs and duplicate V1 records.
- A later Version attaches to the existing Song and does not create another Song.
- Producer and artist Library read models show durable Songs first and support Project filtering.
- Purchased-but-empty capacity rows no longer appear as Songs.
- Existing producer scoping, artist ownership, protected playback/download, payment, purchase
  capacity, and notification guards remain in place.
- Purchase is no longer user-facing upload intent. The existing internal non-null purchase binding
  was deliberately not weakened.
- `docs/product/PRD.md` on the branch now records the confirmed durable model.

Main implementation areas:

- `apps/web/src/components/dashboard/song/upload-track-modal.tsx`
- `apps/web/src/server/domain/first-version-uploads/`
- `apps/web/src/server/trpc/routers/first-version-upload.ts`
- `apps/web/src/components/music/library-screen.tsx`
- `apps/web/src/server/domain/song-spaces/music-read-model.ts`
- `packages/db/src/schema.ts`
- `packages/db/drizzle/0039_atomic_first_version_uploads.sql`
- `packages/db/apply-migrations.mjs`
- focused tests across web and database packages

The PR changes 40 files: 3,011 additions and 1,211 deletions versus `origin/v3-clean` at the last
inspection.

## Git and automated verification

Commits:

1. `0a500aac` — `feat(music): make first Song uploads atomic`
2. `23af3287` — `fix(music): use confirmed version upload label`
3. `eb98159d` — `fix(migrations): verify pinned historical 0027 baseline`

Latest remote evidence for `eb98159d`:

- GitHub Actions CI run `30736375298`: success.
- CI typecheck: success.
- CI lint: success.
- CI tests: success.
- CI web/admin build: success.
- Vercel `skitza-v2-web`: success.
- Vercel `skitza-admin`: success.
- PR was open, draft, mergeable, and unmerged when last checked.
- After an explicit final fetch, the branch is 3 commits ahead and 6 commits behind
  `origin/v3-clean` at `79319881`. Its merge base is `7e2122f8`. The newer base work includes
  SK-164 join account-conflict recovery, SK-161 auth/role-routing, and SK-139 navigation changes.
  Sync and retest before accepting the final Preview.
- A direct snapshot diff against the newer base shows 116 files because the branch is behind. Do not
  misread missing newer-base auth/navigation files as SK-163 deletions; the true feature delta is the
  40-file three-dot diff recorded above.

Detailed local evidence reported by the implementation worker:

- Migration-runner tests: 24 passed.
- Database suite: 182 passed, 2 safe-database tests skipped.
- Admin suite: 382 passed.
- Web suite: 5,995 passed, 75 skipped.
- Typecheck, lint, formatting, diff checks, web build, and admin build passed.
- One unchanged SK-90 rehearsal test exceeded five seconds only in the full parallel root suite;
  the entire SK-90 file passed alone, 19/19. GitHub CI is green.

Earlier UI-only checks covered desktop, 390px, and 360px without overflow or console errors, but
they did not submit the real upload. They do not satisfy the required hard gate.

## Preview database state

This Preview uses only the disposable isolated Neon project:

- Project: `cold-wave-29509645`
- Parent branch: `main` / `br-billowing-union-asbqb60p`
- Child branch: `sk163-preview` / `br-spring-lab-asfceaz5`
- Database: `sk90_rehearsal_bcdb29466fc7`

Completed work:

- The parent historical-through-0029 catalog verifier passed.
- The disposable child was reset from that isolated parent.
- Historical migration `0027` was structurally verified.
- `0028` and `0029` were already applied with exact ledger checks.
- `0030` through `0039` were applied through the approved migration runner.
- SK-165's runner change accepts only the exact pinned historical `0027` digest when the exact
  `0028/0029` ledgers and completed catalog also match. It fails closed on any drift and does not
  rewrite ledger rows.
- Preview `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are sensitive Vercel variables scoped only to
  the exact SK-163 Git branch.
- No database credential is stored in this document. `/private/tmp/sk163-preview-url` was absent at
  the final local check.

### Why the earlier Preview broke

The first pooled `DATABASE_URL` captured Neon's masked password placeholder instead of the real
password. Authenticated `/auth/resolve` and `/dashboard` requests therefore failed with database
password authentication errors. The branch-only value was corrected and a new deployment was
created.

Do not reuse earlier Preview links, especially:

- `skitza-v2-aufc2xlaf-gili-asrafs-projects.vercel.app`
- `skitza-v2-dynlifigq-gili-asrafs-projects.vercel.app`

The corrected deployment currently has no runtime traffic/log evidence because Chrome could not
navigate to it before the handoff.

## Production database safety

- Canonical production Neon project: `skitza-v3` (`raspy-pine-96654399`).
- Forbidden project: `OLD — DO NOT USE` (`quiet-sun-92221754`).
- `docs/session_recap.md` contains an old statement that reverses those projects. It is stale and
  must not be followed. Current `AGENTS.md` and Gili's 2026-07-29 reconfirmation win.
- Production was not queried, copied, reset, migrated, or changed during this work.
- Migration `0039_atomic_first_version_uploads.sql` has not been applied to production.
- Gili approved applying exactly production migration `0039`, but only after the corrected Preview
  hard gate passes.
- Use `$skitza-migrate` / `packages/db/apply-migrations.mjs` with a positively identified target.
- Never run `drizzle-kit migrate`, `pnpm -F db db:migrate`, manual SQL, or ledger rewrites.
- Never use OLD or production as a source database.

## Exact blocker at handoff

Chrome auto-review denied agent navigation to the corrected URL. This is a browser-control block,
not an application failure.

The next chat must ask Gili to do only this if it has not already been done:

1. Open <https://skitza-v2-3efmhz77r-gili-asrafs-projects.vercel.app> in Chrome.
2. Click the ChatGPT/Codex Chrome extension.
3. Choose **Attach/Share current tab**.
4. Leave that tab open.

Do not work around a Chrome denial with another browser surface.

## Required hard Preview gate

Before starting this gate, sync the branch safely with the latest `origin/v3-clean`, resolve only real
conflicts, rerun the automated checks, and wait for the new exact branch deployment. The current
`3efmhz77r` deployment becomes historical after that sync and must not be accepted as the final
Preview.

Use the resulting exact deployment and start fresh. The approved disposable audio fixture is:

- `/private/tmp/sk163-preview-upload.wav`
- mode `0600`
- 1-second, 44.1 kHz, mono, 16-bit PCM, 44,100 frames, non-personal test tone

Verify as a real signed-in user:

1. Authentication resolves without an error page.
2. Onboarding resolution and producer dashboard work.
3. Producer Library is Song-first and its Project filter works.
4. Artist Library is Song-first and its Project filter works.
5. From Library, **Upload audio** starts file-first.
6. Complete one real new Song upload; confirm exactly one Song with V1 only after success.
7. Open the real Song page; confirm its design is unchanged.
8. Use **Upload new Version**; confirm V2 attaches to the same Song.
9. Confirm the correct artist automatically sees the Song and Versions without Share or Draft.
10. If a Project route is available, confirm its label is **Add Song** and Project is not asked again.
11. Test producer and artist at desktop, true 390px, and true 360px.
12. At each width confirm:
    - no `Something buzzed` or other error page;
    - no same-site 4xx/5xx or failed request;
    - no `console.error` or page error;
    - `document.scrollWidth <= document.documentElement.clientWidth`.
13. Save useful producer and artist final-state screenshots.
14. Check exact-deployment Vercel runtime logs for 5xx/errors and confirm the old password-auth error
    does not recur on `/auth/resolve` or `/dashboard`.
15. Immediately reopen the exact URL fresh and smoke the producer and artist Libraries again.

Only report `SK163_HARD_PREVIEW_GATE_PASS` if every item passes. If anything fails, return the first
concrete blocker and do not merge or promote.

Do not trigger payments or outbound notifications during verification.

## After the hard gate passes

1. Update the stale PR #277 description. Its current warning still describes the old failed
   Preview, missing branch variables, and unapplied Preview migration.
2. Recheck PR head, base compatibility, CI, Vercel checks, and review threads. `v3-clean` may have
   advanced.
3. Ask for the final exact merge approval required by repository policy, then merge PR #277 into
   `v3-clean` only if all gates remain clean.
4. Positively identify canonical production `skitza-v3` and apply only migration `0039` through
   `$skitza-migrate`.
5. Wait for the exact merged `v3-clean` deployment to become `READY` and match the merge commit.
6. Promote only that verified merged deployment to `skitza.app`; never promote a stale Preview.
7. Smoke-test producer and artist authentication/Libraries on production without payments or
   outbound notifications, then check runtime logs.
8. Mark SK-163 and SK-165 complete only after the shipped result is verified.
9. Delete `/private/tmp/sk163-preview-upload.wav` after all upload checks are finished.

## Must not happen

- Do not say the Preview works merely because Vercel says `READY`.
- Do not merge, migrate production, or promote before the full corrected Preview gate passes.
- Do not use `main`; the PR target is `v3-clean`.
- Do not touch the unrelated dirty changes in `/Users/giliasraf/Skitza 16.4`.
- Do not use the OLD Neon project.
- Do not apply any production migration except the approved `0039`.
- Do not weaken commercial access guards or migration verification.
- Do not add Share, Draft, stems storage, Song-page redesign, or unrelated UI work.

## Workspace warning

The shared workspace root `/Users/giliasraf/Skitza 16.4` is currently on an unrelated SK-82 branch
and contains many user-owned changes. Do not stage, discard, or mix those changes with SK-163.
Continue SK-163 from its clean dedicated worktree listed at the top of this document.
