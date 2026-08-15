# Enhanced producer desktop app — source of truth

**Date:** August 13, 2026
**Status:** Implementation in progress; Gate 1 has not passed and the internal release candidate is not complete. See the [SK-231 implementation record and handoff](../plans/active/2026-08-15-sk-231-enhanced-desktop-handoff.md).
**Decider:** Gili Asraf
**Surface:** Producer-only Skitza app for Mac and Windows
**Development base and PR target:** `v3-clean`
**Target to an internal release candidate:** 8–12 working days, including the speed proof

## Decision

Build the **enhanced, speed-first** Skitza desktop app with Tauri 2.

This is not a basic wrapper and it is not the former full-offline app. It keeps
the complete Skitza website and adds only the desktop behavior that makes
repeat daily use feel faster and keeps Skitza close at hand.

The app has:

- the same producer interface as Skitza Web;
- a Mac menu-bar icon and Windows system-tray icon;
- close-to-hide behavior so the app stays running;
- near-instant reopening from the menu bar or tray;
- cached recent screens shown first, followed by a quiet online refresh;
- cached recent unlocked audio for faster repeat playback; and
- uploads that continue while the app is running with its window hidden.

The first 1–2 working days are a performance proof. If the enhanced build does
not create a noticeable improvement over Skitza Web, development stops and the
rest of this plan is not built.

## Source precedence

The main [Skitza PRD](PRD.md) is the product-wide source of truth. Within its
approved desktop-app section, this document is the normative source for
desktop details. If the two documents conflict, implementation stops until
both are updated to the same decision.

This plan supersedes the full-offline desktop specification approved on
August 5, 2026. That older scope and its 35–52-day estimate are no longer
approved.

If this document conflicts with a later explicit decision from Gili, Gili's
latest decision wins and both documents must be updated before implementation
continues.

## Product outcome

### Who uses it

- The desktop app is for producers only.
- Artists, public visitors, and producer storefront visitors continue using
  the website.
- Producers may keep using the full website without installing the app.
- The desktop app has no separate price at launch.

### Same Skitza, not a second product

The app uses the same:

- Next.js producer interface and design system;
- Clerk account;
- tRPC API;
- Neon database;
- R2 media; and
- product permissions and rules.

There is no second desktop frontend and no desktop redesign. Live pages,
navigation, buttons, colours, wording, and content come from the shared Skitza
web code.

The instant saved preview uses the normal Skitza shell and design, but may
temporarily omit information that requires a live server response. It is
replaced in place when fresh data arrives. It must not look like a separate
app or switch to a different design.

The only intentional visual differences are the operating-system window frame
and the native menu-bar/tray menu.

### August 15, 2026 visible-loading decision

Gili replaced the visible saved-screen behavior for the desktop app. This
decision supersedes the saved-preview display and saved-screen Gate 1 rows
later in this plan:

- the desktop app must never show **Checking your secure session…**;
- the desktop app must not render the old **Saved studio activity** preview;
- the private session check still runs, but the packaged moving Skitza loader
  covers it until the current live page is ready; and
- this is a desktop-only presentation rule. Skitza Web is unchanged.

Account-scoped storage may still support security cleanup, route warming, and
recent-audio behavior. It is not a visible desktop screen. Gate 1 remains
unpassed; the superseded saved-screen journey cannot be counted as evidence.

## Locked behavior

### Window, menu bar, and tray

- Skitza has one main window.
- When the main window is visible, Skitza behaves like a normal app in the Mac
  Dock or Windows taskbar. The menu-bar/tray icon is additional access.
- Closing the window hides it instead of quitting the app.
- Clicking the Mac menu-bar icon or Windows tray icon opens the window.
- Reopening restores the last safe producer screen when possible.
- If the last route is not safe to restore, open **Today**.
- The menu contains:
  - **Open Skitza**;
  - current upload status; and
  - **Quit Skitza**.
- **Quit Skitza** fully stops the app.
- Windows may place the icon inside its hidden-icons overflow area. Skitza
  cannot force Windows to keep it permanently beside the clock.
- Start-at-login is not included.

### Sign-in

- First sign-in requires internet.
- The producer uses the same Clerk account as on the website.
- The desktop WebView keeps its own Clerk-managed session; it does not copy
  cookies from Safari, Chrome, or Edge.
- Email/password sign-in uses the trusted Skitza sign-in surface.
- Social sign-in uses this exact system-browser handoff:
  1. The app creates a random state value plus a PKCE verifier and challenge.
     State and verifier remain in memory.
  2. It opens an exact Skitza HTTPS authentication endpoint in the system
     browser.
  3. After Clerk completes authentication, Skitza returns a short-lived,
     single-use authorization code through the allowlisted
     `skitza://auth/callback` route.
  4. Rust validates state and exchanges that code plus the PKCE verifier with
     the Skitza server over HTTPS.
  5. The trusted WebView receives a one-use Clerk sign-in ticket in memory and
     completes Clerk's ticket strategy to create its own session.
- The authorization code and ticket expire within 60 seconds and work once.
  The authorization code appears only in the callback URL and is scrubbed
  immediately; it is never logged or persisted. The Clerk ticket is delivered
  only in memory and never appears in a URL, analytics, or logs. The custom
  callback contains no session token.
- The authentication callback is the only required app URL scheme. It is not
  a product/content deep-link feature.
- Gate 1 must prove this Clerk flow on both operating systems. If the current
  Clerk SDK or provider policy cannot support it safely, development stops and
  the estimate is revisited.
- Later launches restore the WebView's Clerk session only while Clerk reports
  it as active.
- While the app is online and hidden, validate the active Clerk session at
  least once every 60 seconds. A warm reveal may show private cached content
  immediately only when the same session passed a live validation within the
  previous 2 minutes.
- If the device slept, the process was suspended, validation failed, the app
  is offline, or the last live validation is older than 2 minutes, keep private
  cached content hidden until the server validates the session again.
- Signing out removes the desktop session and all account-owned local screen
  and audio data.

### Faster screen opening

- Reuse the existing account-scoped safe-view system from `v3-clean`.
- Keep at most 20 previously viewed safe screens for seven days.
- On a warm reopen or repeat visit within an already validated session, show
  meaningful saved content immediately.
- On a cold process launch, validate that the remembered Clerk session is
  still active for the same account before showing account-private saved
  content. Cold launch is not part of the sub-second speed promise.
- Refresh from the server quietly after the saved content appears.
- Do not replace useful saved content with a blank page or full-screen loading
  spinner during that refresh.
- Restore the last safe route, scroll position, and supported filters when
  possible.
- Reuse the existing route-warming system for likely next producer pages.
- Never save authentication responses, signed URLs, payment information,
  booking information, client contact details, or security settings.
- If session state is offline or unknown on a cold launch, keep private cache
  hidden and show the connection/sign-in surface.
- A confirmed expired, ended, removed, replaced, or revoked Clerk session, an
  account mismatch, account deletion/ban, or a protected 401/403 response
  immediately hides and clears that account's saved screens and audio.
- Fresh server information remains authoritative.

The fast saved view is a speed feature, not a promise that all pages work
offline.

### Faster repeat audio

- Reuse the existing account-scoped recent-audio cache from `v3-clean`.
- Cache only recently played audio that the signed-in producer is currently
  allowed to hear.
- Keep at most 10 tracks for at most 30 days.
- Use at most the smaller of 250 MB or 20% of the WebView's reported storage
  allowance.
- Evict least-recently-used audio when a limit is reached.
- Never cache locked audio, signed URLs, public capability URLs, or direct R2
  object paths.
- Clear the account's cached audio on sign-out.
- Audio may continue while the window is hidden.
- This cache is not a permanent download library.

### Uploads while hidden

- Reuse Skitza's current app-level upload manager and multipart upload flow.
- An upload continues when the producer closes and hides the window because
  the app process and WebView remain alive.
- The tray menu shows whether an upload is active and its current progress.
- Reopening the window shows the same upload and accurate progress.
- Quitting during an upload shows **Keep Skitza Running** and
  **Quit and Stop Upload**. The first cancels Quit; the second stops the app and
  makes no recovery promise.
- A real Quit, crash, restart, shutdown, sleep, or loss of the source file is
  not guaranteed to preserve or resume the upload.
- The app does not create a second staged copy of the upload.
- File formats and size limits always match the current Skitza Web upload
  rules.

### Quiet refresh

"Quiet refresh" means that cached content stays visible while the open app
checks for fresh data. It does not mean that every Skitza screen continuously
syncs while the window is hidden. Hidden uploads and existing audio playback
continue; other data refreshes when the producer opens or uses the app.

## What becomes faster

The enhanced app is designed to improve repeat daily use:

- reopening Skitza from the menu bar or tray;
- reopening a previously viewed safe screen;
- moving to a warmed common producer route; and
- replaying recently cached, unlocked audio.

The app does not make these network operations inherently faster:

- the first-ever app launch;
- the first visit to uncached content;
- fresh database or API work;
- payments and bookings;
- authentication checks;
- first-time audio streaming; or
- the internet upload itself.

## Performance proof — Gate 1

Gate 1 takes no more than 1–2 working days and uses internal test builds. It is
not a public beta.

### Test method

- Test release-mode proof builds on an Apple Silicon Mac and a Windows 11 x64
  machine. Every Gate 1 result must pass separately on both operating systems.
- Compare the same release-candidate Skitza web build in the desktop proof and
  current Chrome on the same machine, account, sample data, and network. A
  proof-only exact test origin may be allowlisted; production builds allow only
  the production origin.
- Run every timed test five times after one normal warm-up run.
- Record timings in the app and browser rather than judging only by eye.
- Use a prepared producer account containing non-sensitive project and music
  data so a safe preview has real content.
- A meaningful screen contains its real title and at least one saved metric or
  list item. A logo, skeleton, scaffold, spinner, or empty frame does not count.
- For a screen journey, measure from the equivalent click/navigation action to
  the first painted meaningful screen. For audio, measure from Play to audible
  playback and confirm with instrumentation that no media download occurred.
- Measure these three repeat-use journeys:
  1. reveal the previously open Today screen from a hidden running app, versus
     bringing an already loaded Skitza Chrome tab to the foreground;
  2. move from Today to a previously viewed Clients & Projects safe view; and
  3. move to Music and replay a previously cached recent track.
- For each journey and platform, compare the median of five desktop runs with
  the median of five Chrome web runs.

### Passing results

| Test | Required result |
| --- | --- |
| Clerk compatibility | Email/password and one configured social sign-in complete securely and restore the correct producer on both operating systems |
| Reopen from menu bar/tray | Previous usable screen appears within 1.0 second in at least 4 of 5 runs |
| Previously viewed safe screen | Meaningful content appears within 0.5 seconds in at least 4 of 5 runs, without a blank page or full-screen spinner |
| Cached recent audio | Audible playback begins within 0.5 seconds in at least 4 of 5 runs without downloading the media again |
| Overall comparison | On each operating system, at least 2 of the 3 desktop journey medians are at least 25% faster than web or save at least 0.5 seconds; no journey may regress by both more than 10% and more than 0.1 second |
| Visual continuity | The live app uses the same interface as web; the fast preview uses the same shell and design |

### Stop rule

If any Clerk, absolute-speed, comparison, or visual-continuity row fails on
either operating system, or needs the old full-offline architecture to pass,
stop development and report the measurements to Gili. Hidden-upload,
account-isolation, installer, updater, and full support-matrix tests are final
release-candidate gates because their production integrations are built after
Gate 1. Changing the targets or expanding the app requires a new explicit
decision from Gili.

## Technical approach

### Reuse from current `v3-clean`

Reuse and adapt these existing systems:

- public `/launch` bootstrap and safe session restoration;
- account-scoped safe screen views;
- navigation state and route warming;
- recent unlocked-audio cache;
- persistent root audio runtime;
- app-level upload manager and multipart uploads; and
- account-exit cleanup.

The existing limits remain:

- safe views: 20 routes for seven days; and
- recent audio: 10 tracks for 30 days, up to 250 MB or 20% of reported
  storage.

### Tauri shell

Create `apps/desktop` as a Tauri 2 workspace package.

The desktop shell owns only:

- app/window lifecycle;
- the local startup and connection-error surface;
- Mac menu-bar and Windows tray integration;
- Open, upload-status, and Quit actions;
- narrow communication with the shared web runtime;
- installer and updater integration; and
- release-only performance instrumentation.

Bundle the small startup/error shell as local Tauri assets. Load the shared
Skitza producer interface from the exact production Skitza origin. Gate 1 must
prove that the existing cached `/launch` path works reliably in both WebViews;
otherwise the speed-first design fails instead of growing into a second local
frontend.

### Web/native compatibility

- The native bridge exposes a protocol version and an explicit list of
  supported capabilities.
- The shared web app feature-detects every native capability and continues to
  work as normal Skitza Web when a capability is absent.
- Each production web deployment supports the current released bridge and the
  previous bridge version.
- Web code must not require a new bridge capability until compatible desktop
  builds are available and the release is enabled.
- If an installed shell is too old for safe operation, disable native-only
  behavior and show **Update Skitza**. Never expose a broader fallback bridge.
- A web deployment must not break an installed desktop version merely because
  its native update is deferred during an upload.

### Security boundary

- Allow navigation only to exact Skitza production origins.
- Open outside links in the normal browser.
- The web page receives only narrow high-level desktop commands.
- Do not expose a generic filesystem, shell, process, or command API.
- Do not grant recursive access to Home, Desktop, Documents, or Downloads.
- Tauri capabilities are command-by-command and scoped to the exact trusted
  origin.
- Validate all inputs again in Rust.
- Use a real content security policy for local and remote content.
- Leave the long-lived session in Clerk's WebView-managed session store. The
  native shell handles only short-lived handoff material in memory.
- Never place credentials, one-use authentication material, or updater private
  keys in the repository, app logs, analytics, or persistent native storage.
- Local safe summaries and eligible cached audio use the same storage model as
  current Skitza Web and rely on operating-system user-account protection.
  They do not claim protection against malware or another device administrator.

The removed Tauri v0.1.0 code in commit `291084e6` may be used only as a
reference for icons, package structure, and build setup. Its old URL, broad
file permissions, disabled CSP, routes, and unsigned release workflow must not
be restored.

## Explicit non-goals

The enhanced app does **not** include:

- full offline mode;
- a native copy of the Skitza interface;
- offline editing or offline drafts;
- an encrypted 1 GB native audio library;
- permanent audio downloads;
- upload recovery after Quit, crash, or restart;
- a staged copy or durable upload journal;
- native desktop notifications;
- native system media controls;
- product/content deep links beyond the required authentication callback;
- file-drop-to-upload behavior;
- watched folders;
- start-at-login;
- global keyboard shortcuts;
- an artist or public desktop app;
- an interface redesign; or
- a separate desktop backend, database, or account.

Adding any of these requires Gili's explicit approval and a new estimate.

## Platforms and release

### Supported targets

- macOS on Apple Silicon and Intel hardware running a macOS version that still
  receives security updates at release time.
- Windows 11 on x64 hardware with WebView2 Evergreen.
- Windows ARM is not included.
- Windows 10 is not supported.
- Gate 1 uses Apple Silicon and Windows 11 x64. Before public release, clean
  install, behavior, and timed tests must also pass on a supported Intel Mac.
  Intel must meet the same 1.0-second reopen, 0.5-second saved-screen, and
  0.5-second cached-audio limits and must not regress beyond Gate 1's allowed
  web comparison. The exact minimum macOS version is recorded after testing
  the oldest security-supported version intended for launch.

### Public release rule

- The website, Mac app, and Windows app become public together.
- There is no public beta or platform-by-platform release.
- Internal speed proof and release-candidate testing are required.
- Both desktop builds remain private until all launch checks pass.
- Producers download the Mac and Windows installers directly from the Skitza
  website. The Microsoft Store and Mac App Store are not used.
- The Mac release requires Gili's Apple Developer membership, Developer ID
  signing, and Apple notarization.
- The Windows release requires a trusted Windows code-signing identity. The
  installer and installed executable must have valid timestamped signatures
  showing the verified Skitza publisher.
- A new signed direct-download app may still show a Windows SmartScreen
  reputation warning at first. The release must never tell users to ignore an
  invalid signature or unknown publisher name.
- Gili must personally complete external identity checks and agreements.

### Updates

- Prepare automatic update support during implementation.
- Test an internal version A to version B update before release.
- Tauri updater signatures are separate from Apple or Windows code signing.
- Store the updater private key in a managed secret vault with a tested backup.
- Never force an update while an upload is active.
- Mac and Windows direct downloads use the signed Tauri updater path.

## Implementation sequence

Workstreams overlap; the day ranges are elapsed targets, not values to add
together.

| Target days | Work |
| --- | --- |
| 1–2 | Build the smallest Apple-Silicon/Windows proof, verify Clerk sign-in and cached launch behavior, measure web versus desktop, and apply Gate 1 |
| 3–5 | Secure Tauri shell, remembered session, local startup/error surface, tray/menu-bar icon, close-to-hide, Open, and Quit |
| 4–7 | Integrate safe-view launch, quiet refresh, route warming, recent-audio cache, and performance marks |
| 6–8 | Keep uploads alive while hidden, expose tray progress, restore accurate status, and warn before Quit |
| 8–12 | Mac/Windows regression tests, account-isolation checks, security review, test installers, updater proof, visual comparison, and fixes |

### Estimate boundary

The 8–12-working-day target produces an **internal release candidate**. It
includes Gate 1, implementation, QA, test installers, and an internally tested
updater path. It assumes:

- the reusable `origin/v3-clean` runtime remains available;
- one integration owner with Mac and Windows work running in parallel;
- compatible Mac and Windows test machines are available; and
- no non-goal is added.

External Apple and Windows code-signing identity approval is calendar waiting
time and is not inside the 8–12 days. Because those accounts are not currently
ready, the current day-12 deliverable is private, not a public download.

After the signing identities are approved, allow 1–3 additional focused
working days for final production signing, notarization, direct-download
packaging, and release checks. External identity review time is additional
calendar waiting. If the identities are ready before packaging work begins,
this work may overlap the 8–12-day target instead.

## Internal release-candidate definition of done

The internal release candidate is complete only when:

1. Gate 1 passes on Mac and Windows.
2. The live interface visually matches Skitza Web.
3. Tray/menu-bar Open and Quit work correctly.
4. Closing hides the window without stopping a current upload or audio.
5. Reopening meets the speed target and restores the correct safe screen.
6. Cached safe screens refresh quietly and never expose excluded data.
7. Eligible cached audio meets its repeat-play target.
8. A valid audio upload hidden before 25% completes and reports accurate tray
   and restored-window progress.
9. Quit warns during an upload and makes no false resume promise.
10. Explicit sign-out, confirmed session revocation/expiry, and account changes
    clear account-owned local data. An offline/unknown cold session keeps it
    locked. A stale warm-session validation also keeps it locked. Account B
    cannot see account A's screen or audio data.
11. Test installers work on clean Apple Silicon Mac, Intel Mac, and Windows 11
    x64 machines, and Intel meets the required absolute speed limits without an
    unacceptable web comparison regression.
12. Version A defers its update while an upload is active, then successfully
    updates to version B after the upload finishes.

## Public release gate

The app becomes public only after the internal release candidate passes and:

1. Gili's required developer accounts and identity checks are approved.
2. Production Mac and Windows artifacts are signed.
3. The Mac build is notarized and passes a clean-machine install check.
4. The signed direct Windows package passes its clean-machine install and update
   checks.
5. The direct updater path passes a production version A to B test.
6. Website, Mac, and Windows downloads are ready to become public together.

## Current framework references

- [Tauri frontend assets and configuration](https://v2.tauri.app/reference/config/)
- [Tauri tray support](https://v2.tauri.app/learn/system-tray/)
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri updater](https://v2.tauri.app/plugin/updater/)
- [macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/)
- [Windows signing](https://v2.tauri.app/distribute/sign/windows/)
