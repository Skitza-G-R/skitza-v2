import { describe, expect, it, vi } from "vitest";

import { Sk90ResetSafetyError } from "../sk90-reset/errors";

import {
  assertCanonicalProductionTarget,
  observeProductionDatabaseTarget,
  productionDatabaseTargetFingerprint,
  SK104_CANONICAL_DATABASE_FINGERPRINT,
  SK104_FROZEN_DATABASE_FINGERPRINT,
} from "./target-observer";

const exactBoundary = {
  targetClass: "canonical_production" as const,
  approvedDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
  forbiddenDatabaseFingerprint: SK104_FROZEN_DATABASE_FINGERPRINT,
};

describe("SK-104 production target observer", () => {
  it("returns only a sanitized fingerprint for a primary writable target", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          projectId: "project-test",
          branchId: "branch-test",
          endpointId: "endpoint-test",
          databaseName: "database-test",
          inRecovery: false,
          transactionReadOnly: "off",
        },
      ],
    });

    const observation = await observeProductionDatabaseTarget({ query });
    expect(observation).toEqual({
      databaseFingerprint: productionDatabaseTargetFingerprint({
        projectId: "project-test",
        branchId: "branch-test",
        endpointId: "endpoint-test",
        databaseName: "database-test",
      }),
      primary: true,
      writable: true,
    });
    expect(JSON.stringify(observation)).not.toContain("project-test");
  });

  it("accepts only the exact pinned canonical observation and boundary", () => {
    expect(
      assertCanonicalProductionTarget(
        {
          databaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
          primary: true,
          writable: true,
        },
        exactBoundary,
      ),
    ).toMatchObject({ databaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT });
  });

  it.each([
    SK104_FROZEN_DATABASE_FINGERPRINT,
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ] as const)("rejects a non-canonical observed target", (databaseFingerprint) => {
    try {
      assertCanonicalProductionTarget(
        { databaseFingerprint, primary: true, writable: true },
        exactBoundary,
      );
      throw new Error("expected target rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(Sk90ResetSafetyError);
      expect((error as Sk90ResetSafetyError).code).toBe("DATABASE_TARGET_MISMATCH");
    }
  });

  it("rejects a read-only or recovery connection", async () => {
    for (const row of [
      {
        projectId: "p",
        branchId: "b",
        endpointId: "e",
        databaseName: "d",
        inRecovery: true,
        transactionReadOnly: "off",
      },
      {
        projectId: "p",
        branchId: "b",
        endpointId: "e",
        databaseName: "d",
        inRecovery: false,
        transactionReadOnly: "on",
      },
    ]) {
      try {
        await observeProductionDatabaseTarget({
          query: vi.fn().mockResolvedValue({ rows: [row] }),
        });
        throw new Error("expected target rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(Sk90ResetSafetyError);
        expect((error as Sk90ResetSafetyError).code).toBe("DATABASE_TARGET_MISMATCH");
      }
    }
  });
});
