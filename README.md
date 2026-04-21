# Skitza

**The one app a solo music producer opens in the morning.**

Skitza replaces the Calendly + Samply + Notion + DocuSign + Stripe + WhatsApp stack with a single product. One permanent link in your Instagram bio → artists click, listen, sign up, and book — with zero manual client entry on the producer's end. Contracts, invoices, project tracking, deliverables all materialize automatically from that first booking.

## Where to start

| If you are… | Read this |
|---|---|
| **A human picking this project up** | [`docs/INDEX.md`](docs/INDEX.md) — master map of all documentation |
| **Claude starting a fresh session** | [`CLAUDE.md`](CLAUDE.md) + [`docs/INDEX.md`](docs/INDEX.md) — auto-loaded anchors |
| **Trying to understand the product** | [`docs/product/PRD.md`](docs/product/PRD.md) — 27-section spec with 70+ locked decisions |
| **Wondering why the PRD says what it says** | [`docs/decisions/360-prd-answers.md`](docs/decisions/360-prd-answers.md) — Q&A reasoning trace |
| **Working on an active feature** | [`docs/plans/active/`](docs/plans/active/) |
| **Researching historical context** | [`docs/plans/archive/`](docs/plans/archive/) |

## Quickstart

```bash
pnpm install
cp apps/web/.env.local.example apps/web/.env.local  # fill in secrets
pnpm dev               # web on http://localhost:3000
pnpm tauri:dev         # desktop shell loading the web app
```

## Project structure

Monorepo via pnpm workspaces:

- `apps/web/` — Next.js 15 App Router (producer dashboard + artist app + public `/join/<slug>`)
- `apps/desktop/` — Tauri 2 desktop shell
- `packages/db/` — Drizzle schema + SQL migrations
- `docs/` — all project documentation (see [`docs/INDEX.md`](docs/INDEX.md))

## Tech stack

Next.js 15 · TypeScript · tRPC v11 · Drizzle ORM + Neon Postgres · Clerk v7 · Stripe Connect Express · Cloudflare R2 · wavesurfer.js · Tailwind v4 · Vitest · Tauri 2.

Full stack commitments in [PRD §27](docs/product/PRD.md).

## Status

Pre-launch. Target: soft launch in late April / early May 2026 with first 5 producers.

See [`docs/INDEX.md`](docs/INDEX.md) for current active work.
