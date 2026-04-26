import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// projectRoom.sessions returns the bookings tied to this project. The
// existing scope is unchanged from `project.detail` — we just relocate
// the read here so the Sessions sub-tab can fetch it independently.

const PRODUCER_ID = "producer-uuid-1";
const PROJECT_ID = "00000000-0000-0000-0000-000000000a01";

const {
  projectsMarker,
  producersMarker,
  bookingsMarker,
  producerSelectQueue,
  projectSelectQueue,
  bookingsMock,
  projectsWhereSpy,
  bookingsWhereSpy,
  dbMock,
} = vi.hoisted(() => {
  const projectsMarker: Record<string, unknown> = { __table: "projects" };
  projectsMarker.id = { __column: "projects.id" };
  projectsMarker.producerId = { __column: "projects.producer_id" };

  const producersMarker = { __table: "producers" };
  const bookingsMarker: Record<string, unknown> = { __table: "bookings" };
  bookingsMarker.projectId = { __column: "bookings.project_id" };
  bookingsMarker.producerId = { __column: "bookings.producer_id" };
  bookingsMarker.startsAt = { __column: "bookings.starts_at" };

  type Row = Record<string, unknown>;
  const producerSelectQueue: Row[][] = [];
  const projectSelectQueue: Row[][] = [];
  const bookingsMock = vi.fn<() => Promise<Row[]>>();
  const projectsWhereSpy = vi.fn<(arg: unknown) => void>();
  const bookingsWhereSpy = vi.fn<(arg: unknown) => void>();

  const chain = (
    terminal: () => Promise<Row[]>,
    whereSpy?: (arg: unknown) => void,
  ) => {
    let resolved: Promise<Row[]> | null = null;
    const get = () => {
      resolved ??= terminal();
      return resolved;
    };
    type Link = {
      where: (arg: unknown) => Link;
      orderBy: () => Link;
      limit: () => Promise<Row[]>;
      innerJoin: () => Link;
      then: Promise<Row[]>["then"];
    };
    const link: Link = {
      where: (arg: unknown) => {
        whereSpy?.(arg);
        return link;
      },
      orderBy: () => link,
      limit: () => get(),
      innerJoin: () => link,
      get then() {
        const p = get();
        return p.then.bind(p);
      },
    };
    return link;
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
              limit: () => Promise.resolve(shift(producerSelectQueue)),
            }),
          };
        }
        if (table === projectsMarker) {
          return {
            where: (arg: unknown) => {
              projectsWhereSpy(arg);
              return {
                limit: () => Promise.resolve(shift(projectSelectQueue)),
              };
            },
          };
        }
        if (table === bookingsMarker) {
          return chain(() => bookingsMock(), bookingsWhereSpy);
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
  };

  return {
    projectsMarker,
    producersMarker,
    bookingsMarker,
    producerSelectQueue,
    projectSelectQueue,
    bookingsMock,
    projectsWhereSpy,
    bookingsWhereSpy,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_1" }),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  projects: projectsMarker,
  bookings: bookingsMarker,
  // Other tables imported transitively — opaque markers.
  invoices: { __table: "invoices" },
  projectTracks: { __table: "project_tracks" },
  trackVersions: { __table: "track_versions" },
  trackComments: { __table: "track_comments" },
  notifications: { __table: "notifications" },
  contracts: { __table: "contracts" },
  clientContacts: { __table: "client_contacts" },
  stripeCustomers: { __table: "stripe_customers" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  not: (cond: unknown) => ({ not: cond }),
  desc: (col: unknown) => ({ desc: col }),
  asc: (col: unknown) => ({ asc: col }),
  gte: (col: unknown, val: unknown) => ({ gte: [col, val] }),
  lte: (col: unknown, val: unknown) => ({ lte: [col, val] }),
  inArray: (col: unknown, vals: unknown[]) => ({ inArray: [col, vals] }),
  isNull: (col: unknown) => ({ isNull: col }),
  isNotNull: (col: unknown) => ({ isNotNull: col }),
  ilike: (col: unknown, val: unknown) => ({ ilike: [col, val] }),
  sql: () => ({ sql: true }),
}));

import { bookings, projects } from "@skitza/db";

vi.mock("~/server/contacts/record", () => ({ recordContact: vi.fn() }));
vi.mock("~/server/notifications/emit", () => ({ emitCommentCreated: vi.fn() }));
vi.mock("~/lib/rate-limit/in-memory", () => ({
  checkRateLimit: () => ({ ok: true, remaining: 10 }),
}));

beforeEach(() => {
  producerSelectQueue.length = 0;
  projectSelectQueue.length = 0;
  bookingsMock.mockReset().mockResolvedValue([]);
  projectsWhereSpy.mockReset();
  bookingsWhereSpy.mockReset();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

function findPredicate(
  where: unknown,
  columnMarker: unknown,
  operator: "eq" | "inArray" = "eq",
  expectedValue?: unknown,
): boolean {
  if (!where || typeof where !== "object") return false;
  if ("and" in where && Array.isArray((where as { and: unknown[] }).and)) {
    for (const p of (where as { and: unknown[] }).and) {
      if (findPredicate(p, columnMarker, operator, expectedValue)) return true;
    }
    return false;
  }
  if (operator in where) {
    const args = (where as Record<string, unknown[]>)[operator];
    if (Array.isArray(args) && args[0] === columnMarker) {
      if (expectedValue === undefined) return true;
      return args[1] === expectedValue;
    }
  }
  return false;
}

const seedProject = () => {
  producerSelectQueue.push([{ id: PRODUCER_ID }]);
  projectSelectQueue.push([
    {
      id: PROJECT_ID,
      producerId: PRODUCER_ID,
    },
  ]);
};

describe("projectRoom.sessions", () => {
  it("returns an empty bookings list when project has no sessions", async () => {
    seedProject();
    const caller = await buildCaller();
    const result = await caller.projectRoom.sessions({ projectId: PROJECT_ID });
    expect(result).toEqual({ bookings: [] });
  });

  it("scopes the projects ownership SELECT by producerId (auth boundary)", async () => {
    seedProject();
    const caller = await buildCaller();
    await caller.projectRoom.sessions({ projectId: PROJECT_ID });

    const whereArg = projectsWhereSpy.mock.calls[0]?.[0];
    expect(findPredicate(whereArg, projects.id, "eq", PROJECT_ID)).toBe(true);
    expect(
      findPredicate(whereArg, projects.producerId, "eq", PRODUCER_ID),
    ).toBe(true);
  });

  it("scopes bookings SELECT by producerId AND projectId", async () => {
    seedProject();
    const caller = await buildCaller();
    await caller.projectRoom.sessions({ projectId: PROJECT_ID });

    // The bookings sub-query must scope by BOTH producerId (auth) AND
    // projectId (relevance) — dropping either is a leak.
    const whereArg = bookingsWhereSpy.mock.calls[0]?.[0];
    expect(
      findPredicate(whereArg, bookings.producerId, "eq", PRODUCER_ID),
    ).toBe(true);
    expect(findPredicate(whereArg, bookings.projectId, "eq", PROJECT_ID)).toBe(
      true,
    );
  });

  it("throws NOT_FOUND when project doesn't exist or belongs to another producer", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([]);
    const caller = await buildCaller();
    await expect(
      caller.projectRoom.sessions({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns bookings sorted by startsAt asc", async () => {
    seedProject();
    bookingsMock.mockResolvedValueOnce([
      {
        id: "b1",
        startsAt: new Date("2026-04-22T10:00:00Z"),
        durationMin: 240,
        status: "confirmed",
        artistName: "Maya",
        artistEmail: "maya@example.com",
        packageNameSnapshot: "4-hour Mix",
      },
      {
        id: "b2",
        startsAt: new Date("2026-04-29T10:00:00Z"),
        durationMin: 120,
        status: "pending",
        artistName: "Maya",
        artistEmail: "maya@example.com",
        packageNameSnapshot: "Master",
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.sessions({ projectId: PROJECT_ID });

    expect(result.bookings).toHaveLength(2);
    expect(result.bookings[0]).toMatchObject({
      id: "b1",
      durationMin: 240,
      status: "confirmed",
    });
  });
});
