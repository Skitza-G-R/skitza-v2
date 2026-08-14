# Skitza Gate 1 desktop proof

This package is the narrow Tauri 2 shell for `SK-234`. It is not an offline
frontend. The live producer interface is loaded from one exact HTTPS origin.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm desktop:dev
corepack pnpm desktop:build
```

Both commands default to `https://skitza.app`. An internal proof build may set
`SKITZA_DESKTOP_ORIGIN` to one exact HTTPS origin:

```sh
SKITZA_DESKTOP_ORIGIN=https://exact-proof.example \
  corepack pnpm desktop:build
```

The launcher validates and canonicalizes the origin, writes an ignored Tauri
configuration overlay containing only that origin, and passes the same origin
to Rust at compile time. Wildcards, paths, credentials, query strings,
fragments, and non-HTTPS origins are rejected.

When that private proof origin uses Vercel Deployment Protection, the
`gate1-proof` build may read a temporary bypass value at runtime from
`SKITZA_DESKTOP_PROTECTION_BYPASS`. It must be exactly 32 ASCII letters,
numbers, underscores, or hyphens. Keep the value in the private test secret
store; never add it to this repository or a build setting. The app does not
read this environment variable when the proof feature is disabled, and it
refuses the value when compiled for `https://skitza.app`. The private proof's
first WebView launch and social-auth system-browser entry use it only to set
Vercel's same-origin bypass cookie through a clean redirect.

For a private local run against the exact production origin while its temporary
site access gate is enabled, provide `SKITZA_DESKTOP_ACCESS_TOKEN` only to the
running `gate1-proof` app. The value is read once at runtime, removed from the
process environment, and its native owner is zeroized when dropped. It is never
added to a build, URL, query, custom header, or log. Before the clean
`https://skitza.app/launch` navigation, the app persists a `Secure`, `HttpOnly`,
`SameSite=Lax` `skitza-access` cookie constructed with the exact `skitza.app`
host and `/` path, bounded to 30 days. It first checks the full WebView cookie
store, removes every stale same-name cookie that could cover `skitza.app`, and
verifies that fence before setting the controlled cookie. The WebView
necessarily sends the value in its normal `Cookie` request header. After this
first run, the cookie lets Finder relaunch the app without the environment
variable until it expires. The token-present bootstrap disables the Web
Inspector so it cannot expose the cookie. Quit, then relaunch from Finder
without the environment variable to regain **Gate 1 Web Inspector** using the
persisted cookie. The runtime refuses the value for any other origin or
together with `SKITZA_DESKTOP_PROTECTION_BYPASS`.

## Gate 1 bridge

Trusted pages feature-detect `window.__SKITZA_DESKTOP__`. The frozen bridge has
protocol version `1`, the capabilities `social-auth-v1`,
`performance-proof-v1`, `saved-screen-preview-v1`, and
`session-validation-v1`, and only the shared high-level methods:

- `listen(callback)`
- `startSocialSignIn(provider)`
- `recordGate1Sample(sample)`
- `consumeRevealElapsedMs()`
- `exportGate1Samples()`
- `reportSessionValidation(report)`

The local startup document receives a separate frozen local-only object with
only `retryLaunch()`. The remote web app cannot invoke that command.

The auth start endpoint is `/api/desktop/auth/start`. It receives a 43-character
base64url `state` and S256 PKCE challenge. Rust accepts only the exact
`skitza://auth/callback?code=<43>&state=<43>` shape, validates and consumes
state, then posts `{ code, codeVerifier }` to `/api/desktop/auth/exchange`. A
protocol-v1 Clerk ticket is delivered once through the shared bridge listener,
in memory; it is never logged, saved, or placed in a URL.

Timing records are available only in release builds and remain in memory. The
bridge accepts the frozen shared `DesktopGate1Sample` schema. Native reopen
timing begins at the tray/menu action before reveal. After show/focus, native
emits `window-revealed`; the armed web proof controller consumes the native
monotonic elapsed duration and ends only at the first meaningful Today paint.
The web controller owns the exact phase/run metadata and records timeout
failures; native never invents or overwrites a sample.

## Private Mac proof operator path

The private Gate 1 release feature enables Tauri's Web Inspector; it does not
require macOS Accessibility access. From the menu-bar icon, choose **Gate 1 Web
Inspector**. In its Console, arm exactly one slot immediately before performing
the matching interaction, then close the Inspector so it does not perturb the
timed interaction:

```js
window.__SKITZA_GATE1_PROOF__.arm({ journey: "reopen-today", phase: "warmup", run: 0 })
window.__SKITZA_GATE1_PROOF__.arm({ journey: "safe-clients-projects", phase: "timed", run: 1 })
window.__SKITZA_GATE1_PROOF__.arm({ journey: "cached-recent-audio", phase: "timed", run: 1 })
```

For each of the three canonical journeys, run warmup `0`, then timed runs `1`
through `5`. For `reopen-today`, arm before hiding the window, then click the
menu-bar icon to start the native clock before show/focus. For the other two,
arm before clicking the Clients & Projects destination or cached recent audio.
Inspect in-memory web evidence with
`window.__SKITZA_GATE1_PROOF__.snapshot()` and export the native-preserved raw
desktop samples with `await window.__SKITZA_DESKTOP__.exportGate1Samples()`.
The proof build must set `NEXT_PUBLIC_SKITZA_GATE1_PROOF=1` and a non-secret
`NEXT_PUBLIC_SKITZA_BUILD_ID` on the exact HTTPS web origin.
