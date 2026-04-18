# Skitza Phase G — Morning Delta

> GM. Here's what shipped while you slept.
> Branch: `feat/phase-g` (off main). 15 commits. 182 tests. Ready to merge.

---

## Your feedback, addressed point-by-point

> **"all the uploads doesn't work"**

Root cause was CORS on your R2 buckets. You should've applied this on both `skitza-audio` and `skitza-docs` before sleeping:

```json
[{
  "AllowedOrigins": ["https://skitza-v2-web.vercel.app", "http://localhost:3000"],
  "AllowedMethods": ["GET", "PUT", "HEAD", "POST"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3600
}]
```

**If you didn't** — apply it now at Cloudflare → R2 → each bucket → Settings → CORS Policy. No code change, no redeploy. Uploads will work instantly.

> **"everything is super slow"**

Fixed. Massive perf wins via **G.1** (lazy-load cmdk + react-pdf + prefetch + AppShell cache dedup):

| Route | Before | After | Δ |
|---|---|---|---|
| `/dashboard/contracts/[id]` | 307 kB | **164 kB** | −47% |
| `/sign/[token]` | 251 kB | **121 kB** | −52% |
| `/dashboard` | 184 kB | **172 kB** | −15 kB |
| All other dashboard pages | 172–173 kB | **157–160 kB** | −15 kB each |

cmdk moved off the AppShell bundle — fetched on first ⌘K press. react-pdf split into dynamic chunks — fetched only on contract editor + signer routes. Added `loading.tsx` stubs so heavy routes show an instant spinner instead of white flash.

> **"the UI is not good ... I want a CRM vibe ... super easy to use"**

New at **`/dashboard/clients`** — **G.2**:
- Every client you've ever interacted with (auto-populated from bookings + contracts) OR add them manually
- Filter: All / Active / Recent
- Per row: name, email, active deals, total deals, last activity
- One-click **magic link send** (auto-copies to clipboard + fallback banner) → Booking or Portfolio target
- Click into a client → timeline of every session, contract, comment, file — chronological
- Full CRUD: add / edit / delete (with clear warning that their deals stay)
- Mobile: floating "+" FAB, bottom-sheet for forms, 44px tap targets everywhere
- `c` shortcut on `/dashboard/clients` opens the New Client sheet
- ⌘K palette returns clients + tracks results too

Empty-state explains itself: "Skitza auto-adds clients when they book or sign — or you can add one now."

> **"a Samply.app vibe ... a screen with the songs, where I can comment on them"**

New at **`/dashboard/library`** — **G.3**:
- **Persistent bottom player** — like Spotify's mini-player. Survives navigation across every dashboard page.
- Every track version across every deal in one list, newest first
- Filter: All / Unread (has unresolved comments) / Resolved
- Click play → player dock appears at bottom, audio plays
- Click "Open" on a row → side panel (desktop) or full-screen modal (mobile) with waveform + timestamp comments
- Click a comment's timestamp → player scrubs to that exact moment
- Add comment at current playhead in one tap — timestamp snapshotted live
- Player bus via custom events — no prop drilling, clean separation

> **"the booking page is not flexible enough"**

**G.4 Booking v2** closes these PRD/Calendly gaps:
- **Kind classification** on packages — Session / Mixing / Mastering / Producing / Other (auto-grouped on public page when ≥2 kinds)
- **Location type** per package — Studio / Remote / Client space (shown as pill to visitors)
- **Buffer minutes** between sessions — prevents back-to-back
- **Per-package min-lead** (was hardcoded 12hr, now configurable)
- **Blackout dates** — new `availability_blackouts` table + UI to block date ranges (travel, holidays, studio closures). Server-side slot exclusion + visitor submit rejection.
- **Session-pack pricing** — existing `sessionCount > 1` surfaces as "3-pack" / "10-pack" on public cards
- **Package description** — short sell-copy on public page
- New blackouts form uses native `type="date"` → OS-native calendar sheet on iOS/Android

Deferred (too big for one night): travel-time rules, Stripe payment plans, full recurring series.

> **"it's not intuitive enough"**

**G.5 Onboarding wizard** at `/dashboard/onboarding`:
- 4 steps with progress dots · skippable at any time:
  1. Identity: display name + slug (`/p/YOURSLUG`)
  2. First package: name / duration / price / deposit %
  3. Weekly hours: preset "Mon-Fri 10-6" OR per-day customization
  4. Share: your bookable URL + QR code + copy button

First-time producers get redirected here automatically. Skippers get a "Finish setup in 2 min" banner until done.

**G.6 Upcoming-sessions strip** at top of `/dashboard`:
- Horizontal strip of next 7 days with confirmed sessions per day
- Mobile: snap-scrolling day cards
- Tap a day → expands with full session list
- Empty state: "No sessions. Copy your bookable link" with one-click copy

**G.7 Revenue tile** next to the calendar:
- MTD · Outstanding · Next 7 days (tabular-nums, currency symbol)
- Hint: "Connect Stripe in Settings to track real payments"

**G.8 Empty-state education sweep** — every list page now has a 1-sentence explainer of what the feature IS (not just "nothing here"), plus an obvious CTA. Icons added to match sidebar glyphs. 60vh min-height gives breathing room.

---

## What else shipped (pro-producer adds)

**G.10 Portfolio URL paste** — alternative to R2 upload:
- Paste a Spotify / SoundCloud / YouTube / Apple Music URL
- Auto-detects source, shows "♪ Spotify · ready" confirmation
- Public portfolio renders the matching embed (Spotify 152px, YouTube 352px, etc.)
- 8 parser tests covering edge cases (malformed IDs, intl locales, empty URLs)
- Segmented control `[Upload audio] [Paste a link]` — mobile-friendly

**G.11 Stems-requested automation**:
- New **Approve** button on track versions in the deal detail
- On approve → auto-creates a notification: "Version approved — send stems?"
- Notification links back to the deal's Audio tab with the approved version highlighted
- Schema: new `approvedAt` column on `trackVersions` (migration 0013)

---

## What's in the box (full commit list on `feat/phase-g`)

```
beb2b86 feat(ui): empty-state education sweep across dashboard lists
1cb1b4f feat(dashboard): upcoming-sessions strip + revenue tile
484b04f feat(deals): approveVersion + stems-requested notification + UI prompt
892438e feat(portfolio): Spotify/SoundCloud/YouTube/Apple URL as alternative to audio upload
d76aba3 feat(onboarding): 4-step first-run wizard
a3a1abb feat(ui): sidebar + shortcut remaps + palette tracks group
3bf79f0 feat(library): list page + side panel + comment form
318f497 feat(library): router + persistent player
9d12868 feat(ui): booking v2 — packages with kind/location/buffer, blackout management
ecf2091 feat(trpc): booking router — blackouts, buffers, lead time, location
175b545 feat(db): booking v2 columns + blackouts table
dabedad feat(clients): timeline detail page
0d7bb25 feat(clients): list page + add/edit/delete + send magic link
15bf4e8 feat(clients): CRUD + enriched list procedures
4926bfe perf: lazy-load cmdk + react-pdf, dedup AppShell fetches, route loading states
```

---

## Your playbook to deploy (~10 min)

### 1. Apply CORS on both R2 buckets (if you haven't)
→ See top of this doc. Applies instantly, no redeploy needed.

### 2. Merge the PR

```bash
gh pr create --base main --head feat/phase-g --title "feat: Phase G — perf, Clients CRM, Library (Samply vibe), Booking v2, onboarding, URL embeds, stems automation"
gh pr merge --merge
```

Or via UI: https://github.com/giasraf/skitza-v2/pull/new/feat/phase-g

### 3. Apply new migrations (0012 + 0013)

```bash
git checkout main && git pull
set -a && source apps/web/.env.local && set +a
corepack pnpm --filter @skitza/db db:migrate
```

Both migrations are **pure additive** — no drops, no data loss:
- `0012_silent_lunatics.sql` — 4 ALTER COLUMN on `packages` + CREATE `availability_blackouts` + 1 index
- `0013_tough_maria_hill.sql` — 1 ALTER COLUMN on `track_versions` (adds `approved_at`)

### 4. Vercel auto-deploys on merge. Done.

---

## Headline numbers

| | Before tonight | After |
|---|---|---|
| Routes emit | 30 | **36** |
| Tests | 148 | **182** (+34, +23%) |
| First Load on `/sign/[token]` | 251 kB | **121 kB** (-52%) |
| First Load on `/dashboard/contracts/[id]` | 307 kB | **164 kB** (-47%) |
| Dashboard-wide First Load | 172 kB | **157 kB** |
| Clients screen | ❌ | ✅ CRM with magic-link send |
| Audio library | ❌ | ✅ Samply-vibe with persistent player |
| Booking kinds (mixing / mastering / etc.) | 1 generic | **5+ with grouping** |
| Blackout dates | ❌ | ✅ |
| Onboarding first-run | confusing | ✅ 4-step wizard |
| Revenue visibility | ❌ | ✅ MTD / outstanding / next-7d |
| Portfolio URL embed | ❌ | ✅ Spotify / SC / YT / Apple |
| Stems automation | manual | ✅ auto-prompt on approve |
| Mobile polish | mixed | ✅ every new screen designed 375px-first |
| Idiot-proof copy | some | ✅ every empty state educates |

---

## Known follow-ups (queued, not blocking)

| Item | Why | Urgency |
|---|---|---|
| New-deal form reads `?email=&name=` prefill params | Deal detail "New deal with this client" CTA currently relies on autocomplete-as-you-type instead | low |
| `detectOnboardingState` could be smarter if producer has deals but no packages | Heuristic may misfire for producers seeding from CSV | low |
| Travel-time rules between booking venues | PRD scope, too big for one night | medium |
| Stripe payment plans (multiple milestones) | PRD scope, needs separate design pass | medium |
| Recurring session series | PRD scope | low |
| Dynamic Clerk `appearance.variables` on theme toggle | Currently static at mount | low |
| Apply dense-table utility to `/dashboard/deals/[id]` tab content | G.7 skipped — 1091-line file needed its own task | low |
| Revenue tile multi-currency handling | Filters to producer's default currency; multi-currency overview is Phase H | low |

---

## Do I ping you to run a smoke test?

I held back on merging automatically — figured you'd want to eyeball the PR before main goes out. Say **"merge and migrate"** and I'll:

1. `gh pr merge` the PR
2. Apply migrations 0012 + 0013 to your Neon prod DB
3. Wait for Vercel to redeploy (~2 min)
4. Probe the new routes (200s everywhere)
5. Report health + any 500s

Or if you want to review the PR first, the URL is ready (https://github.com/giasraf/skitza-v2/pull/new/feat/phase-g).

Sleep was productive. Let me know how you want to close this out.
