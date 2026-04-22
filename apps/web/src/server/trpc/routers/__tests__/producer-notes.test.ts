import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for producerNotesRouter — audit Task 11 (Quick Note DB
// backing, overnight Task C of 2026-04-22). Uses the same mock-DB
// pattern as portfolio.test.ts so the producer-id scoping is
// verifiable without a real Postgres round-trip.

const PRODUCER_ID = "producer-uuid-1";
const NOTE_ID = "00000000-0000-0000-0000-000000000001";

// Marker tables for branching dbMock queries.
const producersMarker = { __table: "producers", id: { _name: "id" } };
const producerNotesMarker = {
  __table: "producer_notes",
  id: { _name: "id" },
  producerId: { _name: "producer_id" },
  createdAt: { _name: "created_at" },
  body: { _name: "body" },
};

type Row = Record<string, unknown>;

// Tracks the last where-args handed to delete/list so scope assertions
// can inspect them.
let lastListWhereArgs: unknown = null;
let lastDeleteWhereArgs: unknown = null;

// Separate mocks per chain terminal.
const producerSelectByClerkMock =
  vi.fn<() => Promise<Array<{ id: string }>>>();
const notesListMock = vi.fn<() => Promise<Row[]>>();
const notesInsertReturningMock = vi.fn<() => Promise<Row[]>>();
const notesDeleteMock = vi.fn<() => Promise<void>>();

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      if (table === producersMarker) {
        // producerProcedure loads the caller's producer row.
        return { where: () => ({ limit: () => producerSelectByClerkMock() }) };
      }
      // producerNotes — list query. Capture where args for scoping
      // assertions, terminate with orderBy().
      if (table === producerNotesMarker) {
        return {
          where: (args: unknown) => {
            lastListWhereArgs = args;
            return { orderBy: () => notesListMock() };
          },
        };
      }
      throw new Error(`unexpected select().from(${String(table)})`);
    },
  }),
  insert: () => ({
    values: () => ({ returning: () => notesInsertReturningMock() }),
  }),
  delete: () => ({
    where: (args: unknown) => {
      lastDeleteWhereArgs = args;
      return notesDeleteMock();
    },
  }),
};

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_1" }),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  producerNotes: producerNotesMarker,
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...args: unknown[]) => ({ and: args }),
  desc: (col: unknown) => ({ desc: col }),
}));

beforeEach(() => {
  producerSelectByClerkMock
    .mockReset()
    .mockResolvedValue([{ id: PRODUCER_ID }]);
  notesListMock.mockReset().mockResolvedValue([]);
  notesInsertReturningMock.mockReset().mockResolvedValue([]);
  notesDeleteMock.mockReset().mockResolvedValue();
  lastListWhereArgs = null;
  lastDeleteWhereArgs = null;
  process.env.DATABASE_URL = "postgresql://test/test";
});

// Shared helper — checks whether a where-predicate tree contains an
// eq(col, value) anywhere under and()-nesting. Matches the idiom used
// across other router tests.
function containsEq(tree: unknown, columnMarker: unknown, value: unknown): boolean {
  if (tree && typeof tree === "object") {
    const t = tree as Record<string, unknown>;
    if (Array.isArray(t.eq) && t.eq[0] === columnMarker && t.eq[1] === value) {
      return true;
    }
    if (Array.isArray(t.and)) {
      return t.and.some((child) => containsEq(child, columnMarker, value));
    }
  }
  return false;
}

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_1" });
};

describe("producerNotesRouter.list", () => {
  it("returns the notes array scoped to the caller's producer, newest-first via orderBy(desc(createdAt))", async () => {
    notesListMock.mockResolvedValueOnce([
      {
        id: "n1",
        producerId: PRODUCER_ID,
        body: "newest",
        createdAt: new Date("2026-04-22"),
      },
      {
        id: "n2",
        producerId: PRODUCER_ID,
        body: "older",
        createdAt: new Date("2026-04-20"),
      },
    ]);
    const caller = await buildCaller();
    const result = await caller.producerNotes.list();
    expect(result.notes).toHaveLength(2);
    expect(result.notes[0]?.body).toBe("newest");

    // Scoping invariant: the WHERE includes eq(producerId, PRODUCER_ID).
    expect(
      containsEq(lastListWhereArgs, producerNotesMarker.producerId, PRODUCER_ID),
    ).toBe(true);
  });

  it("returns empty notes array when producer has none", async () => {
    const caller = await buildCaller();
    const result = await caller.producerNotes.list();
    expect(result.notes).toEqual([]);
  });
});

describe("producerNotesRouter.save", () => {
  it("inserts a note with the caller's producer id + returns the row", async () => {
    const returnedRow = {
      id: NOTE_ID,
      producerId: PRODUCER_ID,
      body: "studio is on fire",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    notesInsertReturningMock.mockResolvedValueOnce([returnedRow]);

    const caller = await buildCaller();
    const result = await caller.producerNotes.save({
      body: "studio is on fire",
    });

    expect(result.id).toBe(NOTE_ID);
    expect(result.body).toBe("studio is on fire");
  });

  it("throws on empty body (zod validation)", async () => {
    const caller = await buildCaller();
    await expect(
      caller.producerNotes.save({ body: "   " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // No DB write.
    expect(notesInsertReturningMock).not.toHaveBeenCalled();
  });

  it("throws on body over the 4000-char cap", async () => {
    const caller = await buildCaller();
    await expect(
      caller.producerNotes.save({ body: "a".repeat(4001) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("throws INTERNAL_SERVER_ERROR when INSERT returns no row", async () => {
    notesInsertReturningMock.mockResolvedValueOnce([]);
    const caller = await buildCaller();
    await expect(
      caller.producerNotes.save({ body: "note" }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("producerNotesRouter.delete", () => {
  it("deletes scoped to the caller's producer (no cross-tenant delete)", async () => {
    const caller = await buildCaller();
    const result = await caller.producerNotes.delete({ id: NOTE_ID });
    expect(result.ok).toBe(true);

    // Scoping invariant: WHERE includes BOTH eq(id, NOTE_ID) AND
    // eq(producerId, PRODUCER_ID). If only one were present, a caller
    // could delete another producer's note by guessing the uuid.
    expect(containsEq(lastDeleteWhereArgs, producerNotesMarker.id, NOTE_ID)).toBe(
      true,
    );
    expect(
      containsEq(
        lastDeleteWhereArgs,
        producerNotesMarker.producerId,
        PRODUCER_ID,
      ),
    ).toBe(true);
  });

  it("rejects malformed uuid input via zod", async () => {
    const caller = await buildCaller();
    await expect(
      caller.producerNotes.delete({ id: "not-a-uuid" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(notesDeleteMock).not.toHaveBeenCalled();
  });
});
