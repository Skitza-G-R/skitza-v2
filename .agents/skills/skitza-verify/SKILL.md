---
name: skitza-verify
description: Run Skitza's complete local quality gate. Use before claiming work is verified, before pushing or opening a PR, or when the user asks to test, verify, check CI readiness, or diagnose a gate failure.
---

# Verify Skitza

Run the repository's CI-equivalent checks from the repository root. Keep the steps sequential so the first failure is clear.

1. Confirm the working directory contains the root `package.json` with `name: skitza`.
2. If dependencies are missing, run `corepack pnpm install --frozen-lockfile`.
3. Run `corepack pnpm typecheck`.
4. Run `corepack pnpm lint`.
5. Run `corepack pnpm test`.
6. Run `corepack pnpm --filter web build`.
7. Stop at the first failure. Report the command, exit status, and the relevant final output. Do not call the branch verified.
8. On success, report all four checks, the test count when Vitest prints one, and any warnings that could affect deployment.

Do not change application code merely to make an unexplained baseline failure disappear. Diagnose whether the failure comes from the current change, missing local configuration, or the base branch, and state the evidence.
