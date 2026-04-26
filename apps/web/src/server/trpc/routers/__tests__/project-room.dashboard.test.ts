import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// projectRoom.dashboard returns the §11.5 Dashboard tab payload:
//   { latestVersion, whatsNext, recentActivity, openComments, sidebar }
// The fan-out is wider than `shell` — projects, projectTracks,
// trackVersions, trackComments, invoices, bookings, contracts, plus
// the producer-middleware preflight on producers.
//
// We mark per-table call counters because some tables (track_versions,
// invoices, bookings) are read more than once for distinct purposes
// (latest-version vs. activity-feed; outstanding-balance vs. unpaid
// invoice for the whats-next ladder). Per-call queues let each test
// seed exactly the rows the procedure needs in the order it asks.

const PRODUCER_ID = "producer-uuid-1";
const PROJECT_ID = "00000000-0000-0000-0000-000000000a01";

const {
  projectsMarker,
  producersMarker,
  projectTracksMarker,
  trackVersionsMarker,
  trackCommentsMarker,
  invoicesMarker,
  bookingsMarker,
  contractsMarker,
  producerSelectQueue,
  projectSelectQueue,
  projectTracksMock,
  trackVersionsMock,
  trackCommentsMock,
  invoicesMock,
  bookingsMock,
  contractsMock,
  projectsWhereSpy,
  trackVersionsWhereSpy,
  trackCommentsWhereSpy,
  invoicesWhereSpy,
  bookingsWhereSpy,
  contractsWhereSpy,
  resetCallCounts,
  dbMock,
} = vi.hoisted(() => {
  const projectsMarker: Record<string, unknown> = { __table: "projects" };
  projectsMarker.id = { __column: "projects.id" };
  projectsMarker.producerId = { __column: "projects.producer_id" };
  projectsMarker.artistEmail = { __column: "projects.artist_email" };

  const producersMarker = { __table: "producers" };
  const projectTracksMarker: Record<string, unknown> = {
    __table: "project_tracks",
  };
  projectTracksMarker.projectId = {
    __column: "project_tracks.project_id",
  };
  projectTracksMarker.id = { __column: "project_tracks.id" };

  const trackVersionsMarker: Record<string, unknown> = {
    __table: "track_versions",
  };
  trackVersionsMarker.trackId = { __column: "track_versions.track_id" };
  trackVersionsMarker.id = { __column: "track_versions.id" };
  trackVersionsMarker.uploadedAt = { __column: "track_versions.uploaded_at" };

  const trackCommentsMarker: Record<string, unknown> = {
    __table: "track_comments",
  };
  trackCommentsMarker.versionId = { __column: "track_comments.version_id" };
  trackCommentsMarker.fromProducer = {
    __column: "track_comments.from_producer",
  };
  trackCommentsMarker.resolvedAt = { __column: "track_comments.resolved_at" };

  const invoicesMarker: Record<string, unknown> = { __table: "invoices" };
  invoicesMarker.projectId = { __column: "invoices.project_id" };
  invoicesMarker.producerId = { __column: "invoices.producer_id" };
  invoicesMarker.status = { __column: "invoices.status" };

  const bookingsMarker: Record<string, unknown> = { __table: "bookings" };
  bookingsMarker.projectId = { __column: "bookings.project_id" };
  bookingsMarker.producerId = { __column: "bookings.producer_id" };
  bookingsMarker.startsAt = { __column: "bookings.starts_at" };

  const contractsMarker: Record<string, unknown> = { __table: "contracts" };
  contractsMarker.projectId = { __column: "contracts.project_id" };
  contractsMarker.producerId = { __column: "contracts.producer_id" };

  type Row = Record<string, unknown>;
  const producerSelectQueue: Row[][] = [];
  const projectSelectQueue: Row[][] = [];
  const projectTracksMock = vi.fn<() => Promise<Row[]>>();
  const trackVersionsMock = vi.fn<() => Promise<Row[]>>();
  const trackCommentsMock = vi.fn<() => Promise<Row[]>>();
  const invoicesMock = vi.fn<() => Promise<Row[]>>();
  const bookingsMock = vi.fn<() => Promise<Row[]>>();
  const contractsMock = vi.fn<() => Promise<Row[]>>();

  const projectsWhereSpy = vi.fn<(arg: unknown) => void>();
  const trackVersionsWhereSpy = vi.fn<(arg: unknown) => void>();
  const trackCommentsWhereSpy = vi.fn<(arg: unknown) => void>();
  const invoicesWhereSpy = vi.fn<(arg: unknown) => void>();
  const bookingsWhereSpy = vi.fn<(arg: unknown) => void>();
  const contractsWhereSpy = vi.fn<(arg: unknown) => void>();

  // Generic chain that terminates at any link of .where/.orderBy/.limit/
  // .innerJoin so the router can stop at any depth and still get the
  // right Promise back.
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

  const callCounts = { producers: 0 };
  const resetCallCounts = () => {
    callCounts.producers = 0;
  };

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === producersMarker) {
          callCounts.producers += 1;
          // The producer middleware always SELECTs producers first.
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
        if (table === projectTracksMarker) {
          return chain(() => projectTracksMock());
        }
        if (table === trackVersionsMarker) {
          return chain(() => trackVersionsMock(), trackVersionsWhereSpy);
        }
        if (table === trackCommentsMarker) {
          return chain(() => trackCommentsMock(), trackCommentsWhereSpy);
        }
        if (table === invoicesMarker) {
          return chain(() => invoicesMock(), invoicesWhereSpy);
        }
        if (table === bookingsMarker) {
          return chain(() => bookingsMock(), bookingsWhereSpy);
        }
        if (table === contractsMarker) {
          return chain(() => contractsMock(), contractsWhereSpy);
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
  };

  return {
    projectsMarker,
    producersMarker,
    projectTracksMarker,
    trackVersionsMarker,
    trackCommentsMarker,
    invoicesMarker,
    bookingsMarker,
    contractsMarker,
    producerSelectQueue,
    projectSelectQueue,
    projectTracksMock,
    trackVersionsMock,
    trackCommentsMock,
    invoicesMock,
    bookingsMock,
    contractsMock,
    projectsWhereSpy,
    trackVersionsWhereSpy,
    trackCommentsWhereSpy,
    invoicesWhereSpy,
    bookingsWhereSpy,
    contractsWhereSpy,
    resetCallCounts,
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
  projectTracks: projectTracksMarker,
  trackVersions: trackVersionsMarker,
  trackComments: trackCommentsMarker,
  invoices: invoicesMarker,
  bookings: bookingsMarker,
  contracts: contractsMarker,
  // Markers for any other tables imported transitively through the
  // project router file — keeps the module loadable.
  clientContacts: { __table: "client_contacts" },
  notifications: { __table: "notifications" },
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

import { projects } from "@skitza/db";

vi.mock("~/server/contacts/record", () => ({ recordContact: vi.fn() }));
vi.mock("~/server/notifications/emit", () => ({ emitCommentCreated: vi.fn() }));
vi.mock("~/lib/rate-limit/in-memory", () => ({
  checkRateLimit: () => ({ ok: true, remaining: 10 }),
}));

beforeEach(() => {
  producerSelectQueue.length = 0;
  projectSelectQueue.length = 0;
  projectTracksMock.mockReset().mockResolvedValue([]);
  trackVersionsMock.mockReset().mockResolvedValue([]);
  trackCommentsMock.mockReset().mockResolvedValue([]);
  invoicesMock.mockReset().mockResolvedValue([]);
  bookingsMock.mockReset().mockResolvedValue([]);
  contractsMock.mockReset().mockResolvedValue([]);
  projectsWhereSpy.mockReset();
  trackVersionsWhereSpy.mockReset();
  trackCommentsWhereSpy.mockReset();
  invoicesWhereSpy.mockReset();
  bookingsWhereSpy.mockReset();
  contractsWhereSpy.mockReset();
  resetCallCounts();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

function findPredicate(
  where: unknown,
  columnMarker: unknown,
  operator: "eq" | "inArray" | "isNull" = "eq",
  expectedValue?: unknown,
): boolean {
  if (!where || typeof where !== "object") return false;
  if ("and" in where && Array.isArray((where as { and: unknown[] }).and)) {
    for (const p of (where as { and: unknown[] }).and) {
      if (findPredicate(p, columnMarker, operator, expectedValue)) return true;
    }
    return false;
  }
  if (operator === "isNull" && "isNull" in where) {
    return (where as { isNull: unknown }).isNull === columnMarker;
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

const seedProject = (overrides: Record<string, unknown> = {}) => {
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
      currency: "USD",
      ...overrides,
    },
  ]);
};

describe("projectRoom.dashboard", () => {
  it("returns all 5 modules + sidebar with empty defaults when project has no activity", async () => {
    seedProject();
    const caller = await buildCaller();
    const result = await caller.projectRoom.dashboard({
      projectId: PROJECT_ID,
    });

    expect(result).toMatchObject({
      latestVersion: null,
      recentActivity: [],
      openComments: [],
      sidebar: expect.objectContaining({
        stage: "in_production",
        fileCount: 0,
        fileTotalBytes: 0,
      }) as unknown,
    });
    // whatsNext: with no contract / invoice / session / comment / version,
    // the precedence ladder hits "Otherwise → hidden" which we represent
    // as null. (PRD §11.5 step 6.)
    expect(result.whatsNext).toBeNull();
  });

  it("scopes the projects SELECT by producerId (auth boundary)", async () => {
    seedProject();
    const caller = await buildCaller();
    await caller.projectRoom.dashboard({ projectId: PROJECT_ID });

    const whereArg = projectsWhereSpy.mock.calls[0]?.[0];
    expect(findPredicate(whereArg, projects.id, "eq", PROJECT_ID)).toBe(true);
    expect(
      findPredicate(whereArg, projects.producerId, "eq", PRODUCER_ID),
    ).toBe(true);
  });

  it("throws NOT_FOUND when project doesn't exist or belongs to another producer", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([]);
    const caller = await buildCaller();
    await expect(
      caller.projectRoom.dashboard({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("populates latestVersion from the most recent track_versions row", async () => {
    seedProject();
    projectTracksMock.mockResolvedValueOnce([
      { id: "track-1", title: "Lead Single", projectId: PROJECT_ID },
    ]);
    trackVersionsMock.mockResolvedValueOnce([
      {
        id: "v2",
        trackId: "track-1",
        label: "V2",
        audioUrl: "https://r2/v2.mp3",
        uploadedAt: new Date("2026-04-20T10:00:00Z"),
        sizeBytes: 5_000_000,
        status: "draft",
      },
      {
        id: "v1",
        trackId: "track-1",
        label: "V1",
        audioUrl: "https://r2/v1.mp3",
        uploadedAt: new Date("2026-04-15T10:00:00Z"),
        sizeBytes: 4_000_000,
        status: "draft",
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.dashboard({
      projectId: PROJECT_ID,
    });

    // Implementation orders by uploadedAt DESC and picks the head.
    expect(result.latestVersion).toEqual({
      trackId: "track-1",
      trackTitle: "Lead Single",
      versionId: "v2",
      versionLabel: "V2",
      audioUrl: "https://r2/v2.mp3",
      sentAt: new Date("2026-04-20T10:00:00Z"),
      statusEnum: "draft",
    });

    // Sidebar.fileCount + fileTotalBytes come from the same versions feed.
    expect(result.sidebar.fileCount).toBe(2);
    expect(result.sidebar.fileTotalBytes).toBe(9_000_000);
  });

  it("whatsNext precedence: contract not signed beats unpaid invoice", async () => {
    // Setup: contract row exists but status is not 'signed', AND there's
    // an unpaid invoice past due. The ladder picks step 1 (contract).
    seedProject();
    contractsMock.mockResolvedValueOnce([
      {
        id: "contract-1",
        projectId: PROJECT_ID,
        producerId: PRODUCER_ID,
        status: "sent",
      },
    ]);
    // We seed an unpaid invoice too so the test asserts the ladder picks
    // contract over invoice (precedence, not first-match).
    invoicesMock.mockResolvedValueOnce([
      {
        id: "inv-1",
        amountCents: 50000,
        currency: "USD",
        status: "sent",
        dueAt: new Date("2026-04-01T00:00:00Z"),
        createdAt: new Date("2026-03-25T00:00:00Z"),
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.dashboard({
      projectId: PROJECT_ID,
    });

    // The ladder's `kind` is 'send_contract' for step 1.
    expect(result.whatsNext).not.toBeNull();
    expect(result.whatsNext?.kind).toBe("send_contract");
  });

  it("whatsNext: with NO contract row at all, unpaid invoice claims the slot", async () => {
    // No contract row → ladder skips step 1 and falls to step 2.
    seedProject();
    invoicesMock.mockResolvedValueOnce([
      {
        id: "inv-1",
        amountCents: 50000,
        currency: "USD",
        status: "sent",
        dueAt: new Date("2026-04-01T00:00:00Z"),
        createdAt: new Date("2026-03-25T00:00:00Z"),
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.dashboard({
      projectId: PROJECT_ID,
    });

    expect(result.whatsNext).not.toBeNull();
    expect(result.whatsNext?.kind).toBe("unpaid_invoice");
  });

  it("whatsNext: unread artist comment fires when no contract / invoice / session take precedence", async () => {
    seedProject();
    contractsMock.mockResolvedValueOnce([
      // Contract is signed → step 1 doesn't fire.
      {
        id: "contract-1",
        projectId: PROJECT_ID,
        producerId: PRODUCER_ID,
        status: "signed",
        signedAt: new Date("2026-04-10T00:00:00Z"),
      },
    ]);
    // Unresolved comment from artist (fromProducer=false). Steps 2-3
    // are unseeded → empty arrays → fall through to step 4.
    projectTracksMock.mockResolvedValueOnce([
      { id: "track-1", title: "Single", projectId: PROJECT_ID },
    ]);
    trackVersionsMock.mockResolvedValueOnce([
      {
        id: "v1",
        trackId: "track-1",
        label: "V1",
        audioUrl: "https://r2/v1.mp3",
        uploadedAt: new Date("2026-04-19T10:00:00Z"),
        sizeBytes: 3_000_000,
        status: "draft",
      },
    ]);
    trackCommentsMock.mockResolvedValueOnce([
      {
        id: "c1",
        versionId: "v1",
        body: "I want it darker",
        authorName: "Maya Lin",
        timestampMs: 30000,
        endTimestampMs: null,
        fromProducer: false,
        resolvedAt: null,
        createdAt: new Date("2026-04-19T11:00:00Z"),
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.dashboard({
      projectId: PROJECT_ID,
    });

    expect(result.whatsNext?.kind).toBe("unread_comment");
  });

  it("openComments: returns only unresolved + caps at 3", async () => {
    seedProject();
    projectTracksMock.mockResolvedValueOnce([
      { id: "track-1", title: "Single", projectId: PROJECT_ID },
    ]);
    trackVersionsMock.mockResolvedValueOnce([
      {
        id: "v1",
        trackId: "track-1",
        label: "V1",
        audioUrl: "https://r2/v1.mp3",
        uploadedAt: new Date("2026-04-19T10:00:00Z"),
        sizeBytes: 3_000_000,
        status: "draft",
      },
    ]);
    trackCommentsMock.mockResolvedValueOnce([
      // Most recent first — the implementation orders desc and slices to 3.
      {
        id: "c1",
        versionId: "v1",
        body: "fourth",
        authorName: "X",
        timestampMs: 1,
        fromProducer: false,
        resolvedAt: null,
        createdAt: new Date("2026-04-19T15:00:00Z"),
      },
      {
        id: "c2",
        versionId: "v1",
        body: "third",
        authorName: "X",
        timestampMs: 2,
        fromProducer: false,
        resolvedAt: null,
        createdAt: new Date("2026-04-19T14:00:00Z"),
      },
      {
        id: "c3",
        versionId: "v1",
        body: "second",
        authorName: "X",
        timestampMs: 3,
        fromProducer: false,
        resolvedAt: null,
        createdAt: new Date("2026-04-19T13:00:00Z"),
      },
      {
        id: "c4",
        versionId: "v1",
        body: "first",
        authorName: "X",
        timestampMs: 4,
        fromProducer: false,
        resolvedAt: null,
        createdAt: new Date("2026-04-19T12:00:00Z"),
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.dashboard({
      projectId: PROJECT_ID,
    });

    expect(result.openComments).toHaveLength(3);
    // Each entry carries trackTitle so the UI doesn't have to re-derive
    // it from a separate map.
    expect(result.openComments[0]).toMatchObject({
      trackId: "track-1",
      trackTitle: "Single",
      body: "fourth",
    });
  });

  it("sidebar.money mirrors paid + outstanding totals", async () => {
    seedProject({ depositPaid: true });
    invoicesMock.mockResolvedValueOnce([
      {
        id: "i-paid",
        amountCents: 50000,
        currency: "USD",
        status: "paid",
        createdAt: new Date("2026-04-01T00:00:00Z"),
      },
      {
        id: "i-sent",
        amountCents: 50000,
        currency: "USD",
        status: "sent",
        createdAt: new Date("2026-04-10T00:00:00Z"),
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.dashboard({
      projectId: PROJECT_ID,
    });

    expect(result.sidebar.paidAmount?.cents).toBe(50000);
    expect(result.sidebar.outstandingAmount?.cents).toBe(50000);
  });
});
