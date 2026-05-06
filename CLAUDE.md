# CLAUDE.md — Skitza

## What Skitza is
SaaS for solo music producers. One link → artists listen, sign up, book, pay.
PRD: docs/product/PRD.md (read this for all product decisions — v4, April 2026)

## Producer platform — 6 pages
- /dashboard — Overview (3 urgent projects, recent uploads, KPI block, the link)
- /dashboard/profile — Storefront (store products + portfolio)
- /dashboard/calendar — Calendar (availability settings + sessions management)
- /dashboard/clients-projects — Clients & Projects (tab nav: clients accordion / projects list)
- /dashboard/music — Music library (3-level: library → project → song page)
- /dashboard/settings — Settings (account identity + integrations — minimal)

## Artist platform — 5 sections
- /artist — Dashboard (upcoming sessions, recent uploads, balances)
- /artist/music — Music library + song detail (desktop waveform / mobile Spotify-style)
- /artist/book — Book sessions
- /artist/store — Storefront browse
- /artist/settings — Artist settings

## Public routes
- / — Landing page (warm aesthetic, Outfit + Syne fonts, CSS-only animations)
- /join/[slug] — Producer public profile (the conversion funnel)
- /sign-in, /sign-up — Auth (Clerk)
- /privacy, /terms, /about — Legal

## v1 scope — real vs placeholder
- Auth (Clerk): real
- Database (Neon + Drizzle): real — fresh skitza-v3 project, schema not yet migrated (Phase 2)
- Audio uploads (Cloudflare R2): real
- Email (Resend + React Email): real — 8 templates exist, not all wired yet
- Analytics (Sentry + PostHog): real
- Payments (Stripe Connect): UI placeholder — "Connect payment provider (coming soon)"
- Bookings: create project with invoice.status='pending', producer marks paid manually
- GCal sync: UI placeholder — "Connect Google Calendar (coming soon)"
- Green Invoice: UI placeholder — "Coming soon (IL only)"
- Language: English only — next-intl wired, only en.json populated
- Desktop only for producer. Artist song page has dedicated mobile UI.

## Tech stack
Next.js 15 App Router, tRPC v11, Drizzle + Neon, Clerk v7,
Cloudflare R2, wavesurfer.js, Resend + React Email,
Tailwind v4 + shadcn/ui, Vitest, Sentry, PostHog

## What was removed (Phase 1 demolition — do not re-add)
- Tauri desktop app (D1+D2) — deleted, not coming back in v1
- BMAD enforcement (D3) — deleted
- Desktop CI workflows (D4) — deleted
- PDF signing + Documenso (D5+D6) — deleted, replaced by inline checkbox agreement
- Magic links / per-recipient share tokens (D7) — deleted, /join/[slug] is the only share URL
- Waitlist table (D8) — deleted
- /dashboard/booking route shell (D9) — deleted, components stay for Calendar page
- /share/[token] routes (D10) — deleted
- Stale plan archives (D11) — deleted

## How to work here
1. Read the task brief Raz wrote.
2. Build only what's in the brief. Do not add unrequested features.
3. Run pnpm typecheck and pnpm test before finishing.
4. No planning ceremonies. No stories. No epics. Just code.

## Auth + role guard
Two roles: producer and artist. Set in Clerk publicMetadata.role on signup via webhook.
Entry point determines role: /join/[slug] signup = artist. Direct signup = producer.
Every protected layout calls requireRole('producer'|'artist').
Producer cannot reach /artist/*. Artist cannot reach /dashboard/*.

## Key code patterns
- Server data fetching: tRPC server-side caller in page.tsx
- Client mutations: tRPC via useMutation in client components
- File uploads: presigned R2 URL, direct browser PUT, multipart for audio
- Emails: apps/web/src/server/email/send.tsx dispatcher → Resend
- DB schema: packages/db/src/schema.ts (single source of truth)
- Migrations: packages/db/drizzle/ (run via pnpm -F db db:migrate)

## Phase context
Phase 1 (demolition): COMPLETE — D1 through D12.
Phase 2 (foundation): Raz handles — schema reset, routing consolidation, auth hardening.
Phase 3 (features): Gili builds — one task brief at a time from Raz.

After D12: Gili waits. Raz starts Phase 2.

## Hard rules during the build
- Phase 2: Raz handles routing, schema, auth. Do not touch.
- Phase 3: one task brief at a time. Files outside the brief are off-limits.
- No new features without a brief from Raz.
- No refactoring 'while you're there'.
- No commits to main. All work on v3-clean.
- No BMAD. No stories. No epics. Claude Code is a builder, not a project manager.
