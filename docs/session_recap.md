# Session Recap — Live Handoff State

> **READ THIS FIRST.** Rolling snapshot of project state. Overwritten at each checkpoint. `git log` this file for history.

---

## 🕐 Last checkpoint

**2026-04-25 evening — Setup flatten + density refactor merged (PR #45). Every Setup tab now renders its full management UI inline; Availability uses a Mon–Sun day-tab pattern with indicator dots; the page lives in one centralized container card with a brand glow. Booking page imports the same lifted components so the two surfaces can never visually drift.**

---

## ✅ Shipped since last recap (2026-04-23 → 2026-04-25)

| PR | Title |
|---|---|
| #38 | Post-merge ops followup — observability verification + playbooks |
| #39 | Project detail RSC boundary fix — first bug caught end-to-end by Sentry |
| #40 | R2 bucket CORS policy — browser uploads were failing on preflight |
| #41 | Contributor onboarding guide — for new dev collaborators |
| #42 | Branded onboarding PDF generator — 24-page brand-styled output |
| #43 | Persistent dashboard shell — `<AppShell>` moved to layout.tsx |
| #44 | Recap checkpoint (pre-#45) |
| **#45** | **Setup flatten + density refactor** — see scope below |

### PR #45 scope

- Services + Availability render full management UI inline (no more cross-link buttons). Booking page imports the same `ServicesSection` + `AvailabilitySection` so they can't visually drift.
- Dynamic page H1 + description per tab via `SETUP_SECTION_META`. Eyebrow stays `SETUP`.
- Day-tab pattern on Availability — chips with indicator dots (brand if windows, danger if error). `defaultSelectedDay()` picks today → first non-empty → today.
- Density: `h-8` controls, tighter spacing, single-row blackout form, smaller preset chips.
- New `.sk-card-glow` primitive in globals.css. Outer container card holds everything; per-section frames stripped.
- Legacy redirects: `/dashboard/services` + `/dashboard/availability` → tabbed Setup.
- PRD §4.4 delta committed BEFORE code.

**Tests:** 638 → 696 (+58). **Audit:** Task 9 effectively addressed (duplication gone; URL still works).

---

## 📍 Current state

| Thing | State |
|---|---|
| **Main HEAD** | `e2e5efd9` (PR #45 squash-merged) |
| **Open PRs** | #1, #16, #28, #29 (pre-existing) |
| **In-flight branch** | `feat/onboarding-rebuild` (fresh from main, no commits yet) |
| **Stash** | `stash@{0}` from setup branch (WIP polish — drop if not needed) |
| **Typecheck / Lint / Tests** | ✅ clean locally |
| **CI test job** | ❌ red — billing block, infrastructure (Vercel + local cover it) |
| **Prod schema** | migration 0033 |
| **Sentry / PostHog** | both live, receiving data |
| **Audit** | 9–10 ✅ Fixed · 6 ⏳ Pending · 1 ⏸ Partial |

---

## 🎯 What's next

1. **Onboarding rebuild** — `feat/onboarding-rebuild` open + empty. Task 4: PRD §4.5 wants a 5-step wizard, currently 4 (missing Portfolio + Stripe steps).
2. **Task 10** — landing page TODO placeholders.
3. **Task 3 / S04 UI** — `/join` Section B embed render (PR #28 backing).
4. **Task 17 Phases 2+3** — artist desktop sidebar salvage.

**Parked (need Gili):** Task 5 refund policy, Task 6 cookie banner, Task 7 Privacy + Terms.

**Quarantine (let Sentry collect data):** `/sign-in` `redirect_url` ignored · `/artist-welcome` role guard · webhook race on `/artist-welcome/<slug>`.

---

## 🔑 How to resume from cold

1. Read this file.
2. Read [CLAUDE.md](../CLAUDE.md) — auto-loaded.
3. `gh pr list --state open` — confirm only the pre-existing 4 PRs.
4. Pick from "What's next" — most likely the onboarding rebuild.

---

## 📋 Pointers

- [`docs/audit-report.md`](audit-report.md) · [`docs/product/PRD.md`](product/PRD.md) · [`docs/INDEX.md`](INDEX.md) · [`CLAUDE.md`](../CLAUDE.md)
- Setup refactor plan: `docs/plans/active/2026-04-25-setup-flatten-tabs.md` (move to archive after a quiet day)

---

**Update discipline:** overwritten, never appended. Checkpoint per `CLAUDE.md` § Session handoff protocol.
