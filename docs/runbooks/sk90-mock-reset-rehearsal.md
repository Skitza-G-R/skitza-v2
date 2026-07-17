# SK-90 isolated mock-reset rehearsal

- **Issue:** SK-90
- **Scope:** Repository-only safety foundation for an isolated non-production rehearsal
- **Status:** No external database or storage adapter; no rehearsal or reset executed

This runbook turns the requirements in
`docs/runbooks/canonical-database-gate.md` into testable, pure TypeScript
contracts. It does not authorize or implement a production connection,
canonical-source snapshot, migration, database reset, object deletion,
deployment, or promotion.

The contracts live in
`apps/web/src/server/operations/sk90-reset/`. They perform no network,
database, storage, filesystem, or process-environment access. A future
rehearsal adapter must independently collect evidence and pass it into these
contracts before it can mutate an approved isolated target.

## 1. Dedicated environment boundary

A future adapter may read only these exact private names:

- `SK90_REHEARSAL_TARGET_DATABASE_URL`
- `SK90_REHEARSAL_TARGET_DATABASE_FINGERPRINT`
- `SK90_REHEARSAL_TARGET_STORAGE_FINGERPRINT`
- `SK90_REHEARSAL_TARGET_STORAGE_NAMESPACE`
- `SK90_REHEARSAL_MANIFEST_HMAC_KEY`
- `SK90_REHEARSAL_APPROVAL_POLICY_DIGEST`

`readRehearsalEnvironment()` accepts an injected environment map and never
reads `process.env` itself. It hard-stops if a generic database or R2 variable
is present. In particular, it never falls back to `DATABASE_URL`,
`DATABASE_URL_NEON`, `POSTGRES_URL`, the application R2 credentials, or the
application bucket defaults.

The storage namespace must have the form
`sk90-rehearsal/<approved-private-name>`. Configuration values and URLs are
never included in error reports.

## 2. Target fingerprint gate

An external, read-only discovery step must supply independently observed
database-project/branch and storage account/bucket/namespace fingerprints.
The pure target gate requires all of the following:

1. The target classification is exactly `isolated_nonproduction`.
2. The observed database fingerprint exactly matches the separately approved
   fingerprint and does not match either of the two distinct forbidden audited
   project digests. Omitting or duplicating either forbidden digest is a stop.
3. The observed storage fingerprint exactly matches the separately approved
   fingerprint and does not match at least one forbidden live namespace digest.
4. Fresh database and storage restore points are already ready.
5. The isolated storage namespace and writer are exclusive.

The module cannot convert an operator-supplied label into proof. Failure to
independently discover any input is a hard stop for a future adapter.
`assertRehearsalTarget()` also recomputes the complete policy digest, including
the forbidden sets and isolation evidence, and requires it to equal the
`SK90_REHEARSAL_APPROVAL_POLICY_DIGEST` parsed by the adapter.

## 3. Deterministic private manifest

`buildSanitizedManifest()` receives the reviewed row inventory and normalized
storage references in memory. It emits only:

- HMAC-SHA-256 row-ID, row-content, and object-key tokens;
- SHA-256 schema, policy, preserved-data, and object-content fingerprints;
- stable table/category labels;
- aggregate reset/preserved counts; and
- a SHA-256 digest of canonical, key-sorted JSON.

The manifest accepts only the exact SK-80 reset inventory: 102 rows across the
ten non-empty reset tables, plus explicit zero counts for `stripe_customers`
and `store_purchase_intents`. Each approved table/category count is embedded
in the signed body. A missing row, extra row, preserved-table row, renamed
category, or non-zero legacy-residue count is a hard stop.

Input order does not change the manifest or digest. Raw record IDs, personal
data, object keys, URLs, and the HMAC key are absent. Duplicate row identities,
invalid fingerprints, missing objects, unverified ownership, content drift,
or an object shared by reset and preserved rows hard-stop manifest creation.
The signed body also binds independently reviewed storage-reference coverage:
exactly 7 distinct reset-owned references, plus the exact positive count and
sorted-token fingerprint discovered across preserved rows. Missing, duplicate,
extra, or substituted reset or preserved references stop before a deletion plan
can be produced.

The signed manifest now carries the complete protected storage-reference set
and manifest-derived fingerprints for the exact reset rows, full reset and
preserved storage-reference enumeration, reset-only objects, preserved object
content, and preserved row counts. `prepareResetRun()` requires those exact
fingerprints to match both the reviewed baseline and independently collected,
challenge-bound discovery. A substituted reset row or a discovery that reveals
an omitted preserved reference—including a preserved reference to an apparent
reset object—hard-stops preparation.

The HMAC key is private rehearsal material. Do not commit it or any raw
inventory. Keep all future resumable raw-ID/key envelopes outside the
repository with restrictive permissions. Only sanitized aggregates and
digests may be attached to an issue or PR.

`prepareResetRun()` composes the approved target fingerprints and policy,
manifest, exact mock-evidence and storage coverage, reviewed baseline, and
challenge-bound target, reset-row, mock-evidence, and storage-enumeration
digests into one versioned artifact. Its initial phase journal binds both the
artifact and manifest digests. The final locked snapshot must match that same
artifact baseline before mutation can begin.

## 4. Identity and payment stop checks

Every linked identity must be HMAC-bound, freshly attested, and classified
`approved_test`. Every paid or confirmed monetary row must be classified
`approved_mock_test`. Every provider reference must be attested test-mode
evidence with all of these false:

- charge enabled;
- external charge; and
- live schedule.

Real, live, unknown, or unattested evidence stops. A non-null provider value is
never permission to continue. The approval result exposes counts only.
The reviewed manifest binds sorted-token fingerprints for the exact audited
coverage: 4 linked identities, 3 paid/confirmed monetary rows, and 7 provider
references. Empty, missing, duplicate, extra, or substituted classification
evidence fails before its test/live classification is considered. The final
locked snapshot binds this coverage through the manifest digest.
Preparation receives the full classified evidence and calls
`assertMockOnlyEvidence()` itself. It also derives the observation digest from
every protected token, classification, attestation, provider mode, and payment
safety flag. Supplying aggregate counts in place of the classified evidence is
not accepted.

## 5. Final transaction and drift contract

Immediately before database mutation, a future adapter must open one
serializable transaction, acquire the versioned advisory lock, and lock all 20
confirmed pre-reset public tables in `SHARE ROW EXCLUSIVE` mode. The list is
exported as `REQUIRED_PRE_RESET_TABLES` and includes preserved tables plus the
zero-row live-only legacy residue.

While those locks are held, recompute and exactly compare:

- manifest digest;
- pre-reset schema fingerprint;
- reset-row identity/content fingerprint;
- preserved-row-count fingerprint;
- preserved-business-column fingerprint; and
- normalized storage-reference fingerprint.

`assertFinalLockedSnapshot()` refuses an incomplete/duplicate lock set, the
wrong isolation or lock mode, a check taken after mutation began, or any
fingerprint drift. Storage deletion must not begin inside or before this gate.

This module deliberately does not contain SQL. Any future executor must target
each approved category explicitly, break the booking/project cycle explicitly,
compare every `RETURNING` identity set with the manifest, and avoid using
cascades as its inventory.

## 6. Quarantine proof before database reset

Before the database reset can begin, the adapter must copy every exact
reset-exclusive object into the isolated restore area and collect protected
evidence for each source/copy pair. `assertQuarantineProof()` requires:

- exactly the artifact-bound reset-exclusive source set and count;
- one unique, separate copy for every source object;
- matching full-content fingerprints for source and copy; and
- affirmative copy-exists and restore-verification evidence.

Missing, extra, duplicate, shared, content-drifted, or unrestorable copies stop.
Entering `objects_quarantined` records the verified stable copy-set fingerprint
in the phase journal. Each subsequent phase requires newly observed quarantine
evidence bound to that phase's current target challenge, while the exact source
and copy set must still match the journaled fingerprint. Both
`resolveNextAction()` and `advancePhase()` revalidate the artifact-bound proof
before allowing `reset_database`/`database_committed`. Fresh target
authorization by itself is not quarantine proof, and an older proof cannot be
replayed under a new challenge.

## 7. Post-reset integrity contract

The artifact contains exact post-reset expectations derived from the reviewed
manifest. `assertPostResetIntegrityProof()` requires one digest-bound proof of:

- the exact before/deleted reset-row identity and content set, with no reset
  rows remaining;
- unchanged preserved row counts and preserved business-column fingerprint;
- the reviewed target schema fingerprint;
- zero foreign-key, orphan, and producer/purchase ownership violations;
- zero prohibited legacy commercial rows and zero synthetic purchases;
- the exact reset-only object set deleted; and
- the exact preserved object count and full preserved-content fingerprint.

`advancePhase()` cannot enter `verified`, and `resolveNextAction()` cannot
return the verified-run `noop`, without revalidating this proof against the
same artifact. Counts alone cannot prove row or object identity.

## 8. Fresh target, restart, and idempotency contract

The versioned phase journal is:

1. `manifest_built`
2. `objects_quarantined`
3. `database_committed`
4. `storage_deleting`
5. `storage_deleted`
6. `verified`

The journal binds artifact, manifest, and verified quarantine copy-set fingerprints.
Only adjacent forward transitions are valid. `resolveNextAction()` resumes only
when the journal and
independently observed pre/post state agree exactly:

- database committed + storage pre-state resumes object deletion;
- storage deleted + exact post-state proceeds to verification; and
- verified + exact post-state is a no-op on the second run.

Mixed database or storage state requires restore. Missing, mismatched,
backwards, or skipped state fails closed.

Every external phase—quarantine, database reset, storage deletion,
verification/no-op resume, and restore—requires a newly challenge-bound target
authorization. The adapter must independently re-observe the database and
storage fingerprints immediately before that phase and pass the current
challenge and current target-observation digest separately. A forbidden or
mismatched fresh observation stops. Replaying an older authorization for the
same action against a new current challenge also stops.
The future adapter must call `authorizeFreshTargetAction()` and
`assertFreshTargetGate()` immediately before invoking the external operation;
phase advancement after an operation is not a substitute for this pre-action
gate.

## 9. Required rollback exercises

Exercise all three interruption points from the canonical gate:

1. before database commit;
2. after database commit but before object deletion; and
3. after partial object deletion.

At every point, restore both the isolated database and storage namespace from
their pre-reset restore points. `assertRollbackProof()` binds both the before
and restored structures to the exact approved artifact and manifest. It
requires the exact pre-reset schema; reset-row identity/content set and count;
preserved row-count and business fingerprints; full storage-reference
fingerprint; and reset/preserved object counts and content fingerprints. Two
wrong but internally equal snapshots are rejected. Counts or ETags alone are
insufficient.
The restore proof is accepted only with a fresh `restore` target authorization;
a previous reset/delete authorization cannot be reused.

## 10. Safe error evidence

`toSafeErrorReport()` maps known failures to stable codes and generic messages.
Unknown database, provider, filesystem, or SDK exception text is discarded.
Future adapters must not log raw errors, queries, URLs, identifiers, personal
data, bucket names, object keys, or provider responses.

## 11. Repository verification

The focused pure-contract suite is:

```sh
corepack pnpm --filter web test -- src/server/operations/sk90-reset/index.test.ts
```

It covers dedicated environment names, exact forbidden sets and policy-digest
binding, forbidden/mismatched fingerprints, the exact reset allowlist/counts,
restore-point and isolation requirements, deterministic sanitized manifests,
identity/payment/provider stops, shared preserved objects, quarantine-copy
proof, lock/drift checks, phase idempotency, artifact-bound rollback at all
interruption points, and error redaction.

The focused suite currently contains 47 contracts. These tests are not a
database or R2 rehearsal. Until approved isolated
resources, independently observed private fingerprints, identity/provider
evidence, and actual database-plus-storage restore adapters exist, SK-90 reset
rehearsal evidence must be reported as **PARTIAL — repository contracts only**.
