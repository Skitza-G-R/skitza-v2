# Skitza — Overnight Delta (2026-04-17)

> **TL;DR** — Three flagship features shipped to production since last check-in: **Booking v1** (Calendly reimagined for producers), **Project Rooms v1** (Samply reimagined), **Contracts v1** (PandaDoc reimagined). Plus the full Phase A rebrand + landing port that kicked off the night. 15 test files, 95 tests, all green. Production deploy verified.

---

## What's live in production

### 1. Phase A rebrand & landing page (ported from your `index.html`)

- **Palette flipped light**: warm cream `#F2EDE6` default with amber `#D4960A` + copper `#B06830` accents. `data-theme="chrome-dark"` re-opts public funnel into dark; `chrome-light` re-opts nested zones (legal) back.
- **Typography swap**: Syne (display) + Outfit (body), loaded via `next/font/google`. Clerk appearance themed to match.
- **Landing**: all 8 sections of your vision HTML ported — hero, producer console mock, audio collab card, lead links, booking, contracts, CRM, pulse-glow CTAs, waitlist email capture backed by a `waitlist` Drizzle table + `joinWaitlist` Server Action + 4 passing tests.
- **Brand mark**: inline SVG component; favicon + root OG image reskinned warm.

Commits: `53be063`, `6efd753`, `81794cc`, `9dec595`, `f14b33d`, `fbf99c2`, `52ce1cd`, `5f9bb4e`, `866b472`.

### 2. Booking v1 — Calendly for producers

- **Schema** (`packages/db/src/schema.ts`): `packages` (service catalog: durationMin, sessionCount, priceCents, depositPct), `availabilityBlocks` (weekday 0-6, startMin, endMin — weekly template), `bookings` (pending/confirmed/rejected/cancelled enum, `packageNameSnapshot` so price history doesn't rewrite old bookings).
- **Router** (`apps/web/src/server/trpc/routers/booking.ts`): packages CRUD, availability set/list, TZ-aware `computeSlots` in 15-min increments with 12-hour min-lead and overlap-check against pending + confirmed.
- **TZ correctness** (fix `4748cfc`): `wallClockInTzToUtc()` uses `Intl.DateTimeFormat` offset round-trip so "Monday 10:00 Berlin" becomes the right UTC instant across DST boundaries. Berlin producer no longer sees 12:00 slots for a 10:00 availability block.
- **Producer console** `/dashboard/booking`: 4 tabs — Packages, Availability (weekly grid editor), Requests (accept/reject), Upcoming.
- **Visitor flow** `/p/<slug>/book`: 3 steps with step indicator — pick package → pick slot (slots grouped by day) → enter details + submit request.

Commits: `e01c2e1`, `1682e2d`, `c7b1dc5`, `651f5bf`, `4748cfc`.

### 3. Project Rooms v1 — Samply for producers

- **Schema**: `projects` (optional `bookingId` FK — rooms exist standalone or post-booking), `projectTracks`, `trackVersions` (audioUrl, label, uploadedAt — A/B ready), `trackComments` (`timestampMs`, `resolvedAt`, `fromProducer` bool).
- **Share tokens**: each room gets an unguessable token. Raw returned once in a copy-banner; `sha256` hash stored on row. Same discipline as magic links.
- **Ownership traversal**: every producer-side mutation walks comment → version → track → project → producer to prove the row belongs to `ctx.producerId`. No orphan writes.
- **Artist-side** `/share/[token]`: audio player per version, version switcher, click-the-waveform-to-comment, download gate (first view requires name + email, cached locally).
- **Producer-side** `/dashboard/projects/[id]`: track list, version upload, comment thread with reply-at-timestamp from any point, resolve/unresolve.

Commits: `9106fde`, `8afc871`, `fa6b2fb`.

### 4. Contracts v1 — PandaDoc for producers

- **Schema**: `contractTemplates` (reusable body with `{{merge_fields}}`), `contracts` (status enum: `draft|sent|viewed|signed|cancelled|expired`, `bodyResolved` snapshot so later template edits can't rewrite a signed contract), `contractEvents` (immutable audit: created/sent/viewed/signed/downloaded/cancelled with `ipHash` + `userAgent`).
- **Router** (`contract.ts`):
  - `resolveMergeFields()` HTML-escapes every value before substitution — defensive against stray `<` / `>` in artist names.
  - `logEvent()` helper writes to `contractEvents` on every state transition.
  - `contract.send`: resolves merge fields against a selected booking + freeform extras, snapshots body, mints token, returns raw once.
  - `contract.publicByToken`: auto-advances `sent → viewed` on first open, logs viewed event with IP hash + UA. Idempotent — re-views don't double-log.
  - `contract.publicSign`: enforces typed-name match with `artistName` (case-insensitive), stores `signatureDataUrl`, `signedIpHash`, `signedUserAgent`, advances to `signed`. Rate-limited per token.
- **Producer console** `/dashboard/contracts`: three panels — Templates (with a preloaded Master Agreement default), Send (pick template + booking, add extras, send), List (status badges + cancel).
- **Artist signing** `/sign/[token]`:
  - Body renders markdown-ish via a tiny in-file renderer (no `react-markdown` dep — body is already HTML-escaped). Supports `# h1`, `## h2`, paragraphs, `**bold**`.
  - Canvas signature pad using **Pointer Events** (unified mouse/touch/stylus) with `touch-action: none` so drawing doesn't scroll-hijack on mobile. HiDPI-aware (devicePixelRatio scaling).
  - Typed-name confirm gates submit. Server re-validates — no client trust.

Commits: `c8ad581`, `f51dca7`.

---

## Verification

```
typecheck:  clean
lint:       clean
tests:      15 files, 95 passing
deploy:     live (skitza-v2-web.vercel.app)
route head: x-matched-path: /sign/[token] confirmed
```

### What to poke manually when you're back

1. **Booking** — open `/p/<your-slug>/book`, pick a package, pick a slot, submit. Flip to `/dashboard/booking` → Requests tab → accept. Confirmed booking appears in Upcoming.
2. **Project Rooms** — `/dashboard/projects` → create room → upload a track version → copy share link → open in incognito. Leave a comment at 1:23. Go back to producer view, resolve it.
3. **Contracts** — `/dashboard/contracts` → edit default template if you want → Send form: pick a booking, confirm merge fields, send → copy `/sign/<token>` link → open in incognito, sign with canvas + typed name. Come back to producer list: status shows **Signed**.

### Known rough edges (deferred, worth calling out)

- **No file upload for contract attachments** — v1 is markdown body only. PandaDoc-style PDF imports are Phase 2.
- **Signatures stored as data URL** — fine for v1 audit. Phase 2 should render PDF/A with embedded hash chain for true eIDAS AdES.
- **No email notifications yet** — producer + artist both need to manually share links. Resend integration queued.
- **Booking time-zone display** — UI shows times in producer's TZ. Visitor-side shows in producer's TZ with a label (correct but could auto-detect visitor TZ). Low-pri.
- **Project Rooms peaks** — waveform draws client-side on audio decode, no precomputed peaks JSON yet. Fine <50 MB, wobbles for 200 MB WAV. Trigger.dev worker pipeline is in the v1 plan.

---

## Night's commit count

21 commits since `67b4205` (`producerProcedure` extraction that started the night). Bitrate: ~1 feature per 4 hours across Booking + Rooms + Contracts + rebrand. Everything landed without rollback.

---

*Wake-up checklist: read this, poke the three flows above, tell me what feels off. Queue for today is whichever of these needs sharpening first.*
