import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  approvalLedgerDirectoryFingerprint,
  consumeExecutableResetApproval,
  recordExecutableResetRunState,
  type ApprovalConsumptionReceipt,
} from "./approval-consumption";
import { protectValue, sha256Digest } from "./canonical";
import { FileDurableRunStateStore, ZERO_MUTATIONS } from "./durable-state";
import { bindExecutableResetApproval } from "./execution";
import { writeOwnerOnlyUtf8Atomic } from "./private-envelope";

const HMAC_KEY = "approval-consumption-test-key-at-least-32-bytes";
const roots: string[] = [];

function approval(ledgerFingerprint: ReturnType<typeof sha256Digest>) {
  return bindExecutableResetApproval({
    contract: "sk90-executable-reset-approval-v1",
    artifactDigest: sha256Digest("artifact"),
    manifestDigest: sha256Digest("manifest"),
    policyDigest: sha256Digest("policy"),
    targetDatabaseFingerprint: sha256Digest("database"),
    targetStorageFingerprint: sha256Digest("storage"),
    resetPlanDigest: sha256Digest("plan"),
    migrationDigest: sha256Digest("migration"),
    privateEnvelopeDigest: sha256Digest("envelope"),
    approvalLedgerDirectoryFingerprint: ledgerFingerprint,
    evidenceObservationDigest: sha256Digest("evidence"),
    preStorageNamespaceFingerprint: sha256Digest("pre-storage"),
    postStorageNamespaceFingerprint: sha256Digest("post-storage"),
    databaseRestorePointFingerprint: sha256Digest("database-restore"),
    storageRestorePointFingerprint: sha256Digest("storage-restore"),
    approvalChallengeToken: protectValue(HMAC_KEY, "one approved execution"),
    approvedAt: "2026-07-17T12:00:00.000Z",
    expiresAt: "2026-07-17T12:05:00.000Z",
  });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sk90-approval-consumption-"));
  roots.push(root);
  const approvalFilePath = join(root, "approval.json");
  const approvalLedgerDirectory = join(root, "approval-ledger");
  await writeOwnerOnlyUtf8Atomic(approvalFilePath, "private approval material");
  await mkdir(approvalLedgerDirectory, { mode: 0o700 });
  return {
    root,
    approvalFilePath,
    approvalLedgerDirectory,
    stateDirectory: join(root, "state-one"),
  };
}

async function approvedFor(paths: Awaited<ReturnType<typeof fixture>>) {
  return approval(
    approvalLedgerDirectoryFingerprint(await realpath(paths.approvalLedgerDirectory)),
  );
}

function initialRunInput(
  exactApproval: ReturnType<typeof approval>,
  consumption: ApprovalConsumptionReceipt,
) {
  const targetObservationDigest = sha256Digest("target-observation");
  return {
    bindings: {
      artifactDigest: exactApproval.artifactDigest,
      manifestDigest: exactApproval.manifestDigest,
      targetPolicyDigest: exactApproval.policyDigest,
      targetDatabaseFingerprint: exactApproval.targetDatabaseFingerprint,
      targetStorageFingerprint: exactApproval.targetStorageFingerprint,
      approvedTargetObservationDigest: targetObservationDigest,
      executionApprovalDigest: exactApproval.digest,
      migrationDigest: exactApproval.migrationDigest,
      privateEnvelopeDigest: exactApproval.privateEnvelopeDigest,
      resetPlanDigest: exactApproval.resetPlanDigest,
      evidenceObservationDigest: exactApproval.evidenceObservationDigest,
      databaseRestorePointFingerprint: exactApproval.databaseRestorePointFingerprint,
      storageRestorePointFingerprint: exactApproval.storageRestorePointFingerprint,
      preStorageNamespaceFingerprint: exactApproval.preStorageNamespaceFingerprint,
      postStorageNamespaceFingerprint: exactApproval.postStorageNamespaceFingerprint,
      runInstanceMarkerDigest: consumption.runInstanceMarkerDigest,
    },
    prepareReceipt: {
      action: "prepare" as const,
      artifactDigest: exactApproval.artifactDigest,
      targetObservationDigest,
      challengeToken: null,
      issuedAt: null,
      expiresAt: null,
      receiptDigest: sha256Digest("prepare-receipt"),
      mutations: ZERO_MUTATIONS,
      postStateFingerprint: null,
    },
  };
}

function consumptionInput(
  paths: Awaited<ReturnType<typeof fixture>>,
  exactApproval: ReturnType<typeof approval>,
) {
  return {
    approval: exactApproval,
    approvedDigest: exactApproval.digest,
    approvalFilePath: paths.approvalFilePath,
    approvalLedgerDirectory: paths.approvalLedgerDirectory,
    stateDirectory: paths.stateDirectory,
    hmacKey: HMAC_KEY,
    now: new Date("2026-07-17T12:01:00.000Z"),
  } as const;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("SK-90 executable approval one-time consumption", () => {
  it("publishes one owner-only receipt and permits only same-directory crash recovery", async () => {
    const paths = await fixture();
    const exactApproval = await approvedFor(paths);
    const input = {
      approval: exactApproval,
      approvedDigest: exactApproval.digest,
      approvalFilePath: paths.approvalFilePath,
      approvalLedgerDirectory: paths.approvalLedgerDirectory,
      stateDirectory: paths.stateDirectory,
      hmacKey: HMAC_KEY,
      now: new Date("2026-07-17T12:01:00.000Z"),
    } as const;

    const first = await consumeExecutableResetApproval(input);
    const recoveredAfterExpiry = await consumeExecutableResetApproval({
      ...input,
      now: new Date("2026-07-17T12:06:00.000Z"),
    });
    expect(recoveredAfterExpiry).toEqual(first);

    const files = await readdir(paths.approvalLedgerDirectory);
    const receiptName = files.find((name) => name.endsWith(".consumed.json"));
    expect(receiptName).toBeDefined();
    const receiptPath = join(paths.approvalLedgerDirectory, receiptName ?? "missing");
    expect((await lstat(receiptPath)).mode & 0o777).toBe(0o600);
    const serialized = await readFile(receiptPath, "utf8");
    expect(serialized).not.toContain(paths.approvalFilePath);
    expect(serialized).not.toContain(paths.approvalLedgerDirectory);
    expect(serialized).not.toContain(paths.stateDirectory);

    await expect(
      consumeExecutableResetApproval({
        ...input,
        stateDirectory: join(paths.root, "state-two"),
      }),
    ).rejects.toMatchObject({ code: "FRESHNESS_NONCE_REUSED" });
  });

  it("turns concurrent same-directory initialization into one exact receipt", async () => {
    const paths = await fixture();
    const exactApproval = await approvedFor(paths);
    const input = {
      approval: exactApproval,
      approvedDigest: exactApproval.digest,
      approvalFilePath: paths.approvalFilePath,
      approvalLedgerDirectory: paths.approvalLedgerDirectory,
      stateDirectory: paths.stateDirectory,
      hmacKey: HMAC_KEY,
      now: new Date("2026-07-17T12:01:00.000Z"),
    } as const;

    const [left, right] = await Promise.all([
      consumeExecutableResetApproval(input),
      consumeExecutableResetApproval(input),
    ]);
    expect(left).toEqual(right);
    expect(
      (await readdir(paths.approvalLedgerDirectory)).filter((name) =>
        name.endsWith(".consumed.json"),
      ),
    ).toHaveLength(1);
  });

  it("rejects a substituted digest and a tampered consumption receipt", async () => {
    const paths = await fixture();
    const exactApproval = await approvedFor(paths);
    await expect(
      consumeExecutableResetApproval({
        approval: exactApproval,
        approvedDigest: sha256Digest("different approval"),
        approvalFilePath: paths.approvalFilePath,
        approvalLedgerDirectory: paths.approvalLedgerDirectory,
        stateDirectory: paths.stateDirectory,
        hmacKey: HMAC_KEY,
        now: new Date("2026-07-17T12:01:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "EXECUTION_APPROVAL_MISMATCH" });

    await consumeExecutableResetApproval({
      approval: exactApproval,
      approvedDigest: exactApproval.digest,
      approvalFilePath: paths.approvalFilePath,
      approvalLedgerDirectory: paths.approvalLedgerDirectory,
      stateDirectory: paths.stateDirectory,
      hmacKey: HMAC_KEY,
      now: new Date("2026-07-17T12:01:00.000Z"),
    });
    const receiptName = (await readdir(paths.approvalLedgerDirectory)).find((name) =>
      name.endsWith(".consumed.json"),
    );
    if (!receiptName) throw new Error("missing test receipt");
    const receiptPath = join(paths.approvalLedgerDirectory, receiptName);
    const parsed = JSON.parse(await readFile(receiptPath, "utf8")) as Record<string, unknown>;
    parsed.stateDirectoryFingerprint = sha256Digest("tampered directory");
    await writeFile(receiptPath, JSON.stringify(parsed), { mode: 0o600 });

    await expect(
      consumeExecutableResetApproval({
        approval: exactApproval,
        approvedDigest: exactApproval.digest,
        approvalFilePath: paths.approvalFilePath,
        approvalLedgerDirectory: paths.approvalLedgerDirectory,
        stateDirectory: paths.stateDirectory,
        hmacKey: HMAC_KEY,
        now: new Date("2026-07-17T12:02:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "EXECUTION_APPROVAL_MISMATCH" });
  });

  it("rejects a copied signed bundle before it can claim a new ledger sidecar", async () => {
    const original = await fixture();
    const copied = await fixture();
    const exactApproval = await approvedFor(original);
    const baseInput = {
      approval: exactApproval,
      approvedDigest: exactApproval.digest,
      hmacKey: HMAC_KEY,
      now: new Date("2026-07-17T12:01:00.000Z"),
    } as const;

    const originalReceipt = await consumeExecutableResetApproval({
      ...baseInput,
      approvalFilePath: original.approvalFilePath,
      approvalLedgerDirectory: original.approvalLedgerDirectory,
      stateDirectory: original.stateDirectory,
    });
    const movedBundleRecovery = await consumeExecutableResetApproval({
      ...baseInput,
      approvalFilePath: copied.approvalFilePath,
      approvalLedgerDirectory: original.approvalLedgerDirectory,
      stateDirectory: original.stateDirectory,
      now: new Date("2026-07-17T12:06:00.000Z"),
    });
    expect(movedBundleRecovery).toEqual(originalReceipt);

    await expect(
      consumeExecutableResetApproval({
        ...baseInput,
        approvalFilePath: copied.approvalFilePath,
        approvalLedgerDirectory: copied.approvalLedgerDirectory,
        stateDirectory: copied.stateDirectory,
      }),
    ).rejects.toMatchObject({ code: "EXECUTION_APPROVAL_MISMATCH" });
    expect(await readdir(copied.approvalLedgerDirectory)).toEqual([]);
  });

  it("rejects replay after the initialized runner state directory is removed and recreated", async () => {
    const paths = await fixture();
    const exactApproval = await approvedFor(paths);
    const input = consumptionInput(paths, exactApproval);
    const consumption = await consumeExecutableResetApproval(input);
    const store = new FileDurableRunStateStore(
      join(paths.stateDirectory, "runner"),
      HMAC_KEY,
      (state) =>
        recordExecutableResetRunState({
          approval: exactApproval,
          consumption,
          approvalLedgerDirectory: paths.approvalLedgerDirectory,
          stateDirectory: paths.stateDirectory,
          hmacKey: HMAC_KEY,
          state,
        }),
    );
    await store.initialize(initialRunInput(exactApproval, consumption));

    await rm(paths.stateDirectory, { recursive: true });
    await mkdir(paths.stateDirectory, { mode: 0o700 });

    await expect(consumeExecutableResetApproval(input)).rejects.toMatchObject({
      code: "FRESHNESS_NONCE_REUSED",
    });
  });

  it("reconciles only the one-state publish gap before its independent anchor", async () => {
    const paths = await fixture();
    const exactApproval = await approvedFor(paths);
    const input = consumptionInput(paths, exactApproval);
    const consumption = await consumeExecutableResetApproval(input);
    const store = new FileDurableRunStateStore(join(paths.stateDirectory, "runner"), HMAC_KEY);
    const initial = await store.initialize(initialRunInput(exactApproval, consumption));

    await expect(consumeExecutableResetApproval(input)).resolves.toEqual(consumption);
    const next = await store.transition(initial, (current) => ({
      ...current,
      phase: "quarantine_started",
      activePurpose: { kind: "final" },
    }));
    await expect(consumeExecutableResetApproval(input)).resolves.toEqual(consumption);

    const anchors = (await readdir(paths.approvalLedgerDirectory)).filter((entry) =>
      entry.includes(".state-"),
    );
    expect(anchors).toHaveLength(2);
    expect(next.revision).toBe(1);
  });

  it("rejects a valid local state prefix after the latest revision is deleted", async () => {
    const paths = await fixture();
    const exactApproval = await approvedFor(paths);
    const input = consumptionInput(paths, exactApproval);
    const consumption = await consumeExecutableResetApproval(input);
    const store = new FileDurableRunStateStore(
      join(paths.stateDirectory, "runner"),
      HMAC_KEY,
      (state) =>
        recordExecutableResetRunState({
          approval: exactApproval,
          consumption,
          approvalLedgerDirectory: paths.approvalLedgerDirectory,
          stateDirectory: paths.stateDirectory,
          hmacKey: HMAC_KEY,
          state,
        }),
    );
    const initial = await store.initialize(initialRunInput(exactApproval, consumption));
    await store.transition(initial, (current) => ({
      ...current,
      phase: "quarantine_started",
      activePurpose: { kind: "final" },
    }));
    await rm(join(paths.stateDirectory, "runner.revision-000000000001.json"));

    await expect(consumeExecutableResetApproval(input)).rejects.toMatchObject({
      code: "DURABLE_STATE_INVALID",
    });
  });
});
