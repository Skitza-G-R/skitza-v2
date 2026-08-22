# Skitza repository guidance

## Product and communication

- Skitza is a SaaS product for solo music producers. One public link lets artists listen, sign up, book, and pay.
- Speak to Gili in simple, easy-to-understand English. Lead with the result and explain technical details only when they help a decision.
- Gili currently makes the final product and engineering decisions. Work directly from her instructions and the Linear backlog; Raz is not a required gate unless Gili says so for a specific task.

## Strict scope and initiative rule

- This is a hard rule: do exactly what Gili asks and nothing more.
- Unless Gili explicitly asks for suggestions, alternatives, improvements, or proactive work, do not provide them.
- Do not suggest additional features, optional enhancements, follow-up tasks, or unrelated next steps.
- Do not refactor, clean up, rename, reorganize, or change code outside the requested scope.
- Raise something unrequested only when it is essential to complete the task safely or correctly, or when it reveals a serious security, data-loss, production, or requirements conflict. Keep that warning brief and directly relevant.
- Do not broaden the task through assumptions. If a missing decision materially blocks the requested work, ask only the minimum necessary question.
- Prefer the shortest path to the requested result. Avoid exploratory detours, repeated explanations, and token-heavy commentary unless Gili asks for detail.

## Sources and decisions

- Use the current code to understand actual behavior.
- Use the current Linear issue for task scope and acceptance criteria.
- Use the linked Miro board or frame for visual and flow intent.
- Use `docs/product/PRD.md` for durable product rules. Treat dated plans and `docs/session_recap.md` as context, not automatic truth.
- When sources disagree, do not silently choose one. Explain the conflict, give a recommendation based on the evidence, and ask Gili for the final word before implementing the disputed behavior.
- Gili's latest explicit decision wins. Record durable decisions in the relevant Linear issue or documentation.

## Issue, branch, and PR workflow

- Use `v3-clean` as the development base and PR target. Never commit to `main`.
- Every change under `apps/`, `packages/`, or database schema must have an issue in Linear project `Skitza v3`, team `Skitza` (`SK`). Significant harness or workflow changes should also have an issue.
- Before coding, read the full issue, move it to `In Progress`, and use Linear's exact generated branch name.
- Keep work limited to the issue. Do not add unrequested features or opportunistic refactors.
- Use conventional commit messages such as `feat(scope): ...`, `fix(scope): ...`, `test(scope): ...`, or `docs(scope): ...`.
- Start PR titles with the issue ID: `SK-N: short imperative description`.
- Codex may create or update Linear issues, branches, commits, PRs, and PR comments as part of normal work. Always ask Gili before merging.
- Never promote a deployment or point `skitza.app` at a new deployment without Gili's explicit approval for that deployment.

## Build and verification

- Use Node `>=20.11`, pnpm `9.12.0`, and Corepack.
- Before claiming a change is verified or opening/updating a PR, use `$skitza-verify`.
- For implementation work, continue through browser-based visual verification. At handoff, state clearly whether the change is visually verified and ask Gili whether to promote it to production.
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

- The canonical live Neon project is `skitza-v3`. The project labeled `OLD — DO NOT USE.` is frozen: do not write to it, repoint production to it, or merge/backfill data from it. The confirmed SK-80 boundary and reset gate are recorded in `docs/runbooks/canonical-database-gate.md`.
- The Drizzle journal and live migration ledgers are not aligned with the SQL migration set. Do not run `drizzle-kit migrate` or `pnpm -F db db:migrate`.
- Use `$skitza-migrate`, which runs `packages/db/apply-migrations.mjs` and requires an explicit target environment.
- Never print database URLs, credentials, raw Neon project/branch/endpoint identifiers, or storage object keys. Never migrate production without Gili's explicit approval for that exact run.

## Removed systems

- Do not re-add Tauri, BMAD, Documenso/PDF signing, magic-link share tokens, `/share/[token]`, the waitlist table, or the old dashboard booking route shell unless Gili explicitly changes the product decision.
- Keep `CLAUDE.md` and `.claude/` temporarily for rollback compatibility. `AGENTS.md` is the Codex source of truth.
