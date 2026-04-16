# Skitza

The all-in-one studio business platform for independent music producers.

See [`docs/plans/2026-04-16-skitza-design.md`](docs/plans/2026-04-16-skitza-design.md) for the design and [`docs/plans/2026-04-16-skitza-phase-1-weeks-1-2.md`](docs/plans/2026-04-16-skitza-phase-1-weeks-1-2.md) for the active implementation plan.

## Quickstart

```bash
pnpm install
cp apps/web/.env.local.example apps/web/.env.local  # fill in secrets
pnpm dev               # web on http://localhost:3000
pnpm tauri:dev         # desktop shell loading the web app
```
