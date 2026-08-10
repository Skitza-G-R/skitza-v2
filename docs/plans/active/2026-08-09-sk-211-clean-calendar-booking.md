# SK-211 — Clean calendar booking and double-click actions

## Outcome

Make producer-created sessions feel like a direct calendar action instead of
an administrative form:

- double-click empty desktop calendar space to start a booking at that
  studio-local 15-minute slot;
- double-click an existing calendar session to open its existing edit-time
  flow;
- replace the crowded centered manual-booking modal with a calm responsive
  right drawer;
- keep every SK-190/SK-191 entitlement, conflict, warning, notification, and
  calendar-delivery rule unchanged.

Linear source: SK-211. Development base and PR target: `v3-clean`.

## Product decisions

### Normal drawer state

The default selected-project view shows only:

1. a prominent but compact date/time summary with **Change**;
2. separate **Client** and **Project** controls;
3. one light session-details card with the derived title, included-session
   treatment, and remaining/unlimited allowance; the fixed duration/end time
   stays in the prominent time summary, and the invite consequence stays as
   one quiet line below the card;
4. **Edit title** and billing **Change** actions;
5. one primary **Book session** action.

The default state does not permanently show date/time inputs, a title input,
billing radio cards, duplicate package explanations, or a second cancel
button. The drawer close control and overlay dismissal handle cancellation.

### Progressive states

- `+ New session` opens the same drawer with the date/time editor expanded
  because no calendar slot was selected.
- **Change** beside the selected time reveals the existing date and 15-minute
  time inputs.
- **Edit title** reveals the optional title input in the details card.
- Billing **Change** reveals only the treatments allowed by the selected
  project.
- When included credit remains, Included stays the default and Complimentary
  is the override.
- When no included credit remains, the required Complimentary/Payment due
  choice is expanded automatically.
- Hard conflicts stay inline and cannot be overridden.
- Availability/Google warnings keep the existing second-confirmation view.

### Calendar interaction

- Empty-slot double-click derives the day from the calendar's UTC day marker
  and the time from the pointer's vertical position inside the hour row.
- The time snaps down to the existing 15-minute step in studio time.
- A provisional dashed brand block stays visible while the drawer is open.
  It starts as a minimum slot marker and expands to the selected project's
  server-derived duration.
- A session block stops event bubbling and routes double-click directly to the
  existing reschedule/edit-time modal.
- Single click remains unchanged.
- Mobile and keyboard users retain the existing visible controls; the desktop
  grid double-click is a shortcut, not the only route.

## Technical shape

### Client interaction boundary

Add a small client context between `CalendarSwipeSurface` and its server-
provided schedule content. It owns:

- opening manual booking with or without a prefilled slot;
- the provisional slot/duration shown by the week grid;
- clearing the provisional state when the drawer closes.

`SchedulePanel` continues to own edit-time modal state because it already has
the complete `SessionListItem` rows needed by the existing
`RescheduleSessionModal`.

### Drawer

Refactor `manual-session-modal.tsx` to the existing Radix-backed `Sheet`
primitive with `side="right"`. Preserve the current preview/create actions,
operation-key behavior, online checks, warning acknowledgement, error copy,
and success toast.

### Motion

Reuse existing CSS-only primitives:

- `sk-sheet-enter` for the drawer;
- `reveal-up` delay classes for restrained content sequencing;
- a short existing reveal/pop animation for the provisional calendar block;
- current press/hover classes for actions.

Every primitive is already covered by `prefers-reduced-motion: reduce`. Do not
add Framer Motion or a new runtime animation dependency.

## Expected files

- `apps/web/src/app/(producer)/dashboard/calendar/calendar-swipe-surface.tsx`
- `apps/web/src/app/(producer)/dashboard/calendar/manual-session-modal.tsx`
- `apps/web/src/app/(producer)/dashboard/calendar/schedule-panel.tsx`
- `apps/web/src/app/(producer)/dashboard/calendar/schedule-week-grid.tsx`
- a focused calendar interaction/context helper
- focused tests under the existing calendar `__tests__` directory
- this plan

No database, migration, booking-router, payment, notification, or Google
Calendar contract change is expected.

## Verification

### Automated

1. Prove focused interaction and contract tests fail before the behavior
   exists where practical.
2. Test studio date/time slot derivation and 15-minute snapping.
3. Test that empty-cell and session-block double-clicks route to different
   actions.
4. Test initial slot reset/prefill and provisional duration updates.
5. Test progressive time, title, and billing states, including no-credit
   treatment selection.
6. Run typecheck, lint, focused tests, full tests, and build through
   `$skitza-verify`.

### Browser

Verify the real authenticated Calendar at:

- desktop: empty-slot double-click, provisional block, clean drawer, project
  duration, title/billing expansion, warning state where safely available,
  and existing-session double-click edit;
- 390px and 360px: `+ New session`, no horizontal overflow, scroll/fixed
  footer behavior, keyboard-safe fields, and no dead controls;
- reduced motion: no required information depends on animation.

Do not create a real booking during production verification. Use a disposable
or preview environment for any final write.

## Delivery

1. Commit on Linear's exact branch
   `giasraf/sk-211-make-calendar-booking-cleaner-and-add-double-click-actions`.
2. Open a PR targeting `v3-clean` with an `SK-211:` title.
3. Require passing checks and visual evidence before merge.
4. Merge only after Gili's approval.
5. Identify the exact merged production deployment and obtain explicit
   approval for that deployment before promoting or repointing `skitza.app`.
