# Skitza — Artist Purchase Flow · Developer Handoff

A mobile-first, clickable prototype of the **artist-facing** purchase journey for Skitza (artist books + pays a music producer). 14 screens across 5 sections, one connected flow. Producer-side gate/hub screens are **out of scope**.

Running example: artist **Noa** booking producer **Gili Studio** (Tel Aviv). Currency **₪ (ILS)**. Single timezone (Israel, GMT+3) in v1.

---

## 1. How it's built

- **Single-page React prototype**, no build step. React 18 + Babel standalone, loaded from CDN with pinned versions + integrity hashes in `Artist Purchase Flow.html`.
- Logic is split into `<script type="text/babel">` modules, each exporting to `window`:
  - `tokens.css` — design tokens (colors, motion primitives, scrollbar/eq helpers).
  - `skitza-mobile-data.jsx` — data + icons: `ARTIST`, `GILI`, `TRACKS`, `PRODUCTS`, `productById`, `skCover/skSwatch`, `ils`, the `Ic` icon set.
  - `skitza-mobile-ui.jsx` — shared UI: `Avatar`, `Eyebrow`, `Chip`, `StatusPill`, `Stepper`, `CheckRow`, `PrimaryCTA`/`SecondaryCTA`, `GlassRound`, `TopBar`, `StickyNav`, `BottomTabBar`, `TrackRow`, `Sk` (skeleton).
  - `skitza-screens.jsx` — `Screen` shell (scroll + pinned header/footer + entrance wrapper) and S1–S3.
  - `skitza-screens-2.jsx` — S4–S6 (Commit).
  - `skitza-screens-3.jsx` — S7–S9 (Pay) + `buildPlans`.
  - `skitza-screens-4.jsx` — S10–S12 (Book) + availability data.
  - `skitza-screens-5.jsx` — S13–S14 (Receive, Music library). **Parked — needs deeper UX planning, see §5.**
  - `skitza-store.jsx` — overrides `S2Store` with the three Store directions.
  - `Artist Purchase Flow.html` — host: state machine (`App`), routing, the dev **control panel**, scaling, the JS press-liveness handler, and keyframes.
- **State machine:** `App` holds one `s` object (`screen` + per-screen state/variant keys). `set(patch)` merges. A big if/else maps `s.screen` → the screen component. `productId` / `s1variant` / `s3variant` / `s2variant` persist to `localStorage`; the current `screen` does not (always boots at S1).
- **Dev control panel** (top-left, outside the device): jump to any screen (grouped by section), flip every state, and toggle layout variants. This is tooling, not product UI — strip it for production.
- **Device frame:** the iOS frame starter (`ios-frame.jsx`), scaled to fit the viewport; warm Skitza chrome is rendered inside it.

To extend: add a screen component (export to `window`), add a routing branch in `App`, add a panel entry. Replace the in-memory `PRODUCTS`/`ARTIST`/`GILI`/availability with API data; wire the toast + navigation callbacks to real handlers.

---

## 2. The journey (S1–S14)

**Section 1 — Get in**

- **S1 Invite landing** (`/join/[slug]`) — private invite. Producer cover + logo, bio, portfolio tracks (play/pause), **Book a session**. Variants: cover / editorial (default) / minimal. States: ready / loading.
- **S2 Store** — standing screen. Producer hero ("Booking June · replies in ~1 day · Hand-picked for Noa") + products. **Three directions** (default Shelf): **Ladder** (tiered editorial), **Shelf** (record-shop, cover-forward, names on covers, play badges), **Compare** (decision-first spec columns). Distinct cover hue per product. Loading skeletons. Tap product → S3.
- **S3 Product detail** — title + price, what's included, producer row, payment-plan hint, **Request to book** (price locks now; no payment yet). Variants: inline / ticket (default) / big-price. Disabled state when a request is already in review.

**Section 2 — Commit**

- **S4 Review & agree** — producer-uploaded **Booking_Agreement.pdf** (the binding doc) above a plain-language summary in a scrollable card; single "I've read & agree" checkbox enables **Send request** (sending spinner). Interactive.
- **S5 Request sent** — premium confirmation moment: ticket card (perforation, price-locked stub, ref #) + "what happens next" timeline. → Home or Store. (Gate 1: producer reviews.)
- **S6 Home — purchase status card** — the heartbeat. "[Product] with [Producer]" + status pill + 4-node **Stepper** + what's-next + context action. **5 states:** Pending review · Awaiting payment (→ S7) · Verifying (proof attached) · Paid — sessions unlocked (→ S10) · Couldn't be confirmed (generic, → store). Standing screen.

**Section 3 — Pay** (off-app in v1; the app is the record-keeper)

- **S7 Choose a plan** — per-product options (Pay in full / 50–50 / milestones), selectable cards with schedule rows; single-plan products show one pre-selected. → S8.
- **S8 Payment instructions** — amount due now (large), bank transfer + Bit with copy, greyed "Pay by card — coming soon" (v2). "Producer will send details" variant. → S9.
- **S9 Upload proof (POP)** — drop tile, "paid so far ₪X of ₪Y" running total. **States:** empty · attached · uploading · awaiting verification · rejected (producer note, re-upload) · paid-in-full. (Gate 2.) Multiple proofs allowed for installments.

**Section 4 — Book**

- **S10 Pick date & time** — month calendar (availability dots; past/unavailable greyed + unclickable; month nav), time-slot chips. **Request this slot** (Gate 3 on, slot held pending) vs **Book this slot** (auto-book). States: pick / loading / no-slots / held.
- **S11 Session confirmed + My sessions** — confirmed/held hero + greyed "Add to calendar" (v2) + sessions list. **Active-booking header** with adaptive progress (dots ≤6 · bar 7+ · count for unlimited) and **Book another session** (multi-session products). Empty state → **Browse the store** (you must buy before you can book).
- **S12 Cancel / reschedule** — session detail + Reschedule/Cancel. Within policy = self-serve; outside policy = disabled + "message [Producer]". Time-policy controls the action only, not money.

**Section 5 — Receive** (parked)

- **S13 Music library — download LOCKED** — stream freely, lock where download would be, "₪X of ₪Y paid" banner, **Complete payment**. Overdue state pauses future sessions.
- **S14 — UNLOCKED** — download buttons + "Download all", green "Paid in full — these are yours." Downloading progress state.

---

## 3. Business rules (the "why")

1. **Payment plan is per product** — producer chooses what each product allows (full / 50–50 / milestones).
2. **Download is the safety guard** — song _downloads_ lock until paid in full; sessions can still run on a deposit/plan. Overdue milestone → pause future sessions.
3. **Money is off-app, governed by the signed contract** — deposit usually final; the cancel time-policy controls the _action_, not refunds.
4. **Cancellation/reschedule policy is per product** (hours-before-session).
5. **Notifications** — every key step pings the artist by app + email (not screens here). Tax invoice (Green Invoice) = v2.
6. **Single timezone (Israel) in v1.**

**Three producer gates** (the artist only ever _waits_ at these): **Gate 1** approve request (before payment; decline → generic message). **Gate 2** verify proof of payment (reject → re-upload). **Gate 3** session approval (toggle; default auto-approve on). No gate at signup — Gate 1 is where a wrong-fit request is declined. While anything is pending, the artist can browse/listen but **can't start a second purchase** (second _sessions_ on a live product are fine).

**Entry points to booking:** Home status card (Paid) → "Book a session" is the primary nudge for the first session; the **Book tab** is the workspace for a live product (active-booking header → "Book another session"). Every session stays attached to the one purchased product.

---

## 4. v1 vs v2

- **v1 now:** off-app pay (bank / Bit) + upload proof-of-payment screenshot; manual gates; single timezone.
- **v2 later (greyed "Coming soon," not removed):** card payments (Stripe), tax invoice (Green Invoice), Google Calendar sync.

---

## 5. Open items / notes for the dev

- **Music section (S13/S14) is parked** pending deeper UX planning (project/version structure, multi-installment download logic, overdue handling). Treat current screens as visual direction, not final.
- **Cover art** is a generated gradient placeholder system — wire real producer/product/track imagery (drop-in image slots or CDN images) keyed by the same `hue`/id.
- The **dev control panel** and the in-prototype "(prototype)/out-of-scope" toasts must be removed for production.
- All sample data (`PRODUCTS`, availability `JUNE_AVAIL`/`CAL_MONTHS`, `STORE_META`, `BOOKED`) is in-memory — replace with real producer data + the producer's real availability/timezone.
- Sign-in / sign-up uses **Clerk** (a step in the flow, not designed here).
