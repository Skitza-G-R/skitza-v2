# Skitza repository guidance

## Product and communication

- Skitza is a SaaS product for solo music producers. One public link lets artists listen, sign up, book, and pay.
- Speak to Gili in simple, easy-to-understand English. Lead with the result and explain technical details only when they help a decision.
- Gili currently makes the final product and engineering decisions. Work directly from her instructions and the Linear backlog; Raz is not a required gate unless Gili says so for a specific task.

## Sources and decisions

- Use the current code to understand actual behavior.
- Use the current Linear issue for task scope and acceptance criteria.
- Use the linked Miro board or frame for visual and flow intent.
- Use `docs/product/PRD.md` for durable product rules. Treat dated plans and `docs/session_recap.md` as context, not automatic truth.
- When sources disagree, do not silently choose one. Explain the conflict, give a recommendation based on the evidence, and ask Gili for the final word before implementing the disputed behavior.
- Gili's latest explicit decision wins. Record durable decisions in the relevant Linear issue or documentation.

## Issue, branch, and PR workflow

- Treat `v3-clean` as Skitza's canonical active branch — it is the product's effective main branch. Use it as the development base and PR target.
- The Git branch named `main` is legacy history. Never commit to it, target it with feature or release PRs, merge `v3-clean` into it, or use it for production releases unless Gili explicitly approves a future branch-consolidation plan.
- Release to production by promoting a verified Vercel deployment built from `v3-clean`; a production release does not require a merge to the legacy `main` branch.
- Every change under `apps/`, `packages/`, or database schema must have an issue in Linear project `Skitza v3`, team `Skitza` (`SK`). Significant harness or workflow changes should also have an issue.
- Before coding, read the full issue, move it to `In Progress`, and use Linear's exact generated branch name.
- Keep work limited to the issue. Do not add unrequested features or opportunistic refactors.
- Use conventional commit messages such as `feat(scope): ...`, `fix(scope): ...`, `test(scope): ...`, or `docs(scope): ...`.
- Start PR titles with the issue ID: `SK-N: short imperative description`.
- Codex may create or update Linear issues, branches, commits, PRs, and PR comments as part of normal work. Always ask Gili before merging.
- Never promote a deployment or point `skitza.app` at a new deployment without Gili's explicit approval for that exact deployment.

## Build and verification

- Use Node `>=20.11`, pnpm `9.12.0`, and Corepack.
- Before claiming a change is verified or opening/updating a PR, use `$skitza-verify`.
- Add focused regression tests for bugs and behavior changes. Prove the test fails before the fix when practical.
- Do not hide or ignore baseline failures. Report the exact failing command and enough output to diagnose it.

## Architecture and code patterns

- `apps/web/`: Next.js 15 App Router, React 19, tRPC, Clerk, Tailwind v4, and Vitest.
- `packages/db/`: Drizzle schema and SQL migrations. `packages/db/src/schema.ts` is the schema source of truth.
- `docs/product/PRD.md`: durable product decisions. `docs/plans/active/`: task-specific design and implementation context.
- Fetch server data with a tRPC server-side caller in `page.tsx`; use tRPC mutations in client components.
- Scope every producer query by `ctx.producerId` and preserve the producer/artist route guards.
- Upload files through presigned Cloudflare R2 URLs. Send email through `apps/web/src/server/email/send.tsx`.

## UI rules

- Follow `docs/design/buttons.md`. Text rectangles use `rounded-[var(--radius-lg)]`; reserve `rounded-full` for avatars, dots, play buttons, and icon-only controls.
- Color tokens are RGB triplets: use `rgb(var(--token))`, not bare `var(--token)`.
- Prefer existing CSS motion primitives; do not add Framer Motion. Gate new animation with `prefers-reduced-motion: reduce`.
- For mobile work, verify true 390px and 360px layouts and check desktop behavior separately. Do not judge phone layout from a browser window that clamps below 500px.

## Database safety

- The production Neon project is `skitza` (`quiet-sun-92221754`). The old `skitza-v3` project is stale and is not production.
- The Drizzle journal is out of sync with migrations 0019+. Do not run `drizzle-kit migrate` or `pnpm -F db db:migrate`.
- Use `$skitza-migrate`, which runs `packages/db/apply-migrations.mjs` and requires an explicit target environment.
- Never print database URLs or credentials. Never migrate production without Gili's explicit approval for that exact run.

## Removed systems

- Do not re-add Tauri, BMAD, Documenso/PDF signing, magic-link share tokens, `/share/[token]`, the waitlist table, or the old dashboard booking route shell unless Gili explicitly changes the product decision.
- Keep `CLAUDE.md` and `.claude/` temporarily for rollback compatibility. `AGENTS.md` is the Codex source of truth.
