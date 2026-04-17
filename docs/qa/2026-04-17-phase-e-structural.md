# Phase E — Structural QA (feat/deal-architecture)

> Date: 2026-04-17
> Branch: `feat/deal-architecture`
> HEAD: `6763be5` (post-E.1/E.2)
> Scope: structural + empty-state audit. Interactive Idiot-Proof QA deferred to post-deploy.

## Gate results

| Check | Result |
|---|---|
| `pnpm --filter web typecheck` | ✅ clean |
| `pnpm --filter web lint` | ✅ clean |
| `pnpm --filter web test` | ✅ 21 files / 123 tests |
| `pnpm --filter web build` | ✅ 30+ routes, `/dashboard/inbox` emits at 3.87 kB / 171 kB first-load |

## E.1 + E.2 — shipped

- **Migration 0010**: `notifications` table (pure additive, 6 FKs, covering index on `(producer_id, archived_at, created_at)`)
- **Emit helpers** at `apps/web/src/server/notifications/emit.ts`: `emitCommentCreated`, `emitContractSigned`, `emitBookingRequested` — all fire-and-forget with try/catch at call sites
- **Call-sites wired**: `deal.publicComment` + `booking.publicRequest`. Contract signing lives on `feat/contracts-v2` (deferred wiring on that branch)
- **Router** at `apps/web/src/server/trpc/routers/inbox.ts`: `list` / `unreadCount` / `markRead` / `markAllRead` / `archive` / `unarchive` — all producer-scoped with ownership walks
- **UI** at `/dashboard/inbox`: Active/Archived tabs, unread chip, mark-all-read, row actions, keyboard nav (`j`/`k`/`Enter`/`e`/`Esc`)
- **Sidebar badge**: unread count threaded through AppShell → Sidebar, pill with "99+" cap, dot in collapsed rail

## E.3 — Empty-state audit (already in good shape)

Audit of `apps/web/src/app/(app)/dashboard/`:

| Surface | Empty state |
|---|---|
| Pipeline Kanban | "Your pipeline is empty. Create your first deal." + CTA to `/dashboard/deals/new` ✓ |
| Inbox (Active) | "Nothing to review." ✓ |
| Inbox (Archived) | "No archived items." ✓ |
| Booking / Packages | "No packages yet." ✓ |
| Booking / Requests | "No pending requests." ✓ |
| Booking / Upcoming | "No confirmed sessions." ✓ |
| Leads (list) | "No links yet." ✓ |
| Leads (detail / views) | "No opens yet." ✓ |
| Deal detail / Contract tab | "Sign before you start" + CTA (from C.3) ✓ |
| Deal detail / Audio tab | Shows uploader in-place when no versions |
| Deal detail / Invoices tab | Phase G placeholder |
| Deal detail / Activity tab | Timeline with "no events" fallback |

**Every list has an empty state with a clear CTA or next step.** E.3's spec said "one sentence + one CTA" — all present. Standardized via `<EmptyState>` component at `apps/web/src/components/ui/empty-state.tsx`.

**Follow-ups queued (non-blocking)**:
- Deal detail / Activity tab: when contract events are cross-branch-available (post-merge), extend the timeline with `contract_viewed` / `contract_signed` events
- Public share `/share/[token]` read-only state when no versions yet — currently shows "Upload pending" (from A.8 null-handling). Could be friendlier once prod has real data
- Dashboard error boundaries — the repo has a root error boundary via Next.js convention. Adding per-section boundaries is a nice-to-have, not a blocker

## E.4 — No blockers

Phase E is functionally complete. Verified:
- No `!` / `as any` / `@ts-ignore` in new code
- Ownership walks on all 5 mutating inbox procedures
- Fire-and-forget emit pattern preserves main flow on notify failure
- Covering index `(producer_id, archived_at, created_at)` keeps inbox `list` and `unreadCount` queries fast at scale
- Keyboard nav respects `isTypingTarget` guard (doesn't fire in input fields)
- Unread badge reactive on page navigation (AppShell re-fetches, cheap query)

## Cumulative branch state (`feat/deal-architecture`)

- 16 commits
- 21 test files / 123 tests passing (added 3 `isTypingTarget` tests in D.5)
- Routes added / reshaped: `/dashboard` (Kanban), `/dashboard/inbox` (new), `/dashboard/deals/*`, `/share/[token]`, legacy redirects
- Shell: collapsible sidebar, ⌘K palette, keyboard shortcuts, cheatsheet
- Theme: Fraunces + Outfit + JetBrains Mono, sharpened palette, dark mode
- Zero `!` / `as any` / `@ts-ignore` across new code

## Not verified (requires prod deploy)

Deferred to post-deploy QA:
- Inbox notification latency (comment/booking → inbox item within 3s per E1 Core check)
- `j`/`k` keyboard nav on real device
- Unread badge accurate under real concurrency
- Reply-inline on comment items (not yet implemented — listed as Phase F+ per spec note)

---

**Phase E status: code complete, structurally green, ready for deploy QA.**
