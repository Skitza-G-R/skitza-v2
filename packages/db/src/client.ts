import { neon, neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle as createHttpDb, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as createTransactionDb } from "drizzle-orm/neon-serverless";
import WebSocket from "ws";
import * as schema from "./schema";

neonConfig.webSocketConstructor = WebSocket;

export type Db = NeonHttpDatabase<typeof schema>;

type TransactionFn = Db["transaction"];

function createTransaction(connectionString: string): TransactionFn {
  return (async (...args: Parameters<TransactionFn>) => {
    const pool = new Pool({ connectionString, max: 1 });

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
