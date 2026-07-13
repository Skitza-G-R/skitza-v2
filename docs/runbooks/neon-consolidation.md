# Neon consolidation

This runbook rehearses SK-80 and defines a separate guarded production path.
The rehearsal modes never write to either production branch. The production
apply mode exists only for one freshly planned, exactly approved run. No mode
deletes a Neon project, creates or deletes a branch, freezes an application
writer, migrates production, restores a branch, or changes deployment settings.

The verified database roles for this work are:

- Source: the old `skitza` project (`quiet-sun-92221754`). It is read-only for
  every consolidation mode.
- Canonical live database: `skitza-v3` (`raspy-pine-96654399`). The current
  application data and settings already live here.
- Rehearsal target: a new, unprotected child branch of the canonical
  `skitza-v3` default branch. Its name must start with `sk-80-rehearsal-`.

Never point the rehearsal target variable at the canonical default branch.
Production uses different, explicitly named environment variables and guards.

## Required environment

Load these values without printing them or placing them in shell history:

| Variable                                        | Required value                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `SKITZA_CONSOLIDATION_SOURCE_DATABASE_URL`      | Connection URL for the old `skitza` source database.                                            |
| `SKITZA_CONSOLIDATION_TARGET_DATABASE_URL`      | Connection URL for the `skitza-v3` rehearsal branch, never its default branch.                  |
| `SKITZA_CONSOLIDATION_SOURCE_PROJECT_ID`        | `quiet-sun-92221754`.                                                                           |
| `SKITZA_CONSOLIDATION_SOURCE_BRANCH_ID`         | The verified default-branch ID of the old source.                                               |
| `SKITZA_CONSOLIDATION_TARGET_PROJECT_ID`        | `raspy-pine-96654399`.                                                                          |
| `SKITZA_CONSOLIDATION_TARGET_BRANCH_ID`         | The `br-...` ID of the rehearsal branch.                                                        |
| `SKITZA_CONSOLIDATION_SNAPSHOT_TIMESTAMP`       | One fixed ISO-8601 UTC timestamp, such as `YYYY-MM-DDTHH:mm:ss.sssZ`, shared by all four modes. |
| `SKITZA_CONSOLIDATION_APPROVED_MANIFEST_DIGEST` | Required only for `rehearse`; copy the reviewed 64-character digest from `plan`.                |
| `SKITZA_CONSOLIDATION_EXPECTED_SOURCE_DIGEST`   | Required only for `verify`; copy `sourceFingerprint.digest` from the approved plan.             |
| `SKITZA_CONSOLIDATION_EXPECTED_TARGET_DIGEST`   | Required only for `verify`; copy `verification.targetFingerprintAfter.digest` from rehearsal.   |

Set a metadata source:

- `NEON_API_KEY`: required for `prepare-rehearsal` and `rehearse`. The tool
  fetches current source and target project, default-branch, branch, and
  endpoint metadata immediately before each write operation; or
- `SKITZA_CONSOLIDATION_NEON_METADATA_FILE`: an absolute path to a saved JSON
  response containing separate `source` and `target` project, branch, and
  endpoint metadata. Saved metadata is accepted only for read-only `plan` and
  `verify`; it can never authorize a write. The file must not contain a
  connection URL, password, or API key.

The tool refuses to continue when the source and target resolve to the same
database. Before any target write, it also confirms that the target project
and branch IDs match, the branch is a direct child of the current canonical
default branch, it is not default or protected, its name starts with
`sk-80-rehearsal-`, the database is `neondb`, and the URL host belongs to that
branch's read-write endpoint. The source project, branch, database, and endpoint
are verified too.

## Fixed merge rules

These rules are part of the SK-80 manifest. Changing one requires a new plan
and a new manifest digest.

- The current-schema tables are copied row by row. IDs are preserved unless
  an existing canonical identity must be reused.
- When both databases contain the same Clerk producer, the existing
  `skitza-v3` producer ID wins. The source-owned rows are remapped to that ID.
  The canonical producer settings and availability schedule also win; old
  settings, blocks, and blackouts do not overwrite or extend that schedule.
- A source product with the same normalized name as an existing canonical
  product is still preserved as a separate product, but it is imported
  archived. The fixed snapshot timestamp is used for `archived_at`. The live
  product is never overwritten.
- Contact rows are never automatically deduplicated. A matching email/hash is
  accepted only when the same UUID and every projected field are already
  byte-equivalent (the idempotent rerun case); every other identity collision
  stops for a human decision.
- Legacy booking status `pending` becomes `pending_approval`. Current booking
  statuses pass through. Any other unsupported booking status stops the plan.
- Current project stages pass through. Every legacy stage, including
  `payment_paused`, `cancelled`, and `contract_sent`, stops the plan for a human
  decision. The audited source currently contains only `lead` and `paid`.
- UUID collisions, unique-key collisions, unsupported enum values, missing
  parents, and target drift are hard stops. The importer never hides these
  with `ON CONFLICT DO NOTHING`.
- Removed systems are not reintroduced. `contracts`, `contract_events`,
  `contract_fields`, `contract_recipients`, `magic_links`, `magic_link_views`,
  `waitlist`, `leads`, `packages`, and `store_purchase_intents` remain only in
  the untouched old source. Their aggregate counts appear in the manifest so
  their exclusion is visible.
- The retired `projects.share_token_hash` and `track_versions.status` columns
  are intentionally excluded. The source has eight old share-token hashes,
  which must not revive the removed share-token system. All five old track
  versions have status `draft`; the one approved version is already preserved
  by the current `approved_at` field.

The generated manifest contains counts, transform counts, source/target schema
and row fingerprints, a transformed-action fingerprint, branch identities,
decisions, and opaque row references. It must not contain database URLs,
credentials, email addresses, names, free text, or storage URLs.

Production uses a stronger complete fingerprint. It binds every public base
table and the SHA-256 digest of every one of its rows; full column definitions
(including type, default, and nullability); enums; constraints; indexes; views
and materialized-view definitions and data; sequence definitions and current
state; triggers; row-security policies; and public routines. This is what makes
the source snapshot and target restore point complete backups for this run,
instead of relying on counts or only the tables copied by the importer.

## Rehearsal sequence

Use the same environment and snapshot timestamp for every step.

1. Prepare only the guarded rehearsal branch:

   ```sh
   pnpm --filter @skitza/db db:consolidate -- prepare-rehearsal
   ```

   This requires live Neon API metadata and applies the repository's existing
   migrations only to the verified child branch. It refuses default, root,
   protected, stale-parent, wrong-project, wrong-database, and wrong-endpoint
   targets. SK-79's booking-status repair must be in the checked-out base before
   a newly created rehearsal branch can pass the enum preflight.

2. Run the read-only plan after schema preparation:

   ```sh
   pnpm --filter @skitza/db db:consolidate -- plan
   ```

   Review every table count, transform count, excluded legacy-table count,
   conflict, and the final manifest digest. Do not continue while the manifest
   says it is blocked.

3. Run the rehearsal import:

   ```sh
   pnpm --filter @skitza/db db:consolidate -- rehearse
   ```

   The tool rebuilds and checks the plan, verifies the approved manifest digest
   and pre-import target digest, then performs the import in one serializable
   transaction. JSON/JSONB values are serialized explicitly, native PostgreSQL
   arrays remain arrays, and every row/count/FK/unique/semantic/idempotency check
   runs before commit. Any mismatch or failed check rolls the whole import back.

4. Run read-only verification:

   ```sh
   pnpm --filter @skitza/db db:consolidate -- verify
   ```

   Set the expected source and post-rehearsal target digests first. Verification
   must confirm expected per-table counts and digests, zero
   foreign-key orphans, zero duplicate unique keys, the expected producer ID
   mappings, the canonical schedule rule, archived same-name source products,
   and zero imported rows from removed systems. Running the plan again against
   the rehearsed branch must propose zero additional inserts or updates.

Keep the old project and the rehearsal branch after verification so they remain
available for comparison and rollback. Deleting either one is a separate action
that needs explicit approval.

## Production gate

A successful rehearsal is evidence, not permission to write production.
Gili's decision that `skitza-v3` is canonical authorizes the direction of the
work; it does **not** authorize an unknown future write. `apply-production`
requires a second, exact approval after `plan-production` produces a fresh
manifest. That approval must name the canonical project and default branch,
the run ID, snapshot timestamp, and complete 64-character production digest.

Because this organization is on Neon's Free plan, production also has a
manual, provider-independent backup gate. Use the installed PostgreSQL client
tools and `age` before `plan-production` to create encrypted custom-format
`pg_dump` archives of both the frozen source snapshot and the restored target
snapshot preview. Use only unpooled URLs. For each archive:

1. run `pg_restore --list` successfully;
2. restore it with `--single-transaction --exit-on-error` into a genuinely
   empty disposable database;
3. compare the restored schema/data fingerprint with the frozen original;
4. encrypt the archive with `age`, verify decryption, record SHA-256 and byte
   size, remove the plaintext copy, and keep the encrypted file mode `0600`.

Record the archive hashes, tool versions, restore destinations, and matching
fingerprints in the SK-80 run evidence. Do not run `apply-production` without
both successful restore tests. The branch, manual snapshot, and encrypted
archives are independent recovery layers; Neon's short Free-plan time-travel
window is only an emergency extra.

### Production-only environment

Production modes require two different temporary Neon API keys and never
accept saved API metadata. Scope one key to the old source project and the
other to the canonical target project. Revoke both immediately after the run.
Load all secrets without printing them or placing them in shell history.

| Variable                                                               | Required value                                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `SKITZA_CONSOLIDATION_SOURCE_PROJECT_ID`                               | `quiet-sun-92221754`.                                                 |
| `SKITZA_CONSOLIDATION_TARGET_PROJECT_ID`                               | `raspy-pine-96654399`.                                                |
| `SKITZA_CONSOLIDATION_PRODUCTION_SOURCE_NEON_API_KEY`                  | Temporary key scoped to the old source project.                       |
| `SKITZA_CONSOLIDATION_PRODUCTION_TARGET_NEON_API_KEY`                  | Different temporary key scoped to the canonical target project.       |
| `SKITZA_CONSOLIDATION_PRODUCTION_SOURCE_ORIGIN_DATABASE_URL`           | Old project's exact current default database.                         |
| `SKITZA_CONSOLIDATION_PRODUCTION_SOURCE_ORIGIN_BRANCH_ID`              | Old project's exact current default branch ID.                        |
| `SKITZA_CONSOLIDATION_PRODUCTION_SOURCE_SNAPSHOT_DATABASE_URL`         | Fresh source-snapshot child database.                                 |
| `SKITZA_CONSOLIDATION_PRODUCTION_SOURCE_SNAPSHOT_BRANCH_ID`            | Fresh direct child named `sk-80-source-snapshot-...`.                 |
| `SKITZA_CONSOLIDATION_PRODUCTION_TARGET_DATABASE_URL`                  | Canonical project's exact current default database.                   |
| `SKITZA_CONSOLIDATION_PRODUCTION_TARGET_BRANCH_ID`                     | Canonical project's exact current default branch ID.                  |
| `SKITZA_CONSOLIDATION_PRODUCTION_TARGET_RESTORE_DATABASE_URL`          | Fresh pre-write restore-point child database.                         |
| `SKITZA_CONSOLIDATION_PRODUCTION_TARGET_RESTORE_BRANCH_ID`             | Fresh direct child named `sk-80-target-restore-...`.                  |
| `SKITZA_CONSOLIDATION_PRODUCTION_TARGET_SNAPSHOT_ID`                   | The run's only manual snapshot in the canonical project.              |
| `SKITZA_CONSOLIDATION_PRODUCTION_TARGET_SNAPSHOT_PREVIEW_DATABASE_URL` | Database restored from that snapshot with `finalize_restore:false`.   |
| `SKITZA_CONSOLIDATION_PRODUCTION_TARGET_SNAPSHOT_PREVIEW_BRANCH_ID`    | Exact `sk-80-target-snapshot-preview-<run-id>` preview branch.        |
| `SKITZA_CONSOLIDATION_PRODUCTION_RUN_ID`                               | A unique 8-81 character ID for this attempt.                          |
| `SKITZA_CONSOLIDATION_SNAPSHOT_TIMESTAMP`                              | Fresh UTC time after the freeze and both child branches were created. |
| `SKITZA_CONSOLIDATION_FREEZE_ATTESTATION_FILE`                         | Path to the small JSON freeze attestation described below.            |
| `SKITZA_CONSOLIDATION_APPROVED_PRODUCTION_MANIFEST_DIGEST`             | Exact reviewed production digest; apply and verify only.              |
| `SKITZA_CONSOLIDATION_PRODUCTION_CONFIRMATION`                         | Exact typed confirmation; apply only.                                 |
| `SKITZA_CONSOLIDATION_EXPECTED_PRODUCTION_TARGET_DIGEST`               | `targetFingerprintAfter` from the apply receipt; verify only.         |

The freeze-attestation file must be regular JSON, not a symlink, and contain
no credentials. Its exact bytes and modification time are bound into the
production manifest. Use this structure, with the real run ID and UTC time:

```json
{
  "issue": "SK-80",
  "runId": "sk80-prod-YYYYMMDD-attempt-a",
  "attestedAt": "YYYY-MM-DDTHH:mm:ss.sssZ",
  "attestedBy": "Gili",
  "writersFrozen": true,
  "writers": [
    "background_workers",
    "clerk_webhooks",
    "manual_database_changes",
    "payment_webhooks",
    "scheduled_jobs",
    "web_mutations"
  ]
}
```

### Production sequence

1. Confirm SK-79's schema repair is in the checked-out base. Do not run a
   production migration as part of consolidation.
2. Manually freeze all six writer classes listed in the attestation and wait
   for in-flight writes to finish. This tool does not perform the freeze.
3. Manually create two fresh Neon branches after the freeze, with names that
   end in the exact run ID:
   - a direct child of the old project's current default named
     `sk-80-source-snapshot-<run-id>`;
   - a direct child of the canonical current default named
     `sk-80-target-restore-<run-id>`.
     Do not set `expires_at` or a TTL on either branch. The live metadata guard
     rejects any safety branch that Neon reports as scheduled for automatic
     deletion or not fully ready.
4. Confirm that the canonical project has no existing manual snapshot. Free
   projects have one snapshot slot. If that slot is occupied, stop: deleting
   or replacing it requires Gili's separate approval.
5. Create one non-expiring manual snapshot of the frozen canonical default
   named `sk-80-target-manual-snapshot-<run-id>`. Restore it with
   `finalize_restore:false`, `target_branch_id` set to the exact canonical
   default branch, and the exact preview name
   `sk-80-target-snapshot-preview-<run-id>`. Never finalize this preview as
   part of SK-80. Snapshot creation and restore are non-idempotent API calls;
   after a timeout, inspect live snapshots, branches, and operations instead
   of retrying blindly.
6. Poll every returned Neon operation to a successful terminal state. The
   preview must report `current_state=ready`, `restore_status=restored`, the
   exact snapshot in `restored_from`, and the canonical default in
   `restored_as`. Create an enabled endpoint and obtain its unpooled `neondb`
   URL. Do not set an expiry or TTL.
7. Set the fixed snapshot time only after both safety branches, the manual
   snapshot, and its preview are ready. Every artifact must have been created
   after the attested freeze and within 30 minutes of that time.
8. Run the read-only production plan:

   ```sh
   pnpm --filter @skitza/db db:consolidate -- plan-production
   ```

   It fetches live Neon metadata and refuses any wrong project, default,
   parent, endpoint, database, exact run-bound name, expiring artifact, API-key
   scope, snapshot identity, restore state, or stale artifact. It compares a
   complete public schema/data fingerprint for old origin versus source
   snapshot, canonical default versus restore point, and canonical default
   versus the independently restored manual-snapshot preview. All three pairs
   must be identical. The distinct production manifest binds those five fingerprints,
   the transformed source/action/target fingerprints, all branch/project IDs,
   the run ID, snapshot time, and freeze-attestation digest/time. It also binds
   SHA-256 hashes of the exact `consolidate-neon.mjs`, `packages/db/package.json`,
   and this runbook. Editing any of those files after planning requires a new
   production plan, review, digest, and typed approval.

9. Review the complete plan and blockers. Gili must then approve that exact
   digest and run. Set the approved digest and this exact confirmation string:

   ```text
   APPLY SK-80 TO <target-project-id>/<target-default-branch-id> RUN <run-id> SNAPSHOT <snapshot-timestamp> DIGEST <64-character-digest>
   ```

   `yes`, a project-only decision, a prior rehearsal digest, or a confirmation
   with any changed character is rejected.

10. Run the guarded apply:

```sh
pnpm --filter @skitza/db db:consolidate -- apply-production
```

Apply fetches live metadata twice, rechecks the exact production digest and
confirmation, holds the source snapshot in a repeatable-read read-only
transaction, and opens one serializable target transaction. It takes an
advisory lock, short lock/statement timeouts, and `SHARE ROW EXCLUSIVE`
locks on every public base table included in the complete target fingerprint
before rebuilding the plan. Immediately before COMMIT, it opens a new
read-only connection to the live old-project origin, rebuilds its complete
fingerprint outside the earlier snapshot, and aborts if it differs from the
exactly approved source fingerprint.

Inserts, constraints, idempotency, row/count/FK/unique/semantic checks, and
the post-target fingerprint all run before commit. A failure before the
COMMIT attempt rolls back. A successful result contains separate
`approvedManifestDigest` and `resultReceiptDigest` values.

If the network connection is lost while COMMIT is being acknowledged, the
database outcome is unknown: the server may have committed even though the
command reported an error. The tool will not retry and will not issue or
claim a rollback. Keep every writer frozen, do **not** run
`apply-production` again, and use the safe expected-target digest printed in
the error to run `verify-production`. If verification does not prove the
approved final state, preserve all branches and escalate for a separate
recovery decision.

11. Keep every writer frozen. Set the expected production target digest to the
    receipt's `targetFingerprintAfter`, then run read-only verification:

```sh
pnpm --filter @skitza/db db:consolidate -- verify-production
```

Verification requires live Neon metadata, rebuilds the approved reference
plan from the unchanged source snapshot and restore point, confirms the
expected post-target fingerprint, reruns full verification, and requires an
idempotent plan with zero proposed inserts. Unfreeze writers only after this
succeeds and the application is checked against the canonical database.

Keep the old project, source snapshot, target restore point, manual snapshot,
and restored snapshot preview after success. Deleting any of them is a
separate destructive decision.

If apply or verification fails, stop all further writes and preserve evidence.
Restoring or finalizing through the Neon restore API is **not** automatic: that
rollback must be separately reviewed, rehearsed on a disposable branch, and
explicitly approved by Gili for the exact restore operation. Preserve the
manual snapshot and preview when a failure occurs. Leave the old `skitza`
source untouched throughout.
