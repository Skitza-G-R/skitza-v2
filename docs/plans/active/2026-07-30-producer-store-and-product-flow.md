# Producer Store and product flow — approved plan

**Date:** 2026-07-30
**Status:** Approved by Gili; implementation in progress under SK-155
**Surface:** Producer Store management and Store product authoring

## Goal

Make the producer Store feel like a focused commercial workspace on desktop
and a complete, calm management flow on mobile. Producers should understand
what artists can buy, what is live, what appears first, and how to publish a
clear offer without leaving the flow.

## Exact scope

This plan covers:

- `/dashboard/store`
- the producer mobile avatar/account menu
- the existing seven-step Store product editor
- product visibility, ordering, draft feedback, and post-create reveal
- the Store-level entry point for existing private offers

This plan does not cover:

- redesigning the artist Store
- new product categories, pricing models, payment models, or database columns
- private-offer commercial rules
- unrelated producer navigation or settings
- production promotion

## Product decisions

- Desktop keeps Store in the primary sidebar.
- Mobile keeps Store in the avatar menu because this is occasional management.
- Store is the first account-menu item with the helper “Products and private
  offers”; Settings is second.
- A one-time mobile tip after onboarding says “Manage your Store from your
  profile photo.”
- The Store defaults to Products. Private offers is a secondary Store tab, not
  a separate section above the catalog.
- The producer Store is an admin workspace, not a copy of the artist storefront.
- The header provides `Preview as artist` and `Copy link`.
- All, Live, and Hidden filters remain. Search appears only at eight or more
  products.
- The first live product is explicitly marked `Featured`.
- Ordering controls appear only in a dedicated reorder mode.
- Visibility changes immediately. Delete/archive remains lifecycle-aware.
- New products are appended and do not become featured automatically.
- After creation, filters and search clear, the new card is revealed, and its
  Live/Hidden state is obvious.

## Product editor

- Mobile is a true full-screen editor. Desktop remains a centered dialog.
- Keep seven focused steps: Type, Details, Price, Payment, Delivery, Rights,
  Review.
- Type choices are Production, Mix, Master, and Custom. Choosing a type does
  not auto-advance.
- Details uses `Product title` and `Short description`.
- Short-description helper: “One sentence artists will see on your Store
  card.” Example: “From first demo to a release-ready master.”
- Delivery asks “Does this product include bookable sessions?” Session count
  and duration appear only after Yes. Revisions remain separate.
- A no-session product persists `durationMin: 0`, which is already the domain
  model’s canonical pure-delivery value. No schema change is needed.
- Store pricing remains flat or per-song. Multiple existing payment choices
  may be selected.
- Tax is a read-only studio-level summary with a link to Settings.
- Rights remain explicit before publishing, with optional additional agreement
  text.
- Review keeps the terms summary and exact artist-facing card/detail preview.
- New-product actions are `Publish product` and `Save hidden`, with concise
  visibility explanations.
- Editing a live product uses `Save live changes`; editing a hidden product
  uses `Save hidden changes`.
- Draft autosave stays and adds visible `Draft saved` feedback plus an explicit
  `Discard draft` action.

## Visual system

### Palette

- **Warm Canvas — `#F2EDE6`:** page background
- **Paper — `#FFFFFF`:** cards and editor surfaces
- **Studio Ink — `#111009`:** primary type and strong controls
- **Muted Umber — `#6B6359`:** secondary information
- **Signal Amber — `#D4960A`:** featured signal, primary publish, and focus
- **Live Green — `#0F6932`:** readable live-state text

Implementation uses the existing RGB tokens through `rgb(var(--token))`.

### Type

- Syne: page title, product titles, and prices
- Outfit: body copy, labels, and controls
- JetBrains Mono: small status, counts, and ordering information

### Layout

Desktop:

```text
STORE / catalog status                  Preview as artist · Copy link
Products | Private offers
Products                         New product
All · Live · Hidden        Search (8+) · Reorder
┌ Featured ─ product title ─ price ─ Live ─ Edit ┐
├──────────── product title ─ price ─ Live ─ Edit ┤
└──────────── hidden products ────────────────────┘
```

Mobile:

```text
Store                         Copy
3 live · 1 hidden             Preview
Products | Private offers
All · Live · Hidden
┌ Featured
│ product title       price
│ short description
│ Live        Edit · More
└───────────────────────────
          New product
```

Mobile editor:

```text
close      Step 2 of 7
Details
──────── progress ────────
Product title
Short description
What is included?

Draft saved
Back                    Continue
```

### Signature element and critique

The first live card gets a narrow amber “artist first” signal and a clear
Featured label. Reorder mode turns the catalog into a quiet studio track list:
numbered rows and deliberate move controls replace permanent arrow clutter.
This gives the workspace music-specific character without decorative gradients,
glass, oversized metrics, or a storefront-style hero. The deliberate visual
risk is the asymmetric compact header with its signal rail; it must remain
restrained enough that products—not decoration—stay dominant.

## Implementation map

1. Compose Products and Private offers inside one Store shell and one tab state.
2. Refine the header, conditional toolbar, catalog cards, featured signal, and
   explicit reorder mode.
3. Add preview/copy actions using the existing authenticated artist Store route
   and existing public-link utilities.
4. Add the mobile account helper and one-time local runtime tip without changing
   desktop navigation.
5. Update editor wording, conditional session fields, read-only tax summary,
   full-screen mobile shell, draft feedback/discard, and publish/hidden actions.
6. Thread `active` through the existing create mutation so publish vs hidden is
   one atomic product creation; do not change the database schema.
7. Clear catalog query state after creation and scroll/focus the resulting card.

## Verification loop

1. Add focused regression tests for navigation wording, Store tabs/search/
   reorder/featured behavior, editor wording and session semantics, draft
   controls, atomic hidden creation, and success reveal.
2. Prove the new focused tests fail against the old behavior.
3. Implement in small surface groups and rerun their focused tests.
4. Run web typecheck, lint, the focused suite, the full test suite, and build via
   the repository verification workflow.
5. In a signed-in browser, exercise Products, Private offers, preview/copy,
   reorder mode, visibility, create-publish, create-hidden, draft restore/
   discard, and live edit.
6. Inspect true 360px, 390px, and desktop layouts for overflow, clipped content,
   focus, keyboard-safe editor footer, 44px phone targets, console errors, and
   reduced motion.
7. Refine and repeat until both code and browser gates are clean, then open the
   PR and wait for its working preview deployment.

## Acceptance checklist

- Products is the default Store surface; Private offers is secondary.
- Mobile avatar menu explains Store and keeps it first.
- Store header actions work and do not imply a public storefront.
- Search is absent below eight products.
- Featured order meaning is visible; arrows are absent outside reorder mode.
- Product cards stay readable and operable at 360px and 390px.
- Mobile creation is full-screen and all seven steps are usable.
- No-session and session-based products both save correct commercial terms.
- Tax cannot be changed from inside a product.
- Publish, hidden save, live edit, draft feedback, and discard wording are exact.
- A newly created product cannot remain hidden by stale Store filters/search.
- Verification produces no horizontal overflow, clipped footer, page error, or
  unexpected console error at the required widths.
