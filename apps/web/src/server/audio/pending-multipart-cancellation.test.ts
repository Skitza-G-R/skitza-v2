import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  canFinalizePendingMultipartCancellation,
  commitPendingMultipartActivityObservation,
} from "./pending-multipart-cancellation";

const SOURCE = readFileSync(
  new URL("./pending-multipart-cancellation.ts", import.meta.url),
  "utf8",
);

describe("durable multipart cancellation stability", () => {
  const now = new Date("2026-07-17T12:20:00.000Z");

  it("requires a delayed second clean observation before clearing the journal", () => {
    expect(
      canFinalizePendingMultipartCancellation({
        cancellationObservedAt: new Date("2026-07-17T12:19:30.001Z"),
        createAttemptedAt: null,
        completeAttemptedAt: null,
        partUrlsExpireAt: null,
        observedRemoteActivity: false,
        now,
      }),
    ).toBe(false);
    expect(
      canFinalizePendingMultipartCancellation({
        cancellationObservedAt: new Date("2026-07-17T12:19:00.000Z"),
        createAttemptedAt: null,
        completeAttemptedAt: null,
        partUrlsExpireAt: null,
        observedRemoteActivity: false,
        now,
      }),
    ).toBe(true);
  });

  it("never clears during observed activity or a recent ambiguous create", () => {
    expect(
      canFinalizePendingMultipartCancellation({
        cancellationObservedAt: new Date("2026-07-17T12:00:00.000Z"),
        createAttemptedAt: null,
        completeAttemptedAt: null,
        partUrlsExpireAt: null,
        observedRemoteActivity: true,
        now,
      }),
    ).toBe(false);
    expect(
      canFinalizePendingMultipartCancellation({
        cancellationObservedAt: new Date("2026-07-17T12:00:00.000Z"),
        createAttemptedAt: new Date("2026-07-17T12:19:00.000Z"),
        completeAttemptedAt: null,
        partUrlsExpireAt: null,
        observedRemoteActivity: false,
        verifiedRemoteAbsence: false,
        now,
      }),
    ).toBe(false);
  });

  it("clears attempt markers after the exact upload is aborted and the object is absent", () => {
    expect(
      canFinalizePendingMultipartCancellation({
        cancellationObservedAt: new Date("2026-07-17T12:19:59.999Z"),
        createAttemptedAt: new Date("2026-07-17T12:00:00.000Z"),
        completeAttemptedAt: new Date("2026-07-17T12:19:30.000Z"),
        partUrlsExpireAt: new Date("2026-07-17T12:19:45.000Z"),
        observedRemoteActivity: true,
        verifiedRemoteAbsence: true,
        now,
      }),
    ).toBe(true);
  });

  it("never time-clears the only owner of an issued signed-part capability", () => {
    const common = {
      cancellationObservedAt: new Date("2026-07-17T12:00:00.000Z"),
      createAttemptedAt: new Date("2026-07-17T12:00:00.000Z"),
      completeAttemptedAt: null,
      partUrlsExpireAt: new Date("2026-07-17T12:19:30.000Z"),
      observedRemoteActivity: false,
    } as const;

    expect(canFinalizePendingMultipartCancellation({ ...common, now })).toBe(false);
    expect(
      canFinalizePendingMultipartCancellation({
        ...common,
        now: new Date("2026-07-18T12:20:30.000Z"),
      }),
    ).toBe(false);
  });

  it("does not clear when a delayed signed part appears after an earlier clean abort", () => {
    const stable = {
      cancellationObservedAt: new Date("2026-07-17T12:00:00.000Z"),
      createAttemptedAt: null,
      completeAttemptedAt: null,
      partUrlsExpireAt: null,
      now,
    } as const;

    expect(
      canFinalizePendingMultipartCancellation({ ...stable, observedRemoteActivity: false }),
    ).toBe(true);
    expect(
      canFinalizePendingMultipartCancellation({ ...stable, observedRemoteActivity: true }),
    ).toBe(false);
  });

  it("waits through a durable ambiguous completion attempt", () => {
    expect(
      canFinalizePendingMultipartCancellation({
        cancellationObservedAt: new Date("2026-07-17T12:00:00.000Z"),
        createAttemptedAt: new Date("2026-07-17T12:00:00.000Z"),
        completeAttemptedAt: new Date("2026-07-17T12:19:30.000Z"),
        partUrlsExpireAt: null,
        observedRemoteActivity: false,
        now,
      }),
    ).toBe(false);
  });

  it("commits an unexpected remote-activity promotion before returning pending", async () => {
    let persisted: Date | null = null;
    const cancellationObservedAt = new Date("2026-07-17T12:00:00.000Z");

    await expect(
      commitPendingMultipartActivityObservation(
        { createAttemptedAt: null, cancellationObservedAt },
        (effectiveCreateAttemptedAt) => {
          persisted = effectiveCreateAttemptedAt;
          return Promise.resolve();
        },
      ),
    ).rejects.toMatchObject({ code: "RECONCILIATION_PENDING" });
    expect(persisted).toEqual(cancellationObservedAt);
  });

  it("keeps the caller pending whenever the durable recovery owner is retained", () => {
    const retainedReturns = SOURCE.match(/return eraseRecoveryIdentity;/g) ?? [];
    expect(retainedReturns).toHaveLength(2);
    expect(SOURCE).toContain(": { audioDeletedAt: input.audioDeletedAt }");
  });

  it("journals uploads discovered by every post-abort observation", () => {
    const initializing = SOURCE.slice(
      SOURCE.indexOf("async function finishInitializingAudioCancellation"),
      SOURCE.indexOf("async function refreshCancellationObservation"),
    );
    const bound = SOURCE.slice(SOURCE.indexOf("async function finishPendingAudioCancellation"));

    expect(initializing).toMatch(
      /const uploadsAfterAbort = await listExactMultipartUploadIds[\s\S]*uploadsAfterAbort\.length !== 0[\s\S]*refreshCancellationObservation/,
    );
    expect(bound).toMatch(
      /const remainingUploadIds = await listExactMultipartUploadIds[\s\S]*remainingUploadIds\.length > 0[\s\S]*refreshCancellationObservation[\s\S]*const uploadsAfterAbort = await listExactMultipartUploadIds[\s\S]*uploadsAfterAbort\.length !== 0[\s\S]*refreshCancellationObservation/,
    );
  });

  it("keeps legacy completes fail-closed and orders abort before protected terminal sealing", () => {
    const reconcile = SOURCE.slice(
      SOURCE.indexOf("export async function reconcilePendingMultipartCancellation"),
      SOURCE.indexOf("export type PendingMultipartCancellationExpectedIdentity"),
    );
    const abort = reconcile.indexOf("await port.abortExact(input)");
    const rolloutGate = reconcile.indexOf("if (!input.terminalSealAllowed) return false");
    const seal = reconcile.indexOf("reconcileMultipartTerminalSeal");
    const clear = reconcile.indexOf("port.clearExact");

    expect(abort).toBeGreaterThanOrEqual(0);
    expect(rolloutGate).toBeGreaterThan(abort);
    expect(seal).toBeGreaterThan(rolloutGate);
    expect(clear).toBeGreaterThan(seal);
    expect(SOURCE).toContain("version.pendingAudioCompleteAttemptedAt === null ||");
    expect(SOURCE).toContain("version.pendingAudioCompleteWriteOnceProtectedAt.getTime() ===");
    expect(SOURCE).toContain("trackVersions.pendingAudioCompleteWriteOnceProtectedAt");
  });

  it("takes the producer quota lock first in every cancellation transaction", () => {
    const transactionStarts = Array.from(
      SOURCE.matchAll(/ctx\.db\.transaction\(async \(tx\)/g),
      (match) => match.index,
    );

    expect(transactionStarts).toHaveLength(5);
    for (const [index, start] of transactionStarts.entries()) {
      const end = transactionStarts[index + 1] ?? SOURCE.length;
      const transaction = SOURCE.slice(start, end);
      const quotaLock = transaction.indexOf("lockProducerAudioStorageQuota(tx");
      const projectLock = transaction.indexOf("pg_advisory_xact_lock(hashtextextended");

      expect(quotaLock).toBeGreaterThanOrEqual(0);
      expect(projectLock).toBeGreaterThan(quotaLock);
    }
  });
});
