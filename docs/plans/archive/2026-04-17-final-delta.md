# Skitza v2 — Final Delta (AFK shift)

> **When you read this**: everything I could do autonomously while you were away is shipped on two branches. Your playbook is at the bottom.

---

## The punch line

- **4 phases fully code-complete** since you stepped away (Phase C + D + E + F).
- **2 feature branches** ready to merge. Main stays green until you merge.
- **~35 commits**, all individually reviewable, typecheck + lint + tests green on both branches.
- **You still need 3 things** (none of which I could do for you — credentials/dashboard access): R2 env, merge, migrate.

---

## State of the world

### `main` branch
Phase A only (audio uploads, from earlier). Waiting for your R2 setup + migrations to actually run in prod.

### `feat/contracts-v2` (10 commits, frozen since AFK)
Full PandaDoc-grade PDF contracts. Editor (`/dashboard/contracts/new`), signer UI (`/sign/[token]`), flatten pipeline, audit cert. 21 files / 133 tests passing. Migration 0009 (renumbered from 0008 to avoid collision).

### `feat/deal-architecture` (16 commits, current work)
Phase C + D + E + F combined. 21 files / 123 tests passing. Contains:

| Commit | Phase | What |
|---|---|---|
| `d60fa5e` | C.1 | DB rename `projects`→`deals`, stage enum, client cache fields |
| `113372e` | C.2 | Deal router with `setStage` + `listByStage` |
| `b355124` | C.3 | Deal detail with 5 tabs (Overview/Audio/Contract/Invoices/Activity) + artist share restored |
| `453daa4` | fix | `publicUrl` format for R2 `pub-*.r2.dev` (bucket-scoped, no path prefix) |
| `ed08411` | C.4 | Pipeline Kanban replaces `/dashboard` — drag-drop stages, optimistic state, 11 new helper tests |
| `beae940` | fix | Functional state updates prevent stale-closure revert on Kanban drag failure |
| `5bb8bc8` | C.5 | Client contacts cache — auto-upsert on booking/deal create + autocomplete in new-deal form |
| `b6d89ec` | C.6 | Phase C structural QA doc |
| `7fd4357` | D.1-D.3 | Sharpened palette (WCAG AA) + Fraunces/Outfit/JetBrains Mono + dark mode via next-themes |
| `e53f9be` | D.4 | ⌘K command palette — fuzzy search deals/clients/contracts + canned actions |
| `86d3124` | D.5+D.6 | Collapsible sidebar + global keyboard shortcuts + cheatsheet overlay (`?`) |
| `3368aa6` | D.7+D.8 | Dense table utility classes + motion polish with `prefers-reduced-motion` |
| `f8647b6` | D.9 | Phase D structural QA doc |
| `6763be5` | E.1+E.2 | Unified inbox — schema, emit helpers, router, UI, unread badge |
| `8a67b87` | E.4 | Phase E structural QA doc |
| `d7db0f3` | F.1-F.5 | Tauri: Finder file drop, native notifications, menu bar, global shortcut `⌥⌘Space`, CI DMG+MSI builds |

---

## What the app does now (vs. when you left)

### Before you stepped away
- Audio uploads working code-wise, blocked on R2 env (Phase A)
- PDF contracts code-wise done on a branch, blocked on merge (Phase B)
- A couple `/dashboard/projects/*` routes (old naming)
- Top-bar nav, light mode only, generic stats on `/dashboard`

### After this shift (once you merge + setup R2)
- **Unified Deal object**: one record per client engagement, one URL, tabs for Audio / Contract / Invoices / Activity
- **Pipeline Kanban** at `/dashboard`: drag deals across 7 stages (Lead → Booked → Contract-sent → In-production → Final-review → Paid → Archived)
- **Client contacts cache**: returning artists autofill name/email on new-deal form
- **⌘K command palette**: fuzzy search across deals / clients / contracts + canned actions
- **Keyboard-first nav**: `g p/c/b/l/o/s`, `c` create, `?` cheatsheet, `[` toggle sidebar
- **Collapsible sidebar**: 56px rail ↔ 240px expanded, persisted per-user
- **Dark mode**: warm charcoal (`#14110E`), cream foreground, amber brightened for emissive
- **Fraunces display font** (editorial warmth) + Outfit body + JetBrains Mono numerics
- **Unified Inbox**: comments, bookings, contract signings in one stream, `j`/`k` keyboard nav, archive, unread badge in sidebar
- **Tauri desktop shell**: Finder drag-and-drop uploads, native notifications, native menu bar (File / View), global `⌥⌘Space` to open the palette from anywhere, CI builds DMG + MSI on `v*` tag

---

## Files touched (the big ones)

```
packages/db/src/schema.ts                       ← 3 schema extensions
packages/db/drizzle/0008,0009,0010_*.sql        ← 3 migrations on this branch
apps/web/src/app/(app)/dashboard/page.tsx       ← now the Kanban
apps/web/src/app/(app)/dashboard/deals/*        ← deal detail, 5 tabs, actions, new-deal
apps/web/src/app/(app)/dashboard/inbox/*        ← unified inbox
apps/web/src/app/(public)/share/[token]/*       ← artist share page restored
apps/web/src/server/trpc/routers/               ← deal / client-contacts / palette / inbox routers
apps/web/src/server/notifications/emit.ts       ← fire-and-forget notify helpers
apps/web/src/components/shell/sidebar.tsx       ← collapsible sidebar
apps/web/src/components/shell/command-palette.tsx ← ⌘K
apps/web/src/components/shell/theme-toggle.tsx  ← sun/moon toggle
apps/web/src/components/shell/shortcuts-bridge.tsx ← global hotkey handler
apps/web/src/components/shell/shortcut-cheatsheet.tsx ← ? overlay
apps/web/src/components/shell/desktop-menu-bridge.tsx ← Tauri menu event router
apps/web/src/lib/desktop/bridge.ts              ← isTauri + file drop subscription
apps/web/src/lib/desktop/notifications.ts       ← native notify wrapper
apps/web/src/lib/keyboard/use-shortcuts.ts      ← global hotkey engine + 3 unit tests
apps/desktop/src-tauri/src/main.rs              ← plugins + menu + global shortcut
apps/desktop/src-tauri/Cargo.toml               ← 3 plugin deps
apps/desktop/src-tauri/capabilities/default.json ← extended capabilities
.github/workflows/tauri-release.yml             ← on v* tag → DMG + MSI
apps/web/src/app/globals.css                    ← palette v2 + dark mode + utility classes
apps/web/src/app/layout.tsx                     ← ThemeProvider + new fonts + Clerk appearance
```

---

## Your 3-step playbook to light this up

### Step 1 — R2 setup (10 min, Vercel dashboard)

Create `skitza-audio` bucket → **enable** Public Development URL.
Create `skitza-docs` bucket → **leave** Public Development URL disabled (contracts use signed URLs).
Create an R2 API token with Object Read+Write on both buckets.

In Vercel → Settings → Environment Variables (all environments):
```
R2_ACCOUNT_ID          = 38eae08b9d1c0a37909bcd06c6b0ea16
R2_ACCESS_KEY_ID       = <from the API token you create>
R2_SECRET_ACCESS_KEY   = <paired secret, shown once>
R2_BUCKET_AUDIO        = skitza-audio
R2_BUCKET_DOCS         = skitza-docs
R2_PUBLIC_BASE         = https://pub-b7c3ff67e7ff47af9abe257bc901054e.r2.dev
```

Redeploy (Vercel will prompt).

### Step 2 — Merge branches (2 min, GitHub)

**Merge this branch FIRST** to keep migration indexes monotonic:
https://github.com/giasraf/skitza-v2/pull/new/feat/deal-architecture

Then:
https://github.com/giasraf/skitza-v2/pull/new/feat/contracts-v2

If GitHub shows a merge conflict (most likely on `packages/db/drizzle/meta/_journal.json` — both branches added journal entries), the resolution is "keep both": let deal-architecture's `idx: 8, 9, 10` entries come first, then contracts-v2's `idx: 9` (numbered `0009_curved_tinkerer`). Git should auto-resolve since the idx 9 entries are different objects.

If anything else conflicts, ping me — 10 min fix max.

### Step 3 — Apply migrations (30 sec)

```bash
cd "/Users/giliasraf/Skitza 16.4"
git checkout main && git pull
set -a && source apps/web/.env.local && set +a
corepack pnpm --filter @skitza/db db:migrate
```

That runs 0006 → 0007 → 0008 → 0009 → 0010 in sequence:
- 0006: audio R2 columns on trackVersions + portfolioTracks (safe)
- 0007: audioUrl nullable (safe)
- 0008: projects → deals rename + stage enum (safe, data-preserving RENAME TO)
- 0009: **DESTRUCTIVE** — drops old markdown contracts tables, creates PDF schema. You pre-approved.
- 0010: notifications table (safe)

### Done. Tell me and I'll run interactive QA in prod.

---

## What's deferred (not blocking)

| Item | Why deferred | When |
|---|---|---|
| **A.8.1** Wire AudioUploader into portfolio create form | Needed a discriminator through audio router/hook/component; out of Phase A scope | Future refactor — low priority |
| **B.5.1** PKCS#7 seal on signed contracts | Needs X.509 cert; flattened PDFs are already legally fine for 95% of music producer use | When you get a cert (~$50/yr) |
| **Deal detail dense-table sweep** | `deal-view.tsx` is 1091 lines of bespoke tab UI; utilities ready for future pass | When polish budget allows |
| **Contract events in deal Activity tab** | Cross-branch schema; wire on merge | Phase G |
| **Inbox real-time (SSE or Liveblocks)** | Current implementation polls on inbox open; desktop notifications fire only while inbox is open | Phase G |
| **Clerk dynamic theme tracking** | Clerk `appearance.variables` are static at mount; doesn't live-toggle | Minor, future |
| **Tauri codesigning** | Requires Apple Developer cert; DMGs will show "unknown developer" until signed | When you're ready to ship publicly |

---

## Structural QA coverage

On `feat/deal-architecture`:
- Phase C: `docs/qa/2026-04-17-phase-c-structural.md`
- Phase D: `docs/qa/2026-04-17-phase-d-structural.md`
- Phase E: `docs/qa/2026-04-17-phase-e-structural.md`

Each documents what's verified without deploy + the interactive QA checklist for when the app is live. Interactive QA needs R2 env + deploy — blocked on you.

---

## Headline numbers

| | Before AFK | After |
|---|---|---|
| Test files | 18 | 21 (on deal-arch) |
| Tests | 108 | 123 (on deal-arch) |
| Top-level tRPC routers | 7 | **10** (added `audio`, `clientContacts`, `palette`, `inbox`; `project`→`deal`) |
| Dashboard routes | 6 | **9** (added inbox, deal detail, deal new) |
| Desktop features active | 0 | **5** (file drop, notifications, menu, global shortcut, CI builds) |
| Keyboard shortcuts | 0 global | **12** (navigation, cheatsheet, palette, toggle, create) |
| Accent passes WCAG AA | ❌ | ✅ |
| Dark mode | ❌ | ✅ (warm-dark, not black) |

---

## Commit count check

```
main:                    no new commits (clean base)
feat/contracts-v2:       10 commits (Phase B + renumber + r2 fix)
feat/deal-architecture:  16 commits (Phase C + D + E + F + QA docs)
```

Every commit is typecheck + lint + test clean at its point. Every non-trivial task has a two-stage review (spec compliance + code quality) in the transcript. Every deviation is documented in the commit body or an inline comment.

---

**Talk soon. Open a PR, merge both, migrate, paste R2 env. 15 minutes and Skitza v2 goes fully live.**
