import { describe, expect, it, vi } from "vitest";

import type { NeonPoolClientLike } from "../sk90-reset/database-adapter";

import {
  productionDatabaseTargetFingerprint,
  SK104_CANONICAL_DATABASE_FINGERPRINT,
} from "../sk104-cutover/target-observer";
import {
  ACCOUNT_CLOSURE_CANONICAL_NEON_PROJECT_ID,
  ACCOUNT_CLOSURE_FROZEN_NEON_PROJECT_ID,
  preflightAccountClosureTarget,
  type AccountClosureTargetPreflightRuntime,
} from "./target";
import { ACCOUNT_CLOSURE_LIVE_NEON_ENDPOINT } from "./environment";

const LIVE_URL = `postgresql://operator:private-password@${ACCOUNT_CLOSURE_LIVE_NEON_ENDPOINT}.us-east-2.aws.neon.tech/skitza?sslmode=require`;
const TEST_NEON_URL =
  "postgresql://operator:private-password@ep-skitza-test.us-east-2.aws.neon.tech/skitza_test?sslmode=require";

function runtimeForRows(rows: readonly Record<string, unknown>[]) {
  const query = vi.fn(() => Promise.resolve({ rows }));
  const release = vi.fn();
  const end = vi.fn(() => Promise.resolve());
  const client = { query, release } as unknown as NeonPoolClientLike;
  const connect = vi.fn(() => Promise.resolve(client));
  const runtime: AccountClosureTargetPreflightRuntime = {
    createPool: vi.fn(() => ({ connect, end })),
  };
  return {
    runtime,
    query,
    release,
    end,
  };
}

describe("account-closure database target preflight", () => {
  it("allows a non-Neon test database without opening a pool", async () => {
    const createPool = vi.fn();
    await expect(
      preflightAccountClosureTarget(
        {
          actorClerkUserId: "user_founder_operator",
          clerkInstanceId: "ins_test",
          databaseUrl: "postgresql://operator:private-password@127.0.0.1:5432/skitza_test",
          targetClass: "test",
        },
        { createPool },
      ),
    ).resolves.toBeUndefined();
    expect(createPool).not.toHaveBeenCalled();
  });

  it.each([ACCOUNT_CLOSURE_CANONICAL_NEON_PROJECT_ID, ACCOUNT_CLOSURE_FROZEN_NEON_PROJECT_ID])(
    "rejects protected Neon project %s when target class is test",
    async (projectId) => {
      const test = runtimeForRows([{ projectId }]);
      await expect(
        preflightAccountClosureTarget(
          {
            actorClerkUserId: "user_founder_operator",
            clerkInstanceId: "ins_test",
            databaseUrl: TEST_NEON_URL,
            targetClass: "test",
          },
          test.runtime,
        ),
      ).rejects.toMatchObject({ code: "ACCOUNT_CLOSURE_TARGET_INVALID" });
      expect(test.release).toHaveBeenCalledOnce();
      expect(test.end).toHaveBeenCalledOnce();
    },
  );

  it("allows an unprotected Neon test project and releases every resource", async () => {
    const test = runtimeForRows([{ projectId: "isolated-test-project" }]);
    await expect(
      preflightAccountClosureTarget(
        {
          actorClerkUserId: "user_founder_operator",
          clerkInstanceId: "ins_test",
          databaseUrl: TEST_NEON_URL,
          targetClass: "test",
        },
        test.runtime,
      ),
    ).resolves.toBeUndefined();
    expect(test.release).toHaveBeenCalledOnce();
    expect(test.end).toHaveBeenCalledOnce();
  });

  it("allows live only when the provider-owned observation matches the pinned target", async () => {
    const canonicalIdentity = {
      projectId: "canonical-project",
      branchId: "canonical-branch",
      endpointId: "canonical-endpoint",
      databaseName: "canonical-database",
    };
    expect(productionDatabaseTargetFingerprint(canonicalIdentity)).not.toBe(
      SK104_CANONICAL_DATABASE_FINGERPRINT,
    );

    const test = runtimeForRows([
      {
        projectId: canonicalIdentity.projectId,
        branchId: canonicalIdentity.branchId,
        endpointId: canonicalIdentity.endpointId,
        databaseName: canonicalIdentity.databaseName,
        inRecovery: false,
        transactionReadOnly: "off",
      },
    ]);
    await expect(
      preflightAccountClosureTarget(
        {
          actorClerkUserId: "user_founder_operator",
          clerkInstanceId: "ins_production",
          databaseUrl: LIVE_URL,
          targetClass: "live",
        },
        test.runtime,
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_CLOSURE_TARGET_INVALID" });
    expect(test.release).toHaveBeenCalledOnce();
    expect(test.end).toHaveBeenCalledOnce();
  });
});
