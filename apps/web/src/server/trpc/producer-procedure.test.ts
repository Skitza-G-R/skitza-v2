import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type LookupResult = { id: string }[];
  type Lookup = (userId: string) => LookupResult | Promise<LookupResult>;

  const lookup = vi.fn<Lookup>();
  const createDb = vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((predicate: { value: string }) => ({
          limit: vi.fn(() => lookup(predicate.value)),
        })),
      })),
    })),
  }));

  return { createDb, lookup };
});

vi.mock("@skitza/db", () => ({
  createDb: mocks.createDb,
  eq: (_column: unknown, value: string) => ({ value }),
  producers: {
    clerkUserId: Symbol("producers.clerkUserId"),
    id: Symbol("producers.id"),
  },
}));

import { producerProcedure } from "./producer-procedure";
import { router } from "./init";

const testRouter = router({
  first: producerProcedure.query(({ ctx }) => ({
    db: ctx.db,
    producerId: ctx.producerId,
  })),
  second: producerProcedure.query(({ ctx }) => ({
    db: ctx.db,
    producerId: ctx.producerId,
  })),
});

beforeEach(() => {
  mocks.createDb.mockClear();
  mocks.lookup.mockReset();
  process.env.DATABASE_URL = "postgresql://test/test";
});

describe("producerProcedure caller-scoped producer context", () => {
  it("deduplicates an in-flight producer lookup and DB setup for one caller", async () => {
    let finishLookup: ((rows: { id: string }[]) => void) | undefined;
    mocks.lookup.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve;
        }),
    );

    const caller = testRouter.createCaller({ userId: "user_one" });
    const first = caller.first();
    const second = caller.second();

    await vi.waitFor(() => {
      expect(mocks.createDb).toHaveBeenCalledOnce();
      expect(mocks.lookup).toHaveBeenCalledOnce();
    });

    finishLookup?.([{ id: "producer_one" }]);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.producerId).toBe("producer_one");
    expect(secondResult.producerId).toBe("producer_one");
    expect(firstResult.db).toBe(secondResult.db);

    const laterResult = await caller.first();
    expect(laterResult.db).toBe(firstResult.db);
    expect(mocks.createDb).toHaveBeenCalledOnce();
    expect(mocks.lookup).toHaveBeenCalledOnce();
  });

  it("isolates producer authorization between separate caller contexts", async () => {
    mocks.lookup.mockImplementation((userId) => [{ id: `producer_for_${userId}` }]);

    const firstCaller = testRouter.createCaller({ userId: "user_one" });
    const sameUserNewCaller = testRouter.createCaller({ userId: "user_one" });
    const secondCaller = testRouter.createCaller({ userId: "user_two" });
    const [firstResult, sameUserNewResult, secondResult] = await Promise.all([
      firstCaller.first(),
      sameUserNewCaller.first(),
      secondCaller.first(),
    ]);

    expect(mocks.createDb).toHaveBeenCalledTimes(3);
    expect(mocks.lookup).toHaveBeenCalledTimes(3);
    expect(mocks.lookup).toHaveBeenCalledWith("user_one");
    expect(mocks.lookup).toHaveBeenCalledWith("user_two");
    expect(firstResult.producerId).toBe("producer_for_user_one");
    expect(sameUserNewResult.producerId).toBe("producer_for_user_one");
    expect(secondResult.producerId).toBe("producer_for_user_two");
    expect(firstResult.db).not.toBe(sameUserNewResult.db);
    expect(firstResult.db).not.toBe(secondResult.db);
  });

  it("evicts a failed lookup so the same caller can retry safely", async () => {
    mocks.lookup
      .mockRejectedValueOnce(new Error("temporary database failure"))
      .mockResolvedValueOnce([{ id: "producer_after_retry" }]);

    const caller = testRouter.createCaller({ userId: "user_retry" });

    await expect(caller.first()).rejects.toThrow("temporary database failure");
    await expect(caller.second()).resolves.toMatchObject({
      producerId: "producer_after_retry",
    });
    expect(mocks.createDb).toHaveBeenCalledTimes(2);
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
  });

  it("keeps unauthenticated callers out before creating a DB handle", async () => {
    const caller = testRouter.createCaller({ userId: null });

    await expect(caller.first()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.createDb).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
});
