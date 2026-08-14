import { createNeonPool } from "@skitza/db";

import type { NeonPoolClientLike, NeonPoolLike } from "../sk90-reset/database-adapter";
import {
  assertCanonicalProductionTarget,
  observeProductionDatabaseTarget,
  SK104_CANONICAL_DATABASE_FINGERPRINT,
  SK104_FROZEN_DATABASE_FINGERPRINT,
} from "../sk104-cutover/target-observer";
import type { AccountClosureOperatorEnvironment } from "./environment";
import { AccountClosureOperatorSafetyError } from "./environment";

export const ACCOUNT_CLOSURE_CANONICAL_NEON_PROJECT_ID = "raspy-pine-96654399" as const;
export const ACCOUNT_CLOSURE_FROZEN_NEON_PROJECT_ID = "quiet-sun-92221754" as const;

type ClosableNeonPool = NeonPoolLike & Readonly<{ end(): Promise<void> }>;

export type AccountClosureTargetPreflightRuntime = Readonly<{
  createPool(databaseUrl: string): ClosableNeonPool;
}>;

function stop(): never {
  throw new AccountClosureOperatorSafetyError("ACCOUNT_CLOSURE_TARGET_INVALID");
}

function isNeonDatabase(databaseUrl: string): boolean {
  return new URL(databaseUrl).hostname.endsWith(".neon.tech");
}

async function assertNonLiveNeonProject(client: NeonPoolClientLike): Promise<void> {
  const result = await client.query<{ projectId: unknown }>(
    `SELECT current_setting('neon.project_id', true) AS "projectId"`,
  );
  const projectId = result.rows[0]?.projectId;
  if (
    result.rows.length !== 1 ||
    typeof projectId !== "string" ||
    projectId.length === 0 ||
    projectId === ACCOUNT_CLOSURE_CANONICAL_NEON_PROJECT_ID ||
    projectId === ACCOUNT_CLOSURE_FROZEN_NEON_PROJECT_ID
  ) {
    stop();
  }
}

/**
 * Verifies a Neon target through provider-owned identity on the same
 * connection. The check is read-only and always releases both client and pool.
 */
export async function preflightAccountClosureTarget(
  environment: AccountClosureOperatorEnvironment,
  runtime: AccountClosureTargetPreflightRuntime = {
    createPool: (databaseUrl) => createNeonPool(databaseUrl),
  },
): Promise<void> {
  if (!isNeonDatabase(environment.databaseUrl)) {
    if (environment.targetClass === "live") stop();
    return;
  }

  const pool = runtime.createPool(environment.databaseUrl);
  let client: NeonPoolClientLike | null = null;
  try {
    client = await pool.connect();
    if (environment.targetClass === "live") {
      assertCanonicalProductionTarget(await observeProductionDatabaseTarget(client), {
        targetClass: "canonical_production",
        approvedDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
        forbiddenDatabaseFingerprint: SK104_FROZEN_DATABASE_FINGERPRINT,
      });
    } else {
      await assertNonLiveNeonProject(client);
    }
  } catch {
    stop();
  } finally {
    let cleanupFailed = false;
    try {
      client?.release();
    } catch {
      cleanupFailed = true;
    }
    try {
      await pool.end();
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed) stop();
  }
}
