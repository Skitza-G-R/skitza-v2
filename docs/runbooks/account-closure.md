# Account closure operator runbook

- **Owner:** Gili / founder-authorized operator
- **Frequency:** As needed for a verified request to `privacy@skitza.app`
- **Last updated:** August 13, 2026
- **User surface:** Operator-managed only; there is no end-user delete button

## Purpose

This runbook opens, verifies, processes, and proves an account-closure request.
It starts a visible 30-day due date, hides the Producer's public profile, records
every local and external phase, and closes the case only after every required
phase has real evidence.

## Safety boundary

- Keep the existing Clerk user ID on retained rows. Never relink or detach it
  as part of closure.
- Verification sets `producers.closed_at`, hides `/join/<slug>`, redirects the
  normal Producer and Artist layouts, and blocks ordinary browser tRPC calls.
- Verification is **not proof that every active session is revoked**. Some
  older server actions and file routes authenticate directly with Clerk, and
  server-created tRPC callers do not all carry the browser closure context.
  Full access revocation is recorded only after exact Clerk account deletion
  and session-revocation evidence. The `clerk_account_delete` task then stamps
  `access_revoked_at`.
- Never mark a task complete from intent, a request screenshot, or a command
  that did not return success. Store only a short restricted-case or provider
  receipt reference, never a token, signed URL, email address, database URL,
  or raw error.
- Do not hard-delete accepted terms, purchases, payment records or proofs,
  sessions, approvals, shared project history, security evidence, or closure
  audit history.
- Do not run migration `0050` on Live without Gili's explicit approval for
  that exact migration run. Use `skitza-migrate`; never use Drizzle's migration
  command.

The August 13, 2026 source audit found 131 direct `auth()` call sites under
`apps/web/src/app` and 108 server-created tRPC caller sites. Layout and
browser-tRPC guards therefore cannot support an absolute "access revoked"
claim on their own. The
Clerk task and its evidence are mandatory. The same audit found public or
guest capabilities such as `/listen/<token>`, public song audio, no-charge
proposal links, and pending upload/evidence tokens. Those are handled by the
explicit `public_and_capability_link_revoke` task. It is a local automated
phase that disables all current song links and removes every portfolio
publication marker for the closed Producer. New capability use is rejected at
the authoritative closed-Producer boundary, and the phase waits 15 minutes
from closure before succeeding so every previously issued upload URL has
expired. It then verifies that no public song surface remains.

## Prerequisites

- [ ] The operator has founder-approved access to the protected case record
      and the exact target database secret.
- [ ] Migration `0050_account_closure_foundation.sql` is present on the target.
- [ ] The requester's identity was checked against the verified Clerk email
      before running `verify`.
- [ ] JSON command files are stored in an owner-only directory and removed
      through the approved secure-file process after the case is complete.
- [ ] The shell contains only the dedicated variables below. The command
      rejects generic selectors such as `DATABASE_URL`, `DATABASE_URL_NEON`,
      `POSTGRES_URL`, and PostgreSQL `PG*` connection variables.

The dedicated variables are:

```text
SKITZA_ACCOUNT_CLOSURE_TARGET_CLASS=test|live
SKITZA_ACCOUNT_CLOSURE_DATABASE_URL=<injected secret; never paste into a command file>
SKITZA_ACCOUNT_CLOSURE_ACTOR_CLERK_USER_ID=<exact operator Clerk user ID>
SKITZA_ACCOUNT_CLOSURE_CURRENT_CLERK_INSTANCE_ID=<exact currently deployed app Clerk instance ID>
SKITZA_ACCOUNT_CLOSURE_LIVE_CONFIRMATION=approved-live-account-closure-sk229  # Live only
```

Shell and secret-manager access authorize the operation. The actor Clerk ID is
audit attribution; it is not a substitute for that access control.
Before setting `SKITZA_ACCOUNT_CLOSURE_CURRENT_CLERK_INSTANCE_ID`, verify it
against the Clerk instance currently configured on the deployed app. A
`clerk_account_delete` command must repeat that exact instance ID and is
rejected before any task write when it differs. This prevents deletion proof
from an old rollback instance from revoking access while the current instance
still has a live account.

Before reading JSON stdin, the command fails closed unless the environment and
database target are safe. Live accepts only the verified canonical main Neon
endpoint `ep-tiny-hill-alh6mlzz` (or its standard `-pooler` hostname) and the
pinned provider-owned canonical fingerprint. Test rejects both protected Neon
projects: `raspy-pine-96654399` and `quiet-sun-92221754`. If Neon intentionally
rotates the Live endpoint, first obtain fresh read-only project/branch/endpoint
evidence, then review and update both the endpoint pin in
`operations/account-closure/environment.ts` and the canonical fingerprint in
the SK-104 target observer. Never weaken the check to generic `*.neon.tech`.

## Procedure

Run every command from the repository root. The CLI accepts no arguments; all
case input comes from one protected JSON file on stdin:

```sh
corepack pnpm --filter web account-closure < /secure/account-closure/command.json
```

Output is one sanitized JSON result. It may contain the closure request ID,
status, due date, task names, and task statuses. It never returns the customer
email, customer Clerk ID, operator Clerk ID, database URL, or provider error.

### 1. Open the request

Create a protected command file using this exact shape, replacing every sample
value with the verified case value:

```json
{
  "command": "open",
  "clerkUserId": "user_replace_with_exact_id",
  "requesterEmail": "replace@example.invalid",
  "operationKey": "case-2026-001:open:1"
}
```

Run the CLI command above.

**Expected result:** `command` is `open`; request status is `requested`; no
closure date or due date exists yet. The database stores only a normalized
SHA-256 email hash.

**If it fails:** Do not change the email or Clerk ID to make it pass. Resolve
the static error code, confirm the exact target, and keep the request
unverified.

### 2. Verify identity and start closure

Only after matching the request to the account's verified Clerk email, use:

```json
{
  "command": "verify",
  "requestId": "123e4567-e89b-42d3-a456-426614174000",
  "operationKey": "case-2026-001:verify:1"
}
```

**Expected result:** Status is `processing`; `closureStartedAt` is present;
`dueAt` is exactly 30 days after verification; all nine tasks exist; the
Producer public profile is hidden. Artist-only accounts are still durably
blocked by the verified closure request row.

**If it fails:** Stop. Do not edit `producers.closed_at`, Clerk IDs, request
timestamps, or task rows by hand.

### 3. Revoke Clerk access immediately

First claim the task. Do not delete the user or revoke a session before this
command succeeds:

```json
{
  "command": "start-manual",
  "requestId": "123e4567-e89b-42d3-a456-426614174000",
  "kind": "clerk_account_delete",
  "clerkInstanceId": "ins_replace_with_exact_instance",
  "providerClerkUserId": "user_replace_with_active_provider_id",
  "operationKey": "case-2026-001:clerk:start:1"
}
```

**Expected result:** The task is `running` and the sanitized result returns an
`attempt` number. Only the operator who holds that exact attempt may act.

Now, in the exact Clerk instance, delete or disable the user and revoke all
active sessions. Confirm that the old session can no longer authenticate. Put
the provider receipt and verification detail in the restricted case record.
Then finish the exact returned attempt:

```json
{
  "command": "finish-manual",
  "requestId": "123e4567-e89b-42d3-a456-426614174000",
  "kind": "clerk_account_delete",
  "attempt": 1,
  "clerkInstanceId": "ins_replace_with_exact_instance",
  "providerClerkUserId": "user_replace_with_active_provider_id",
  "operationKey": "case-2026-001:clerk:finish:1",
  "evidenceRef": "case:case-2026-001/clerk-access-revoked",
  "outcome": "succeeded"
}
```

The command resolves the request's stable canonical identity to the active
provider ID in the exact instance and rejects a mismatch. This prevents a
post-relink closure from deleting or proving the old Development account by
mistake.

**Expected result:** The Clerk task is `succeeded` and `accessRevokedAt` is
present. `not_applicable` is forbidden for this task. A different or stale
attempt is rejected.

**If it fails:** Do not claim that access is revoked. Recheck the Clerk
instance, user, sessions, webhook delivery, and receipt.

### 4. Run the narrow automated phases

```json
{
  "command": "resume-automated",
  "requestId": "123e4567-e89b-42d3-a456-426614174000",
  "operationKey": "case-2026-001:auto:1"
}
```

This command runs only:

- `google_calendar_disconnect`: an active connection means
  `disconnected_at IS NULL`. The existing hardened disconnect service
  best-effort revokes Google authorization and clears local tokens, calendar
  selections, and active watches. An Artist-only account, no connection, or
  an already-disconnected row is honestly `not_applicable`.
- `device_and_artist_preferences_cleanup`: deletes push subscriptions, Artist
  notification-feed rows, and the global Artist preference row. It does not
  claim to clear Producer profile data, CRM history, files, or provider logs.
- `public_and_capability_link_revoke`: atomically disables every current
  public song link and clears every portfolio publication marker owned by the
  closed Producer, waits out the longest 15-minute upload URL, then fails
  unless a verification read finds no public surface. Other account-issued
  capabilities fail closed because their authoritative write/read boundaries
  reject a closed Producer. A safe `capability_expiry_pending` result means
  the operator must retry after the expiry window; it is not success.

**Expected result:** Each outcome is `succeeded`, `not_applicable`, or a short
safe `blocked` code. No manual provider/storage task is run automatically.

**If it fails:** Never paste the raw provider error into evidence. Resolve the
safe error in the restricted case and deliberately retry.

### 5. Finish every manual evidence task

For every task below, use the same two commands from step 3: `start-manual`
first, perform the work only after it returns an attempt, then `finish-manual`
with that exact attempt, an explicit outcome, a fresh operation key, and the
applicable task kind. Clerk identity fields are used only for the Clerk task.

- `account_profile_deidentification`: confirm the Clerk deletion webhook
  tombstoned `registered_accounts` PII; classify Producer and contact fields;
  de-identify only non-shared profile data while keeping stable IDs and shared
  records required by other users.
- `storage_review_and_cleanup`: build an exact object manifest. Delete only
  non-shared account/profile/audio/artwork objects. Treat final agreement and
  payment-proof documents as shared records unless the retained-record review
  proves otherwise.
- `retained_record_review`: record retained categories, the lawful or
  shared-record reason, and the expiry or review date in the restricted case.
- `diagnostic_provider_cleanup`: verify and action PostHog, Sentry, email, and
  any other diagnostic/support provider; record each receipt.
- `backup_expiry_tracking`: record when all relevant backup/history windows
  end. This proves expiry tracking, not immediate physical deletion from an
  immutable backup.

`not_applicable` is accepted only for `storage_review_and_cleanup` and
`diagnostic_provider_cleanup`, and only when the restricted case proves that
the exact phase has no applicable data. Never use it merely because provider
access is missing. All other manual phases must finish as `succeeded` with
real evidence.

### 6. Inspect and confirm completion

```json
{
  "command": "inspect",
  "requestId": "123e4567-e89b-42d3-a456-426614174000"
}
```

**Expected result:** The request becomes `completed` only when all nine tasks
are `succeeded` or honestly `not_applicable`, Clerk access-revocation evidence
is present, and no legal hold is active. The mandatory
`public_and_capability_link_revoke` phase must have completed its local revoke
and verification. The completion transaction repeats that verification and
the 15-minute expiry check; neither is assumed from profile hiding or old task
evidence.

**If it fails:** Read the task statuses in the sanitized snapshot. Do not
update status or timestamps directly.

## Legal hold

After verification, set a hold with a short non-confidential reason code:

```json
{
  "command": "legal-hold",
  "action": "set",
  "requestId": "123e4567-e89b-42d3-a456-426614174000",
  "operationKey": "case-2026-001:hold:1",
  "reasonCode": "active_legal_claim"
}
```

Release it only when the hold has formally ended:

```json
{
  "command": "legal-hold",
  "action": "release",
  "requestId": "123e4567-e89b-42d3-a456-426614174000",
  "operationKey": "case-2026-001:hold-release:1"
}
```

A hold blocks new claims, terminal task evidence, and request completion, but
keeps the original due date visible. An external operation that was already
in flight cannot be undone by setting a hold; record that fact in the case and
do not resume any phase until the hold is released.

## Retry and crashed-claim recovery

- Terminal tasks are never run again. A new start or finish against a terminal
  task is rejected; inspect the case instead of changing its evidence.
- A running task owns a 15-minute lease. A concurrent command sees it as
  unavailable and does not start the same provider/local work twice. The
  database clock—not JSON input or the operator workstation—sets and checks
  the lease.
- If a process crashed, wait for the 15-minute lease to expire. Before
  retrying, inspect the task and the exact provider/local state because the
  side effect may have succeeded before the receipt was stored. Put that
  review in the restricted case, then run the separate audited recovery:

```json
{
  "command": "recover-stale-task",
  "requestId": "123e4567-e89b-42d3-a456-426614174000",
  "kind": "google_calendar_disconnect",
  "operationKey": "case-2026-001:recover-google:1",
  "evidenceRef": "case:case-2026-001/google-state-reviewed"
}
```

Recovery never runs the task. It records the evidence and moves only the
expired running claim to `blocked`. After it succeeds, issue a separate
`resume-automated` or `start-manual` command with another fresh operation key.
A normal run command can never reclaim a running task, even after 15 minutes.

- If a result was merely lost and the task is already terminal, inspect its
  stored status and case evidence. Never shorten the lease or edit
  `started_at` to force recovery.

## Due-date monitoring

Review open requests daily:

```sql
SELECT id, status, due_at, legal_hold_at, legal_hold_released_at
FROM account_closure_requests
WHERE status IN ('processing', 'blocked')
ORDER BY due_at ASC, id ASC;
```

Escalate any request approaching `due_at`. A legal hold explains why work is
blocked; it does not move or hide the promised date.

## Verification checklist

- [ ] Sanitized CLI snapshot shows exactly nine task kinds.
- [ ] `dueAt` is exactly 30 days after verification.
- [ ] The public `/join/<slug>` profile no longer resolves.
- [ ] Clerk account/session evidence exists and `accessRevokedAt` is present.
- [ ] Google is disconnected or proved not applicable.
- [ ] Every manual task links to real restricted-case evidence.
- [ ] Shared legal/payment/session history remains intact.
- [ ] No legal hold is active.
- [ ] Final request status is `completed` and the append-only completion event
      exists.

## Troubleshooting

| Safe result                                      | Meaning                                                                                | Action                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ACCOUNT_CLOSURE_AMBIENT_DATABASE_ENV_FORBIDDEN` | A generic database selector is present.                                                | Start a clean approved operator shell; do not unset variables blindly in a shared shell. |
| `ACCOUNT_CLOSURE_TARGET_INVALID`                 | The endpoint/project/fingerprint is not the approved target, or target cleanup failed. | Stop and verify the target read-only. Never substitute the OLD project.                  |
| `account_closure_not_verified`                   | Cleanup was attempted before identity verification.                                    | Verify identity, then run step 2.                                                        |
| `account_closure_legal_hold`                     | A hold is active or arrived during work.                                               | Stop cleanup and follow the hold procedure.                                              |
| Task remains `running`                           | Another command owns the 15-minute lease or a process crashed.                         | Follow crashed-claim recovery; do not force the row.                                     |
| `google_calendar_not_configured`                 | An active Google connection exists but server configuration is unavailable.            | Restore the correct server configuration; do not mark the task not applicable.           |
| `unexpected_failure`                             | A raw provider/storage error was safely suppressed.                                    | Inspect the restricted operator logs without copying secrets into evidence.              |

## Rollback

Before verification, stop and leave the request in `requested` if identity is
not confirmed. After verification, closure is intentionally one-way:
`producers.closed_at` cannot be cleared by this workflow and Clerk IDs cannot
be rewritten. There is no generic rollback command. If verification was
wrong, stop all tasks, preserve the audit trail, and escalate for a reviewed
case-specific correction.

## Current infrastructure facts (verified August 13, 2026)

- Canonical Neon project: `skitza-v3` (`raspy-pine-96654399`), Free plan. The
  dashboard showed database history retention of 6 hours. This is below the
  Privacy Notice's backup ceiling, but recheck it for each closure because
  plans and settings can change.
- `skitza-audio` R2: no bucket lock and no object-expiry rule was visible. The
  only default lifecycle action was aborting incomplete multipart uploads after
  7 days. Public development URL was disabled. Account audio therefore needs
  an exact manual object manifest and deletion evidence.
- `skitza-docs` R2: staging prefixes for agreement PDFs and payment proofs
  expire after 1 day; incomplete multipart uploads abort after 7 days; no
  bucket lock was visible. Final/shared documents had no automatic expiry
  visible and must be classified as retained shared records.
- PostHog and Sentry dashboards were not authenticated during the audit. Their
  actual retention and user-deletion settings are unknown and remain mandatory
  evidence under `diagnostic_provider_cleanup`.

## Closure report

Capture in the restricted case record:

- request ID, received time, verification time, due time, and operator;
- Clerk instance plus deletion/session-revocation receipt;
- Google local disconnect result and any provider revocation result;
- exact deleted-object manifest and retained object/record categories;
- PostHog, Sentry, email, and other provider receipts;
- backup/history expiry dates;
- every legal-hold event; and
- the final task table and completion event.

Never paste database URLs, API keys, OAuth tokens, signed object URLs, or raw
personal data into the report.

## Escalation

Stop and ask Gili for a case-specific decision if the target identity is not
exact, identity verification is uncertain, a shared record cannot be safely
classified, provider evidence is unavailable, the due date is at risk, or a
legal hold conflicts with deletion work.
