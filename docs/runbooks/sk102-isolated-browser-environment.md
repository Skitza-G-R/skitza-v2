# SK-102 isolated logged-in browser environment

This runbook covers one disposable, non-production environment for authenticated
browser verification. Repository safeguards are implemented; no external
resource is created, changed, migrated, deployed, or promoted by this setup.

## Hard boundary

The runtime must use all of the SK-102 resources together. It must never use,
query, branch from, or mutate either protected Neon project, the existing Clerk
development instance, live/default R2 buckets, Resend, telemetry, a payment
provider, or any customer identity or address. Do not put URLs, credentials,
raw provider identifiers, object keys, auth state, or screenshots containing
secrets in Git, Linear, PRs, terminal output, or reports.

The browser origin is exactly `http://127.0.0.1:3102`. Payment is represented
in-app with `SK102_PAYMENT_MODE=off_app_test`; there is no payment-provider call.
Email is captured privately in isolated R2 and is never delivered.
Next.js telemetry is disabled with the required exact setting
`NEXT_TELEMETRY_DISABLED=1`.

## Exact proposed external targets (approval required)

Gili must approve this complete target set and each external action before it
happens:

| Role                   | Proposed isolated target/action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database               | Use the approved isolated current-schema source project `sk90-rehearsal` (bound privately by its observed fingerprint); create child branch `sk102-browser`, database `skitza_sk102_browser`, and dedicated runtime role `sk102_browser`. A cloned database keeps its existing object owners: if migrations are missing, use its existing isolated table-owner credential only for one separately approved migration run, then remove that credential from the local process. Never transfer ownership or grant the runtime role owner membership. Do not use either protected project as source or target. |
| Clerk                  | Create a new development instance named `Skitza SK-102 Browser`, its dedicated webhook endpoint, and fixture-only accounts. Do not reuse the current development instance or any existing account.                                                                                                                                                                                                                                                                                                                                                                                                          |
| R2 audio               | Create `skitza-sk102-browser-audio` with a credential scoped only to the two SK-102 buckets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| R2 docs and email sink | Create `skitza-sk102-browser-docs`; email captures live under `sk102-email-sink/<runtime-slot>/<kind>/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| R2 CORS                | Apply the SK-102-only policy to those two buckets: origin `http://127.0.0.1:3102`; methods `PUT`, `GET`, `HEAD`; headers `*`; expose `ETag`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Email                  | Use the internal private R2 capture sink; create no Resend resource and set no Resend variable. Recipients must be fixture aliases ending in `+clerk_test...@example.com`.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Payment                | Use `off_app_test` only; set no Stripe, Tranzila, PayPal, or Adyen variable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Web runtime            | Local/CI loopback on port 3102 only. The empty non-production hosting project is only a future candidate and this issue does not authorize a deployment.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| GitHub Actions         | Create a protected environment named `sk102-browser`, scope only SK-102 secrets to it, and require Gili as reviewer. Until the workflow exists on the default branch, its manual trigger is the exact `run-sk102-browser` label on same-repository PR #235 only, after a no-secret preflight verifies the exact source branch and `v3-clean` base. It must never use `pull_request_target`, deploy, or run on ordinary pushes/PR events.                                                                                                                                                                    |

The Clerk webhook cannot reach a loopback URL from Clerk. A separately approved
non-production callback/tunnel target is therefore still required before real
webhook delivery can be claimed. Do not create a tunnel or deploy a callback
under this runbook without Gili approving its exact URL and action.

## Configuration and fingerprints

Use the commented SK-102 block in `apps/web/.env.example` as a field list, but
do not copy the ordinary application environment. Local commands automatically
load only the fixed git-ignored file `.skitza/sk102-browser.env`. Create its
parent directory with mode `0700` and the file with mode exactly `0600`. Its
format is strict literal, unquoted `NAME=value`: no `export`, spaces around the
name/value, quotes, shell expansion, or duplicate names. The loader accepts
only the SK-102/provider/fixture allowlist and never prints values. In CI, use
the protected environment variables and secrets directly instead of creating
this file. Every SK-102 variable is treated as one atomic configuration: a
partial configuration stops with a safe `SK102_*` error code.

From the repository root, prepare the path without writing any value to the
terminal:

```text
umask 077
mkdir -p .skitza
chmod 700 .skitza
touch .skitza/sk102-browser.env
chmod 600 .skitza/sk102-browser.env
```

The one-shot `SK102_R2_CORS_MUTATION_CONFIRMATION` is deliberately rejected by
the private file loader. Set it only in the process environment for the one
exact approved CORS invocation, then unset it.

Before approval, observe external resources read-only and record only their
SHA-256 fingerprints in private approval material. Configure:

- the observed and approved fingerprint of the disposable database target;
- the approved database endpoint fingerprint and at least two forbidden
  endpoint fingerprints covering the protected databases;
- the approved runtime credential fingerprint for the dedicated
  `sk102_browser` database role;
- at least two forbidden database target fingerprints;
- the approved new Clerk publishable-key target fingerprint, the approved
  fingerprint of that instance's exact publishable/secret/webhook credential
  bundle, and the existing Clerk development-instance fingerprint as forbidden;
- the approved R2 account/bucket-set fingerprint, the approved exact
  account/key-id/secret credential-bundle fingerprint, and at least one
  protected R2 target fingerprint; and
- protected R2 bucket names including all live/default and rehearsal buckets.

The runtime recomputes endpoint, database-role, Clerk, R2-target, and
R2-credential fingerprints from its actual configuration. A mismatch stops before a client is returned. Database checks
run in both `createDb` and `createNeonPool`; Node startup validates the complete
configuration, and Edge startup validates the non-secret isolation subset.
The database URL must contain its own user/password and exactly one
`sslmode=require` or `sslmode=verify-full`; optional
`channel_binding=require` is the only other accepted query setting. Routing,
service, options, certificate-file, and duplicate query settings are rejected,
as are ambient libpq `PG*` connection variables, so the Pool cannot reinterpret
an approved-looking authority as a different endpoint.
If `@clerk/testing` needs `CLERK_PUBLISHABLE_KEY`, it must be exactly equal to
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`; any mismatch stops startup. Its setup is
passed the approved key pair directly with dotenv loading disabled. Any other
ambient Clerk endpoint, proxy, script, testing-token, frontend, or debug
override stops both Node and Edge startup.

SK-102 rejects `VERCEL_ENV=production`, ambient alternate database selectors,
legacy/public R2 selectors, Resend, Sentry, PostHog, webhook/waitlist delivery,
payment-provider variables, and the unrelated `ACCESS_TOKEN`, `CRON_SECRET`,
`MAGIC_LINK_SECRET`, and `SONG_PUBLIC_LINK_SECRET`. Leave all four signing/gate
secrets unset. It also rejects ambient TLS-verification, custom CA/OpenSSL,
Node loader, and HTTP(S)/all-proxy overrides before any database or provider
client is created. Error messages never include the rejected value.

`DATABASE_URL` in `.skitza/sk102-browser.env` and in the protected GitHub
environment is always the dedicated `sk102_browser` runtime credential. Never
put a database-owner or migration credential in that file or environment. If a
cloned target needs an approved migration, keep the existing isolated
table-owner credential in a separate mode-`0600`, git-ignored one-shot input.
Before use, bind it privately to the same approved endpoint, database name, and
target fingerprint, and to a separately approved credential fingerprint. Do
not print it, add it to GitHub, change ownership or memberships, or retain it
after the migration process exits.

## Approved setup sequence

Only after Gili approves the exact targets/actions above:

1. Create branch `sk102-browser` from the privately fingerprinted
   `sk90-rehearsal` source, then create/rename database
   `skitza_sk102_browser` and dedicated runtime role `sk102_browser` before
   copying its connection string into the private environment. Grant only the
   application data/schema access required by seed, browser, and cleanup; do
   not make it an owner or a member of an owner role.
2. Inspect schema, ownership, grants, and migration ledger read-only. A cloned
   0027-0029 baseline has exactly 28 public application tables. Before a
   migration, confirm that the one-shot migration role owns (or is already a
   member of the role that owns) every existing public table plus the public
   schema and migration ledger. DML grants, `CREATEDB`, and `CREATEROLE` do not
   authorize `ALTER TABLE`. If the runtime role is not an owner, stop; do not
   retry with it, transfer ownership, or grant it owner membership. Ask Gili to
   approve one use of the existing isolated table-owner credential against the
   same fingerprinted endpoint and database.

   The exact expected completed ledger spans `0027` through `0034`; within it,
   the ordinary runner-owned set is exactly `0029` through `0034`
   (`0027`/`0028` retain their special cutover history). If any item is missing,
   extra, or has a different digest, stop and ask Gili; do not repair it ad hoc.
   If an approved migration run is required, follow `$skitza-migrate` and run
   only `packages/db/apply-migrations.mjs` against the explicitly confirmed
   disposable URL. Recheck that the local migration range ends at `0034`
   because the runner processes every file from `0027` onward. After the run,
   require exact ledger entries `0027`–`0034`, matching digests, and 33 public
   application tables. Then discard the one-shot owner credential and return
   to the dedicated runtime URL. Never run `drizzle-kit migrate` or
   `pnpm -F db db:migrate`.

3. Create the new Clerk development instance, dedicated webhook endpoint, and
   fixture-only accounts. Configure the new approved instance fingerprint as
   approved and the existing development-instance fingerprint as forbidden
   before first startup.
4. Create the two exact R2 buckets and bucket-scoped credential. Add every
   protected bucket to `SK102_PROTECTED_R2_BUCKETS`.
5. After Gili separately approves the exact CORS mutation, set
   `SK102_R2_CORS_MUTATION_CONFIRMATION=approved-exact-sk102-r2-cors-targets`
   for that one command and run `corepack pnpm --filter web
sk102:apply-r2-cors`. The command prints bucket roles only, never names.
   Unset the confirmation immediately afterward.
6. Create/configure the protected GitHub environment `sk102-browser` only after
   approval, with Gili as required reviewer. While the workflow is absent from
   default branch `main`, start it manually by adding exact label
   `run-sk102-browser` to same-repository PR #235. The unprivileged preflight
   must first verify that exact PR, its SK-99 source branch
   `giasraf/sk-99-chat-20-apply-final-navigation-and-remove-dead-controls`, and
   `v3-clean` base; the checked-out harness is independently pinned to the
   current `v3-clean` revision containing SK-102;
   only the protected job may read secrets after reviewer approval. Do not use
   `pull_request_target`. `workflow_dispatch` is future-only after the workflow
   reaches the default branch. The workflow must not deploy.
7. Run the fixture seed documented beside the SK-102 fixture command, then run
   `corepack pnpm --filter web test:browser`. The suite owns sequential logical
   slots `desktop`, `phone390`, and `phone360`; the external target remains
   bound to the one approved runtime slot.
8. Run the fixture cleanup even after a failed test. Confirm the isolated
   database fixtures and both isolated R2 buckets are empty before disposal.

Only one seed/browser/cleanup lifecycle may use this target at a time. The
browser runner holds a database advisory lease for its entire seed-to-cleanup
sequence; standalone seed/cleanup commands fail if that lease is active, and a
second runner fails before fixture mutation. GitHub Actions also enforces a
non-cancelling concurrency group. Still confirm the protected workflow is idle
before a local run rather than deliberately racing the safety gate.

No command in this runbook authorizes deployment, production changes, DNS,
promotion, merge, or creation/change of an unlisted resource.

## Email assertion and evidence

Every SK-102 send validates all `to`, `cc`, `bcc`, and `replyTo` addresses
before writing a private JSON capture. The record includes the rendered test message and a
one-way idempotency fingerprint, never the raw idempotency key. It has
`private, no-store` cache control and is not publicly exposed.

The browser harness checks required mail with:

```text
corepack pnpm --filter web e2e:assert-email -- --slot desktop --kind client-invite
corepack pnpm --filter web e2e:assert-email -- --slot desktop --kind payment-reminder
```

`--slot` is a logical browser evidence label only. Target selection always uses
the approved runtime slot. The command prints only slot, kind, and count; it
never prints bucket names or object keys.

Keep only sanitized evidence: command status, viewport, scenario name, request/
console/overflow result, and capture count. Screenshots, traces, and videos are
disabled. Playwright auth state and private manifests remain in git-ignored
paths and must be deleted during cleanup.

## Cleanup and rollback

Cleanup owns the entire disposable 33-table application database and both
approved isolated buckets. It must re-run the target guard immediately before
deletion, truncate the exact 33-table allowlist without `CASCADE` while
preserving only the migration ledger, and fail if any unexpected table, row,
multipart upload, or R2 object remains. Do not broaden the allowlist or a
cleanup selector to make it pass.

After evidence is retained in sanitized form, revoke the bucket credential,
remove fixture-only Clerk users and webhook, delete the two SK-102 buckets, and
delete the disposable database child. Remove `.skitza/sk102-browser.env` and
confirm `apps/web/playwright/.auth` plus `.skitza/e2e` are absent. With separate
approval for that exact GitHub action, remove/disable the `sk102-browser`
environment's secrets and variables (and delete the environment if it is no
longer needed). Each destructive external cleanup action requires confirmation
that its exact target is the approved SK-102 resource. The protected database
projects, existing Clerk development instance, live R2, customer email, and
production configuration remain untouched.
