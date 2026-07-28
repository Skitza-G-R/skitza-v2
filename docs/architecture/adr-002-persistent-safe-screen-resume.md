# ADR 002: Persistent safe-screen resume

- Status: Accepted
- Date: 2026-07-27
- Issue: SK-128

## Context

Skitza's producer and artist screens are authenticated Next.js Server
Components. A cold navigation can take one to three seconds while authentication
and database work finish. SK-117 kept the previous screen mounted during that
wait, and SK-122 temporarily prefetched main routes into Next's in-memory Router
Cache. Those changes avoid a loading flash when the Router Cache is warm, but
they cannot make a cold destination appear immediately:

- the previous route remains visible until the destination RSC commits;
- the Router Cache is process-local, expires, and is discarded by the current
  foreground `router.refresh()`;
- the existing durable safe views contain counts rather than useful screen
  content; and
- after the installed app is killed, no private document is available to read
  device-local state until a new network document starts.

Authenticated HTML, RSC, API responses, signed URLs, protected audio, uploads,
booking, availability, and payment data must remain outside service-worker and
durable screen caches. Account, role, and studio boundaries must continue to
fail closed.

## Decision

Keep Next's Router Cache as an optional speed bonus and add an app-owned,
versioned safe-screen layer.

### Safe screen models

Persist small, strictly validated, read-only screen models in the existing
account-scoped `localStorage` envelope store.

- Every model is scoped by Clerk user ID, role, studio/producer context, and
  canonical route.
- Models contain only bounded display strings, counts, and explicitly mapped
  rows. Source record IDs, unknown fields, and oversized collections are
  rejected or omitted; presenter keys are generated locally.
- Producer Today stores studio/project and upload metadata only.
- Producer Clients stores client names and non-commercial project metadata.
- Producer Music and artist Music store catalog metadata without audio URLs,
  action URLs, entitlement or purchase identifiers, or player state.
- Artist Home stores its greeting, studio roster, and safe latest-music
  metadata. Artist Store stores studio and public catalog labels without
  purchase actions.
- Calendar, Book, Payments, availability, uploads, and other live-only routes
  never receive a durable screen model.

The models are intentionally capped so synchronous reads remain comfortably
inside the browser storage budget and can complete in the navigation event
frame. IndexedDB is not introduced for this slice.

### In-app navigation

A persistent viewport inside both signed-in shells listens for an accepted main
navigation intent. Before the destination RSC arrives, it immediately replaces
the old page area with:

- the validated saved destination model, when one exists; or
- a destination-shaped scaffold for a never-seen or live-only route.

The tapped destination receives selected styling in the same event frame. The
preview is read-only even while the device is online. The real server page
continues loading and replaces it after commit.

### Installed-app launch

The manifest starts at a public `/launch` resume document. It contains no user
or server data and is the only navigation document the service worker may
precache.

After the client has a matching Clerk identity, the launch page reads that
user's validated launch pointer and safe screen model and paints it. Online,
the protected destination always passes through the server's authoritative
role resolver; a locally saved target is accepted only when it belongs to that
current role. While offline, the page may use only the last locally verified
single-account pointer; sign-out and account switching clear that pointer
synchronously. Artist models additionally require an explicit studio in the
route to match the stored studio scope. Protected route-group loading
boundaries use the same presenter, so the saved view remains visible while auth
and RSC work finish.

Authenticated documents and responses remain network-only. The public launch
document is an app bootstrap, not a stored authenticated page. The service
worker accepts it only when the exact, non-redirected response carries the
explicit public-bootstrap marker and passes the response privacy checks.
The pre-launch access gate exempts only this no-data `/launch` document;
`/launch/resolve` and every authenticated destination remain gated and
network-only.

Only routes with an approved safe-screen model may update the launch pointer.
Visiting Calendar, Book, Payments, uploads, or another live-action route cannot
replace the last readable safe screen used on the next reopen.

### Freshness

Foreground and reconnect events no longer call a root-level
`router.refresh()`. They emit the existing freshness signal and check for a
service-worker update, while the signed-in runtime quietly re-prefetches only
the active main route without discarding the other warm destinations.
Normal route navigation and successful mutations fetch authoritative server
data; each committed safe screen overwrites its local model quietly. Prefetch
remains opportunistic and is never required for instant feedback.

## Options considered

### Next Router Cache and more prefetching only

Rejected as the primary mechanism. It cannot survive a killed app, does not
cover unseen or deep routes, and has already failed twice when its short warm
window was unavailable.

### IndexedDB safe-screen models

Deferred. IndexedDB offers a larger quota, but this rollout needs only bounded
text metadata and benefits from synchronous reads during a tap and launch.
Moving to IndexedDB would add asynchronous preload, migration, and account-exit
coordination without improving the approved first-screen models.

### Cache authenticated HTML or RSC in the service worker

Rejected. It risks serving one account's private server tree to another and
would also retain signed or transactional response data outside the explicit
view-model allowlist.

### Persist a DOM or HTML snapshot

Rejected. Snapshots are not typed, are difficult to sanitize and version, can
contain private URLs or stale controls, and cannot safely rehydrate as a React
tree.

## Consequences

- Previously viewed safe main destinations can render useful content without
  waiting for a server response.
- Never-seen and live-only destinations show their own shape immediately
  instead of leaving the previous screen frozen.
- A cold installed-app launch can restore the last safe screen while the real
  protected route loads, without storing authenticated responses.
- Saved previews are deliberately read-only; all live actions still wait for
  current server authorization and connectivity.
- Adding a screen requires an explicit mapper, a strict validator, collection
  bounds, privacy tests, and a read-only presenter.
- Device-local offline resume trusts only the last locally verified
  single-account boundary. A remote account change cannot be learned while the
  device is offline; on the next online Clerk mismatch, content is concealed
  and the old account is cleared before the new account can read it.

## Action items

- Add the safe-screen and launch-pointer payloads and validators.
- Add shared safe-screen writers, presenter, transition viewport, and launch
  resume boundary.
- Map the approved producer and artist screens into safe models.
- Add the public launch route and restrict service-worker document caching to
  that route.
- Remove root foreground/reconnect refreshes.
- Cover one-frame intent rendering, expiry, account/role/studio isolation,
  account exit, forbidden fields, cold resume, offline resume, and unseen
  scaffolds with focused tests and browser verification.
