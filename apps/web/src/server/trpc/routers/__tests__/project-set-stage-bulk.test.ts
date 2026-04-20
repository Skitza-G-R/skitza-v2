import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ───────────────────────────────────────────────────
// Narrowly-scoped harness for `project.setStageBulk`. The mutation is
// a single UPDATE scoped by producer_id + id IN (…); we capture the
// SET payload + the WHERE tree so the auth boundary + the stage
// transition can be asserted independently of the Stripe/webhook
// plumbing that the main project.test.ts covers.

const PRODUCER_ID = "producer-uuid-bulk-1";

const {
  producersMarker,
  projectsMarker,
  setSpy,
  whereSpy,
  updateMock,
  dbMock,
} = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const setSpy = vi.fn<(payload: Row) => void>();
  const whereSpy = vi.fn<(where: unknown) => void>();
  const updateMock = vi.fn<() => Promise<void>>();

  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    clerkUserId: { __column: "producers.clerk_user_id" },
  };
  const projectsMarker = {
    __table: "projects",
    id: { __column: "projects.id" },
    producerId: { __column: "projects.producer_id" },
    stage: { __column: "projects.stage" },
    updatedAt: { __column: "projects.updated_at" },
  };

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
        // The bulk mutation does NOT do a per-id SELECT — we assert
        // that by throwing if anything tries to read projects in-band.
        return {
          where: () => ({ limit: () => Promise.resolve([]) }),
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
      // Consume the table marker argument so eslint-no-unused-vars
      // doesn't complain on the caller side.
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
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_bulk_1" }),
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
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_bulk_1" });
};

describe("project.setStageBulk", () => {
  it("updates stage + scopes WHERE to producer_id + id IN ids", async () => {
    const caller = await buildCaller();
    const ids = [
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000002",
    ];
    const res = await caller.project.setStageBulk({ ids, stage: "archived" });

    expect(res).toEqual({ ok: true, count: 2 });
    expect(updateMock).toHaveBeenCalledTimes(1);

    // SET payload: { stage: "archived", updatedAt: <Date> }
    const setPayload = setSpy.mock.calls[0]?.[0] ?? {};
    expect(setPayload.stage).toBe("archived");
    expect(setPayload.updatedAt).toBeInstanceOf(Date);

    // WHERE: and(eq(producerId, PRODUCER_ID), inArray(id, ids))
    const where = whereSpy.mock.calls[0]?.[0];
    const pidPred = findPredicate(where, "eq", projects.producerId);
    expect(pidPred).not.toBeNull();
    if (Array.isArray(pidPred)) {
      expect(pidPred[1]).toBe(PRODUCER_ID);
    }
    const idPred = findPredicate(where, "inArray", projects.id);
    expect(idPred).not.toBeNull();
    if (Array.isArray(idPred)) {
      expect(idPred[1]).toEqual(ids);
    }
  });

  it("rejects cancelled + payment_paused transitions (guarded states)", async () => {
    const caller = await buildCaller();
    const ids = ["00000000-0000-0000-0000-000000000099"];

    await expect(
      caller.project.setStageBulk({ ids, stage: "cancelled" }),
    ).rejects.toThrow();
    await expect(
      caller.project.setStageBulk({ ids, stage: "payment_paused" }),
    ).rejects.toThrow();

    // Guard runs BEFORE the update — no rows should have been touched.
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("allows the common transitions (archived + paid)", async () => {
    const caller = await buildCaller();
    const ids = ["00000000-0000-0000-0000-000000000010"];

    await caller.project.setStageBulk({ ids, stage: "archived" });
    await caller.project.setStageBulk({ ids, stage: "paid" });

    expect(updateMock).toHaveBeenCalledTimes(2);
  });
});
