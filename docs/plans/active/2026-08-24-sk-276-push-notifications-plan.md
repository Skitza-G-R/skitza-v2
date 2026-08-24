# SK-276 Push Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Producers and artists can enable push notifications with one tap (plus per-topic fine-tuning), invited at smart moments, working on iPhone via the installed PWA — and actually live on skitza.app.

**Architecture:** Reuse the complete SK-107 push pipeline (service worker, VAPID config, subscription store, per-category delivery). Add: role-aware copy, a shared one-tap enable helper, a master button in the settings card, an artist mount, a small invite banner on three surfaces, an iPhone-Safari install swap, an SW_VERSION bump, and production VAPID keys.

**Tech Stack:** Next.js 15 App Router, React 19, tRPC v11 server actions, Vitest, existing `web-push` + service worker.

**Verification gate:** from `apps/web`: `pnpm typecheck && pnpm lint && pnpm test`; then `pnpm typecheck` in `packages/db`. Commit per task with explicit file lists (repo hook formats only touched files now, but stay explicit).

---

### Task 1: Artist copy map (`categories.ts`)

**Files:**
- Modify: `apps/web/src/lib/push/categories.ts`
- Test: `apps/web/src/lib/push/__tests__/categories.test.ts` (new)

Add after `PUSH_CATEGORY_COPY`:

```ts
export type PushCopyRole = "producer" | "artist";

/** Same six categories, reworded from the artist's point of view. */
export const ARTIST_PUSH_CATEGORY_COPY: Readonly<
  Record<PushCategory, { label: string; description: string }>
> = {
  booking: {
    label: "Sessions",
    description: "Your session is confirmed, changed, or cancelled.",
  },
  payment: {
    label: "Payments",
    description: "Payment reminders and confirmations from your producer.",
  },
  comment: {
    label: "Comments",
    description: "Replies and feedback on your songs.",
  },
  project_status: {
    label: "Project updates",
    description: "Important changes to your project.",
  },
  song_status: {
    label: "Song updates",
    description: "A new version is ready to hear or approve.",
  },
  purchase_status: {
    label: "Purchase steps",
    description: "Agreements, approvals, and purchase changes.",
  },
};

export function pushCategoryCopyForRole(role: PushCopyRole) {
  return role === "artist" ? ARTIST_PUSH_CATEGORY_COPY : PUSH_CATEGORY_COPY;
}
```

Test: every `PUSH_CATEGORIES` key exists in both maps with non-empty label + description; `pushCategoryCopyForRole("artist").booking.label === "Sessions"`; producer map unchanged (`Bookings`). Run `pnpm test categories` (fail first — file missing), implement, pass, commit.

### Task 2: Invite eligibility + dismissal marker (`lib/push/invite.ts`)

**Files:**
- Create: `apps/web/src/lib/push/invite.ts`
- Test: `apps/web/src/lib/push/__tests__/invite.test.ts` (new)

Pure logic, mirroring install-guidance parsing discipline:

```ts
export const PUSH_INVITE_DISMISS_MS = 90 * 24 * 60 * 60 * 1000;
const DISMISSED_STORAGE_KEY = "skitza:push-invite-dismissed:v1";

export function parsePushInviteDismissedAt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function pushInviteEligible(input: Readonly<{
  supported: boolean;        // serviceWorker + PushManager + Notification in scope
  permission: NotificationPermission;
  subscribed: boolean;       // an active browser subscription exists
  dismissedAt: number | null;
  now: number;
}>): boolean {
  if (!input.supported || input.subscribed) return false;
  if (input.permission === "denied") return false;
  if (input.dismissedAt !== null && Number.isFinite(input.dismissedAt)
      && input.now - input.dismissedAt < PUSH_INVITE_DISMISS_MS) return false;
  return true;
}

export function readPushInviteDismissedAt(): number | null { /* localStorage read, try/catch */ }
export function dismissPushInvite(now = Date.now()): void { /* localStorage write, try/catch */ }
```

Tests: eligible happy path; blocked by unsupported / subscribed / denied / fresh dismissal; 90-day expiry re-allows; garbage marker parses to null. TDD, commit.

### Task 3: Shared one-tap enable helper (`lib/push/enable.ts`)

**Files:**
- Create: `apps/web/src/lib/push/enable.ts`
- Test: `apps/web/src/lib/push/__tests__/enable.test.ts` (new)

`enableAllPushCategories` runs the exact flow the per-topic toggle uses, but saves **all** categories, with the same account-boundary guards and created-subscription rollback (adapter-injected for tests):

```ts
export type EnableAllResult =
  | { ok: true; categories: PushCategory[] }
  | { ok: false; reason: "permission" | "boundary" | "error"; message: string };
```

Flow: capture boundary generation → `Notification.requestPermission()` if `default` → bail `permission` unless granted → `serviceWorker.ready` → existing subscription or `pushManager.subscribe({userVisibleOnly, applicationServerKey})` → `runTrackedPushSubscriptionWrite(savePushSubscriptionAction(all six))` → `resumeBrowserPushDelivery` → success. Any boundary flip or failure unsubscribes a subscription it created. Reuse `applicationServerKey()` — move that base64url helper from `push-preferences.tsx` into this file and import it back (DRY).

Tests with fake adapter: saves all 6 categories in one call; permission denied → `{reason:"permission"}`; save failure rolls back created subscription; boundary flip mid-flight → rollback + `{reason:"boundary"}`.

### Task 4: Settings card — role prop, master button, iPhone swap

**Files:**
- Modify: `apps/web/src/components/push/push-preferences.tsx`
- Modify tests: `apps/web/src/components/push/__tests__/push-preferences.test.ts`

1. `export function PushPreferences({ role = "producer" }: { role?: PushCopyRole })`; replace direct `PUSH_CATEGORY_COPY` with `pushCategoryCopyForRole(role)`; artist subtitle: "Choose real updates from your studio. Everything starts off."
2. **Master button** rendered between header and the switch list only when `!loading && browser.configured && categories.length === 0`: full-width primary button "Turn on notifications" → `enableAllPushCategories({ publicKey })` → on success `setBrowser`/`setCategories`; on `permission` show the existing inline error copy. Disabled while `pending`. Height ≥44px → `rounded-[var(--radius-lg)]`, `bg-[rgb(var(--brand-primary))]`, never `rounded-full`.
3. **iPhone Safari swap**: in the unsupported branch of `load()`, when `isAppleMobileDevice({userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints})` and `!isStandaloneDisplay()`, set a new `installRequired` state instead of the generic error. Render: short line "On iPhone, notifications need the installed app. Add Skitza to your Home Screen first." + secondary button "Show me how" → `requestInstallGuidance()`. Hide the switch list in that state.

Update the source-assertion test: master button present (`Turn on notifications`, `enableAllPushCategories`), iPhone swap present (`requestInstallGuidance`), role copy via `pushCategoryCopyForRole`. Run push tests, commit.

### Task 5: Artist mount + flip the two negative tests

**Files:**
- Modify: `apps/web/src/components/artist/settings/artist-settings-client.tsx` (notifications section, above the in-app/email grid: `<PushPreferences role="artist" />` + import)
- Modify: `apps/web/src/components/push/__tests__/push-preferences.test.ts` (assert artist client **contains** `<PushPreferences role="artist"`; drop the three `not.toContain` push lines; keep `Notification.requestPermission` out of the artist client itself)
- Modify: `apps/web/src/components/artist/__tests__/artist-platform-foundations.test.ts` (flip "does not expose" → asserts the artist settings client renders the push card)

Producer mount stays `<PushPreferences />` (default role). Run both test files, commit.

### Task 6: `PushMomentBanner` + three mounts

**Files:**
- Create: `apps/web/src/components/push/push-moment-banner.tsx`
- Test: `apps/web/src/components/push/__tests__/push-moment-banner.test.ts` (new, source-assertion style like siblings)
- Modify: `apps/web/src/components/artist/sessions/my-sessions-screen.tsx` (directly under `<ConfirmationHero>` when `justBooked`)
- Modify: `apps/web/src/components/artist/purchase/proof-record-screen.tsx` (below the proof status header)
- Modify: `apps/web/src/app/(onboarding)/onboarding/complete/complete-screen-client.tsx` (below the main actions)

Client component, props `{ role, message }` (e.g. "Get an alert the moment it's confirmed."). Mount flow:
1. Local checks (`pushInviteEligible` with supported/permission/dismissedAt; subscription looked up via `getRegistration()`); on iPhone Safari not-standalone, switch to install variant text + "Show me how".
2. Only if locally eligible: one `getPushStatusAction(null)` → require `configured`; if the account already has categories on this device… (endpoint null returns account-level state; keep it simple: any failure or `!configured` → render nothing).
3. Render: compact card (`--bg-elevated`, `--radius-lg`, BellRing icon), message, primary "Turn on" → `enableAllPushCategories`; success swaps card content to "You're set ✓" then hides; "Not now" → `dismissPushInvite()` + hide.
Never blocks its host screen: all failures render nothing.

Mount sites pass role + moment copy: sessions "Get an alert the moment your session is confirmed." / proof "Get an alert when your payment is confirmed." / onboarding "Get an alert when clients book, pay, or comment." Run tests, commit.

### Task 7: SW_VERSION bump

**Files:** Modify: `apps/web/public/sw.js` line 20 → `const SW_VERSION = "2026-08-24-sk276-1";`
Commit.

### Task 8: Full verification gate

Run from `apps/web`: `pnpm typecheck`, `pnpm lint`, `pnpm test`; then `pnpm typecheck` in `packages/db`. All green before PR; report exact failing command otherwise.

### Task 9: Production VAPID keys (no values printed, ever)

```bash
cd apps/web && node -e "const wp=require('web-push');const k=wp.generateVAPIDKeys();require('fs').writeFileSync('/tmp/…/vapid.json',JSON.stringify(k))"
printf 'mailto:notifications@skitza.app' | npx vercel env add WEB_PUSH_VAPID_SUBJECT production --sensitive
node -e "…publicKey…" | npx vercel env add WEB_PUSH_VAPID_PUBLIC_KEY production --sensitive
node -e "…privateKey…" | npx vercel env add WEB_PUSH_VAPID_PRIVATE_KEY production --sensitive
rm the temp file; verify names appear via `vercel env ls production | grep -c WEB_PUSH` (expect 3)
```

Keys take effect on the next production deployment (the SK-276 promote).

### Task 10: PR

`gh pr create --base v3-clean` — title `SK-276: One-tap push notifications for producers and artists`. Body: design summary, verification results, note that keys are already staged in Production env and activate on promote. Ask Gili before merging. Never promote without her go.
