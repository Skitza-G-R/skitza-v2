# SK-298 — "Watch your first artist": story v2 design

Date: 2 September 2026. Status: approved by Gili in chat (2 Sep 2026), supersedes the
11-frame story shipped in `9398e2b4`. Issue: SK-298. Strategy page: "Skitza Move-In Hook".

## Why a second story

Gili's review of the third visual pass: fix the defects, make it shorter, add the music place
with timestamped comments and the fact that artists book their own sessions, keep every core
feature in one flow, and do not make it boring. My own review found the biggest weakness: the
artist frames showed the screen *before* Noya acts (no plan picked, accept button greyed out,
no file attached) while the captions said she had acted.

## The story (8 frames + closing card, about a minute)

| # | Side | Frame id | Live screen | What the frame shows |
|---|------|----------|-------------|----------------------|
| 1 | Noya | `store` | `ProducerHero` + `FocalProductCard` + `LiquidGlassBottomNav` | Your Store exactly as a connected artist sees it. Unchanged. |
| 2 | You | `approve` | `PurchaseRequestReview` (+ commercial details) | Her request to book as the real producer card. **Interactive:** tapping Approve advances. |
| 3 | Noya | `agreement` | `ReviewAgreeScreen` (gallery arm) | The exact agreement with the story plan first. **Auto-act:** after a beat the checkbox ticks and the accept button lights. |
| 4 | Noya | `pay` | `PaymentInstructionsScreen` | Your own Bit/bank details on her phone (labelled example if none). Caption covers the receipt upload. Unchanged. |
| 5 | You | `verify` | `PaymentProofReview` | The real receipt review. **Interactive:** Confirm ₪900 advances. Unchanged. |
| 6 | Noya | `music` | `SongPage role="artist"` | Blue Hour with v1 and v2, waveform from precomputed peaks, her note at 0:42 on the wave and your reply. **Auto-act:** v2 flips to Approved. |
| 7 | Noya | `sessions` | `BookingClient` → `ConfirmationHero` + `MySessionsScreen` | She picks a day from availability. **Auto-act:** flips to "You're booked" with 2 of 3 sessions left. Skipped when the product has no studio time. |
| 8 | You | `dashboard` | `OverviewScreen` | The real dashboard, alive: 1 active project, her session today, v2 as latest upload, money tiles. Nothing needs you. |
| — | — | `closing` | closing card | Unchanged: "That was a simulation." + Bring in your active work / Copy my link / Open dashboard. |

Cut from the previous story: product detail, request form, request sent, choose plan, upload
proof, the hand-drawn Needs-you card and the hand-drawn outcome list.

Alternatives weighed and rejected: keep all 11 and add three (14 frames, too long); six frames
without the agreement and pay screens (removes the core promise).

## Mechanics

- **Artist frames stay inert storyboards** (`inert aria-hidden`, inert hrefs). **Producer frames
  stay on preview callbacks.** Zero database writes, zero fetches: every song version carries
  `peaks`, every session fixture has `calendarSync: null` and `changeRequest: null`,
  `unresolvedItems` and `urgentProjects` are empty so no dismiss action renders.
- **Auto-act beat:** an artist frame renders its "before" state, then after ~1 s re-renders in
  the "done" state with the existing `sk-step-enter` motion. Under `prefers-reduced-motion:
  reduce` the done state renders immediately. Going back to the frame replays the beat.
- **Push toast:** each producer frame opens with a small "Skitza · now" line above the screen
  (the existing bell row), like a real phone push.
- **Story data** lives in the model, derived from the real product: session length and count
  come from the product (0 = no studio time → no sessions frame); the final payment line adapts
  to the plan (split → "₪X due when she approves"; full → "paid in full"). The session is the
  next weekday at 14:00 in the producer's timezone; dates are computed from `now` so tests can
  pin them.
- **Keyboard, tap zones, telemetry** unchanged; `simulation_step` now fires once per frame (8,
  or 7 without studio time).

## Small additive changes to live components (as built)

- `PurchaseRequestReview`: `onPreviewDecision?: (decision: "approve" | "decline") => void`, a
  seam that short-circuits before the server action, mirroring `PaymentProofReview`.
- `ReviewAgreeScreen` (gallery arm only): `defaultAccepted?: boolean` seeding the checkbox
  state so the storyboard can show the accepted state.
- `SongPage`: `narrowLayout?: boolean`. The page picks its layout from a viewport media query,
  which is wrong inside a fixed-width device frame: at desktop the two-column layout burst out
  of the 392px phone frame, and on real phones the notes thread stayed hidden behind a sheet.
  With the flag on, the page is one column at every width and the notes render inline. Default
  is unchanged, so the live song page is untouched.
- No change to `BookingClient`, `MySessionsScreen`, `ConfirmationHero`, `OverviewScreen`; they
  are composed with fixtures and the providers the dev gallery already uses.

## Two details found while building

- **The frame scrolls to the notes.** The song page is taller than a phone screen, so the
  timestamped notes the caption promises start below the fold. `ScreenArea` gained a
  `revealSelector` that scrolls to the first note after a beat, the same scripted-scroll idea
  the previous pass used on the product detail page.
- **The dashboard frame sits on the morning of her session.** The live "Today" card would
  otherwise label a session three days out as today. The frame's clock is the session day at
  08:00, which also makes the greeting read "Good morning".

## Tests

- Model: frame order and ids; the sessions frame disappears when the product has no studio
  time; song, session and dashboard data derive from the product and `now`.
- Interaction (jsdom): walks all frames, clicks Approve, Confirm ₪900, Confirm payment, Finish;
  asserts captions, the done states after the beat, labels on every frame, no navigation, no
  fetch, no server action, telemetry counts.
- Source contract: updated component list and seam literals.
- Seam tests on the two live components: the preview decision never reaches the server action.

## Also fixed, found by looking at the real screens

- **Funnel titles no longer truncate on phones.** `FunnelTopBar` forced a single nowrap line
  into roughly 250px, so real artists saw "Review exact agree…" and "Payment instructio…". The
  title now wraps to a second line and shrinks a little further before it has to. This is a
  live artist bug, not only a simulation one.
- **The approve frame decides in one tap.** Recording the walk in a browser caught a nested
  confirmation dialog opening at `z-50` beneath the simulation's own `z-60` overlay: visible,
  dimmed, unreachable. With the preview seam the first tap decides; the live screen keeps its
  confirmation step.

## Out of scope

The empty space of a one-product Store, and Hebrew copy.
