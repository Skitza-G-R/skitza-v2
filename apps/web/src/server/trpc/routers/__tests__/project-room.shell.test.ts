import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// projectRoom.shell is the page-shell query: minimal data to render the
// header strip + tab bar before any tab data lands. Returns title,
// artistName, artistAvatarUrl, stage, paymentStatus, tagPills.
//
// The test uses the marker-mock pattern (per CLAUDE.md): each table
// has a marker object, the dbMock dispatches by marker, and a
// per-table where-spy captures the WHERE arg so the auth-scoping
// assertion can walk the tree via findPredicate.
//
// vi.hoisted is required because vi.mock factories are hoisted above
// any top-level variable bindings — without hoisting the markers, the
// mock factory references uninitialized module-scope variables.

const PRODUCER_ID = "producer-uuid-1";
const PROJECT_ID = "00000000-0000-0000-0000-000000000a01";

const {
  projectsMarker,
  producersMarker,
  clientContactsMarker,
  producerSelectQueue,
  projectSelectQueue,
  clientContactsSelectQueue,
  projectsWhereSpy,
  clientContactsWhereSpy,
  dbMock,
} = vi.hoisted(() => {
  const projectsMarker: Record<string, unknown> = { __table: "projects" };
  projectsMarker.id = { __column: "projects.id" };
  projectsMarker.producerId = { __column: "projects.producer_id" };
  projectsMarker.artistEmail = { __column: "projects.artist_email" };

  const producersMarker = { __table: "producers" };
  const clientContactsMarker: Record<string, unknown> = {
    __table: "client_contacts",
  };
  clientContactsMarker.producerId = {
    __column: "client_contacts.producer_id",
  };
  clientContactsMarker.email = { __column: "client_contacts.email" };

  type Row = Record<string, unknown>;
  const producerSelectQueue: Row[][] = [];
  const projectSelectQueue: Row[][] = [];
  const clientContactsSelectQueue: Row[][] = [];

  const projectsWhereSpy = vi.fn<(arg: unknown) => void>();
  const clientContactsWhereSpy = vi.fn<(arg: unknown) => void>();

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
        if (table === clientContactsMarker) {
          return {
            where: (arg: unknown) => {
              clientContactsWhereSpy(arg);
              return {
                limit: () => Promise.resolve(shift(clientContactsSelectQueue)),
              };
            },
          };
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
  };

  return {
    projectsMarker,
    producersMarker,
    clientContactsMarker,
    producerSelectQueue,
    projectSelectQueue,
    clientContactsSelectQueue,
    projectsWhereSpy,
    clientContactsWhereSpy,
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
  clientContacts: clientContactsMarker,
  // Other tables imported by the project router file — opaque markers
  // so the module loads inside the test.
  bookings: { __table: "bookings" },
  invoices: { __table: "invoices" },
  projectTracks: { __table: "project_tracks" },
  trackVersions: { __table: "track_versions" },
  trackComments: { __table: "track_comments" },
  notifications: { __table: "notifications" },
  contracts: { __table: "contracts" },
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

// Re-import the marker so auth-scoping assertions reference the same
// object identity the router's WHERE clauses use.
import { projects } from "@skitza/db";

vi.mock("~/server/contacts/record", () => ({ recordContact: vi.fn() }));
vi.mock("~/server/notifications/emit", () => ({ emitCommentCreated: vi.fn() }));
vi.mock("~/lib/rate-limit/in-memory", () => ({
  checkRateLimit: () => ({ ok: true, remaining: 10 }),
}));

beforeEach(() => {
  producerSelectQueue.length = 0;
  projectSelectQueue.length = 0;
  clientContactsSelectQueue.length = 0;
  projectsWhereSpy.mockReset();
  clientContactsWhereSpy.mockReset();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

// findPredicate — walks an arbitrarily-nested and()/or() tree to find
// an (operator, column, optional value) match. Mirrors the helper in
// artist-home.test.ts but extended to optionally compare the value too
// so a producerId-leak regression caught at column identity is also
// caught at value identity.
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
  if ("or" in where && Array.isArray((where as { or: unknown[] }).or)) {
    for (const p of (where as { or: unknown[] }).or) {
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

describe("projectRoom.shell", () => {
  it("returns minimal page-shell shape (title, artistName, stage, paymentStatus, tagPills)", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: PRODUCER_ID,
        title: "Summer EP",
        artistName: "Maya Lin",
        artistEmail: "maya@example.com",
        stage: "in_production",
        depositPaid: true,
        finalPaid: false,
      },
    ]);
    clientContactsSelectQueue.push([
      { id: "cc1", tags: ["genre: hip-hop", "label: Universal"] },
    ]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.shell({ projectId: PROJECT_ID });

    expect(result).toEqual({
      title: "Summer EP",
      artistName: "Maya Lin",
      artistAvatarUrl: null,
      stage: "in_production",
      paymentStatus: "deposit_paid",
      tagPills: ["genre: hip-hop", "label: Universal"],
    });
  });

  it("scopes the projects SELECT by producerId (auth boundary)", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: PRODUCER_ID,
        title: "Summer EP",
        artistName: "Maya Lin",
        artistEmail: "maya@example.com",
        stage: "in_production",
        depositPaid: false,
        finalPaid: false,
      },
    ]);
    clientContactsSelectQueue.push([]);

    const caller = await buildCaller();
    await caller.projectRoom.shell({ projectId: PROJECT_ID });

    // The shell SELECT must filter by producerId — anything else leaks
    // cross-tenant data. We walk the captured WHERE tree to assert
    // both id-match AND producerId-match are present.
    const whereArg = projectsWhereSpy.mock.calls[0]?.[0];
    expect(findPredicate(whereArg, projects.id, "eq", PROJECT_ID)).toBe(true);
    expect(
      findPredicate(whereArg, projects.producerId, "eq", PRODUCER_ID),
    ).toBe(true);
  });

  it("throws NOT_FOUND when project doesn't exist", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([]);

    const caller = await buildCaller();
    await expect(
      caller.projectRoom.shell({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND (not FORBIDDEN) when project belongs to a different producer", async () => {
    // Avoid enumeration: cross-tenant access reads the same as
    // not-found from the caller's POV. The producerId scoping
    // predicate filters the row out, so the SELECT returns [].
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([]);

    const caller = await buildCaller();
    await expect(
      caller.projectRoom.shell({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws UNAUTHORIZED when caller is not signed in", async () => {
    const caller = await buildCaller(null);
    await expect(
      caller.projectRoom.shell({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns paymentStatus 'paid' when both deposit and final are paid", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: PRODUCER_ID,
        title: "Album",
        artistName: "X",
        artistEmail: "x@example.com",
        stage: "paid",
        depositPaid: true,
        finalPaid: true,
      },
    ]);
    clientContactsSelectQueue.push([]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.shell({ projectId: PROJECT_ID });
    expect(result.paymentStatus).toBe("paid");
  });

  it("returns paymentStatus 'unpaid' when neither deposit nor final is paid", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: PRODUCER_ID,
        title: "A",
        artistName: "B",
        artistEmail: "b@example.com",
        stage: "lead",
        depositPaid: false,
        finalPaid: false,
      },
    ]);
    clientContactsSelectQueue.push([]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.shell({ projectId: PROJECT_ID });
    expect(result.paymentStatus).toBe("unpaid");
  });

  it("returns empty tagPills when no client contact matches", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: PRODUCER_ID,
        title: "A",
        artistName: "B",
        artistEmail: "b@example.com",
        stage: "lead",
        depositPaid: false,
        finalPaid: false,
      },
    ]);
    clientContactsSelectQueue.push([]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.shell({ projectId: PROJECT_ID });
    expect(result.tagPills).toEqual([]);
  });
});
