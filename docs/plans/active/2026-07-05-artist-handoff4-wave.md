# Artist platform — Handoff 4 wave (2026-07-05)

**Goal (Raz):** a working, ready-to-ship app by end of day. Full E2E scope: artist UI rebuilt to
Handoff 4 spec (S1–S12), BE-2 + BE-3 backend implemented, minimal producer Requests hub for the
three gates, migration 0021 applied. An artist must be able to complete
request → agree → approved → choose plan → pay off-app → upload proof → verified → book session
against a real producer, on real data, with the full verification gate green.

**Design source:** `docs/design/handoff-4/` (Handoff.md, Design System.md, tokens.css, jsx screen
modules). The prototype's chosen defaults are the spec: **S1 = editorial, S2 = shelf
(skitza-store.jsx version, NOT the one in skitza-screens.jsx), S3 = ticket, S10 gate = request**.
Build only the chosen variants — no variant switchers, no dev panel, no iOS frame, no fake timers,
no prototype toasts.

## Decisions (locked with Raz, 2026-07-05)

1. **Scope: Full E2E** — UI + BE-2 + BE-3 + producer gates hub + migration, today.
2. **Payments: off-app only in v1.** Proof-of-payment is the only artist purchase path. Tranzila
   booking-payment routes stay dormant-but-intact (no links to them). Legacy per_song Stripe route
   `/artist/store/[productId]` dies once funnel S3 gains a songQty stepper (W7).
3. **Plan chosen at S7, after approval** (amends BE-1 semantics): request stores the offered set /
   provisional default; BE-2 adds a `choosePlan` mutation that sets `paymentPlanSnapshot` after
   approval, before the first invoice.
4. **Linear:** Raz is authorizing the Linear connector. Each loop iteration: probe for Linear MCP
   tools (ToolSearch "linear"); once available, create issues in project `Skitza v3` (team SK) per
   wave, move In Progress, use `SK-N:` PR titles. Until then: keep committing with conventional
   messages; note pending issue creation in the Progress log below.
5. **Adopted defaults:** canvas stays `#F2EDE6` (handoff tokens.css value; Design System.md's
   `#F7F3EC` treated as typo) · pill radius per locked `docs/design/buttons.md` (no 9999px on text
   rectangles) · CTA text on amber = dark `#1a1407` via new token `--fg-on-brand`, artist-side
   first · Book tab → `/artist/sessions` (S11); the picker becomes a funnel screen · `/join/[slug]`
   rebuilt as S1-editorial, CTA → `/sign-up/join/[slug]`, "private invite" softened to hand-picked
   tone · S6 keeps current Home module stack; heartbeat card restyled to handoff hero spec ·
   S13/S14 music library PARKED — do not touch shared music screens · press-liveness as scoped CSS
   classes (tiers .93 pop / .965 lift / .975 row, springy release), gated by prefers-reduced-motion
   inside the app's curated block · S5 uses server `refNumber` (never the prototype's fake
   generator) · keep studio switcher, mini-player, desktop lg+ chrome as-is (rebuild is the sub-lg
   experience).

## Guardrails (violations = stop and fix)

- **Never paste `tokens.css` into globals.css.** Class collisions with load-bearing producer
  semantics: `.sk-pop` (app modal entrance), `.sk-row` (producer Clients & Projects rows,
  SK-59..64), `.pill` (buttons.md), `.animate-shine`, `.ping-dot`, `.reveal-up`. Integration is a
  small alias/addition diff.
- **Do not modify:** `components/music/library-screen|project-page|song-page` (shared with
  producer), `audio/persistent-player` bus contract (`skitza:player:*` — new play affordances must
  speak this bus), `shell/app-topbar`, `ui/button`, `ui/skeleton` (extend, don't mutate),
  producer routes except the new Requests hub, `(artist-welcome)` upsert logic, Clerk auth pages.
- **Safe-to-replace zone:** `components/artist/**`, `nav/artist-*`, `shell/artist-topbar`,
  `components/join/**` (verified: no producer imports).
- **BE stubs are a frozen contract:** implement bodies of the existing `NOT_IMPLEMENTED` stubs in
  `apps/web/src/server/trpc/routers/purchase.ts` — don't re-declare signatures. Proof-REJECT is
  net-new (not in the frozen contract) — add it cleanly.
- **Gate before every commit:** `pnpm typecheck && pnpm -F web lint && pnpm test` (lint runs with
  `--max-warnings 0` on Vercel). Work in this worktree/branch; push and PR to `v3-clean`.
- Money is integer agorot (`priceCents` etc.); running total paid = SUM over paid `invoices` rows.
- Every new screen ships loading (warm skeleton parity), empty, error/rejected, disabled states.
- v2 features render greyed "Coming soon", never removed: Pay by card (S8), Add to calendar (S11),
  Green Invoice.

## Wave checklist (loop works top → bottom; tick `[x]` + Progress log entry when done)

### W0 — Foundations

- [x] W0.1 Apply migration `packages/db/drizzle/0021_purchase_requests.sql` to Neon via
      `/skitza-migrate` (journal is stale — use apply-migrations.mjs path). Verify
      `purchase_requests` + `agreement_acceptances` exist afterward.
- [x] W0.2 Token diff into `apps/web/src/app/globals.css`: add `--fg-on-brand` (26 20 7 /
      `#1a1407`); confirm `--border-strong` declared (200 192 178); add `.label-eyebrow`
      (mono 10px uppercase 0.16em + optional 18×1px rule prefix); add handoff motion primitives
      under NEW names that don't collide (`sk-rise` entrance stagger, CTA sheen sweep, breathing
      dot, stepper ring pulse, S5 ripple, eq bars if missing); scoped press-liveness classes
      (3 tiers + springy release). JetBrains Mono weight 800 in `layout.tsx`.
- [x] W0.3 Net-new primitives: `skCover(hue)`/`skSwatch(hue)` TS util (vignette + 3-stop oklch,
      per-product hue g1=44/g2=30/g3=12/g4=340 pattern → derive hue deterministically from product
      id); `StickyNav` collapsing header (transparent over cover → solid cream bar with title on
      scroll). Unit-test hue derivation + util output shape.

### W1 — BE-2: money loop backend (SK-38 scope)

- [x] W1.1 Widen `purchase_request_status` enum: `pending | approved | awaiting_payment |
verifying | paid | declined` (migration). Map: approved→awaiting_payment on approval (or keep
      `approved` as awaiting-payment alias — pick one, document). Widen the single-active-purchase
      guard in `artist.purchase.request` step 5 to cover all non-terminal states.
- [x] W1.2 Payment plans: add `milestones` to the `PaymentPlan` union (schema.ts:25) or map from
      `depositModel='milestones'`+`products.milestones`; implement `artist.purchase.paymentPlan.preview`
      (frozen stub) — returns plan cards (kind, dueNow, schedule rows) like the prototype's
      `buildPlans`; add `artist.purchase.choosePlan` mutation (decision 3) updating
      `paymentPlanSnapshot` post-approval, pre-first-invoice.
- [x] W1.3 Producer payment details: `producers` jsonb column (bank transfer text, Bit number) +
      producer settings write + artist-facing read; "producer will send details" variant when
      empty.
- [x] W1.4 Proof of payment: image/PDF R2 presign path (audio router is audio-MIME/producer-only —
      add a scoped presign for proof uploads); implement `artist.purchase.proofOfPayment.submit`
      → creates an `invoices` row per installment, returns `invoiceId`; running-total = SUM paid
      invoices; multiple proofs allowed.
- [x] W1.5 Gate 2: implement `producer.purchase.proofOfPayment.confirm` (frozen stub) + net-new
      reject-with-note procedure + storage for the rejection note (S9 rejected banner);
      status transitions verifying→paid / verifying→awaiting_payment(rejected).
- [x] W1.6 Notifications/emails for the money loop: proof submitted (→producer inbox), proof
      verified / rejected (→artist email; artists have no in-app feed — email only in v1), wire
      `sendFinalPaymentDueEmail` where relevant or log as follow-up. Tests for every new procedure
      (happy + guard paths).

### W2 — Artist UI: real-data screens restyled to Handoff 4

- [x] W2.1 S3 product detail (`components/artist/purchase/product-detail-screen.tsx`): ticket
      receipt head ("LOCKS AT REQUEST" mono, 36px Syne price, sessions/deposit column), 138px
      skCover band, plan-hint chips, dark price-lock note, includes checklist. Keep
      `artist.store.product` + `artist.purchase.pending` wiring + disabled-pending CTA.
- [x] W2.2 S4 review & agree: PDF row card rendering `products.contractUrl` with real View link,
      dark summary strip, 256px scrollable plain-language summary with fade, CheckRow restyle.
      Remove plan choice from request time (moves to S7) per decision 3 — request stores offered
      set/provisional default.
- [x] W2.3 S5 request sent: perforated ticket card w/ price-locked stub + server refNumber, 3-node
      what-happens-next timeline, ripple emblem, dual footer (Home / Store).
- [x] W2.4 S6 home heartbeat (`purchase-status-card.tsx`): handoff hero card — StatusPill,
      4-node Stepper (Request→Pay→Sessions→Delivered), WHAT'S NEXT panel, context CTA
      (awaiting_payment→S7, paid→S10), declined = generic copy → store. All 5 states renderable;
      pending/awaiting/declined live now, verifying/paid live after W1.
- [ ] W2.5 S2 store (Shelf direction, from `skitza-store.jsx`): StoreHero (132px cover band,
      avatar, rating row, hand-picked banner), flagship Shelf card + 2-col square-cover grid,
      per-product hue covers, play badges only if trivially wired to portfolio tracks via existing
      bus — else omit. Keep `artist.studios` / `artist.store.products` / `productHref()` / VAT
      display. Warm skeletons.
- [ ] W2.6 S1 `/join/[slug]` editorial: 300px skCover hero w/ Syne name, "Listen first" track rows
      on the existing `skitza:player:*` bus, spark info card, StickyNav, pinned CTA →
      `/sign-up/join/[slug]` (signed-in artists deep-link to store). Keep `publicProfile.forJoin` + locked-tracks teaser count. Softened invite copy.

### W3 — Artist UI: pay screens on BE-2

- [ ] W3.1 S7 choose plan: selectable plan cards w/ DUE TODAY math + schedule rows from
      `paymentPlan.preview`; single-plan products pre-selected; confirm calls `choosePlan` → S8.
- [ ] W3.2 S8 payment instructions: amount-due-now hero (Syne, dark card), bank + Bit rows with
      real copy-to-clipboard, "producer will send details" variant, greyed "Pay by card — coming
      soon" → S9.
- [ ] W3.3 S9 upload proof: 6 states (empty / attached / uploading / awaiting verification /
      rejected w/ producer note + re-upload / paid-in-full), drop tile → R2 presign upload,
      "paid so far ₪X of ₪Y" from invoices sum, multiple proofs for installments.

### W4 — BE-3: sessions backend (SK-39 scope)

- [ ] W4.1 Slot-level month availability endpoint for artists (expose `computeSlots()`,
      booking.ts:374): month grid data (available days + per-day time chips), Israel TZ.
- [ ] W4.2 Honor `producers.autoConfirmBookings` in `artist.book.confirm` (Gate 3): auto-confirm →
      `confirmed`, else `pending_approval` (held). Keep pending-blocks-slot behavior.
- [ ] W4.3 `artist.book.mySessions` + `artist.book.session` (replace `book-data.ts` mocks);
      implement `artist.purchase.session.schedule` + `producer.purchase.session.confirm` (frozen
      stubs) attaching bookings to the purchase; fix `activePackages` unlimited math
      (sessionCount 0 → "Ongoing", never negative).
- [ ] W4.4 Artist cancel + reschedule mutations with hours-before-session enforcement
      (producer-level `cancellationPolicyHours` in v1; per-product column only if trivial).
      Emails: session booked/held/cancelled wired.

### W5 — Artist UI: book screens on BE-3

- [ ] W5.1 S10 pick date & time as a FUNNEL screen: month calendar (availability dots, greyed
      past/unavailable, month nav, legend), time chips, CTA "Request this slot" vs "Book this
      slot" per Gate 3; states pick/loading/no-slots/held. Reuse extracted date/gating helpers
      from `booking-client.tsx`; route lives at `/artist/book` reached from S6-paid / S11.
- [ ] W5.2 S11 my sessions + confirmation: Book tab retarget → `/artist/sessions`; confirmed/held
      hero (`?just=`), active-booking header w/ adaptive progress (dots ≤6 / bar 7+ / "Ongoing"
      unlimited), Book-another CTA → S10, greyed Add-to-calendar, empty state → Browse the store.
- [ ] W5.3 S12 session detail cancel/reschedule: within-policy self-serve (wired to W4.4),
      outside-policy disabled + "message [Producer]" stub. Time-policy gates the action only.

### W6 — Producer Requests hub (minimal, gates operational)

- [ ] W6.1 Requests surface in `/dashboard` (fits existing producer IA — e.g. a Requests
      section/page): list `producer.purchase.list`, approve (5-min undo) / decline with private
      reason (Gate 1) — backend already complete, zero UI consumers today.
- [ ] W6.2 Gate 2 UI: pending proofs queue → view proof image, verify / reject-with-note.
- [ ] W6.3 Gate 3 UI: held sessions queue → confirm/decline session; ensure
      `autoConfirmBookings` toggle is reachable in producer calendar settings. Inbox
      click-throughs land on the right hub rows.

### W7 — Off-app-only sweep + ship polish

- [ ] W7.1 songQty stepper folded into funnel S3 for per_song products; `productHref()` routes
      everything into the funnel; delete legacy `/artist/store/[productId]` route +
      `startStoreCheckoutAction` (Stripe checkout unlinked). Tranzila routes left dormant.
- [ ] W7.2 Settings + welcome-modal + payment/success light token restyle (eyebrows, cards).
- [ ] W7.3 Full-app QA: run dev server, walk S1→S12 + producer hub on phone viewport (390px),
      screenshot each screen, fix visual breaks; verify reduced-motion; verify producer side
      unchanged (Clients & Projects rows, dashboard, music).
- [ ] W7.4 Final: full gate green, session recap doc in docs/plans, Linear issues reconciled,
      PR(s) to v3-clean open with SK-N titles.

## Verification protocol (every wave)

1. Unit tests for new logic (Vitest, existing patterns — see `__tests__` siblings).
2. `pnpm typecheck && pnpm -F web lint && pnpm test` — all green before commit.
3. UI waves: preview at 390×844, compare against the jsx source in `docs/design/handoff-4/`.
4. Commit per wave-item or wave (conventional messages), push branch, note in Progress log.

## Progress log (append one line per loop iteration: what shipped, what's next, blockers)

- 2026-07-10 — WAVE PAUSED & PUSHED at Raz's request. Branch pushed, PR #192 open to
  v3-clean (title SK-65) covering W0+W1+W2.1–W2.4; SK-66 → In Review. Gate green (2,988+
  tests). RESUME AT W2.5 (S2 Shelf — prototype fully specced in docs/design/handoff-4/
  skitza-store.jsx: StoreHero 132px band + hand-picked banner, flagship shelf card, 2-col
  cover grid; omit play badges/tier/booked — no schema data). Then W2.6 → W7 per checklist.
  Reminders for the next session: ALL file writes via Bash only (prettier hook bug — fix was
  spawned as a separate task, verify merged before trusting Write/Edit); dev screenshot QA via
  /dev/screens gallery + Chrome MCP (ACCESS_TOKEN ?t= once, then Clerk dev handshake).

- 2026-07-05 12:25 — W2.4 COMPLETE (S6 heartbeat). New artist.purchase.current read (latest
  request incl. paid ≤30d / declined ≤7d) replaces the pending-only home probe — all 5 handoff
  states now reachable. Card: +declined stage (neutral pill, red-! first node, generic copy),
  +context CTA Link (approved → S7 pay w/ ?req=, paid → book) in fg-on-brand dark-on-amber,
  breathing dot only on amber pills, lock line hidden on terminal states. Gallery s6-* states;
  screenshots verified awaiting_payment/paid/declined. Stale no-<Link> test updated.
- 2026-07-05 12:05 — W2.2 + W2.3 VERIFIED CONFORMANT (S4 agree, S5 sent). Both screens were
  already built to this handoff revision by SK-46: S4 has the dark price strip, PDF View pill,
  256px scrollable numbered summary w/ fade, AgreeCheck + disabled-reason CTA; S5 has the server
  refNumber eyebrow, perforated price-locked ticket, 3-node timeline, dual footer. Screenshots
  in transcript (dev gallery /dev/screens/s4|s5). Zero code deltas; gallery extended. Linear
  reconciled: SK-65 umbrella + SK-66..69 children (A=W0-W1, B=W2-W3, C=W4-W5, D=W6-W7).
  Next: W2.4 S6 heartbeat.
- 2026-07-05 11:55 — W2.1 COMPLETE (S3 ticket). product-detail-screen rebuilt to the handoff-4
  ticket default: slim 138px cover band + StickyNav (gained scroll-container + className props),
  Syne title + tagline on cream, receipt price card (36px Syne, sessions/deposit column),
  producer row, bare-row includes + duration/revisions meta, plan-hint card with per-plan chips
  (planKinds from offeredPlans), dark price-lock note. artist.store.product now returns
  depositPct/depositModel/milestones/revisions; PurchaseProduct/product-mapping extended (+tests).
  NEW: dev-only screen gallery /dev/screens/[screen] (404 in prod) so visual QA runs without a
  Clerk session — per Raz's screenshots-for-verification directive. VERIFIED via Chrome at
  localhost:3000/dev/screens/s3: ticket card, chips, dark note, pinned CTA, StickyNav collapse
  all render to spec (screenshots in session transcript). Preview-tool nav is pinned to '/' —
  Chrome MCP is the screenshot path (ACCESS_TOKEN via ?t= once, then Clerk dev handshake).
  Linear connector authorized by Raz but tools don't reach this running session — issues to be
  reconciled at PR time. Next: W2.2 S4 + W2.3 S5.
- 2026-07-05 11:30 — W1 COMPLETE (BE-2 money loop). Status enum +verifying/+paid ('approved'
  doubles as awaiting-payment; 'paid' = sessions unlocked, never regresses; paid-in-full derived
  from invoices). PaymentPlan union +milestones (choice carries no schedule; server embeds
  product.milestones). New artist procedures: paymentPlan.preview (frozen shape)/options/choose,
  paymentInstructions, proofOfPayment.presign (audio-bucket proofs/ prefix)+submit (invoice row
  per proof). Producer: proofOfPayment.pending/confirm/reject(note, artist-facing), list filter
  widened. producers.payment_details jsonb + settings update wiring. Migration 0022 APPLIED to
  Neon. Emails: proof-verified/proof-rejected templates + dispatchers; proof_submitted inbox
  kind. sendFinalPaymentDueEmail wiring deferred (Autopilot cron territory — follow-up). Guard
  widened to pending/approved/verifying; purchase-pages source-grep test updated accordingly.
  Gate green (2987 tests). ⚠️ hook truth revised: EVERY Write/Edit tool call reformats the whole
  repo (env var never set + slow async prettier races) — ALL file writes now via Bash only.
  Linear: still unauthorized at probe. Next: W2 (S3/S4/S5 restyle, S6 heartbeat, S2 shelf, S1 join).
- 2026-07-05 11:05 — W0 COMPLETE. Migration 0021 (and 0004-0020 stragglers) applied to Neon —
  purchase_requests/agreement_acceptances live. globals.css: +--fg-on-brand, .label-eyebrow,
  .sk-press-pop/.sk-press-row tiers (+reduced-motion no-ops). Mono 800 loaded. New:
  lib/cover-art.ts (skCover/skSwatch/hueForId + tests), components/artist/sticky-nav.tsx +
  sticky-nav-math.ts (+tests). Gate green (2969 tests). ⚠️ found+contained: prettier hook
  reformats whole repo when Write targets out-of-repo files (empty $CLAUDE_TOOL_FILE_PATH);
  polluted 617 files, reverted via stash; hook fix chip spawned for Raz; using Bash for any
  out-of-repo writes this session. Linear: not yet authorized at last probe. Next: W1 (BE-2).
- 2026-07-05 10:45 — Plan created. Analysis: S3/4/5 already-close on BE-1; S7-S12 mock; BE-2/BE-3
  stubs frozen; producer gates UI absent; migration 0021 unapplied. Loop starts at W0.1.
