# CLAUDE.md — Skitza

## Read this first

`AGENTS.md` (repo root) is the source of truth for how to work in this repo. This file is the
Claude-side companion: it carries the same safety rules plus repo orientation. If the two
disagree, AGENTS.md wins.

- Durable product rules: `docs/product/PRD.md` (v5.2, 13 Aug 2026).
- Task scope: the current Linear issue. Visual intent: the linked Miro frame.
- Dated files in `docs/plans/` and `docs/session_recap.md` are context, not automatic truth.
  `README.md` is stale (it still claims Stripe Connect) — do not trust it.
- When sources conflict, do not silently pick one. Explain the conflict, recommend, and ask Gili.
- Gili makes the final product and engineering calls. Raz is not a required gate unless Gili
  says so for a specific task.

## What Skitza is

SaaS for solo music producers. One public link lets artists listen, sign up, book, and pay
externally, while Skitza keeps the work, agreement, payment, and delivery history in one place.

Approved workflow: store product or private offer → project and purchase → agreement and payment
plan → payment proof → active project → songs and sessions → exact-version artist approval →
full payment → download → completion or cancellation.

## Repo layout

- `apps/web/` — Next.js 15 App Router, React 19, tRPC v11, Clerk v7, Tailwind v4, Vitest.
  ~94 pages and ~24 API routes. This is the product.
- `apps/desktop/` — Tauri 2 producer desktop shell (SK-231, PRD §4.7). Mac + Windows 11 x64,
  loads the same live web origin; Rust lives in `src-tauri/`. Optional and producer-only.
  **This is current, not removed.**
- `apps/admin/` — separate Next.js founder console on port 3001, behind Cloudflare Access +
  Clerk + MFA + inactivity lock. Environment-scoped routes for users, payments, system health.
- `packages/db/` — Drizzle schema (`src/schema.ts`, ~61 tables) and 57 SQL migrations
  through `0053`.
- `docs/` — `product/PRD.md`, `design/buttons.md`, `runbooks/`, `plans/active/`,
  `architecture/adr-*.md`.

## Route surface

Do not assume a small fixed page list — read the tree under `apps/web/src/app`. Route groups:

- `(producer)/dashboard` — overview, clients-projects, music, calendar, payments, requests,
  store, profile, portfolio, settings.
- `(artist)/artist` — home, music, sessions, book, store, purchase flow, payments and proofs,
  offers, settings (incl. per-studio views).
- `(onboarding)` — producer setup wizard (its own group on purpose; nesting it under
  `(producer)` loops incomplete producers).
- `(public)` — landing, `/join/[slug]`, auth, legal, changelog. `(guest-song)` serves public
  song links (`/guest-song/[versionId]`, `/listen/[token]`). `/get-started` is a marketing ad
  funnel that posts to an external webhook (no DB write).
- `dev/*` — internal screen previews, not product surface.

## Roles and access

- Producer and artist are **additive DB memberships**, resolved from `producers` and
  `client_contacts` — not a Clerk `publicMetadata.role`. One account can hold both and switch
  at `/auth/switch`.
- `requireRole()` in `apps/web/src/server/auth/role.ts` is the single gate. Every protected
  layout calls it. Do not re-implement route guards locally.
- Producer access is **invitation-only**: Skitza grants it only after the server verifies an
  accepted Clerk application invitation. Ordinary signup, a button click, a URL/query value,
  and client-writeable metadata never grant producer.
- Artist access comes only through a valid producer join flow, and never falls back to producer.

## What is real

- Auth (Clerk v7): real, invitation-gated for producers.
- Database (Neon + Drizzle): real, migrated through `0053`.
- **Payments: real, external-only.** Producer publishes payment instructions, artist uploads a
  payment proof, producer verifies in the producer Payments workspace (Needs review / Due and
  overdue / Upcoming / History). Purchases, installments, corrections, waivers, cancellations,
  and reminders all live in the schema. There is **no** in-app card processing: Stripe and
  Tranzila were removed by SK-90, and SK-6 boundary tests keep them out. Do not re-add a
  processor.
- **Google Calendar: real two-way sync.** Producer-only OAuth, chosen write calendar plus
  privacy-safe busy reads, linked events, provider webhook, and a nightly `/api/cron/calendar-sync`.
- Audio (Cloudflare R2): real. Presigned upload, multipart for audio, private presigned
  delivery, wavesurfer.js playback, peaks, artwork.
- Email (Resend + React Email): real, 15 templates under `src/server/email/templates/`.
- Push + PWA: real. Web Push (VAPID), `src/app/manifest.ts`, `public/sw.js`, offline page,
  install invitation (SK-249).
- Analytics: Sentry + PostHog, real.
- **Mobile is real and in scope** for both producer and artist, plus the installable PWA.
  "Desktop only" is obsolete.
- i18n: next-intl in cookie-driven mode (no URL prefix), mounted only on authenticated
  surfaces. `en` and `he` are both populated with a shipped language switcher and RTL; `ar` is
  a stub. Note: PRD §18 still says "English-only v1" — flag that conflict to Gili rather than
  resolving it in code.

## Verification gate

Use `$skitza-verify` before claiming a change is verified or opening/updating a PR. Manual
equivalent: from `apps/web` run `pnpm typecheck`, `pnpm lint`, `pnpm test`; then
`pnpm typecheck` in `packages/db`. Vercel runs ESLint with `--max-warnings 0`, so warnings
break the deploy. Node `>=20.11`, pnpm `9.12.0`, Corepack.

Add focused regression tests for bugs and behavior changes; prove the test fails before the fix
when practical. Never hide a baseline failure — report the exact failing command.

## Database safety

- **Never run `pnpm -F db db:migrate` or `drizzle-kit migrate`.** The Drizzle journal stops
  tracking around `0018` while the SQL set runs to `0053`, so drizzle-kit silently skips
  migrations.
- Use `$skitza-migrate`, which runs `packages/db/apply-migrations.mjs` against an explicitly
  confirmed target environment. If the target is unclear, stop and ask.
- The canonical live Neon project is `skitza-v3`. The project labeled `OLD — DO NOT USE.` is
  frozen: no writes, no repointing production to it, no merge or backfill from it. See
  `docs/runbooks/canonical-database-gate.md`.
- Never print database URLs, credentials, raw Neon project/branch/endpoint identifiers, or
  storage object keys.
- Never migrate, reset, promote, or repoint production without Gili's explicit approval for
  that exact run.

## Code patterns

- Server data: tRPC server-side caller in `page.tsx`. Client mutations: tRPC `useMutation`
  (or a thin server action wrapper where there is no tRPC provider).
- **Scope every producer query by `ctx.producerId`.** `producerProcedure`
  (`apps/web/src/server/trpc/producer-procedure.ts`) resolves it once per caller;
  `artistProcedure` handles artist reads. Preserve the producer/artist isolation.
- New business rules belong in a focused service under `apps/web/src/server/domain/<area>/`
  with focused tests. Routers, server actions, cron routes, and components stay limited to
  auth, validation, authorization, orchestration, and response mapping.
- Uploads: presigned R2 URL, direct browser PUT, multipart for audio.
- Email: `apps/web/src/server/email/send.tsx` dispatcher → Resend.
- Schema: `packages/db/src/schema.ts` is the single source of truth.

## UI rules

- Color tokens are **bare RGB triplets**. Always write `rgb(var(--token))`, never bare
  `var(--token)`.
- `docs/design/buttons.md` is locked. Radius scales with element height: `--radius-sm` 8px
  (<36px), `--radius-md` 12px (36–44px), `--radius-lg` 16px (≥44px). `rounded-full` is reserved
  for square elements — avatars, dots, play buttons, icon-only controls. Never on a text
  rectangle.
- No Framer Motion and no new animation library. Prefer existing CSS motion primitives and gate
  new motion behind `prefers-reduced-motion: reduce`.
- For mobile work verify true 390px and 360px, then check desktop separately. Do not judge phone
  layout from a browser window clamped below 500px.

## Branch, issue, and PR workflow

- `v3-clean` is the development base and PR target. **Never commit to `main`** — it is dead and
  stopped receiving work long ago.
- Every change under `apps/`, `packages/`, or the schema needs an issue in Linear project
  `Skitza v3`, team `Skitza` (`SK`). Read the full issue, move it to `In Progress`, and use
  Linear's exact generated branch name (do not invent or shorten it).
- Conventional commit messages (`feat(scope): …`, `fix(scope): …`, `test(scope): …`,
  `docs(scope): …`). PR titles start with the issue ID: `SK-N: short imperative description`.
- Always ask Gili before merging. Never promote a deployment or point `skitza.app` at a new
  deployment without Gili's explicit approval for that deployment.

## Stay in scope

- Build only what the issue asks. No unrequested features, no opportunistic refactors, no
  planning ceremonies.
- Do not re-add BMAD, Documenso/PDF signing, magic-link share tokens, `/share/[token]`, the
  waitlist table, the old `/dashboard/booking` shell, or in-app card processing, unless Gili
  explicitly changes the product decision.
- Tauri is the exception to that list — the desktop app came back deliberately as `apps/desktop`.
