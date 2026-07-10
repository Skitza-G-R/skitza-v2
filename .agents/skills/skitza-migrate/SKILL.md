---
name: skitza-migrate
description: Inspect and safely apply Skitza's existing SQL migrations with the repository migration runner. Use when the user asks to migrate a Skitza database, check pending schema work, apply migration files, or diagnose a migration failure. Never use for an unapproved production run.
---

# Migrate Skitza

Use `packages/db/apply-migrations.mjs`. Never use `drizzle-kit migrate` or `pnpm -F db db:migrate`; the Drizzle journal is out of sync with migrations 0019+.

1. Inspect the migration files and the current diff. List the SQL files relevant to the requested change.
2. Identify the target as local, test, preview, or production without printing any credential or connection string.
3. If the target is unclear, stop and ask Gili. If it is production, state that production is Neon project `skitza` (`quiet-sun-92221754`) and get Gili's explicit approval for this exact run.
4. Confirm that one supported environment variable is available: `DATABASE_URL`, `DATABASE_URL_NEON`, `POSTGRES_URL_NON_POOLING`, or `POSTGRES_URL`. Check only whether it is set; never print its value.
5. From `packages/db/`, run `node apply-migrations.mjs` with the approved environment already configured.
6. Report each migration file the runner processed. Treat any nonzero exit as a failure and show the relevant error without leaking secrets.
7. Run `corepack pnpm --filter @skitza/db typecheck`.
8. Run `corepack pnpm --filter @skitza/db test`.
9. Report the target environment, migration result, and verification result. Do not claim success if any step failed.

The runner is designed to be idempotent, but that does not replace target confirmation or production approval.
