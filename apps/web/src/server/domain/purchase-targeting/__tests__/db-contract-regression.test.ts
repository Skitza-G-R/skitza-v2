import type { Db } from "@skitza/db";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { correctProducerPurchaseTarget } from "../db";
import { PurchaseTargetingError } from "../service";

class QueuedQuery implements PromiseLike<unknown[]> {
  readonly #rows: unknown[];
  readonly #lockModes: string[];

  constructor(rows: unknown[], lockModes: string[]) {
    this.#rows = rows;
    this.#lockModes = lockModes;
  }

  from(): this {
    return this;
  }

  where(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  for(mode: string): this {
    this.#lockModes.push(mode);
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.#rows).then(onfulfilled, onrejected);
  }
}

class QueuedUpdateQuery implements PromiseLike<unknown[]> {
  readonly #rows: unknown[];

  constructor(rows: unknown[]) {
    this.#rows = rows;
  }

  set(): this {
    return this;
  }

  where(): this {
    return this;
  }

  returning(): this {
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.#rows).then(onfulfilled, onrejected);
  }
}

class QueuedTargetingDb {
  readonly #selectRows: unknown[][];
  readonly #updateRows: unknown[][];
  readonly lockModes: string[] = [];

  constructor(input: { selectRows: unknown[][]; updateRows?: unknown[][] }) {
    this.#selectRows = [...input.selectRows];
    this.#updateRows = [...(input.updateRows ?? [])];
  }

  select(): QueuedQuery {
    const rows = this.#selectRows.shift();
    if (!rows) throw new Error("Unexpected select in targeting test double");
    return new QueuedQuery(rows, this.lockModes);
  }

  update(): QueuedUpdateQuery {
    const rows = this.#updateRows.shift();
    if (!rows) throw new Error("Unexpected update in targeting test double");
    return new QueuedUpdateQuery(rows);
  }

  async transaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
    return work(this as unknown as Db);
  }

  asDb(): Db {
    return this as unknown as Db;
  }
}

function request(
  patch: Partial<{
    id: string;
    producerId: string;
    clientContactId: string;
    status: "pending" | "approved" | "declined" | "canceled" | "converted";
  }> = {},
) {
  return {
    id: randomUUID(),
    producerId: randomUUID(),
    clientContactId: randomUUID(),
    status: "approved" as const,
    ...patch,
  };
}

async function targetingError(operation: Promise<unknown>): Promise<PurchaseTargetingError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PurchaseTargetingError);
    return error as PurchaseTargetingError;
  }
  throw new Error("Expected PurchaseTargetingError");
}

describe("producer purchase-target correction transaction contract", () => {
  it("locks the request before checking history and share-locks the same-client target", async () => {
    const loaded = request();
    const targetId = randomUUID();
    const db = new QueuedTargetingDb({
      selectRows: [[loaded], [], [{ id: targetId }]],
      updateRows: [[{ projectId: targetId }]],
    });

    await expect(
      correctProducerPurchaseTarget(db.asDb(), {
        producerId: loaded.producerId,
        purchaseRequestId: loaded.id,
        projectId: targetId,
      }),
    ).resolves.toEqual({ projectId: targetId });
    expect(db.lockModes).toEqual(["update", "share"]);
  });

  it("deliberately resets the target to a new project without looking up a project", async () => {
    const loaded = request();
    const db = new QueuedTargetingDb({
      selectRows: [[loaded], []],
      updateRows: [[{ projectId: null }]],
    });

    await expect(
      correctProducerPurchaseTarget(db.asDb(), {
        producerId: loaded.producerId,
        purchaseRequestId: loaded.id,
        projectId: null,
      }),
    ).resolves.toEqual({ projectId: null });
    expect(db.lockModes).toEqual(["update"]);
  });

  it("locks immediately when accepted purchase history exists", async () => {
    const loaded = request();
    const db = new QueuedTargetingDb({
      selectRows: [[loaded], [{ id: randomUUID() }]],
    });
    const failure = await targetingError(
      correctProducerPurchaseTarget(db.asDb(), {
        producerId: loaded.producerId,
        purchaseRequestId: loaded.id,
        projectId: randomUUID(),
      }),
    );
    expect(failure).toMatchObject({ code: "LOCKED" });
    expect(db.lockModes).toEqual(["update"]);
  });

  it("treats terminal request state as locked even without a linked purchase", async () => {
    const loaded = request({ status: "converted" });
    const failure = await targetingError(
      correctProducerPurchaseTarget(
        new QueuedTargetingDb({ selectRows: [[loaded], []] }).asDb(),
        {
          producerId: loaded.producerId,
          purchaseRequestId: loaded.id,
          projectId: randomUUID(),
        },
      ),
    );
    expect(failure).toMatchObject({ code: "LOCKED" });
  });

  it("turns a lost compare-and-swap update into a generic lock conflict", async () => {
    const loaded = request();
    const targetId = randomUUID();
    const failure = await targetingError(
      correctProducerPurchaseTarget(
        new QueuedTargetingDb({
          selectRows: [[loaded], [], [{ id: targetId }]],
          updateRows: [[]],
        }).asDb(),
        {
          producerId: loaded.producerId,
          purchaseRequestId: loaded.id,
          projectId: targetId,
        },
      ),
    );
    expect(failure).toMatchObject({ code: "LOCKED" });
    expect(failure.message).not.toContain(loaded.id);
    expect(failure.message).not.toContain(targetId);
  });
});

describe("purchase-target ownership privacy", () => {
  it("uses the same generic result for a missing request and foreign producer request", async () => {
    const missingId = randomUUID();
    const foreignId = randomUUID();
    const producerId = randomUUID();
    const missing = await targetingError(
      correctProducerPurchaseTarget(
        new QueuedTargetingDb({ selectRows: [[]] }).asDb(),
        { producerId, purchaseRequestId: missingId, projectId: randomUUID() },
      ),
    );
    const foreign = await targetingError(
      correctProducerPurchaseTarget(
        new QueuedTargetingDb({ selectRows: [[]] }).asDb(),
        { producerId, purchaseRequestId: foreignId, projectId: randomUUID() },
      ),
    );

    expect({ code: foreign.code, message: foreign.message }).toEqual({
      code: missing.code,
      message: missing.message,
    });
    expect(missing).toMatchObject({
      code: "NOT_FOUND",
      message: "Purchase request or target was not found.",
    });
  });

  it("uses that same outcome for missing, cross-client, or cross-producer targets", async () => {
    const loaded = request();
    const missingRequest = await targetingError(
      correctProducerPurchaseTarget(
        new QueuedTargetingDb({ selectRows: [[]] }).asDb(),
        {
          producerId: loaded.producerId,
          purchaseRequestId: randomUUID(),
          projectId: randomUUID(),
        },
      ),
    );
    const foreignTarget = await targetingError(
      correctProducerPurchaseTarget(
        new QueuedTargetingDb({ selectRows: [[loaded], [], []] }).asDb(),
        {
          producerId: loaded.producerId,
          purchaseRequestId: loaded.id,
          projectId: randomUUID(),
        },
      ),
    );

    expect({ code: foreignTarget.code, message: foreignTarget.message }).toEqual({
      code: missingRequest.code,
      message: missingRequest.message,
    });
  });
});
