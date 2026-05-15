import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for projects.reorder — Clients & Projects v3 redesign Phase 1,
// Task 15. Drag-to-reorder for the Projects list. Same shape as
// clientContacts.reorder: writes position == index in orderedIds
// inside a single transaction so a partial failure can't half-reorder
// the list. Ownership verified by selecting all producerIds in one
// query before any write. Mirrors the precedent in
// booking-packages-reorder.test.ts.

const PRODUCER_ID = "producer-uuid-proj-reorder-1";
const OTHER_PRODUCER_ID = "producer-uuid-proj-reorder-2";
const ID_A = "00000000-0000-0000-0000-0000000000d1";
const ID_B = "00000000-0000-0000-0000-0000000000d2";
const ID_C = "00000000-0000-0000-0000-0000000000d3";

const producersMarker = { __table: "producers" };
const projectsMarker = { __table: "projects" };

type Row = Record<string, unknown>;

const producerSelectQueue: Row[][] = [];
const projectSelectQueue: Row[][] = [];

function shift<T>(q: T[][]): T[] {
  return q.shift() ?? [];
}

const updateWhereSpy = vi.fn<() => Promise<unknown>>(() => Promise.resolve());
const updateSetSpy = vi.fn(() => ({ where: updateWhereSpy }));
const transactionRanSpy = vi.fn();

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      const handler = () => {
        if (table === producersMarker) return shift(producerSelectQueue);
        if (table === projectsMarker) return shift(projectSelectQueue);
        return [];
      };
      return {
        where: () => {
          let consumed = false;
          const consume = () => {
            if (consumed) return Promise.resolve([]);
            consumed = true;
            return Promise.resolve(handler());
          };
          const obj = {
            then: (
              resolve: (value: unknown) => unknown,
              reject?: (err: unknown) => unknown,
            ) => consume().then(resolve, reject),
            limit: () => consume(),
            orderBy: () => consume(),
          };
          return obj;
        },
      };
    },
  }),
  update: () => ({ set: updateSetSpy }),
  transaction: (cb: unknown) => {
    transactionRanSpy();
    return (cb as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
  },
};

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_proj_reorder" }),
}));

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({
      get: () => "127.0.0.1",
    }),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  projects: projectsMarker,
  // Stub other tables referenced by project.ts.
  bookings: { __table: "bookings" },
  invoices: { __table: "invoices" },
  projectTracks: { __table: "project_tracks" },
  trackComments: { __table: "track_comments" },
  trackVersions: { __table: "track_versions" },
  notifications: { __table: "notifications" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  asc: (col: unknown) => ({ asc: col }),
  desc: (col: unknown) => ({ desc: col }),
  inArray: (col: unknown, vals: unknown[]) => ({ inArray: [col, vals] }),
}));

beforeEach(() => {
  producerSelectQueue.length = 0;
  projectSelectQueue.length = 0;
  updateWhereSpy.mockReset().mockResolvedValue(undefined);
  updateSetSpy.mockReset().mockReturnValue({ where: updateWhereSpy });
  transactionRanSpy.mockReset();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_proj_reorder" });
};

describe("projects.reorder", () => {
  it("reorders an owned, complete set, writing one update per id in a transaction", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([
      { id: ID_A, producerId: PRODUCER_ID },
      { id: ID_B, producerId: PRODUCER_ID },
      { id: ID_C, producerId: PRODUCER_ID },
    ]);
    const caller = await buildCaller();
    const result = await caller.project.reorder({
      orderedIds: [ID_A, ID_B, ID_C],
    });
    expect(result).toEqual({ count: 3 });
    expect(updateSetSpy.mock.calls).toEqual([
      [{ position: 0 }],
      [{ position: 1 }],
      [{ position: 2 }],
    ]);
    expect(transactionRanSpy).toHaveBeenCalledOnce();
  });

  it("throws NOT_FOUND if any id is missing from the projects table", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([
      { id: ID_A, producerId: PRODUCER_ID },
      { id: ID_B, producerId: PRODUCER_ID },
    ]);
    const caller = await buildCaller();
    await expect(
      caller.project.reorder({
        orderedIds: [ID_A, ID_B, ID_C],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN if any returned row belongs to another producer", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([
      { id: ID_A, producerId: PRODUCER_ID },
      { id: ID_B, producerId: OTHER_PRODUCER_ID },
      { id: ID_C, producerId: PRODUCER_ID },
    ]);
    const caller = await buildCaller();
    await expect(
      caller.project.reorder({
        orderedIds: [ID_A, ID_B, ID_C],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("rejects duplicate ids in input via zod", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    await expect(
      caller.project.reorder({
        orderedIds: [ID_A, ID_A, ID_B],
      }),
    ).rejects.toThrow();
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("rejects empty orderedIds via zod", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    await expect(
      caller.project.reorder({ orderedIds: [] }),
    ).rejects.toThrow();
    expect(updateSetSpy).not.toHaveBeenCalled();
  });
});
