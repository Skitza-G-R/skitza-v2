# SK-231 enhanced desktop implementation record and handoff

**Last updated:** August 15, 2026

**Product source:** [`docs/product/producer-desktop-app.md`](../../product/producer-desktop-app.md)

**PRD:** [`docs/product/PRD.md` §4.7](../../product/PRD.md)

**Linear:** SK-231

**Pull request:** #351, draft

**Last pre-refresh implementation head:** `ce4a67856255ada9f3cd504bc87fc42f2562879f`

**Current combined base:** `d239e439f0c6870dabf47975e5ce426dd21049d5`

**Current combined/deployed source:** `3a6bf33c7e4ce7455f308aae684c91d5d64ce518`

**Current local desktop source:** `339df7eca0444ddf1e95f4080f6acd975bb66ab6`

**Target branch:** `v3-clean`

## Plain-English status

The local Apple Silicon app is built, installed, and now usable for normal
signed-in Skitza work. The full desktop plan is **not finished** and Gate 1 has
**not passed**.

A large, tested foundation exists:

- an Apple Silicon Tauri app opens the real Skitza interface;
- the Mac menu-bar icon, Open, close-to-hide, Quit, single-instance behavior,
  secure origin boundary, and private social-auth callback are implemented;
- the web app has the desktop bridge, safe-screen and recent-audio behavior,
  session validation, proof instrumentation, and desktop auth endpoints;
- the one-use desktop auth-code database migration is already present in the
  canonical production database; and
- automated tests, optimized builds, CI, security reviews, and staged
  deployment checks passed at the latest desktop implementation head.

The required real-world proof is still missing:

- no valid Mac Gate 1 timing set was collected;
- email/password and social sign-in were not completed end to end in the final
  Mac build;
- hidden upload continuation was not proved live;
- tray upload progress and the Quit-during-upload warning are not built;
- Intel Mac, Windows 11 x64, installers, signing, notarization, and updater
  tests are not complete; and
- the desktop branch is not merged.

The latest website and desktop connection code are now combined and live on
`skitza.app`. This makes the local Mac app usable without publishing it as a
download. The remaining live user actions and speed evidence are listed below.

## August 15 local-use execution result

The immediate local-use plan was executed through the safe user-interaction
boundary:

- all 20 desktop commits were rebased patch-identically onto current
  `v3-clean` `d239e439f0c6870dabf47975e5ce426dd21049d5d`;
- the only shared product file keeps both the latest website behavior and the
  desktop meaningful-content marker;
- focused tests, full tests, typecheck, lint, optimized builds, desktop Rust
  and Node tests, and GitHub CI passed on exact source `3a6bf33c`;
- the rebuilt Mac app is Apple Silicon arm64, targets exactly
  `https://skitza.app`, and passes strict local ad-hoc signature verification;
- private candidate `dpl_E5KbE8JfqEE6tTkN5qdPzcsL8R2k` passed health,
  database, production-Clerk, desktop-API, exact-build, Gate-proof, error-log,
  and 5xx-log checks;
- Gili explicitly approved that exact deployment and it is now live on
  `skitza.app`;
- Gili clarified that the website is intentionally open. An initial smoke
  incorrectly treated the open homepage as a gate failure, so the deployment
  was briefly rolled back. After the clarification, the approved deployment
  was restored. No access token was created, rotated, or saved;
- the final open-site smoke passed: homepage 200, signed-out protected routes
  redirect normally, `/launch` 200, database health 200, desktop session 401
  when signed out, production Clerk only, exact build ID present, all three
  Gate journeys present, and no observed runtime error or 5xx cluster; and
- the latest verified desktop app was copied to `/Applications/Skitza.app`,
  locally ad-hoc signed, and its strict signature check passes.

The installed app was cleanly relaunched from `/Applications/Skitza.app`. It
showed the mobile-style animated Skitza loader and then opened the real signed-in
dashboard without showing the old saved-studio placeholder. The process path,
Apple Silicon architecture, local signature, live dashboard URL, and
close-to-hide behavior were checked directly.

The menu-bar icon now keeps the full orange square around the black Skitza S.
Cold startup is owned by the native app rather than a fragile startup-page IPC
reply. The navigation boundary remains closed except for the exact live Skitza
origin and Clerk's exact production session-handshake path at
`https://clerk.skitza.app/v1/client/handshake`, which is required to return the
signed-in WebView to Skitza.

## Immediate plan to make the local Mac app usable

The Mac app is a secure window that loads `skitza.app`. It is not a separate
copy of the website. Therefore the live website must contain the small desktop
connection layer for login, session checks, saved screens, and social sign-in.

In simple terms:

- **Combine** means keeping the newest website work and the desktop connection
  work in the same code.
- **Candidate** means a private online test copy. It does not change
  `skitza.app`.
- **Switch `skitza.app`** means making the approved candidate the live website.
  It does not publish the Mac installer or make the desktop app public.
- **Smoke test** means opening the local Mac app and quickly proving sign-in,
  close/reopen, session restoration, music, and one upload.

Execution checklist:

- [x] Refresh the desktop branch onto exact current `v3-clean`.
- [x] Preserve both the newest website changes and the desktop speed marker in
      the only shared file.
- [x] Run focused tests, full `skitza-verify`, and optimized builds on the new
      combined source.
- [x] Create a fresh production-config candidate without switching the live
      domain.
- [x] Smoke-test the candidate's website, Clerk, desktop APIs, build ID, newer
      website behavior, and logs.
- [x] Ask Gili to approve that exact deployment ID.
- [x] After approval, switch only `skitza.app` to the approved candidate and
      watch health/errors.
- [x] Open the installed Mac app and prove animated startup, real-dashboard
      arrival, production Clerk handshake, and close-to-hide.
- [ ] Complete the remaining sign-out, fresh sign-in, social sign-in, hidden
      upload, menu-bar reopen, and Quit lifecycle checks.

The Mac binary was rebuilt from the current desktop source, strictly verified,
and copied to `/Applications/Skitza.app`.

## Locked decisions kept throughout the work

- Enhanced speed-first app, not a basic wrapper and not full offline.
- Same producer interface and appearance as Skitza Web.
- Tauri 2 native shell.
- Mac menu-bar and Windows tray access.
- Close hides; Quit stops.
- Uploads may continue only while the process and WebView remain alive.
- Windows 11 x64 only; no Windows 10 or Windows ARM.
- Signed direct downloads from `skitza.app`; no app stores.
- No excluded desktop features were added.
- Navigation remains limited to packaged local assets, the exact Skitza origin,
  and Clerk's one exact production session-handshake path. No broad Clerk,
  wildcard, or Vercel host was allowed.
- No public installer was published and PR #351 was not merged.

## Work completed

### 1. Integration setup and delegated work

The work started from a clean `v3-clean` integration branch while unrelated
workspace changes were preserved in their original worktree.

Independent work was split into:

- SK-232: shared web, cache, proof, and desktop authentication runtime;
- SK-233: Windows 11 x64 environment and Gate 1 audit; and
- SK-234: Apple Silicon Mac Tauri proof shell.

The Windows audit found no accessible interactive Windows 11 x64 machine, VM,
remote host, or self-hosted runner. Gili then explicitly postponed Windows
work. This was recorded as **not run**, not as a pass or failure.

### 2. Exact Gate 1 evaluator and evidence format

The branch includes an evaluator and regression tests for the approved proof:

- one warm-up followed by timed runs 1–5;
- exact journeys `reopen-today`, `safe-clients-projects`, and
  `cached-recent-audio`;
- exact absolute speed limits;
- desktop-versus-Chrome median comparison;
- failure preservation instead of selective reruns;
- meaningful-paint, blank/spinner, source, build, account, and media-download
  evidence; and
- separate platform records for Apple Silicon Mac and Windows 11 x64.

The instrumentation exists, but no complete valid raw measurement set was
collected.

### 3. Mac Tauri shell

`apps/desktop` was created as a Tauri 2 workspace package. It includes:

- a bundled local connecting/error screen;
- exact trusted HTTPS origin compilation and navigation checks;
- external links opened in the system browser;
- a narrow versioned bridge instead of generic native access;
- command-by-command Tauri capabilities and Rust input validation;
- a restrictive local CSP and exact remote ACL;
- one main window with a minimum size;
- Mac menu-bar icon and menu;
- Open Skitza;
- close-to-hide;
- Quit Skitza;
- left-click reveal;
- single-instance handling;
- `skitza://auth/callback` registration and duplicate callback suppression;
- periodic hidden-session validation requests;
- native reveal timing that begins before show/focus;
- in-memory Gate 1 sample export; and
- proof-only Inspector access when no sensitive bootstrap value is present.

The shell does **not** yet include tray upload progress, the upload-aware Quit
dialog, updater integration, or production distribution signing.

### 4. Desktop security and private launch work

The proof path was hardened through several rounds of review:

- private Vercel bypass values are runtime-only, exact-format, exact-origin,
  sensitive, and rejected for production-equivalent `skitza.app` hosts;
- the proof launch uses a clean URL and a verified scoped cookie;
- stale or duplicate cookies fail closed;
- sensitive bootstrap runs disable Web Inspector;
- a bounded production access-cookie bootstrap supports local Finder relaunch
  without embedding a token in the app;
- native owners are zeroized where possible;
- no credential, callback code, PKCE verifier, Clerk ticket, database secret,
  or bypass value is put in the repository, app URL, analytics, or logs; and
- local Tauri IPC permits only `ipc:` and `http://ipc.localhost`, with no
  external network source added to the local CSP.

An isolated proof deployment, disposable test database, private R2 bucket,
fake producer/client/project data, and a short synthetic audio file were
prepared. They proved the web fixtures and private audio route, but Vercel and
development-Clerk handshakes blocked the first live timing attempts. The
temporary Vercel bypasses were revoked after use.

### 5. Shared web bridge and fast runtime

The web application now has a frozen protocol-v1 bridge with explicit
capabilities for:

- social authentication;
- performance proof;
- saved-screen preview; and
- session validation.

Normal Skitza Web keeps working when the bridge is absent.

The shared runtime implements and tests:

- account-scoped saved-screen previews;
- same-account live validation before private desktop cache reveal;
- a two-minute warm-session validation boundary;
- immediate concealment and clearing after sign-out, account mismatch,
  revocation, deletion, ban, or protected 401/403;
- fail-closed offline, stale, unknown, and cold-start behavior;
- race protection so stale validation cannot override revocation;
- desktop-only safe-preview paint before quiet server navigation;
- normal Web/PWA online behavior without showing a stale saved screen;
- account-scoped recent eligible audio reuse;
- clearing cached audio, Media Session data, and commands on denial/sign-out;
- meaningful screen and audible-playback proof recording; and
- the final signed-out desktop fix, which sends a supported online desktop to
  `/sign-in` without revealing another account's cache.

### 6. Secure desktop authentication

The branch implements:

- email/password on the trusted Skitza sign-in surface;
- system-browser social sign-in;
- 43-character random state and PKCE S256 challenge;
- exact `skitza://auth/callback` parsing;
- a 60-second, one-use authorization code;
- atomic database consumption before ticket minting;
- a one-use Clerk ticket delivered only through the in-memory bridge;
- private/no-store desktop auth API responses;
- live `/api/desktop/session` validation; and
- sign-out/account-denial cleanup.

After SK-229 introduced canonical Clerk identity bindings, the desktop routes
were reconciled so that:

- database authorization uses the stable canonical account identity;
- the WebView receives its current provider account ID for cache matching;
- social ticket minting resolves canonical identity back to the active Clerk
  provider identity;
- closed, revoked, staged, ambiguous, or misconfigured identities fail closed;
  and
- no Producer ownership or historical identity row was rewritten.

### 7. Database work

The desktop authorization-code DDL was originally numbered 0049. SK-229 had
already used 0049–0051, so the desktop file was safely renamed before its live
run.

The immutable production record is:

`packages/db/drizzle/0050_desktop_auth_codes.sql`

It intentionally coexists with:

`packages/db/drizzle/0050_account_closure_foundation.sql`

The migration ledger uses the full filename, so both are distinct. The
desktop migration was applied to canonical production after explicit approval
and its table, function, trigger, index, and ledger row were checked. It must
never be renamed, copied to a new number, edited, or replayed.

An older disposable proof database recorded the old 0049 filename. It must be
retired or recreated before reuse; its ledger must not be manually repaired.

### 8. Clerk and production compatibility work

The production Clerk custom-domain DNS and certificates were prepared and the
web candidate used production Clerk rather than the old development handshake.
The canonical identity layer was integrated with the desktop endpoints.

This work removed the original Clerk bootstrap blocker, but the final Mac
email/password and social-auth journeys were still not completed as a valid
Gate 1 run.

### 9. CI and build work

Ubuntu CI initially failed because Tauri needed native GLib, GTK, WebKit, and
tray development packages. CI now installs the official WebKitGTK and
Ayatana AppIndicator development packages before running Cargo tests.

At combined source `3a6bf33c`, the following passed:

- workspace typecheck;
- workspace lint;
- focused desktop auth, identity, cache, proof, and signed-out-launch tests;
- desktop Node tests: 13 passed;
- desktop Rust tests: 36 passed;
- database tests: 275 passed, 14 skipped;
- admin tests: 406 passed;
- web tests: 7,190 passed, 86 skipped;
- full optimized web and admin builds;
- optimized Apple Silicon Tauri build; and
- GitHub CI, including Linux Cargo compilation.

Independent reviews found no remaining release-blocking issue in the latest
desktop identity or signed-out-launch changes. The correct verification label
remains **PARTIAL**, because required live Gate and release-candidate checks
are missing.

For the final local-startup change at `339df7ec`, workspace typecheck and lint,
14 desktop Node tests, 39 debug and 39 optimized Rust tests, 275 database tests,
406 admin tests, 7,190 web tests, and the full optimized repository build all
passed. The installed app was also visually checked from the animated loader
through the production Clerk handshake to the real signed-in dashboard.

### 10. Local Mac artifact

The latest locally rebuilt app is:

`apps/desktop/src-tauri/target/release/bundle/macos/Skitza.app`

The identical installed copy is:

`/Applications/Skitza.app`

Recorded properties:

- website source: `3a6bf33c7e4ce7455f308aae684c91d5d64ce518`;
- local desktop source: `339df7eca0444ddf1e95f4080f6acd975bb66ab6`;
- Apple Silicon `arm64` executable;
- bundle identifier `app.skitza.desktop`;
- version `0.1.0`;
- exact compiled origin `https://skitza.app`;
- locally ad-hoc signed; and
- strict local code-signature verification passed.

The final locally signed installed executable has SHA-256:

`d0dbdddc16313d354fbd8edb1db7416fa22352c1e80f360f2243e588a5006d8c`

This is a local proof artifact, not a distributable installer. It is not
Developer ID signed or notarized.

## Commit record

| Commit     | Work                                            |
| ---------- | ----------------------------------------------- |
| `25fd34aa` | Aligned the desktop product source and PRD.     |
| `b3c3643a` | Encoded Gate 1 pass criteria.                   |
| `c37aa7fa` | Enforced exact Gate 1 evidence.                 |
| `f1a0bb2a` | Added the Gate 1 Tauri shell.                   |
| `23996f3d` | Integrated the shared Gate 1 runtime.           |
| `49390c9c` | Added isolated private-proof access.            |
| `004ffe65` | Secured private-proof entry and social handoff. |
| `2856453f` | Rejected production-equivalent proof hosts.     |
| `89cee5e4` | Allowed only Tauri's local IPC CSP sources.     |
| `d3c02e96` | Added native proof-cookie seeding.              |
| `2bec7e00` | Hardened protected proof launch.                |
| `8275382b` | Used a verified WebView cookie-store launch.    |
| `e9e909e4` | Added runtime-only private production access.   |
| `2e10380f` | Resolved the live migration filename collision. |
| `f7c823f0` | Excluded local build artifacts from deployment. |
| `5b911dbb` | Scoped Vercel ignores to the web project.       |
| `1e5e623d` | Integrated canonical Clerk account identity.    |
| `2dc1b71b` | Added Linux Tauri dependencies to CI.           |
| `d954664f` | Fixed signed-out desktop startup routing.       |
| `39d5f304` | Added the full implementation handoff.          |
| `b108f48a` | Restored the orange Skitza desktop icon.         |
| `339df7ec` | Finished direct Mac startup and full tray mark.  |

## Deployment record

| Deployment                                                                  | Result                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Isolated proof candidate `dpl_J2xB5wrqTpxfmgrecwY8fuWiLteG`                 | Prepared private proof data and web fixtures; live Gate timing did not start because the protected preview and development Clerk handshake blocked the exact-origin WebView.                                             |
| Production candidate `dpl_6zGNiYxDDd1Lp5SiKjrmq74Aeys9`                     | Promoted after explicit approval and passed immediate health, launch, Clerk, and negative desktop-route smoke; later superseded.                                                                                         |
| Combined candidate `dpl_AecSbfZ1Sjhf9DhecjgDBkvxT9Tu` at `4d82abde`         | Promoted after explicit approval; health, database, access gate, Clerk, desktop route negatives, build ID, proof markers, and logs passed. The first Mac smoke then exposed the signed-out startup deadlock.             |
| Fixed candidate `dpl_2HUXP98jhC7qFi7VMdrUk67uzwBo` at `ce4a6785`            | Ready and independently smoke-tested. It contains the signed-out fix. It was **not promoted** and is now older than current `v3-clean`.                                                                                  |
| Current live `skitza.app`: `dpl_E5KbE8JfqEE6tTkN5qdPzcsL8R2k` at `3a6bf33c` | Explicitly approved and promoted. Open-site smoke, health/database, production Clerk, desktop route negatives, exact build, Gate markers, and logs passed. The website intentionally remains open. |

Do not promote an older desktop deployment over the current combined live
deployment.

## Current repository and PR state

At the time of this handoff:

- implementation branch:
  `giasraf/sk-231-prove-and-build-the-enhanced-speed-first-producer-desktop`;
- pre-refresh implementation head:
  `ce4a67856255ada9f3cd504bc87fc42f2562879f`;
- refreshed base: `d239e439f0c6870dabf47975e5ce426dd21049d5`;
- current combined source and PR head before this documentation update:
  `3a6bf33c7e4ce7455f308aae684c91d5d64ce518`;
- current verified local desktop source:
  `339df7eca0444ddf1e95f4080f6acd975bb66ab6`;
- all 20 pre-refresh commits were retained patch-identically by range-diff;
- the branch is directly based on current `origin/v3-clean` with no base commit
  missing;
- PR #351 remains open and draft;
- the shared
  `apps/web/src/components/dashboard/clients-projects/producer-projects-list.tsx`
  keeps both the latest mobile-width fix and the desktop meaningful-content
  marker; and
- this execution record is the only worktree change after the verified and
  deployed source.

The desktop migration source file is on PR #351 but not yet on current
`v3-clean`, even though its exact immutable filename is already in the live
migration ledger.

## Plan status

| Approved requirement                   | Status                                                 | Evidence or gap                                                                     |
| -------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Small release-mode Apple Silicon proof | Built                                                  | Arm64 app, exact origin, proof bridge, tests, and local signature exist.            |
| Small Windows 11 x64 proof             | Deferred / not run                                     | Gili postponed Windows because no machine was available. This is not a pass.        |
| Email/password desktop sign-in         | Built, not live-proved                                 | Shared sign-in and session paths exist; final Mac journey remains unrecorded.       |
| Social desktop sign-in                 | Built, not live-proved                                 | System browser, PKCE, deep link, one-use code, ticket bridge, and DB support exist. |
| Mac Gate 1 timings                     | Not run                                                | No accepted warm-up plus five-run raw set exists for any journey.                   |
| Windows Gate 1 timings                 | Deferred / not run                                     | Required by the approved plan before overall Gate 1 can pass.                       |
| Visual continuity                      | Code shares Web UI; not live-proved                    | No final matched Mac/Chrome capture set was accepted.                               |
| Menu-bar Open and Quit                 | Implemented                                            | Native code and focused tests exist.                                                |
| Close hides                            | Implemented                                            | Native close handler keeps process and WebView alive.                               |
| Safe-screen preview and quiet refresh  | Implemented and tested; not timed live                 | Account/session gates and web/desktop behavior have regression coverage.            |
| Recent eligible audio cache            | Implemented and tested; not timed live                 | Account denial/sign-out cleanup and proof markers have coverage.                    |
| Upload continues while hidden          | Possible through the retained WebView; not live-proved | A real upload-before-25% test has not been completed.                               |
| Tray upload status and progress        | Not implemented                                        | Native tray currently contains Open, proof Inspector, and Quit only.                |
| Quit-during-upload warning             | Not implemented                                        | Quit currently exits immediately.                                                   |
| Account isolation and clearing         | Strong automated coverage; final live proof missing    | Cold/unknown/offline/revoked/mismatch cases are tested.                             |
| Intel Mac support                      | Not built or tested                                    | No Intel artifact, clean install, or timing result.                                 |
| Windows 11 x64 app                     | Not built or tested                                    | No Windows artifact or tray/install result.                                         |
| Clean test installers                  | Not complete                                           | Only a local ad-hoc-signed Mac `.app` exists.                                       |
| Automatic updater A → B                | Not implemented or tested                              | No updater plugin, signed update manifest, or upload deferral proof.                |
| Production signing/notarization        | Not done                                               | Apple Developer ID/notarization and Windows trusted signing remain.                 |
| Direct public downloads                | Not done                                               | No installer has been published.                                                    |
| Merge to `v3-clean`                    | Not done                                               | PR #351 remains draft and unmerged.                                                 |

## What is left, in order

### 1. Reconcile source before any more desktop deployment — complete

The branch was refreshed onto current `v3-clean` `d239e439`. Range-diff proved
all 20 commits were retained patch-identically. The shared Clients & Projects
file keeps both changes, and both immutable 0050 migration files remain. Full
verification and optimized builds passed.

### 2. Create and promote a fresh combined production candidate — complete

Exact source `3a6bf33c` was deployed as candidate
`dpl_E5KbE8JfqEE6tTkN5qdPzcsL8R2k`, checked, explicitly approved by Gili, and
promoted. The website is intentionally open. The candidate is the current
`skitza.app` deployment.

### 3. Complete the final Mac authentication and lifecycle smoke — in progress

The exact verified app is installed at `/Applications/Skitza.app`. A clean
local launch now reaches the real signed-in Producer dashboard through the
animated mobile-style loader. The old saved-studio placeholder no longer
appears, and Close was verified to keep the same process alive. These checks
remain:

1. Start signed out and confirm the app reaches Sign in.
2. Complete email/password sign-in and confirm the correct Producer.
3. Quit and relaunch; confirm session restoration and correct account.
4. Sign out and confirm saved screens/audio are hidden and cleared.
5. Complete one social sign-in through the system browser and
   `skitza://auth/callback`.
6. Confirm `/api/desktop/session` validates the same active provider account.
7. Confirm menu-bar Open restores the hidden window and Quit stops the process.

### 4. Run the exact Mac Gate 1 proof

Using the same build, account, fixtures, Mac, Chrome version, and network:

- one warm-up plus five desktop and five Chrome runs for reopening Today;
- one warm-up plus five desktop and five Chrome runs for the saved Clients &
  Projects view;
- one warm-up plus five desktop and five Chrome runs for cached recent audio;
- verify no timed audio media download;
- keep every raw success, timeout, and failure; and
- capture matched visual-continuity evidence.

Evaluate the raw evidence with the committed evaluator. If the Mac rows fail,
stop and report the measurements.

### 5. Finish the post-Gate release-candidate features

Only after the speed proof passes:

- connect the existing upload manager to the native tray;
- show active upload progress in the tray menu;
- add **Keep Skitza Running** and **Quit and Stop Upload**;
- prove a real upload hidden before 25% keeps moving and restores accurate
  progress;
- add bridge-version compatibility and the old-shell Update Skitza state; and
- implement the signed Tauri updater with upload-aware deferral.

### 6. Complete the remaining platform matrix

- Build and test a supported Intel Mac app.
- Build and test Windows 11 x64 with WebView2 Evergreen.
- Run the same Gate 1 authentication, timing, visual, account-isolation,
  hidden-upload, and Quit behavior on Windows.
- Run clean-install checks on Apple Silicon Mac, Intel Mac, and Windows 11 x64.

Windows remains postponed by Gili, but the approved plan still requires it
before overall Gate 1 or the internal release candidate can be declared
complete.

### 7. Finish private release packaging

- Prove an internal updater from version A to version B after an active upload
  finishes.
- Finalize versioning and rollback evidence.
- Produce test DMG/package and Windows installer artifacts.
- Keep them private.

### 8. Public release only after separate approvals

After the internal release candidate passes:

- Developer ID sign and notarize the Mac artifacts;
- sign and timestamp the Windows installer and executable;
- run clean-machine signature and update tests;
- prepare both direct downloads together; and
- obtain Gili's explicit approval before merge, installer publication,
  production promotion, gate changes, or public release.

## Non-repeat and safety notes

- Do not claim Gate 1 passed. It was never completed.
- Do not invent a Windows result. Windows was postponed, not removed.
- Do not promote an old desktop deployment over current `v3-clean`.
- Do not rename, edit, copy, or replay `0050_desktop_auth_codes.sql`.
- Do not rewrite `producers.clerk_user_id` or historical identity rows; the
  canonical binding is the intended identity bridge.
- Do not widen the exact-origin navigation or native-command boundary.
- Do not publish the ad-hoc-signed local Mac app.
- Do not add any excluded full-offline or native-product feature.

## Final completion statement

The combined website and desktop connection are live, and the exact verified
Apple Silicon app is installed and usable locally. The approved full desktop
plan is not complete: fresh password/social auth and hidden-upload lifecycle
smoke are still missing, Mac Gate 1 timing evidence is missing, post-Gate
upload-tray and updater work is not built, Windows remains deferred, and no
public installer has been published.
