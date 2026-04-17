# Skitza v2 — Design Document

> **Status**: Approved by user 2026-04-17. Implementation plan follows at `2026-04-17-skitza-v2-plan.md`.

## 1. Context & Root Cause

The user's five complaints after the overnight Booking + Rooms + Contracts v1 ship:

1. Audio is link-only, no real upload
2. "It feels like a website not like a software"
3. Contracts are markdown-with-merge-fields, not PDF-upload-and-place-fields (PandaDoc-grade)
4. UI feels cheap
5. The flow isn't clear — "supposed to be super easy for a producer to manage everything"

Root cause of all five: **features ship ahead of unified concept + software chrome**. The tables, routers, tokens, audits are solid. The *presentation* and one architectural pivot are missing.

## 2. Pivot: introduce the Deal object

Today the producer mentally stitches "the engagement with Maya" out of:
- A `booking` row
- A `contract` row
- A `project` row (project room)
- A future invoice

Pivot: **`projects` is renamed to `deals`**. Bookings, contracts, invoices all FK into a deal. The producer sees one record per client engagement. The visitor sees one magic URL whose content changes by deal state.

Deal detail URL: `/dashboard/deals/[id]` with tabs: Overview / Audio / Contract / Invoices / Activity.
Dashboard default: Kanban of deals by stage (Lead / Booked / Contract-sent / In-production / Final-review / Paid / Archived).

## 3. Order of Phases (feature-first per user decision)

| Phase | Scope | Days |
|---|---|---|
| **A** | Real audio uploads (R2 multipart + wavesurfer) | 3 |
| **B** | Contracts PDF editor (react-pdf + dnd-kit + pdf-lib) | 5–6 |
| **C** | Deal architecture (rename, unify, Kanban) | 3 |
| **D** | Software-feel chrome pass (Fraunces, palette, ⌘K, shortcuts, sidebar, dark) | 5 |
| **E** | Inbox + polish | 2 |
| **F** | Tauri desktop activation | 3 |

Total: ~21 days. Every phase ends with an **Idiot Proof QA** gate (see §7).

## 4. Phase A — Real Audio Uploads

**Goal**: replace text `audioUrl` inputs across portfolio tracks + project versions with real file uploads to R2.

**Stack**:
- `react-dropzone` — drag-drop + click-to-pick
- Cloudflare R2 multipart via presigned part URLs (pure JS, no tus dep)
- `wavesurfer.js` v7 + Regions plugin for playback/comments
- Resumable via localStorage (upload-id + part ETags)

**Schema**: no table rename. Add columns to `trackVersions` and `portfolioTracks`:
- `audioR2Key` text — the R2 object key
- `sizeBytes` bigint
- `durationMs` integer
- `peaksR2Key` text nullable — for Phase-2 server-computed peaks (client computes for Phase-A)

Keep `audioUrl` column but populate with R2 public URL (or signed URL later).

**Server (tRPC)**: add `audio.initMultipart`, `audio.signPart`, `audio.completeMultipart`, `audio.abortMultipart`. All `producerProcedure`. Secrets are R2 access/secret keys via env.

**Client**: `<AudioUploader>` component — dropzone, per-part progress, pause/resume, client-side waveform preview on decode.

**Acceptance**: upload a 250 MB WAV on 3G, watch progress, close tab at 40%, reopen, resume, complete. Waveform renders. Plays back in room.

## 5. Phase B — Contracts PDF Editor (PandaDoc-grade)

**Goal**: rip the markdown contract system. Replace with PDF-upload → drag-drop fields → send → sign → flattened PDF with audit cert + PKCS#7 seal.

**Stack**:
- `react-pdf` (wraps pdf.js) — renders pages in editor + signer viewer
- `dnd-kit` — drag/drop/resize on mobile-friendly pointer sensors
- `pdf-lib` — server-side flatten (Node + Workers-compatible)
- `@signpdf/signpdf` + `node-forge` — PKCS#7 envelope seal
- `react-signature-canvas` — signer signature capture
- `@react-pdf/renderer` — audit certificate page generation

**Reference**: Documenso (MIT) — read `packages/lib/server-only/pdf/` before implementing.

**Schema (hard-cut, drop old markdown tables)**:

```sql
DROP TABLE contract_events;
DROP TABLE contracts;
DROP TABLE contract_templates;

CREATE TABLE contracts (
  id, producer_id, deal_id (nullable FK), title,
  pdf_r2_key text not null,           -- original uploaded PDF
  final_pdf_r2_key text,              -- flattened+sealed PDF after completion
  status enum,                         -- draft | sent | viewed | signed | cancelled | expired
  share_token_hash text unique,
  sent_at timestamp, viewed_at timestamp, signed_at timestamp,
  created_at, updated_at
);

CREATE TABLE contract_recipients (
  id, contract_id, email, name, role, routing_order int,
  signing_token_hash text unique,
  viewed_at, signed_at, ip_hash, user_agent,
  created_at
);

CREATE TABLE contract_fields (
  id, contract_id,
  recipient_id (nullable — null = sender-prefilled),
  page int,
  x numeric(5,2), y numeric(5,2),    -- percent of page (top-left origin)
  w numeric(5,2), h numeric(5,2),
  type enum('signature','initial','date','text','checkbox','dropdown','number'),
  required bool,
  prefilled_value text,               -- sender-filled at template time
  signed_value text,                  -- signer-filled OR R2 key for signature image
  signed_at timestamp,
  options jsonb                       -- dropdown choices, validation regex, etc.
);

CREATE TABLE contract_events (
  id, contract_id, recipient_id (nullable),
  event enum('created','sent','viewed','field_filled','signed','completed','cancelled','downloaded'),
  ip_hash, user_agent, metadata jsonb,
  occurred_at
);
```

**Coord convention**: top-left origin, 0–100 floats. Pdf-lib uses bottom-left origin — transform at flatten time: `pdfY = pageHeight - (y/100 * pageHeight) - (h/100 * pageHeight)`.

**Editor UI** (`/dashboard/contracts/new`):
- 3-pane: left 240px field palette / center canvas (max 816px wide) / right 320px inspector
- Left palette: Signature, Initial, Date, Text, Checkbox, Dropdown
- Drag field onto page → resize with corner handle → click to open inspector
- Inspector: assignee (Sender | Artist | + new signer), required, default/prefilled value, type-specific options
- Autosave every 2s, "Saved · 2s ago" top-right

**Signer UI** (`/sign/[token]`):
- Full PDF renders at device width
- Only current signer's fields interactive; others appear as disabled outlines
- Signature field: `react-signature-canvas` modal, 44×44 min tap target enforced
- Progress bar top: "2 of 5 fields filled"
- Submit → server flattens, seals, advances status

**Server flow**:
1. `contract.uploadPdf` — client uploads to R2, server creates draft row
2. `contract.saveFields` — idempotent batch upsert on `contract_fields`
3. `contract.send` — generates `contract_recipients` rows, mints signing tokens, logs sent event, sends email (stubbed for now — logs URL)
4. `contract.publicByToken` — fetches contract + fields for this recipient, logs viewed event
5. `contract.publicFillField` — patches `signed_value`, logs `field_filled`
6. `contract.publicSign` — marks recipient signed; if all recipients signed, enqueues flatten job
7. Flatten job — loads original PDF, draws all fields' `signed_value`s at coords, appends audit cert, seals with PKCS#7, uploads final to R2, marks contract `completed`

**Mobile discipline**:
- `<meta viewport>` excludes user-scalable
- `touch-action: none` on signature canvas
- 44×44 minimum tap target via CSS `min()` scaling
- Field focus `scrollIntoView({block:'center'})`

**Hard-cut migration**: wipe current `contracts`, `contract_events`, `contract_templates` tables. Assumption: no signed contracts in production yet (user confirmed greenfield). If any exist, export list via `pg_dump` to a side table before drop.

## 6. Phase C — Deal Architecture

**Goal**: unify booking + contract + project-room under one "Deal" record per client engagement.

**Schema migrations**:
- Rename `projects` → `deals` (`ALTER TABLE projects RENAME TO deals;` + cascade to FKs)
- `bookings.deal_id` FK (nullable — existing bookings backfill as solo deals)
- `contracts.deal_id` FK (already planned in Phase B)
- Add `deals.stage` enum — lead, booked, contract_sent, in_production, final_review, paid, archived
- Add `deals.client_email`, `deals.client_name` — cached from the magic-link identity

**New routes**:
- `/dashboard/deals` — Kanban board of deals grouped by stage, drag to change stage
- `/dashboard/deals/[id]` — tabs Overview / Audio / Contract / Invoices / Activity
- Deprecate top-level `/dashboard/projects` (redirects to /deals)

**Artist identity cache**:
- New table `client_contacts(producerId, emailHash, name, email, firstSeenAt, lastSeenAt)`
- On any magic-link claim by email, upsert row
- Send forms pre-fill from this cache

**Deal magic URL** (Phase C.2 — nice-to-have, keep behind flag):
- One URL per deal resolves differently by state (book / sign / room / pay). Artist bookmarks forever.
- Implementation: `/d/[token]` looks up deal, renders the appropriate component for current stage.

## 7. Idiot Proof QA Protocol

Every phase ends with this checklist. **A phase only ships if every Core test passes.** Findings are committed alongside the code.

### How to run it
1. Open a fresh incognito window on **mobile viewport (375px wide)** *and* desktop
2. Pretend to know nothing about the app or the tech
3. Walk through the phase's core flow clicking only the obvious buttons
4. Record PASS / WARN / FAIL for each test
5. Any FAIL on a Core test = phase not done; fix and re-test
6. WARN = noted, fix queued but can ship
7. Commit findings into `docs/qa/YYYY-MM-DD-phase-<X>.md`

### Universal Core tests (every phase)
- **C1** Core flow completes on mobile in <60s without any help text
- **C2** Every primary CTA is the biggest/brightest thing on screen and does what you'd guess
- **C3** Every error state shows a plain-English explanation + one obvious recovery action (not "Error 500" / "Something went wrong")
- **C4** Every empty state shows one sentence + one CTA (never "No data.")
- **C5** Every loading state shows some visual ≥ 200ms after click (no dead click)
- **C6** Every success state shows confirmation you can't miss (not a gray toast in the corner)
- **C7** Refresh mid-flow doesn't lose state on the current screen
- **C8** All text is readable on cream+amber AND warm-dark (contrast audit)

### Phase-specific tests

**Phase A (Audio)**
- A1 Can upload a 50MB WAV by dropping into the page → progress visible → plays back within 5s after upload
- A2 Closing tab at 40% upload + reopening = resumes (not restarts)
- A3 Upload the wrong file type (jpg) → clear error, doesn't break page
- A4 Upload >500MB → clear error saying limit, not a 500
- A5 Waveform draws within 2s on a fresh upload
- A6 Click anywhere on waveform = playback jumps there

**Phase B (Contracts)**
- B1 Upload a PDF → first field is place-able in under 30s
- B2 Drag a signature field onto page, resize, save, refresh page → field still there in same spot
- B3 Send contract → copy link → open in incognito on phone → PDF renders readable → sign → success
- B4 Sign with finger on phone → signature doesn't scroll-hijack, tap target >= 44px
- B5 Complete the whole flow under 2 minutes cold start
- B6 Cancel mid-signing, reopen link → pick up where you left off
- B7 Producer sees completed flattened PDF with audit page within 10s of final signer completing

**Phase C (Deals)**
- C1 Dashboard at login = Kanban with deals visible; no empty-chrome "configure me" screen if seeded
- C2 Drag a card to next column → persists across refresh
- C3 Click deal → tabs show current state immediately (no loading spinner for >300ms)
- C4 From a deal, create a booking, a contract, and a project room in any order — all show up in the deal's tabs
- C5 Old `/dashboard/projects` URL redirects to `/dashboard/deals`

**Phase D (Software Feel)**
- D1 ⌘K opens < 100ms, typing filters in < 50ms per keystroke
- D2 `g` then `p/i/l/s` navigates to pipeline/inbox/library/settings
- D3 Dark mode toggle visible, switches both app + public pages consistently, no flash on reload
- D4 On mobile, sidebar collapses to an icon rail + overlay, no horizontal scroll
- D5 Fraunces + Outfit + JetBrains Mono all loading (FOIT/FOUT less than 200ms)
- D6 Contrast audit: all text passes WCAG AA on both cream and warm-dark

**Phase E (Inbox)**
- E1 New comment on a track = inbox item appears ≤ 3s
- E2 `j/k` navigates inbox, `e` archives, `r` replies inline
- E3 Click-through from inbox item lands on exact context (track w/ comment highlighted)

**Phase F (Tauri)**
- F1 `.dmg` downloads from landing page, installs, app opens with producer workspace
- F2 Drag a WAV from Finder onto deal = starts upload, no intermediate form
- F3 Contract signed = native notification fires
- F4 `⌥⌘Space` opens command palette from anywhere, even when app is not focused

## 8. What stays, what goes

**Stays** (from current state):
- Clerk auth + producer onboarding
- Magic-link token discipline (sha256 hash pattern) — reused everywhere
- `producerProcedure` middleware + ownership traversal pattern
- Existing booking system end-to-end
- Share-link analytics table
- Landing page (gets chrome pass in Phase D)

**Goes** (hard cut in this plan):
- Markdown contract template body + `{{merge_fields}}` resolver
- `bodyResolved` snapshot column
- Canvas-in-page signature pad on `/sign/[token]` (replaced with `react-signature-canvas` modal)
- Text `audioUrl` inputs (replaced with `<AudioUploader>`)
- Old `/dashboard/projects` URL (redirects to deals)
- `Syne` font (swap to `Fraunces`)

## 9. Risks

1. **R2 multipart on Vercel edge**: presigned URLs from Node runtime, not edge. Mitigation: tRPC runs on Node by default in this repo — no change.
2. **pdf-lib bundle size**: ~2MB. Mitigation: lazy-import only on contract editor/signer pages.
3. **react-pdf CSP**: pdf.js uses workers. Next config must allow `worker-src blob:`. Mitigation: add to CSP.
4. **Hard-cut contract wipe**: confirmed no signed contracts in production. If any exist at time of migration: `pg_dump` backup first, email producer, then drop.
5. **Deal rename cascade**: renaming `projects` table + all FKs in one migration. Mitigation: wrap in single transaction, test on Neon branch DB first.
6. **Mobile signature gotchas**: multiple referenced in research — enforced via tests B3+B4.

## 10. Open questions (non-blocking)

- Do we self-host Documenso for the PKCS#7 cert, or self-sign with an env-stored cert for Phase B1 and upgrade later? **Decision: self-sign for now; upgrade to SSL.com eSigner or similar CA in Phase F+.**
- Does "idiot QA" include a real mobile device test or is 375px viewport sufficient? **Decision: 375px viewport for every phase; real device test at the end of Phase B (signing is the highest-stakes mobile flow) and Phase F (installed app).**
- Do we keep portfolio tracks using external URLs as a fallback, or hard-cut them too? **Decision: hard-cut — all tracks become R2 uploads in Phase A. Existing external URLs stay viewable but cannot be newly added.**

---

*Design approved 2026-04-17. Implementation plan next.*
