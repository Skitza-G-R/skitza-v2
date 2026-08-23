import { producers } from "@skitza/db";
import type { Db } from "@skitza/db";
import { describe, expect, it } from "vitest";

import { paymentLedgerReadRepository } from "../read-db";

// SK-258: `createDb()` turns every `db.transaction()` into a brand-new
// WebSocket connection (connect + login + BEGIN + serial queries + COMMIT +
// close). The ledger read model powers artist Home/Payments and producer
// Dashboard/Payments, so its reads must run directly on the HTTP client.
function fakeDb(rowsByTable: ReadonlyMap<unknown, readonly unknown[]>) {
  const select = () => {
    let rows: readonly unknown[] = [];
    const chain: Record<string, unknown> = {};
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_target, property) {
        if (property === "then") {
          return (
            onfulfilled?: (value: readonly unknown[]) => unknown,
            onrejected?: (reason: unknown) => unknown,
          ) => Promise.resolve(rows).then(onfulfilled, onrejected);
        }
        if (property === "from") {
          return (table: unknown) => {
            rows = rowsByTable.get(table) ?? [];
            return proxy;
          };
        }
        return () => proxy;
      },
    };
    const proxy = new Proxy(chain, handler);
    return proxy;
  };
  let transactions = 0;
  const db = {
    select,
    selectDistinct: select,
    transaction: () => {
      transactions += 1;
      throw new Error("payment ledger reads must not open a transaction");
    },
  };
  return { db: db as unknown as Db, transactionCount: () => transactions };
}

describe("paymentLedgerReadRepository", () => {
  it("reads the producer snapshot without opening a transaction", async () => {
    const producerRow = {
      id: "00000000-0000-4000-8000-000000000001",
      displayName: "Gili",
      timeZone: "Asia/Jerusalem",
      paymentDetails: null,
    };
    const { db, transactionCount } = fakeDb(new Map([[producers, [producerRow]]]));

    const snapshot = await paymentLedgerReadRepository(db).loadSnapshot({
      kind: "producer",
      producerId: producerRow.id,
    });

    expect(transactionCount()).toBe(0);
    expect(snapshot).toMatchObject({
      scope: { kind: "producer", producerId: producerRow.id },
      producers: [producerRow],
      purchases: [],
      payments: [],
    });
  });

  it("reads the artist snapshot without opening a transaction", async () => {
    const { db, transactionCount } = fakeDb(new Map());

    const snapshot = await paymentLedgerReadRepository(db).loadSnapshot({
      kind: "artist",
      clerkUserId: "user_artist",
    });

    expect(transactionCount()).toBe(0);
    expect(snapshot).toMatchObject({ producers: [], purchases: [], payments: [] });
  });
});
