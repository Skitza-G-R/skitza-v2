import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("./target-observer", async () => {
  const actual = await vi.importActual<typeof import("./target-observer")>("./target-observer");
  return {
    ...actual,
    observeProductionDatabaseTarget: vi.fn(async (client: NeonPoolClientLike) => {
      await client.query("SELECT 1 /* sk104-test-target-observation */");
      return {
        databaseFingerprint: actual.SK104_CANONICAL_DATABASE_FINGERPRINT,
        primary: true as const,
        writable: true as const,
      };
    }),
  };
});

import {
  SK104_PRESERVED_INVENTORY,
  SK104_RESET_INVENTORY,
  bindSk104CutoverApproval,
  bindSk104ProductionTarget,
  buildSk104ProductionManifest,
  sk104ProductionTargetPolicyDigest,
  type Sk104CutoverApproval,
  type Sk104ProductionManifest,
} from "./contract";
import {
  SK104_APPROVED_MIGRATION_FILES,
  SK104_CHILD_RESTORE_ADVISORY_LOCK_KEY,
  SK104_DATABASE_ADVISORY_LOCK_KEY,
  SK104_RUN_LEASE_ADVISORY_LOCK_KEY,
  SK104_REQUIRED_LOCK_TABLES,
  Sk104ProductionDatabaseAdapter,
  assertSk104PrivateProductionDatabaseManifest,
  discoverSk104PrivateProductionDatabaseManifest,
  type Sk104PrivateMockEvidence,
  type Sk104PrivateProductionDatabaseManifest,
} from "./database";
import { canonicalJson, protectValue, sha256Digest } from "../sk90-reset/canonical";
import type { NeonPoolClientLike, NeonPoolLike } from "../sk90-reset/database-adapter";
import {
  SK104_CANONICAL_DATABASE_FINGERPRINT,
  SK104_FROZEN_DATABASE_FINGERPRINT,
} from "./target-observer";

const PARENT_PROOF_LOCK = "1234567890123456789";
import type { Sk104VerifiedSnapshotPort } from "./backup";

const HMAC_KEY = "sk104-private-database-test-key-at-least-32-bytes";

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function evidence(): Sk104PrivateMockEvidence {
  return {
    identities: Array.from({ length: 5 }, (_, index) => ({
      ownerId: uuid(1_000 + index),
      identityValue: `test-identity-${String(index)}`,
      classification: "approved_test" as const,
      attested: true as const,
    })),
    monetaryRows: [
      ...Array.from({ length: 3 }, (_, index) => ({
        sourceKind: "invoice_paid" as const,
        ownerId: uuid(2_000 + index),
        classification: "approved_mock_test" as const,
        attested: true as const,
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        sourceKind: "payment_proof_confirmed" as const,
        ownerId: uuid(2_100 + index),
        classification: "approved_mock_test" as const,
        attested: true as const,
      })),
    ],
    providerReferences: [
      ...Array.from({ length: 3 }, (_, index) => ({
        sourceKind: "producer_stripe_account" as const,
        ownerId: uuid(3_000 + index),
        providerValue: `acct_test_${String(index)}`,
        provider: "stripe" as const,
        mode: "test" as const,
        attested: true as const,
        chargeEnabled: false as const,
        externalCharge: false as const,
        liveSchedule: false as const,
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        sourceKind: "booking_tranzila_confirmation" as const,
        ownerId: uuid(3_100 + index),
        providerValue: `tranzila-test-${String(index)}`,
        provider: "tranzila" as const,
        mode: "test" as const,
        attested: true as const,
        chargeEnabled: false as const,
        externalCharge: false as const,
        liveSchedule: false as const,
      })),
    ],
  };
}

const resetCounts: ReadonlyMap<string, number> = new Map(
  SK104_RESET_INVENTORY.map((entry) => [entry.table, entry.count]),
);
const preservedCounts: ReadonlyMap<string, number> = new Map(
  SK104_PRESERVED_INVENTORY.map((entry) => [entry.table, entry.count]),
);

const baselineCatalogRows = [
  {
    kind: "column",
    identity: "public.producers.id",
    definition: "uuid|true|gen_random_uuid()",
  },
] as const;

const postCatalogRows = [
  {
    kind: "column",
    identity: "public.purchases.id",
    definition: "uuid|true|gen_random_uuid()",
  },
] as const;

type TestLedgerRow = Readonly<{ filename: string; digest: string }>;

type DiscoveryOptions = Readonly<{
  notificationDelta?: number;
  prohibitedCount?: number;
  state?: "baseline" | "post" | "mixed";
  catalogRows?: readonly Readonly<{
    kind: string;
    identity: string;
    definition: string;
  }>[];
  ledgerRows?: readonly TestLedgerRow[];
  baselineLedger?: "absent" | "empty" | "applied";
  snapshot?: string;
  events?: string[];
}>;

function tableFrom(statement: string): string | null {
  return statement.match(/FROM "public"\."([a-z0-9_]+)"/)?.[1] ?? null;
}

function discoveryClient(options: DiscoveryOptions = {}): NeonPoolClientLike {
  const exactEvidence = evidence();
  const query = ((statement: string, parameters?: readonly unknown[]) =>
    Promise.resolve().then(() => {
      options.events?.push(statement);
      if (statement === "SELECT 1 /* sk104-test-target-observation */") {
        return { rows: [{ observed: 1 }] };
      }
      if (
        statement === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" ||
        statement === "ROLLBACK"
      ) {
        return { rows: [] };
      }
      if (statement.includes("pg_export_snapshot()")) {
        return { rows: [{ snapshot: options.snapshot ?? "00000003-0000001B-1" }] };
      }
      if (statement.includes('candidate."relation_name"')) {
        const baselineRelations = new Set([
          "agreement_acceptances",
          "invoices",
          "store_purchase_intents",
          "stripe_customers",
        ]);
        const postRelations = new Set([
          "private_offers",
          "purchases",
          "purchase_installments",
          "purchase_payments",
        ]);
        const state = options.state ?? "baseline";
        const names = parameters?.[0] as readonly string[];
        return {
          rows: names.map((relation_name) => ({
            relation_name,
            relation:
              (state === "baseline" && baselineRelations.has(relation_name)) ||
              (state === "post" && postRelations.has(relation_name)) ||
              (state === "mixed" &&
                (relation_name === "agreement_acceptances" || relation_name === "purchases"))
                ? `public.${relation_name}`
                : null,
          })),
        };
      }
      if (statement.includes("WITH catalog_entry AS")) {
        return { rows: options.catalogRows ?? baselineCatalogRows };
      }
      if (
        statement.includes('"information_schema"."columns"') &&
        statement.includes("pending_audio_%")
      ) {
        return { rows: [] };
      }
      if (statement.includes('AS "storage_reference"')) {
        return {
          rows: [
            ...Array.from({ length: 7 }, (_, index) => ({
              bucket_role: "audio",
              source_table: "track_versions",
              source_column: "audio_r2_key",
              row_id: uuid(4_000 + index),
              object_key: `private/audio-${String(index)}.wav`,
              referenced_by: "reset",
            })),
            ...Array.from({ length: 2 }, (_, index) => ({
              bucket_role: "docs",
              source_table: "payment_proofs",
              source_column: "storage_key",
              row_id: uuid(4_100 + index),
              object_key: `private/proof-${String(index)}.pdf`,
              referenced_by: "reset",
            })),
          ],
        };
      }
      if (statement.includes('AS "owner_id", "clerk_user_id" AS "identity_value"')) {
        return {
          rows: exactEvidence.identities.map((row) => ({
            owner_id: row.ownerId,
            identity_value: row.identityValue,
          })),
        };
      }
      if (statement.includes('AS "monetary_indicator"')) {
        return {
          rows: exactEvidence.monetaryRows.map((row) => ({
            source_kind: row.sourceKind,
            owner_id: row.ownerId,
          })),
        };
      }
      if (statement.includes('AS "provider_reference"')) {
        return {
          rows: exactEvidence.providerReferences.map((row) => ({
            source_kind: row.sourceKind,
            owner_id: row.ownerId,
            provider_value: row.providerValue,
          })),
        };
      }
      if (statement.includes('"stripe_charges_enabled" IS TRUE')) {
        return { rows: [{ count: String(options.prohibitedCount ?? 0) }] };
      }
      if (statement.includes("FROM pg_constraint AS constraint_entry")) {
        return { rows: [] };
      }
      if (statement.includes("WITH violation AS")) {
        return { rows: [{ count: "0" }] };
      }
      if (statement.includes("to_regnamespace('skitza_migrations')")) {
        const ledger = options.baselineLedger ?? "absent";
        return {
          rows: [
            {
              migration_namespace: ledger === "absent" ? null : "skitza_migrations",
              ledger_relation: ledger === "absent" ? null : "skitza_migrations.applied",
            },
          ],
        };
      }
      if (statement.includes("to_regclass('skitza_migrations.applied')")) {
        return {
          rows: [{ relation: options.state === "post" ? "skitza_migrations.applied" : null }],
        };
      }
      if (statement.includes('FROM "skitza_migrations"."applied"')) {
        return { rows: options.ledgerRows ?? [] };
      }
      if (statement.includes("to_regclass('public.")) {
        return { rows: [{ relation: null }] };
      }

      const table = tableFrom(statement);
      if (statement.includes('count(*)::text AS "count"') && table) {
        return { rows: [{ count: String(preservedCounts.get(table) ?? 0) }] };
      }
      if (statement.includes('AS "identity"') && statement.includes('AS "payload"') && table) {
        const baseCount = resetCounts.get(table) ?? preservedCounts.get(table) ?? 0;
        const count =
          table === "notifications" ? baseCount + (options.notificationDelta ?? 0) : baseCount;
        const offset = [...resetCounts.keys(), ...preservedCounts.keys()].indexOf(table) * 1_000;
        return {
          rows: Array.from({ length: count }, (_, index) => ({
            identity: uuid(10_000 + offset + index),
            payload: JSON.stringify({ table, index }),
          })),
        };
      }
      throw new Error(`unhandled test query: ${statement.slice(0, 80)}`);
    })) as NeonPoolClientLike["query"];
  return {
    query,
    release: () => {
      options.events?.push("RELEASE");
    },
  };
}

const ledgerRows: readonly TestLedgerRow[] = SK104_APPROVED_MIGRATION_FILES.map(
  (filename, index) => ({
    filename,
    digest: String(index + 1)
      .repeat(64)
      .slice(0, 64),
  }),
);
const migrationBundleDigest = sha256Digest(JSON.stringify(ledgerRows));

async function cutoverFixture(): Promise<
  Readonly<{
    privateManifest: Sk104PrivateProductionDatabaseManifest;
    manifest: Sk104ProductionManifest;
  }>
> {
  const privateManifest = await discoverSk104PrivateProductionDatabaseManifest(
    discoveryClient(),
    HMAC_KEY,
    evidence(),
  );
  const targetInput = {
    targetClass: "canonical_production" as const,
    approvedDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
    forbiddenDatabaseFingerprint: SK104_FROZEN_DATABASE_FINGERPRINT,
    approvedStorageFingerprint:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
    forbiddenStorageFingerprint:
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const,
  };
  const target = bindSk104ProductionTarget(
    targetInput,
    sk104ProductionTargetPolicyDigest(targetInput),
  );
  return {
    privateManifest,
    manifest: buildSk104ProductionManifest({
      target,
      sourceSchemaFingerprint: privateManifest.sourceSchemaFingerprint,
      targetSchemaFingerprint: sha256Digest(canonicalJson(postCatalogRows)),
      resetRowsFingerprint: privateManifest.resetRowsFingerprint,
      preservedRowCountsFingerprint: privateManifest.preservedRowCountsFingerprint,
      preservedBusinessFingerprint: privateManifest.preservedBusinessFingerprint,
      storageReferencesFingerprint: privateManifest.storageReferencesFingerprint,
      storageEnumerationFingerprint: sha256Digest("sk104-test-storage-enumeration"),
      mockEvidenceFingerprint: privateManifest.mockEvidenceFingerprint,
    }),
  };
}

function approval(
  manifest: Sk104ProductionManifest,
  action: "execute" | "restore",
): Sk104CutoverApproval {
  return bindSk104CutoverApproval({
    manifest,
    action,
    manifestDigest: manifest.digest,
    targetDatabaseFingerprint: manifest.target.approvedDatabaseFingerprint,
    targetStorageFingerprint: manifest.target.approvedStorageFingerprint,
    targetPolicyDigest: manifest.target.policyDigest,
    databaseRestorePointFingerprint: sha256Digest("sk104-test-database-restore-point"),
    storageRestorePointFingerprint: sha256Digest("sk104-test-storage-restore-point"),
    migrationBundleDigest,
    executionPlanDigest: sha256Digest(`sk104-test-${action}-plan`),
    approvalChallengeToken: protectValue(HMAC_KEY, `sk104-test-${action}-challenge`),
    approvedAt: "2026-07-22T10:00:00.000Z",
    expiresAt: "2026-07-22T10:05:00.000Z",
  });
}

function pool(client: NeonPoolClientLike): NeonPoolLike {
  return { connect: vi.fn(() => Promise.resolve(client)) };
}

function adapter(
  client: NeonPoolClientLike,
  snapshotContext: Readonly<{
    manifest: Sk104ProductionManifest;
    privateManifest: Sk104PrivateProductionDatabaseManifest;
    hmacKey: string;
  }> | null = null,
): Sk104ProductionDatabaseAdapter {
  return new Sk104ProductionDatabaseAdapter(
    pool(client),
    {
      connect: vi.fn(() =>
        Promise.reject(new Error("concurrent probe must not run in a read-only verifier")),
      ),
    },
    pool(client),
    () => new Date("2026-07-22T10:01:00.000Z"),
    snapshotContext,
  );
}

function source(): string {
  return readFileSync(new URL("./database.ts", import.meta.url), "utf8");
}

describe("SK-104 production database adapter", () => {
  it("holds one canonical crash-released lease around the whole operation", async () => {
    const events: string[] = [];
    const query = vi.fn((statement: string, parameters?: readonly unknown[]) => {
      const rawKey = parameters?.[0];
      events.push(`${statement}:${typeof rawKey === "string" ? rawKey : ""}`);
      if (statement === "SELECT 1 /* sk104-test-target-observation */") {
        return Promise.resolve({ rows: [{ observed: 1 }] });
      }
      if (statement.includes("pg_try_advisory_lock")) {
        expect([
          SK104_RUN_LEASE_ADVISORY_LOCK_KEY,
          SK104_CHILD_RESTORE_ADVISORY_LOCK_KEY,
          PARENT_PROOF_LOCK,
        ]).toContain(parameters?.[0]);
        return Promise.resolve({ rows: [{ acquired: true }] });
      }
      if (statement.includes("pg_advisory_unlock")) {
        expect([
          SK104_RUN_LEASE_ADVISORY_LOCK_KEY,
          SK104_CHILD_RESTORE_ADVISORY_LOCK_KEY,
          PARENT_PROOF_LOCK,
        ]).toContain(parameters?.[0]);
        return Promise.resolve({ rows: [{ released: true }] });
      }
      return Promise.reject(new Error("unexpected lease query"));
    });
    const releaseClient = vi.fn();
    const client: NeonPoolClientLike = {
      query: query as unknown as NeonPoolClientLike["query"],
      release: releaseClient,
    };
    const operation = vi.fn((lease: Readonly<{ parentProofAdvisoryLockKey: string }>) => {
      expect(lease.parentProofAdvisoryLockKey).toBe(PARENT_PROOF_LOCK);
      events.push("operation");
      return Promise.resolve("done");
    });

    await expect(
      adapter(client).withExclusiveRunLease(
        {
          approvedDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
          forbiddenDatabaseFingerprint: SK104_FROZEN_DATABASE_FINGERPRINT,
          parentProofAdvisoryLockKey: PARENT_PROOF_LOCK,
        },
        operation,
      ),
    ).resolves.toBe("done");
    const operationIndex = events.indexOf("operation");
    expect(
      events.findIndex(
        (event) =>
          event.includes("pg_advisory_unlock") &&
          event.endsWith(`:${SK104_CHILD_RESTORE_ADVISORY_LOCK_KEY}`),
      ),
    ).toBeLessThan(operationIndex);
    for (const key of [PARENT_PROOF_LOCK, SK104_RUN_LEASE_ADVISORY_LOCK_KEY]) {
      expect(operationIndex).toBeLessThan(
        events.findIndex(
          (event) => event.includes("pg_advisory_unlock") && event.endsWith(`:${key}`),
        ),
      );
    }
    expect(releaseClient).toHaveBeenCalledOnce();
  });

  it("rejects a second runner before its operation starts", async () => {
    const query = vi.fn((statement: string) => {
      if (statement === "SELECT 1 /* sk104-test-target-observation */") {
        return Promise.resolve({ rows: [{ observed: 1 }] });
      }
      if (statement.includes("pg_try_advisory_lock")) {
        return Promise.resolve({ rows: [{ acquired: false }] });
      }
      return Promise.reject(new Error("unexpected lease query"));
    });
    const client: NeonPoolClientLike = {
      query: query as unknown as NeonPoolClientLike["query"],
      release: vi.fn(),
    };
    const operation = vi.fn(() => Promise.resolve());

    await expect(
      adapter(client).withExclusiveRunLease(
        {
          approvedDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
          forbiddenDatabaseFingerprint: SK104_FROZEN_DATABASE_FINGERPRINT,
          parentProofAdvisoryLockKey: PARENT_PROOF_LOCK,
        },
        operation,
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "LOCK_CONTRACT_INVALID" }));
    expect(operation).not.toHaveBeenCalled();
  });

  it("uses a dedicated lease pool so leased work can use the transaction pool", async () => {
    const leaseQuery = vi.fn((statement: string) => {
      if (statement === "SELECT 1 /* sk104-test-target-observation */") {
        return Promise.resolve({ rows: [{ observed: 1 }] });
      }
      if (statement.includes("pg_try_advisory_lock")) {
        return Promise.resolve({ rows: [{ acquired: true }] });
      }
      if (statement.includes("pg_advisory_unlock")) {
        return Promise.resolve({ rows: [{ released: true }] });
      }
      return Promise.reject(new Error("unexpected lease query"));
    });
    const releaseLeaseClient = vi.fn();
    const leaseClient: NeonPoolClientLike = {
      query: leaseQuery as unknown as NeonPoolClientLike["query"],
      release: releaseLeaseClient,
    };
    const releaseTransactionClient = vi.fn();
    const transactionClient = {
      release: releaseTransactionClient,
    } as unknown as NeonPoolClientLike;
    const connectTransaction = vi.fn(() => Promise.resolve(transactionClient));
    const transactionPool: NeonPoolLike = {
      connect: connectTransaction,
    };
    const connectLease = vi.fn(() => Promise.resolve(leaseClient));
    const leasePool: NeonPoolLike = {
      connect: connectLease,
    };
    const active = new Sk104ProductionDatabaseAdapter(
      transactionPool,
      { connect: vi.fn(() => Promise.reject(new Error("unused probe"))) },
      leasePool,
      () => new Date("2026-07-22T10:01:00.000Z"),
    );

    await active.withExclusiveRunLease(
      {
        approvedDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
        forbiddenDatabaseFingerprint: SK104_FROZEN_DATABASE_FINGERPRINT,
        parentProofAdvisoryLockKey: PARENT_PROOF_LOCK,
      },
      async () => {
        const client = await transactionPool.connect();
        client.release();
      },
    );
    expect(connectLease).toHaveBeenCalledOnce();
    expect(connectTransaction).toHaveBeenCalledOnce();
    expect(releaseTransactionClient).toHaveBeenCalledOnce();
    expect(releaseLeaseClient).toHaveBeenCalledOnce();
  });

  it("rejects an orphaned restore child before the operation starts", async () => {
    const query = vi.fn((statement: string, parameters?: readonly unknown[]) => {
      if (statement === "SELECT 1 /* sk104-test-target-observation */") {
        return Promise.resolve({ rows: [{ observed: 1 }] });
      }
      if (statement.includes("pg_try_advisory_lock")) {
        return Promise.resolve({
          rows: [
            {
              acquired: parameters?.[0] === SK104_RUN_LEASE_ADVISORY_LOCK_KEY,
            },
          ],
        });
      }
      if (statement.includes("pg_advisory_unlock")) {
        return Promise.resolve({ rows: [{ released: true }] });
      }
      return Promise.reject(new Error("unexpected lease query"));
    });
    const releaseClient = vi.fn();
    const client: NeonPoolClientLike = {
      query: query as unknown as NeonPoolClientLike["query"],
      release: releaseClient,
    };
    const operation = vi.fn(() => Promise.resolve());

    await expect(
      adapter(client).withExclusiveRunLease(
        {
          approvedDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
          forbiddenDatabaseFingerprint: SK104_FROZEN_DATABASE_FINGERPRINT,
          parentProofAdvisoryLockKey: PARENT_PROOF_LOCK,
        },
        operation,
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "LOCK_CONTRACT_INVALID" }));
    expect(operation).not.toHaveBeenCalled();
    expect(releaseClient).toHaveBeenCalledOnce();
  });

  it("discovers and privately binds the exact current database inventory", async () => {
    const events: string[] = [];
    const manifest = await discoverSk104PrivateProductionDatabaseManifest(
      discoveryClient({ events }),
      HMAC_KEY,
      evidence(),
    );

    expect(manifest.rows).toHaveLength(114);
    expect(manifest.storageReferences).toHaveLength(9);
    expect(manifest.mockEvidence.identities).toHaveLength(5);
    expect(manifest.mockEvidence.monetaryRows).toHaveLength(5);
    expect(manifest.mockEvidence.providerReferences).toHaveLength(7);
    expect(manifest.resetRowsFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(manifest.preservedBusinessFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(manifest.bindingToken).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    expect(assertSk104PrivateProductionDatabaseManifest(manifest, HMAC_KEY)).toBe(manifest);
    expect(
      events.some((statement) =>
        statement.includes(
          'ORDER BY ("id"::text) COLLATE "C", "clerk_user_id" COLLATE "C"',
        ),
      ),
    ).toBe(true);
    expect(
      events.some((statement) => statement.includes('ORDER BY "owner_id" COLLATE "C"')),
    ).toBe(false);
    expect(
      events.some((statement) =>
        statement.includes(
          `ORDER BY concat("producer_id"::text, '/', "client_contact_id"::text) COLLATE "C"`,
        ),
      ),
    ).toBe(true);
    expect(
      events.some(
        (statement) =>
          statement.includes('"information_schema"."columns"') &&
          statement.includes("pending_audio_%"),
      ),
    ).toBe(true);

    expect(() =>
      assertSk104PrivateProductionDatabaseManifest(
        {
          ...manifest,
          rows: manifest.rows.map((row, index) =>
            index === 0 ? { ...row, id: uuid(999_999) } : row,
          ),
        },
        HMAC_KEY,
      ),
    ).toThrow(expect.objectContaining({ code: "PRIVATE_ENVELOPE_MISMATCH" }));
  });

  it("stops on one added row or any live payment signal", async () => {
    await expect(
      discoverSk104PrivateProductionDatabaseManifest(
        discoveryClient({ notificationDelta: 1 }),
        HMAC_KEY,
        evidence(),
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "FINAL_DRIFT_DETECTED" }));

    await expect(
      discoverSk104PrivateProductionDatabaseManifest(
        discoveryClient({ prohibitedCount: 1 }),
        HMAC_KEY,
        evidence(),
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "LIVE_PAYMENT_ACTIVITY" }));
  });

  it("holds one verified read-only snapshot open until the backup callback finishes", async () => {
    const fixture = await cutoverFixture();
    const events: string[] = [];
    const client = discoveryClient({ events, snapshot: "00000009-0000002A-1" });
    const database = adapter(client, { ...fixture, hmacKey: HMAC_KEY });
    const snapshotPort: Sk104VerifiedSnapshotPort = database;
    expect(snapshotPort).toBe(database);
    let releaseCallback!: () => void;
    const callbackGate = new Promise<void>((resolve) => {
      releaseCallback = resolve;
    });
    let callbackStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      callbackStarted = resolve;
    });

    const result = database.withVerifiedExportedSnapshot(async (snapshot) => {
      expect(snapshot).toBe("00000009-0000002A-1");
      events.push("CALLBACK_STARTED");
      callbackStarted();
      await callbackGate;
      events.push("CALLBACK_FINISHED");
      return "backup-complete";
    });

    await started;
    expect(events).toContain("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(events).not.toContain("ROLLBACK");
    expect(events).not.toContain("RELEASE");
    releaseCallback();
    await expect(result).resolves.toBe("backup-complete");

    const targetAt = events.indexOf("SELECT 1 /* sk104-test-target-observation */");
    const beginAt = events.indexOf("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const exportAt = events.findIndex((event) => event.includes("pg_export_snapshot()"));
    const callbackFinishedAt = events.indexOf("CALLBACK_FINISHED");
    const rollbackAt = events.indexOf("ROLLBACK");
    const releaseAt = events.indexOf("RELEASE");
    expect([targetAt, beginAt, exportAt, callbackFinishedAt, rollbackAt, releaseAt]).toEqual(
      [...[targetAt, beginAt, exportAt, callbackFinishedAt, rollbackAt, releaseAt]].sort(
        (left, right) => left - right,
      ),
    );

    const driftEvents: string[] = [];
    await expect(
      adapter(
        discoveryClient({ notificationDelta: 1, events: driftEvents }),
      ).withVerifiedExportedSnapshot({ ...fixture, hmacKey: HMAC_KEY }, () => Promise.resolve()),
    ).rejects.toThrow(expect.objectContaining({ code: "FINAL_DRIFT_DETECTED" }));
    expect(driftEvents.some((event) => event.includes("pg_export_snapshot()"))).toBe(false);
    expect(driftEvents).toContain("ROLLBACK");
    expect(driftEvents.at(-1)).toBe("RELEASE");

    const ledgerEvents: string[] = [];
    await expect(
      adapter(
        discoveryClient({ baselineLedger: "empty", events: ledgerEvents }),
      ).withVerifiedExportedSnapshot({ ...fixture, hmacKey: HMAC_KEY }, () => Promise.resolve()),
    ).rejects.toThrow(expect.objectContaining({ code: "MIGRATION_DIGEST_MISMATCH" }));
    expect(ledgerEvents.some((event) => event.includes("pg_export_snapshot()"))).toBe(false);
  });

  it("observes only the exact baseline, exact post-state, or mixed state", async () => {
    const fixture = await cutoverFixture();
    const input = {
      ...fixture,
      hmacKey: HMAC_KEY,
      expectedMigrationBundleDigest: migrationBundleDigest,
    };

    const baseline = await adapter(discoveryClient()).observeState(input);
    expect(baseline.state).toBe("baseline");
    if (baseline.state !== "baseline") throw new Error("expected exact baseline");
    expect(baseline.databaseStateFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);

    const post = await adapter(
      discoveryClient({ state: "post", catalogRows: postCatalogRows, ledgerRows }),
    ).observeState(input);
    expect(post.state).toBe("post");
    if (post.state !== "post") throw new Error("expected exact post-state");
    expect(post.migrationBundleDigest).toBe(migrationBundleDigest);
    expect(post.databaseStateFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    await expect(adapter(discoveryClient({ state: "mixed" })).observeState(input)).resolves.toEqual(
      { state: "mixed" },
    );
    await expect(
      adapter(
        discoveryClient({
          state: "post",
          catalogRows: postCatalogRows,
          ledgerRows: ledgerRows.map((row, index) =>
            index === 0 ? { ...row, digest: "f".repeat(64) } : row,
          ),
        }),
      ).observeState(input),
    ).resolves.toEqual({ state: "mixed" });
  });

  it("reconciles a lost COMMIT response from exact post-state without rerunning mutations", async () => {
    const fixture = await cutoverFixture();
    const executeApproval = approval(fixture.manifest, "execute");
    const events: string[] = [];
    const database = adapter(
      discoveryClient({ state: "post", catalogRows: postCatalogRows, ledgerRows, events }),
    );
    const input = {
      ...fixture,
      hmacKey: HMAC_KEY,
      approval: executeApproval,
    };

    const receipt = await database.reconcileCommitted(input);
    expect(receipt).toMatchObject({
      contract: "sk104-production-database-receipt-v1",
      manifestDigest: fixture.manifest.digest,
      approvalDigest: executeApproval.digest,
      migrationBundleDigest,
      deletedRowCount: 114,
      sourceSchemaFingerprint: fixture.privateManifest.sourceSchemaFingerprint,
      targetSchemaFingerprint: fixture.manifest.targetSchemaFingerprint,
      preservedRowCountsFingerprint: fixture.manifest.preservedRowCountsFingerprint,
      preservedBusinessFingerprint: fixture.manifest.preservedBusinessFingerprint,
      committed: true,
    });
    const mutatingStatements = events.filter((statement) =>
      /^(?:DELETE|UPDATE|INSERT|ALTER|CREATE|DROP|TRUNCATE|LOCK|COMMIT)\b/i.test(statement.trim()),
    );
    expect(mutatingStatements).toEqual([]);

    const repeated = await adapter(
      discoveryClient({ state: "post", catalogRows: postCatalogRows, ledgerRows }),
    ).reconcileCommitted(input);
    expect(repeated).toEqual(receipt);
    await expect(
      adapter(discoveryClient()).reconcileCommitted({
        ...input,
        approval: approval(fixture.manifest, "restore"),
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "FRESH_TARGET_AUTHORIZATION_INVALID" }));
  });

  it("verifies an exact restored baseline and rejects post or drifted data", async () => {
    const fixture = await cutoverFixture();
    const restoreApproval = approval(fixture.manifest, "restore");
    const input = {
      ...fixture,
      hmacKey: HMAC_KEY,
      approval: restoreApproval,
    };

    await expect(adapter(discoveryClient()).verifyRestoredBaseline(input)).resolves.toMatchObject({
      contract: "sk104-restored-baseline-receipt-v1",
      manifestDigest: fixture.manifest.digest,
      approvalDigest: restoreApproval.digest,
      sourceSchemaFingerprint: fixture.privateManifest.sourceSchemaFingerprint,
      resetRowsFingerprint: fixture.privateManifest.resetRowsFingerprint,
      preservedRowCountsFingerprint: fixture.privateManifest.preservedRowCountsFingerprint,
      preservedBusinessFingerprint: fixture.privateManifest.preservedBusinessFingerprint,
      storageReferencesFingerprint: fixture.privateManifest.storageReferencesFingerprint,
      verified: true,
    });
    await expect(
      adapter(
        discoveryClient({ state: "post", catalogRows: postCatalogRows, ledgerRows }),
      ).verifyRestoredBaseline(input),
    ).rejects.toThrow(expect.objectContaining({ code: "RESTORE_PROOF_MISMATCH" }));
    await expect(
      adapter(discoveryClient({ notificationDelta: 1 })).verifyRestoredBaseline(input),
    ).rejects.toThrow(expect.objectContaining({ code: "RESTORE_PROOF_MISMATCH" }));
    for (const baselineLedger of ["empty", "applied"] as const) {
      await expect(
        adapter(discoveryClient({ baselineLedger })).verifyRestoredBaseline(input),
      ).rejects.toThrow(expect.objectContaining({ code: "RESTORE_PROOF_MISMATCH" }));
      await expect(
        adapter(discoveryClient({ baselineLedger })).observeState({
          ...fixture,
          hmacKey: HMAC_KEY,
          expectedMigrationBundleDigest: migrationBundleDigest,
        }),
      ).resolves.toEqual({ state: "mixed" });
    }
  });

  it("keeps the complete cutover in one ordered, rollback-safe transaction", () => {
    const adapter = source();
    const execute = adapter.slice(adapter.indexOf("async execute("));

    expect(SK104_REQUIRED_LOCK_TABLES).toHaveLength(20);
    expect(SK104_APPROVED_MIGRATION_FILES).toEqual([
      "0027_purchase_foundation.sql",
      "0028_stable_client_ownership.sql",
      "0029_private_offer_recipient_identity.sql",
      "0030_song_release_state.sql",
      "0031_purchase_ledger_runtime.sql",
      "0032_purchase_session_allowance.sql",
      "0033_purchase_version_download_overrides.sql",
      "0034_song_public_access.sql",
    ]);
    expect(SK104_DATABASE_ADVISORY_LOCK_KEY).not.toBe("7468258445703257129");
    expect(execute).toMatch(
      /BEGIN ISOLATION LEVEL SERIALIZABLE[\s\S]*SK90_MIGRATION_ADVISORY_LOCK_KEY[\s\S]*SK104_DATABASE_ADVISORY_LOCK_KEY[\s\S]*SK104_REQUIRED_LOCK_TABLES[\s\S]*observeProductionDatabaseTarget[\s\S]*discoverSk104PrivateProductionDatabaseManifest[\s\S]*assertConcurrentWriteStop[\s\S]*stageProviderEvidence[\s\S]*breakResetCycles[\s\S]*deleteExactRows[\s\S]*applyApprovedBundleInTransaction[\s\S]*collectPostResetDatabaseEvidence[\s\S]*COMMIT/,
    );
    expect(execute).toMatch(
      /buildDatabaseReceipt\([\s\S]*assertFresh\(\);\s*await client\.query\("COMMIT"\)/,
    );
    expect(execute).toMatch(/catch \(error\)[\s\S]*ROLLBACK/);
    expect(execute).not.toMatch(/drizzle-kit|db:migrate/);
  });
});
