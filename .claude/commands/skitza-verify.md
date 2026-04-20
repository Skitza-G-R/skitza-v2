---
description: Run the full Skitza verification pipeline — typecheck + lint + test across apps/web and packages/db
---

Run these commands in order. Stop + report at the first failure:

1. `cd apps/web && pnpm typecheck` (expect clean)
2. `cd apps/web && pnpm lint` (expect clean)
3. `cd apps/web && pnpm test` (expect N passed / M skipped)
4. `cd packages/db && pnpm typecheck` (expect clean)

Report the test count at the end so the baseline is visible.

If any step fails, print the last 30 lines of output + the command that failed.
