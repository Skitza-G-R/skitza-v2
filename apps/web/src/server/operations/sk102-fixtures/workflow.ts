import { createDb, createNeonPool, type NeonPoolClient } from "@skitza/db";
import { approvedSk102Runtime, type ApprovedSk102Runtime } from "@skitza/db/sk102-runtime";

import {
  SK102_DATABASE_ADVISORY_LOCK,
  assertSk102FixtureSchema,
  seedSk102FixtureDatabase,
  sk102ObjectIdentities,
  sk102SeedObjectPlan,
  truncateSk102FixtureDatabase,
} from "./database";
import {
  SK102_BROWSER_RUN_LEASE_ENV,
  sk102FixtureUuid,
  SK102_REPOSITORY_ROOT,
  validateSk102BrowserRunLeaseToken,
  validateSk102FixtureIdentity,
  type Sk102FixtureIdentity,
  type Sk102FixtureSlot,
} from "./contract";
import {
  buildSk102FixtureManifest,
  removeSk102GeneratedFiles,
  writeSk102FixtureManifest,
} from "./manifest";
import { emptySk102FixtureBuckets, seedSk102FixtureObjects } from "./storage";

const WORKFLOW_LOCK = `${SK102_DATABASE_ADVISORY_LOCK}:workflow`;
const BROWSER_RUN_LOCK = `${SK102_DATABASE_ADVISORY_LOCK}:browser-run`;
export { SK102_BROWSER_RUN_LEASE_ENV, validateSk102BrowserRunLeaseToken } from "./contract";

function tokenLock(token: string): string {
  return `${BROWSER_RUN_LOCK}:${token}`;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("SK102_FIXTURE_IDENTITY_ENV_MISSING");
  return value;
}

function fixtureIdentity(runtime: ApprovedSk102Runtime): Sk102FixtureIdentity {
  return validateSk102FixtureIdentity({
    producerClerkUserId: requiredEnvironment("SKITZA_E2E_PRODUCER_CLERK_USER_ID"),
    artistClerkUserId: requiredEnvironment("SKITZA_E2E_ARTIST_CLERK_USER_ID"),
    producerEmail: requiredEnvironment("SKITZA_E2E_PRODUCER_EMAIL"),
    artistEmail: requiredEnvironment("SKITZA_E2E_ARTIST_EMAIL"),
    sinkEmailDomain: runtime.emailAllowedRecipientDomain,
  });
}

function runtime(): ApprovedSk102Runtime {
  const approved = approvedSk102Runtime(process.env);
  if (!approved) throw new Error("SK102_RUNTIME_REQUIRED");
  return approved;
}

async function withWorkflowLock<T>(
  approved: ApprovedSk102Runtime,
  work: () => Promise<T>,
): Promise<T> {
  const pool = createNeonPool(approved.databaseUrl);
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [WORKFLOW_LOCK]);
    locked = true;
    return await work();
  } finally {
    if (locked) {
      try {
        await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [WORKFLOW_LOCK]);
      } catch {
        // Releasing the only pool connection below also releases its session lock.
      }
    }
    client.release();
    await pool.end().catch(() => undefined);
  }
}

async function tryLock(client: NeonPoolClient, key: string): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    "select pg_try_advisory_lock(hashtextextended($1, 0)) as locked",
    [key],
  );
  return result.rows[0]?.locked === true;
}

async function unlock(client: NeonPoolClient, key: string): Promise<void> {
  await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [key]);
}

async function withExclusiveRunLock<T>(
  approved: ApprovedSk102Runtime,
  keys: readonly string[],
  work: () => Promise<T>,
): Promise<T> {
  const pool = createNeonPool(approved.databaseUrl);
  const client = await pool.connect();
  const locked: string[] = [];
  try {
    for (const key of keys) {
      if (!(await tryLock(client, key))) throw new Error("SK102_BROWSER_RUN_ALREADY_ACTIVE");
      locked.push(key);
    }
    return await work();
  } finally {
    for (const key of locked.reverse()) {
      await unlock(client, key).catch(() => undefined);
    }
    client.release();
    await pool.end().catch(() => undefined);
  }
}

async function assertRunnerOwnsRunLease(
  approved: ApprovedSk102Runtime,
  token: string,
): Promise<void> {
  const pool = createNeonPool(approved.databaseUrl);
  const client = await pool.connect();
  try {
    for (const key of [BROWSER_RUN_LOCK, tokenLock(token)]) {
      if (await tryLock(client, key)) {
        await unlock(client, key).catch(() => undefined);
        throw new Error("SK102_BROWSER_RUN_LEASE_NOT_HELD");
      }
    }
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

export async function assertSk102BrowserRunLeaseHeld(leaseToken: string): Promise<void> {
  const token = validateSk102BrowserRunLeaseToken(leaseToken);
  await assertRunnerOwnsRunLease(runtime(), token);
}

export async function withSk102BrowserRunLease<T>(
  leaseToken: string,
  work: () => Promise<T>,
): Promise<T> {
  const token = validateSk102BrowserRunLeaseToken(leaseToken);
  const approved = runtime();
  return withExclusiveRunLock(approved, [BROWSER_RUN_LOCK, tokenLock(token)], work);
}

async function withCommandRunLease<T>(
  approved: ApprovedSk102Runtime,
  work: () => Promise<T>,
): Promise<T> {
  const inheritedToken = process.env[SK102_BROWSER_RUN_LEASE_ENV];
  if (inheritedToken !== undefined) {
    const token = validateSk102BrowserRunLeaseToken(inheritedToken);
    await assertRunnerOwnsRunLease(approved, token);
    return work();
  }
  return withExclusiveRunLock(approved, [BROWSER_RUN_LOCK], work);
}

async function cleanupApprovedResources(
  approved: ApprovedSk102Runtime,
  slot: Sk102FixtureSlot,
  manifestPath: string,
): Promise<void> {
  const db = createDb(approved.databaseUrl);
  await runSk102CleanupSteps({
    assertSchema: () => assertSk102FixtureSchema(db),
    emptyStorage: () => emptySk102FixtureBuckets(approved),
    truncateDatabase: () => truncateSk102FixtureDatabase(db),
    removeGeneratedFiles: () =>
      removeSk102GeneratedFiles(SK102_REPOSITORY_ROOT, manifestPath, slot),
  });
}

export async function runSk102CleanupSteps(input: {
  assertSchema: () => Promise<void>;
  emptyStorage: () => Promise<void>;
  truncateDatabase: () => Promise<void>;
  removeGeneratedFiles: () => Promise<void>;
}): Promise<void> {
  // Prove the database is the exact disposable schema before deleting
  // anything, including objects or local manifests. truncateDatabase repeats
  // the schema check immediately before its own destructive statement.
  await input.assertSchema();
  let failed = false;
  for (const action of [input.emptyStorage, input.truncateDatabase, input.removeGeneratedFiles]) {
    try {
      await action();
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error("SK102_FIXTURE_CLEANUP_INCOMPLETE");
}

export async function seedSk102FixtureWorkflow(
  slot: Sk102FixtureSlot,
  manifestPath: string,
): Promise<void> {
  const approved = runtime();
  const identity = fixtureIdentity(approved);
  await withCommandRunLease(approved, () =>
    withWorkflowLock(approved, async () => {
      const db = createDb(approved.databaseUrl);
      await assertSk102FixtureSchema(db);
      await cleanupApprovedResources(approved, slot, manifestPath);
      try {
        const producerA = sk102FixtureUuid(slot, "producer.a");
        const producerB = sk102FixtureUuid(slot, "producer.b");
        const stored = await seedSk102FixtureObjects(
          approved,
          sk102SeedObjectPlan(slot, producerA, producerB),
        );
        const rows = await seedSk102FixtureDatabase(db, {
          slot,
          identity,
          objects: sk102ObjectIdentities(stored),
        });
        const manifest = buildSk102FixtureManifest(slot, rows, {
          audioPath: "generated",
          proofPath: "generated",
          replacementProofPath: "generated",
        });
        await writeSk102FixtureManifest(SK102_REPOSITORY_ROOT, manifestPath, manifest);
      } catch {
        await cleanupApprovedResources(approved, slot, manifestPath).catch(() => undefined);
        throw new Error("SK102_FIXTURE_SEED_FAILED");
      }
    }),
  );
}

export async function cleanupSk102FixtureWorkflow(
  slot: Sk102FixtureSlot,
  manifestPath: string,
): Promise<void> {
  const approved = runtime();
  await withCommandRunLease(approved, () =>
    withWorkflowLock(approved, () => cleanupApprovedResources(approved, slot, manifestPath)),
  );
}
