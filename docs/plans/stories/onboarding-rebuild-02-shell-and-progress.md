# Story 02 — Onboarding shell + progress bar + action bar

> Skitza-BMAD · Story 02 of 10
> Architecture: `docs/plans/active/2026-04-25-onboarding-rebuild-architecture.md` §5, §6
> **Depends on:** Story 01 (helpers exist; not used here but the directory pattern is established)

---

## As a producer entering onboarding...

I want a single, calm visual frame that stays consistent across all 4 steps, so the experience feels like one continuous moment instead of jumping between unrelated screens.

## Acceptance criteria

- [ ] Shell renders a fixed ambient brand-glow blob (top-center, brand-primary at 0.08 alpha) — same shape as today's `(onboarding)/onboarding/page.tsx:55-58`.
- [ ] Progress bar at top: 4 segments separated by 2px gaps. Active segment fills with `--brand-primary`; completed segments at 60% alpha; pending segments use `--border-subtle`.
- [ ] Step header: font-mono eyebrow (`ONBOARDING · STEP N OF 4`) + font-display H1 (passed in as prop) with `opsz` 96 styling.
- [ ] Action bar: sticky to viewport bottom, respects iOS safe area (`sk-safe-bottom`). Layout: Back chip on left (hidden on Step 1), Skip ghost link + Continue primary on right.
- [ ] All buttons ≥ 44 px tap target on mobile (CLAUDE.md UI rule).
- [ ] Forward step transitions: outgoing fades to opacity 0 over 120 ms; incoming fades from 0 → 1 + 4 px upward translate over 200 ms. Implemented via existing `.reveal-up` keyframe.
- [ ] `prefers-reduced-motion: reduce` → instant swap (≤ 50 ms opacity), no translate. Pinned by a vitest test similar to `apps/web/src/app/__tests__/motion-primitives.test.ts`.
- [ ] No data, no step content, no server calls in this story. Pure layout primitives.

## Technical context

### Files to touch

**Create:**
- `apps/web/src/app/(onboarding)/onboarding/shell.tsx` — server-or-client component (likely client; takes `currentStep`, `totalSteps`, `eyebrow`, `title`, `children`, `back`, `continue`, `skip`).
- `apps/web/src/components/onboarding/progress-bar.tsx` — pure presentational, takes `current: 1|2|3|4` + `total: 4`.
- `apps/web/src/components/onboarding/action-bar.tsx` — takes `onBack?`, `onContinue`, `onSkip?`, `continueLabel`, `continueDisabled?`.
- `apps/web/src/components/onboarding/__tests__/progress-bar.test.tsx` — RTL render asserts ARIA + segment classes.
- `apps/web/src/components/onboarding/__tests__/action-bar.test.tsx` — RTL render asserts presence/absence of Back, callback wiring.

**Modify:** none yet (no step pages exist; Story 03+ wires the shell into them).

### Conventions (CLAUDE.md)

- CSS vars only (`rgb(var(--brand-primary))`, `rgb(var(--border-subtle))`, `var(--radius-md)`).
- Tap targets ≥ 44 px via `min-h-11` Tailwind (currently rest-of-app convention).
- ARIA: progress bar wrapper has `role="progressbar"` + `aria-valuenow={current}` + `aria-valuemin={1}` + `aria-valuemax={4}` + `aria-label="Onboarding progress"`.
- Sticky action bar uses `position: sticky; bottom: 0` + `--sk-safe-bottom-px` (existing utility).
- No framer-motion. All transitions via `.reveal-up` from `globals.css`.

### Component contracts

```tsx
// shell.tsx
export function OnboardingShell({
  currentStep,            // 1 | 2 | 3 | 4
  title,                  // string — H1 text
  children,               // step content
  onBack,                 // optional — Step 1 omits
  onContinue,             // required
  onSkip,                 // optional — Step 1 omits
  continueLabel = "Continue →",
  continueDisabled = false,
}: { ... })
```

## TDD steps

### Step 1 — Write failing tests

`progress-bar.test.tsx`:
- renders 4 segments
- segment N has the "active" class; segments < N have "completed" class; > N have "pending" class
- `aria-valuenow` matches `current`
- `aria-label` is `"Onboarding progress"`

`action-bar.test.tsx`:
- when `onBack` not provided: Back button not rendered
- when `onContinue` provided: Continue button renders, click calls callback
- when `onSkip` provided: Skip ghost link renders, click calls callback
- when `continueDisabled=true`: Continue button has `disabled` attr

### Step 2-4 — Standard RED → implement → GREEN

Implementation notes:
- Progress bar: flex container w/ 4 children, each `flex-1 h-1 rounded-full`. Class derivation: index < current → `bg-[rgb(var(--brand-primary)/0.6)]`; index === current - 1 → `bg-[rgb(var(--brand-primary))]`; otherwise `bg-[rgb(var(--border-subtle))]`.
- Action bar: fixed-or-sticky bottom with safe-area padding. Use `sticky bottom-0 left-0 right-0`.
- Shell: `min-h-dvh` container with the ambient blob, top progress bar, header block, content slot, action bar. Apply `.reveal-up` to the content slot's outer wrapper for first-paint anim.

### Step 5 — Pipeline

`/skitza-verify` — typecheck + lint + test all green. New tests: ~6 in progress-bar + ~5 in action-bar = 11 new.

## Commit

```bash
git add apps/web/src/app/\(onboarding\)/onboarding/shell.tsx apps/web/src/components/onboarding/
git commit -m "$(cat <<'EOF'
feat(onboarding): shell + progress bar + action bar primitives

Layout scaffolding for the 4-step rebuild — ambient gradient, 4-segment
progress bar, sticky bottom action bar (Back / Skip / Continue) with iOS
safe-area handling. CSS vars only, no framer-motion, motion-reduced gate
respected via existing `.reveal-up` keyframe. ARIA: progressbar role with
correct aria-valuenow / aria-valuemin / aria-valuemax.

No step content yet — Stories 03-08 fill these slots. Pure presentational
primitives so step pages stay simple.

Story 02 of 10 — `feat/onboarding-rebuild`.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## QA review checklist

### Spec compliance

- [ ] All 8 acceptance criteria observable in the rendered DOM
- [ ] No data fetching, no step content
- [ ] Story stays small — < 250 lines added across all files

### Code quality

- [ ] CSS vars only — grep shows no hex codes in new files
- [ ] ARIA attributes match spec
- [ ] Tap targets ≥ 44 px (use browser inspector or test the rendered className)
- [ ] motion-primitives test still passes if a new keyframe was added
