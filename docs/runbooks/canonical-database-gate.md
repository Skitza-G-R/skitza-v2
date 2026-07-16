# Canonical database gate

- **Issue:** SK-80
- **Confirmed by Gili:** 16 July 2026
- **Status:** Canonical project confirmed; approved-master-plan reset boundary recorded for SK-90 planning and non-production rehearsal only

This runbook is the handoff from SK-80 to SK-90. It records sanitized,
aggregate evidence only. It does not authorize a production write, database
branch or snapshot, migration, reset, storage deletion, environment change,
merge, deployment, or promotion.

## Canonical decision

- `skitza-v3` is the one canonical live Neon project.
- The project labeled `OLD — DO NOT USE.` stays frozen and read-only.
- Production must not be repointed to the frozen project.
- No schema or data from the frozen project may be merged, imported, or
  backfilled into the canonical project.

Gili confirmed this decision after the read-only mapping audit.

## Read-only mapping evidence

The audit did not reveal or copy any environment value.

1. Current application code reads its runtime database selector from
   `DATABASE_URL`.
2. The production deployment has sensitive variables named `DATABASE_URL`,
   `DATABASE_URL_NEON`, and `DATABASE_URL_UNPOOLED`. Their values were not
   opened, copied, or printed. Current application code selects only
   `DATABASE_URL` for normal runtime database access.
3. No Neon database or storage integration is linked through the deployment
   provider; the selector is managed as a sensitive environment variable.
4. A fresh production health request reached the database successfully and
   activated only the `skitza-v3` main compute. The frozen project's compute
   remained inactive during that trace.
5. The other project is visibly labeled `OLD — DO NOT USE.` and its database
   default transaction mode is read-only.

No environment selector needs changing under SK-80.

## Aggregate database inventory

All counts below came from `SELECT`-only queries. No record values, personal
data, raw identifiers, database URLs, or storage keys were selected.

### Schema and migration state

| Check                         | Canonical `skitza-v3` | Frozen old project |
| ----------------------------- | --------------------: | -----------------: |
| Public base tables            |                    20 |                 28 |
| Foreign keys                  |                    44 |                 68 |
| Unvalidated foreign keys      |                     0 |                  0 |
| Unvalidated constraints       |                     0 |                  0 |
| Drizzle migration-ledger rows |                     0 |                 29 |
| Default transaction read-only |           Not queried |                 On |

The repository currently declares 19 tables in
`packages/db/src/schema.ts`, contains 28 SQL migration files through 0026,
and has only six entries in the Drizzle journal. The canonical database has
one live-only, zero-row legacy table, `store_purchase_intents`. Some source
comments use later migration numbers even where definitions may already be
folded into the baseline migration, so comment labels are not evidence that
DDL is present or absent. Neither the Drizzle journal nor filename order may
be treated as a safe applied-migration ledger. SK-90 must compare an explicit
schema fingerprint in its isolated rehearsal and must keep using the approved
migration path.

### Row counts in both projects

| Table                     | Canonical | Frozen old |
| ------------------------- | --------: | ---------: |
| `agreement_acceptances`   |         4 |          0 |
| `availability_blackouts`  |         1 |          0 |
| `availability_blocks`     |       117 |         34 |
| `bookings`                |        22 |          3 |
| `client_contacts`         |        11 |          6 |
| `invoices`                |         3 |          0 |
| `notifications`           |        15 |          3 |
| `payment_proofs`          |         1 |          0 |
| `portfolio_tracks`        |         5 |          1 |
| `producer_external_links` |         5 |          0 |
| `producer_notes`          |         0 |          0 |
| `producers`               |        29 |          9 |
| `products`                |        46 |         10 |
| `project_tracks`          |        11 |          6 |
| `projects`                |        19 |          8 |
| `purchase_requests`       |         4 |          0 |
| `stripe_customers`        |         0 |          0 |
| `track_comments`          |        14 |          4 |
| `track_versions`          |         9 |          5 |

Canonical-only legacy residue:

| Table                    | Rows |
| ------------------------ | ---: |
| `store_purchase_intents` |    0 |

Frozen-old-only tables:

| Table                 | Rows |
| --------------------- | ---: |
| `contract_events`     |    0 |
| `contract_fields`     |    3 |
| `contract_recipients` |    0 |
| `contracts`           |    0 |
| `leads`               |    0 |
| `magic_link_views`    |   15 |
| `magic_links`         |   12 |
| `packages`            |    0 |
| `waitlist`            |    2 |

These old-project counts are comparison evidence only. None is a source for
the canonical project.

### Storage-reference counts in both projects

| Database reference                       |      Canonical | Frozen old |
| ---------------------------------------- | -------------: | ---------: |
| Portfolio audio URLs                     |              5 |          1 |
| Portfolio artwork URLs                   |              1 |          1 |
| Portfolio audio object keys              |              0 |          0 |
| Portfolio peaks object keys              |              0 |          0 |
| Track-version audio URLs                 |              6 |          2 |
| Distinct track-version audio object keys |              6 |          2 |
| Track-version peaks object keys          |              0 |          0 |
| Private proof object keys                |              1 |          0 |
| Legacy invoice proof URLs                |              0 |          0 |
| Contract PDF object keys                 | Not applicable |          0 |
| Final contract PDF object keys           | Not applicable |          0 |

These are database-reference counts only. No bucket listing or object-existence
check was run, and no key was selected or printed.

## Approved preservation boundary

SK-90 must preserve these canonical categories:

- 29 producer/account rows and their non-card settings;
- 117 availability blocks and 1 availability blackout;
- 11 client contacts, including their stable sign-in linkage;
- 46 reusable product templates as producer catalog identity and content;
- 5 portfolio rows, 5 producer external links, and producer notes;
- every category not explicitly named in the reset allowlist below.

The product audit found 35 active/unarchived and 11 archived/inactive
templates across 25 producers. All 46 use the flat deposit model. There are
zero Milestone deposit models, zero non-null Milestone payloads, and zero
Milestone payment-plan entries. Preserving template identity/content does not
grandfather removed Milestone or card behavior; SK-90 must remove obsolete
Milestone and provider-execution fields while keeping the producer's reusable
catalog data.

The audited preserved portfolio media fields contain 5 audio URLs and
1 artwork URL. No portfolio R2 object key or peaks key is stored, and producer
brand data contains zero logo URLs. Product contract URLs and other external
URL fields were not classified as Skitza-owned storage objects. The rehearsal
must cross-reference every preserved URL/key field before classifying any
candidate object for deletion.

## Approved mock reset boundary for SK-90

The exact canonical reset allowlist is:

- 22 bookings;
- 19 projects;
- 11 project tracks;
- 9 track versions;
- 14 track comments;
- 4 purchase requests;
- 4 agreement acceptances;
- 1 payment proof;
- 3 invoices;
- all 15 current notifications;
- zero-row `stripe_customers` and `store_purchase_intents` residue as later
  schema-removal checks;
- three deprecated producer Stripe-account values and the associated
  charge-enabled field, plus the zero non-null producer Tranzila-terminal
  values and that field, as mandatory field/schema removals while preserving
  every producer row and unrelated producer setting;
- storage candidates referenced by reset rows, but only after rehearsal proves
  exclusive reset ownership.

Every current notification is reset-owned activity: 6 booking requests,
4 purchase requests, 2 purchase approvals, 1 purchase decline, 1 submitted
proof, and 1 track approval. Notifications must be targeted explicitly rather
than left to nullable references or cascades.

The reset rows contain 6 distinct track-version audio key references and
1 private proof key reference. They contain zero track-version peaks
references and zero legacy invoice proof URLs. These are candidate database
references, not seven verified or exclusively reset-owned objects. The
isolated rehearsal must normalize and deduplicate keys/URLs, cross-reference
every preserved row, verify object existence and exclusive ownership, and
derive the real deletion count without printing keys.

The following are prohibited:

- merging or backfilling the frozen old project;
- creating synthetic purchases for old projects;
- preserving or reconstructing Milestone plans;
- inferring Completed or Canceled from old archive state;
- migrating mock invoices, payments, or proofs into the new ledger;
- relying on foreign-key cascades as the reset inventory.

## Current integrity and stop evidence

The canonical audit found:

- all 44 foreign keys validated;
- zero failures across 22 producer-ownership relationship checks;
- zero Stripe checkout-session, payment-intent, project customer,
  project payment-method, or subscription-schedule references;
- zero Stripe customer-cache rows;
- three producer Stripe-account references, with zero charge-enabled rows;
- zero producer Tranzila-terminal references;
- four legacy booking Tranzila-confirmation references;
- two mock paid-invoice rows and one mock confirmed-proof row;
- four signed-in client links, which are inside the preserved client boundary.

The approved master plan classifies the commercial/project records as mock.
The legacy payment indicators do not authorize assuming that premise forever.
The four linked client identities were not independently proven to be test
accounts during this aggregate-only audit. Every future production preflight
must reverify that there are no real users, external payments, live charges,
or live schedules and must stop until every indicator is proven mock/test or
the result otherwise matches the approved premise.

## Required non-production rehearsal

SK-90 may design and run the reset only in an isolated, non-production
database and isolated storage namespace. Creating any source snapshot or
branch still requires the approval that applies to that external action.

The rehearsal artifact must use read-only credentials for the canonical
source and write-capable credentials only for the isolated target. Before
every destructive database or storage phase, it must verify an approved
non-production target fingerprint and fail closed if the target matches either
audited Neon project or an unapproved storage namespace.

### 1. Baseline and restore points

1. Clone the confirmed canonical schema/data into the isolated database.
2. Copy only the relevant storage objects into an isolated namespace or make
   an equivalent restorable object snapshot.
3. Record the source schema/migration fingerprint, reviewed target-schema
   fingerprint, every table count, preserved/reset category counts,
   foreign-key validation, ownership checks, and distinct storage-reference
   counts.
4. Define a preserved-business-column projection separately from columns the
   approved migration removes. Its sanitized fingerprint must remain stable
   even though the overall schema intentionally changes.
5. Build a deterministic private reset manifest from approved mock provenance,
   not counts alone. It must bind every candidate row, relationship, and
   storage reference, keep identifiers/keys protected, and expose only a
   sanitized digest and aggregate counts.
6. Classify every signed-in client link against an approved test-identity
   allowlist or fresh human attestation. A client/artist identity not proven
   test data is a hard stop.
7. Classify every paid/confirmed row and provider reference using read-only
   test-mode/provider evidence. Any live-mode payment, charge-enabled account,
   external charge, or schedule is a hard stop. A non-null identifier alone is
   neither proof of real money nor permission to continue.
8. Normalize and deduplicate candidate storage keys/URLs, verify object
   existence, and prove that no preserved row references the same object.
   Never print record IDs, personal data, or object keys.
9. Stop before rehearsal on an unapproved identity/payment indicator,
   unexpected schema, ownership failure, object-ownership ambiguity, or drift
   from the reviewed manifest.

### 2. Exact reset rehearsal

1. Use the same versioned reset artifact intended for any later proposal and
   verify its digest before each phase.
2. Acquire a transaction isolation/locking guard that covers every reset table
   and run a final in-transaction manifest/count drift check immediately before
   mutation. Abort without partial changes on any mismatch.
3. Target every allowlisted category explicitly. Do not rely on cascades or
   broad producer/project deletion.
4. Handle the bidirectional booking/project links and nullable invoice,
   purchase, and notification links explicitly.
5. Quarantine or preserve verified restorable copies of every exclusively
   reset-owned object before database commit or object deletion.
6. Commit the database transaction before destructive object deletion, then
   delete only the manifest-bound objects from the isolated namespace. Keep
   each phase restartable and idempotent.
7. Apply no legacy transforms: no import, synthetic purchase, Milestone row,
   ledger backfill, or inferred lifecycle state.
8. Run a concurrency test that attempts relevant inserts and updates during
   the final check/reset window. The writes must block or make the reset abort,
   with no partial database or storage change.

### 3. Post-reset integrity

Require all of these checks to pass:

- each row-count delta and manifest identity set exactly matches the approved
  reset inventory;
- preserved row counts and the preserved-business-column fingerprint are
  unchanged;
- the resulting schema matches the separately reviewed target fingerprint;
- all reset categories are empty where the new schema expects them empty;
- foreign keys remain valid and orphan queries return zero;
- producer/client ownership mismatch queries return zero;
- every manifest-bound, exclusively reset-owned storage reference/object is
  gone from the isolated target;
- every preserved storage reference/object remains available;
- no synthetic purchase, legacy payment, Milestone, or inferred lifecycle row
  was created.

Run the exact reset a second time. It must be a no-op: zero additional rows or
objects changed and identical post-reset fingerprints.

### 4. Restore and rollback proof

1. Exercise rollback at three interruption points: before database commit,
   after database commit but before object deletion, and after a partial object
   deletion.
2. At each point, restore both the isolated database and storage namespace
   from the pre-reset restore points.
3. Re-run the complete baseline inventory.
4. Require exact equality for schema fingerprints, counts, foreign keys,
   ownership checks, and storage-reference/object manifests.
5. Verify restored object content fingerprints and authorized availability,
   not only object counts.
6. Record every failure trigger. Any failed assertion aborts the workflow
   before further action.

A later production proposal must define the same fresh restore points,
failure triggers, and database-plus-storage rollback. SK-80 does not authorize
creating or executing those production recovery artifacts.

## Approval gates and SK-90 handoff

- SK-80 authorizes only this read-only evidence and documentation.
- SK-90 may use this boundary to implement and rehearse against isolated
  non-production resources.
- A production snapshot/branch, migration, reset, data or storage deletion,
  environment repoint, deployment, or promotion each requires Gili's separate,
  exact approval for that action and target.
- Any later production approval must name the exact target, reset-artifact
  version/digest, fresh dry-run inventory digest, database and storage restore
  points, and storage-manifest digest. Any drift invalidates that approval and
  requires a new one.
- Merging this documentation also requires Gili's normal merge approval.
- No approval in SK-80 is permission to run or promote the later reset.

SK-90 remains blocked until this gate is reviewed, recorded in Linear, and
merged into `v3-clean`. After that, SK-90 may proceed only through its own
non-production implementation and rehearsal scope.
