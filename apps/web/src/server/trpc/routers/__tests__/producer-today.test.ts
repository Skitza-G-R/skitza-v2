import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// Mirrors artist-home.test.ts: marker objects per table, dbMock's
// select().from() dispatches by table to a per-table mock fn, and a
// per-table WHERE-spy captures the predicate tree so auth-scoping
// tests can inspect which columns were filtered.
//
// `producer.today` fans out across projects, bookings, comments, uploads,
// and the producer profile. Purchase-ledger dashboard totals intentionally
// remain unavailable until the Payments projection exists; this test must
// not recreate removed invoice-table behavior in its mocks.
// The producers table is hit once by producer-procedure to resolve
// ctx.producerId from ctx.userId.

const PRODUCER_ID = "producer-uuid-1";

const {
  producersMarker,
  projectsMarker,
  purchasesMarker,
  bookingsMarker,
  trackCommentsMarker,
  trackVersionsMarker,
  projectTracksMarker,
  projectsCountMock,
  upcomingSessionsMock,
  openCommentsMock,
  openCommentsRowsMock,
  projectsCountWhereSpy,
  upcomingSessionsWhereSpy,
  openCommentsWhereSpy,
  openCommentsRowsWhereSpy,
  resetCallCounts,
  dbMock,
} = vi.hoisted(() => {
  const projectsCountMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const upcomingSessionsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const openCommentsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const openCommentsRowsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();

  const projectsCountWhereSpy = vi.fn<(arg: unknown) => void>();
  const upcomingSessionsWhereSpy = vi.fn<(arg: unknown) => void>();
  const openCommentsWhereSpy = vi.fn<(arg: unknown) => void>();
  const openCommentsRowsWhereSpy = vi.fn<(arg: unknown) => void>();

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
    lifecycleStatus: { __column: "projects.lifecycle_status" },
    clientName: { __column: "projects.client_name" },
    artistName: { __column: "projects.artist_name" },
    updatedAt: { __column: "projects.updated_at" },
  };
  const purchasesMarker = {
    __table: "purchases",
    id: { __column: "purchases.id" },
    commercialSnapshot: { __column: "purchases.commercial_snapshot" },
  };
  const bookingsMarker = {
    __table: "bookings",
    id: { __column: "bookings.id" },
    producerId: { __column: "bookings.producer_id" },
    startsAt: { __column: "bookings.starts_at" },
    status: { __column: "bookings.status" },
    artistName: { __column: "bookings.artist_name" },
    durationMin: { __column: "bookings.duration_min" },
    packageNameSnapshot: { __column: "bookings.package_name_snapshot" },
    projectId: { __column: "bookings.project_id" },
  };
  const trackCommentsMarker = {
    __table: "track_comments",
    id: { __column: "track_comments.id" },
    versionId: { __column: "track_comments.version_id" },
    body: { __column: "track_comments.body" },
    authorName: { __column: "track_comments.author_name" },
    resolvedAt: { __column: "track_comments.resolved_at" },
    createdAt: { __column: "track_comments.created_at" },
    fromProducer: { __column: "track_comments.from_producer" },
  };
  const trackVersionsMarker = {
    __table: "track_versions",
    id: { __column: "track_versions.id" },
    trackId: { __column: "track_versions.track_id" },
  };
  const projectTracksMarker = {
    __table: "project_tracks",
    id: { __column: "project_tracks.id" },
    projectId: { __column: "project_tracks.project_id" },
    title: { __column: "project_tracks.title" },
  };

  // Per-table counters distinguish the two track-comment projections.
  const callCounts = {
    bookings: 0,
    track_comments: 0,
  };
  const resetCallCounts = () => {
    callCounts.bookings = 0;
    callCounts.track_comments = 0;
  };

  // Chain handler — every terminal (.where, .orderBy, .limit, .then)
  // resolves the same cached Promise so the router can `await` at any
  // hop. innerJoin is transparent.
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
          // producer-procedure: .where(clerkUserId = x).limit(1) →
          // return [{ id: PRODUCER_ID }].
          return {
            where: () => ({
              limit: () => Promise.resolve([{ id: PRODUCER_ID }]),
            }),
          };
        }
        if (table === projectsMarker) {
          return chain(projectsCountMock, projectsCountWhereSpy);
        }
        if (table === bookingsMarker) {
          callCounts.bookings += 1;
          return chain(() => upcomingSessionsMock(), upcomingSessionsWhereSpy);
        }
        if (table === trackCommentsMarker) {
          callCounts.track_comments += 1;
          const n = callCounts.track_comments;
          // 1st: open-comments count (KPI piece)
          // 2nd: open-comments rows (items list)
          // 3rd+: per-row unread-comments follow-up sub-queries
          //       added in the Today redesign (recentUploads leg).
          //       These tests don't seed recentUploadsMock, so the
          //       follow-up loop is empty and these branches are not
          //       reached. Routing 3+ → openCommentsRowsMock keeps
          //       the dispatch total — falling through to a default
          //       resolves to [] either way.
          return chain(
            () => (n === 1 ? openCommentsMock() : openCommentsRowsMock()),
            n === 1 ? openCommentsWhereSpy : openCommentsRowsWhereSpy,
          );
        }
        if (table === trackVersionsMarker) {
          // Added 2026-04-25 (today-redesign Story 1): the new
          // recentUploads leg SELECTs from track_versions. These
          // legacy tests don't care about its rows — return [].
          return chain(() => Promise.resolve<Record<string, unknown>[]>([]));
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
  };

  return {
    producersMarker,
    projectsMarker,
    purchasesMarker,
    bookingsMarker,
    trackCommentsMarker,
    trackVersionsMarker,
    projectTracksMarker,
    projectsCountMock,
    upcomingSessionsMock,
    openCommentsMock,
    openCommentsRowsMock,
    projectsCountWhereSpy,
    upcomingSessionsWhereSpy,
    openCommentsWhereSpy,
    openCommentsRowsWhereSpy,
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
  purchases: purchasesMarker,
  bookings: bookingsMarker,
  trackComments: trackCommentsMarker,
  trackVersions: trackVersionsMarker,
  projectTracks: projectTracksMarker,
  // Tables referenced elsewhere in the producer router module — opaque
  // markers so the router loads inside the test.
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

// Re-import the mocked symbols so the auth-boundary tests assert the
// router's WHERE clauses reference the same column markers the rest
// of the codebase imports.
import { bookings, projects, trackComments } from "@skitza/db";

beforeEach(() => {
  projectsCountMock.mockReset().mockResolvedValue([]);
  upcomingSessionsMock.mockReset().mockResolvedValue([]);
  openCommentsMock.mockReset().mockResolvedValue([]);
  openCommentsRowsMock.mockReset().mockResolvedValue([]);
  projectsCountWhereSpy.mockReset();
  upcomingSessionsWhereSpy.mockReset();
  openCommentsWhereSpy.mockReset();
  openCommentsRowsWhereSpy.mockReset();
  resetCallCounts();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_producer_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

// Walks an arbitrarily nested `and(...)` tree to find an (operator,
// column) pair. Mirrors artist-home.test.ts's findPredicate.
function findPredicate(
  where: unknown,
  operator: "eq" | "inArray" | "gte" | "lte" | "isNull" | "isNotNull",
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

describe("producer.today", () => {
  it("returns unavailable money KPIs + empty items when producer has no activity", async () => {
    // All sub-mocks default to [] via beforeEach. Revenue currency
    // default is whatever the router picks — "USD" or the producer's
    // defaultCurrency. Just verify the zero shape.
    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.kpis).toEqual({
      activeProjects: 0,
      revenueMonthCents: null,
      revenueCurrency: null,
      upcomingSessions7d: 0,
      unresolvedItems: 0,
    });
    expect(result.items).toEqual([]);
    expect(result.savedViews).toEqual([]);
  });

  it("counts upcoming sessions within the 7-day window", async () => {
    const now = new Date();
    const in3days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const in5days = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    // 2 confirmed sessions in the next 7 days. The router's WHERE
    // clause already filters to the 7-day horizon — we seed the
    // winners only.
    upcomingSessionsMock.mockResolvedValueOnce([
      {
        id: "b1",
        startsAt: in3days,
        durationMin: 120,
        artistName: "Alice",
        packageNameSnapshot: "2h Mix",
      },
      {
        id: "b2",
        startsAt: in5days,
        durationMin: 240,
        artistName: "Bob",
        packageNameSnapshot: "4h Master",
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.kpis.upcomingSessions7d).toBe(2);
    // And the sessions should appear in the items list, kind=session.
    const sessionItems = result.items.filter((i) => i.kind === "session");
    expect(sessionItems).toHaveLength(2);
  });

  // Pinned 2026-05-07 — the "Open client room" button on the Overview
  // screen reads from `today.items[*].href`. Pre-fix, every session item
  // hard-coded `/dashboard/booking?id=...` which the v3-clean middleware
  // 301'd to `/dashboard/calendar`, so the button silently navigated to
  // the calendar instead of the project room. Fix routes through
  // bookings.projectId, falling back to /dashboard/calendar only when no
  // project is attached. This test pins both branches.
  it("session items deep-link to the project room when bookings.projectId is set", async () => {
    const now = new Date();
    const in1hour = new Date(now.getTime() + 60 * 60 * 1000);
    const in2hours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    upcomingSessionsMock.mockResolvedValueOnce([
      {
        id: "b-with-project",
        startsAt: in1hour,
        durationMin: 60,
        artistName: "Alice",
        packageNameSnapshot: "1h Mix",
        projectId: "proj-123",
      },
      {
        id: "b-orphan",
        startsAt: in2hours,
        durationMin: 30,
        artistName: "Bob",
        packageNameSnapshot: "Consult",
        projectId: null,
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.today();
    const sessions = result.items.filter((i) => i.kind === "session");
    const withProject = sessions.find((s) => s.id === "session:b-with-project");
    const orphan = sessions.find((s) => s.id === "session:b-orphan");

    expect(withProject?.href).toBe("/dashboard/clients-projects/proj-123");
    expect(orphan?.href).toBe("/dashboard/calendar");
  });

  it("keeps purchase projections unavailable and counts only open comments", async () => {
    openCommentsMock.mockResolvedValueOnce([{ id: "c1" }, { id: "c2" }]);

    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.kpis.revenueMonthCents).toBeNull();
    expect(result.kpis.unresolvedItems).toBe(2);
    expect(result.pulseStats.commercialAvailable).toBe(false);
    expect(result.pulseStats.thisMonthCents).toBeNull();
    expect(result.pulseStats.lastMonthCents).toBeNull();
    expect(result.pulseStats.outstandingCents).toBeNull();
    expect(result.items).toEqual([]);
  });

  it("sorts available items by urgency: session before unread comment", async () => {
    const now = new Date();
    const in1hour = new Date(now.getTime() + 60 * 60 * 1000);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    upcomingSessionsMock.mockResolvedValueOnce([
      {
        id: "b1",
        startsAt: in1hour,
        durationMin: 120,
        artistName: "Alice",
        packageNameSnapshot: "2h Mix",
      },
    ]);
    openCommentsRowsMock.mockResolvedValueOnce([
      {
        id: "c1",
        body: "sounds thin",
        authorName: "Alice",
        createdAt: yesterday,
        projectId: "p1",
      },
    ]);
    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.kind).toBe("session");
    expect(result.items[1]?.kind).toBe("comment");
  });

  it("caps items at 50", async () => {
    // Seed 60 open comments. Even if the router seeds more than 50
    // rows across the 4 sources, the final items array must be ≤ 50.
    openCommentsRowsMock.mockResolvedValueOnce(
      Array.from({ length: 60 }, (_, i) => ({
        id: `c-${String(i)}`,
        body: `comment ${String(i)}`,
        authorName: `Artist ${String(i)}`,
        createdAt: new Date(Date.now() - i * 60_000),
        projectId: "p1",
      })),
    );

    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.items.length).toBeLessThanOrEqual(50);
  });

  it("scopes ALL sub-queries to ctx.producerId (auth boundary)", async () => {
    const caller = await buildCaller();
    await caller.producer.today();

    // Each primary sub-query's WHERE must reference the producer-id
    // column on its own table with an eq(<col>, PRODUCER_ID). We use
    // findPredicate to walk potentially-nested and(...) trees.
    const projectsCountArg = projectsCountWhereSpy.mock.calls[0]?.[0];
    const projectsPred = findPredicate(projectsCountArg, "eq", projects.producerId);
    expect(projectsPred).not.toBeNull();
    if (Array.isArray(projectsPred)) {
      expect(projectsPred[1]).toBe(PRODUCER_ID);
    }

    const lifecyclePred = findPredicate(projectsCountArg, "inArray", projects.lifecycleStatus);
    expect(lifecyclePred).not.toBeNull();
    if (Array.isArray(lifecyclePred)) {
      expect(lifecyclePred[1]).toEqual(["waiting_for_payment", "active", "paused"]);
    }

    const upcomingArg = upcomingSessionsWhereSpy.mock.calls[0]?.[0];
    const upcomingPred = findPredicate(upcomingArg, "eq", bookings.producerId);
    expect(upcomingPred).not.toBeNull();
    if (Array.isArray(upcomingPred)) {
      expect(upcomingPred[1]).toBe(PRODUCER_ID);
    }

    // Comment rows join through projects, where the tenant boundary lives.
    const openCommentsArg = openCommentsWhereSpy.mock.calls[0]?.[0];
    const commentsProducerPred = findPredicate(openCommentsArg, "eq", projects.producerId);
    expect(commentsProducerPred).not.toBeNull();
    if (Array.isArray(commentsProducerPred)) {
      expect(commentsProducerPred[1]).toBe(PRODUCER_ID);
    }

    // Touch the `trackComments` marker so the import survives the
    // test scope pruning in the type-checker.
    expect(trackComments).toBeDefined();
  });
});
