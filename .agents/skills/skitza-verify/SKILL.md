---
name: skitza-verify
description: Run Skitza's compact, risk-aware code and browser quality gate. Use before claiming work is verified, before pushing or opening a PR, or when asked to test, verify, check CI readiness, capture browser-flow screenshots, or diagnose a gate failure.
---

# Verify Skitza

Prove the changed behavior with the smallest useful set of checks. Do not turn a rule or docs change into a new test-harness project.

1. Confirm the root `package.json` has `name: skitza`.
2. Read the diff and choose the needed lanes below.
3. Stop at the first real failure. Keep full output in a log when possible.

## Check lanes

- **Rule or docs only:** validate the changed file and its format. Do not run the whole app gate unless the change affects commands or CI.
- **Code:** run typecheck, lint, focused tests, then the full test suite and build before a PR.
- **Database:** use only a safe test database when schema, queries, server actions, payments, bookings, or proofs changed. Never migrate production. If no safe test database exists, report `PARTIAL`.
- **Browser:** use Playwright when UI, routes, navigation, forms, or responsive behavior changed. Reuse an existing Playwright setup. Do not add a new browser framework only to verify unrelated work.

## Playwright rules

Test one to three important user flows. For each flow:

1. Follow real user actions such as click, type, choose, upload, and navigate.
2. Check the expected URL or visible result after each important action.
3. Fail on a broken page, same-site 4xx/5xx response, failed same-site request, `console.error`, or page error.
4. Check for horizontal overflow. For mobile work, test 360px and 390px, then check desktop separately.
5. Save one screenshot at the useful final state. Keep automatic failure screenshots and traces.
6. Do not send real payments or make destructive writes. Stop before the final write unless a disposable test environment makes it safe.

Say which flows were tested. Do not claim that every page was tested.

Use the final status exactly:

- `VERIFIED`: every required check for this change passed.
- `PARTIAL`: safe checks passed, but one required check could not run.
- `FAILED`: a required check failed.

Keep the report short: one line per check, test counts when useful, and screenshot paths. On failure, show only the first useful error and the log path. Never paste full logs or every screenshot.

Do not weaken application code or tests to hide a failure. State whether the cause is the current change, local setup, or the base branch.
