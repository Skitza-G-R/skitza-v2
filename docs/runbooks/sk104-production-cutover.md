# SK-104 production cutover

- **Issue:** SK-104
- **Purpose:** Safely apply the approved Chats 3–20 database and storage cutover
- **Approved migration bundle:** 0027 through 0034 only
- **Status:** Operator procedure only. This document does not authorize a production action.

This runbook is for the one approved production target. It resets the exact
approved mock/test records, applies the fixed migration bundle, removes only
the exact reset-owned storage objects, and verifies the final state.

The cutover is intentionally fail-closed. If any check is different from the
approved plan, stop. Do not guess, bypass a check, edit private state, or switch
to a generic migration command.

## 1. What the cutover changes

The approved plan expects:

- 114 mock/test database rows to be reset;
- 215 preserved rows to keep the same approved business content;
- 9 exact reset-owned storage objects to be backed up and then removed;
- 5 approved test identities, 5 approved mock monetary indicators, and 7
  approved test-mode provider references;
- migrations `0027_purchase_foundation.sql` through
  `0034_song_public_access.sql`, with no missing or additional migration; and
- the exact release commit recorded in the private execution context.

The database reset and all eight migrations commit in one transaction. A
normal failure before commit rolls the entire database change back. Storage
objects are removed only after every recovery copy is verified and the
database transaction is confirmed committed.

## 2. Actions this runbook does not authorize

Do not use this runbook to:

- target the frozen old database or any unapproved database or bucket;
- run `drizzle-kit migrate` or `pnpm -F db db:migrate`;
- run the initial 0027 cutover through the generic migration command;
- delete, replace, or restore any object outside the exact approved set;
- change live payment infrastructure;
- deploy, promote, repoint `skitza.app`, or merge a pull request; or
- reuse an execution approval for a restore.

Each of those actions needs its own scope and approval.

## 3. Before starting

Confirm all of the following:

1. The SK-104 code and runbook come from the exact approved release commit.
2. The target database and storage fingerprints are the approved production
   fingerprints, and the frozen fingerprints are present as explicit deny
   values. The canonical production project is `skitza-v3`; the older
   `skitz` project is stale and forbidden.
3. Gili's statement that all current activity is mock/test is still true. If
   there is any real user, payment, charge, or live schedule, stop.
4. The database and storage credentials are available privately. Do not print,
   paste, or record their values in a command, PR, issue, or log.
5. The private approval file, approval-ledger directory, and state directory
   are absolute paths owned only by the current operator. They must not be
   symbolic links or overlap each other.
6. The approved absolute `pg_dump`, `pg_restore`, and `psql` paths are
   available.
7. No application or worker can write during `execute`, `resume`, or `restore`.
   The no-writer confirmation is a safety assertion, not a traffic-control
   mechanism. Block writers first.
8. Only one operator is using this approval ledger and state directory. The
   runner also holds a crash-released database lease and rejects overlap.

Use only the dedicated `SK104_CUTOVER_*` configuration. Generic database,
PostgreSQL, R2, and AWS selectors must be absent. The command rejects them even
when their values would point to the same target.

The fixed operator statements are:

- operator scope: `approved-production-cutover-sk104`;
- mock/test attestation: `all-current-activity-is-approved-mock-test`; and
- no-writer confirmation: `approved-no-writers-during-sk104-cutover`.

These statements are required checks. They do not replace approval of the
exact plan digest.

## 4. Mode-specific approval inputs

Invoke the SK-104 cutover entrypoint with exactly one mode:

`pnpm --filter web sk104:cutover -- <mode>`

Do not call its internal modules directly.

| Mode                | User-approved plan digest | Approved execution digest     | No-writer confirmation |
| ------------------- | ------------------------- | ----------------------------- | ---------------------- |
| `inspect`           | Absent                    | Absent                        | Absent                 |
| `prepare-backup`    | Absent                    | Absent                        | Absent                 |
| `plan`              | Absent                    | Absent                        | Absent                 |
| `authorize-execute` | Exact execute-plan digest | Absent                        | Absent                 |
| `authorize-restore` | Exact restore-plan digest | Absent                        | Absent                 |
| `execute`           | Absent                    | Exact execute-approval digest | Required               |
| `resume`            | Absent                    | Exact execute-approval digest | Required               |
| `restore`           | Absent                    | Exact restore-approval digest | Required               |

An authorization is action-specific and valid for at most five minutes. The
runner records it once in the owner-only approval ledger. An expired,
differently bound, or cross-run approval stops. The same still-valid consumed
approval may continue only the exact bound run during `resume`.

## 5. Safe operating sequence

### Step 1: `inspect`

`inspect` is read-only against production. It:

1. verifies the approved database target on the same connection used for the
   inspection;
2. verifies the approved storage target;
3. checks the exact schema, reset rows, preserved rows, storage references,
   test identities, mock monetary rows, and provider references;
4. stops on any live-payment signal or inventory drift; and
5. creates the private bound manifest and initial local durable state.

Check only the sanitized result: phase, counts, and digests. Never print the
private bundle or raw identifiers.

Expected phase: `inspected`.

### Step 2: `prepare-backup`

`prepare-backup` creates the database restore point before any cutover
approval exists. It:

1. re-verifies the approved target and exact inspected baseline;
2. exports the verified database snapshot with the approved `pg_dump` binary;
3. writes an owner-only custom-format archive that retains database object
   ownership and privilege metadata;
4. hashes and binds the completed archive to the manifest; and
5. records the database restore-point fingerprint in private state.

The archive is prepared through owner-only staging. If the parent command
stops unexpectedly, a later leased retry either verifies and finishes that
exact archive or stops without trusting a partial file.

Credentials are passed privately to the child process, never as a command
argument. A missing, changed, unreadable, wrongly permissioned, or invalid
archive stops all later modes.

Expected phase: `backup_prepared`.

### Step 3: `plan`

`plan` makes no production change. It binds:

- the exact production target and policy;
- the manifest and release commit;
- the database and storage restore points;
- the fixed 0027–0034 migration-bundle digest;
- 114 reset rows and 9 storage objects;
- the no-writer requirement; and
- the exact execution order.

It creates separate execute and restore plan digests. Record only the
sanitized digests shown by the command.

Expected phase: `planned`.

### Step 4: get explicit approval

Show Gili the sanitized execute plan and its exact digest. Approval must name
that digest and the production execute action.

After approval, run `authorize-execute` with the exact approved execute-plan
digest. It creates a short-lived execute approval and returns its sanitized
approval digest. Put that exact digest into the execution-only configuration.

Do not authorize restore at the same time. Restore has a separate plan, a
separate digest, and a separate decision.

### Step 5: block writers

Before `execute`, stop or block every application path and worker that can
write to the database or the two storage buckets. Confirm the maintenance
boundary is active, then provide the exact no-writer confirmation.

The database adapter also tests that representative writes are blocked. A
failed writer probe stops before deletion or migration.

### Step 6: `execute`

Start `execute` while its approval is valid. The runner performs this order:

1. consumes the exact execute approval once;
2. verifies the database backup again;
3. holds the exclusive crash-released cutover lease;
4. creates and fully verifies recovery copies for all 9 storage objects;
5. opens one serializable database transaction and takes the fixed advisory
   and table locks;
6. rechecks the target, baseline, inventory, mock evidence, and blocked-writer
   proof under those locks;
7. deletes exactly the 114 approved mock/test rows by approved IDs;
8. applies exactly migrations 0027–0034 and their ledger entries inside the
   same transaction;
9. verifies the target schema, preserved data, ownership, foreign keys,
   orphans, and empty reset tables before commit;
10. removes only the 9 prepared reset-owned storage objects after fresh
    exact-object and recovery checks under the blocked-writer boundary; and
11. verifies the final database and storage state.

Expected final phase: `verified`.

Do not reopen writers until the final phase is `verified` and the separate
application smoke checks are complete.

## 6. Interrupted run: `resume`

Use `resume` only with the same private bundle, release commit, state directory,
approval ledger, target, and plan.

The durable state tells the runner where to continue. It does not repeat a
completed phase:

- if the database is still the exact baseline, the approved database action
  may start;
- if the database is already the exact approved post-cutover state, the runner
  reconciles the lost commit response and continues without deleting rows
  again;
- a mixed or unknown database state stops;
- prepared storage copies are verified again before deletion; and
- already absent storage objects are accepted only when durable state proves
  the delete phase started and fresh recovery/source evidence matches the exact
  approved set.

If the previous execute approval expired, show Gili the unchanged execute plan
digest again, run `authorize-execute` for that same plan, and resume with the
new execute-approval digest. Do not edit state files or reuse a restore
approval.

## 7. Emergency recovery: `restore`

Restore is never automatic. Use it only after Gili explicitly approves the
exact restore plan digest.

1. Keep writers blocked.
2. Show the sanitized restore plan and exact digest.
3. Run `authorize-restore` with that digest.
4. Run `restore` with the returned restore-approval digest.
5. The runner restores and verifies the exact storage objects first.
6. It restores the approved database archive only when the exact baseline is
   not already present. On the exact verified connection, one transaction
   replaces `public`, removes the cutover migration ledger, and restores the
   verified archive, including its object ownership and privileges. Any error
   rolls that database transaction back.
7. A parent lease and child restore lease prevent an interrupted restore from
   overlapping another runner.
8. It verifies the restored database baseline and restored storage set.

Expected final phase: `restore_verified`.

The execute approval cannot authorize restore, and the restore approval cannot
authorize execute.

## 8. Hard safety stops

Stop and do not bypass the tool if any of these occurs:

- target or forbidden-target fingerprint mismatch;
- schema, migration ledger, release commit, migration file, or digest drift;
- any migration outside the fixed 0027–0034 list;
- missing, extra, duplicate, changed, or shared reset storage object;
- reset, preserved, identity, payment, or provider evidence mismatch;
- any real user, live charge, external payment, live terminal, or live schedule
  signal;
- missing writer block or a writer probe that succeeds;
- missing, changed, or invalid database/storage restore material;
- expired, replayed, wrong-action, wrong-plan, or already consumed approval;
- private file ownership, symlink, path-overlap, revision-chain, or concurrent
  runner failure;
- database state other than exact baseline or exact approved post-state;
- rollback, restore, or final verification failure; or
- any error that exposes only a safe code without enough evidence to prove the
  requested action.

Preserve the private state and sanitized error code. Do not delete files, start
a new run, switch targets, or try another migration tool. Review the exact
failed gate before requesting a new approval.

## 9. Completion record

Record only sanitized evidence:

- issue and release commit;
- final phase and state digest;
- manifest, plan, approval, migration bundle, database receipt, storage
  receipt, and restore-point digests;
- reset row and storage object counts;
- verification result; and
- whether writers remained blocked until verification completed.

Never record database URLs, credentials, raw project or branch identifiers,
row IDs, personal data, bucket names, object keys, provider values, or private
bundle contents.
