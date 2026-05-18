# Design alignment — session handoff (2026-05-06)

> Paste the prompt below as the first message of a fresh Claude Code session at `/Users/giliasraf/Skitza 16.4`. It is self-contained and assumes zero context carryover.

---

## The prompt

```
# Skitza — continue the design alignment work (fresh session)

You're picking up an in-flight design alignment effort on Skitza, a SaaS for music producers (live at skitza.app). The previous session shipped 9 PRs across the producer + artist + public surfaces. There's a clear punch list of what's left. Read this whole prompt before doing anything.

## Mission

Bring the live app at skitza.app to full design + PRD alignment. The design package is the king (founder Gili stated this explicitly). When unsure → ask Gili in plain English.

## Critical context — read these in order BEFORE any tool call

1. `/Users/giliasraf/Skitza 16.4/CLAUDE.md` — codebase memory, conventions, mistake log
2. `textutil -convert txt "/Users/giliasraf/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/C1734190-E795-4193-A88A-DAEA0196555B/Skitza Design Context 2026.docx" -stdout` — locked design system
3. `textutil -convert txt "/Users/giliasraf/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/9ABBE0C4-3192-4E06-A319-DD2E192263EF/skitza-prd-v3.docx" -stdout` — PRD v3 (audit-corrected)
4. Design ZIP source: `/Volumes/KINGSTON/Downloads/skitza (1).zip` — extract with `unzip -o "/Volumes/KINGSTON/Downloads/skitza (1).zip" -d /tmp/skitza-design`. Per-screen design JSXs are in `/tmp/skitza-design/tabs/` and `/tmp/skitza-design/screens/`.

## What's the trunk

- Branch: `v3-clean` (NOT `main`). Auto-deploys to skitza.app via Vercel.
- Latest tip when this prompt was written: `23be57c` — pull latest at session start: `git fetch origin v3-clean && git log origin/v3-clean -3 --oneline`
- Producer dashboard routes are under `(producer)/dashboard/*` (NOT `(app)/`).
- Public + auth + artist routes exist under `(public)/`, `(auth)/`, `(artist)/`.

## What's already shipped on v3-clean (don't redo)

| PR | Surface |
|---|---|
| #62 | Calendar — Schedule grid + Intro Requests + Today card |
| #63 | Public producer page (`/join/<slug>`) — sticky nav + portrait card + meta strip + Recent Work + dark CTA |
| #64 | Storefront — 2-col + sticky public preview + page stats + product cards with kebab |
| #65 | Artist 5-tab platform polish — Home / Music / Book / Store / Settings |
| #66 | Music L3 song page — gradient hero + 50-bar Waveform + comments thread + Approve version |
| #67 | Onboarding wizard — 4-step visual polish (Syne hero + mono progress + reveal-up) |
| #68 | Project Room — 5-tab detail view (Overview / Music / Sessions / Files / Notes) |
| #69 | Overview — Public Link strip + Recent Uploads + Financial Pulse 3-col |
| #70 | Settings — collapsed 7 tabs to 2 branches per PRD §4.6 (Profile + Integrations) |

Confirm via: `git log origin/v3-clean -10 --oneline`

## What's left — work this priority order

### 🔴 P0 — Fix Vercel env var (NOT a code change)
The Public Link strip on `/dashboard` shows `skitza-v2-web.vercel.app/p/<slug>` instead of `skitza.app/p/<slug>`. Fix: tell Gili to update `NEXT_PUBLIC_SITE_URL` in Vercel project settings. He does this himself — you cannot.

### 🟠 P1 — In priority order
1. **Booking flow 3-step modal** — design ZIP has `booking-flow.html` + `screens/booking-artboards.jsx`. Today the "Book a session" CTA on `/join/<slug>` routes to `/sign-up`. Build the inline 3-step modal (slot → product → confirm) per design.
2. **Auth screens polish** — design ZIP has `tabs/auth.jsx`. Verify the current Clerk-rendered sign-in/sign-up matches design, polish if not.
3. **Artist app visual verify** — PR #65's code is shipped but role-gated. Gili needs to sign up in Incognito via `/join/sdasd-c602` to test. Or you can dispatch a verification agent that uses Playwright to sign up + screenshot all 5 tabs.
4. **Mobile producer chrome smoke** — Phase 4 shipped mobile but no visual verification at 360/768/1280 across all 6 producer screens. Dispatch an agent or do a visual sweep with `mcp__Claude_in_Chrome__*`.

### 🟡 P2 — small backlog (per-PR followups)
- Public page meta strip → real producer stats (currently defaults)
- Project Room Notes tab → write path (`projects.updateNotes` tRPC procedure)
- Project Room timeline → real `paid_at` column instead of "latest activity" surrogate
- Overview Urgent card → project-level server query (currently filters `today.items`)

### 🟢 P3 — defer to post-launch
- Project Room Files tab (needs `project_files` DB table — borders Phase H)
- Settings Services/Portfolio/Availability migration OUT to dedicated pages (PRD §4.6 wants this once those pages mature)
- Settings: delete-account self-serve, GCal OAuth, CSV import

### 🚫 OUT OF SCOPE — Gili explicitly said NO
Do NOT touch these. They live on `feat/phase-h` (3 weeks abandoned). Don't import phase-h code, don't bring its features in.

- Stripe Connect / invoices / checkout
- Resend email + reminders + cron
- Products v2 (per-song tiers / hourly / bundle / multi-deposit-models)
- Multi-block availability with overlap validation
- Contracts module + PDF upload
- Standalone Library page (separate from Music)
- Mac DMG

## Immutable constraints

1. **Design + PRD are king.** When unsure, follow the design ZIP + PRD v3 + Design Context doc.
2. **Skip BMAD.** Per Gili's memory: BMAD was removed in Phase 1 demolition. Just build from briefs.
3. **No Phase H.** Don't import any phase-h-only modules. Don't add Stripe / Resend / products-v2 / contracts / library-routes / kanban / leads / deals.
4. **No `git commit --amend` ever.** New commits only. Frequent small commits.
5. **No `--no-verify`, no `--no-gpg-sign`, no `--admin` on PR merge.**
6. **Run `/skitza-verify` before push** (typecheck + lint + test). Use `pnpm -F web build` too — Next.js catches route-group issues that tsc doesn't.
7. **The `/p/[slug]` route is dead.** All public links use `/join/<slug>` even though design files mention `/p/`. Don't try to "fix" this.
8. **Public route group (`/`, `/sign-in`, `/sign-up`, `/join/<slug>`) is ENGLISH ONLY, LTR ONLY.** No `t()` calls, no `NextIntlClientProvider`. Never put i18n at root layout — pin html to `lang="en" dir="ltr"`.
9. **Use design tokens only.** No hex codes (`#D4960A`), no Tailwind color literals (`bg-blue-500`). Use `rgb(var(--brand-primary))`, `rgb(var(--bg-elevated))`, etc.
10. **Migrations are broken past 0018.** Use `/skitza-migrate` slash command to apply via direct neon client. Don't trust `drizzle-kit migrate`.

## Orchestration recipe — what worked last session

For anything that touches a non-trivial slice (≥3 files), dispatch a focused background agent. The pattern:

1. Use `Agent` tool with `subagent_type: "general-purpose"`, `isolation: "worktree"`, `run_in_background: true`.
2. **CRITICAL FIRST STEP in every agent prompt**: include `git fetch origin v3-clean && git checkout origin/v3-clean -b claude/<slice> && git rev-parse --short HEAD  # MUST be latest v3-clean tip — STOP if not`. Last session, agents inherited stale bases without this — caused a botched rebase that lost an agent's commits and required reflog recovery.
3. Brief the agent: read CLAUDE.md + Design Context + PRD + the specific design ZIP file for the slice. Touch ONLY the assigned directory. No Phase H imports.
4. Tell the agent to run `pnpm -F web typecheck && lint && test && build` before pushing.
5. Tell the agent to open PR with `gh pr create --base v3-clean --head <branch>` (NOT `main`).
6. Multiple non-overlapping slices → dispatch in parallel (single message with multiple Agent calls).
7. When merging clean PRs: `gh pr merge <n> --squash` (without `--admin`). Vercel takes 1-3 min to deploy.

## Vercel gotcha

Edge cache lags ~1-3 min behind merges. If a deployed change isn't visible, navigate to a never-before-visited URL fragment (`?bust=<random>` may still hit cache; try a real path variant like `?branch=integrations` if testing Settings) — that bypasses the edge cache. Don't assume code didn't ship just because the page looks unchanged.

## Tools you'll want

- `Bash` for git / gh / curl
- `mcp__Claude_in_Chrome__*` for visual verification (the user's Chrome is connected; navigate to skitza.app/dashboard etc.)
- `Agent` (with worktree isolation + background) for parallel work
- `TodoWrite` to track multi-step plans

## First action

1. Run: `git -C "/Users/giliasraf/Skitza 16.4" log origin/v3-clean -10 --oneline` to confirm trunk state matches what this prompt described.
2. Read CLAUDE.md (full).
3. Run `unzip -o "/Volumes/KINGSTON/Downloads/skitza (1).zip" -d /tmp/skitza-design` to re-extract the design package.
4. Ask Gili: "I see the punch list — want me to start with the Booking modal (P1 #1), or pick a different priority? Also, did you fix `NEXT_PUBLIC_SITE_URL` in Vercel yet (the P0 env var)?"

Don't dispatch any agent until Gili picks a priority. Don't read the WhatsApp .docx files into your own context — that bloats. Use `textutil` to extract on-demand, and dispatch an agent that reads its own design source.
```

---

## Session 2026-05-06 — what shipped

### 9 PRs landed on `v3-clean` (final tip `23be57c`)

| PR | Squash SHA | Title |
|---|---|---|
| [#62](https://github.com/Skitza-G-R/skitza-v2/pull/62) | `2e41aea` | feat(calendar): schedule grid + intro requests + today card |
| [#63](https://github.com/Skitza-G-R/skitza-v2/pull/63) | `5679fd0` | feat(join): polish public producer page — sticky nav, hero portrait, dark CTA |
| [#64](https://github.com/Skitza-G-R/skitza-v2/pull/64) | `272da59` | feat(storefront): 2-col layout + page snapshot + kebab menu |
| [#65](https://github.com/Skitza-G-R/skitza-v2/pull/65) | `9b904d2` | feat(artist): polish 5 tabs to locked design (Home / Music / Book / Store / Settings) |
| [#66](https://github.com/Skitza-G-R/skitza-v2/pull/66) | `4d373dc` | feat(music): producer Music L3 song page + EqBars indicator on L1 |
| [#67](https://github.com/Skitza-G-R/skitza-v2/pull/67) | `7efc996` | feat(onboarding): visual polish — Syne hero, mono progress, reveal-up animations |
| [#68](https://github.com/Skitza-G-R/skitza-v2/pull/68) | `0854015` | feat(project-room): 5-tab detail view (Overview / Music / Sessions / Files / Notes) |
| [#69](https://github.com/Skitza-G-R/skitza-v2/pull/69) | `d8fc3af` | feat(overview): public link strip hero + design-aligned card hierarchy |
| [#70](https://github.com/Skitza-G-R/skitza-v2/pull/70) | `23be57c` | refactor(settings): collapse 7 tabs to 2 branches per PRD v3 §4.6 |

### Test surface

- 1027 → 1052 tests passing on `v3-clean` (+25 net from agents adding new test coverage)
- typecheck + lint + build all green at `23be57c`

### Lessons captured (apply next session)

1. **Always inject `git fetch && git checkout origin/v3-clean -b <branch>` as agent's first command.** `isolation: "worktree"` defaults inherit the parent worktree's branch state, which can be stale. Last session had Calendar + Public-page agents pick up Phase 3 era and `main` HEAD respectively. Fixed only by retroactive rebase.
2. **For taste-level merges (e.g. PR #63's `join-hero.tsx` had agent's polish + v3-clean's `externalLinks` chip row), use `git merge` over `git rebase`.** Rebase + `--theirs` for conflict resolution can drop commits that become no-ops. Merge keeps both histories.
3. **Vercel edge cache lags ~1-3 min behind merges and sometimes serves stale content with `?bust=<random>` query.** To force a fresh render, navigate to a real path variant the user hasn't visited (e.g. `?branch=integrations` for testing Settings). The CDN keys cache by full URL shape.
4. **`gh pr merge --admin` is blocked** by Claude's permission system on production trunk merges. Plain `gh pr merge --squash` works; respects branch protection. Don't reach for `--admin`.
5. **Agent worktree branches stay locked** while the agent process is alive. After agent completes, branches can be deleted on remote (`git push origin --delete <branch>`) but the local worktree path stays locked. Rely on remote deletion + `git worktree prune` later.

### Visual verification status

| Surface | Verified live? |
|---|---|
| Producer Overview (`/dashboard`) | ✅ |
| Producer Clients & Projects (`/dashboard/clients-projects`) | ✅ |
| Producer Project Room (`/dashboard/clients-projects/[id]`) | ✅ |
| Producer Music Library (`/dashboard/music`) | ✅ |
| Producer Music L3 song page (`/dashboard/music/[versionId]`) | ✅ |
| Producer Calendar Meetings (`/dashboard/calendar`) | ✅ |
| Producer Calendar Availability (`/dashboard/calendar?tab=availability`) | ✅ |
| Producer Storefront (`/dashboard/profile?tab=store`) | ✅ |
| Producer Settings (`/dashboard/settings?branch=integrations`) | ✅ |
| Producer Onboarding (`/dashboard/onboarding`) | ✅ |
| Public producer page (`/join/<slug>`) | ✅ |
| Artist app (`/artist/*`) | 🔒 role-gated, needs Incognito artist signup |
