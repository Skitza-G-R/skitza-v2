# SK-90 isolated mock-reset rehearsal

- **Issue:** SK-90
- **Scope:** The approved purchase-foundation reset on one dedicated, isolated non-production database and storage namespace
- **Implementation status:** Executable adapter and fail-closed contracts implemented in the repository
- **External evidence status:** **COMPLETE — the isolated disposable database-and-storage rehearsal passed on 2026-07-19**
- **Sanitized result:** phase `verified`, revision 81; all three rollback points, storage restore, and the second no-op passed; 306 database-row, 56 storage-copy, and 36 storage-delete mutations were recorded. The 0027 safety gate passed without bypass, then 0027/0028 applied and reran as no-ops. SK-95 real-database tests passed 7/7 and the authenticated Store create/edit/delete/archive checks passed at desktop, 390px, and 360px with no browser console errors.

This runbook applies the gate in
`docs/runbooks/canonical-database-gate.md`. Repository tests prove the adapter's
local safety and orchestration behavior. They do not count as the required real
isolated rehearsal.

## 1. Hard boundary

The command may target only a newly approved, dedicated, isolated
non-production database and dedicated R2 buckets/namespace.

It must never:

- connect to, snapshot, branch, query, or mutate production;
- connect to or mutate the frozen old project;
- use application or generic database/R2 environment variables;
- create a source snapshot or branch unless Gili separately approves that
  exact source action;
- infer legacy Completed/Canceled states, create purchases, or migrate old
  commercial history;
- print URLs, credentials, raw database identifiers, row IDs, personal data,
  bucket names, object keys, or provider values; or
- deploy, promote, repoint, merge, or change a payment terminal.

Any external invocation needs Gili's separate approval. `prepare-backup` needs
approval for that exact isolated target. `plan`, `execute`, `resume`, and
`restore` additionally need the later, exact execution digest.

## 2. Dedicated inputs

Run from a clean shell containing only these SK-90 names:

- `SK90_REHEARSAL_TARGET_DATABASE_URL`
- `SK90_REHEARSAL_TARGET_DATABASE_FINGERPRINT`
- `SK90_REHEARSAL_TARGET_STORAGE_FINGERPRINT`
- `SK90_REHEARSAL_TARGET_STORAGE_NAMESPACE`
- `SK90_REHEARSAL_MANIFEST_HMAC_KEY`
- `SK90_REHEARSAL_APPROVAL_POLICY_DIGEST`
- `SK90_REHEARSAL_STORAGE_ENDPOINT`
- `SK90_REHEARSAL_STORAGE_ACCESS_KEY_ID`
- `SK90_REHEARSAL_STORAGE_SECRET_ACCESS_KEY`
- `SK90_REHEARSAL_STORAGE_AUDIO_BUCKET`
- `SK90_REHEARSAL_STORAGE_DOCS_BUCKET`
- `SK90_REHEARSAL_STORAGE_DATA_PREFIX`
- `SK90_REHEARSAL_STORAGE_RECOVERY_PREFIX`
- `SK90_REHEARSAL_PRIVATE_APPROVAL_FILE`
- `SK90_REHEARSAL_PRIVATE_APPROVAL_LEDGER_DIRECTORY`
- `SK90_REHEARSAL_PRIVATE_STATE_DIRECTORY`
- `SK90_REHEARSAL_PG_DUMP_BINARY`
- `SK90_REHEARSAL_PG_RESTORE_BINARY`
- `SK90_REHEARSAL_OPERATOR_CONFIRMATION`
- `SK90_REHEARSAL_APPROVED_EXECUTION_DIGEST`

`SK90_REHEARSAL_APPROVED_EXECUTION_DIGEST` must be absent for
`prepare-backup`. It is required for every later mode.

The namespace must match `sk90-rehearsal/<approved-private-name>`. The data and
recovery prefixes must be exactly `<namespace>/data/` and
`<namespace>/recovery/`. The endpoint must be the dedicated Cloudflare R2
endpoint, the two buckets must differ, and the PostgreSQL tool paths and
private paths must be absolute. The approval ledger must be a separate,
pre-created owner-only directory; neither the approval bundle nor the state
directory may be inside it.

`DATABASE_URL`, `DATABASE_URL_NEON`, `POSTGRES_URL*`, `PG*`, application R2
names, and generic `AWS_*` selectors are rejected if inherited. Multiple
generic database selectors are also rejected by the migration runner. The
initial 0027 cutover cannot be minted by the generic migration command; it
requires an in-memory approval created by the isolated adapter.

The operator confirmation is the fixed non-production phrase checked by the
adapter. Mutating and recovery modes also require the exact separately
approved execution digest. None of these values belongs in Git, Linear, a PR,
terminal output, or a command argument.

## 3. Private approval material

The approval file, approval-ledger directory, and state directory must be owned
by the current user and must not be readable or writable by group/other users.
Symbolic links are rejected. Durable writes use exclusive, atomic files and an
HMAC-bound revision chain so two runners cannot silently share or replace
state.

The private approval material binds one exact set of:

- versioned sanitized manifest and approved artifact;
- target database, storage, and policy fingerprints;
- exact 0027 file digest and reset-plan digest;
- the canonical fingerprint of the dedicated approval-ledger directory;
- 102 raw reset-row identities/content and their protected manifest tokens;
- all reset and preserved storage references;
- the exhaustive storage object set, byte lengths, full-content hashes, and
  metadata hashes;
- four approved test identities, three approved mock monetary rows, and seven
  exact test-mode provider references;
- pre/post storage namespace fingerprints;
- database and storage restore-point fingerprints;
- issued approval challenge, approval time, and expiry;
- the expected database name and a private marker stored only in
  `skitza_rehearsal.target_identity`; and
- one private target-attestation object for each bucket role, including its
  exact ETag, byte length, full-content hash, and the approved endpoint origin.

The two target-attestation objects use the adapter-derived
`sk90-target-attestation/<protected-namespace>/target-identity` location. They
sit outside the reset namespace, are never reset data, and must be provisioned
only on the newly approved isolated target. Their raw locations and contents
remain private.

Raw values remain only in this private material. Public receipts contain
protected tokens, counts, phases, and SHA-256 digests.

The preparation bundle contains only the artifact, manifest, target policy,
and target attestations. It must not contain a private execution envelope or
execution approval. After `prepare-backup` returns the sanitized restore-point
fingerprint, a new executable bundle must bind that exact prepared backup,
private envelope, execution approval, and approval-ledger fingerprint.

Manifest and artifact discriminators and versions must be the exact supported
versions and must match each other. A missing, extra, duplicate, substituted,
expired, or differently bound value stops before mutation.

## 4. Local-first command gate

The executable accepts exactly one mode: `prepare-backup`, `plan`, `execute`,
`resume`, or `restore`. Before constructing a network client it must:

1. parse the exact dedicated environment and reject ambient selectors;
2. validate private paths, target class, endpoint, buckets, and prefixes;
3. read owner-only private approval material; and
4. validate its exact mode-specific contract, versions, target fingerprints,
   and attestations.

`prepare-backup` rejects any execution digest or execution approval. The later
four modes additionally validate every HMAC binding, artifact/manifest/policy/
plan/migration digest, the first-use approval window, the exact approved
execution digest, and the prepared-backup fingerprint. They also verify the
canonical owner-only approval-ledger directory against its immutable
execution-approval fingerprint and bind the durable journal to those same
target, artifact, envelope, restore, and pre/post fingerprints.

Preparation validates the observer's exact `prepare` action, challenge,
issue/expiry times, and observation binding. Before backup I/O it exclusively
consumes that challenge into the fixed owner-only approval ledger. A completed
preparation cannot be replayed; an interrupted preparation may reconcile only
with a new fresh challenge against the same state and ledger.

The first accepted runner invocation exclusively consumes the execution
approval into an owner-only HMAC-bound sidecar in the dedicated fixed ledger
and must begin within five minutes of issuance. The sidecar location does not
depend on where the signed bundle file is stored. The same ledger and state
directory may later resume or restore that exact durable run; a copied bundle,
different ledger, another state directory, replayed approval, or changed
sidecar stops before clients are created.

The same fixed ledger also anchors the run instance and every published state
revision/digest. An empty recreated state store, substituted run marker, or
truncated revision chain stops. Only the exact one-revision publish-before-
anchor crash gap may be reconciled forward.

Invalid input produces only a stable safe error code. Unknown process, SDK,
database, or filesystem error text is discarded.

## 5. Fresh target and one-time proof gate

The adapter must independently re-observe the database and storage target
immediately before every external action. The observed fingerprints must equal
the artifact and dedicated environment, must not equal any forbidden audited
target, and must recompute the approved policy digest.

`prepare-backup` receives a new random challenge bound to its exact preparation
artifact, observed target, issue time, and expiry. Every later action receives
a new random challenge bound to:

- the exact action;
- artifact and manifest;
- database, storage, and policy target;
- execution, migration, plan, and private-envelope digests;
- restore points and pre/post namespace fingerprints; and
- an exact issue time and expiry of at most five minutes.

The challenge is durably recorded and consumed once before the action. A
replayed, stale, expired, substituted, or already consumed proof stops.
Current wall time is checked again after backup/archive work and lock waits,
immediately before each database or storage mutation. Lock waits are bounded
by the authorization window.

## 6. Exhaustive discovery and stop checks

The database discovery is taken under the approved serializable lock boundary.
It recomputes schema, exact reset-row content, preserved row counts, preserved
business fields, storage references, and identity/payment/provider evidence.

It must find exactly the SK-80 approved reset inventory: 102 rows across the
allowlisted tables, including explicit zero-row categories. It must also match
the exact seven legacy provider values: three producer Stripe account values
and four booking Tranzila confirmations. Those values must be freshly attested
test-mode with charge-enabled, external-charge, and live-schedule all false.
A different non-live value is still an exact-inventory failure.

Any pending audio-completion journal is an unresolved recovery reference and
stops the reset. It must be reconciled by the normal upload recovery path
before a new approval is built. Active multipart uploads also stop.

Audio cleanup publishes an exact durable object-identity intent before
conditional deletion. A retry reconciles that intent before multipart work;
an inactive purchase may use only the exact HEAD-observed cleanup path, never
replay multipart completion. Missing, ambiguous, or replaced objects stop.

The R2 adapter paginates the entire approved namespace, including data,
recovery, and restore-probe areas. It rejects unknown subpaths and extra,
missing, duplicate, or changing objects. Every data object is read completely
and matched by protected key, byte length, full-content SHA-256, and metadata
SHA-256 to the private envelope. Database reset/preserved references must
reconcile exactly with this exhaustive storage set. ETags or caller-supplied
reference lists alone are not inventory proof.

## 7. Backup, quarantine, and concurrent-write stop

`prepare-backup` first re-observes the approved isolated database and storage
target. Under the database locks it verifies the exact baseline, exports that
same PostgreSQL snapshot, and creates a private custom-format backup with the
approved absolute `pg_dump` binary. The database URL is passed only through
the child environment, never an argument or log. The completed backup is
owner-only and hashed. A later execution approval must bind that exact hash;
execution cannot create or substitute a backup.

Immediately before every database-changing phase, including resumed rollback
and the executable second run, the adapter re-reads the prepared backup,
checks its HMAC receipt and archive format, and recomputes the exact approved
fingerprint. Missing, changed, or invalid backup material stops before SQL.

Every reset-exclusive R2 object is conditionally copied to the artifact-bound
recovery prefix. The adapter reads each copy fully, compares bytes and metadata
with its source, performs a real restore probe, verifies the probe, and removes
the probe. Unexpected recovery/probe objects stop. No source object may be
deleted until every exact recovery copy is verified.

The database reset opens one `SERIALIZABLE` transaction, takes the migration
and SK-90 advisory locks, and locks every reset/preserved table in the fixed
order. A second connection attempts approved writer probes with a short lock
timeout; any probe that is not blocked stops the run. The adapter then
recomputes the reviewed baseline under those locks.

## 8. Exact reset and cutover

The transaction targets every approved raw row ID explicitly, breaks only the
reviewed legacy cycles, compares every returned deleted ID set, and verifies
that no allowlisted reset row remains. It stages the exact seven provider
attestations in the transaction before 0027 removes the deprecated provider
columns.

Migration 0027 then applies through the approved in-transaction runner. Its
SQL independently fails closed on:

- source schema or exact reset/provider inventory drift;
- live card/terminal state;
- malformed or unsupported product payment-plan JSON;
- missing/null plan kinds, unexpected object properties, and invalid monthly
  installment shape;
- any unexpected reset rows; and
- any migration digest or ledger conflict.

The row reset, schema cutover, migration ledger, and post-cutover verifier
commit atomically. Post checks require the exact approved target schema,
unchanged preserved counts/business data, zero reset or synthetic purchase
rows, validated foreign keys, zero orphans, and zero ownership violations.

Storage deletion uses the exact reset-exclusive protected set. Each source is
re-observed, its verified backup is re-observed, and deletion uses the current
ETag condition. Progress is journaled per object. A lost response is reconciled
by fresh listing/HEAD evidence; the adapter never guesses whether deletion
succeeded.

## 9. Crash recovery and rollback proof

The durable runner records started/completed boundaries for quarantine,
database reset, storage deletion, verification, restore, and second run. On
restart it observes actual database, data, recovery, and probe state before
choosing an action. A completed remote action is journaled with a fresh proof.
During the atomic database-reset phase, only the exact approved baseline or
exact approved post-reset state is accepted; a mixed database stops and is
never automatically overwritten. A positively identified partial storage
mutation uses the approved restore path instead of replaying blindly.

All three required interruption exercises run before final success:

1. before database commit;
2. after database commit and before storage deletion; and
3. after partial storage deletion.

At every point the runner first reconciles the exact observed database state;
mixed or unknown drift is never overwritten. It then force-replays the exact
private PostgreSQL backup and every exact verified R2 recovery copy, including
the before-commit exercise. Each R2 replay is conditional on both the verified
recovery-source ETag and current approved destination ETag. It then repeats
schema, row, preserved-data, foreign-key, orphan, ownership, object-byte, and
object-metadata checks. Proof compares the approved pre-reset evidence with the
fresh restored snapshot and requires durable receipts that `pg_restore` and
the exact number of R2 copies actually executed. The runner can durably enter
`restored` after a crash between remote restore and journal publication.

## 10. Real second-run idempotency

After the final post-reset proof, the runner performs a second executable
attempt under fresh locks and a new one-time challenge. It targets all original
row IDs again, runs the matching 0027 completed-target verifier and migration
ledger path again, and invokes the storage delete reconciliation path with the
original protected object set.

Success requires:

- zero database rows changed;
- zero persistent schema or ledger changes;
- zero storage copy, delete, or restore attempts;
- byte-for-byte identical post-reset fingerprints before and after; and
- a durable, fresh second-run receipt that cannot be reused.

Two observational snapshots without the executable attempt are not accepted
as idempotency proof.

## 11. Commands after separate external approval

Repository verification does not require an external target:

```sh
corepack pnpm --filter web test -- --run src/server/operations/sk90-reset
corepack pnpm --filter web test -- --run src/server/trpc/routers/audio.test.ts
corepack pnpm --filter @skitza/db test -- --run \
  src/__tests__/migration-runner.test.ts \
  src/__tests__/purchase-foundation.test.ts
```

Only after Gili approves the exact isolated target and preparation bundle, with
`SK90_REHEARSAL_APPROVED_EXECUTION_DIGEST` absent:

```sh
corepack pnpm --filter web sk90:reset prepare-backup
```

Stop and use only its sanitized backup fingerprint to create the executable
bundle and exact execution approval. Only after Gili separately approves that
bundle, execution digest, and run:

```sh
corepack pnpm --filter web sk90:reset plan
corepack pnpm --filter web sk90:reset execute
```

Use `resume` only to continue the same HMAC-bound durable run after a crash.
Use `restore` to force verified database-plus-storage restoration for that same
run. Do not start a new run by deleting or editing the state directory.

## 12. Exact external action plan and required approval

Before `prepare-backup`, provide Gili a sanitized request containing:

1. the proposed isolated target class and protected database/storage
   fingerprints;
2. confirmation that neither production nor the frozen old project is a
   source or target;
3. the dedicated namespace and separate bucket roles, without raw names;
4. confirmation that the isolated database marker row and both private bucket
   attestation objects were provisioned and independently fingerprinted;
5. protected manifest, artifact, policy, migration, and plan digests;
6. the exact `prepare-backup` command and expected safe output fields; and
7. the rollback owner and stop procedure.

After preparation, provide a second sanitized request containing the prepared
database restore-point fingerprint, protected envelope/storage restore and
execution digests, approval issue/expiry times, exclusive-writer window, and
the exact `plan`/`execute` commands.

Gili must approve each exact external stage. After the first approval:

1. provision the isolated target without creating a production/frozen-source
   snapshot unless separately approved;
2. populate only the dedicated environment in a clean shell;
3. place the owner-only preparation bundle, leave the execution-digest variable
   absent, and run `prepare-backup` once;
4. review only its sanitized digests, create the executable bundle bound to the
   returned backup fingerprint, then obtain Gili's second exact approval;
5. place that executable bundle, set only the approved execution digest,
   pre-create the separately approved empty owner-only approval ledger, and
   create the empty owner-only state directory;
6. run `plan`, review only its sanitized digests/counts, and stop on any error;
7. run `execute` once and let it complete all rollback exercises, final reset,
   post verifier, and executable second run;
8. use `resume` after a crash or `restore` after a stop requiring rollback; and
9. capture only safe codes, counts, phases, and protected digests as evidence.

Until those approved steps complete on real isolated resources, SK-90 remains
**PARTIAL — executable repository adapter verified, external rehearsal not
executed**.
