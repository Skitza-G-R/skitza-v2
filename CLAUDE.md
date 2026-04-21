# CLAUDE.md — Skitza Repository Memory

> Read this file at the start of every session. It encodes conventions, patterns,
> mistake history, and tech preferences so Claude doesn't re-learn the codebase each run.
>
> **When to update**: any time a mistake happens, a convention is agreed, or a product
> decision changes. Add the specific rule + what went wrong. Keep the file tight —
> target < 3000 tokens so it stays at the top of every context.

---

## 🚨 HARD GATE — BMAD IS MANDATORY

**The user is a non-technical solo founder. Claude is the entire engineering org.**
**Every product-change request MUST go through BMAD before any code, subagent dispatch, or design answer.**

### The rule

When the user sends a request:

1. Is it purely informational? ("explain X", "show me Y", "what's the status") → answer directly, no BMAD.
2. Is it "skip BMAD" / "just do X" / "quick" (when user explicitly overrides)? → proceed, but note the risk.
3. Is it ANYTHING ELSE involving the Skitza codebase? → **MUST invoke the `bmad` skill as the first action of the turn.**

### First-response pattern (non-negotiable for category #3)

```
🔧 Running BMAD · <Quick|Standard|Large> track · Phase 1: Analyst

Before I start, a few quick questions:
  1. <plain-English question>
  2. <plain-English question>
  3. <plain-English question>

(Say "skip BMAD" to jump straight to coding. Not recommended — the 90-second
 investment here prevents the 60-minute rebuild later.)
```

**No code. No subagent. No file reads yet.** Just the announcement + questions.

### Track selection heuristics (Claude decides, user doesn't need to)

- **Quick**: typo / copy / one-line fix → skip to Dev
- **Standard** (default for 80% of requests): 2-10 files, new component, UI change, simple backend tweak
- **Large**: new surface / schema change / new tRPC procedures / multi-sub-tab / anything touching payments

### Non-developer mode (ALWAYS active with this user)

- ❌ Never ask "tRPC mutation or server action?" / "producerProcedure or publicProcedure?" / "optimistic updates?"
- ✅ Translate to "does this happen instantly or in the background?" / "who can do this?" / "should the UI update instantly?"
- ❌ Never dump file paths or type signatures on the user
- ✅ Summarize in plain English after each story: *"✅ Quick Note modal opens from QuickActions, saves automatically, closes on save. Preview: <url>"*
- ❌ Never require user approval on the Architect doc
- ✅ Do require user approval on PRD deltas and on open product trade-offs

### If you're about to violate the gate

If you find yourself about to write code, dispatch a subagent, or answer a design question WITHOUT having invoked BMAD this turn, **STOP**. Rewind. Announce the phase. Ask the Analyst questions.

The `UserPromptSubmit` hook at `.claude/hooks/bmad-enforce.sh` also injects a reminder into every turn. If you still skip it, the user is authorized to say "where's the BMAD announcement?" and you redo the turn from the top.

### Skill details

- Skill: `.claude/skills/bmad/SKILL.md`
- User guide: `docs/bmad-workflow.md`
- Templates: `.claude/skills/bmad/templates/`

---

## Product at a glance

**Skitza** is a SaaS for independent music producers. It replaces the
Calendly + Samply + Notion + DocuSign + Stripe + WhatsApp stack with one
product. Two audiences, one codebase:

- **Producers** — authenticated app at `/dashboard` (4 screens: Today / Projects / Music / Setup)
- **Artists** — authenticated app at `/artist` (4 tabs: Home / Music / Book / Store), plus public flows at `/p/<slug>` and `/p/<slug>/book`

Full product vision: see `docs/product/PRD.md`.

---

## Documentation rules (READ FIRST)

Skitza uses a structured docs system. If you're about to create or edit an `.md` file, follow these rules.

### 📍 Start every session here

1. **This file (CLAUDE.md)** — HOW we work (conventions, mistakes, commands). Auto-loaded.
2. **[`docs/session_recap.md`](docs/session_recap.md)** — **LIVE handoff state.** Read FIRST thing. Tells you what we just did, current branch, what's next. Updated at every checkpoint.
3. **[`docs/INDEX.md`](docs/INDEX.md)** — the master map. Where everything lives.
4. **[`docs/product/PRD.md`](docs/product/PRD.md)** — WHAT we build (product spec). 27 sections, 70+ locked decisions.

### 📂 Where new `.md` files go

| Type | Location | Example |
|---|---|---|
| Active implementation plan | `docs/plans/active/` | current sprint work |
| Shipped/merged plan | `docs/plans/archive/` | move here when PR merges |
| Design doc for a plan | Same folder as the plan | `foo-design.md` next to `foo.md` |
| Per-story detail | `docs/plans/stories/` | S01/S02/S03 files |
| Product decision log | `docs/decisions/` | Q&A behind a PRD change |
| QA review | `docs/qa/` | dated phase reviews |

### 🚫 Do NOT

- Create loose `.md` files at the repo root (PRD and CLAUDE are the only ones).
- Copy product rules from PRD.md into this file — link to the PRD section instead.
- Copy conventions from this file into PRD.md — link here instead.
- Leave shipped plans in `docs/plans/` — move them to `archive/` when their PR merges.

### 🧹 Keeping it clean

Run **`/docs-audit`** (slash command) any time to get a drift report.

---

## Session handoff protocol (READ — applies to you, Claude)

You **must** keep [`docs/session_recap.md`](docs/session_recap.md) current. It is the single file that makes context resets painless.

### Update it at these triggers

- After opening or merging a PR
- After a major product decision or tech pivot
- After a BMAD phase completes (Analyst → PM → Architect → SM → Dev → Ship)
- Before dispatching a long sequence of subagents
- When conversation feels long/dense (heuristic: 5+ tool calls this turn, or many exchanges without a save-point) — a context reset may be near
- When the user types **`/checkpoint`** (the slash command formalizes this)

### How to update

- **Overwrite, never append.** The file is a snapshot, not a log. `git log docs/session_recap.md` preserves history.
- Keep it under ~80 lines.
- Preserve the section structure (Last checkpoint / What we just finished / Current state / What's next / Context that matters / How to resume / Files to glance at / Update discipline).
- Timestamp the "Last checkpoint" line with today's date.
- Commit with `docs(recap): checkpoint — <one-line>`. Push if not on main.

### Why

Before this protocol, every context reset cost 5-10 minutes of re-discovery. With it, a fresh session reads one file and knows the state. Do not skip the checkpoints.

---

## Tech stack

Canonical list: **[`docs/product/PRD.md` §27 (Appendix: tech-stack commitments)](docs/product/PRD.md)**.

This file used to duplicate that table, which created drift risk. If a stack decision changes, update PRD §27 only.

---

## Monorepo layout (important files)

```
.
├── apps/
│   ├── web/                      # Next.js app (primary)
│   │   ├── src/
│   │   │   ├── app/              # App Router — route groups:
│   │   │   │   ├── (app)/            # Producer dashboard (authed)
│   │   │   │   ├── (artist)/         # Artist app (authed)
│   │   │   │   ├── (artist-welcome)/ # Artist welcome splash
│   │   │   │   ├── (onboarding)/     # Producer first-run wizard
│   │   │   │   ├── (public)/         # /p/<slug>, /p/<slug>/book, /m/<token>
│   │   │   │   ├── (auth)/           # Clerk sign-in / sign-up
│   │   │   │   ├── api/              # Webhook + cron routes
│   │   │   │   ├── layout.tsx        # Root layout — MUST stay lang="en" dir="ltr"
│   │   │   │   └── page.tsx          # Landing marketing page (English-only, LTR)
│   │   │   ├── components/
│   │   │   │   ├── shell/            # AppShell, Sidebar, NotificationBell, CmdPalette
│   │   │   │   ├── dashboard/        # Today, Projects, Music, Setup, Project Room
│   │   │   │   ├── artist/           # Artist app shell, bottom nav, studio switcher
│   │   │   │   ├── project/          # Reusable project pieces (payment-status-strip, modals)
│   │   │   │   ├── audio/            # WaveformPlayer, AudioUploader, PersistentPlayer
│   │   │   │   ├── landing/          # Marketing sections — NEVER use t(), English only
│   │   │   │   └── ui/               # Primitives (Button, Badge, EmptyState, Toast, Card)
│   │   │   ├── server/
│   │   │   │   ├── trpc/routers/     # Routers: producer, artist, project, booking, etc.
│   │   │   │   ├── payments/         # plan.ts (pure), checkout.ts, customer.ts
│   │   │   │   ├── artist/           # identity helpers (emailHashFor, groupStudiosForArtist)
│   │   │   │   └── email/            # Transactional templates (React Email)
│   │   │   ├── lib/
│   │   │   │   ├── projects/         # stages.ts, states.ts (single source of truth)
│   │   │   │   ├── time/             # relative.ts — formatRelativeTime, fmtDateTime
│   │   │   │   ├── magic-links/      # token.ts (JWT sign/verify)
│   │   │   │   └── keyboard/         # use-shortcuts.ts, G-leader bindings
│   │   │   ├── i18n/                 # next-intl config + app-i18n-provider.tsx
│   │   │   └── middleware.ts         # Clerk auth + legacy redirects
│   │   ├── messages/                 # en.json + he.json + ar.json (authenticated app only)
│   │   └── public/                   # sw.js, static assets
│   └── desktop/                  # Tauri 2 shell (rare touch)
├── packages/
│   └── db/
│       ├── src/schema.ts         # Drizzle schema — single source of truth
│       ├── drizzle/              # Generated SQL migrations (0000-0028)
│       │   └── meta/_journal.json  # ⚠ OUT OF SYNC past 0018 — see migrations section
│       └── drizzle.config.ts     # Reads DATABASE_URL
├── docs/
│   ├── plans/                    # Implementation plans per feature
│   ├── product/PRD.md            # Product vision + user stories
│   └── master-plan/              # Per-batch followup notes
├── .claude/                      # Project-scoped Claude config (commands, agents, settings)
├── .github/workflows/            # CI (typecheck + lint + tests + migrations)
├── vercel.json                   # Crons + Vercel-specific config (Hobby tier — max 1 cron/day)
└── CLAUDE.md                     # THIS FILE
```

---

## Commands (run from repo root unless noted)

```bash
# Install
pnpm install

# Development (from apps/web)
pnpm dev                          # Next dev server

# Verify — run BEFORE every commit, after every change
pnpm -F web typecheck             # tsc --noEmit
pnpm -F web lint                  # eslint
pnpm -F web test                  # vitest run (script is "vitest run", so no --run flag)

# All 3 at once (shell chain):
pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test

# Database (packages/db)
pnpm -F @skitza/db db:generate    # Generate new migration from schema
pnpm -F @skitza/db db:migrate     # ⚠ BROKEN — see migrations section. Use direct SQL.
pnpm -F @skitza/db db:studio      # Drizzle Studio
pnpm -F @skitza/db test           # DB integration tests (needs DATABASE_URL_TEST)

# Custom project slash commands
/skitza-verify                    # typecheck + lint + test + build in one shot
/skitza-migrate                   # Apply pending SQL migrations directly via neon client
/skitza-preview                   # Print Vercel preview URL for current branch
```

---

## Database & migrations — READ THIS

### The journal is broken

`packages/db/drizzle/meta/_journal.json` only tracks through migration **0018**.
Migrations **0019-0028** exist as `.sql` files but are NOT in the journal.
Consequence: `drizzle-kit migrate` reads the journal, sees nothing new past 0018,
and skips everything. Do NOT rely on `drizzle-kit migrate` until the journal is fixed.

**Canonical migration workflow until the journal is fixed:**

```bash
# Apply migrations directly via neon HTTP client
/skitza-migrate
# (or manually: run packages/db/apply-migrations.mjs with DATABASE_URL set)
```

The `/skitza-migrate` command reads each `drizzle/*.sql` file, strips BEGIN/COMMIT,
and executes statements directly via `sql([stmt])` tagged-template trick (neon HTTP's
only raw-SQL path). All migrations are `ADD COLUMN IF NOT EXISTS` or similar idempotent
forms, so re-running is safe.

### Mistake log — migrations

- **2026-04-20**: Dashboard crashed in production with `column "default_session_min" of relation "producers" does not exist` on preview. Migrations 0025-0028 had never applied because of the journal drift. Fix: direct SQL execution via neon client.

### When writing new migrations

1. Change `packages/db/src/schema.ts`
2. `pnpm -F @skitza/db db:generate` to produce the next numbered `drizzle/NNNN_<name>.sql` file
3. **Verify the SQL is `ADD COLUMN IF NOT EXISTS` where possible** (idempotent)
4. Use `BEGIN; ... COMMIT;` blocks so the migration is atomic
5. Sanity-check: existing rows must not break under the migration (use `NOT NULL DEFAULT` for add-only)
6. Apply via `/skitza-migrate` — do NOT touch `_journal.json` until we fix it properly

---

## Testing conventions

### Placement

- Unit tests live next to the file being tested as `foo.test.ts` or in `__tests__/foo.test.ts`
- tRPC router tests in `apps/web/src/server/trpc/routers/__tests__/`
- DB integration tests in `packages/db/src/__tests__/` (require `DATABASE_URL_TEST`)

### Mock-DB pattern (tRPC tests)

Use **marker objects** to branch by table. Example from `artist-home.test.ts`:

```ts
const projectsMarker = { __table: "projects" };
const bookingsMarker = { __table: "bookings" };

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      if (table === projectsMarker) { /* ... */ }
      if (table === bookingsMarker) { /* ... */ }
      throw new Error(`unexpected select().from(${String(table)})`);
    },
  }),
};

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  projects: projectsMarker,
  bookings: bookingsMarker,
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...args: unknown[]) => ({ and: args }),
}));
```

### Auth-scoping assertions

Walk the WHERE predicate tree with the `findPredicate` helper to assert that
queries are scoped to the caller's tenant (producerId / clerkUserId / emailHash).
Example:

```ts
const where = lastWhereArgs as unknown;
expect(findPredicate(where, producersMarker, "id", ctx.producerId)).toBe(true);
```

This catches silent regressions that drop tenant-scoping predicates.

### Common test helpers

- `emailHashFor(email)` — trim + lowercase + sha256 (used in both prod code + tests)
- `findPredicate` — walks `and()`-nested WHERE clauses

---

## tRPC conventions

### Procedure bases

- `publicProcedure` — no auth, rate-limited
- `producerProcedure` — requires Clerk session + producer row; `ctx.producerId` available
- `artistProcedure` — requires Clerk session; `ctx.userId` + `ctx.emailHash`; does NOT require a producer row

### Router file layout

```ts
export const fooRouter = router({
  list: producerProcedure.query(async ({ ctx }) => { /* ... */ }),
  create: producerProcedure.input(FooInput).mutation(async ({ ctx, input }) => { /* ... */ }),
});
```

### Input validation

Always use Zod. Nested `z.object({ ... }).strict()` for tight validation.

### Aggregation queries

When assembling a single-round-trip payload (e.g. `producer.today`, `artist.home`),
use `Promise.all` across the fan-out queries. Each leg scopes by tenant in its `WHERE`.
See `producer.ts` `today` procedure for the canonical 9-way fan-out pattern.

### Error handling

Throw `TRPCError` with specific codes:
- `UNAUTHORIZED` — not signed in
- `FORBIDDEN` — signed in but not authorized for this resource
- `NOT_FOUND` — resource doesn't exist (used for ALL auth-failed paths on magic links, to avoid enumeration)
- `CONFLICT` — uniqueness violation (e.g. slug taken)
- `TOO_MANY_REQUESTS` — rate limit

---

## UI / styling conventions

### CSS variables — no hex codes

Colors, radii, shadows all go through CSS custom properties. Examples:

```tsx
className="bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-primary))] border-[rgb(var(--border-subtle))] rounded-[var(--radius-md)]"
```

**Never** `bg-blue-500`, `text-red-600`, `#f3f4f6`. These break theming and RTL.

### Key tokens

- `--bg-base`, `--bg-elevated`, `--bg-overlay`
- `--fg-primary`, `--fg-secondary`, `--fg-muted`, `--fg-inverse`, `--fg-warning`, `--fg-danger`
- `--brand-primary`, `--brand-accent`
- `--border-subtle`, `--border-strong`
- `--radius-sm`, `--radius-md`, `--radius-lg`

Full palette lives in `apps/web/src/app/globals.css`.

### Alpha in Tailwind arbitrary values

Use the `/0.08` suffix pattern. **Do NOT nest `var()` with fallback inside `rgb()` with alpha** — the parser fails silently.

```tsx
// ✅ Works
className="bg-[rgb(var(--fg-danger)/0.08)]"

// ❌ Doesn't work — nested var() eats the `/` before alpha parses
className="bg-[rgb(var(--fg-danger,var(--brand-primary))/0.08)]"
```

### Animation primitives (CSS-only, no framer-motion)

All in `globals.css`:
- `.sk-lift` — subtle hover lift (-1px + shadow)
- `.sk-pop` / `.sk-pop-center` — dropdown/modal fade+scale-in
- `.sk-cta-shine` — diagonal shimmer on CTA hover
- `.sk-pulse-hover` — breathing glow on hover
- `.reveal-up` — fade + slide-up on mount
- `.pulse-glow` — persistent brand-colored pulse

Every primitive MUST have a `@media (prefers-reduced-motion: reduce)` gate that
neutralizes it. There's a test (`apps/web/src/app/__tests__/motion-primitives.test.ts`)
that fails CI if a new primitive skips the reduce gate.

### Responsive patterns

- **Mobile-first**. Every new layout must work at 360px before 1280px.
- **Touch targets ≥ 44×44** on mobile. Use `.sk-tap` utility.
- **iOS safe-area** respected via `.sk-safe-top`, `.sk-safe-bottom`, `.sk-safe-x`.
- **Momentum scrolling** on horizontal rails via `.sk-scroll-x`.
- **`:focus-visible`** (not `:focus`) for keyboard focus rings, so mouse clicks don't trigger them.

### ARIA patterns

- Tabs: `id="tab-<key>"` + `aria-controls="panel-<key>"` on the tab; `id="panel-<key>"` + `aria-labelledby="tab-<key>"` on the panel. Both IDs MUST match.
- Nav active: `aria-current="page"`, NOT `aria-pressed` (that's for toggles).
- Dropdowns/modals: `role="dialog"` + `aria-modal="true"` + Esc to close.

---

## i18n — scope is the authenticated app only

### Rules

1. **Landing page + public routes (`/`, `/p/<slug>`, `/sign-in`, `/sign-up`, `/m/<token>`) are ENGLISH ONLY, LTR ONLY.** No `t()` calls, no `NextIntlClientProvider`, no locale cookie effects.
2. The `<html>` element at the root layout is ALWAYS `lang="en" dir="ltr"`. Do NOT put conditional `dir` on `<html>` — it breaks hydration with next-themes + Clerk UserButton.
3. RTL applies per-route-group via `<AppI18nProvider>` which wraps authenticated app layouts only: `(app)`, `(artist)`, `(artist-welcome)`, `(onboarding)`.
4. Default locale: `en` for everyone. No IP-based auto-detection.
5. Hebrew is opt-in via the language chip in the sidebar footer (writes `NEXT_LOCALE=he` cookie).
6. Translation files: `apps/web/messages/{en,he,ar}.json`. ar is stubbed empty.

### When adding a new user-facing string inside the app

- Add the key to both `en.json` and `he.json` (Hebrew can be machine-quality for now).
- Use `useTranslations('namespace')` in client components or `getTranslations('namespace')` in server components.
- Never inline English strings that need to be translated later — they'll leak past the translation wave.

### Mistake log — i18n

- **2026-04-20**: Put i18n at root layout → `<html dir="rtl">` conflicted with next-themes + Clerk UserButton → hydration mismatch → dashboard crashed. Fix: pin root to LTR always, wrap only authenticated groups with `<AppI18nProvider>`.
- **2026-04-20**: Used IP-based locale detection → Israeli users got Hebrew by default with no way to opt out on the landing page (which was also affected). Fix: killed IP detection, default English, explicit opt-in via chip.

---

## Product decisions — where they live

All 70+ locked product decisions live in **[`docs/product/PRD.md`](docs/product/PRD.md)** (27 sections).

The Q&A journey that produced those decisions is in **[`docs/decisions/360-prd-answers.md`](docs/decisions/360-prd-answers.md)** (explains the *why* behind each PRD choice).

Hard non-goals (what NOT to build) live in **[PRD §25](docs/product/PRD.md)**.

**Rule:** if a product rule changes, update PRD.md only. Do not copy rules into this file — it creates drift. CLAUDE.md describes HOW we work (conventions, commands, mistakes); PRD.md describes WHAT we build.

---

## Commits & PRs

### Style

- Prefix: `feat(scope):`, `fix(scope):`, `refactor(scope):`, `docs(scope):`, `ci:`, `test:`
- Imperative mood: "add" not "added", "fix" not "fixed"
- Body explains WHY + what trade-offs were made
- Co-Authored-By line: `Co-Authored-By: Claude <noreply@anthropic.com>`

### Discipline

- **Verify before commit**: `pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test` must all pass.
- **Frequent small commits**. Each commit should be a logical unit that could be reverted independently.
- **NEVER `git commit --amend`** — always new commits, even for small fixes. Amending rewrites history and makes bisecting harder. The user explicitly prefers this.
- **NEVER `git push --force`** to shared branches.
- **Don't skip hooks** (no `--no-verify`, `--no-gpg-sign`).

### PR body format

```
## Summary
<1-3 bullets>

## Test plan
[Bulleted markdown checklist]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Workflow when starting a new feature — use BMAD

The canonical workflow is **BMAD** (Breakthrough Method for Agile AI-Driven Development),
adapted for Skitza's existing structure.

- **Skill:** `.claude/skills/bmad/SKILL.md`
- **User guide:** `docs/bmad-workflow.md`
- **Templates:** `.claude/skills/bmad/templates/` (brief.md, epic.md, story.md)

**3 tracks** — pick by scope:

- **Quick**: 1-file fix / copy tweak → skip straight to Dev (no brief, no PRD delta)
- **Standard**: 2-10 files → Brief → PRD delta → Architecture lite → Dev → QA
- **Large**: new surface / schema / multi-sub-tab → Brief → PRD section → standalone Architecture doc → Epic + Stories → Dev (per story, fresh subagent) → QA

**5 roles** (each with its own artifact):

1. **Analyst** — 3 questions, 1-page brief at `docs/plans/<date>-<feature>-brief.md`
2. **PM** — PRD delta in `docs/product/PRD.md`, committed as `docs(prd):` **BEFORE** any code lands
3. **Architect** — technical design in plan doc or standalone; cites `packages/db/src/schema.ts` + exact file paths; specifies `/skitza-migrate` for DB changes
4. **Scrum Master** (Large only) — self-contained story files at `docs/plans/stories/<feature>-NN-<title>.md`
5. **Dev + QA** — Dev via `.claude/agents/skitza-tdd-implementer.md`; QA via spec-compliance subagent + `.claude/agents/skitza-ux-critic.md`

**Always:**
- Read `CLAUDE.md` + `docs/product/PRD.md` before PM phase
- Fresh subagent per Dev story (prevents context rot)
- Commit PRD delta BEFORE any code
- `/skitza-verify` between stories + before push
- New commits (never `--amend`)
- Update the mistake log below when a surprise surfaces

**User magic phrases:**
- `Quick BMAD: <thing>` — trivial work, skip to Dev
- `Standard BMAD: <thing>` — default, full phase flow
- `Large BMAD: <thing>` — big scope, multiple subagent dispatches
- `BMAD me: <thing>` — Claude picks the track
- `Switch to <role>` / `Re-dispatch QA` / `Rewind to <phase>` — mid-feature interjections

See `docs/bmad-workflow.md` §Magic phrases for the full list.

---

## Running mistake log

Append here any time Claude does something wrong. Date it. Don't remove entries —
they're tribal knowledge.

- **2026-04-17**: Plan said invoice status was `{open, past_due}` but the DB enum is `{draft, sent, uncollectible, paid, refunded, void}`. The plan was fabricated; always verify enums against `packages/db/src/schema.ts`.
- **2026-04-18**: Used `--amend` to fix a commit message → lost a line in the body. User explicitly prefers NEW commits for every fix.
- **2026-04-19**: Forgot to update ARIA IDs when renaming `AudioTab` → `MusicSubTab`. The outer tab rendered `id="tab-music"` + `aria-controls="panel-music"` but MusicSubTab kept `id="panel-audio"` + `aria-labelledby="tab-audio"`. Always update ARIA IDs when renaming tabs.
- **2026-04-19**: Bloated `Project` prop interface copied from AudioTab into MusicSubTab — 19 fields when only `project.id` was read. When extracting a component, strip the prop interface to actual usage.
- **2026-04-19**: Left `.success` toast variant on informational stubs — green tint for "this isn't wired yet" is wrong affective cue. Use `info` variant for non-success confirmations.
- **2026-04-19**: `rgb(var(--fg-danger,var(--brand-primary))/0.08)` — nested var() with alpha doesn't parse in Tailwind arbitrary values. Strip the fallback, use plain `rgb(var(--fg-danger)/0.08)`.
- **2026-04-20**: Scope creep on Setup page — built cross-link cards that pointed to deleted pages. User wanted full management UI inline on every tab.
- **2026-04-20**: Misunderstood the "link" flow 3 times. User wants `skitza.app/p/<slug>` to push new visitors into artist-side sign-up, not the producer marketing page. (PRD entry pending.)
- **2026-04-20**: Put next-intl provider at root layout → crashed on Hebrew due to `<html dir>` conflict with next-themes + Clerk. Fix: pin root html to en/ltr, scope i18n to authenticated route groups only.
- **2026-04-20**: `drizzle-kit migrate` skipped 0019-0028 because `_journal.json` was stale. Production DB was missing 8 columns → dashboard crashed. Fix: direct SQL via neon client (`/skitza-migrate`).
- **2026-04-20**: `sql.query(stmt)` and `sql.unsafe(stmt)` don't exist in neon HTTP client. The ONLY way to execute raw SQL with no placeholders is the TemplateStringsArray trick: `sql(Object.assign([stmt], { raw: [stmt] }))`.

---

## Pointers

- **Design system tokens**: `apps/web/src/app/globals.css`
- **Shared auth helpers**: `apps/web/src/server/artist/identity.ts`
- **Magic-link JWT**: `apps/web/src/lib/magic-links/token.ts`
- **State machine helpers**: `apps/web/src/lib/projects/` (stages, states, isTerminalStage)
- **Time helpers**: `apps/web/src/lib/time/relative.ts` (formatRelativeTime, fmtDateTime)
- **Payment plan math**: `apps/web/src/server/payments/plan.ts` (pure + tested)
- **Email templates**: `apps/web/src/server/email/send.tsx` (React Email)

---

*Last updated: 2026-04-20 by the dev-workflow foundation pass.*
