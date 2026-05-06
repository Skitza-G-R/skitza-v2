import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ───────────────────────────────────────────────────
// Mock surface for `producer.overview.urgent`. The router fans out via
// Promise.all across:
//   1. projects        — live-stage rows for the producer
//   2. trackVersions   — joined to projectTracks → most-recent upload
//                        per project (drives the "stuck" rule)
//   3. bookings        — last booking-end per project (drives "overdue")
//                        + future-confirmed sessions (suppresses overdue)
//
// Pattern mirrors producer-today.test.ts: marker objects per table,
// dbMock dispatches by table to per-call mocks, where-spies capture
// the predicate tree for auth-scoping assertions.

const PRODUCER_ID = "producer-uuid-1";

const {
  producersMarker,
  projectsMarker,
  bookingsMarker,
  trackVersionsMarker,
  projectTracksMarker,
  projectsListMock,
  uploadsMock,
  bookingsAllMock,
  bookingsFutureMock,
  projectsListWhereSpy,
  uploadsWhereSpy,
  bookingsAllWhereSpy,
  bookingsFutureWhereSpy,
  resetCallCounts,
  dbMock,
} = vi.hoisted(() => {
  const projectsListMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const uploadsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const bookingsAllMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const bookingsFutureMock = vi.fn<() => Promise<Record<string, unknown>[]>>();

  const projectsListWhereSpy = vi.fn<(arg: unknown) => void>();
  const uploadsWhereSpy = vi.fn<(arg: unknown) => void>();
  const bookingsAllWhereSpy = vi.fn<(arg: unknown) => void>();
  const bookingsFutureWhereSpy = vi.fn<(arg: unknown) => void>();

  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    clerkUserId: { __column: "producers.clerk_user_id" },
  };
  const projectsMarker = {
    __table: "projects",
    id: { __column: "projects.id" },
    producerId: { __column: "projects.producer_id" },
    title: { __column: "projects.title" },
    stage: { __column: "projects.stage" },
    clientName: { __column: "projects.client_name" },
    artistName: { __column: "projects.artist_name" },
    depositPaid: { __column: "projects.deposit_paid" },
    finalPaid: { __column: "projects.final_paid" },
    updatedAt: { __column: "projects.updated_at" },
  };
  const bookingsMarker = {
    __table: "bookings",
    id: { __column: "bookings.id" },
    producerId: { __column: "bookings.producer_id" },
    projectId: { __column: "bookings.project_id" },
    startsAt: { __column: "bookings.starts_at" },
    durationMin: { __column: "bookings.duration_min" },
    status: { __column: "bookings.status" },
  };
  const trackVersionsMarker = {
    __table: "track_versions",
    id: { __column: "track_versions.id" },
    trackId: { __column: "track_versions.track_id" },
    uploadedAt: { __column: "track_versions.uploaded_at" },
  };
  const projectTracksMarker = {
    __table: "project_tracks",
    id: { __column: "project_tracks.id" },
    projectId: { __column: "project_tracks.project_id" },
  };

  // bookings is hit twice in the same Promise.all — first for the
  // last-booking-end pull, second for the future-confirmed pull. We
  // dispatch by call order so each leg can return distinct rows.
  const callCounts = { bookings: 0 };
  const resetCallCounts = () => {
    callCounts.bookings = 0;
  };

  const chain = (
    terminal: () => Promise<Record<string, unknown>[]>,
    whereSpy?: (arg: unknown) => void,
  ) => {
    let resolved: Promise<Record<string, unknown>[]> | null = null;
    const get = () => {
      resolved ??= terminal();
      return resolved;
    };
    type Link = {
      where: (arg: unknown) => Link;
      orderBy: () => Link;
      limit: () => Promise<Record<string, unknown>[]>;
      innerJoin: () => Link;
      leftJoin: () => Link;
      groupBy: () => Link;
      then: Promise<Record<string, unknown>[]>["then"];
    };
    const link: Link = {
      where: (arg: unknown) => {
        whereSpy?.(arg);
        return link;
      },
      orderBy: () => link,
      limit: () => get(),
      innerJoin: () => link,
      leftJoin: () => link,
      groupBy: () => link,
      get then() {
        const p = get();
        return p.then.bind(p);
      },
    };
    return link;
  };

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === producersMarker) {
          // producer-procedure middleware
          return {
            where: () => ({
              limit: () => Promise.resolve([{ id: PRODUCER_ID }]),
            }),
          };
        }
        if (table === projectsMarker) {
          return chain(() => projectsListMock(), projectsListWhereSpy);
        }
        if (table === trackVersionsMarker) {
          return chain(() => uploadsMock(), uploadsWhereSpy);
        }
        if (table === bookingsMarker) {
          callCounts.bookings += 1;
          const n = callCounts.bookings;
          return chain(
            () => (n === 1 ? bookingsAllMock() : bookingsFutureMock()),
            n === 1 ? bookingsAllWhereSpy : bookingsFutureWhereSpy,
          );
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };

  return {
    producersMarker,
    projectsMarker,
    bookingsMarker,
    trackVersionsMarker,
    projectTracksMarker,
    projectsListMock,
    uploadsMock,
    bookingsAllMock,
    bookingsFutureMock,
    projectsListWhereSpy,
    uploadsWhereSpy,
    bookingsAllWhereSpy,
    bookingsFutureWhereSpy,
    resetCallCounts,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_producer_1" }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  projects: projectsMarker,
  bookings: bookingsMarker,
  trackVersions: trackVersionsMarker,
  projectTracks: projectTracksMarker,
  // Sibling tables the producer module references at module-load time.
  invoices: { __table: "invoices" },
  trackComments: { __table: "track_comments" },
  portfolioTracks: { __table: "portfolio_tracks" },
  clientContacts: { __table: "client_contacts" },
  notifications: { __table: "notifications" },
  stripeCustomers: { __table: "stripe_customers" },
  availabilityBlackouts: { __table: "availability_blackouts" },
  availabilityBlocks: { __table: "availability_blocks" },
  products: { __table: "products" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  not: (cond: unknown) => ({ not: cond }),
  ne: (col: unknown, val: unknown) => ({ ne: [col, val] }),
  desc: (col: unknown) => ({ desc: col }),
  asc: (col: unknown) => ({ asc: col }),
  gte: (col: unknown, val: unknown) => ({ gte: [col, val] }),
  lte: (col: unknown, val: unknown) => ({ lte: [col, val] }),
  inArray: (col: unknown, vals: unknown[]) => ({ inArray: [col, vals] }),
  notInArray: (col: unknown, vals: unknown[]) => ({ notInArray: [col, vals] }),
  isNull: (col: unknown) => ({ isNull: col }),
  isNotNull: (col: unknown) => ({ isNotNull: col }),
  ilike: (col: unknown, val: unknown) => ({ ilike: [col, val] }),
  sql: () => ({ sql: true }),
}));

// Re-import for auth-scoping assertion.
import { projects } from "@skitza/db";
import { classifyUrgency } from "../producer";

beforeEach(() => {
  projectsListMock.mockReset().mockResolvedValue([]);
  uploadsMock.mockReset().mockResolvedValue([]);
  bookingsAllMock.mockReset().mockResolvedValue([]);
  bookingsFutureMock.mockReset().mockResolvedValue([]);
  projectsListWhereSpy.mockReset();
  uploadsWhereSpy.mockReset();
  bookingsAllWhereSpy.mockReset();
  bookingsFutureWhereSpy.mockReset();
  resetCallCounts();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_producer_1" });
};

function findPredicate(
  where: unknown,
  operator: "eq" | "inArray" | "gte" | "lte",
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
    if (!Array.isArray(args) && args === columnMarker) return args;
  }
  return null;
}

// Time anchors used across the rule-specific tests. We pick a fixed
// "now" instead of `new Date()` so every test against the +N-day
// thresholds is deterministic.
const NOW = new Date("2026-05-06T12:00:00.000Z");

const days = (n: number) => n * 24 * 60 * 60 * 1000;

describe("classifyUrgency (pure helper)", () => {
  it("returns 'overdue' when final unpaid + last session >7d ago + no future session", () => {
    const result = classifyUrgency({
      stage: "in_production",
      depositPaid: true,
      finalPaid: false,
      updatedAt: new Date(NOW.getTime() - days(20)),
      lastUploadAt: new Date(NOW.getTime() - days(2)),
      lastBookingEndAt: new Date(NOW.getTime() - days(10)),
      hasFutureSession: false,
      now: NOW,
    });
    expect(result).toBe("overdue");
  });

  it("does NOT return 'overdue' when a future session is on the calendar", () => {
    const result = classifyUrgency({
      stage: "in_production",
      depositPaid: true,
      finalPaid: false,
      updatedAt: new Date(NOW.getTime() - days(20)),
      lastUploadAt: new Date(NOW.getTime() - days(2)),
      lastBookingEndAt: new Date(NOW.getTime() - days(10)),
      hasFutureSession: true,
      now: NOW,
    });
    // future session suppresses overdue; nothing else applies →
    // in_production but recent uploads → null
    expect(result).toBeNull();
  });

  it("returns 'deposit_due' when booked + no deposit + idle >2d", () => {
    const result = classifyUrgency({
      stage: "booked",
      depositPaid: false,
      finalPaid: false,
      updatedAt: new Date(NOW.getTime() - days(5)),
      lastUploadAt: null,
      lastBookingEndAt: null,
      hasFutureSession: true,
      now: NOW,
    });
    expect(result).toBe("deposit_due");
  });

  it("does NOT return 'deposit_due' when deposit was paid", () => {
    const result = classifyUrgency({
      stage: "booked",
      depositPaid: true,
      finalPaid: false,
      updatedAt: new Date(NOW.getTime() - days(5)),
      lastUploadAt: null,
      lastBookingEndAt: null,
      hasFutureSession: true,
      now: NOW,
    });
    expect(result).toBeNull();
  });

  it("returns 'stuck' when in_production + no upload in >14d", () => {
    const result = classifyUrgency({
      stage: "in_production",
      depositPaid: true,
      finalPaid: false,
      updatedAt: new Date(NOW.getTime() - days(30)),
      lastUploadAt: new Date(NOW.getTime() - days(20)),
      lastBookingEndAt: null,
      hasFutureSession: true,
      now: NOW,
    });
    expect(result).toBe("stuck");
  });

  it("returns null when in_production + recent upload", () => {
    const result = classifyUrgency({
      stage: "in_production",
      depositPaid: true,
      finalPaid: false,
      updatedAt: new Date(NOW.getTime() - days(30)),
      lastUploadAt: new Date(NOW.getTime() - days(3)),
      lastBookingEndAt: null,
      hasFutureSession: true,
      now: NOW,
    });
    expect(result).toBeNull();
  });

  it("returns null for healthy lead-stage projects", () => {
    const result = classifyUrgency({
      stage: "lead",
      depositPaid: false,
      finalPaid: false,
      updatedAt: NOW,
      lastUploadAt: null,
      lastBookingEndAt: null,
      hasFutureSession: false,
      now: NOW,
    });
    expect(result).toBeNull();
  });
});

describe("producer.overview.urgent", () => {
  it("returns empty array when producer has no live projects", async () => {
    const caller = await buildCaller();
    const result = await caller.producer.overview.urgent();
    expect(result.items).toEqual([]);
  });

  it("surfaces an overdue project (final unpaid + booking >7d ago + no future session)", async () => {
    projectsListMock.mockResolvedValue([
      {
        id: "proj-overdue",
        title: "Late Mix",
        stage: "in_production",
        clientName: "Maya",
        artistName: "Maya",
        depositPaid: true,
        finalPaid: false,
        updatedAt: new Date(Date.now() - days(60)),
      },
    ]);
    bookingsAllMock.mockResolvedValue([
      {
        projectId: "proj-overdue",
        // 9 days ago, 60 minutes — ends ~9 days ago, > OVERDUE_DAYS=7.
        startsAt: new Date(Date.now() - days(9)),
        durationMin: 60,
        status: "confirmed",
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.overview.urgent();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "proj-overdue",
      title: "Late Mix",
      clientName: "Maya",
      stage: "in_production",
      urgency: "overdue",
    });
    expect(typeof result.items[0]?.gradient).toBe("string");
  });

  it("surfaces a deposit-due project (booked + depositPaid=false + idle >2d)", async () => {
    projectsListMock.mockResolvedValue([
      {
        id: "proj-dd",
        title: "Single",
        stage: "booked",
        clientName: "Yossi",
        artistName: "Yossi",
        depositPaid: false,
        finalPaid: false,
        updatedAt: new Date(Date.now() - days(5)),
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.overview.urgent();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.urgency).toBe("deposit_due");
  });

  it("surfaces a stuck-in-production project (no upload >14d)", async () => {
    projectsListMock.mockResolvedValue([
      {
        id: "proj-stuck",
        title: "EP Track 4",
        stage: "in_production",
        clientName: "Noa",
        artistName: "Noa",
        depositPaid: true,
        finalPaid: false,
        updatedAt: new Date(Date.now() - days(30)),
      },
    ]);
    uploadsMock.mockResolvedValue([
      {
        projectId: "proj-stuck",
        uploadedAt: new Date(Date.now() - days(20)),
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.overview.urgent();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.urgency).toBe("stuck");
  });

  it("sorts overdue → deposit_due → stuck and honors the default limit of 3", async () => {
    // Five urgent projects covering all three buckets so we can verify
    // both sort order AND that the default cap of 3 is respected.
    projectsListMock.mockResolvedValue([
      // stuck × 2
      {
        id: "p-stuck-a",
        title: "Aaa Stuck",
        stage: "in_production",
        clientName: "A",
        artistName: "A",
        depositPaid: true,
        finalPaid: false,
        updatedAt: new Date(Date.now() - days(30)),
      },
      {
        id: "p-stuck-b",
        title: "Bbb Stuck",
        stage: "in_production",
        clientName: "B",
        artistName: "B",
        depositPaid: true,
        finalPaid: false,
        updatedAt: new Date(Date.now() - days(30)),
      },
      // deposit_due × 1
      {
        id: "p-dd",
        title: "Ccc DepDue",
        stage: "booked",
        clientName: "C",
        artistName: "C",
        depositPaid: false,
        finalPaid: false,
        updatedAt: new Date(Date.now() - days(5)),
      },
      // overdue × 2
      {
        id: "p-overdue-a",
        title: "Ddd Overdue",
        stage: "in_production",
        clientName: "D",
        artistName: "D",
        depositPaid: true,
        finalPaid: false,
        updatedAt: new Date(Date.now() - days(60)),
      },
      {
        id: "p-overdue-b",
        title: "Eee Overdue",
        stage: "in_production",
        clientName: "E",
        artistName: "E",
        depositPaid: true,
        finalPaid: false,
        updatedAt: new Date(Date.now() - days(60)),
      },
    ]);
    bookingsAllMock.mockResolvedValue([
      {
        projectId: "p-overdue-a",
        startsAt: new Date(Date.now() - days(10)),
        durationMin: 60,
        status: "confirmed",
      },
      {
        projectId: "p-overdue-b",
        startsAt: new Date(Date.now() - days(10)),
        durationMin: 60,
        status: "confirmed",
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.overview.urgent();

    expect(result.items).toHaveLength(3);
    // Both overdue rows lead, deposit_due third, stuck rows are dropped
    // because the limit is 3.
    expect(result.items[0]?.urgency).toBe("overdue");
    expect(result.items[1]?.urgency).toBe("overdue");
    expect(result.items[2]?.urgency).toBe("deposit_due");
  });

  it("scopes the projects query to ctx.producerId (auth boundary)", async () => {
    const caller = await buildCaller();
    await caller.producer.overview.urgent();

    // The first projects.where call must reference projects.producerId
    // bound to PRODUCER_ID — guarantees a producer can't see another
    // producer's urgent rows.
    const projectsArg = projectsListWhereSpy.mock.calls[0]?.[0];
    const projectsPred = findPredicate(projectsArg, "eq", projects.producerId);
    expect(projectsPred).not.toBeNull();
    if (Array.isArray(projectsPred)) {
      expect(projectsPred[1]).toBe(PRODUCER_ID);
    }
  });
});
