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
