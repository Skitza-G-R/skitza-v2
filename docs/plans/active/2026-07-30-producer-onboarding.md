# SK-157 — Producer onboarding

## Outcome

One canonical, resumable producer setup that creates a truthful public page
without blocking dashboard access after identity is saved.

## Locked flow

1. Welcome
   - Show `Account created` as already complete.
   - Promise “A few minutes” and explain that progress is saved.
2. Public identity
   - Ask for studio or producer name.
   - Auto-detect timezone and currency, but let the producer confirm them.
   - Saving identity unlocks the dashboard.
3. First product
   - Reuse the complete seven-step Store product editor.
   - Hide the outer onboarding progress while product progress is visible.
   - Autosave and resume the exact product step.
   - Create the first product hidden.
4. Working hours
   - Only show when the product includes bookable sessions.
   - Suggestions remain local until confirmed.
   - Skip saves nothing and leaves the page not ready to share.
5. Preview and publish
   - Show the exact artist-facing preview and a plain commercial summary.
   - Publish the existing hidden product; never create a second product.
   - Re-check readiness before publishing.
6. Complete
   - Primary action: Open dashboard.
   - Secondary actions: Copy link and Preview as artist.
   - Offer portfolio links and direct bank/Bit details as optional follow-up
     tasks. Neither blocks activation.

## State and routing

- `/onboarding` is the only resume entry.
- `/dashboard/onboarding` redirects to `/onboarding`.
- Durable product, visibility, availability, links, and payment-instruction
  records determine the outer resume route.
- The account-scoped runtime draft from the Store editor determines the exact
  product sub-step.
- A product with `durationMin === 0` has no bookable sessions. No schema change
  is needed.
- Completed producers may revisit onboarding steps safely; the index resolver
  decides whether setup is unfinished or complete.

## Shared editor boundary

- SK-155 remains the source of truth for ProductEditor, draft shape,
  validation, seven steps, payload mapping, hidden/live writes, and mobile
  editor behavior.
- SK-157 adds only an onboarding presentation/submission adapter:
  hidden-only creation, completion callback, and onboarding navigation.
- Legacy onboarding package writers are not used.

## Visual direction

- Warm editorial workspace with one clear focal card and an amber progress
  thread.
- Desktop: calm rail plus centered working canvas.
- Mobile: compact header and horizontal progress; never squeeze in the rail.
- Signature element: the first `Account created` checkpoint is visibly
  complete on arrival, so progress starts with a true win.
- Buttons follow the shared radius rules, touch targets are at least 44px,
  focus remains visible, and reduced motion is respected.

## Verification loop

1. Add focused fail-first tests for canonical routing, readiness, conditional
   hours, hidden-first-product behavior, shared-editor use, persistence,
   truthfulness, and responsive shell contracts.
2. Run focused onboarding/Store tests until green.
3. Run typecheck, lint, full tests, and production builds.
4. Run a non-production, no-write browser walkthrough locally and on the
   protected Vercel preview at 360×800, 390×844, and desktop.
5. On every browser pass, check overflow, keyboard/action reachability,
   focus, reduced motion, console errors, page errors, and failed same-origin
   requests.
6. Fix and repeat until all gates pass.
7. Push the exact verified commit and return its READY Vercel preview URL.

## Safety boundaries

- No database migration.
- No payment processor or public payment details.
- No artist Store redesign, Store management redesign, unrelated shell work,
  production promotion, or production database write.
