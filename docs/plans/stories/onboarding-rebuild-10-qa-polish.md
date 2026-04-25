# Story 10 — QA polish (UX critic + mobile audit + smoke)

> Skitza-BMAD · Story 10 of 10
> Architecture: §10
> **Depends on:** Stories 01-09 all landed
> **Dispatcher**: NOT skitza-tdd-implementer. Use `skitza-ux-critic` for the polish review + `general-purpose` for the smoke audit.

---

## As the BMAD QA role...

I want to verify the rebuild ships at the same premium-feel benchmark as Samply / Spotify-for-Artists / Notion before merging to main.

## Acceptance criteria

- [ ] `skitza-ux-critic` agent reviews the 4 step pages on desktop @ 1280×800 + mobile @ 360×640. Output: rated against the standard benchmarks. Any "needs work" findings opened as follow-ups, not blockers (unless rating is "broken").
- [ ] Mobile 360 px audit: every interactive element has ≥ 44 px tap target; no horizontal scroll anywhere in the 4 step pages.
- [ ] `prefers-reduced-motion: reduce` smoke test: enable in OS, walk through all 4 steps, verify no janky transitions, no layered fade-and-translate combos.
- [ ] `pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test` all pass.
- [ ] Test count baseline + new: derive (~14) + shell (~11) + actions extension (~7) + decide-redirect (~18) + next-step-for (~4) + per-step page tests (~10) ≈ +64 tests vs. baseline.
- [ ] No `console.log` / `TODO(claude)` / `FIXME` left in new files. Grep to confirm.
- [ ] No new dependencies added to package.json.
- [ ] PR opened with full test plan checklist.

## Technical context

### Files to touch

None — this is a review + smoke story. May add follow-up commits for cosmetic fixes flagged by ux-critic, but those are bonus.

### Manual smoke checklist

Run `pnpm dev` from `apps/web`. Sign in as a freshly-seeded producer (clear DB row first OR use a fresh Clerk dev user). Walk:

1. `/onboarding/studio` — type "Test Studio", submit → `/onboarding/service`. Verify in DB: producers row has `display_name = 'Test Studio'`, `slug = 'test-studio-XXXX'`, currency set, timezone set.
2. `/onboarding/service` — fill name "Mix" + price 200, submit → `/onboarding/availability`. Verify in DB: products row exists with correct producerId scope.
3. `/onboarding/availability` — set Mon 10-18 weekly, change duration to 90 → `/onboarding/portfolio`. Verify in DB: availability_blocks rows exist; producers.default_session_min = 90.
4. `/onboarding/portfolio` — type Spotify URL only (no upload), Continue → `/dashboard`. Verify producer_external_links has 1 row with platform='spotify'.
5. Mobile @ 360px (Chrome devtools) — repeat steps 1-4. Confirm no horizontal scroll, all CTAs visible, keyboard doesn't break the layout.
6. Reduced motion (System Preferences > Accessibility > Reduce Motion on macOS, or Chrome devtools "Emulate CSS media feature prefers-reduced-motion: reduce") — repeat steps 1-4. No janky transitions.

### Skip-flow smoke

7. As a fresh producer: `/onboarding/studio` complete → close tab → revisit `/onboarding` → assert redirect to `/dashboard`.
8. As a fresh producer: walk to `/onboarding/availability`, click Skip → assert lands on `/onboarding/portfolio`. Then Skip again → `/dashboard`.

### Failure-mode smoke

9. Try to type a slug-like character into Step 1 (it's display name, not slug — should accept anything).
10. Try invalid URL on Step 4 (e.g., "not a url") → inline error, save blocked.
11. Drop a 600 MB file on Step 4 → AudioUploader rejects with size error.

### Conventions

- Open issues for any UX-critic findings rated "needs work" but not "broken"
- Block merge only on broken / failing tests / typecheck / lint
- Reduced-motion regression test (`motion-primitives.test.ts`) MUST still pass

## Commit

If any cosmetic fixes are needed:
```bash
git commit -m "$(cat <<'EOF'
fix(onboarding): polish from ux-critic review

[Specific findings, e.g.:]
  • Step 2 mobile: pricing input width was 100% — caused awkward keyboard interplay; constrained to max-w-[20rem]
  • Step 4 helper copy was below uploader on mobile due to flex order — moved to top.
  • Progress bar segment-2 active color was --brand-primary at 100% but the ux-critic flagged inconsistency with the 60% alpha used for completed segments; standardized.

Story 10 of 10 — `feat/onboarding-rebuild`.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## PR opening

After Story 10 passes:

```bash
git push -u origin feat/onboarding-rebuild
gh pr create --title "feat: producer onboarding wizard rebuild — 4-step stepper" --body "$(cat <<'EOF'
## Summary

Replaces the single-screen `/onboarding` wizard with a 4-step full-screen
stepper that captures the minimum to make a public profile real, while
reusing the production components from Setup so the data shape entered
here is identical to what producers would later edit.

- **Step 1 — Studio name**: display name only; auto-generates slug,
  invisible currency (via x-vercel-ip-country), invisible timezone.
- **Step 2 — First service**: reuses `<NewPackageForm />` in CREATE mode.
- **Step 3 — Availability**: reuses `<AvailabilitySection />` + 5 child editors.
- **Step 4 — Portfolio**: NEW external-links editor + uploader card wrapping the existing R2 multipart pipeline.

Per-step Skip on Steps 2-4. DB-completeness fires after Step 1, so all
later skips are safe. Drop-off → land on `/dashboard` next visit.

PRD §4.5 — committed at the head of this branch (`docs(prd): §4.5 onboarding wizard rebuild`).

## Test plan

- [ ] `/skitza-verify` clean
- [ ] All 4 steps walk-through on desktop
- [ ] All 4 steps walk-through on mobile @ 360px
- [ ] Reduced-motion smoke
- [ ] Skip from each step routes correctly
- [ ] Drop-off → /dashboard after Step 1
- [ ] Artist / unauth gates still work (no regression)
- [ ] No new dependencies

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Report format

(Same as other stories, plus:)

- Manual smoke results (pass/fail per scenario)
- ux-critic raw output
- Mobile 360px screenshots (or describe — viewport check if no headless browser)
- Final test count delta vs baseline
- PR URL once opened
