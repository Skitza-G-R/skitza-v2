# Private Offer UI/UX Cleanup — Approved Design Brief

**Date:** 2026-08-15  
**Decision owner:** Gili  
**Status:** Approved in product discussion; ready to convert into an implementation plan  
**Base:** `v3-clean`  
**Linear:** TBD — create a new issue in project `Skitza v3`, team `Skitza` (`SK`), before implementation  
**Baseline:** SK-219 private offers

## 1. Outcome

Make the product-based Private Offer flow feel short, clear, and intentional.

The current quick composer places recipient, project, price, payment, and supporting context on one long screen. The repeated cards, small progress bars, and competing actions make the flow feel tiring and harder to understand than the task itself.

The approved replacement has two editing steps:

1. **Recipient**
2. **Price & terms**

A separate read-only **Review & send** confirmation follows. Review is not counted as a third editing step.

## 2. Scope

This design changes:

- The product-based Private Offer flow launched from a Store product.
- The final review and send experience for that product-based flow.
- The agreement PDF carried from a Store product into a Private Offer.
- PDF upload and replacement inside the normal product-creation wizard.
- The notification link and post-authentication destination for every Private Offer email; only the composer redesign is limited to product-based offers.
- Editing an already-sent product-based offer.

This design does not change:

- Standalone Private Offer composer and commercial behavior, except for the shared email/authentication journey in Section 10.
- Client-page Private Offer composer and commercial behavior, except for the shared email/authentication journey in Section 10.
- The Store product used as the source after the flow has opened.
- Existing non-PDF agreement modes.

## 3. Experience principles

- Show one decision at a time.
- Keep the common path short; put uncommon changes in **Customize**.
- Keep consequences visible: recipient, project destination, client total, copied terms, and attached agreement.
- Reuse the normal product-creation wizard instead of inventing a second advanced editor.
- Use one clean surface with spacing and thin dividers. Do not wrap every section in another beige card.
- Never make the user open a read-only terms view before Review; Review already serves that purpose.

## 4. Shared shell

Both editing steps use the same shell:

```text
PRIVATE OFFER

1  Recipient  ─────────  2  Price & terms

Based on
Full Production
```

Rules:

- Replace the two tiny progress marks with the labeled stepper.
- A completed step uses a checkmark and remains clickable.
- The source product is a quiet context label, not a card or editable control.
- The source product cannot be changed inside the flow. To use another product, close and start from that product.
- Opening the flow creates an in-memory offer copy. Customize edits that copy only; it never mutates the source Store product.
- Later source edits do not silently rewrite the open copy or a sent offer. If the source becomes unavailable before the first send, block sending and require the producer to restart from an available product. A sent offer remains independent of later source changes or deletion.
- Desktop uses a centered modal.
- At 390px and 360px, the flow uses the full screen.

## 5. Step 1 — Recipient

### 5.1 Recipient field

Use one writable combobox instead of separate **Existing client** and **Invite by email** modes.

```text
RECIPIENT
[ Search clients or enter an email…                         ▾ ]
```

Behavior:

- Opening the field shows the client list.
- Typing filters existing clients by name or email.
- Selecting an existing client fills the recipient immediately.
- Entering an unknown valid email creates a new-recipient choice.
- After that choice is selected, reveal one **Client name** field.
- Do not create a new recipient from invalid or incomplete email text.
- Match email addresses using the existing normalized-email rules. If the address already belongs to one of the producer's clients, use that client instead of creating a duplicate.
- Do not persist a new client while the producer is typing. Create it transactionally only when **Send private offer** succeeds.
- Changing the recipient clears any stale new-client name and existing-project selection.

New-recipient state:

```text
[ noa@email.com                                             ]

NEW RECIPIENT
[ Client name                                               ]
```

The progressive name field keeps existing-client selection compact while still providing a proper email greeting and client record.

### 5.2 Project destination

Default to a new project and state the consequence plainly:

```text
After acceptance: A new project will be created       Change
```

**Change** reveals available destinations:

```text
Where should the work go?
(●) Create a new project
( ) Add to “Debut EP”
( ) Add to “Single — Maya”
```

Rules:

- A new email recipient always defaults to a new project.
- Existing projects are offered only for the selected existing client.
- Changing the selected client resets the destination to **Create a new project**.
- While projects load, the new-project default remains available. If loading fails, show **Retry** and keep Continue available only with the new-project choice.
- Step 1 advances only through an explicit **Continue** button. Selecting a recipient must not auto-advance.

## 6. Step 2 — Price & terms

Price is the only expanded editor on this screen.

```text
2  PRICE & TERMS
Based on: Full Production

Your price before VAT
[ 8,500.00                                      ] [ ILS ]

Client pays                                          ₪10,030
Includes ₪1,530 VAT

────────────────────────────────────────────────────────────

✓ Terms copied from Full Production
  Pay in full · PDF attached · Expires in 14 days

                                               Customize

[ ← Back ]                              [ Review offer → ]
```

Rules:

- For tax-added products, label the input **Your price before VAT** and show the exact VAT-inclusive client total directly below it.
- For tax-included or tax-free products, adapt the labels and breakdown so they remain factually correct.
- Keep the currency selector beside the price.
- The editable number is always the fixed subtotal for this Private Offer—not a unit price. For hourly products, no number of hours is assumed. For per-song products, the copied quantity remains part of the terms until changed in **Customize**.
- Changing currency changes the offer's currency code; it does not perform exchange-rate conversion.
- Do not show quantity or hours in the quick screen. Those controls live only in **Customize**.
- Collapse copied terms into one short summary containing payment, agreement state, and expiry. The agreement phrase adapts to **PDF attached**, **Written agreement**, or **No separate agreement**.
- Initialize the default expiry to exactly 14 days when the composer opens and keep that instant in memory through Review and send, so Review can show the exact date that will be stored. Editing a sent offer preserves its current expiry unless the producer explicitly changes it in **Customize**.
- Do not add **View terms** here. The next screen is the complete review.

## 7. Customize

**Customize** opens a focused advanced flow that looks and behaves like the normal product-creation wizard.

Requirements:

- Reuse the normal wizard shell, step bar, spacing, controls, buttons, validation patterns, and responsive behavior.
- Initialize the detached offer copy from the source Store product when the composer opens. Customize reads that detached copy and must not refetch or overwrite it from later source-product changes.
- Keep Private Offer-specific language only where the meaning differs.
- When customization finishes, return to **Price & terms** with the compact summary updated.
- The source product remains fixed throughout customization.
- Product details are editable on the detached Private Offer copy even though the source product itself remains fixed and unchanged.
- The advanced editor does not contain another Review screen. Its final **Save customizations** action returns to the compact **Price & terms** screen; the flow has only one final Review.
- While Customize is open, its familiar internal stepper replaces the two-step quick-flow indicator. These are nested advanced-editor steps, not additional top-level Private Offer steps.

The advanced sequence follows the normal product editor through its editable term steps:

```text
Product details
Price
Payment options
Delivery
Rights & agreement
```

## 8. Review & send

Review is a final confirmation after the two editing steps. It is not labeled **Step 3 of 3**.

It is read-only and shows the exact offer the client will receive:

```text
REVIEW PRIVATE OFFER

To: Noa Levi · noa@email.com

Full Production
Based on the Store product; customized terms are shown below

Your price                                      ₪8,500
VAT                                              ₪1,530
Client pays                                    ₪10,030

Payment                                      Pay in full
After acceptance                    Create a new project
Valid until                               29 Aug 2026
Agreement            Full Production Agreement.pdf · View

[ Edit offer ]                   [ Send private offer → ]
```

Review requirements:

- Show recipient name and email.
- Show subtotal, tax, and exact client total.
- Show project destination and expiry date.
- Show compact read-only sections for product details/deliverables, payment options, delivery/session/revision terms, rights/royalties, and agreement state. Omit only sections that genuinely do not apply.
- Show the agreement PDF as a compact filename row with **View**.
- For a new offer, **Edit offer** returns to **Price & terms** without losing the current in-memory values; recipient/project changes remain available through the labeled Recipient step and advanced changes through **Customize**. For a sent-offer update, it returns to the edit-mode **Price & terms** screen, where the recipient is locked and the project has its own **Change** row.
- The primary action is **Send private offer**.

After successful offer persistence, independently of notification-email delivery:

- Close the modal.
- Show **Private offer sent to noa@email.com.**
- If the offer was saved but notification delivery failed, show **Offer saved, but the email wasn’t delivered.**
- A saved offer remains in producer history with status **Waiting for artist**, even when notification delivery fails.
- Do not add a separate success screen.

## 9. Agreement PDF

### 9.1 Private Offer inheritance

When the source Store product has a PDF agreement:

- Inherit it automatically into the Private Offer.
- Freeze the exact document revision when the offer is successfully persisted, and again at each successful pre-acceptance update. Notification-email success is not part of this transaction. Replacing or deleting the PDF on the Store product later must not change an existing offer.
- The offer must own an immutable document-version reference or copy that survives source replacement, source-product deletion, and normal storage cleanup for as long as the offer or resulting purchase must be retained.
- Show the PDF on producer Review and on the client’s Private Offer page.
- Authorize producer ownership or the matching artist identity on the server before returning any document metadata or short-lived file URL. Open it in a new tab, with download available.
- Do not force the client to open the PDF before accepting.
- Keep the existing required acceptance checkbox covering both the offer and agreement.
- If the inherited PDF is missing or cannot be authorized, block sending and tell the producer to replace or explicitly remove it.
- Inside **Customize**, allow **Replace PDF** and an explicit **Remove agreement** action. The PDF must never disappear accidentally.
- Replacement is atomic: keep the previous valid PDF attached until the new upload has completed and passed authorization.
- If there is no separate agreement, adapt the checkbox to **I reviewed and agree to this offer**.

The client-facing row is compact:

```text
Agreement
[ PDF ] Full Production Agreement.pdf                 Open PDF

☐ I reviewed and agree to this offer and agreement
```

### 9.2 Normal product wizard upload

Keep the existing **No agreement / Upload PDF / Write terms** modes. Change the PDF interaction from buttons to one persistent dropzone.

Before upload:

```text
┌──────────────────────────────────────────────────────┐
│ Drop your agreement PDF here                        │
│ or tap to choose a file                             │
│ PDF only · up to 15 MB                              │
└──────────────────────────────────────────────────────┘
```

After upload:

```text
┌──────────────────────────────────────────────────────┐
│ Full Production Agreement.pdf                       │
│ PDF · 1.8 MB                                        │
│ Drop a new PDF here to replace it                   │
└──────────────────────────────────────────────────────┘
```

Rules:

- Desktop supports drag and drop.
- The entire area is clickable and tappable for the file picker, including on mobile.
- Upload and replacement use the same component and behavior.
- Keep the dropzone visible after upload so replacement remains discoverable.
- Preserve PDF-only validation and the existing 15 MB limit on both client and server; do not trust only the filename extension or browser MIME value.
- A failed replacement leaves the prior PDF intact.
- Switching agreement mode or closing without saving cancels and cleans up any uncommitted upload.

## 10. Recipient email journey

The notification email remains private and minimal:

- Subject: **[Producer] sent you a private offer**.
- Body identifies the producer but does not include the price, PDF, or commercial terms.
- Primary action: **Review private offer**.

The button must link to the exact offer journey:

1. A signed-in authorized artist opens the exact offer.
2. A new recipient—or an existing client who does not yet have an Artist account—creates an Artist account with the same verified email that received the invitation.
3. After signup or sign-in, they return directly to the exact offer—not the general booking or Store screen.
4. Authorization still requires the invited verified email; knowing the offer URL is not access.
5. Preserve the existing identity binding: authorization requires the linked client contact and the invited address to remain verified on that account. This is not a new authorization model.
6. A different signed-in account sees **This offer was sent to another email** and a **Switch account** action. Do not reveal the invited address, offer title, producer details, PDF metadata, or commercial terms before authorization.
7. Preserve the exact-offer return destination through sign-in, signup, email verification, and **Switch account**.
8. Expired, canceled, declined, accepted, or otherwise unavailable offer links use the existing generic unavailable state; accepted terms remain available through the resulting purchase history.

If a sent offer is materially updated, send a new minimal email. A material update is any persisted change to project destination, price, currency, tax, payment options, deliverables, session/revision terms, rights/royalties, agreement, PDF revision, or expiry. A no-op save sends nothing.

- Subject/body meaning: **Your private offer was updated**.
- Link directly to the same authorized offer.
- Do not expose changed terms in email.

## 11. Editing a sent offer

Editing uses the same visual system, but the recipient is immutable because the offer is bound to that verified identity.

- Open directly on **Price & terms** instead of showing an uneditable Recipient step.
- Do not show the two-step creation stepper in edit mode. Use an **Edit private offer** header, one editable **Price & terms** screen, then **Review changes**.
- Show **Editing offer for Noa Levi · noa@email.com** beneath the header.
- Keep the recipient read-only.
- Keep project destination available as a compact **After acceptance · Change** row above Price.
- **Review changes** opens the same read-only Review surface; its final action is **Save changes**.
- Saving a material update sends the update notification described above.
- If the recipient is wrong, the producer must cancel the offer and create a new one.
- Only a still-pending sent offer can be edited. Accepted, declined, expired, and canceled offers remain immutable.
- Save and artist acceptance use the existing locked/stale-write protection. If they race, only one operation commits and the other must refresh rather than attaching acceptance to unseen terms.

## 12. Closing and draft behavior

There are no user-visible or resumable Private Offer drafts.

- Remove **Discard draft** from the primary interface.
- Closing an untouched flow closes immediately.
- Closing after any field, selection, navigation-relevant, or PDF-upload change shows:

```text
Close this offer?
Your changes will be lost.

[ Keep editing ]  [ Close offer ]
```

- Reopening starts a fresh flow.
- The confirmation applies to the close button, Cancel, Escape, and backdrop dismissal.
- Closing cancels and cleans up any uncommitted PDF upload.
- Internal idempotency or safe-retry bookkeeping may remain, but it must not restore a user-facing draft and must be cleared when the flow is intentionally closed.

## 13. Error and loading behavior

- Keep validation beside the field that needs attention.
- Do not advance from Recipient until a valid existing client or a valid new email plus client name is present.
- Clearly distinguish project loading, no available projects, and project-load failure.
- Disable Review/Send while required data, PDF authorization, or uploads are unresolved.
- Preserve logical-send idempotency so retries cannot create duplicate offer rows and the app does not intentionally send another notification for an already-completed logical send.
- Preserve the current verified-email, producer ownership, and project ownership checks.

## 14. Acceptance criteria

- [ ] The product-based flow shows exactly two labeled editing steps: Recipient and Price & terms.
- [ ] Review & send is a separate confirmation and is not counted as another editing step.
- [ ] Recipient selection is one searchable, writable combobox.
- [ ] An unknown valid email reveals a required Client name field.
- [ ] Project destination defaults visibly to a new project and can be changed for an existing client.
- [ ] Price is the only expanded editor on the quick second step.
- [ ] Quantity/hours appear only inside Customize.
- [ ] Copied terms render as one compact summary with no View terms action.
- [ ] Customize matches the normal product-creation wizard and returns to the quick flow.
- [ ] The source product cannot be changed inside the flow.
- [ ] Customize edits a detached offer copy and never mutates the Store product.
- [ ] Customize has no duplicate Review; Save customizations returns to Price & terms.
- [ ] A source PDF is inherited, revision-frozen, visible on Review and the client offer, and securely viewable.
- [ ] A broken inherited PDF blocks sending with a replace/remove recovery.
- [ ] PDF replacement is atomic, and failed or abandoned uploads do not remove the prior agreement or leak temporary objects.
- [ ] Normal product PDF upload and replacement use the same persistent drag-and-drop/tap area.
- [ ] No agreement, PDF, and written-agreement modes each render accurate summaries, Review content, and acceptance copy.
- [ ] The client is not forced to open the PDF before accepting but must accept the applicable offer/agreement checkbox.
- [ ] Email authentication returns the authorized recipient directly to the exact offer.
- [ ] A wrong signed-in account gets a Switch account recovery without recipient-address disclosure.
- [ ] Unauthorized requests receive no offer or PDF metadata before the server-side identity check succeeds.
- [ ] Closing changed work requires confirmation; no draft is resumed later.
- [ ] Successful send closes the modal and reports email delivery accurately.
- [ ] Sent-offer editing locks the recipient, preserves project correction, reviews before save, and emails only material changes.
- [ ] Accepted, declined, expired, and canceled offers cannot be edited.
- [ ] Tax-added, tax-included, and tax-free offers use correct labels and totals; currency changes perform no conversion.
- [ ] Project loading, empty, failure, retry, and recipient-change reset states follow Section 5.2.
- [ ] Logical-send retries cannot create duplicate offer rows or intentionally repeat a completed notification.
- [ ] Desktop uses a centered modal; 390px and 360px use a full-screen flow.
- [ ] Standalone and client-page composer/commercial flows remain unchanged except for the shared email/authentication journey.

## 15. Relevant implementation surfaces

- `apps/web/src/components/dashboard/offers/private-offer-composer.tsx`
- `apps/web/src/components/dashboard/offers/private-offer-editor-steps.tsx`
- `apps/web/src/components/dashboard/offers/private-offer-editor-model.ts`
- `apps/web/src/components/dashboard/offers/private-offer-review.tsx`
- `apps/web/src/app/(producer)/dashboard/store/private-offer-template.ts`
- `apps/web/src/app/(producer)/dashboard/store/editor-steps/rights-agreement-step.tsx`
- `apps/web/src/components/artist/offers/private-offer-terms.tsx`
- `apps/web/src/components/artist/offers/private-offer-response.tsx`
- `apps/web/src/server/domain/private-offers/`
- `apps/web/src/server/trpc/routers/private-offers.ts`
- `apps/web/src/server/email/templates/private-offer-notification.tsx`
- `packages/db/src/schema.ts`
- A new explicit SQL migration if immutable offer-document ownership requires schema changes
- The agreement-document upload and authorization path used by Store products

## 16. Explicitly rejected alternatives

- One long quick-edit screen.
- A separate Existing client / Invite by email toggle.
- Auto-advancing immediately after recipient selection.
- Repeated nested cards for every section.
- A View terms action immediately before Review.
- Quantity or hours on the quick Price & terms screen.
- Changing the source Store product mid-flow.
- A third numbered Review step.
- A user-facing draft/resume system.
- A cosmetic file dropzone that does not perform a real upload.
- Linking a new recipient to the general booking screen after authentication.
- A new email resend-management interface.

## 17. Open product decisions

None within the approved scope. The product and interaction decisions in this brief were approved by Gili on 2026-08-15. The implementation plan must choose concrete schema and component boundaries without changing these behaviors.
