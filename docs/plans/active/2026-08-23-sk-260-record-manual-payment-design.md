# SK-260 — Record a manual payment (+ receipt) from the project Payments tab

> Linear: https://linear.app/raz-stamper/issue/SK-260
> Status: design locked 2026-08-23, building.

## Why

A producer working with a non-technical client gets paid in cash, by bank transfer, or by Bit.
Today only the artist can upload a proof, so the producer has no way to mark that money as received.
The server already exposes `purchaseLedger.recordManualPayment` — nothing in the UI calls it.

## What the producer sees

**Payments tab (project page)**

- A primary **Record a payment** button at the top of the tab. Full-width on phones, right-aligned
  next to a one-line summary on desktop ("2 payments open · ₪1,500 left" / "Nothing is waiting").
- Desktop drag & drop: dragging a receipt (JPG/PNG/WEBP/HEIC/PDF, ≤15 MB) over the tab shows a
  dashed amber overlay — "Drop the receipt to record a payment". Dropping opens the form with the
  file attached. Unsupported files get a toast, nothing else changes.
- The button is hidden (replaced by a quiet line) when no installment can take a payment.

**Record a payment form** — centered dialog on desktop, bottom sheet (`.sk-sheet-mobile`) on phones.

1. **Which payment?** — radio cards, one per open installment across the project's purchases:
   product name · "Payment 2 of 3" · amount left · due date. Auto-selected when only one is open.
   Not-due-yet installments render disabled ("Not due yet"). Installments with a proof waiting for
   review render disabled with a "Review the proof" link — the producer should confirm/reject that
   proof instead of double-recording.
2. **Amount** — prefilled with the remaining balance; "Full amount" chip; must be 1…remaining.
   Partial payments allowed (installment becomes _Partially paid_).
3. **Date received** — defaults to today, cannot be in the future.
4. **How they paid** — chips: Cash / Bank transfer / Bit / PayPal / Other. Optional note (one line).
   Both are stored in the payment `note` as `"Bank transfer — ref 8841"`. No new columns.
5. **Receipt (optional)** — dashed drop zone / tap to choose (opens camera roll on phones).
   Image preview or PDF chip with name + size, remove ×.
6. Footer: Cancel · **Record ₪750**. While working: "Uploading receipt…" → "Recording…".
   One calm line under the button: "Your client will see this as a confirmed payment."

After success: toast "Payment recorded — Payment 1 is paid", `router.refresh()`, dialog closes.

## What it affects (outcome)

- A `purchase_payments` row with `source = 'manual'` (existing table, existing ledger rules).
- If a receipt was attached: a `payment_proofs` row inserted directly as `confirmed`
  (`confirmed_at = now`), linked via `purchase_payments.proof_id`. Stored in the private `docs`
  bucket through the same presign → PUT → finalize pipeline the artist flow uses.
- Ledger reconciliation runs as usual: installment → `confirmed` / `partially_paid`; purchase
  → `active` when the activation installment is covered; download/session gates follow.
- Client side: the existing "Payment confirmed" email (`sendProofVerifiedEmail`) + push.
  In-app notification only when a receipt exists (notification kinds are a DB enum; no migration).
- Producer history shows "Recorded manually" (already rendered) and the receipt under Proofs
  with a "View proof" link (already rendered).

## Guard rails (server)

- Producer-scoped: purchase must belong to `ctx.producerId`.
- Rejects canceled purchases, canceled/waived installments, installments not yet due,
  installments with a pending proof, amounts above the remaining balance, closed studios.
- Idempotent by `operationKey` (UUID generated per form submission) — retries never double-record.
- Upload token is bound to the producer's Clerk id + purchase + installment; staging objects are
  cleaned up on cancel/failure, exactly like the artist path.

## Files

- `server/domain/payment-proofs/producer-manual-payment.ts` — new domain module
  (`prepareProducerReceiptUpload`, `cancelProducerReceiptUpload`, `recordProducerManualPayment`).
- `server/domain/payment-proofs/service.ts` — export a few existing private helpers (no logic change).
- `server/trpc/routers/purchase-ledger.ts` — `presignManualReceipt`, `cancelManualReceipt`,
  `recordManualPayment` gains optional `uploadToken` + notifications.
- `app/(producer)/dashboard/clients-projects/actions.ts` — three server actions.
- `components/dashboard/payments/record-payment-model.ts` — pure form model (tested).
- `components/dashboard/payments/record-payment-dialog.tsx` — the form.
- `components/dashboard/project/album-tabs/project-payments-tab.tsx` — button + drop overlay.
- `components/dashboard/projects/project-purchases-panel.tsx` + project `page.tsx` — installments
  carry `remainingCents` + `hasPendingProof`.

## Out of scope

- Paying several installments in one go (ledger rule: an installment must be due first).
- Editing/deleting a recorded payment (corrections already exist on the ledger; not surfaced here).
- A new "payment recorded" notification kind (needs a migration).
