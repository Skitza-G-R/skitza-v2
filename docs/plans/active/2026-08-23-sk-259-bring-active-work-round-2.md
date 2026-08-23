# SK-259 — Bring in active work, round 2 (Gili's review, 22–23 Aug 2026)

Linear: SK-259. Base: `origin/v3-clean` 16cb4938. Branch:
`giasraf/sk-259-fix-bring-in-active-work-round-2-issues-from-gilis-review`.

## What Gili reported

1. "Add item" should read **Add new client**, be a real primary button, and sit in the
   header next to **Review N ready items**.
2. **Existing agreement terms** must not be mandatory, and there is no way to upload the
   agreement as a PDF.
3. Proof of payment takes two clicks (Add proof → choose file). Wanted: one drag-and-drop
   box under the payment line that also opens the file picker on click.
4. Deleting a just-added item (trash icon) opens the previous, already-saved item in the
   editor. It should open nothing.
5. The review page opens the first row fully expanded. Rows should start collapsed and
   expand on click.
6. **Create N ready items** is slow.
7. **Finish setup** shows "Something went wrong on our side. Please try again." and blocks.

## Root causes found

- **4** — `removeRow` in `active-work-import-workspace.tsx` re-selects the row at the
  deleted index (or the last row). Fix: clear the selection.
- **5** — `ReviewAndFinish` falls back to `reviewEntries[0]` when nothing was clicked.
  Fix: no fallback; clicking the open row collapses it.
- **6** — Each created item runs ~30 sequential database round-trips (client, project,
  purchase, installments, attestation, ledger entries, reconcile) and Vercel (iad1) talks
  to Neon (Frankfurt) at ~100 ms per trip. SK-258 (PR #381, fra1 + no per-read
  transactions) removes the latency. Here: honest progress copy while creating.
- **7** — The invitation email failed with
  `TypeError: Cannot convert argument to a ByteString because the character at index 26
  has a value of 8594`. 8594 is "→". The only header carrying env data is
  `Authorization: Bearer <RESEND_API_KEY>`; "Bearer " is 7 chars, so index 26 is the key's
  20th character. The stored key is `re_` + 16 chars + "→" + 10 chars (30 chars; a real key
  is longer). `new Resend(key)` throws before any request, so **no Resend email has ever
  left production**. Other senders swallow the error; Finish setup rethrows unknown errors
  and shows the generic message. Fix in code: validate the key in `getResend()` and report
  it as an `EmailDeliveryError` so Finish setup records a per-client failure ("email
  service not set up"), still turns reminders on, and lets the producer deselect the
  invitation and finish. Fix in config (Gili): re-enter `RESEND_API_KEY` on Vercel.

## Agreement PDF design (item 2)

- Draft gains `agreement.agreementPdf = { uploadToken, fileName, sizeBytes } | null`.
- Upload: `prepareAgreementPdf` mutation → import-scoped capability token (same shape as
  the payment-proof capability: bound to producer/batch/row, no expiry) → presigned PUT to
  the `docs` bucket staging key via the existing `agreement-pdfs/storage` helpers.
- Materialize: finalize staging → final object, put exact PDF metadata into the frozen
  purchase snapshot (`agreementMode: "pdf"`, `agreementPdf`), and keep the private
  document ledger on `purchase_import_attestations.agreement_pdf_contract` (migration
  0056, nullable, written only when a PDF exists — safe to deploy before migrating).
- Viewing: `authorizeAcceptedAgreementPdf` gets an imported-work branch that resolves the
  document through the attestation ledger, so the existing payment-history "Open PDF
  agreement" link works for artist and producer.
- Agreement text, PDF, both, or neither are all allowed. Mode = pdf when a PDF exists,
  text when only text exists, none otherwise.

## Out of scope

- Moving functions / DB region (SK-258). Custom schedules. CSV import.
