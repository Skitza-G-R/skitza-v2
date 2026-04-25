# Story 03 — Step 1: Studio name + completeStudio server action

> Skitza-BMAD · Story 03 of 10
> Architecture: `docs/plans/active/2026-04-25-onboarding-rebuild-architecture.md` §4.2, §6
> **Depends on:** Stories 01 (helpers) + 02 (shell)

---

## As a freshly-signed-up producer...

I want to enter only my studio name to "get in", with currency / timezone / slug all handled invisibly behind the scenes.

## Acceptance criteria

- [ ] `/onboarding/studio` renders the shell (Story 02) at currentStep=1, title "Name your studio.", with one input "Display name".
- [ ] Continue is disabled until input length ≥ 1 char (after trim).
- [ ] On submit: server action upserts the producer row with displayName + server-derived slug + server-derived currency + browser-supplied timezone.
- [ ] Slug is auto-generated from displayName + 4-char random hash via `slugFromDisplayName` (Story 01). Slug is NEVER shown in UI.
- [ ] Currency comes from `headers().get("x-vercel-ip-country")` → `currencyFromCountry` (Story 01). USD fallback if header absent (local dev).
- [ ] Timezone comes from a hidden form field set client-side via `Intl.DateTimeFormat().resolvedOptions().timeZone`, defaults to `"UTC"`.
- [ ] On unique-slug conflict: action retries up to 3 times with fresh hash. After 3, throws friendly Error: `"could not allocate slug — please try a slightly different studio name"`.
- [ ] Existing artist-rejection guard preserved (artists who craft a raw POST to this action get `Error("forbidden: ...")`).
- [ ] On success → `router.push("/onboarding/service")`.
- [ ] Telemetry: `producer.onboarding.step_completed` fired with `{ step: "studio" }` (use existing analytics helper or stub if none — flag in report).
- [ ] All existing tests pass (especially `decide-redirect.test.ts` and `actions.test.ts`).

## Technical context

### Files to touch

**Create:**
- `apps/web/src/app/(onboarding)/onboarding/studio/page.tsx` — Step 1 UI.
- `apps/web/src/app/(onboarding)/onboarding/studio/__tests__/page.test.tsx` — RTL test for input + Continue gating.

**Modify:**
- `apps/web/src/app/(onboarding)/onboarding/actions.ts` — replace `completeOnboarding` with `completeStudio` (new shape, currency/timezone derivation, slug-retry loop). Preserve role guard.
- `apps/web/src/app/(onboarding)/onboarding/__tests__/actions.test.ts` — extend with: slug-from-displayName behavior, currency-from-headers behavior (mock `next/headers`), retry-on-conflict.
- `apps/web/src/app/(onboarding)/onboarding/page.tsx` — replace single-screen body with `redirect("/onboarding/studio")` from `next/navigation`.

### Server action contract

```ts
// actions.ts
import { headers } from "next/headers";

export async function completeStudio(input: {
  displayName: string;
  timezone: string;
}): Promise<void>
```

Implementation outline:
1. `auth()` for userId; throw `"unauthorized"` if missing
2. Read `DATABASE_URL`, `fetchUserRole({dbUrl, userId})`, reject if `role.kind === "artist"` (matches existing pattern at `actions.ts:29-34`)
3. `parsed = z.object({displayName: z.string().trim().min(1).max(80), timezone: z.string().min(1).max(64)}).parse(input)`
4. `country = (await headers()).get("x-vercel-ip-country")`
5. `currency = currencyFromCountry(country)`
6. Loop up to 3 attempts:
   - `hash = crypto.randomBytes(2).toString("hex")` (Node `node:crypto`)
   - `slug = slugFromDisplayName(parsed.displayName, hash)`
   - try INSERT … ON CONFLICT (clerk_user_id) DO UPDATE … RETURNING id
   - if catch matches `/duplicate key value/.test(err.message) && /slug/.test(err.message)`: retry
   - else: rethrow
7. After 3 attempts exhausted: `throw new Error("could not allocate slug — please try a slightly different studio name")`
8. (Telemetry) — emit step_completed event

### Test strategy

`actions.test.ts` adds:
- mock `next/headers`'s `headers` to return a stub Headers-like with `.get("x-vercel-ip-country") === "GB"`, assert `default_currency = "GBP"` in the upsert
- mock `crypto.randomBytes` (or use a seeded predictable hash) to assert slug shape
- mock the DB to throw a "duplicate key value violates unique constraint slug" on first call, succeed on second; assert second call's slug differs
- mock 3 consecutive conflicts → assert friendly error thrown

`studio/page.test.tsx`: render the page, type into input, assert Continue enabled, click → assert action invoked with right shape (mock the action import).

### Conventions (CLAUDE.md)

- Server actions: `"use server"` directive at top of file
- Mock-DB pattern: marker objects + `findPredicate` if asserting WHERE clause shape
- Auth scoping: action reads userId from Clerk session, NEVER from input
- Friendly error strings — the user sees these

## TDD steps

Standard RED → implement → GREEN → /skitza-verify pipeline.

Total new tests: ~4 in `actions.test.ts` extension + ~3 in `studio/__tests__/page.test.tsx` = ~7 new.

## Commit

```bash
git commit -m "$(cat <<'EOF'
feat(onboarding): step 1 — studio name + auto-derived slug/currency

Replaces single-screen wizard with /onboarding/studio (Step 1 of 4).
Producer types display name; server derives:
  • slug from displayName + 4-char hash (Story 01 helper, retried up
    to 3 times on unique-conflict)
  • default_currency from x-vercel-ip-country header (USD fallback)
  • timezone from a hidden field (browser Intl, UTC fallback)

Slug + currency NEVER shown in UI — fully invisible to producer.
Submitting Step 1 alone fires DB-completeness, so Steps 2-4 are safely
skippable from the system's perspective.

Existing artist-rejection guard preserved — artists who craft a raw
POST still get a forbidden error.

Telemetry: fires producer.onboarding.step_completed with {step: "studio"}.

Story 03 of 10 — `feat/onboarding-rebuild`.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## QA review checklist

### Spec compliance

- [ ] Slug truly invisible — grep the page.tsx for any rendering of slug
- [ ] Server-side currency derivation works (test with mocked `headers()`)
- [ ] Retry loop tested — 1-conflict succeeds; 3-conflict fails friendly
- [ ] Existing artist-rejection guard preserved (re-run existing actions.test.ts)
- [ ] decide-redirect.test.ts still passes unchanged

### Code quality

- [ ] No `console.log` left behind
- [ ] Friendly error strings
- [ ] Action imports `headers` from `"next/headers"` (App Router pattern)
- [ ] Hash generation uses `node:crypto` (avoid `Math.random` for cryptographic feel-good)
