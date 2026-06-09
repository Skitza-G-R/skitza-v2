# Producer Approval Gates — Design

**Date:** 2026-05-27
**Status:** Design approved by Gili — ready for implementation plan
**Context:** Defines how many producer-approval touchpoints exist in the artist's purchase + booking flow on `/join/[slug]`. Replaces the partial model in PRD §6 (Intro Session Approvals) with a fuller model.

---

## Problem

Gili's question: "How many times in the flow does the producer need to approve? I'm not sure I want to let everybody pay/purchase my services, on the other hand I want to keep automatic."

The PRD currently has:
- **No gate** before signup or purchase
- **Intro Session Approval queue** for the *first* booking only (toggleable via "Automatic Approval")

The PRD's design assumes `/join/[slug]` is a public funnel. But Gili clarified she sees `/join/[slug]` as a **private invite link** — producer hand-picks who gets it. That changes where the gate belongs.

Worry being solved: **bad-fit clients** (wrong genre, wrong scope, wrong fit). Not capacity, not reputation, not safety — though all are partial side-benefits.

---

## Decision

**Two mandatory producer-approval gates per purchase, plus one optional session toggle:**

| Gate | When | Mandatory? |
|---|---|---|
| **Gate 1 — Purchase Request Approval** | After artist clicks Purchase, before payment instructions are sent | ✅ Always on |
| **Gate 2 — Proof of Payment Verification** | After artist uploads POP screenshot, before product unlocks | ✅ Always on (v1 manual). Replaced by Stripe in v2. |
| **Gate 3 — Session Approval** | After artist picks a session slot | Toggleable (matches PRD §6 "Automatic Approval"). Default = ON (auto-approve). |

**No gate at signup.** Anyone with the link can sign up. This catches the forwarded-link case via Gate 1 (purchase) rather than at signup, because:
- Signup with no gate avoids dead-account purgatory
- The purchase moment is where commercial commitment crystallizes (which product, what scope, what budget)
- A forwarded-link stranger can sign up freely; on first purchase attempt, producer declines

---

## Flow — v1

```
Anonymous → /join/[slug] → listen → click "Book a session" → SIGNUP
   ↓
Land on Store with Intro Session pre-selected
   ↓
Click "Purchase"
   ↓
[GATE 1: Producer reviews request]
   ↓
Producer approves → status = "awaiting payment"
   ↓
Producer messages artist on WhatsApp / email with payment details (out of band)
   ↓
Artist pays externally (Bit, bank, etc.)
   ↓
Artist uploads POP screenshot inside Skitza (NOT WhatsApp)
   ↓
[GATE 2: Producer verifies POP]
   ↓
Status = paid → product unlocked in Bookings
   ↓
Pick session date + time
   ↓
[GATE 3: Session approval — toggleable, default auto-approve]
   ↓
Session confirmed
```

**Producer touch count per scenario (v1):**

| Scenario | Touches |
|---|---|
| New artist, first purchase + first session | 2–3 (Gate 1 + Gate 2 + optional Gate 3) |
| Returning artist, new purchase + session | 2–3 (same) |
| Returning artist, new session on existing project | 0–1 (just Gate 3 if toggle off) |

---

## UI placement

**Producer side:**
- **Calendar page** — expand the existing "Intro Session Approvals" section into a general **Approvals** section with two sub-lists:
  - **Pending Purchases** (Gate 1 + Gate 2)
  - **Pending Sessions** (Gate 3)
- **Overview page** — small card `Pending approvals (N)` → click jumps to Calendar approvals.

**Artist side:**
- After Purchase click: interstitial "Your request is with [Producer]. They'll review it within 24 hours and reach out to you about payment."
- On /artist dashboard: card "Purchase pending — [Product] with [Producer]" with status states:
  - `Pending review` — waiting on Gate 1
  - `Awaiting payment` — Gate 1 passed, producer reached out
  - `Awaiting verification — POP attached` — POP uploaded, waiting on Gate 2
  - `Paid — sessions unlocked` — Gate 2 passed
  - `This request couldn't be confirmed` — declined (polite generic message)
- POP upload affordance on the pending card. Multiple POPs allowed for installments. File types: JPG, PNG, HEIC, PDF.

---

## POP (Proof of Payment)

- Lives **inside Skitza**, not WhatsApp. WhatsApp = chatting; Skitza = bookkeeping.
- Stored as attachment on the project's Payments & Agreements branch (per PRD §9).
- **Multiple POPs allowed** for installments / partial payments. Each POP records an amount. System tracks running total.
- **Product unlocks ONLY when total = 100%.** Half-paid product = sessions still locked. Rationale: a session represents committed work; producer is exposed if booked at 50%.
- Producer can **reject a POP** with an optional note → artist re-uploads. No re-upload limit.
- Every upload preserved as history (audit trail).

---

## Edge cases — locked defaults

1. **Producer never responds to Gate 1.** Status stays "Pending review" indefinitely. Reminder email to producer at 24h. No auto-decline.
2. **Producer rejects POP.** Optional reason note → artist sees "Proof needs re-uploading" + the note → re-upload. No limit.
3. **Partial payment unlock.** All-or-nothing: product unlocks at 100% paid only. Booking button disabled until then.
4. **Artist tries to book before fully paid.** Book button disabled with tooltip "Available when payment is complete."
5. **Producer accidentally declines.** 5-minute undo window via toast. After 5 min, decline is final (email already sent to artist).

---

## What the artist sees on decline

Polite generic message only: *"Your request couldn't be confirmed at this time."* No reason given. No producer note. Protects producer from awkward back-and-forth and reduces emotional friction.

---

## What the artist can do while pending

- Listen to portfolio + browse other products (read-only exploration).
- Cannot initiate a second purchase until the first one resolves.

---

## v2 changes (post-Stripe, future)

When Stripe arrives:
- Gate 2 (POP verification) is **replaced by Stripe**. Producer no longer manually verifies — Stripe handles payment capture.
- Gate 1 (Purchase request approval) **stays**. Implementation: Stripe Checkout in *auth-then-capture* mode. Artist authorizes payment → producer approves → Skitza captures via Stripe. If producer declines, no capture occurs (no refund logic needed).
- POP-as-attachment pattern stays usable for **offline payments**, **partial payments**, and **dispute records**.

---

## What this changes in the PRD

- **§5 Pricing / §6.2 Store:** Add Gate 1 (Purchase Request Approval) as the first step after the artist clicks Purchase, before any payment flow.
- **§6 Producer / Calendar page:** Rename "Intro Session Approvals" → "Approvals" with two sub-lists (Purchases + Sessions). Existing "Automatic Approval" toggle continues to apply to Sessions sub-list only (Gate 3).
- **§8 Booking Flow / Payment placeholder:** Update v1 description to: "Booking creates a project with `invoice.status='pending_approval'`. Producer approves request → status becomes `awaiting_payment`. Producer messages artist with payment instructions out-of-band. Artist uploads POP in-app. Producer verifies POP → status becomes `paid`. Product/sessions unlock."
- **§9 Project Model / Payments & Agreements branch:** Add POP attachments as a first-class entity. Each POP records: file (image or PDF), amount, uploaded-by (artist), verified-by (producer), verified-at, status.
- **Reverse D7 partially:** `/join/[slug]` stays as the only share URL (no per-recipient tokens), but is reframed as a **private invite link**, not a public funnel. Discovery happens off-platform.

---

## Open items deferred to later

- **Deposit-unlocks-booking** model (50% upfront secures the date, final 50% gates delivery). v1 = all-or-nothing. Worth revisiting when first producer asks.
- **Payment-instructions templates in Settings** (producer pre-fills bank details, system auto-fills on approval message). v1 = producer types each time. Build only when producers repeat themselves.
- **Refund logic.** v1 ignores. Producer handles out-of-band with the artist.
- **Multi-producer artist sees one queue across all producers.** v1 may be fine since most artists are with 1–2 producers max.

---

## Success criteria

- A new artist with a forwarded link can sign up but cannot purchase without producer's explicit approval.
- A $50K album purchase request lands in producer's Calendar approvals with full scope visible before any money moves.
- Producer can decline a request in one click; artist sees a polite generic message.
- POP screenshots live on the project, searchable later, not lost in WhatsApp.
- For an existing trusted client buying an additional session on an existing project, producer touches the flow **0–1 times** (session toggle only).
