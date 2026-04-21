# Skitza Artist App — Design

**Feature:** The signed-in client surface that ties together booking, payments, music review, and contracts into one Spotify-fast 4-tab app. Replaces today's fragmented magic-link surfaces with a unified "this is your music studio inbox" experience.

**Why now:** Without it, manual QA of every payment / contract / mix flow requires the producer to manually create magic links and impersonate clients. With it, end-to-end testing becomes a single sign-in. Also activates the network effect: one artist working with N producers = N producers exposed to the app.

---

## Goals

1. **Single signed-in surface for clients** — every interaction (book, pay, listen, sign, comment) happens inside one app, no email-link hunting.
2. **Multi-producer support from day 1** — when an artist works with 2+ producers, all studios appear in a Studio Switcher in the header.
3. **Magic links keep working** — drive-by clients (one-off sessions, no app install) lose nothing. Soft prompts gently convert them.
4. **Auto-flow over navigation** — every screen ends with one obvious next CTA. The artist rarely has to "find" anything.
5. **Persistent mini-player across tabs** — like Spotify; never have to relaunch a track because you switched tabs.

## Non-goals (this build)

- iOS/Android native apps — web-first, PWA installable. Tauri Mac shell already exists; iOS/Android wrap is Phase 3.
- Push notifications via APNs/FCM — email + in-app only for now.
- Cross-studio analytics ("you've spent $15K across 3 studios") — requires upgrading from Option A's "stamp" model to a global Artists table. YAGNI.
- Producer-as-client flow — a producer who's also a client of another producer. The data model supports it (one Clerk user can have both `producers` and `clientContacts` rows), but the UX of "switch between producer dashboard and artist app" is deferred.
- Editing tags/notes about producers — those are producer-private fields.

---

## Key design decisions (confirmed)

| Question | Answer |
|---|---|
| Same Clerk instance for producers + artists? | **Same.** Role derived from DB lookup post-login. |
| How does artist identity span producers? | **Stamp `clerkUserId` on existing `clientContacts` rows on first sign-in.** Match by `emailHash`. Magic-link flow unaffected for non-signed-in clients. |
| What happens when an artist clicks an old magic link? | **Hybrid.** Token-based access loads instantly (current behavior). Soft banner: "Sign in to see all your studios." Conversion is opt-in. |

## Auto-flow defaults baked in (not asked)

- 4-tab bottom nav (Spotify-style): **Home / Music / Book / Store**
- Persistent mini-player at the bottom across all 4 tabs
- Header avatar = Studio Switcher (only renders when artist has 2+ studios)
- Inline CTAs over menu navigation ("Book your next session" button on Home, not "Tap Book tab")
- First-touch flow: single Google sign-in → land on most relevant screen (active project's Home, or "Browse portfolio" if brand new)
- Mobile-first responsive web (PWA), runs inside existing Tauri Mac shell

---

## Data model

### `clientContacts` — add 1 column + 1 index

```ts
clerkUserId: text("clerk_user_id"),  // null until first sign-in stamps it
// + index on (clerkUserId) for "fetch all studios for this signed-in artist"
```

Migration `0024_client_contacts_clerk_user.sql`:
```sql
ALTER TABLE "client_contacts" ADD COLUMN IF NOT EXISTS "clerk_user_id" text;
CREATE INDEX IF NOT EXISTS "client_contacts_clerk_user_idx"
  ON "client_contacts" ("clerk_user_id")
  WHERE "clerk_user_id" IS NOT NULL;
```

Backfill on next deploy: triggered lazily on each artist's first sign-in (no batch job needed).

### Stamp logic

Webhook handler on `user.created` from Clerk:
- Compute `emailHash = sha256(user.primary_email_address.toLowerCase())`
- Find all `clientContacts` rows matching `emailHash`
- `UPDATE client_contacts SET clerk_user_id = <user.id> WHERE email_hash = <hash> AND clerk_user_id IS NULL`
- New `clientContacts` rows created later automatically pick up the stamp via `client-contacts.upsert()` mutation (also matches by emailHash, sets clerkUserId if user is signed in OR if any prior row has the stamp)

### No new global `artists` table

We resisted creating one. If we later need cross-studio analytics, profile photos, or preferences, we add it then. For now, `clerkUserId` on `clientContacts` is enough to query "all studios for this artist."

---

## Auth + role detection

**Clerk middleware** (existing) already protects `/dashboard/*`, `/settings/*`, `/onboarding/*`, `/projects/*`. We extend it to also protect `/artist/*` (the new artist app surface).

**Role detection** runs server-side in `/artist/layout.tsx`:

```ts
const { userId } = await auth();
if (!userId) redirect("/sign-in?redirect_url=/artist");

// Look up: are they a producer? An artist? Both? Neither?
const isProducer = await db.select({...}).from(producers).where(eq(producers.clerkUserId, userId)).limit(1);
const studioCount = await db.select({...}).from(clientContacts).where(eq(clientContacts.clerkUserId, userId)).limit(1);

if (!isProducer && studioCount === 0) {
  // Brand new sign-in with no producer relationships yet
  redirect("/artist/welcome");
}
// otherwise render the artist app shell
```

**Producer-as-client edge case** (deferred): if `isProducer && studioCount > 0`, we render the artist app but show a small "← Studio dashboard" link in the header to bounce back. No fancy "role switcher" UI for now.

**Sign-in URL** stays unified: `/sign-in?redirect_url=/artist` for artists, `/sign-in?redirect_url=/dashboard` for producers. Clerk handles both with one config.

---

## Routing structure

```
/artist                    → Home tab (server component, redirects per role detection)
/artist/music              → Music tab (list of all songs across all studios)
/artist/music/[trackId]    → Now Playing screen with timestamped comments
/artist/book               → Book tab (Studio Switcher → weekly grid)
/artist/store              → Store tab (browse services from current/all studios)
/artist/store/[productId]  → Product detail + plan picker (reuses existing Task 5 component)
/artist/settings           → Bare-min: payment methods (Stripe Customer Portal), sign out
/artist/welcome            → First-time onboarding (no studios yet) — explains how to get invited

# Existing magic-link surfaces stay untouched, with a soft sign-in banner added:
/share/[token]             → Magic-link project room (banner: "Sign in to see all your studios")
/sign/[token]              → Contract signing (no banner — too disruptive mid-flow)
/p/[slug]/book             → Public booking (banner if signed-in artist accidentally lands here)
```

---

## Component hierarchy

```
<ArtistAppShell>                          # /artist/layout.tsx — Server Component
  <Header>
    <StudioSwitcher />                    # only renders if studios.length > 1
    <ProducerLink />                      # only if also a producer
    <UserMenu />                          # avatar dropdown: settings, sign out
  </Header>
  <main>{children}</main>                 # the active tab
  <PersistentMiniPlayer />                # client component, sticky bottom
  <BottomNav />                           # 4 tabs: Home / Music / Book / Store
</ArtistAppShell>
```

### Persistent mini-player state

Lives in **a React Context** at the layout level (`ArtistAudioContext`). State:

```ts
{
  currentTrack: { id, url, title, producerName, artworkUrl } | null,
  isPlaying: boolean,
  position: number,        // seconds
  duration: number,
  queue: Track[],          // optional — for "play all from this project"
  pendingComment: { time: number } | null,  // when user hits Comment, pause + remember timestamp
}
```

Tab navigation does NOT remount the audio element. The `<audio>` lives in the persistent mini-player; tab routes just update what's *displayed*. Spotify-style.

### StudioSwitcher

```tsx
<StudioSwitcher
  studios={[{producerId, name, logoUrl}, ...]}
  current={producerId}
  onChange={(producerId) => router.push(`/artist?studio=${producerId}`)}
/>
```

Server-resolved on each navigation via search params; no client-side state. Studios load from `client_contacts WHERE clerk_user_id = userId`.

When `studios.length === 1`, the switcher renders as a non-interactive logo (no dropdown chevron).

---

## The 4 tabs — what each shows

### 🏠 Home

Compact Spotify-style screen:
- "Hey {firstName}" greeting
- **Next session card**: date, time, location, Waze deep-link. Empty state: "Book your next session" CTA.
- **Latest mix card**: most recent track upload across all studios. Tap → opens in mini-player + lands on Now Playing.
- **Outstanding payment card** (only if balance > 0): "₪2,500 due May 18 — Card ending 4242 will be charged automatically." Sets the "no admin work" tone.
- **Recent activity feed**: "Gili uploaded V2 of 'Summer Song'", "Yossi confirmed your session for Tuesday."

NO menus. Three cards + a feed. Each card has one action.

### 🎵 Music

Samply-style:
- Top-level: list of projects (cards with auto-generated AI artwork or fallback icon, project title, producer name)
- Tap project → list of tracks
- Tap track → Now Playing screen with waveform, comments, version switcher (V1/V2/Master)
- Comment button: pauses player, opens text input, ties comment to current timestamp (already built in Task 6)

The `producerId` filter is implicit via the Studio Switcher selection. "All studios" mode shows mixed feed sorted by upload time desc.

### 🗓️ Book

Weekly horizontal-scroll calendar (Google Calendar mobile-style):
- Pre-selected studio = current Studio Switcher selection (multi-studio artists pick which studio to book at)
- For each day: Morning Session card / Evening Session card (the block-based UI we discussed)
- Tap a block → bottom sheet with start times → confirm
- **Smart Project Association**: if artist has an active paid project with this studio, the booking is free (Parent Order logic from auto-installments). Banner: "On the house — included in your Summer Single project."
- If no active project: tap defaults to "I'd like to start a new project" → routes to Store tab to pick a service first

### 🛍️ Store

Browse services across studios:
- Default view: services from current Studio Switcher selection
- Toggle "All studios" to compare prices across producers (network-effect surface — discoverability for other producers' services)
- Tap product → Product Detail
- Product Detail = the existing plan picker we built in Task 5, just embedded inside the artist app shell instead of `/p/[slug]/book`
- After purchase → standard Stripe Checkout flow → success → project lands in artist's Home

### Settings (not a tab — accessed via avatar menu)

- Saved payment methods (deep-link to Stripe Customer Portal — already built in Task 10)
- Sign out

That's it. No theme picker, no notification preferences, no profile edit (name/email come from Clerk, not editable in-app).

---

## Magic-link soft conversion

On `/share/[token]` (existing magic-link project room):
- Detect: is the visitor signed in via Clerk?
- If signed in AND their `clerkUserId` matches `clientContacts.clerkUserId` for the project's producer → render with a "View in app" button that deep-links to `/artist/music/[trackId]?studio=<producerId>`
- If not signed in → soft banner at top: "Sign in to see all your studios" + Continue with Google button
- The token-based access still works for everyone — the banner is additive

On `/sign/[token]` (contract signing):
- No banner. Mid-flow distraction is harmful. After signing, the success page offers "Save your studios — sign in with Google" CTA.

---

## First-touch flow (artist's first interaction)

The "one link" promise from the Gemini conversation:

1. Producer drops link in Instagram DM: `https://skitza.app/p/giasraf/book`
2. Anonymous visitor lands on producer's portfolio + book page (current behavior)
3. Visitor goes through booking → contract → checkout (current behavior, post-Stripe-Connect-fix)
4. Stripe checkout completes → redirects to success page
5. Success page now offers: "Sign in to track this project + book future sessions" → Google sign-in
6. After sign-in → redirects to `/artist?welcome=1`
7. Welcome modal: "Welcome to Skitza. You're now connected to {producerName}'s studio. Tap Music to listen, Book to schedule your next session, Store to browse more services."
8. Modal closes → lands on Home with the new active project as the centerpiece

Subsequent sessions:
1. Tap installed app icon (or visit `app.skitza.com` PWA)
2. If signed in → straight to `/artist` Home
3. If signed out → `/sign-in?redirect_url=/artist`

---

## Webhook + state changes

Add Clerk webhook handler at `/api/webhooks/clerk` (probably already exists for producer signup) — extend to handle artist case:

```ts
case "user.created": {
  const email = data.email_addresses[0]?.email_address;
  if (!email) break;
  const emailHash = sha256(email.toLowerCase());

  // Stamp existing client_contacts rows with this user's clerkUserId
  await db.update(clientContacts)
    .set({ clerkUserId: data.id })
    .where(and(
      eq(clientContacts.emailHash, emailHash),
      isNull(clientContacts.clerkUserId),
    ));
  break;
}
```

This single SQL UPDATE is the "stamp on first sign-in" mechanism. Idempotent — re-running for the same user is a no-op (the `IS NULL` predicate skips already-stamped rows).

---

## Tech stack (mostly reused)

| Concern | Choice | Notes |
|---|---|---|
| Auth | Clerk (existing) | One instance, role detection in DB |
| UI | Next.js 15 App Router (existing) | New `/artist/*` route group |
| Styling | Tailwind v4 + CSS vars (existing) | Reuses `--brand-primary`, `--bg-elevated`, etc |
| State | React Context for mini-player | Server components for everything else |
| Audio | wavesurfer.js v7 (existing) | Mini-player wraps a singleton instance |
| DB | Drizzle + Neon (existing) | Migration 0024 adds `clerkUserId` |
| Realtime updates | Polling for now (every 30s on Home) | Liveblocks WebSocket later |

No new dependencies.

---

## Out of scope (explicit)

- Native iOS/Android apps (Tauri Mac stays; mobile = PWA)
- Push notifications via APNs/FCM
- Cross-studio analytics ("you've spent X across N studios")
- Editing global artist profile (name, photo) — Clerk owns these
- "Reply to producer" chat surface (booking + comments are the only artist→producer channels)
- Apple Pay / Google Pay UI for one-tap re-purchase (deferred — Stripe handles it inside Checkout)
- Offline mode (PWA cache only the shell, not data)

## Estimated effort

Same scale as the auto-installments build: 12-15 TDD tasks, ~4-5 days focused work via subagent-driven-development.

Critical path:
1. Migration 0024 + Clerk webhook handler (Task 1-2)
2. `/artist` shell + role detection + StudioSwitcher (Task 3-4)
3. Persistent mini-player + ArtistAudioContext (Task 5)
4. Home tab (Task 6)
5. Music tab + Now Playing (Task 7-8)
6. Book tab — block-based weekly calendar (Task 9-10)
7. Store tab — embedded plan picker (Task 11)
8. Soft sign-in banner on magic-link surfaces (Task 12)
9. First-touch welcome flow (Task 13)
10. Edit-products UI bug fix from earlier (Task 14 — small cleanup)
11. Manual QA + production rollout (Task 15)
