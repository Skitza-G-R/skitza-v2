import type { Db } from "@skitza/db";
import { describe, expect, it, vi } from "vitest";

import { cleanupUnpersistedActiveWorkImportProof } from "../db";

describe("active work import proof cleanup", () => {
  it("preserves the object and logs why when the locked cleanup cannot run", async () => {
    const failure = new Error("connection terminated unexpectedly");
    const db = { transaction: () => Promise.reject(failure) } as unknown as Db;
    const deleteProof = vi.fn<(storageKey: string) => Promise<void>>();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(
        cleanupUnpersistedActiveWorkImportProof(db, {
          producerId: "producer-1",
          batchId: "batch-1",
          rowId: "row-1",
          storageKey: "docs/private/proof-object",
          deleteProof,
        }),
      ).resolves.toBe("preserved");
      expect(deleteProof).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        "[active-work-import] proof cleanup preserved object",
        { storageKey: "docs/private/proof-object", error: failure },
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
