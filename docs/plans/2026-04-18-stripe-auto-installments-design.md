# Stripe Auto-Installments — Design

**Feature:** Automated recurring payment plans so producers never chase a client for "payday" again.

**Context:** Skitza's product model already captures `depositModel` and `milestones` as data, but nothing in the app *executes* those plans — every charge today is a one-time Stripe Checkout. This design adds the execution layer: saved payment methods, event-triggered charges for split-on-delivery plans, and date-scheduled charges for monthly installments.

---

## Goals

1. A producer configures a product once ("₪10K, offer pay-in-full / 50-50 / 4 monthly") and never thinks about collection again.
2. A client picks a plan at checkout; Stripe charges them on schedule without further interaction.
3. Failed charges pause the project (lock new bookings) but keep existing work accessible.
4. The producer's only manual touchpoint is a single "Confirm & charge ₪X?" modal when marking a mix as final delivered.

## Non-goals (for this milestone)

- Custom milestone builder (deferred — 3 plan shapes cover the user's described flow)
- 50/25/25 mid-milestone triggers (deferred — adds UI complexity for low MVP value)
- In-app refund UI (deferred — producer uses Stripe Dashboard; policy lives in the contract)
- Mid-flight plan changes (explicitly disallowed — cancel + restart if needed)
- Multi-currency per producer (MVP is one currency per Connect account)

---

## Key design decisions (confirmed)

| Question | Answer |
|---|---|
| Final charge on "mark complete": auto or confirm? | **Confirm.** Modal: "Charge Dan ₪5,000 now?" |
| Which plan shapes in MVP? | **3 shapes**: full / 50-50 / N-monthly |
| Failed retries exhausted — then what? | **Pause project**: lock new booking, keep music + comments accessible, auto-resume on successful card update |
| Producer cancels project mid-plan? | **Stop future charges.** No in-app refund logic (cancellation terms live in the contract) |

## Chosen approach

**Hybrid Stripe primitive per trigger type:**

- **Pay in full** → one-time Checkout (already works, unchanged)
- **50/50 split** → Checkout `mode: payment` with `setup_future_usage: 'off_session'` saves the card; final 50% fires as off-session `PaymentIntent` when producer marks mix as final
- **Monthly installments** → Checkout `mode: subscription` attached to a server-created **Subscription Schedule** with N monthly phases; Stripe handles the schedule, smart retries, and card-update emails

Rejected alternatives:
- *All via Subscription Schedules* — schedules are time-based only; 50/50 is event-triggered, so fitting it into a schedule requires awkward "release phase on demand" patterns that fight the API.
- *All via manual PaymentIntents + Skitza cron* — re-implements retries, dunning, and card-update flows that Stripe provides for free. Forces Skitza to own recurring-billing reliability, which is deeply unfun.

---

## Data model

### `projects` — new columns

One plan per project. No separate `payment_plan_instances` table — one-to-one relationships don't justify a join.

```ts
payment_plan_kind              // 'full' | 'split_50_50' | 'monthly' | null
installments                   // integer 2..12, null for non-monthly
stripe_customer_id             // Stripe Customer for this (producer, client) pair
stripe_payment_method_id       // saved card reference
stripe_subscription_schedule_id // only for 'monthly', null otherwise
charges_completed              // count of successful charges
charges_total                  // full=1, split_50_50=2, monthly=installments
next_charge_at                 // only for 'monthly' — drives reminder UX
```

### `project_stage` enum — new value

Add `'payment_paused'` to the existing stage enum. When monthly retries exhaust, project flips here; client sees the update-payment banner, self-booking locks.

### `products.payment_plans` — new column

```ts
payment_plans: jsonb           // PaymentPlan[]

type PaymentPlan =
  | { kind: "full" }
  | { kind: "split_50_50" }
  | { kind: "monthly"; installments: number }  // 2..12
```

Producer ticks which plans this product offers. Client picks one at checkout from the offered set.

Migration: existing rows default to `[{ kind: "full" }]` so legacy products keep working.

### `invoices.kind` — new valid value

Add `'installment'` to the accepted set. One invoice row per actual charge — a monthly × 4 plan produces 4 invoice rows over 4 months, each linked via new nullable `payment_plan_project_id` FK to `projects.id`.

---

## Payment flow

### Shape: Pay in full
Unchanged. Checkout `mode: payment` → webhook marks project `active`.

### Shape: 50/50 split

1. Client picks 50/50 on plan picker
2. Server creates Checkout session with:
   - `mode: payment`
   - `amount: total / 2`
   - `payment_intent_data.setup_future_usage: 'off_session'`
3. Client pays 50% via Stripe-hosted checkout
4. Webhook `checkout.session.completed`:
   - Save `stripe_customer_id`, `stripe_payment_method_id` on project
   - `charges_completed = 1`, `charges_total = 2`
   - Project stage → `active`
   - Client may now self-book
5. Project work happens (sessions, mixes, comments) — days to months later
6. Producer clicks "Mark final delivered" on a track version
7. Modal: "Charge Dan ₪5,000 now?" — Confirm
8. Server creates off-session PaymentIntent with saved PaymentMethod + idempotency key `proj_<id>_charge_2`
9. Webhook `payment_intent.succeeded`:
   - `charges_completed = 2`
   - Project stage → `paid`
   - Email both parties

### Shape: Monthly × N installments

1. Client picks monthly on plan picker
2. Server creates Stripe Subscription Schedule server-side with N phases, each `duration: 1 month, iterations: 1`, total = product price
3. Redirect to Checkout `mode: subscription` attached to that schedule
4. First charge fires at Checkout completion
5. Webhook `checkout.session.completed` (subscription mode):
   - Save customer + payment method on project
   - `charges_completed = 1`, `charges_total = N`
   - `next_charge_at` = month 2 anchor
   - Project stage → `active`
6. Each subsequent month: Stripe auto-charges → `invoice.paid` webhook:
   - `charges_completed += 1`
   - Insert `invoices` row, email receipt
   - Update `next_charge_at` to the following month
7. When `charges_completed === N`: Schedule ends → `customer.subscription.deleted` webhook → project stage → `paid`

### Stripe Customer reuse

One Stripe Customer per `(producer_id, client_contact_id)` pair. Created lazily on first payment. Stored in a new `stripe_customers` join table:

```ts
stripe_customers (
  producer_id, client_contact_id, stripe_customer_id, created_at
)
```

Subsequent projects for the same client reuse the same Customer → saved cards carry across projects.

### One-way rule

Once first charge succeeds, plan cannot change. If a party wants to switch, cancel the project and start a new one. Prevents state-machine tangles (e.g., halfway-through monthly → can we switch to 50/50?).

---

## UI

### Producer

1. **Product editor — Payment plans section**
   Checkboxes: `☑ Pay in full / ☑ 50/50 / ☑ Monthly [N]`. Producer saves → updates `products.payment_plans`.

2. **Project room — payment status strip**
   Compact strip near top of project view:
   `₪10,000 · 4 monthly × ₪2,500   ●●○○  2/4 paid  ·  Next: May 18`
   Hover a dot → tooltip with charge date + invoice link.

3. **"Mark final delivered" confirmation modal** (50/50 only)
   Shown before charging the final installment. Cancel or confirm.

4. **"Cancel project" button** on project settings
   Red, gated behind a name-confirm prompt. Cancels Stripe Schedule, sets project `cancelled`.

### Client

1. **Plan picker** — shown after contract signed, before Stripe redirect. Radio buttons for the plans the producer offered on that product.

2. **Project dashboard strip** — same dots as producer sees, plus "Next payment: May 18 — ₪2,500 on card ending 4242" and a "Update payment method" link that deep-links to Stripe Customer Portal.

3. **Paused state banner** — shown on every client surface when project `payment_paused`. Music + past mixes still accessible. New bookings + session requests blocked.

### Explicit non-UI

- No "resume paused project" button (auto-resumes on successful charge)
- No in-app refund flow (producer uses Stripe Dashboard)
- No "change plan mid-flight" option (one-way rule)

---

## Webhooks + failure handling

### Events handled

| Event | Action |
|---|---|
| `checkout.session.completed` | First charge landed. Save customer + PM, insert invoice, activate project |
| `invoice.paid` | Recurring installment succeeded. Increment counter, insert invoice, email receipt |
| `invoice.payment_failed` | No app action — Stripe handles retry + update-card email |
| `customer.subscription.deleted` | Schedule ended. `completed` → project `paid`; cancelled → project `cancelled` |
| `payment_intent.succeeded` | Off-session final charge landed. Insert invoice, project → `paid` |
| `payment_intent.payment_failed` | Off-session charge declined. Alert producer synchronously; no auto-retry |
| `charge.refunded` | Mirror status on invoice row (existing handler) |

### Monthly failure path

1. Charge fails → Stripe retries 3× over ~7 days (Smart Retries, built-in)
2. All retries fail → webhook event with subscription set to `cancel_after_final_attempt` behavior
3. Our handler sets project stage → `payment_paused`
4. Client sees banner → clicks "Update payment method" → Stripe Customer Portal
5. Client updates card → Stripe retries failed invoice → `invoice.paid` fires
6. Our handler flips project back to `active`

### Off-session (50/50 final) failure path

Different because the producer initiated:
1. Producer clicks "Confirm & charge"
2. Server calls `PaymentIntent.create({ off_session: true, confirm: true })`
3. If declined synchronously → UI shows error: "Card declined (reason). Ask Dan to update his payment method."
4. Producer clicks "Send update-card link" button → emails client a Stripe Customer Portal URL
5. Once updated, producer retries the charge manually

No auto-retry on producer-triggered PaymentIntents — the producer knows immediately and can act.

### Idempotency

Every charge uses idempotency key `proj_<id>_charge_<n>`. Duplicate webhooks or producer double-clicks produce the same key → Stripe returns the original PaymentIntent instead of charging twice.

---

## Testing

### Unit (Vitest)

- `choosePaymentPlan(product, selection)` — returns Stripe params for selected plan
- `calculateCharges(plan, total)` — returns breakdown array
- `advancePlanState(project, event)` — pure state transition, easy to fuzz
- Invariant: `charges_completed ≤ charges_total` never violated

### Integration (Stripe test mode + test clocks)

1. Monthly plan project → advance test clock 31 days → assert `invoice.paid` webhook + counter increment
2. Card `4000000000000341` (fails on first) → advance clock → assert retries → project `payment_paused`
3. Update payment method → assert Stripe auto-retries → project resumes `active`
4. 50/50 with decline on off-session final → assert error surfaced to producer

### Manual QA checklist

Run before shipping:
- [ ] Pay in full, Israeli card
- [ ] 50/50 happy path
- [ ] 50/50 with declined off-session final
- [ ] Monthly × 4, test clock through full schedule
- [ ] Monthly card failure on month 3 → pause behavior
- [ ] Cancel project mid-monthly → verify Schedule cancelled in Stripe Dashboard

### Not tested at MVP

- Real ACH settlement (real days of wait time)
- Apple Pay UI (manual visual test only)
- Multi-currency edge cases

---

## Dependencies

- Stripe SDK ≥ current pinned version — already installed
- Stripe Subscription Schedules API — GA, no feature flag needed
- Stripe Customer Portal enabled on Connect account — one-time setup per producer
- Webhook endpoint configured (exists, just add new event types)
- `STRIPE_WEBHOOK_SECRET` env var (exists)

## Effort estimate

3–5 focused days:
- Day 1: schema migration + product editor UI
- Day 2: plan picker + Checkout integration for all 3 shapes
- Day 3: webhook handlers + failure/pause logic
- Day 4: producer-side project room strip + confirm modal
- Day 5: tests + manual QA + docs

## Follow-on work (explicitly out of scope)

- 50/25/25 + custom milestone builder
- Mid-milestone event triggers (requires `mid_milestone_delivered` project event)
- In-app refund UI
- Multi-currency per producer
- Promo codes / discounts at checkout
