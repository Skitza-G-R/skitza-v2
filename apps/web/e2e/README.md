# SK-102 authenticated browser harness

This Playwright suite runs real logged-in clicks against the fixed local origin
`http://127.0.0.1:3102`. It covers the SK-99 producer and artist journeys at
desktop, true 390px, and true 360px viewports. It refuses remote application
origins and derives the exact guarded R2 origins from the approved runtime
account and bucket configuration.

The complete target proposal, approval gate, migration procedure, and disposal
steps are in `docs/runbooks/sk102-isolated-browser-environment.md`. No command
here authorizes creating or changing Neon, Clerk, R2, GitHub, or any other
external resource.

## Required private configuration

Use only the separately approved SK-102 target set. The commented SK-102 block
in `apps/web/.env.example` lists the runtime variables and fingerprints. The
browser layer additionally requires:

- `CLERK_PUBLISHABLE_KEY`, byte-for-byte equal to
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`;
- `SKITZA_E2E_PRODUCER_CLERK_USER_ID` and
  `SKITZA_E2E_ARTIST_CLERK_USER_ID` for fixture ownership;
- `SKITZA_E2E_PRODUCER_EMAIL` and `SKITZA_E2E_ARTIST_EMAIL`, both dedicated
  Clerk development test aliases ending in exact `+clerk_test` before the
  allowed fixture-only email domain.

Do not set `ACCESS_TOKEN`, alternate database URLs, Resend, telemetry, payment
provider, production, or public-storage variables. Local commands load only
`.skitza/sk102-browser.env`; make its parent directory mode `0700` and the file
mode exactly `0600`. Use literal, unquoted `NAME=value` lines with no `export`,
shell interpolation, surrounding whitespace, or duplicates. The strict loader
rejects any non-SK-102 name and rejects the one-shot R2 CORS mutation approval.
CI reads the equivalent values only from the protected GitHub environment.
Never paste values into command arguments, reports, screenshots, or commits.

## Repeatable run

After the exact external targets exist, have been approved, and the isolated
database has been migrated only through `skitza-migrate`:

```text
corepack pnpm install --frozen-lockfile
corepack pnpm --filter web exec playwright install chromium
corepack pnpm test:browser
```

`test:browser` runs `desktop`, `phone390`, and `phone360` sequentially. For each
slot it seeds a fresh deterministic fixture set, authenticates the two fixture
users, runs the journeys, and invokes cleanup as the Playwright project
teardown. The manifests and generated upload files stay below
`.skitza/e2e/<slot>-assets`; auth state stays below
`apps/web/playwright/.auth`. Both locations are ignored and path-confined.
The wrapper accepts no Playwright command-line override; only the separate
`test:browser:list` script may pass the secret-safe `--list` mode.

This target is single-owner. The wrapper holds a database advisory lease across
the complete run, and standalone seed/cleanup commands fail while it is held.
Confirm the protected CI workflow is idle before a local run, and do not
deliberately race another local or CI run.

If a runner is interrupted before teardown, clean every slot explicitly:

```text
corepack pnpm e2e:cleanup -- --slot desktop --manifest .skitza/e2e/desktop.json
corepack pnpm e2e:cleanup -- --slot phone390 --manifest .skitza/e2e/phone390.json
corepack pnpm e2e:cleanup -- --slot phone360 --manifest .skitza/e2e/phone360.json
```

Cleanup fails closed if the database schema, target fingerprints, or isolated
R2 contents do not match the fixture contract. Follow the runbook's approved
external rollback steps afterward; never broaden cleanup selectors.

## CI and evidence

The workflow `.github/workflows/sk102-browser.yml` never deploys or pushes. Its
secret-free preflight pins the harness/base revision and exact PR #235 head
revision before the protected `sk102-browser` job can request Gili's approval.

Because this repository's default branch is `main`, `workflow_dispatch` becomes
available only if the workflow later exists there. For the `v3-clean` flow,
after SK-102 is approved and merged, deliberately add the exact
`run-sk102-browser` label to the same-repository PR #235. Remove and re-add that
label for an intentional rerun. No other PR, branch, label, fork, or automatic
PR event can reach the protected browser job, and `pull_request_target` is not
used.

Screenshots, traces, videos, HTML reports, raw errors, URLs, emails, provider
IDs, and command output are excluded. The only retained artifacts are
short-lived `apps/web/browser-evidence/<slot>.json` files containing static test
titles, project names, durations, and status. Any browser request failure,
same-site or exact R2 4xx/5xx, console/page error, crash, or horizontal overflow
fails the run.
