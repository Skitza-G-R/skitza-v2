# Producer beta onboarding — research and recommendation

**Date:** 31 Aug 2026
**Question (Gili):** Beta invites for new producers are about to go out. What is the best way to make
sure they understand the value, learn the flows, and see what their clients will receive — an in-app
tour (mobile/desktop), the video we created, or something else — so they don't ditch and churn?
**Status:** Research document — no code changes. Every build item below needs its own SK issue
before implementation.

---

## Verdict (short)

**Don't build a tour, and don't lean on the existing video.** For this cohort — invitation-only,
Israel-only, released in waves you control — the highest-value onboarding is **you**: a personal
welcome email with one CTA, an offered 20–30-minute setup call for wave 1, and one new
founder-recorded **≤2-minute "what your artist sees" video**. Back it with a small in-product build:
a **getting-started card on the empty dashboard Overview**, two fixed dead-end empty states, and a
labeled path to the artist preview that already exists. Instrument 4–5 activation milestones before
the first invite so churn diagnosis isn't guesswork.

The reasoning, evidence, and the corrected plan follow.

---

## 1. What exists today (codebase audit)

### The setup wizard already does the "tour of the producer side"

SK-157's resumable wizard (`apps/web/src/app/(onboarding)/onboarding/`) walks every new producer
through identity → first store product (created hidden) → working hours (if bookable) → an **exact
artist-facing preview** → publish → a strong completion screen (join link + copy/share, "Preview as
artist", push opt-in, optional portfolio/payment/bring-active-work). A generic feature tour would
mostly duplicate this.

### The gap starts one click later

"Open dashboard" lands on a calm but **static** Overview: empty Needs-You panel, "Active projects:
0", copy-link strip — and *nothing to do next*. Post-wizard guidance in the entire app is one
mobile-only, one-shot tooltip (`?storeTip=1`). Specific first-run problems found:

- **Dead ends by design:** a producer can exit after the identity step, or skip availability, and
  land on the dashboard with a *hidden product and unpublished page* — and nothing in the dashboard
  ever tells them to finish. The "Finish studio setup" Needs-You row exists in code
  (`needs-you.ts`) but renders only with `?skip=1`, which **nothing links to**. Dead in practice.
- **Payments empty state is bare:** `producer-payments-dashboard.tsx` shows literally "No payments
  yet." — zero explanation of the proof-based external-payment model, the product's most unusual
  and most explanation-worthy flow.
- **Portfolio empty state is circular** for day-zero users ("upload a track from a project first"
  with no project and no link to create one).
- Payment details are skippable, so a producer can share their link and receive a purchase while
  artists get **no payment instructions**.

### Producers cannot see the artist experience — the biggest value gap

The product's actual wow lives on the artist side: the `/join/[slug]` bento page with click-to-play
samples, the song page with waveform + timestamped comments + **exact-version approval**, full
payment-plan visibility with proof upload, pay-gated download. A producer can see their own public
join page (the `ownPreview` banner exists, and the sidebar share chip is on every authenticated
page), but `isSelfJoin` blocks them from ever experiencing `/artist/*` for their own studio. There
is no "view as artist" mode and no demo artist. **The value Gili fears producers won't get is
literally invisible to them until a real client signs up.**

### The video we created is not onboarding material

`apps/web/public/landing/demo.mp4` is a ~15-second, silent, muted-autoplay 9:16 loop covering only
the booking+payment slice, embedded solely on the `/get-started` marketing funnel. It's a "believe
this is worth a look" asset, not a teaching one. It can stay where it is; it cannot carry
onboarding. (Also: the SK-289 invite email is deliberately locked to exactly one link, one image,
no tracking to stay out of Gmail's Promotions tab — a video can't ride in the invite without
reopening that fix.)

### Infrastructure any solution can ride on

- **Email:** the beta-nudge cron (`/api/cron/beta-nudges`, SK-273) + 16 React Email templates +
  the Resend dispatcher already exist. A day-0 welcome email is a pattern-copy exercise.
- **SK-273 already defines the funnel:** `beta_invitees` statuses `pending → invited → signed_up →
  active`, where "active" = ≥1 project or ≥1 uploaded song, with automated nudges at invited+5d and
  signed_up+7d-not-active. **The onboarding question is precisely: what fills the window between
  sign-up and "active" before the day-7 "need a hand?" nudge fires.**
- **Analytics:** PostHog captures exactly one thing today: `$pageview`. No named activation events,
  no server-side capture client at all (`posthog-node` is in package.json but never imported).
- **In-app nudge pattern:** `push-moment-banner.tsx` (smart-moment eligibility, dismissible,
  never blocks the host screen) is a reusable model for restrained guidance.
- **No tooltip/popover/coach-mark primitive exists** — a tour would be built from scratch.
- Nothing in Linear has ever ticketed a tour, tutorial, or onboarding video; Gili's locked taste
  across SK-157/255/249/112 is consistently anti-interruption: no first-launch permission prompts,
  no marketing-page feel in-app, no forced modals, no gimmicky motion.

---

## 2. What the evidence says

Honesty note: most onboarding statistics are published by vendors selling onboarding tools
(Appcues, Userpilot, Chameleon, Wistia). Treat percentages as directional. The findings below rest
first on the few controlled studies and on patterns consistent *across competing* vendors.

### Product tours — weak, and weakest on mobile

- The one rigorous study (Nielsen Norman Group, 70 users, 4 apps) found upfront tutorial overlays
  **did not improve task success and made tasks feel harder** — worst on small screens, where
  overlays get dismissed unread. NN/g's consistent conclusion: contextual "pull" help where the
  user already is beats front-loaded "push" tours.
- Vendor data (directional, but published *by tour vendors against interest*): most shipped tours
  are skipped; completion collapses past ~4 steps; auto-started tours complete at roughly half the
  rate of user-triggered ones; passive "look at features" tours perform far worse than
  action-driven ones.
- The canonical failure mode is **touring an empty account** — pointing tooltips at features the
  user can't use yet. A new Skitza producer's account is empty by definition.
- Implementation reality for this repo: hosted platforms run ~$3k/yr for a cohort of dozens and
  inject off-design-system scripts; of the OSS libraries, onborda and nextstepjs both depend on
  Framer Motion/Motion (banned here), intro.js is AGPL, and only driver.js (~5 kB, CSS-only
  transitions) would be compliant — with unverified RTL. Even the best case is the wrong tool for
  the actual gaps.

### Video — right for belief, wrong for skill

- Video wins the *"believe this is valuable"* job (the classic Dropbox demo) and loses the *"learn
  by doing"* job (same NN/g result: watching doesn't build proficiency).
- Watch-through collapses after ~2 minutes across both Wistia's and Vidyard's large datasets
  (~two-thirds finish sub-1-minute videos; roughly half are gone mid-video at 5–10 min). One job
  per video, 60–120 seconds.
- Founder-personal videos for small cohorts (Loom/Bonjoro-genre case studies) show strong
  open/reply anecdotes. The numbers are vendor-published and uncontrolled — but at wave-1 scale the
  cost of trying is ~1 minute per invitee, so the evidence bar needed is low.

### Checklists + empty states — the durable self-serve pattern

- Every close comparable ships this instead of a tour: HoneyBook (9-step persistent checklist),
  Calendly (checklist ending in a *shareable artifact* — your live link), Dubsado (sample project
  experienced *as the client*), Square (preview-then-publish). None of the solo-operator tools
  leads with a tour; only DISCO (a catalog tool, not a workflow tool) leads with video.
- Expect honest completion rates of 10–30% — normal, not failure. Guidance embedded in the empty
  state of the screen where the action happens ("pull") is the pattern with the strongest
  independent support (NN/g).
- The "show what the client sees" mechanism is a **named feature in every comparable**: Calendly's
  Preview, HoneyBook's Client View + "send yourself a test file", Dubsado's sample project with
  your own email. Skitza's equivalent surface exists (`ownPreview` join page, guest song links) but
  isn't packaged as a first-run step.

### Concierge — the right primary channel for this specific cohort

- With tens of invitees per wave, a solo founder, and no PMF data yet, high-touch onboarding
  (Superhuman-style calls, Stripe's "Collison installation", PG's "do things that don't scale")
  is affordable and doubles as the **PMF research instrument** — you watch confusion happen live
  instead of guessing from dashboards. The famous retention claims (Superhuman "2x") are founder
  storytelling without counterfactuals; the honest case for concierge is *low marginal cost + high
  learning yield at this scale*, and that case is sufficient.
- The classic pre-PMF failure is automating onboarding before you know what confuses people
  (premature scaling). Build the scalable version *after* the calls reveal the 2–3 recurring
  confusion points.
- The cohort signed up 2+ months ago (SK-289 explicitly re-introduces the product in the invite) —
  they need the value re-sold, not just mechanics.

---

## 3. Recommendation

Three layers, in priority order. A tour is not one of them.

### Layer 1 — Concierge wave 1 (founder time, no code)

1. **Day-0 welcome email** (pattern-copy the beta-nudge template): why they specifically were
   picked, honest beta expectations, the "what your artist sees" video link, one CTA to book a
   20–30-min setup call, and the feedback channel (WhatsApp is the natural one for an Israeli
   cohort — decide in open question 4).
2. **Offer a call to 100% of wave 1** (recommend wave 1 = 10–15 invites so this is ~5–7 hours
   total). In the call: set up together, then screen-share the *artist side* of their own studio —
   the thing no self-serve mechanism can fully show today. Let wave-1 results decide whether later
   waves stay high-touch or go self-serve.
3. **Optional, cheap, worth trying:** a ~60-second personal Loom per invitee instead of/alongside
   the call offer for people who don't book.
4. **The cheap experiment that tests the real risk (do this in the first 5 calls):** ask each
   producer to send their join link to *one real artist that week*, and watch whether the artist
   completes join → request → proof. The plan's hidden assumption is that churn comes from
   producers not understanding Skitza; the rival hypothesis is that producers understand fine but
   their *artists* won't change behavior. If artists stall, no checklist or video fixes it — pause
   Layer 3 and solve that instead.

### Layer 2 — The one video worth making (founder time + S code)

Record a **≤2-minute founder screen capture of the artist journey**: join page → book/buy →
agreement → payment instructions → proof upload → new mix notification → timestamped comments →
exact-version approval → paid download unlock. This is the value story producers can't see, it's
too deep for any tour, and "show, don't tooltip" is what it needs.

Production notes (these matter):
- **Record in a mobile viewport frame** (or heavy zoom-and-pan) — a desktop capture played in a
  390px `<video>` is illegible and reads cheap.
- **Burn in captions**; many will watch muted. Never autoplay.
- **Hosting: NOT R2.** The R2 pipeline is audio-only (`ALLOWED_TYPES` rejects video/mp4) and serves
  *expiring* presigned URLs — a raw link in an email would 403 within hours. Serve it as a static
  asset under `apps/web/public/` (like the existing demo.mp4) or an unlisted `youtube-nocookie`
  embed, behind a **stable authenticated page** (e.g. `/dashboard/welcome-video` or a modal route)
  that also fires the `video_watched` event.
- Link it from: the wizard complete screen, the getting-started card, and the welcome email.

### Layer 3 — Small in-product build (1–2 weeks total; each item needs an SK issue)

1. **Getting-started card on the empty Overview (M).** A new, self-contained component — *not*
   an extension of `needs-you` (its 3-row cap, its deliberate non-dismissibility of `setup` rows,
   and the migration-0060 CHECK constraint on dismissal kinds all fight checklist semantics; leave
   it alone, and delete the dead `?skip=1` row while there). 4–5 items whose completion is
   **derived from real data, not clicks**: publish your page → share your join link → upload a
   first song → add payment details → watch "what your artist sees". Deep-links only. Collapsible
   pill on true 360/390px (motion CSS-only, gated behind `prefers-reduced-motion`), logical
   properties so it mirrors under RTL. Persisting dismissal/"done" state needs a small table or a
   constraint change via `$skitza-migrate` — name that migration in the SK issue. No pre-checked
   gamification rows; real progress (page published) is endowment enough for the premium feel.
   This card also closes the worst churn dead ends: it's the recovery path for
   exit-after-identity and availability-skip producers whose page is still unpublished.
2. **Fix two empty states (S).** Payments: three lines explaining the external-payment +
   proof-verification model, linking to payment settings. Portfolio: break the circular dead end
   with a real path (upload → project).
3. **Label the artist preview (S).** The affordance mostly exists (sidebar share chip on every
   page, `ownPreview` join page) — make it *legible* as "See what your artists see" (a named action
   on Overview/Settings), rather than building new preview machinery. The guest song link
   (`/listen/[token]`) is the second taste — surface it as a **post-first-upload** step in the
   checklist (day-0 producers have no songs; don't put it in the welcome email).
4. **First-session priority rule (S, mostly a decision).** The SK-249 install sheet already guards
   against dialog stacking; the real issue is three competing CTAs in session one on a 390px
   screen. One rule: **the getting-started card owns session one** — suppress the install
   invitation until the first checklist item is complete or session ≥ 2.
5. **Instrument activation milestones (M, not S).** Server-side capture doesn't exist yet, so this
   is a small service + wiring, not a sprinkle. Keep it to 4–5 events derived from DB truth:
   `wizard_completed`, `join_link_shared`, `first_song_uploaded` (or first project),
   `artist_joined`, `proof_verified` — plus client-side `video_watched`. Respect the existing
   bearer-token redaction rules for `/listen` URLs. At this cohort size, skip funnels and
   correlation analysis: **call notes are the primary instrument; events are the backstop**, next
   to the DB-side truth SK-273 already computes.

### Explicitly not building now

- **Any coach-mark tour** — revisit only if wave-1 calls reveal 2–3 recurring confusion points
  worth automating; then driver.js (the only rule-compliant option), ≤4 steps, user-triggered,
  after RTL verification at 390px.
- **Hosted onboarding platforms** (~$3k/yr, off-design-system, wrong scale).
- **A full "view as artist" mode / demo artist (L)** — the right long-term answer, blocked by
  `isSelfJoin` today; video + labeled preview + the call cover beta.
- **Sample/demo data** — trust and metric-pollution risks; revisit post-beta.
- **A push "onboarding" category** (no category exists; opt-in gated; wrong channel for this).
- **Re-cutting the marketing video** — it does its `/get-started` job; leave it.

---

## 4. Measurement

Keep SK-273's "active" definition (≥1 project or ≥1 song) for cron compatibility, and layer:

- **Setup proxy (controllable by onboarding):** page published + join link shared, within 7 days.
- **Activation (existing):** SK-273 "active" within 7 days.
- **Value moment:** first artist joined via the producer's link; first proof verified.
- **The churn signal Gili actually fears:** producer **returns in week 2** and **week-4 return
  rate** per wave. Note that "first artist joined within 14 days" alone would conflate onboarding
  quality with each producer's client pipeline — a producer who fully gets it but has no session
  booked that fortnight isn't an onboarding failure. Track it, but judge onboarding by the
  controllable proxy + return rates + call notes.

---

## 5. Open questions for Gili

1. **Language coherence (bigger than copy choice).** The PRD still says English-only v1 (§2, §18)
   while the app ships en+he — but i18n mounts only on *authenticated* surfaces, so `/join/[slug]`,
   guest links, and artist-facing emails are **English-only** for an Israel-only cohort whose
   artists are Hebrew speakers. And the dashboard body itself is hardcoded English today, so a
   bilingual checklist would be the only translated card on an English screen. Question: is the
   English artist-side surface acceptable for beta, or a blocker to fix first? (Per CLAUDE.md this
   PRD conflict is flagged, not resolved here.)
2. **Founder time budget:** commit to calls for 100% of wave 1 (10–15 invites ≈ 5–7 hours)? Does
   call capacity set wave size, or the reverse?
3. **Video narration/captions:** Hebrew or English (ties to question 1)?
4. **Feedback channel:** WhatsApp, email replies, or something else?
5. **Payment-details gap:** producers can share a live link with no payment instructions saved.
   Should the checklist merely nudge, or should sharing be gated on payment details?
6. **North-star sign-off:** which failure worries you more — "no artist ever joined" or "artist
   joined but no proof was ever verified"? That choice sets what the beta optimizes for.

---

## Appendix — key sources

Codebase: `apps/web/src/app/(onboarding)/onboarding/`, `components/dashboard/overview/`,
`server/domain/attention/needs-you.ts`, `components/payments/producer-payments-dashboard.tsx`,
`server/contacts/join-continuation.ts`, `apps/web/public/landing/demo.mp4` + `/get-started`,
`api/cron/beta-nudges/route.ts`, `components/observability/posthog-provider.tsx`,
`components/shell/sidebar-share-chip.tsx`, `components/pwa/`; Linear SK-157, SK-170, SK-229,
SK-231, SK-249, SK-255, SK-273, SK-276, SK-283/284, SK-289; `docs/plans/active/`
2026-07-30-producer-onboarding, 2026-08-12-producer-invitation-access,
2026-08-15-sk-249-mobile-pwa-install-invitation; PRD v5.4 §2, §4.7, §15, §18.

External (load-bearing): NN/g — Mobile Tutorials study (nngroup.com/articles/mobile-tutorials),
Onboarding Tutorials vs Contextual Help, Instructional Overlays, Empty States; Chameleon product
tour benchmark reports (chameleon.io/benchmark-report); Userpilot activation/checklist benchmarks;
Pendo onboarding guides; Wistia State of Video 2024; Vidyard Business Video Benchmarks; Nunes &
Drèze 2006 (endowed progress, J. Consumer Research); Paul Graham, "Do Things That Don't Scale";
First Round Review — Superhuman onboarding playbook; Loom/Doopoll welcome-video case study;
Centercode beta-invite guides; driver.js / react-joyride / onborda / nextstepjs (npm, Jul 2026
states); Userflow RTL docs; comparable-product help centers: HoneyBook, Dubsado, Calendly, Square
Appointments, Samply, DISCO, Filepass, Trackstack, EngineEars. Vendor statistics treated as
directional throughout; the two controlled anchors are NN/g's 70-user study and Nunes & Drèze.
