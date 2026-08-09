import { neon, neonConfig, Pool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle as createHttpDb, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as createTransactionDb } from "drizzle-orm/neon-serverless";
import WebSocket from "ws";
import * as schema from "./schema";

neonConfig.webSocketConstructor = WebSocket;

export type Db = NeonHttpDatabase<typeof schema>;

/**
 * Create the single-connection interactive pool used by explicit operational
 * adapters. Callers remain responsible for closing it. Keeping this factory
 * in the database package avoids a second Neon driver dependency in the web
 * package and lets the SK-90 command defer all network I/O until its safety
 * gates have passed.
 */
export function createNeonPool(connectionString: string, max = 1): Pool {
  if (!Number.isSafeInteger(max) || max !== 1) {
    throw new Error("Interactive database pools must use exactly one connection");
  }
  return new Pool({ connectionString, max });
}

/**
 * Run autocommit work while one dedicated Neon session holds an advisory
 * lock. This is for storage coordination that must not occur inside a DB
 * transaction: the single-connection pool keeps the session lock stable
 * across awaited network work, and closing the pool releases it fail-safe.
 */
export async function withNeonSessionAdvisoryLock<Result>(
  connectionString: string,
  lockKey: string,
  callback: (db: Db) => Promise<Result>,
): Promise<Result> {
  const pool = createNeonPool(connectionString);
  const sessionDb = createTransactionDb(pool, { schema }) as unknown as Db;
  let acquired = false;
  try {
    await sessionDb.execute(sql`select pg_advisory_lock(hashtextextended(${lockKey}, 0))`);
    acquired = true;
    return await callback(sessionDb);
  } finally {
    if (acquired) {
      try {
        await sessionDb.execute(sql`select pg_advisory_unlock(hashtextextended(${lockKey}, 0))`);
      } catch {
        // Closing the dedicated connection below releases the session lock.
        console.error("[db] session advisory unlock failed");
      }
    }
    try {
      await pool.end();
    } catch {
      console.error("[db] session advisory pool cleanup failed");
    }
  }
}

type TransactionFn = Db["transaction"];

function createTransaction(connectionString: string): TransactionFn {
  return (async (...args: Parameters<TransactionFn>) => {
    const pool = createNeonPool(connectionString);

    try {
      const transactionDb = createTransactionDb(pool, { schema });
      // Both Drizzle Postgres transaction objects expose the same query-builder
      // API. Their private result-HKT types differ, so keep that compatibility
      // cast at this one adapter boundary instead of changing every caller.
      const run = transactionDb.transaction.bind(transactionDb) as unknown as TransactionFn;
      return await run(...args);
    } finally {
      try {
        await pool.end();
      } catch {
        // A committed transaction must not look failed to callers (which could
        // trigger a duplicate retry). Keep credentials and connection details
        // out of logs while still leaving an operational signal.
        console.error("[db] transaction pool cleanup failed");
      }
    }
  }) as TransactionFn;
}

export function createDb(connectionString: string): Db {
  const db = createHttpDb(neon(connectionString), { schema });

  // Neon HTTP is ideal for the app's ordinary one-shot queries, but Drizzle's
  // neon-http adapter deliberately rejects interactive transactions. Open a
  // one-connection WebSocket pool only for the transaction callback, then
  // close it before the request completes so serverless invocations never
  // leak database connections.
  db.transaction = createTransaction(connectionString);

  return db;
}
