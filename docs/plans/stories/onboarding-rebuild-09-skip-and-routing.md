# Story 09 — Skip behavior, routing edge cases, drop-off tests

> Skitza-BMAD · Story 09 of 10
> Architecture: §7, §8
> **Depends on:** Stories 03-08 all landed

---

## As a producer who won't finish all 4 steps in one sitting...

I want to be able to skip any step (after Step 1) without breaking my account, and on return I should land on the dashboard rather than being trapped in the wizard.

## Acceptance criteria

- [ ] After Story 03 lands, a producer who completes Step 1 and closes the tab → next visit to ANY URL (`/`, `/dashboard`, `/onboarding`) routes to `/dashboard`. Pinned by a unit test on `decide-redirect`.
- [ ] A producer who is producer-incomplete (rare orphan-by-Clerk-webhook-race) hitting `/onboarding/service` directly → redirected to `/onboarding/studio`.
- [ ] A producer who hits `/onboarding` with no step suffix → redirected to `/onboarding/studio` (preserves the "always start at the top" rule).
- [ ] Skip-for-now from each step uses the correct next-step routing (verified by a single small `nextStepFor(currentStep)` pure function + tests).
- [ ] On Step 4 Skip → `/dashboard`.
- [ ] On Step 4 Continue → `/dashboard` (same destination, different telemetry).
- [ ] Existing `decide-redirect.test.ts` cases all still pass (backward compat maintained by default arg in Story 04).
- [ ] Existing `actions.test.ts` cases all still pass.

## Technical context

### Files to touch

**Create:**
- `apps/web/src/app/(onboarding)/onboarding/lib/next-step-for.ts` (or as a small helper inside `decide-redirect.ts`).
- `apps/web/src/app/(onboarding)/onboarding/lib/next-step-for.test.ts`.

**Modify:**
- Add tests to `apps/web/src/app/(onboarding)/onboarding/__tests__/decide-redirect.test.ts` covering all step combinations × all role kinds.
- Confirm the redirect at `/onboarding/page.tsx` (set up in Story 03) sends to `/onboarding/studio`.

### Pure helper

```ts
export type OnboardingStep = "studio" | "service" | "availability" | "portfolio";

export function nextStepFor(current: OnboardingStep): "/dashboard" | `/onboarding/${OnboardingStep}` {
  switch (current) {
    case "studio": return "/onboarding/service";
    case "service": return "/onboarding/availability";
    case "availability": return "/onboarding/portfolio";
    case "portfolio": return "/dashboard";
  }
}
```

Tests are 4 lines.

### Decide-redirect test matrix expansion

| role.kind | currentStep | expected |
|---|---|---|
| unauth | studio | /sign-in |
| unauth | service | /sign-in |
| artist | studio | /artist |
| artist | service | /artist |
| artist | availability | /artist |
| artist | portfolio | /artist |
| producer-incomplete | studio | null (render) |
| producer-incomplete | service | /onboarding/studio |
| producer-incomplete | availability | /onboarding/studio |
| producer-incomplete | portfolio | /onboarding/studio |
| producer-complete | studio | /dashboard |
| producer-complete | service | null (render) |
| producer-complete | availability | null (render) |
| producer-complete | portfolio | null (render) |
| orphan | studio | null (render) |
| orphan | service | /onboarding/studio |
| orphan | availability | /onboarding/studio |
| orphan | portfolio | /onboarding/studio |

= 18 cases. Add as `.each` parameterized tests for clarity.

### Conventions

- Pure functions, no I/O
- Test naming: `decideOnboardingRedirect <role> at <step> → <expected>`

## TDD steps

Standard. New tests: 18 in decide-redirect + 4 in next-step-for = 22.

## Commit

```bash
git commit -m "$(cat <<'EOF'
feat(onboarding): step-aware routing + skip/drop-off coverage

Locks the routing matrix for the 4-step wizard:
  • producer-incomplete hitting any non-studio step → /onboarding/studio
  • producer-complete on /onboarding/studio → /dashboard (no loop)
  • producer-complete on Steps 2-4 → render (mid-flow)
  • Step 4 Continue/Skip → /dashboard
  • All other matrix cells covered

Adds a pure nextStepFor() helper so step pages don't hard-code routes.
18 parameterized decide-redirect cases pin the policy; 4 next-step-for
cases pin the forward routing.

Story 09 of 10 — `feat/onboarding-rebuild`.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## QA review checklist

### Spec compliance

- [ ] All 18 decide-redirect cases enumerated and passing
- [ ] All 4 next-step-for cases passing
- [ ] No regression in existing decide-redirect tests
- [ ] No regression in existing actions tests

### Code quality

- [ ] Pure functions, no I/O
- [ ] OnboardingStep type exported for reuse across step pages
- [ ] No magic strings — all routes from a single source
