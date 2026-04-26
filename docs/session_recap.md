# Session Recap — Live Handoff State

> **READ THIS FIRST at the start of every session.** This file is a rolling snapshot of the current project state. It's overwritten at every checkpoint so it always reflects "right now." If you need history, `git log` this file.

---

## 🕐 Last checkpoint

**2026-04-26 — Landing page restoration shipped (PR #50, squash `eeced00`).** Founder restored the original warm-aesthetic landing design (Outfit + Syne, amber/copper palette, tactile noise, CSS-only animations) over the prior decomposed-component landing. Branch deleted, docs archived, mistake-log updated.

---

## ✅ What this session shipped (PR #50 → main)

| Phase | Commit (squashed into `eeced00`) | Content |
|---|---|---|
| **PM** | `0244454` | `docs(prd): §3.5 landing page restoration` — locked aesthetic, 17-section composition, CTAs, no modal, no fabricated social proof |
| **Architect** | `ca2b1b9` | `docs(plans): architecture + source HTML reference` — full technical plan with file structure, CSS strategy, story breakdown |
| **Dev S1** | `4ce5644` | `feat(landing): S1 — CSS foundation, fonts, noise overlay` (later partly fixed by `c1f454f`) |
| **Dev S2** | `e6d209e` | `feat(landing): S2 — port 11 original sections from founder design` |
| **Dev S3** | `3d7138d` | `feat(landing): S3 — TrustBar, Compare, Security, FAQ, Founder, Download` |
| **Dev S4** | `52f8f41` | `feat(landing): S4 — page test + CTA verification + full gate` |
| **Hotfix P0** | `222dcfe` | `fix(landing): wire IntersectionObserver for .reveal-up — UX critic P0` |
| **Refactor** | `879d578` | `refactor(landing): pivot to verbatim single-file port per founder feedback` |
| **Hotfix P0** | `c1f454f` | `fix(landing): correct .page-loaded scoping — descendant combinator → chained class` |

---

## 📍 Current state

| Thing | State |
|---|---|
| **`main` HEAD** | `eeced00` (PR #50 squash merge) |
| **Working tree** | clean at `/Users/giliasraf/Skitza 16.4` |
| **Branches in flight** | `feat/today-redesign` (Today screen redesign — UI work in progress), `feat/onboarding-rebuild` (10-story producer onboarding wizard rebuild — see prior recap commit) |
| **Worktrees** | `/Users/giliasraf/skitza-landing-restore` should be removed (`git worktree remove`) — landing-restore branch is deleted from origin |
| **Tests on main** | locally green (typecheck + lint + 720 tests + build) |
| **CI on main** | the GitHub Actions `test` job has been failing on every push since `222dcfe` — likely environmental (billing block per 2026-04-23 mistake-log pattern), not a real code issue. Vercel deploys independently and is green. Worth confirming next session whether the GH Actions billing/secrets need attention. |

---

## 🛠 Deferred polish (UX critic flagged, not blocking)

1. **Replace emoji icons with SVG/CSS shapes** in the dark-world sections — `🔒 ☁️ 🛡️ 💻 📱` render inconsistently across platforms (color on macOS, monochrome on Windows). Affects Security, Download, Consolidation tool-chips, SolutionFlow bullets. The source's `pain-grid` does this right with hand-drawn CSS faces — apply the same discipline.
2. **Real founder photo** at `apps/web/public/founder/gili.jpg` (240×240+) to replace the GA-initials placeholder in the Founder section. Wire-up is one `<Image>` swap.

Both deferrable to a future PR — landing aesthetic is at 8.5/10 today; these take it to 9/10.

---

## 🎯 What's next (founder's choice)

1. **Resume `feat/today-redesign`** — there was uncommitted WIP (`app-shell.tsx`, `sidebar.tsx`, new `sidebar-share-chip.tsx`) at session start. Verify whether that's still in-progress or already landed.
2. **Resume `feat/onboarding-rebuild`** — per prior recap, 10 stories queued, Story 01 was about to be dispatched. Re-read [`docs/plans/active/2026-04-25-onboarding-rebuild-architecture.md`](plans/active/2026-04-25-onboarding-rebuild-architecture.md) to resume.
3. **Polish the landing** (P1+P2 above) — small follow-up PR to take the aesthetic to 9/10.
4. **Investigate the GH Actions test job** — RED across all branches recently. If it's billing, the user needs to top up the GH org credit (Claude can't do that).

---

## 🗂 Where the landing-restore docs live now

- **Brief**: `docs/plans/archive/2026-04-26-landing-restore-brief.md`
- **Architecture**: `docs/plans/archive/2026-04-26-landing-restore-architecture.md`
- **Source HTML reference**: `docs/plans/archive/2026-04-26-landing-restore-source.html` (the founder's original static HTML, 2,051 lines — kept for future reference)
- **PRD section**: §3.5 in [`docs/product/PRD.md`](product/PRD.md)

---

## 🔑 How to resume from cold

1. Read this file.
2. Read [CLAUDE.md](../CLAUDE.md) — auto-loaded; check the running mistake log (especially the new 2026-04-26 CSS-scoping entry).
3. `git status` to see whether you're on `main` or one of the in-flight branches.
4. Ask the founder: "what's the priority — resume Today / resume Onboarding / polish landing / investigate CI?"

---

## 🟠 Known bugs still on main (quarantine list — unchanged from previous session)

Diagnosable now with Sentry + PostHog live. No touching these files until ~1 week of real-user data:

1. `/sign-in` line 8: `forceRedirectUrl="/dashboard"` — ignores `redirect_url` query param **(this affects the new landing's Sign Up flow — every "Sign up now" CTA passes `redirect_url=%2Fonboarding`, so check that Clerk honors it post-sign-up; if not, this bug just got more visible)**
2. `/artist-welcome` (no slug): no role guard for authed users with real studios
3. Webhook race on `/artist-welcome/<slug>` — fast-clickers land on `/artist` before `client_contacts` row exists

---

## 🧹 Update discipline

**This file is overwritten, never appended.** Update at every natural checkpoint per `CLAUDE.md` § Session handoff protocol.
