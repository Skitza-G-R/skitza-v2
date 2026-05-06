import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ───────────────────────────────────────────────────
// Narrowly-scoped harness for `project.updateNotes`. The mutation:
//   1. SELECT producerId FROM projects WHERE id = ? LIMIT 1   (auth)
//   2. UPDATE projects SET notes = ?, updatedAt = ? WHERE id = ?
//
// We capture the SET payload + the SELECT auth check so the auth
// boundary + the notes write can be asserted independently of the rest
// of the project router (which does heavier Stripe/webhook plumbing).

const PRODUCER_ID = "producer-uuid-notes-1";
const OTHER_PRODUCER_ID = "producer-uuid-notes-2";
const PROJECT_ID = "00000000-0000-0000-0000-000000000a01";

const {
  producersMarker,
  projectsMarker,
  setSpy,
  whereSpy,
  updateMock,
  projectSelectQueue,
  dbMock,
} = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const setSpy = vi.fn<(payload: Row) => void>();
  const whereSpy = vi.fn<(where: unknown) => void>();
  const updateMock = vi.fn<() => Promise<void>>();
  const projectSelectQueue: Row[][] = [];

  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    clerkUserId: { __column: "producers.clerk_user_id" },
  };
  const projectsMarker = {
    __table: "projects",
    id: { __column: "projects.id" },
    producerId: { __column: "projects.producer_id" },
    notes: { __column: "projects.notes" },
    updatedAt: { __column: "projects.updated_at" },
  };

  function shift<T>(q: T[][]): T[] {
    return q.shift() ?? [];
  }

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === producersMarker) {
          return {
            where: () => ({
              limit: () => Promise.resolve([{ id: PRODUCER_ID }]),
            }),
          };
        }
        // projects — `updateNotes` does .where().limit(1) for the
        // ownership check.
        return {
          where: () => ({
            limit: () => Promise.resolve(shift(projectSelectQueue)),
          }),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (payload: Row) => {
        setSpy(payload);
        return {
          where: (w: unknown) => {
            whereSpy(w);
            return updateMock();
          },
        };
      },
      __table: table,
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };

  return {
    producersMarker,
    projectsMarker,
    setSpy,
    whereSpy,
    updateMock,
    projectSelectQueue,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_notes_1" }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  projects: projectsMarker,
  // Stub every other table the router module imports at load time.
  bookings: { __table: "bookings" },
  invoices: { __table: "invoices" },
  projectTracks: { __table: "project_tracks" },
  trackComments: { __table: "track_comments" },
  trackVersions: { __table: "track_versions" },
  notifications: { __table: "notifications" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  desc: (col: unknown) => ({ desc: col }),
  asc: (col: unknown) => ({ asc: col }),
  inArray: (col: unknown, vals: unknown[]) => ({ inArray: [col, vals] }),
  sql: () => ({ sql: true }),
}));
vi.mock("~/server/contacts/record", () => ({ recordContact: vi.fn() }));
vi.mock("~/server/notifications/emit", () => ({ emitCommentCreated: vi.fn() }));
vi.mock("~/lib/rate-limit/in-memory", () => ({
  checkRateLimit: () => ({ ok: true, remaining: 10 }),
}));
vi.mock("~/server/stripe/client", () => ({
  getStripe: () => ({
    paymentIntents: { create: vi.fn() },
    subscriptionSchedules: { cancel: vi.fn() },
  }),
  getSiteUrl: () => "https://skitza.test",
}));

import { projects } from "@skitza/db";

function findPredicate(
  where: unknown,
  operator: "eq" | "inArray",
  columnMarker: unknown,
): unknown {
  if (!where || typeof where !== "object") return null;
  if ("and" in where && Array.isArray((where as { and: unknown[] }).and)) {
    for (const p of (where as { and: unknown[] }).and) {
      const found = findPredicate(p, operator, columnMarker);
      if (found) return found;
    }
    return null;
  }
  if (operator in where) {
    const args = (where as Record<string, unknown>)[operator];
    if (Array.isArray(args) && args[0] === columnMarker) return args;
  }
  return null;
}

beforeEach(() => {
  setSpy.mockReset();
  whereSpy.mockReset();
  updateMock.mockReset().mockResolvedValue(undefined);
  projectSelectQueue.length = 0;
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_notes_1" });
};

describe("project.updateNotes", () => {
  it("happy path: writes notes + bumps updatedAt on the producer's project", async () => {
    projectSelectQueue.push([
      { id: PROJECT_ID, producerId: PRODUCER_ID },
    ]);
    const caller = await buildCaller();

    const before = Date.now();
    const res = await caller.project.updateNotes({
      projectId: PROJECT_ID,
      notes: "Mix sounds great. Ask about stems on Monday.",
    });
    const after = Date.now();

    expect(updateMock).toHaveBeenCalledTimes(1);

    // SET payload: { notes, updatedAt: <Date> }
    const setPayload = setSpy.mock.calls[0]?.[0] ?? {};
    expect(setPayload.notes).toBe("Mix sounds great. Ask about stems on Monday.");
    expect(setPayload.updatedAt).toBeInstanceOf(Date);

    // Returned updatedAt matches the SET payload's timestamp + sits
    // within the test window (sanity-check that we returned a fresh
    // Date rather than a cached one).
    expect(res.updatedAt).toEqual(setPayload.updatedAt);
    expect(res.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(res.updatedAt.getTime()).toBeLessThanOrEqual(after);

    // WHERE clause is scoped to the project id.
    const where = whereSpy.mock.calls[0]?.[0];
    const idPred = findPredicate(where, "eq", projects.id);
    expect(idPred).not.toBeNull();
    if (Array.isArray(idPred)) {
      expect(idPred[1]).toBe(PROJECT_ID);
    }
  });

  it("auth-scoping: producer A cannot update notes on producer B's project", async () => {
    // The middleware resolves the caller's producer row first, returning
    // PRODUCER_ID; then the procedure looks up the project and finds it
    // owned by OTHER_PRODUCER_ID. Should reject without writing.
    projectSelectQueue.push([
      { id: PROJECT_ID, producerId: OTHER_PRODUCER_ID },
    ]);

    const caller = await buildCaller();
    await expect(
      caller.project.updateNotes({
        projectId: PROJECT_ID,
        notes: "Trying to inject notes into someone else's project.",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Critical: no UPDATE should fire on a foreign project.
    expect(updateMock).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("auth-scoping: missing project rejects with NOT_FOUND", async () => {
    projectSelectQueue.push([]);
    const caller = await buildCaller();
    await expect(
      caller.project.updateNotes({
        projectId: PROJECT_ID,
        notes: "Notes for a project that doesn't exist.",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("length validation: rejects notes longer than 5000 chars with BAD_REQUEST", async () => {
    // We push a row to the select queue so the test fails on the
    // length validator and not because the project lookup short-
    // circuits. A correct implementation should never reach the
    // SELECT; the input validator runs first.
    projectSelectQueue.push([
      { id: PROJECT_ID, producerId: PRODUCER_ID },
    ]);
    const tooLong = "x".repeat(5001);
    const caller = await buildCaller();

    await expect(
      caller.project.updateNotes({
        projectId: PROJECT_ID,
        notes: tooLong,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("accepts the empty string (clearing the notes)", async () => {
    projectSelectQueue.push([
      { id: PROJECT_ID, producerId: PRODUCER_ID },
    ]);
    const caller = await buildCaller();

    await caller.project.updateNotes({
      projectId: PROJECT_ID,
      notes: "",
    });

    const setPayload = setSpy.mock.calls[0]?.[0] ?? {};
    expect(setPayload.notes).toBe("");
  });
});
