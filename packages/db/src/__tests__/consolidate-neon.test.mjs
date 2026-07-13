import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CURRENT_TABLES,
  beginLockedProductionTransaction,
  assertLockedTargetTablesMatchFingerprint,
  assertMatchingCompleteFingerprints,
  assertNeonApiKeyCannotReadProject,
  assertProductionApproval,
  assertProductionSourceBranches,
  assertProductionTargetSnapshot,
  assertProductionTargetBranches,
  assertSourceOriginUnchangedBeforeCommit,
  assertSourceDatabase,
  assertDistinctDatabaseUrls,
  assertRehearsalTarget,
  buildCompleteDatabaseFingerprint,
  commitProductionTransaction,
  databaseIdentityDigest,
  fingerprintActions,
  manifestDigest,
  normalizeBookingStatus,
  normalizeProjectStage,
  planProducerMappings,
  prepareInsert,
  preserveAcknowledgedProductionReceipt,
  productionConfirmation,
  productionPolicyArtifactFingerprints,
  productionTargetLockStatement,
  readProductionApiKeys,
  resolveMigrationPaths,
  resolveProductionPolicyArtifactPaths,
  selectOnlyProductionSnapshot,
  stableStringify,
  withReadOnlySnapshot,
} from "../../consolidate-neon.mjs";

const SOURCE_URL =
  "postgresql://source_user:SOURCE_SECRET@ep-old-source.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const TARGET_URL =
  "postgresql://target_user:TARGET_SECRET@ep-sk80-target.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const SOURCE_SNAPSHOT_URL =
  "postgresql://source_snapshot:SNAPSHOT_SECRET@ep-source-snapshot.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const TARGET_RESTORE_URL =
  "postgresql://target_restore:RESTORE_SECRET@ep-target-restore.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const TARGET_SNAPSHOT_PREVIEW_URL =
  "postgresql://snapshot_preview:PREVIEW_SECRET@ep-target-snapshot-preview.eu-central-1.aws.neon.tech/neondb?sslmode=require";

function rehearsalMetadata(overrides = {}) {
  const base = {
    targetUrl: TARGET_URL,
    targetProjectId: "raspy-pine-96654399",
    targetBranchId: "br-sk80-rehearsal",
    project: {
      id: "raspy-pine-96654399",
      default_branch_id: "br-production",
    },
    branch: {
      id: "br-sk80-rehearsal",
      project_id: "raspy-pine-96654399",
      parent_id: "br-production",
      name: "sk-80-rehearsal-2026-07-13",
      protected: false,
    },
    endpoints: [
      {
        branch_id: "br-sk80-rehearsal",
        host: "ep-sk80-target.eu-central-1.aws.neon.tech",
        type: "read_write",
      },
    ],
  };

  return {
    ...base,
    ...overrides,
    project: { ...base.project, ...overrides.project },
    branch: { ...base.branch, ...overrides.branch },
    endpoints: overrides.endpoints ?? base.endpoints,
  };
}

function thrownMessage(run) {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the operation to throw");
}

describe("database identity guards", () => {
  it("refuses to use the same database as both source and target", () => {
    const message = thrownMessage(() => assertDistinctDatabaseUrls(SOURCE_URL, SOURCE_URL));

    expect(message).toMatch(/same database|must be distinct/i);
    expect(message).not.toContain("SOURCE_SECRET");
    expect(message).not.toContain(SOURCE_URL);
  });

  it("accepts distinct source and target endpoints", () => {
    expect(() => assertDistinctDatabaseUrls(SOURCE_URL, TARGET_URL)).not.toThrow();
  });

  it("normalizes pooler hosts, trailing dots, credentials, and encoded database names", () => {
    const direct = "postgresql://one:secret@ep-same.example.test/neondb";
    const pooled = "postgres://two:other@ep-same-pooler.example.test./neo%6Edb?sslmode=require";

    expect(() => assertDistinctDatabaseUrls(direct, pooled)).toThrow(/same database|distinct/i);
    expect(databaseIdentityDigest(direct)).toBe(databaseIdentityDigest(pooled));
  });

  it("rejects non-Postgres and malformed database URLs without leaking them", () => {
    const secret = "https://user:TOP_SECRET@example.test/neondb";
    const message = thrownMessage(() => assertDistinctDatabaseUrls(secret, TARGET_URL));

    expect(message).toMatch(/malformed/i);
    expect(message).not.toContain("TOP_SECRET");
  });
});

describe("source identity guard", () => {
  const metadata = {
    sourceUrl: SOURCE_URL,
    sourceProjectId: "quiet-sun-92221754",
    sourceBranchId: "br-source",
    project: { id: "quiet-sun-92221754", default_branch_id: "br-source" },
    branch: { id: "br-source", project_id: "quiet-sun-92221754", default: true },
    endpoints: [
      {
        branch_id: "br-source",
        host: "ep-old-source.eu-central-1.aws.neon.tech",
        type: "read_write",
      },
    ],
  };

  it("accepts the verified old source branch and endpoint", () => {
    expect(() => assertSourceDatabase(metadata)).not.toThrow();
  });

  it("refuses a mismatched source project or disabled endpoint", () => {
    expect(() => assertSourceDatabase({ ...metadata, project: { id: "wrong-project" } })).toThrow(
      /source project/i,
    );
    expect(() =>
      assertSourceDatabase({
        ...metadata,
        endpoints: [{ ...metadata.endpoints[0], disabled: true }],
      }),
    ).toThrow(/endpoint/i);
  });
});

describe("rehearsal target guard", () => {
  it("accepts the named, unprotected child branch and matching read-write endpoint", () => {
    expect(() => assertRehearsalTarget(rehearsalMetadata())).not.toThrow();
  });

  it("refuses the default branch", () => {
    const metadata = rehearsalMetadata({
      targetBranchId: "br-production",
      branch: { id: "br-production", name: "sk-80-rehearsal-production" },
      endpoints: [
        {
          branch_id: "br-production",
          host: "ep-sk80-target.eu-central-1.aws.neon.tech",
          type: "read_write",
        },
      ],
    });

    expect(() => assertRehearsalTarget(metadata)).toThrow(/default branch|rehearsal/i);
  });

  it("refuses a protected branch", () => {
    expect(() => assertRehearsalTarget(rehearsalMetadata({ branch: { protected: true } }))).toThrow(
      /protected/i,
    );
  });

  it("refuses a branch whose name is outside the SK-80 rehearsal namespace", () => {
    expect(() =>
      assertRehearsalTarget(rehearsalMetadata({ branch: { name: "production-copy" } })),
    ).toThrow(/name|sk-80-rehearsal/i);
  });

  it("refuses a URL whose host is not the branch read-write endpoint", () => {
    const metadata = rehearsalMetadata({
      endpoints: [
        {
          branch_id: "br-sk80-rehearsal",
          host: "ep-a-different-branch.eu-central-1.aws.neon.tech",
          type: "read_write",
        },
      ],
    });
    const message = thrownMessage(() => assertRehearsalTarget(metadata));

    expect(message).toMatch(/endpoint|host|branch/i);
    expect(message).not.toContain("TARGET_SECRET");
    expect(message).not.toContain(TARGET_URL);
  });

  it("refuses a child of the wrong parent and a different database name", () => {
    expect(() =>
      assertRehearsalTarget(rehearsalMetadata({ branch: { parent_id: "br-stale" } })),
    ).toThrow(/direct child|default branch/i);
    expect(() =>
      assertRehearsalTarget(
        rehearsalMetadata({ targetUrl: TARGET_URL.replace("/neondb", "/otherdb") }),
      ),
    ).toThrow(/database name|invalid/i);
  });
});

describe("production branch guards", () => {
  const snapshotTimestamp = "2026-07-13T12:10:00.000Z";
  const attestedAt = "2026-07-13T12:00:00.000Z";
  const runId = "sk80-prod-20260713-a";
  const source = {
    sourceOriginUrl: SOURCE_URL,
    sourceSnapshotUrl: SOURCE_SNAPSHOT_URL,
    sourceProjectId: "quiet-sun-92221754",
    sourceOriginBranchId: "br-old-default",
    sourceSnapshotBranchId: "br-sk80-source-snapshot",
    runId,
    snapshotTimestamp,
    attestedAt,
    origin: {
      project: { id: "quiet-sun-92221754", default_branch_id: "br-old-default" },
      branch: {
        id: "br-old-default",
        project_id: "quiet-sun-92221754",
        default: true,
      },
      endpoints: [
        {
          branch_id: "br-old-default",
          host: "ep-old-source.eu-central-1.aws.neon.tech",
          type: "read_write",
        },
      ],
    },
    snapshot: {
      project: { id: "quiet-sun-92221754", default_branch_id: "br-old-default" },
      branch: {
        id: "br-sk80-source-snapshot",
        project_id: "quiet-sun-92221754",
        parent_id: "br-old-default",
        name: `sk-80-source-snapshot-${runId}`,
        created_at: "2026-07-13T12:04:00.000Z",
        current_state: "ready",
      },
      endpoints: [
        {
          branch_id: "br-sk80-source-snapshot",
          host: "ep-source-snapshot.eu-central-1.aws.neon.tech",
          type: "read_write",
        },
      ],
    },
  };
  const target = {
    targetUrl: TARGET_URL,
    targetRestoreUrl: TARGET_RESTORE_URL,
    targetProjectId: "raspy-pine-96654399",
    targetBranchId: "br-live-default",
    targetRestoreBranchId: "br-sk80-target-restore",
    runId,
    snapshotTimestamp,
    attestedAt,
    current: {
      project: { id: "raspy-pine-96654399", default_branch_id: "br-live-default" },
      branch: {
        id: "br-live-default",
        project_id: "raspy-pine-96654399",
        default: true,
      },
      endpoints: [
        {
          branch_id: "br-live-default",
          host: "ep-sk80-target.eu-central-1.aws.neon.tech",
          type: "read_write",
        },
      ],
    },
    restore: {
      project: { id: "raspy-pine-96654399", default_branch_id: "br-live-default" },
      branch: {
        id: "br-sk80-target-restore",
        project_id: "raspy-pine-96654399",
        parent_id: "br-live-default",
        name: `sk-80-target-restore-${runId}`,
        created_at: "2026-07-13T12:05:00.000Z",
        current_state: "ready",
      },
      endpoints: [
        {
          branch_id: "br-sk80-target-restore",
          host: "ep-target-restore.eu-central-1.aws.neon.tech",
          type: "read_write",
        },
      ],
    },
  };
  const targetSnapshot = {
    targetSnapshotPreviewUrl: TARGET_SNAPSHOT_PREVIEW_URL,
    targetProjectId: "raspy-pine-96654399",
    targetBranchId: "br-live-default",
    targetSnapshotId: "ss-sk80-target-manual",
    targetSnapshotPreviewBranchId: "br-sk80-target-snapshot-preview",
    runId,
    snapshotTimestamp,
    attestedAt,
    snapshot: {
      id: "ss-sk80-target-manual",
      name: `sk-80-target-manual-snapshot-${runId}`,
      source_branch_id: "br-live-default",
      timestamp: "2026-07-13T12:06:00.000Z",
      created_at: "2026-07-13T12:06:00.000Z",
      manual: true,
    },
    preview: {
      project: { id: "raspy-pine-96654399", default_branch_id: "br-live-default" },
      branch: {
        id: "br-sk80-target-snapshot-preview",
        project_id: "raspy-pine-96654399",
        name: `sk-80-target-snapshot-preview-${runId}`,
        created_at: "2026-07-13T12:07:00.000Z",
        current_state: "ready",
        restored_from: "ss-sk80-target-manual",
        restored_as: "br-live-default",
        restore_status: "restored",
        default: false,
      },
      endpoints: [
        {
          branch_id: "br-sk80-target-snapshot-preview",
          host: "ep-target-snapshot-preview.eu-central-1.aws.neon.tech",
          type: "read_write",
        },
      ],
    },
  };

  it("accepts the exact defaults and their fresh direct-child safety branches", () => {
    expect(() => assertProductionSourceBranches(source)).not.toThrow();
    expect(() => assertProductionTargetBranches(target)).not.toThrow();
    expect(() => assertProductionTargetSnapshot(targetSnapshot)).not.toThrow();
  });

  it("accepts Neon's fresh creation time when snapshot listings omit capture time and LSN", () => {
    const snapshotWithoutOptionalCaptureFields = Object.fromEntries(
      Object.entries(targetSnapshot.snapshot).filter(
        ([key]) => key !== "timestamp" && key !== "lsn",
      ),
    );
    expect(() =>
      assertProductionTargetSnapshot({
        ...targetSnapshot,
        snapshot: snapshotWithoutOptionalCaptureFields,
      }),
    ).not.toThrow();
  });

  it("refuses a stale or indirect source snapshot", () => {
    expect(() =>
      assertProductionSourceBranches({
        ...source,
        snapshot: {
          ...source.snapshot,
          branch: { ...source.snapshot.branch, parent_id: "br-something-else" },
        },
      }),
    ).toThrow(/direct child/i);
    expect(() =>
      assertProductionSourceBranches({
        ...source,
        snapshot: {
          ...source.snapshot,
          branch: { ...source.snapshot.branch, created_at: "2026-07-13T10:00:00.000Z" },
        },
      }),
    ).toThrow(/fresh|30 minutes/i);
  });

  it("refuses a production source snapshot scheduled for deletion", () => {
    expect(() =>
      assertProductionSourceBranches({
        ...source,
        snapshot: {
          ...source.snapshot,
          branch: {
            ...source.snapshot.branch,
            expires_at: "2026-07-14T12:00:00.000Z",
          },
        },
      }),
    ).toThrow(/must not have an expiration time/i);
  });

  it("refuses a non-default production target and a mismatched restore endpoint", () => {
    expect(() =>
      assertProductionTargetBranches({
        ...target,
        current: {
          ...target.current,
          branch: { ...target.current.branch, default: false },
        },
      }),
    ).toThrow(/default/i);
    expect(() =>
      assertProductionTargetBranches({
        ...target,
        restore: {
          ...target.restore,
          endpoints: [
            {
              branch_id: "br-sk80-target-restore",
              host: "ep-wrong.eu-central-1.aws.neon.tech",
              type: "read_write",
            },
          ],
        },
      }),
    ).toThrow(/endpoint/i);
  });

  it("refuses a production target restore point scheduled for deletion", () => {
    expect(() =>
      assertProductionTargetBranches({
        ...target,
        restore: {
          ...target.restore,
          branch: {
            ...target.restore.branch,
            expires_at: "2026-07-14T12:00:00.000Z",
          },
        },
      }),
    ).toThrow(/must not have an expiration time/i);
  });

  it("refuses an unverified or expiring target manual-snapshot preview", () => {
    expect(() =>
      assertProductionTargetSnapshot({
        ...targetSnapshot,
        preview: {
          ...targetSnapshot.preview,
          branch: {
            ...targetSnapshot.preview.branch,
            restored_from: "ss-a-different-snapshot",
          },
        },
      }),
    ).toThrow(/preview|manual snapshot/i);
    expect(() =>
      assertProductionTargetSnapshot({
        ...targetSnapshot,
        snapshot: {
          ...targetSnapshot.snapshot,
          expires_at: "2026-07-14T12:00:00.000Z",
        },
      }),
    ).toThrow(/must not expire/i);
  });
});

describe("production approval binding", () => {
  it("proves each production API key is denied access to the opposite project", async () => {
    await expect(
      assertNeonApiKeyCannotReadProject("scoped-key", "denied-project", async () => ({
        ok: false,
        status: 403,
      })),
    ).resolves.toBeUndefined();
    await expect(
      assertNeonApiKeyCannotReadProject("broad-key", "wrong-project", async () => ({
        ok: true,
        status: 200,
      })),
    ).rejects.toThrow(/scope is too broad/i);
  });

  it("requires the canonical target's single snapshot slot to belong to this run", () => {
    const snapshot = { id: "ss-sk80" };
    expect(selectOnlyProductionSnapshot([snapshot], "ss-sk80")).toBe(snapshot);
    expect(() => selectOnlyProductionSnapshot([], "ss-sk80")).toThrow(/exactly one/i);
    expect(() => selectOnlyProductionSnapshot([snapshot, { id: "ss-other" }], "ss-sk80")).toThrow(
      /exactly one/i,
    );
    expect(() => selectOnlyProductionSnapshot([{ id: "ss-other" }], "ss-sk80")).toThrow(
      /only snapshot/i,
    );
  });

  it("requires two different production Neon API keys", () => {
    expect(() =>
      readProductionApiKeys({
        SKITZA_CONSOLIDATION_PRODUCTION_SOURCE_NEON_API_KEY: "source-key",
        SKITZA_CONSOLIDATION_PRODUCTION_TARGET_NEON_API_KEY: "target-key",
      }),
    ).not.toThrow();
    expect(() => readProductionApiKeys({})).toThrow(/separate source and target/i);
    expect(() =>
      readProductionApiKeys({
        SKITZA_CONSOLIDATION_PRODUCTION_SOURCE_NEON_API_KEY: "same-key",
        SKITZA_CONSOLIDATION_PRODUCTION_TARGET_NEON_API_KEY: "same-key",
      }),
    ).toThrow(/must be different/i);
  });

  it("derives a typed confirmation from every irreversible-run identity", () => {
    const config = {
      targetProjectId: "raspy-pine-96654399",
      targetBranchId: "br-live-default",
      runId: "sk80-prod-20260713-a",
      snapshotTimestamp: "2026-07-13T12:10:00.000Z",
    };
    const digest = "a".repeat(64);
    const confirmation = productionConfirmation({ ...config, digest });

    expect(confirmation).toContain("raspy-pine-96654399");
    expect(confirmation).toContain("br-live-default");
    expect(confirmation).toContain("sk80-prod-20260713-a");
    expect(confirmation).toContain("2026-07-13T12:10:00.000Z");
    expect(confirmation).toContain("a".repeat(64));
    expect(confirmation).not.toBe("yes");
    expect(() => assertProductionApproval(config, digest, confirmation)).not.toThrow();
    expect(() => assertProductionApproval(config, digest, "yes")).toThrow(/typed|exactly/i);
  });

  it("refuses complete-fingerprint drift even when the row counts look equal", () => {
    const original = {
      digest: "a".repeat(64),
      schema: { digest: "b".repeat(64) },
      data: { digest: "c".repeat(64) },
    };
    const drifted = {
      ...original,
      digest: "d".repeat(64),
      data: { digest: "e".repeat(64) },
    };

    expect(() =>
      assertMatchingCompleteFingerprints("source snapshot", original, original),
    ).not.toThrow();
    expect(() => assertMatchingCompleteFingerprints("source snapshot", original, drifted)).toThrow(
      /source snapshot|fingerprint|match/i,
    );
  });

  it("binds every public schema-object class and exact base-table row digest", () => {
    const parts = {
      schemaObjects: {
        relations: [{ name: "items", kind: "r" }],
        columns: [
          {
            table_name: "items",
            column_name: "id",
            data_type: "uuid",
            is_nullable: "NO",
            column_default: "gen_random_uuid()",
          },
        ],
        enums: [{ type_name: "item_state", label: "active", sort_order: 1 }],
        constraints: [{ name: "items_pkey", definition: "PRIMARY KEY (id)" }],
        indexes: [{ name: "items_pkey", definition: "CREATE UNIQUE INDEX items_pkey" }],
        views: [{ name: "active_items", definition: "SELECT * FROM items" }],
        sequences: [{ name: "items_number_seq", increment_by: "1" }],
        triggers: [{ name: "items_updated", definition: "EXECUTE FUNCTION touch()" }],
        policies: [{ name: "items_owner", using_expression: "owner_id = current_user" }],
        routines: [{ name: "touch", definition: "CREATE FUNCTION touch() RETURNS trigger" }],
      },
      baseTableRows: {
        items: ['{"id":"00000000-0000-0000-0000-000000000001","state":"active"}'],
      },
      materializedViewRows: { item_totals: ['{"count":1}'] },
      sequenceStates: [{ name: "items_number_seq", last_value: "4", is_called: true }],
    };
    const original = buildCompleteDatabaseFingerprint(parts);

    expect(original.version).toBe(2);
    expect(original.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(original.data.tables.items.rowDigests).toHaveLength(1);
    expect(original.data.tables.items.rowDigests[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(original.data.tables.items.rowDigests[0]).not.toContain("00000000");

    const mutations = [
      { category: "columns", key: "column_default", value: "uuid_generate_v4()" },
      { category: "enums", key: "label", value: "archived" },
      { category: "constraints", key: "definition", value: "UNIQUE (id)" },
      { category: "indexes", key: "definition", value: "CREATE INDEX items_pkey" },
      { category: "views", key: "definition", value: "SELECT id FROM items" },
      { category: "sequences", key: "increment_by", value: "2" },
      { category: "triggers", key: "definition", value: "EXECUTE FUNCTION changed()" },
      { category: "policies", key: "using_expression", value: "false" },
      { category: "routines", key: "definition", value: "CREATE FUNCTION changed()" },
    ];
    for (const mutation of mutations) {
      const changed = structuredClone(parts);
      changed.schemaObjects[mutation.category][0][mutation.key] = mutation.value;
      expect(buildCompleteDatabaseFingerprint(changed).digest).not.toBe(original.digest);
    }

    const changedRow = structuredClone(parts);
    changedRow.baseTableRows.items[0] = '{"id":"changed","state":"active"}';
    expect(buildCompleteDatabaseFingerprint(changedRow).digest).not.toBe(original.digest);
    const changedSequenceState = structuredClone(parts);
    changedSequenceState.sequenceStates[0].last_value = "5";
    expect(buildCompleteDatabaseFingerprint(changedSequenceState).digest).not.toBe(original.digest);
  });

  it("stops a production commit when a fresh source-origin fingerprint drifted", () => {
    const approved = { digest: "a".repeat(64) };

    expect(() => assertSourceOriginUnchangedBeforeCommit(approved, approved)).not.toThrow();
    expect(() =>
      assertSourceOriginUnchangedBeforeCommit(approved, { digest: "b".repeat(64) }),
    ).toThrow(/fresh source-origin|before commit|must not commit/i);
  });

  it("binds exact script, package, and runbook bytes without absolute paths", () => {
    const paths = resolveProductionPolicyArtifactPaths();
    const fingerprints = productionPolicyArtifactFingerprints();

    expect(Object.keys(fingerprints.artifacts).sort()).toEqual(
      ["consolidationScript", "databasePackage", "consolidationRunbook"].sort(),
    );
    for (const [role, artifact] of Object.entries(fingerprints.artifacts)) {
      const expected = createHash("sha256").update(readFileSync(paths[role].path)).digest("hex");
      expect(artifact.sha256).toBe(expected);
      expect(artifact.repositoryPath).not.toMatch(/^\//);
    }
    expect(fingerprints.digest).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("production lock contract", () => {
  it("takes target table locks before the transaction's first catalog snapshot", async () => {
    const queries = [];
    const client = {
      async query(sql) {
        queries.push(sql);
        if (/information_schema\.tables/i.test(sql)) {
          return { rows: [{ table_name: "bookings" }, { table_name: "producers" }] };
        }
        return { rows: [] };
      },
    };

    await expect(beginLockedProductionTransaction(client)).resolves.toEqual([
      "bookings",
      "producers",
    ]);
    expect(queries[0]).toMatch(/information_schema\.tables/i);
    expect(queries[1]).toBe("begin isolation level serializable");
    expect(queries[2]).toMatch(/^set local lock_timeout/i);
    expect(queries[3]).toMatch(/^set local statement_timeout/i);
    expect(queries[4]).toMatch(/^lock table /i);
    expect(queries[5]).toMatch(/information_schema\.tables/i);
  });

  it("fail-closed locks every required current table before planning", () => {
    const statement = productionTargetLockStatement();

    expect(statement).toMatch(/^lock table /i);
    expect(statement).toMatch(/share row exclusive mode$/i);
    for (const table of CURRENT_TABLES) expect(statement).toContain(`public."${table}"`);
  });

  it("locks every discovered public base table, including tables outside the merge list", () => {
    const tables = [...CURRENT_TABLES, "audit_archive", 'odd"name'];
    const statement = productionTargetLockStatement(tables);

    expect(statement).toContain('public."audit_archive"');
    expect(statement).toContain('public."odd""name"');
    expect(() =>
      assertLockedTargetTablesMatchFingerprint(tables, {
        data: { tables: Object.fromEntries(tables.map((table) => [table, {}])) },
      }),
    ).not.toThrow();
    expect(() =>
      assertLockedTargetTablesMatchFingerprint(tables, {
        data: { tables: Object.fromEntries(CURRENT_TABLES.map((table) => [table, {}])) },
      }),
    ).toThrow(/locked target|fingerprint/i);
  });
});

describe("legacy enum normalization", () => {
  it("maps legacy pending bookings and preserves current booking statuses", () => {
    expect(normalizeBookingStatus("pending")).toBe("pending_approval");

    for (const status of [
      "pending_approval",
      "pending_payment",
      "confirmed",
      "rejected",
      "cancelled",
    ]) {
      expect(normalizeBookingStatus(status)).toBe(status);
    }
  });

  it("hard-stops unsupported booking statuses", () => {
    expect(() => normalizeBookingStatus("awaiting_artist")).toThrow(/unsupported|booking/i);
  });

  it("preserves current project stages", () => {
    for (const stage of ["lead", "booked", "in_production", "final_review", "paid", "archived"]) {
      expect(normalizeProjectStage(stage)).toBe(stage);
    }
  });

  it("hard-stops every legacy project stage for a human decision", () => {
    for (const stage of ["contract_sent", "payment_paused", "cancelled"]) {
      expect(() => normalizeProjectStage(stage)).toThrow(/legacy|human|decision/i);
    }
  });
});

describe("producer identity planning", () => {
  it("maps the same Clerk identity to the canonical producer with target-wins policy", () => {
    const source = [
      {
        id: "source-shared",
        clerkUserId: "user_shared",
        email: "old@example.test",
        slug: "old-studio",
        displayName: "Old source settings",
        timezone: "UTC",
      },
    ];
    const target = [
      {
        id: "target-shared",
        clerkUserId: "user_shared",
        email: "live@example.test",
        slug: "live-studio",
        displayName: "Canonical target settings",
        timezone: "Asia/Jerusalem",
      },
    ];

    const plan = planProducerMappings(source, target);

    expect(plan.conflicts).toEqual([]);
    expect(plan.mappings).toHaveLength(1);
    expect(plan.mappings[0]).toEqual(
      expect.objectContaining({
        sourceId: "source-shared",
        targetId: "target-shared",
        action: "target_wins",
      }),
    );
  });

  it("treats an identical same-Clerk, same-UUID producer as already imported", () => {
    const producer = {
      id: "same-id",
      clerk_user_id: "user_same",
      email: "same@example.test",
      slug: "same-studio",
    };

    expect(planProducerMappings([producer], [{ ...producer }]).mappings[0].action).toBe(
      "already_present",
    );
    expect(
      planProducerMappings([producer], [{ ...producer, slug: "canonical-studio" }]).mappings[0]
        .action,
    ).toBe("target_wins");
  });

  it("reports a slug owned by a different Clerk identity as a hard conflict", () => {
    const source = [
      {
        id: "source-new",
        clerkUserId: "user_source",
        email: "source@example.test",
        slug: "claimed-slug",
      },
    ];
    const target = [
      {
        id: "target-owner",
        clerkUserId: "user_target",
        email: "target@example.test",
        slug: "claimed-slug",
      },
    ];

    const plan = planProducerMappings(source, target);

    expect(plan.conflicts).toContainEqual(
      expect.objectContaining({
        type: "slug_conflict",
        sourceId: "source-new",
        targetId: "target-owner",
      }),
    );
  });
});

describe("deterministic manifests", () => {
  it("sorts object keys recursively without changing array order", () => {
    const left = {
      z: [{ b: 2, a: 1 }, "second"],
      a: { y: true, x: false },
    };
    const right = {
      a: { x: false, y: true },
      z: [{ a: 1, b: 2 }, "second"],
    };

    expect(stableStringify(left)).toBe(stableStringify(right));
    expect(stableStringify(left)).toBe('{"a":{"x":false,"y":true},"z":[{"a":1,"b":2},"second"]}');
  });

  it("produces a deterministic, opaque SHA-256 digest", () => {
    const secret = "postgresql://user:DO_NOT_LEAK@example.test/neondb";
    const first = manifestDigest({
      snapshotTimestamp: "2026-07-13T12:00:00.000Z",
      counts: { products: 44, producers: 29 },
      internalTestSecret: secret,
    });
    const second = manifestDigest({
      internalTestSecret: secret,
      counts: { producers: 29, products: 44 },
      snapshotTimestamp: "2026-07-13T12:00:00.000Z",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain(secret);
    expect(first).not.toContain("DO_NOT_LEAK");
  });

  it("changes source/action approval fingerprints when one cell changes", () => {
    const original = [{ kind: "insert", table: "products", row: { id: "p1", price_cents: 100 } }];
    const changed = [{ kind: "insert", table: "products", row: { id: "p1", price_cents: 101 } }];

    expect(fingerprintActions(original).digest).not.toBe(fingerprintActions(changed).digest);
    expect(fingerprintActions(original).digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(fingerprintActions(original))).not.toContain("price_cents");
  });
});

describe("safe insert serialization", () => {
  const columns = [
    { column_name: "id", data_type: "uuid" },
    { column_name: "payment_plans", data_type: "jsonb" },
    { column_name: "deliverables", data_type: "ARRAY", udt_name: "_text" },
  ];

  it("stringifies JSONB arrays with a cast but preserves native text arrays", () => {
    const statement = prepareInsert(
      "products",
      { id: "p1", payment_plans: [], deliverables: ["mix", "stems"] },
      columns,
    );

    expect(statement.sql).toContain("$2::jsonb");
    expect(statement.values[1]).toBe("[]");
    expect(statement.values[2]).toEqual(["mix", "stems"]);
  });

  it("round-trips a non-empty JSONB array as JSON text", () => {
    const plans = [{ kind: "split", payments: [50, 50] }];
    const statement = prepareInsert(
      "products",
      { id: "p1", payment_plans: plans, deliverables: [] },
      columns,
    );

    expect(JSON.parse(statement.values[1])).toEqual(plans);
  });
});

describe("transaction and path safety", () => {
  it("returns an acknowledged production receipt when later read-only cleanup fails", async () => {
    const receipt = { approvedManifestDigest: "a".repeat(64) };
    const warnings = [];
    let acknowledgedReceipt;
    const result = await preserveAcknowledgedProductionReceipt(
      async () => {
        acknowledgedReceipt = receipt;
        throw new Error("read-only cleanup transport failed with SECRET");
      },
      () => acknowledgedReceipt,
      (warning) => warnings.push(warning),
    );

    expect(result).toBe(receipt);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/commit was acknowledged|cleanup failed/i);
    expect(warnings[0]).not.toContain("SECRET");
  });

  it("treats a lost COMMIT response as unknown and never exposes the transport error", async () => {
    const calls = [];
    const client = {
      query: async (sql) => {
        calls.push(sql);
        throw new Error("socket closed for postgresql://user:COMMIT_SECRET@example.test/neondb");
      },
    };
    let error;
    try {
      await commitProductionTransaction(client, "a".repeat(64));
    } catch (caught) {
      error = caught;
    }

    expect(calls).toEqual(["commit"]);
    expect(error?.message).toMatch(/outcome is unknown|do not retry|verify-production/i);
    expect(error?.message).toContain("a".repeat(64));
    expect(error?.message).not.toContain("COMMIT_SECRET");
    expect(error?.message).not.toMatch(/rolled back/i);
  });

  it("returns normally only after PostgreSQL acknowledges COMMIT", async () => {
    const calls = [];
    await commitProductionTransaction({ query: async (sql) => calls.push(sql) }, "b".repeat(64));

    expect(calls).toEqual(["commit"]);
  });

  it("uses a read-only repeatable-read transaction and always releases", async () => {
    const calls = [];
    const client = {
      query: async (sql) => calls.push(sql),
      release: () => calls.push("release"),
    };
    const result = await withReadOnlySnapshot({ connect: async () => client }, async () => "ok");

    expect(result).toBe("ok");
    expect(calls).toEqual(["begin isolation level repeatable read read only", "commit", "release"]);
  });

  it("rolls back and releases when a snapshot callback fails", async () => {
    const calls = [];
    const client = {
      query: async (sql) => calls.push(sql),
      release: () => calls.push("release"),
    };

    await expect(
      withReadOnlySnapshot({ connect: async () => client }, async () => {
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    expect(calls).toEqual([
      "begin isolation level repeatable read read only",
      "rollback",
      "release",
    ]);
  });

  it("decodes spaces in migration script and cwd paths", () => {
    const paths = resolveMigrationPaths("file:///tmp/Skitza%2016.4/consolidate-neon.mjs");

    expect(paths.script).toBe("/tmp/Skitza 16.4/apply-migrations.mjs");
    expect(paths.cwd).toBe("/tmp/Skitza 16.4/");
  });
});
