# Artist Purchase Flow — Design Handoff (mobile-first)

**Date:** 2026-06-07
**For:** Designing the artist purchase journey as clickable mobile screens in Claude (claude.ai), using the `frontend-design` skill.
**Source of truth:** Miro flow board `https://miro.com/app/board/uXjVHIvnxjI=/` + approval-gates design doc (`2026-05-27-producer-approval-gates-design.md`, with the 2026-06-07 refinements — see "Business rules" below).
**Scope:** Artist-facing screens only. Producer gate/hub screens are out of scope here.

---

## How to use this doc

You will work in **Claude (the app)**, one **section** at a time, in a **new chat per section** (5 chats total — not 1 giant chat, not 14 tiny ones).

For **each** section:

1. Start a new chat.
2. Turn on the **`frontend-design`** skill (or just say: *"Use the frontend-design skill."*).
3. Paste **PART A — Design Constants** (below). This is the same every time — it keeps all screens looking like one app.
4. Paste the **one section** of screen specs you're working on (from PART B).
5. Say: *"Build these as mobile-first, clickable screens inside an iPhone frame. One screen per artifact, tappable so I can click through the flow. Match the Design Constants exactly."*
6. Iterate in that chat until you like it. Then move to the next section in a fresh chat.

> Why a new chat per section: a chat that designs 3 related screens stays sharp and consistent. One chat doing all 14 gets sloppy by the end; 14 separate chats drift in color/font. Sections are the sweet spot.

**Order to build:** Section 1 → 2 → 3 → 4 → 5. (It's the order the artist moves through.)

---

# PART A — Design Constants

> Paste this whole block at the top of every design chat.

```
SKITZA — DESIGN CONSTANTS (paste at top of every screen-design chat)

APP
- Skitza: a calm, boutique app where an artist books and pays a music producer.
- Feeling: warm, premium, unhurried — "a quiet record shop," not a SaaS dashboard.
- Mobile-first. Design for iPhone. One clear primary action per screen.

DEVICE FRAME
- iPhone, 390 x 844 pt. Show a realistic phone frame with status bar.
- Respect safe areas (notch top, home indicator bottom).
- Primary action sits low (thumb-reachable). Min tap target 44x44.

COLORS (use these exact values)
- Canvas / background:      #F2EDE6  (warm cream — the page)
- Card / input surface:     #FFFFFF  (white)
- Dark surface / chrome:     #111009  (near-black, warm)
- Sunken / subtle fill:     #E8E1D4
- Text strong (headings):   #111009
- Text body:                #3D3730
- Text muted:               #6B6359
- Text faint / hints:       #9C948A
- Text on dark:             #F2EDE6
- Brand amber (primary):    #D4960A  (main CTA, highlights, links)
- Brand amber dark (press): #A17106
- Copper (secondary):       #B06830
- Success / unlocked:       #22C55E
- Danger / blocked:         #DC2626
- Warning / pending:        #F59E0B
- Border subtle:            #E8E1D4
- Border strong:            #C8C0B2

TYPE
- Headings / display: "Syne" (bold, a little tight). Use for screen titles, prices, producer names.
- Body / UI: "Outfit" (regular/medium). Use for everything else.
- Numbers / amounts / timestamps may use "JetBrains Mono" for a precise feel (optional).
- Load from Google Fonts.

SHAPE & DEPTH
- Corner radius: rectangles use 16px. (Scale: 8 / 12 / 16 / 20 / 28.)
- rounded-full (circle) ONLY for square things: avatars, icon-only buttons, dots, play buttons. Never on text rectangles.
- Shadows are soft and warm, not gray:
  - small:  0 1px 2px rgba(17,16,9,0.05)
  - medium: 0 4px 12px -2px rgba(17,16,9,0.08)
  - large:  0 16px 40px -8px rgba(17,16,9,0.12)
- Amber "glow" for the key CTA when emphasized: ring of #D4960A at ~25% + soft amber shadow.

MOTION
- Entrances / hover lifts: ease cubic-bezier(0.16, 1, 0.3, 1), ~250ms.
- Press: subtle scale-down with a tiny overshoot on release.
- Keep motion quiet. No bounce-heavy or flashy animation.

COMPONENTS (consistent across all screens)
- Primary button: amber #D4960A fill, white text, 16px radius, full-width at the bottom on funnel screens.
- Secondary button: white fill, #C8C0B2 border, #111009 text.
- Disabled button: muted, with a short reason in a tooltip or helper line.
- Card: white, 16px radius, 1px #E8E1D4 border, small shadow. Generous padding (~20px).
- Status pill: small rounded chip. Pending = warning amber tint; Paid/Done = success green tint; Blocked = danger red tint; Neutral = #E8E1D4.
- Input: white, 1px border #C8C0B2, 12px radius, clear label above.
- Back navigation: a back arrow top-left on every funnel screen (not a browser back).

NAV CONTEXT
- The purchase funnel (sign-in → store → purchase → pay → book) is a FOCUSED flow:
  back arrow top-left, no bottom tab bar.
- The standing app screens (Home, Music, Book, Store, Settings) DO have a bottom tab bar
  with 5 tabs: Home / Music / Book / Store / Settings. Active tab in amber.

ALWAYS DESIGN THESE STATES (when the screen has data or actions)
- Loading: warm skeleton blocks, not spinners where possible.
- Empty: a short friendly line + the one action to take.
- Error: inline, calm, with a retry. Never a scary red wall.
- Disabled: explain why in one short line.

V1 vs V2 (show v2 things as a polite "Coming soon", greyed, not removed)
- v1 now: pay off-app (bank / Bit) + upload a proof-of-payment screenshot in the app.
- v2 later: card payments (Stripe), tax invoice (Green Invoice), Google Calendar sync.
```

---

# PART B — Screen specs (5 sections)

Each screen lists: **what it's for → layout top-to-bottom → states → the one primary action → notes**.
Screens marked **(built)** already exist in the app — include a simple version so the prototype clicks through, and match their style; the real design effort is on the **(new)** screens.

---

## SECTION 1 — Get in & pick  *(Chat 1)*

### S1. Invite landing — `/join/[slug]`  *(built-ish)*
- **For:** First touch. A hand-picked artist opens the producer's private link, hears the work, and decides to book.
- **Layout:** Producer cover image + overlapping round logo → producer name (Syne) + one-line bio → a few portfolio tracks with play buttons → big amber **"Book a session"** button at the bottom.
- **States:** Loading (skeleton hero + track rows). Playing vs paused track.
- **Primary action:** "Book a session" → sign up.
- **Notes:** This is a private invite link, not a public page. Warm, personal, like a calling card.

### S2. Store browse  *(built — SK-34)*
- **For:** See what this producer sells.
- **Layout:** Producer hero (gradient cover + overlapping logo) → one **focal product card** (the flagship offer, large) → a quiet list "Also from [Producer]" (smaller rows).
- **States:** Loading skeletons.
- **Primary action:** Tap a product → product detail.
- **Notes:** Already built — replicate the look so new screens match it. Calm, few items, lots of space.

### S3. Product detail + "Request to book"  *(new)*
- **For:** Understand one product and start the purchase.
- **Layout:** Product title (Syne) + price (large) → short description / what's included → producer mini-row (avatar + name) → payment-plan hint ("Full, or a plan — set after approval") → big amber **"Request to book"** at the bottom.
- **States:** Default. Pressed. (If the artist already has a request pending, the button is **disabled** with "You have a request in review — finish that first.")
- **Primary action:** "Request to book" → review & sign contract (S4).
- **Notes:** Tell the artist gently that **the price locks now**, at request time. No payment happens yet — this just sends a request to the producer.

---

## SECTION 2 — Commit  *(Chat 2)*

### S4. Review & sign contract  *(new)*
- **For:** Agree to terms before the request is sent. (Inline checkbox agreement — NOT a PDF signer.)
- **Layout:** Title "Review & agree" → scrollable terms text in a white card (cancellation policy, that money is handled off-app per this agreement, deposit usually final) → a single checkbox "I've read and agree" → amber **"Send request"** (disabled until checked).
- **States:** Checkbox unchecked (button disabled). Checked (button active). Sending (button shows progress).
- **Primary action:** "Send request" → request sent (S5).
- **Notes:** The agreement text + a timestamp are saved for the record. Keep the terms readable, not a wall of legalese.

### S5. "Request sent" — waiting on the producer  *(new)*
- **For:** Reassure the artist right after they send the request (Gate 1).
- **Layout:** Calm full-screen moment: a soft check/heart icon → "Your request is with [Producer]" → "They'll review it within 24 hours and reach out about payment." → secondary button "Back to [Producer]'s store".
- **States:** Single state.
- **Primary action:** "Back to store" (or auto-routes to Home).
- **Notes:** No payment details here yet — the producer reviews first. Quiet and confident, not a loading spinner.

### S6. Purchase status card (on Home `/artist`)  *(new)*
- **For:** The artist's home shows where their purchase stands. This is the heartbeat of the whole flow.
- **Layout:** A card titled "[Product] with [Producer]" + a **status pill** + a one-line "what's next" + a context action. Bottom tab bar visible (this is a standing app screen).
- **States (design ALL of these — they're the core of the flow):**
  1. **Pending review** (amber pill) — "Waiting for [Producer] to review your request."
  2. **Awaiting payment** (amber pill) — "[Producer] approved! They'll message you payment details." → button "Choose a payment plan" (→ S7).
  3. **Awaiting verification — proof attached** (amber pill) — "We sent your proof to [Producer]." (after POP upload)
  4. **Paid — sessions unlocked** (green pill) — "You're all set." → button "Book a session" (→ S10).
  5. **Couldn't be confirmed** (red/neutral pill) — polite generic: "Your request couldn't be confirmed at this time." No reason shown.
- **Primary action:** Changes per state (see above).
- **Notes:** While anything is pending, the artist can browse/listen but **can't start a second purchase**. Mirror these states by email too (out of scope to design, just know it).

---

## SECTION 3 — Pay  *(Chat 3)*

### S7. Choose a payment plan  *(new)*
- **For:** Pick how to pay, from the options THIS product allows (the producer sets them per product).
- **Layout:** Title "How would you like to pay?" → 1–3 selectable cards: **Pay in full** / **50–50 (half now, half later)** / **Milestones** (each card shows the amounts) → amber **"Continue"** at the bottom.
- **States:** Nothing selected (Continue disabled). One selected (card gets amber ring). If product only allows one plan, show just that, pre-selected.
- **Primary action:** "Continue" → payment instructions (S8).
- **Notes:** This is per-product — don't assume all three always show. Amounts in Syne or mono so they read precisely.

### S8. Payment instructions  *(new)*
- **For:** Show the artist how to pay (v1 = off-app), and set up the proof upload.
- **Layout:** Amount due now (large) → method: **Bank transfer / Bit** with the producer's details (or "Your producer will send details if not shown") + a copy button → a greyed **"Pay by card — coming soon"** row (v2) → helper line "Pay using your bank or Bit, then upload your proof." → amber **"I've paid — upload proof"** at the bottom.
- **States:** Details present vs "producer will send details". Copy-confirmation toast.
- **Primary action:** "I've paid — upload proof" → POP upload (S9).
- **Notes:** Money never moves inside the app in v1. The app is the record-keeper.

### S9. Upload proof of payment (POP)  *(new)*
- **For:** Artist uploads a screenshot/PDF of the transfer; producer verifies it (Gate 2).
- **Layout:** Title "Upload your proof" → a big drop/upload tile (camera + files) → the amount this proof covers → a list of any previous proofs with a **running total** ("Paid so far: ₪X of ₪Y") → amber **"Send proof"**.
- **States:**
  - Empty (no file yet — Send disabled).
  - File attached (preview thumbnail) → Send active.
  - Uploading.
  - **Awaiting verification** — "We sent it to [Producer]."
  - **Rejected** (red) — "Proof needs re-uploading" + the producer's optional note → re-upload (no limit).
  - **Paid in full** (green) — "Payment complete — sessions unlocked."
- **Primary action:** "Send proof".
- **Notes:** Accept JPG/PNG/HEIC/PDF. **Multiple proofs allowed** for installments. Sessions can be booked once approved per the plan, but **downloads stay locked until 100% paid** (see S13).

---

## SECTION 4 — Book  *(Chat 4)*

### S10. Pick date & time  *(partial — `/artist/book`)*
- **For:** Choose a session slot from the producer's real availability.
- **Layout:** Month/week calendar strip → available time slots as tappable chips for the chosen day → a summary line (product + duration) → amber **"Request this slot"** (or **"Book this slot"** if auto-approve is on).
- **States:** Loading slots. No slots that day (empty: "No times here — try another day"). Slot selected (amber). After tap: **slot held while pending** ("Holding this time while [Producer] confirms").
- **Primary action:** "Request / Book this slot" → confirmed (S11).
- **Notes:** Gate 3 (session approval) is a producer toggle. If ON (default) the slot is held pending approval; if OFF it books instantly. Single timezone (Israel) in v1. Google Calendar sync = v2.

### S11. Session confirmed + My sessions  *(partial)*
- **For:** Confirm the booking and show upcoming sessions.
- **Layout:** Confirmation moment (green check + "You're booked — [date] at [time]") → "Add to calendar" (v2, greyed) → below: **My sessions** list (each: date, time, product, status pill). Bottom tab bar visible.
- **States:** Confirmed vs "held — pending approval". Empty sessions ("No sessions yet").
- **Primary action:** View a session → its detail (S12).
- **Notes:** Reminders go out 24h and 1h before (email/app — not a screen to design).

### S12. Cancel / reschedule a session  *(new)*
- **For:** Change a session within the rules.
- **Layout:** Session detail → two buttons "Reschedule" / "Cancel".
- **States:**
  - **Within policy** (e.g. >X hours before): self-serve — pick a new slot / confirm cancel; "[Producer] will be notified."
  - **Outside policy** (too close): buttons **disabled** with "Too close to the session — message [Producer] to change it."
- **Primary action:** Reschedule (→ slot picker) or Cancel (→ confirm).
- **Notes:** The time-policy controls the **action only**, not money. Refunds/deposits follow the signed contract, off-app. Cancellation window is set per product.

---

## SECTION 5 — Receive  *(Chat 5)*

### S13. Music library — download LOCKED (safety guard)  *(extends `/artist/music`)*
- **For:** The producer delivered songs, but the artist hasn't fully paid, so downloads are locked.
- **Layout:** Project/song list. Each song: title, waveform/play (streaming is fine) + a **lock icon** where download would be → a banner "Downloads unlock when payment is complete — ₪X of ₪Y paid" → button "Complete payment" (→ back into S8/S9) and, if on a plan, the **next payment due date**.
- **States:** Locked (default here). If a milestone is overdue: a warning line "A payment is overdue — future sessions are paused until it's settled."
- **Primary action:** "Complete payment".
- **Notes:** The **download** is the gated thing — listening/streaming can be allowed. This is the safety guard for the producer.

### S14. Music library — download UNLOCKED  *(extends `/artist/music`)*
- **For:** Fully paid — the artist owns the songs.
- **Layout:** Same list, but each song now shows a **download** button; banner becomes a quiet green "Paid in full — these are yours." Optional "Download all".
- **States:** Default unlocked. Downloading (progress on a song).
- **Primary action:** Download.
- **Notes:** Calm celebration, not confetti. This is the happy end of the journey.

---

# Business rules (the "why" behind the screens)

From the board's 6 rules + the 2026-06-07 refinements. These OVERRIDE older notes:

1. **Payment plan is per product** — full / 50–50 / milestones. The producer chooses what each product allows.
2. **Download is the safety guard** — the song **download** is locked until paid in full. Sessions can still run on a deposit/plan. A milestone overdue → pause future sessions.
3. **Money is off-app, governed by the signed contract** — deposit is usually final. The cancel time-policy controls the **action**, not refunds.
4. **Cancellation/reschedule policy is per product** — set as hours-before-session.
5. **Notifications** — every key step pings the artist by **app + email**. (Tax invoice via Green Invoice = v2.)
6. **Single timezone (Israel) in v1.**

**Three producer gates shape the artist's experience** (the artist only ever *waits* at these — the producer acts elsewhere):
- **Gate 1** — producer approves the purchase request (before payment). If no answer, producer gets a 24h reminder. Decline → polite generic message to artist.
- **Gate 2** — producer verifies the proof of payment. Reject → artist re-uploads.
- **Gate 3** — session approval (toggleable; default auto-approve ON).

**No gate at signup** — anyone with the link can sign up; Gate 1 is where a wrong-fit request gets declined.

---

# Assumptions (correct me if wrong)

- Funnel screens have a back arrow and no bottom tab bar; standing app screens (Home/Music/Book/Store/Settings) have the bottom tab bar.
- Store browse, sign-in, and the music library shell already exist — the prototype includes simple versions so it clicks through, but the new design work is the purchase → pay → POP → book → delivery screens.
- "Sign in / sign up" uses Clerk's UI — not designed here, just a step in the flow.
