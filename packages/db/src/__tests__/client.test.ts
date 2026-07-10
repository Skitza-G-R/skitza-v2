import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type PoolOptions = { connectionString: string; max: number };

  const neonClient = { kind: "http-client" };
  const transactionToken = { kind: "transaction" };
  const pools: PoolMock[] = [];
  const transactionDbs: Array<{
    pool: PoolMock;
    transaction: ReturnType<typeof vi.fn>;
  }> = [];
  const state: { nextEndError: Error | undefined } = { nextEndError: undefined };

  const neon = vi.fn(() => neonClient);
  const httpSelect = vi.fn(() => "http-result");
  const createHttpDb = vi.fn(() => ({
    select: httpSelect,
    transaction: vi.fn(),
  }));

  class PoolMock {
    readonly end = vi.fn(async () => {
      const error = state.nextEndError;
      state.nextEndError = undefined;
      if (error) throw error;
    });

    constructor(readonly options: PoolOptions) {
      pools.push(this);
    }
  }

  const createTransactionDb = vi.fn((pool: PoolMock) => {
    const transaction = vi.fn(
      async (callback: (tx: typeof transactionToken) => Promise<unknown>, _config?: unknown) =>
        callback(transactionToken),
    );
    transactionDbs.push({ pool, transaction });
    return { transaction };
  });

  class WebSocketMock {}

  return {
    createHttpDb,
    createTransactionDb,
    httpSelect,
    neon,
    neonClient,
    neonConfig: {} as { webSocketConstructor?: unknown },
    PoolMock,
    pools,
    state,
    transactionDbs,
    transactionToken,
    WebSocketMock,
  };
});

vi.mock("@neondatabase/serverless", () => ({
  neon: mocks.neon,
  neonConfig: mocks.neonConfig,
  Pool: mocks.PoolMock,
}));

vi.mock("drizzle-orm/neon-http", () => ({
  drizzle: mocks.createHttpDb,
}));

vi.mock("drizzle-orm/neon-serverless", () => ({
  drizzle: mocks.createTransactionDb,
}));

vi.mock("ws", () => ({ default: mocks.WebSocketMock }));

import { createDb } from "../client";

describe("createDb transaction adapter", () => {
  const connectionString = "postgresql://user:secret@example.test/skitza";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pools.length = 0;
    mocks.transactionDbs.length = 0;
    mocks.state.nextEndError = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps ordinary queries on the lazy HTTP client", () => {
    const db = createDb(connectionString);

    expect(mocks.neon).toHaveBeenCalledWith(connectionString);
    expect(mocks.createHttpDb).toHaveBeenCalledWith(mocks.neonClient, {
      schema: expect.any(Object),
    });
    expect(mocks.pools).toHaveLength(0);
    expect(mocks.createTransactionDb).not.toHaveBeenCalled();
    expect(db.select()).toBe("http-result");
  });

  it("opens one short-lived pool, forwards config, and returns the callback result", async () => {
    const db = createDb(connectionString);
    const config = { isolationLevel: "serializable" as const };
    const callback = vi.fn(async (tx) => {
      expect(tx).toBe(mocks.transactionToken);
      return "committed";
    });

    await expect(db.transaction(callback, config)).resolves.toBe("committed");

    expect(mocks.pools).toHaveLength(1);
    expect(mocks.pools[0]!.options).toEqual({ connectionString, max: 1 });
    expect(mocks.createTransactionDb).toHaveBeenCalledWith(mocks.pools[0], {
      schema: expect.any(Object),
    });
    expect(mocks.transactionDbs[0]!.transaction).toHaveBeenCalledWith(callback, config);
    expect(mocks.pools[0]!.end).toHaveBeenCalledOnce();
    expect(db.select()).toBe("http-result");
  });

  it("preserves a transaction failure and still closes its pool", async () => {
    const db = createDb(connectionString);
    const expected = new Error("rollback me");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.state.nextEndError = new Error("cleanup also failed");

    await expect(
      db.transaction(async () => {
        throw expected;
      }),
    ).rejects.toBe(expected);

    expect(mocks.pools).toHaveLength(1);
    expect(mocks.pools[0]!.end).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith("[db] transaction pool cleanup failed");
  });

  it("does not report a committed transaction as failed when cleanup fails", async () => {
    const db = createDb(connectionString);
    const cleanupError = new Error("socket cleanup failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.state.nextEndError = cleanupError;

    await expect(db.transaction(async () => "committed")).resolves.toBe("committed");

    expect(consoleError).toHaveBeenCalledWith("[db] transaction pool cleanup failed");
    expect(mocks.pools[0]!.end).toHaveBeenCalledOnce();
  });

  it("isolates concurrent transactions in separate pools and closes both", async () => {
    const db = createDb(connectionString);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = db.transaction(async () => {
      await gate;
      return "first";
    });
    const second = db.transaction(async () => {
      await gate;
      return "second";
    });

    expect(mocks.pools).toHaveLength(2);
    expect(mocks.pools[0]).not.toBe(mocks.pools[1]);
    release();

    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(mocks.pools[0]!.end).toHaveBeenCalledOnce();
    expect(mocks.pools[1]!.end).toHaveBeenCalledOnce();
  });
});
