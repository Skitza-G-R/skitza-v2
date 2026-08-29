# Needs You — dead-end links and dismiss

**Date:** 2026-08-29
**Issues:** SK-283 (dead-end links), SK-284 (dismiss). Filed alongside: SK-285 (sorting buries expiring requests), SK-286 (artist home hides money due).
**Status:** design approved by Gili, not yet built.

## The report

> "Right now on the producer homepage there are things like this. There's nothing I can do with them, only click on them, but they are never gone."

Two cards on Gili's dashboard: **"2 finished sessions"** and **"Project needs movement"**.

## What the audit found

The producer home queue is built by `buildNeedsYouQueue()` in
`apps/web/src/components/dashboard/overview/needs-you.ts`. It pushes **9** kinds; **8**
can render. Top 3 shown, sorted by a hardcoded `priority` integer, `?view=all` expands.

| kind | priority | appears when | clears when |
| --- | --- | --- | --- |
| `payment_proof` | 5 | `payment_proofs.status='pending'` | producer confirms/rejects |
| `payment_due` | 8 | purchase in `due_or_overdue` bucket | paid, waived, or cancelled |
| `purchase_request` | 10 | `purchase_requests.status='pending'` | producer approves/declines |
| `session_approval` | 20 | `bookings.status='pending_approval'` | decided, or 48h held expiry |
| `follow_up` | 30 | confirmed booking ended, project `active` | each session marked `completed`/`no_show` |
| `comment` | 45 | `track_comments.resolved_at IS NULL`, not from producer | comment resolved |
| `urgent_project` | 50 | `in_production`, no upload in 14d | a new upload |
| `payment_received` | 60 | **unreachable** | — |
| `setup` | 70 | `?skip=1` and no packages | navigate without `?skip=1` |

### Root cause: the cards are reachable, the controls are not

Neither card is truly permanent. Both clear — but the button lands on a page that has no
control to clear them.

- `follow_up` → **Open project** → `/dashboard/clients-projects/{id}`. The control that
  clears it (**Mark completed** / **No-show**) lives on `/dashboard/calendar`.
- `comment` → project page. **Resolve** lives on `/dashboard/music/{versionId}`.
- `payment_due` → `/dashboard/payments#payment-history-due-overdue`. **No element with that
  id exists anywhere in `apps/web/src`.** The payments workspace tab is `useState(initialView)`
  and never reads the URL, so the producer lands on the default view.

`urgent_project` is the one card with genuinely no "done" action anywhere in the app.

### Dead code found

- `payment_received` cannot render: `booking.recentPaidUnacknowledged` is a hardcoded `=> []`
  and `producer.today`'s payment leg is `Promise.resolve([])`. Its X button calls
  `booking.acknowledgePayment`, which **always throws `PRECONDITION_FAILED`**. So a fully-built
  dismiss button ships on the dashboard that can never appear and would fail if it did.
- `mobile-today-feed.tsx` (~620 lines) is dead — `dashboard/page.tsx` renders only
  `<OverviewScreen>`; the sole importer is its own test.
- `urgent_project`'s "Overdue payment" / "Deposit due" titles are unreachable —
  `UrgencyKind` is the one-member type `"stuck"`.

## Decisions

| # | Question | Decision |
| --- | --- | --- |
| 1 | What does dismiss mean? | **Hide until it changes.** Not forever, not a snooze, not a state change. |
| 2 | Scope | Fix the dead ends **and** add dismiss. |
| 3 | Which cards get an ✕ | `urgent_project`, `follow_up`, `comment` only. |
| 4 | Placement | Round ✕ on the row, always visible, same on phone and laptop. |

Rejected, with reasons:

- *Hide forever* — a real problem could go silent permanently.
- *Snooze* — needs a duration control, and a snoozed pile returns all at once.
- *Mark as done* — several kinds have no sensible "done" short of the real work.
- *Swipe to reveal* — no swipe-to-reveal or long-press exists in the repo (only calendar tab
  swiping); pull-to-refresh is live on `/dashboard`; and a hidden gesture doesn't fix
  "there's nothing I can do".
- *⋯ menu* — two taps, and no dropdown/popover primitive exists in `components/ui/`.
- *Tidy-up mode* — heavy machinery for a panel that shows at most 3 rows.

## Design

### Comeback rules

| Card | ✕ hides | Returns when |
| --- | --- | --- |
| Project needs movement | that project's card | a new upload lands, then 14 quiet days pass again |
| N finished sessions | that project's card | another session finishes on that project |
| Artist comment | that one comment | the artist writes another comment |

**Accepted trade-off:** a project parked forever stays hidden forever. Nothing new has
happened, so there is nothing new to say. Gili approved this explicitly.

No ✕ on `payment_proof`, `payment_due`, `purchase_request`, `session_approval`, `setup`.
Money and time-boxed decisions must never be hideable — `session_approval` has a 48h fuse
and cancels silently overnight.

### Storage

New table `producer_attention_dismissals`: `producer_id`, `item_kind`, `subject_id`,
`dismissed_at timestamptz not null`, unique on the triple.

- **Server-side, not `localStorage`.** Hiding on desktop must hide on the phone. The install
  and push banners store `localStorage` keys with no userId in them, so they reappear per
  browser profile — not repeating that.
- **One table, not a column per subject.** `urgent_project` and `follow_up` are two different
  cards about the same project, so per-table columns would need two columns on `projects`.

### Visibility rule

Copy `booking_calendar_links.attention_dismissed_at` (migration `0053`). Store a **timestamp,
not a boolean**, and show when:

```
dismissed_at IS NULL OR dismissed_at < <subject's last-changed time>
```

- `urgent_project` → compare against `lastUploadAt ?? updatedAt`, the same reference
  `classifyUrgency` uses. Dismiss at T0 (where reference R < T0) hides it; a later upload
  moves R past T0, so when the project goes stale again 14 days on, the card returns by itself.
- `follow_up` → compare against `max(booking end time)` for that project.
- `comment` → per comment id; a new comment is a new row regardless.

Why a timestamp and not a flag: with a flag, every background job that touches a project would
have to remember to un-set it. With a timestamp, visibility is computed fresh on each page load
and the feature never leaks out of the query.

On write, use the `greatest(dismissedAt, stateChangedAt, updatedAt + 1ms)` guard from
`server/google-calendar/repository-drizzle.ts`, with the producer-id + exact-state predicate and
a `rows.length === 1` check. Plain `now()` can land *behind* a concurrent sweep's write and make
the card flicker straight back.

Rule lives in a focused service under `server/domain/` with tests; the router keeps to auth,
validation, and orchestration.

### UI

Round ✕ at the end of the row. Row fades out, toast with **Undo**.

Lift the button already written in `needs-you-payment-row.tsx`: `h-11 w-11 shrink-0 rounded-full`,
descriptive `aria-label`, optimistic `setHidden(true)` + `useTransition`, restore on failure,
`<p role="alert">` for the error. That component is deleted by SK-283, so lift the pattern first.

`NeedsYouRow` is a plain `<li>`, not an anchor, so the ✕ is a sibling of the action `<Link>` —
no interactive-inside-anchor problem. (Four *other* overview rows are whole-`<Link>` wrappers;
if a ✕ is ever needed there, use the absolute link-overlay from `mobile-client-row.tsx`.)

Constraints:

- The panel is **dark below `lg` and light above**. The icon needs both colour sets or it
  vanishes at one width. Tokens are bare RGB triplets — always `rgb(var(--token))`.
- **`--bg-hover` does not exist** in `globals.css`; `mobile-payment-row.tsx` uses it and renders
  a silently transparent hover. Use `--bg-overlay` or `rgb(var(--fg-onsidebar)/0.08)`.
- **360px budget:** ~296px of row, ~140px of existing chrome, ~156px of title. A 44px ✕ plus its
  gap leaves ~104px — let the title wrap to two lines rather than truncate harder.
- Carry `.sk-press-pop`; `@media (pointer: coarse)` only forces the 44×44 target on elements with
  a press class. No Framer Motion — `app/__tests__/motion-primitives.test.ts` enforces a
  `prefers-reduced-motion: reduce` block for every primitive.
- Refuse when offline via `useOnlineStatus()`, matching both existing dismiss buttons.
  `OverviewScreen`'s offline branch renders no Needs You rows at all.
- With the cap of 3, dismissing one slides a hidden item into view. Expected — confirm it
  doesn't read as whack-a-mole.

### Do not build on

`bookings.producer_acknowledged_at` looks like a live precedent and is not. Migration `0020` is
applied on production, but the column was dropped from the Drizzle model and both its procedures
are stubs that throw.

## Out of scope

**SK-285 — sorting buries expiring session requests.** `session_approval` sits at priority 20
below three *uncapped* payment kinds (5/8/10) under a 3-row cap. Three unpaid purchases
permanently hide a session request with a 48-hour fuse. On expiry the artist is notified; the
producer gets nothing. The countdown is never shown. This is the finding that costs real bookings.

**SK-286 — artist home hides money due.** `/artist` has no queue: one hero card plus three quiet
rows, picked by a fixed priority table where a confirmed session outranks an overdue payment. The
"installment due" card enters `candidates` only, never `supporting` — so on any day the artist
has a session, the amount they owe renders nowhere. Dismiss is the wrong fix there; the artist
home shows too little, not too much.

## Verification

Per `$skitza-verify`: `pnpm typecheck`, `pnpm lint`, `pnpm test` from `apps/web`, then
`pnpm typecheck` in `packages/db`. Vercel runs ESLint with `--max-warnings 0`.

Regression tests must fail before the fix: one per corrected href (SK-283), and one per comeback
rule (SK-284). Visual check at true 390px and 360px, then desktop separately.

Migration for SK-284 goes through `$skitza-migrate` only — never `drizzle-kit migrate`.
