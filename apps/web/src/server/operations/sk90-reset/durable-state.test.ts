import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { protectValue, sha256Digest } from "./canonical";
import {
  FileDurableRunStateStore,
  ZERO_MUTATIONS,
  consumeDurableNonce,
  issueDurableNonce,
  recoveryDecision,
  type DurableOperationReceipt,
} from "./durable-state";

const HMAC_KEY = "durable-state-test-key-that-is-at-least-32-bytes";
const ARTIFACT = sha256Digest("artifact");
const MANIFEST = sha256Digest("manifest");
const POLICY = sha256Digest("policy");
const TARGET = sha256Digest("target");
const DATABASE_TARGET = sha256Digest("database-target");
const STORAGE_TARGET = sha256Digest("storage-target");
const EXECUTION = sha256Digest("execution");
const MIGRATION = sha256Digest("migration");
const ENVELOPE = sha256Digest("envelope");
const PLAN = sha256Digest("plan");
const EVIDENCE = sha256Digest("evidence");
const DATABASE_RESTORE = sha256Digest("database-restore");
const STORAGE_RESTORE = sha256Digest("storage-restore");
const STORAGE_PRE = sha256Digest("storage-pre");
const STORAGE_POST = sha256Digest("storage-post");
const directories: string[] = [];

async function stateStore(): Promise<{
  directory: string;
  basePath: string;
  store: FileDurableRunStateStore;
}> {
  const directory = await mkdtemp(join(tmpdir(), "sk90-state-"));
  directories.push(directory);
  const basePath = join(directory, "journal");
  return { directory, basePath, store: new FileDurableRunStateStore(basePath, HMAC_KEY) };
}

function prepareReceipt(): DurableOperationReceipt {
  return {
    action: "prepare",
    artifactDigest: ARTIFACT,
    targetObservationDigest: TARGET,
    challengeToken: null,
    issuedAt: null,
    expiresAt: null,
    receiptDigest: sha256Digest("prepare-receipt"),
    mutations: ZERO_MUTATIONS,
    postStateFingerprint: null,
  };
}

async function initialize(store: FileDurableRunStateStore) {
  return store.initialize({
    bindings: {
      artifactDigest: ARTIFACT,
      manifestDigest: MANIFEST,
      targetPolicyDigest: POLICY,
      targetDatabaseFingerprint: DATABASE_TARGET,
      targetStorageFingerprint: STORAGE_TARGET,
      approvedTargetObservationDigest: TARGET,
      executionApprovalDigest: EXECUTION,
      migrationDigest: MIGRATION,
      privateEnvelopeDigest: ENVELOPE,
      resetPlanDigest: PLAN,
      evidenceObservationDigest: EVIDENCE,
      databaseRestorePointFingerprint: DATABASE_RESTORE,
      storageRestorePointFingerprint: STORAGE_RESTORE,
      preStorageNamespaceFingerprint: STORAGE_PRE,
      postStorageNamespaceFingerprint: STORAGE_POST,
      runInstanceMarkerDigest: sha256Digest("run-instance"),
    },
    prepareReceipt: prepareReceipt(),
  });
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("SK-90 durable private run state", () => {
  it("publishes an HMAC-bound revision chain and rejects tampering", async () => {
    const { basePath, store } = await stateStore();
    const initial = await initialize(store);
    const next = await store.transition(initial, (current) => ({
      ...current,
      phase: "quarantine_started",
      activePurpose: { kind: "final" },
    }));
    expect(next.revision).toBe(1);
    expect(next.previousStateDigest).toBe(initial.stateDigest);
    expect((await store.load())?.stateDigest).toBe(next.stateDigest);

    const revisionPath = `${basePath}.revision-000000000001.json`;
    const parsed = JSON.parse(await readFile(revisionPath, "utf8")) as Record<string, unknown>;
    parsed.phase = "verified";
    await writeFile(revisionPath, JSON.stringify(parsed));
    await expect(store.load()).rejects.toMatchObject({ code: "PHASE_STATE_INVALID" });
  });

  it("uses an immutable revision claim as a real compare-and-swap", async () => {
    const { store } = await stateStore();
    const initial = await initialize(store);
    const attempts = await Promise.allSettled([
      store.transition(initial, (current) => ({
        ...current,
        phase: "quarantine_started",
        activePurpose: { kind: "final" },
      })),
      store.transition(initial, (current) => ({
        ...current,
        phase: "restore_started",
      })),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await store.load())?.revision).toBe(1);
  });

  it("durably binds a nonce to one action, target, artifact, and validity window", async () => {
    const { store } = await stateStore();
    const initial = await initialize(store);
    const challengeToken = protectValue(HMAC_KEY, "fresh-challenge");
    const issued = await issueDurableNonce(store, initial, {
      challengeToken,
      action: "database_reset",
      artifactDigest: ARTIFACT,
      targetObservationDigest: TARGET,
      issuedAt: "2026-07-17T10:00:00.000Z",
      expiresAt: "2026-07-17T10:01:00.000Z",
    });
    expect(issued.nonceLedger).toHaveLength(1);
    expect(issued.nonceLedger[0]?.consumedAt).toBeNull();

    const consumed = await consumeDurableNonce(store, issued, {
      challengeToken,
      action: "database_reset",
      artifactDigest: ARTIFACT,
      targetObservationDigest: TARGET,
      consumedAt: "2026-07-17T10:00:01.000Z",
    });
    expect(consumed.nonceLedger[0]?.consumedAt).toBe("2026-07-17T10:00:01.000Z");

    await expect(
      consumeDurableNonce(store, consumed, {
        challengeToken,
        action: "database_reset",
        artifactDigest: ARTIFACT,
        targetObservationDigest: TARGET,
        consumedAt: "2026-07-17T10:00:02.000Z",
      }),
    ).rejects.toMatchObject({ code: "FRESHNESS_NONCE_REUSED" });

    await expect(
      issueDurableNonce(store, consumed, {
        challengeToken,
        action: "database_reset",
        artifactDigest: ARTIFACT,
        targetObservationDigest: TARGET,
        issuedAt: "2026-07-17T10:00:02.000Z",
        expiresAt: "2026-07-17T10:01:02.000Z",
      }),
    ).rejects.toMatchObject({ code: "FRESHNESS_NONCE_REUSED" });
  });

  it("rejects action substitution, target substitution, and expired consumption", async () => {
    const { store } = await stateStore();
    const initial = await initialize(store);
    const challengeToken = protectValue(HMAC_KEY, "fresh-challenge");
    const issued = await issueDurableNonce(store, initial, {
      challengeToken,
      action: "post_reset_verify",
      artifactDigest: ARTIFACT,
      targetObservationDigest: TARGET,
      issuedAt: "2026-07-17T10:00:00.000Z",
      expiresAt: "2026-07-17T10:01:00.000Z",
    });

    for (const changed of [
      { action: "second_run" as const, targetObservationDigest: TARGET },
      { action: "post_reset_verify" as const, targetObservationDigest: sha256Digest("other") },
    ]) {
      await expect(
        consumeDurableNonce(store, issued, {
          challengeToken,
          artifactDigest: ARTIFACT,
          consumedAt: "2026-07-17T10:00:01.000Z",
          ...changed,
        }),
      ).rejects.toMatchObject({ code: "FRESHNESS_PROOF_INVALID" });
    }
    await expect(
      consumeDurableNonce(store, issued, {
        challengeToken,
        action: "post_reset_verify",
        artifactDigest: ARTIFACT,
        targetObservationDigest: TARGET,
        consumedAt: "2026-07-17T10:01:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "FRESHNESS_PROOF_INVALID" });
  });

  it.each([
    ["quarantine_started", "pre", "retry_operation"],
    ["quarantine_started", "quarantined", "reconcile_completed_operation"],
    ["database_reset_started", "database_committed", "reconcile_completed_operation"],
    ["storage_delete_started", "storage_deleted", "reconcile_completed_operation"],
    ["storage_delete_started", "mixed", "restore"],
    ["rollback_partial_database_committed", "database_committed", "continue"],
    ["rollback_partial_storage_delete_started", "database_committed", "restore"],
    ["rollback_partial_storage_delete_started", "mixed", "restore"],
    ["restore_started", "restored", "verify_restore"],
    ["restore_started", "mixed", "retry_restore"],
    ["restored", "pre", "continue"],
    ["second_run_started", "post_verified", "retry_operation"],
    ["verified", "post_verified", "complete"],
  ] as const)("maps %s + %s to %s", (phase, observation, expected) => {
    expect(recoveryDecision(phase, observation)).toBe(expected);
  });

  it("fails closed on mixed database state before a transactional reset can be reconciled", () => {
    expect(() => recoveryDecision("database_reset_started", "mixed")).toThrow(
      expect.objectContaining({ code: "DATABASE_VERIFICATION_MISMATCH" }),
    );
  });
});
