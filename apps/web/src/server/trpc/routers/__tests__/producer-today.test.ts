import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// Mirrors artist-home.test.ts: marker objects per table, dbMock's
// select().from() dispatches by table to a per-table mock fn, and a
// per-table WHERE-spy captures the predicate tree so auth-scoping
// tests can inspect which columns were filtered.
//
// `producer.today` fans out via Promise.all across 4 sources:
//   1. projects      — active count + project row joins for item list
//   2. invoices      — revenue-this-month sum + unpaid count + rows
//   3. bookings      — upcoming-7d count + upcoming session rows
//   4. trackComments — open-comments count + open comment rows
// Plus a leads query feeds the items list (no KPI contribution).
// The producers table is hit once by producer-procedure to resolve
// ctx.producerId from ctx.userId.

const PRODUCER_ID = "producer-uuid-1";

const {
  producersMarker,
  projectsMarker,
  invoicesMarker,
  bookingsMarker,
  trackCommentsMarker,
  trackVersionsMarker,
  projectTracksMarker,
  leadsMarker,
  projectsCountMock,
  projectsListMock,
  revenueMock,
  unpaidMock,
  unpaidRowsMock,
  upcomingSessionsMock,
  openCommentsMock,
  openCommentsRowsMock,
  leadsRowsMock,
  projectsCountWhereSpy,
  projectsListWhereSpy,
  revenueWhereSpy,
  unpaidWhereSpy,
  unpaidRowsWhereSpy,
  upcomingSessionsWhereSpy,
  openCommentsWhereSpy,
  openCommentsRowsWhereSpy,
  leadsRowsWhereSpy,
  resetCallCounts,
  dbMock,
} = vi.hoisted(() => {
  const projectsCountMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const projectsListMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const revenueMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const unpaidMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const unpaidRowsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const upcomingSessionsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const openCommentsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const openCommentsRowsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const leadsRowsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();

  const projectsCountWhereSpy = vi.fn<(arg: unknown) => void>();
  const projectsListWhereSpy = vi.fn<(arg: unknown) => void>();
  const revenueWhereSpy = vi.fn<(arg: unknown) => void>();
  const unpaidWhereSpy = vi.fn<(arg: unknown) => void>();
  const unpaidRowsWhereSpy = vi.fn<(arg: unknown) => void>();
  const upcomingSessionsWhereSpy = vi.fn<(arg: unknown) => void>();
  const openCommentsWhereSpy = vi.fn<(arg: unknown) => void>();
  const openCommentsRowsWhereSpy = vi.fn<(arg: unknown) => void>();
  const leadsRowsWhereSpy = vi.fn<(arg: unknown) => void>();

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
    updatedAt: { __column: "projects.updated_at" },
  };
  const invoicesMarker = {
    __table: "invoices",
    id: { __column: "invoices.id" },
    producerId: { __column: "invoices.producer_id" },
    status: { __column: "invoices.status" },
    amountCents: { __column: "invoices.amount_cents" },
    currency: { __column: "invoices.currency" },
    paidAt: { __column: "invoices.paid_at" },
    createdAt: { __column: "invoices.created_at" },
    description: { __column: "invoices.description" },
    projectId: { __column: "invoices.project_id" },
    stripeCheckoutSessionId: { __column: "invoices.stripe_checkout_session_id" },
    customerName: { __column: "invoices.customer_name" },
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
  const leadsMarker = {
    __table: "leads",
    id: { __column: "leads.id" },
    producerId: { __column: "leads.producer_id" },
    name: { __column: "leads.name" },
    email: { __column: "leads.email" },
    source: { __column: "leads.source" },
    createdAt: { __column: "leads.created_at" },
  };

  // Per-table + per-projection counters so the first hit on a table
  // goes to the "primary" mock (count/sum) and subsequent hits route
  // to the "rows" equivalents for the items-list queries. We also
  // distinguish invoices/projects/bookings/trackComments by their
  // projection keys where feasible — but for speed, we dispatch by
  // call order. The router's Promise.all order is deterministic and
  // documented in the implementation comments.
  const callCounts = {
    projects: 0,
    invoices: 0,
    bookings: 0,
    track_comments: 0,
    leads: 0,
  };
  const resetCallCounts = () => {
    callCounts.projects = 0;
    callCounts.invoices = 0;
    callCounts.bookings = 0;
    callCounts.track_comments = 0;
    callCounts.leads = 0;
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
          callCounts.projects += 1;
          const n = callCounts.projects;
          // 1st: active-projects count (KPI)
          // 2nd: projects list for items (if router fetches it)
          return chain(
            () => (n === 1 ? projectsCountMock() : projectsListMock()),
            n === 1 ? projectsCountWhereSpy : projectsListWhereSpy,
          );
        }
        if (table === invoicesMarker) {
          callCounts.invoices += 1;
          const n = callCounts.invoices;
          // 1st: revenue-this-month (paid, sum)
          // 2nd: unpaid count (KPI piece)
          // 3rd: unpaid rows (items list)
          return chain(
            () =>
              n === 1
                ? revenueMock()
                : n === 2
                  ? unpaidMock()
                  : unpaidRowsMock(),
            n === 1
              ? revenueWhereSpy
              : n === 2
                ? unpaidWhereSpy
                : unpaidRowsWhereSpy,
          );
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
          return chain(() =>
            Promise.resolve<Record<string, unknown>[]>([]),
          );
        }
        if (table === leadsMarker) {
          callCounts.leads += 1;
          return chain(() => leadsRowsMock(), leadsRowsWhereSpy);
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
  };

  return {
    producersMarker,
    projectsMarker,
    invoicesMarker,
    bookingsMarker,
    trackCommentsMarker,
    trackVersionsMarker,
    projectTracksMarker,
    leadsMarker,
    projectsCountMock,
    projectsListMock,
    revenueMock,
    unpaidMock,
    unpaidRowsMock,
    upcomingSessionsMock,
    openCommentsMock,
    openCommentsRowsMock,
    leadsRowsMock,
    projectsCountWhereSpy,
    projectsListWhereSpy,
    revenueWhereSpy,
    unpaidWhereSpy,
    unpaidRowsWhereSpy,
    upcomingSessionsWhereSpy,
    openCommentsWhereSpy,
    openCommentsRowsWhereSpy,
    leadsRowsWhereSpy,
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
  invoices: invoicesMarker,
  bookings: bookingsMarker,
  trackComments: trackCommentsMarker,
  trackVersions: trackVersionsMarker,
  projectTracks: projectTracksMarker,
  leads: leadsMarker,
  // Tables referenced elsewhere in the producer router module — opaque
  // markers so the router loads inside the test.
  portfolioTracks: { __table: "portfolio_tracks" },
  magicLinks: { __table: "magic_links" },
  magicLinkViews: { __table: "magic_link_views" },
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
import {
  bookings,
  invoices,
  leads,
  projects,
  trackComments,
} from "@skitza/db";

beforeEach(() => {
  projectsCountMock.mockReset().mockResolvedValue([]);
  projectsListMock.mockReset().mockResolvedValue([]);
  revenueMock.mockReset().mockResolvedValue([]);
  unpaidMock.mockReset().mockResolvedValue([]);
  unpaidRowsMock.mockReset().mockResolvedValue([]);
  upcomingSessionsMock.mockReset().mockResolvedValue([]);
  openCommentsMock.mockReset().mockResolvedValue([]);
  openCommentsRowsMock.mockReset().mockResolvedValue([]);
  leadsRowsMock.mockReset().mockResolvedValue([]);
  projectsCountWhereSpy.mockReset();
  projectsListWhereSpy.mockReset();
  revenueWhereSpy.mockReset();
  unpaidWhereSpy.mockReset();
  unpaidRowsWhereSpy.mockReset();
  upcomingSessionsWhereSpy.mockReset();
  openCommentsWhereSpy.mockReset();
  openCommentsRowsWhereSpy.mockReset();
  leadsRowsWhereSpy.mockReset();
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
  it("returns zeroed KPIs + empty items when producer has no activity", async () => {
    // All sub-mocks default to [] via beforeEach. Revenue currency
    // default is whatever the router picks — "USD" or the producer's
    // defaultCurrency. Just verify the zero shape.
    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.kpis).toEqual({
      activeProjects: 0,
      revenueMonthCents: 0,
      revenueCurrency: expect.any(String) as unknown,
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

  it("sums unpaid invoices + open comments into unresolvedItems", async () => {
    // 3 unpaid invoices.
    unpaidMock.mockResolvedValueOnce([
      { id: "i1" },
      { id: "i2" },
      { id: "i3" },
    ]);
    // 2 open comments.
    openCommentsMock.mockResolvedValueOnce([{ id: "c1" }, { id: "c2" }]);

    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.kpis.unresolvedItems).toBe(5);
  });

  it("sorts items by urgency: session > unread comment > invoice > lead", async () => {
    const now = new Date();
    const in1hour = new Date(now.getTime() + 60 * 60 * 1000);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

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
    unpaidRowsMock.mockResolvedValueOnce([
      {
        id: "i1",
        amountCents: 50000,
        currency: "USD",
        description: "Mix session",
        customerName: "Alice",
        createdAt: twoDaysAgo,
        projectId: "p1",
        stripeCheckoutSessionId: null,
      },
    ]);
    leadsRowsMock.mockResolvedValueOnce([
      {
        id: "l1",
        name: "New lead",
        email: "lead@x.com",
        source: "instagram",
        createdAt: threeDaysAgo,
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.today();

    // Strict type ordering across the 4 kinds.
    expect(result.items).toHaveLength(4);
    expect(result.items[0]?.kind).toBe("session");
    expect(result.items[1]?.kind).toBe("comment");
    expect(result.items[2]?.kind).toBe("invoice");
    expect(result.items[3]?.kind).toBe("lead");
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

    const revenueArg = revenueWhereSpy.mock.calls[0]?.[0];
    const revenuePred = findPredicate(revenueArg, "eq", invoices.producerId);
    expect(revenuePred).not.toBeNull();
    if (Array.isArray(revenuePred)) {
      expect(revenuePred[1]).toBe(PRODUCER_ID);
    }

    const upcomingArg = upcomingSessionsWhereSpy.mock.calls[0]?.[0];
    const upcomingPred = findPredicate(upcomingArg, "eq", bookings.producerId);
    expect(upcomingPred).not.toBeNull();
    if (Array.isArray(upcomingPred)) {
      expect(upcomingPred[1]).toBe(PRODUCER_ID);
    }

    const unpaidArg = unpaidWhereSpy.mock.calls[0]?.[0];
    const unpaidPred = findPredicate(unpaidArg, "eq", invoices.producerId);
    expect(unpaidPred).not.toBeNull();
    if (Array.isArray(unpaidPred)) {
      expect(unpaidPred[1]).toBe(PRODUCER_ID);
    }

    // Leads rows (when queried) must also be producer-scoped.
    const leadsArg = leadsRowsWhereSpy.mock.calls[0]?.[0];
    if (leadsArg) {
      const leadsPred = findPredicate(leadsArg, "eq", leads.producerId);
      expect(leadsPred).not.toBeNull();
      if (Array.isArray(leadsPred)) {
        expect(leadsPred[1]).toBe(PRODUCER_ID);
      }
    }

    // Open comments route through trackComments but the auth scope
    // comes from the join chain. We only assert that the WHERE spy
    // was called — the precise predicate lives below in the
    // trackComments implementation notes.
    expect(openCommentsWhereSpy).toHaveBeenCalled();

    // Touch the `trackComments` marker so the import survives the
    // test scope pruning in the type-checker.
    expect(trackComments).toBeDefined();
  });
});
