# Phase C — Structural QA (feat/deal-architecture)

> Date: 2026-04-17
> Branch: `feat/deal-architecture`
> HEAD: `5bb8bc8` (post-C.5)
> Scope: **structural checks only** (what's verifiable without deploying to prod). Interactive Idiot-Proof QA (real producers using a real browser) requires R2 env + migrations applied + branch merged — deferred to post-deploy.

## Gate results

| Check | Result |
|---|---|
| `pnpm --filter web typecheck` | ✅ clean |
| `pnpm --filter web lint` | ✅ clean |
| `pnpm --filter web test` | ✅ 20 files / 120 tests |
| `pnpm --filter web build` | ✅ 30+ routes emit, 102 kB shared first-load |

## Route emission — all Phase C routes present

| Route | Size | Purpose |
|---|---|---|
| `ƒ /dashboard` | 16.3 kB | **NEW**: Pipeline Kanban (C.4) |
| `ƒ /dashboard/deals/[id]` | 24.2 kB | **NEW**: 5-tab deal detail (C.3) |
| `ƒ /dashboard/deals/new` | 3.97 kB | **NEW**: Create deal + artist autocomplete (C.5) |
| `ƒ /dashboard/projects` | 184 B | Legacy redirect → `/dashboard` |
| `ƒ /dashboard/projects/[...slug]` | 184 B | Legacy redirect → `/dashboard/deals/{id}` |
| `ƒ /share/[token]` | 2.98 kB | **RESTORED**: artist share page (C.3) |

Non-Phase-C routes unchanged in size / behavior.

## What shipped (commit summary on `feat/deal-architecture`)

| Commit | Task | What |
|---|---|---|
| `d60fa5e` | C.1 | DB rename projects→deals, stage enum, deal_id FK on bookings. Hand-edited migration 0008 preserves data via `RENAME TO` / `RENAME COLUMN` |
| `113372e` | C.2 | Router renamed (`dealRouter`), `setStage` + `listByStage` added, app-shell tab updated |
| `b355124` | C.3 | Deal detail with 5 tabs, Server Actions restored, `/share/[token]` restored, legacy `/dashboard/projects` redirects, disabled dirs deleted |
| `453daa4` | fix | `publicUrl` drops bucket from path — R2 `pub-*.r2.dev` is bucket-scoped |
| `ed08411` | C.4 | Pipeline Kanban at `/dashboard`, dnd-kit drag-drop, optimistic state, 11 new helper tests |
| `beae940` | fix | Functional state updates prevent stale-closure revert on drag failure |
| `5bb8bc8` | C.5 | Client contacts cache: schema, upsert helper, list router, 3 call-sites wired (booking.publicRequest + deal.create + deal.publicComment), new-deal form autocomplete |

**Net: 7 commits, ~6,000 lines added/removed, test coverage up 12 tests (108 → 120).**

## Structural invariants verified

1. **No `!` / `as any` / `@ts-ignore`** anywhere in Phase C code.
2. **Ownership walks** on every producer procedure in `deal.ts` (deal→producer, track→deal→producer, version→track→deal→producer, comment→version→...→producer).
3. **Token discipline** preserved (sha256(token) → DB; raw returned once on creation).
4. **No `projects`/`projectTracks`/`projectId` references** remaining in new Phase C code (grep-clean except legacy-redirect explanatory comments).
5. **Consistent palette token usage** (`--brand-primary`, `--fg-*`, `--bg-*`, `--border-*`, `--radius-*`). No hardcoded colors.
6. **Client-contact privacy**: emails stored lowercased with sha256 hash as dedupe key; UNIQUE(producerId, emailHash) prevents cross-producer leaks.

## Cannot verify without deploy (requires user action first)

These need **R2 env set + migrations applied + merged to main + deployed** before we can walk through:

| Test | What requires deploy |
|---|---|
| Pipeline Kanban drag-drop with real data | Need DB with deals at various stages |
| Create deal → upload audio → play in-tab | R2 bucket needed |
| Send contract → artist signs → copper seal | R2 + contract schema (after contracts-v2 merge) |
| Mobile viewport 375px — tap targets, scrolling | Need deployed build |
| Autocomplete on new-deal form | Need pre-existing contacts (created via prior bookings/deals) |
| Legacy redirect from old magic-link URLs | Need production main with deals routes live |

These should run as part of the **Phase C Idiot-Proof QA in production** once the user completes their blockers.

## Post-deploy QA checklist (deferred)

Run when `feat/deal-architecture` is merged + migrations applied + R2 env set:

```
Core (from design §7):
[ ] C1 Dashboard = Kanban with deals visible, no empty-chrome if seeded
[ ] C2 Drag a card to next column → persists on refresh
[ ] C3 Click deal → tabs show state within 300ms
[ ] C4 From a deal, create booking + contract + room in any order, all show in tabs
[ ] C5 /dashboard/projects → redirects to /dashboard/deals (or the new root)
[ ] All universal Core C1–C8

Phase C specific:
[ ] Kanban drag with 3G throttling — optimistic state feels instant
[ ] Deal detail tabs keyboard-navigable via Tab
[ ] Artist autocomplete on new-deal form shows past contacts
[ ] Legacy /dashboard/projects/{uuid} redirects to /dashboard/deals/{uuid} (if ids preserved)
```

## Follow-ups queued

| Item | Reason |
|---|---|
| **A.8.1** | Wire AudioUploader into portfolio create flow (B.8 scope deferred) |
| **B.5.1** | PKCS#7 seal via signpdf once cert is available |
| **C race-safety** | Kanban no in-flight drag lock (low-likelihood, noted in C.4 review) |
| **C.4 setStageAction duplicate** | One in `kanban-actions.ts`, one in `deals/actions.ts` — consolidate later |
| **C.5 listWithMeta** | Contracts list could include recipient counts (TODO in contracts/page.tsx, from B.8) |

---

**Phase C status: code complete, structurally green, ready for deploy QA.**
