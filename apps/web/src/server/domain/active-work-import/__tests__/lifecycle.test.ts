import type { Db } from "@skitza/db";
import { describe, expect, it, vi } from "vitest";

import {
  activeWorkImportBatchMaterializedState,
  completeActiveWorkImportBatch,
  loadLatestOpenActiveWorkImportBatch,
} from "../db";

function completionDb(input: {
  batch: Readonly<{ status: "draft" | "in_progress" | "completed" }> | null;
  total: number;
  remaining: number;
}) {
  let selection = 0;
  const returning = vi.fn(() => Promise.resolve([{ id: "batch-1" }]));
  const update = vi.fn(() => ({
    set: () => ({ where: () => ({ returning }) }),
  }));
  const tx = {
    execute: vi.fn(() => Promise.resolve()),
    select: vi.fn(() => {
      selection += 1;
      if (selection === 1) {
        return {
          from: () => ({
            where: () => ({
              limit: () => ({
                for: () => Promise.resolve(input.batch ? [input.batch] : []),
              }),
            }),
          }),
        };
      }
      return {
        from: () => ({
          where: () => Promise.resolve([{ total: input.total, remaining: input.remaining }]),
        }),
      };
    }),
    update,
  };
  const db = {
    transaction: (callback: (transaction: typeof tx) => unknown) => callback(tx),
  } as unknown as Db;
  return { db, update, returning };
}

describe("active work import batch lifecycle", () => {
  it("keeps the last materialized row in progress and resumable through latest open", async () => {
    const materializedAt = new Date("2026-08-20T12:00:00.000Z");
    const materializedState = activeWorkImportBatchMaterializedState(materializedAt);
    const batch = {
      id: "batch-1",
      producerId: "producer-1",
      operationKey: "batch-operation-1",
      createdByClerkUserId: "user-1",
      ...materializedState,
      createdAt: new Date("2026-08-20T10:00:00.000Z"),
    };
    const row = {
      id: "row-1",
      batchId: batch.id,
      producerId: batch.producerId,
      operationKey: "row-operation-1",
      draftRevision: 1,
      draftPayload: {},
      creationDigest: `sha256:${"a".repeat(64)}`,
      createdClientContactId: "client-1",
      createdProjectId: "project-1",
      createdPurchaseId: "purchase-1",
      materializedAt,
      lastAttemptedAt: materializedAt,
      lastErrorCode: null,
      createdAt: materializedAt,
      updatedAt: materializedAt,
    };
    let selection = 0;
    const select = vi.fn(() => {
      selection += 1;
      if (selection === 1) {
        return {
          from: () => ({
            where: () => ({
              orderBy: () => ({ limit: () => Promise.resolve([{ id: batch.id }]) }),
            }),
          }),
        };
      }
      if (selection === 2) {
        return {
          from: () => ({ where: () => ({ limit: () => Promise.resolve([batch]) }) }),
        };
      }
      return {
        from: () => ({ where: () => ({ orderBy: () => Promise.resolve([row]) }) }),
      };
    });
    const db = { select } as unknown as Db;

    expect(materializedState).toEqual({
      status: "in_progress",
      completedAt: null,
      updatedAt: materializedAt,
    });
    await expect(
      loadLatestOpenActiveWorkImportBatch(db, { producerId: batch.producerId }),
    ).resolves.toMatchObject({
      batch: { id: batch.id, status: "in_progress", completedAt: null },
      rows: [{ id: row.id, materializedAt }],
    });
    expect(select).toHaveBeenCalledTimes(3);
  });

  it("marks an owned fully materialized batch completed only at Finish setup", async () => {
    const fixture = completionDb({ batch: { status: "in_progress" }, total: 2, remaining: 0 });
    const completedAt = new Date("2026-08-20T12:00:00.000Z");

    await expect(
      completeActiveWorkImportBatch(fixture.db, {
        producerId: "producer-1",
        batchId: "batch-1",
        completedAt,
      }),
    ).resolves.toEqual({ changed: true });
    expect(fixture.update).toHaveBeenCalledTimes(1);
    expect(fixture.returning).toHaveBeenCalledTimes(1);
  });

  it("leaves a partial batch in progress after successful setup effects", async () => {
    const fixture = completionDb({ batch: { status: "in_progress" }, total: 2, remaining: 1 });

    await expect(
      completeActiveWorkImportBatch(fixture.db, {
        producerId: "producer-1",
        batchId: "batch-1",
        completedAt: new Date("2026-08-20T12:00:00.000Z"),
      }),
    ).resolves.toEqual({ changed: false });
    expect(fixture.update).not.toHaveBeenCalled();
  });

  it("makes exact completion replay harmless and rejects the wrong producer scope", async () => {
    const completed = completionDb({ batch: { status: "completed" }, total: 1, remaining: 0 });
    const missing = completionDb({ batch: null, total: 1, remaining: 0 });
    const input = {
      producerId: "producer-1",
      batchId: "batch-1",
      completedAt: new Date("2026-08-20T12:00:00.000Z"),
    };

    await expect(completeActiveWorkImportBatch(completed.db, input)).resolves.toEqual({
      changed: false,
    });
    expect(completed.update).not.toHaveBeenCalled();
    await expect(completeActiveWorkImportBatch(missing.db, input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
