# Restore the artist payment-proof flow

**Date:** 2026-08-03  
**Status:** Approved direction; implementation has not started  
**Decider:** Gili Asraf  
**Development base and PR target:** `v3-clean`  
**Last inspected `origin/v3-clean`:** `648ca62498d9c24fe1441b6b7a1ed5c5711ae64e`

## Result we want

After an artist accepts a product, the payment flow must be simple again:

1. Show the amount, product, and producer.
2. Show the producer's Bank or Bit details when they exist.
3. If they do not exist, say that the producer will send the details directly.
4. In both cases, let the artist continue to upload a payment photo or file.
5. Show a clear error if **Send proof** cannot start or finish.
6. Let the producer easily find the proof and open the existing verification page.

Use the visual style of the old payment screens, but keep the newer secure
payment-proof system underneath.

## Gili's decision

The 2026-07-30 artist UI plan intentionally stopped artists from opening the
proof uploader until the producer had saved a Bank or Bit method. Gili's latest
decision changes that rule for this flow:

- missing Bank or Bit details must not block proof upload;
- show the honest fallback that the producer will send payment details
  directly;
- restore the clearer old payment-instructions and upload design;
- keep proof review inside **Payments**, but make it easy to reach from the
  accepted Request.

This plan supersedes only the conflicting "no payment method, no proof upload"
rule in `2026-07-30-artist-platform-professional-ui-ux.md`. The newer route,
security, ledger, and verification rules stay in place.

## What happened

There were two separate changes.

### 1. Producer verification moved

Commit `2eaaa758` moved proof review out of Requests and into the producer
Payments workspace.

The old Request proof-review components were removed. The replacement is still
present:

- `/dashboard/payments`
- `/dashboard/payments/[proofId]`
- confirm payment action;
- reject proof action and rejection note;
- dashboard and notification links to the exact proof.

This matches the PRD rule: Requests is for new work, while proof review belongs
in Payments. The problem is discoverability. On an accepted Request, the UI now
only says that later follow-up belongs in Payments. It does not give the producer
a clear proof-review action there.

### 2. The artist payment UI was replaced

Commit `2d2b3752` replaced the old payment screens with the current professional
artist UI. The old design can be inspected at commit `4eb84d34`, the parent of
that redesign.

The current code adds two hard gates:

- the instructions route redirects away when neither Bank nor Bit is saved;
- the new-proof route also redirects away for the same reason.

The current screen then hides **I've paid — upload proof** unless it finds a real
Bank or Bit method. This is why the old option appears to be gone.

## What is already in place

Do not rebuild or replace these parts:

- acceptance creates the Purchase and installment;
- the producer can save Bank transfer, Bit, and a payment note;
- artist proof files use private Cloudflare R2 upload URLs;
- proof upload has an opaque token and retry operation key;
- the amount is locked to the server-owned installment;
- proof history supports Awaiting, Confirmed, and Rejected;
- the producer can confirm or reject a proof in Payments;
- artist and producer route guards are already present;
- notifications and standing proof-record routes already exist;
- supported files are JPG, PNG, WebP, HEIC, or PDF, up to 15 MB.

No database schema change should be needed.

## Missing or broken behavior

### Confirmed gap: missing payment details block the artist

The following two routes redirect the artist back to the payment summary when
Bank and Bit are empty:

- `apps/web/src/app/(artist)/artist/payments/[purchaseId]/instructions/page.tsx`
- `apps/web/src/app/(artist)/artist/payments/[purchaseId]/proof/new/page.tsx`

The screen component also requires a payment method before showing its upload
button:

- `apps/web/src/components/artist/purchase/payment-instructions-screen.tsx`

### Confirmed robustness gap: upload startup errors can be invisible

The old upload screen wrapped `startManagedPaymentProofUpload(...)` in
`try/catch`. The current screen does not. The upload manager can throw before its
async callbacks start, for example when its browser runtime account is not ready.
In that case the artist can press **Send proof** and see no useful error.

Relevant file:

- `apps/web/src/components/artist/purchase/upload-proof-screen.tsx`

The implementation must reproduce this case with a focused test before fixing
it when practical. Do not assume it is the only reason for a live upload failure;
also run the real end-to-end flow.

### Confirmed UX gap: Request does not show the review action

An accepted Request knows its `purchaseId`, and the existing producer API can
list pending proofs for that purchase. Use that data to show a small, clear
**Review payment proof** action when a pending proof exists.

The action must open `/dashboard/payments/[proofId]`. Do not move the confirm or
reject form back into Requests.

## Implementation plan

### 1. Work safely from the correct base

- Read the complete Linear issue for this fix, or create one in project
  **Skitza v3**, team **Skitza (SK)** if none exists.
- Move it to **In Progress**.
- Fetch the latest `v3-clean` and use Linear's exact generated branch name.
- Use a separate worktree. The shared workspace is currently on an unrelated,
  dirty SK-82 branch and contains user-owned edits, including overlapping
  payment files.
- Never discard, stage, or copy those unrelated changes into this work.

### 2. Restore the old payment-instructions presentation

Use commit `4eb84d34` as the visual reference, not as a file-level revert.

Restore the useful parts:

- dark, clear **Amount due now** card;
- product and payment-plan context;
- readable Bank transfer and Bit cards with copy controls;
- producer payment note;
- the fallback card: the producer will send payment details directly;
- pinned **I've paid — upload proof** action.

Keep the newer behavior:

- canonical `/artist/payments/...` routes;
- focused artist process chrome;
- no card-payment UI;
- no claim that Skitza processes money;
- one current installment chosen by the server;
- online/offline protection.

Remove the Bank/Bit redirect from the instructions page. The upload action should
depend on `proofUploadsAvailable`, a valid destination, and connection state—not
on whether a Bank or Bit method exists.

### 3. Let the new-proof route open without Bank or Bit

Remove only the payment-method check from the new-proof page. Keep all existing
guards for:

- signed-in artist ownership;
- valid purchase and installment;
- proof uploads being available;
- redirecting an existing Pending or Confirmed proof to its standing record.

A payment note alone is not a Bank or Bit method, but it may still be displayed.
Its presence or absence must not decide whether proof upload is allowed.

### 4. Restore the useful old upload design without old business logic

Use the old screen as a visual reference for:

- a clear photo/file drop area;
- selected-file preview;
- obvious upload state;
- pinned **Send proof** action;
- local, visible errors.

Keep the newer secure rules:

- the installment amount stays locked by the server;
- do not restore an artist-editable payment amount;
- preserve the opaque upload token, private R2 flow, cleanup, and retry key;
- successful submission goes to the exact standing proof record;
- previous proof history stays secondary;
- do not restore the old route structure.

Wrap synchronous upload startup in error handling. If startup throws, return the
screen to a retryable state and show a simple error. Keep the selected file so
the artist can try again.

### 5. Make producer verification easy to find

On an accepted Request:

- query pending proofs using its accepted `purchaseId` and the already scoped
  producer procedure;
- when one proof is pending, show **Review payment proof** linking to the exact
  `/dashboard/payments/[proofId]` page;
- if more than one proof can be pending, show each exact proof or a small count
  with clear exact links;
- when none are pending, do not show a fake verification action.

Keep confirmation and rejection inside Payments. Preserve producer scoping.

### 6. Add regression tests

At minimum, cover:

- Bank details present: instructions and upload action both render;
- Bit details present: instructions and upload action both render;
- no Bank/Bit details: fallback copy and upload action still render;
- no Bank/Bit details: direct new-proof route is allowed;
- `proofUploadsAvailable === false`: upload remains unavailable;
- pending or confirmed proof: no duplicate uploader opens;
- upload startup throws synchronously: the artist sees an error and can retry;
- upload callback failure: the artist sees an error and keeps the selected file;
- accepted Request with a pending proof: exact Payments review link renders;
- another producer's proof cannot be linked or opened;
- no pending proof: no misleading review button.

Update the current test that says the artist must never enter proof upload
without a producer method. That test now describes the behavior Gili changed.

### 7. Verify the real flow

Run the full flow with real app routes and a disposable test image:

1. Producer has Bank or Bit details; artist accepts; instructions render.
2. Artist uploads proof; the exact Awaiting record renders.
3. Producer opens the exact proof from Payments and confirms it.
4. Artist sees Verified and the correct next action.
5. Repeat the entry and upload check with both Bank and Bit empty.
6. Check the rejection and replacement path.

Also verify desktop, true 390px, and true 360px. Confirm there is no horizontal
overflow, console error, failed same-site request, or dead button.

Before claiming completion, run `$skitza-verify` and report every baseline or
environment failure exactly. The existing development proof preview is mocked;
it is not enough by itself to prove the R2/database loop.

## Acceptance criteria

- An eligible artist can always reach payment instructions after acceptance.
- Missing Bank/Bit details show honest fallback copy and do not block upload.
- The restored screens clearly resemble the old payment experience while using
  the current design tokens and button rules.
- A supported photo or PDF can be selected, previewed, and submitted.
- **Send proof** never fails silently.
- A successful proof creates only one record and opens its Awaiting page.
- The producer can find the pending proof from Payments and from the accepted
  Request's exact review link.
- Confirm and reject still happen only in Payments.
- Verification updates the artist's payment state and next action correctly.
- Existing authorization, private evidence, locked amount, retry safety, and
  history are preserved.
- Focused tests, `$skitza-verify`, and browser checks pass before handoff.

## Out of scope

- in-app card payment;
- Stripe, Tranzila, or another payment processor;
- database redesign or migration;
- moving proof confirmation back into Requests;
- changing installment amounts or payment-plan rules;
- unrelated artist-platform or producer-platform redesign;
- merging, production migration, deployment, or promotion without Gili's
  separate approval.

## Source references

- Current product rules: `docs/product/PRD.md`, especially sections 4 and 11.
- Current artist UI plan:
  `docs/plans/active/2026-07-30-artist-platform-professional-ui-ux.md`.
- Old payment UI reference: commit `4eb84d34`.
- Artist UI replacement: commit `2d2b3752`.
- Producer proof-review move: commit `2eaaa758`.
- Current producer review screen:
  `apps/web/src/components/dashboard/payments/payment-proof-review.tsx`.
- Current private proof lifecycle:
  `apps/web/src/server/domain/payment-proofs/`.
