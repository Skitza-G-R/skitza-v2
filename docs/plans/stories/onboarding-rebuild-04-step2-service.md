# Story 04 — Step 2: First service (reuses NewPackageForm)

> Skitza-BMAD · Story 04 of 10
> Architecture: §4.3, §5
> **Depends on:** Stories 02 (shell) + 03 (Step 1)

---

## As a producer at Step 2 of onboarding...

I want to fill out the same service form I'd use later in Setup — with all options available — and have it persisted as my first product.

## Acceptance criteria

- [ ] `/onboarding/service` renders shell (currentStep=2, title "Add your first service.").
- [ ] Renders `<NewPackageForm onClose={advanceToStep3} />` from `~/app/(app)/dashboard/booking/package-form`.
  - No `initialValues` (pure CREATE mode)
  - No `fromTemplate` flag
  - `onClose` advances to `/onboarding/availability`
- [ ] Default values shown in the form: name "" / description "" / duration 60 / sessionCount 1 / price 150 / currency from `producers.default_currency` (read server-side) / depositPct 25 / kind=session / locationType=studio (existing form defaults at `package-form.tsx:104-134`).
- [ ] "Skip for now" ghost link in the action bar advances to `/onboarding/availability` without calling `createPackage`.
- [ ] Telemetry: `step_completed` (on form save) or `step_skipped` (on Skip), both with `{ step: "service" }`.
- [ ] If producer is producer-complete (Step 1 done) and visits `/onboarding/service` directly: rendered, NOT redirected (Step 2 must remain reachable post-Step-1 to allow flow completion in the same session).
- [ ] If producer is producer-incomplete (didn't do Step 1): redirect to `/onboarding/studio`.
- [ ] If producer is artist or unauth: existing layout gate redirects (no change).

## Technical context

### Files to touch

**Create:**
- `apps/web/src/app/(onboarding)/onboarding/service/page.tsx` — Step 2 page.
- `apps/web/src/app/(onboarding)/onboarding/service/__tests__/page.test.tsx` — RTL test that asserts NewPackageForm is rendered and Skip routes correctly.

**Modify:**
- `apps/web/src/app/(onboarding)/onboarding/decide-redirect.ts` — extend signature to accept `currentStep: "studio" | "service" | "availability" | "portfolio"` and return appropriate redirect for incomplete-but-past-Step-1 producers vs. raw-incomplete (no Step 1 yet). See pure-function-test approach in §7 of arch doc.
- `apps/web/src/app/(onboarding)/onboarding/__tests__/decide-redirect.test.ts` — extend with new step-aware test cases.

### decide-redirect change shape

```ts
export type OnboardingStep = "studio" | "service" | "availability" | "portfolio";

export function decideOnboardingRedirect(
  role: UserRole,
  currentStep: OnboardingStep = "studio",  // default = today's behavior
): OnboardingRedirect
```

Rules:
- unauth → `/sign-in` (unchanged)
- artist → `/artist` (unchanged)
- producer-complete:
  - if `currentStep === "studio"` → `/dashboard` (unchanged — they'd be looping)
  - else (`service` / `availability` / `portfolio`) → `null` (render — they're mid-flow)
- producer-incomplete or orphan:
  - if `currentStep === "studio"` → `null` (render)
  - else → `/onboarding/studio` (must do Step 1 first)

### Page implementation

Server component at `service/page.tsx`:
1. `auth()` + `fetchUserRole`
2. `decideOnboardingRedirect(role, "service")` → if non-null, `redirect()`
3. Render `<OnboardingShell currentStep={2} title="Add your first service." onBack={...} onSkip={...} hideContinue>`
4. Inside slot: `<NewPackageForm onClose={onSuccess} />`

Continue is hidden because NewPackageForm has its own primary submit. The shell's action bar shows Back + Skip only on this step.

### Conventions

- decide-redirect changes preserve backward compat by defaulting `currentStep="studio"` so existing layout.tsx callers don't break.
- The two existing tests in `decide-redirect.test.ts` continue to pass without modification (default arg).

## TDD steps

Standard cycle. New tests:
- decide-redirect: 4 new cases (producer-complete + each non-studio step)
- service/page: 2-3 cases (renders for incomplete-after-Step-1, redirects raw-incomplete to studio)

## Commit

```bash
git commit -m "$(cat <<'EOF'
feat(onboarding): step 2 — first service via NewPackageForm reuse

Wizard's Step 2 renders the existing NewPackageForm (booking/package-form.tsx)
in pure CREATE mode — same component producer would use later in Setup →
Services, so the data shape they enter here is identical. No new form code,
no minimal stub.

Extends decide-redirect to be step-aware: producer-complete users are
allowed to render Steps 2-4 (so they can continue the flow), but
producer-incomplete users hitting any non-Step-1 route get redirected to
/onboarding/studio.

Skip-for-now ghost link advances without saving.

Story 04 of 10 — `feat/onboarding-rebuild`.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## QA review checklist

### Spec compliance

- [ ] NewPackageForm rendered without `initialValues` or `fromTemplate`
- [ ] Existing decide-redirect tests still pass (backward compat)
- [ ] Skip routes to next step (`/onboarding/availability`) without DB write
- [ ] Telemetry events fire for both completed and skipped paths

### Code quality

- [ ] No new types invented for service kinds — reuse `PackageKind` from `~/app/(app)/dashboard/booking/actions`
- [ ] No duplicated default values — let NewPackageForm own them
