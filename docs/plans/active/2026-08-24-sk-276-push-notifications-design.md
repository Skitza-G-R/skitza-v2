# SK-276 — Push notifications for producers and artists

**Date:** 2026-08-24 · **Status:** Approved by Gili (chat) · **Issue:** SK-276

## Goal

Both producers and artists can turn on device push notifications for important
updates, with one tap plus per-topic fine-tuning. Today the whole feature is
dead on skitza.app (VAPID keys exist only on preview) and artists have no UI to
enable it at all, even though the server already delivers artist-facing pushes.

## Decisions (locked with Gili)

1. **One-tap on + fine-tune.** A single "Turn on notifications" button enables
   every category at once; per-topic switches below let people quiet topics.
   Not per-topic-only (today's producer UI), not a single switch without topics.
2. **Settings + smart moments.** A Notifications card in Settings for both
   roles, plus one-time contextual banners: artist after booking a session and
   after sending a payment proof; producer at the end of onboarding. Dismissal
   silences the banner for 90 days (same rule as the SK-249 install invite).
3. **iPhone Safari swaps to install guidance.** iOS allows web push only for
   Home-Screen-installed apps. In iPhone Safari the card/banner shows "Add
   Skitza to your Home Screen to get notifications" and opens the existing
   install guide instead of a broken toggle.

## What already exists (reuse, do not rebuild)

- Service worker `push` + `notificationclick` handlers — `apps/web/public/sw.js`.
- VAPID config reader — `apps/web/src/server/push/config.ts` (3 env vars).
- Subscription store + per-category filtering + delivery helpers
  (`deliverPushToUser`, `deliverPushToProducer`, `deliverPushToProjectArtist`,
  `deliverPushToVersionArtist`, `deliverPushToVersionProducer`) — already
  called from booking, payment, comment, project, song, and purchase flows.
- Server actions `getPushStatusAction` / `savePushSubscriptionAction` /
  `unsubscribePushAction` — user-scoped (any signed-in user), artist-safe as-is.
- 6 categories (`booking, payment, comment, project_status, song_status,
  purchase_status`) — `apps/web/src/lib/push/categories.ts`.
- `PushPreferences` card — mounted only in producer Settings today.
- Install guidance + iPhone detection + 90-day dismissal marker —
  `apps/web/src/lib/pwa/install-guidance.ts` (SK-249).

## Design

### 1. Settings card (both roles)

`PushPreferences` gains a `role` prop (`"producer" | "artist"`):

- **Master button** "Turn on notifications": requests permission, subscribes,
  saves **all 6 categories** in one call. Shown while no subscription exists
  (or subscription has zero categories).
- **Per-topic switches** below, once on: same toggle logic as today. Turning
  the last one off unsubscribes fully (existing behavior).
- **Copy per role.** Producer keeps existing labels. Artist sees the same 6
  categories reworded: Sessions (booking), Payments (payment), Song updates
  (song_status), Comments (comment), Project updates (project_status),
  Purchase steps (purchase_status). Copy map lives next to
  `PUSH_CATEGORY_COPY` in `categories.ts`. No schema change.
- **iPhone Safari state.** If iPhone-like UA and not standalone display: show
  install-first message + button opening the install guide
  (`requestInstallGuidance()`); hide toggles.
- Mount in artist Settings page; keep producer mount. Update the two tests
  asserting artists must NOT have the card (they encode the old decision).

### 2. Smart-moment banners

New small component `PushMomentBanner` (shared, role-agnostic):

- Rendered inline at: artist booking success screen, artist payment-proof
  success state, producer onboarding final step.
- Visible only when: push supported + configured, permission not denied, no
  active subscription, not dismissed in the last 90 days, and (on iPhone
  Safari) swaps to the install-guidance variant.
- One tap = same master-enable path as the Settings button (all categories).
- Dismiss stores a localStorage marker
  (`skitza.push-invite.dismissed-at`, same parsing rules as install guidance).

### 3. Production enablement

- Generate a fresh VAPID key pair; add `WEB_PUSH_VAPID_SUBJECT`
  (`mailto:notifications@skitza.app`), `WEB_PUSH_VAPID_PUBLIC_KEY`,
  `WEB_PUSH_VAPID_PRIVATE_KEY` to Vercel **Production** as Sensitive. Never
  print the values.
- Bump `SW_VERSION` in `apps/web/public/sw.js` so installed apps take the
  update.

## Error handling

- Permission denied → inline message "Allow notifications in your browser to
  turn this on." (exists).
- Not configured (keys missing) → card says "not available yet" (exists);
  banners simply don't render.
- Subscribe/save failures → existing rollback (unsubscribe the created browser
  subscription) and error copy.

## Testing

- Unit: master-enable saves all categories in one `subscribe` call; artist
  copy map covers all 6 categories; banner visibility rules (supported /
  configured / permission / dismissal / standalone / iPhone) as pure logic.
- Structure tests: artist settings **contains** the card (flip the two old
  assertions); producer settings unchanged.
- Full gate: `$skitza-verify` before PR.

## Out of scope

In-app inbox/bell, quiet hours, per-client muting, notification history,
payload copy changes (generic titles stay — they are privacy-safe by design).
