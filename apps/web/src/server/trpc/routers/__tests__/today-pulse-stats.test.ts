import { beforeEach, describe, expect, it, vi } from "vitest";

// SK-90 removes the invoice table and makes corrected purchase-ledger totals
// a later Payments projection. `producer.today` must therefore return a
// fail-closed commercial shape (zero totals, null delta, zero sparkline) while
// continuing to expose producer-scoped project/session/comment counts.

const PRODUCER_ID = "producer-uuid-1";

const {
  producersMarker,
  projectsMarker,
  purchasesMarker,
  bookingsMarker,
  trackCommentsMarker,
  trackVersionsMarker,
  projectTracksMarker,
  activeProjectsMock,
  upcomingSessionsMock,
  openCommentsCountMock,
  profileMock,
  activeProjectsWhereSpy,
  upcomingSessionsWhereSpy,
  openCommentsWhereSpy,
  resetCallCounts,
  dbMock,
} = vi.hoisted(() => {
  const activeProjectsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const upcomingSessionsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const openCommentsCountMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const profileMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const activeProjectsWhereSpy = vi.fn<(arg: unknown) => void>();
  const upcomingSessionsWhereSpy = vi.fn<(arg: unknown) => void>();
  const openCommentsWhereSpy = vi.fn<(arg: unknown) => void>();

  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    clerkUserId: { __column: "producers.clerk_user_id" },
    defaultCurrency: { __column: "producers.default_currency" },
  };
  const projectsMarker = {
    __table: "projects",
    id: { __column: "projects.id" },
    producerId: { __column: "projects.producer_id" },
    lifecycleStatus: { __column: "projects.lifecycle_status" },
    clientName: { __column: "projects.client_name" },
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
    label: { __column: "track_versions.label" },
    audioUrl: { __column: "track_versions.audio_url" },
    uploadedAt: { __column: "track_versions.uploaded_at" },
    durationMs: { __column: "track_versions.duration_ms" },
  };
  const projectTracksMarker = {
    __table: "project_tracks",
    id: { __column: "project_tracks.id" },
    projectId: { __column: "project_tracks.project_id" },
    title: { __column: "project_tracks.title" },
  };

  const callCounts = { producers: 0, trackComments: 0 };
  const resetCallCounts = () => {
    callCounts.producers = 0;
    callCounts.trackComments = 0;
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
        const promise = get();
        return promise.then.bind(promise);
      },
    };
    return link;
  };

  const empty = () => Promise.resolve<Record<string, unknown>[]>([]);

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === producersMarker) {
          callCounts.producers += 1;
          if (callCounts.producers === 1) {
            return {
              where: () => ({
                limit: () => Promise.resolve([{ id: PRODUCER_ID }]),
              }),
            };
          }
          return chain(profileMock);
        }
        if (table === projectsMarker) {
          return chain(activeProjectsMock, activeProjectsWhereSpy);
        }
        if (table === bookingsMarker) {
          return chain(upcomingSessionsMock, upcomingSessionsWhereSpy);
        }
        if (table === trackCommentsMarker) {
          callCounts.trackComments += 1;
          return callCounts.trackComments === 1
            ? chain(openCommentsCountMock, openCommentsWhereSpy)
            : chain(empty);
        }
        if (table === trackVersionsMarker) return chain(empty);
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
    activeProjectsMock,
    upcomingSessionsMock,
    openCommentsCountMock,
    profileMock,
    activeProjectsWhereSpy,
    upcomingSessionsWhereSpy,
    openCommentsWhereSpy,
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
  portfolioTracks: { __table: "portfolio_tracks" },
  clientContacts: { __table: "client_contacts" },
  notifications: { __table: "notifications" },
  availabilityBlackouts: { __table: "availability_blackouts" },
  availabilityBlocks: { __table: "availability_blocks" },
  products: { __table: "products" },
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  or: (...conditions: unknown[]) => ({ or: conditions }),
  not: (condition: unknown) => ({ not: condition }),
  ne: (column: unknown, value: unknown) => ({ ne: [column, value] }),
  desc: (column: unknown) => ({ desc: column }),
  asc: (column: unknown) => ({ asc: column }),
  gte: (column: unknown, value: unknown) => ({ gte: [column, value] }),
  lte: (column: unknown, value: unknown) => ({ lte: [column, value] }),
  inArray: (column: unknown, values: unknown[]) => ({ inArray: [column, values] }),
  notInArray: (column: unknown, values: unknown[]) => ({ notInArray: [column, values] }),
  isNull: (column: unknown) => ({ isNull: column }),
  isNotNull: (column: unknown) => ({ isNotNull: column }),
  ilike: (column: unknown, value: unknown) => ({ ilike: [column, value] }),
  sql: () => ({ sql: true }),
}));

import { bookings, projects, trackComments } from "@skitza/db";

beforeEach(() => {
  activeProjectsMock.mockReset().mockResolvedValue([]);
  upcomingSessionsMock.mockReset().mockResolvedValue([]);
  openCommentsCountMock.mockReset().mockResolvedValue([]);
  profileMock.mockReset().mockResolvedValue([{ defaultCurrency: "USD" }]);
  activeProjectsWhereSpy.mockReset();
  upcomingSessionsWhereSpy.mockReset();
  openCommentsWhereSpy.mockReset();
  resetCallCounts();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_producer_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

function findPredicate(
  where: unknown,
  operator: "eq" | "inArray" | "gte" | "lte" | "isNull" | "isNotNull",
  columnMarker: unknown,
): unknown {
  if (!where || typeof where !== "object") return null;
  if ("and" in where && Array.isArray((where as { and: unknown[] }).and)) {
    for (const predicate of (where as { and: unknown[] }).and) {
      const found = findPredicate(predicate, operator, columnMarker);
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

describe("producer.today fail-closed pulseStats", () => {
  it("returns unavailable commercial values as null instead of fake zeroes", async () => {
    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.pulseStats).toEqual({
      commercialAvailable: false,
      thisMonthCents: null,
      lastMonthCents: null,
      outstandingCents: null,
      currency: null,
      deltaPct: null,
      sparkline: Array.from({ length: 30 }, () => 0),
      activeProjects: 0,
      upcomingSessions7d: 0,
      unresolvedItems: 0,
    });
  });

  it("does not infer commercial totals from noncommercial activity", async () => {
    activeProjectsMock.mockResolvedValueOnce([{ id: "p1" }, { id: "p2" }, { id: "p3" }]);
    upcomingSessionsMock.mockResolvedValueOnce([
      {
        id: "b1",
        startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        durationMin: 120,
        artistName: "Alice",
        projectId: "p1",
      },
      {
        id: "b2",
        startsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        durationMin: 60,
        artistName: "Bob",
        projectId: "p2",
      },
    ]);
    openCommentsCountMock.mockResolvedValueOnce([{ id: "c1" }, { id: "c2" }]);

    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.pulseStats.thisMonthCents).toBeNull();
    expect(result.pulseStats.lastMonthCents).toBeNull();
    expect(result.pulseStats.outstandingCents).toBeNull();
    expect(result.pulseStats.deltaPct).toBeNull();
    expect(result.pulseStats.sparkline.every((value) => value === 0)).toBe(true);
    expect(result.pulseStats.activeProjects).toBe(result.kpis.activeProjects);
    expect(result.pulseStats.upcomingSessions7d).toBe(result.kpis.upcomingSessions7d);
    expect(result.pulseStats.unresolvedItems).toBe(result.kpis.unresolvedItems);
    expect(result.pulseStats).toMatchObject({
      activeProjects: 3,
      upcomingSessions7d: 2,
      unresolvedItems: 2,
    });
  });

  it("does not present even the producer currency as an available money projection", async () => {
    profileMock.mockResolvedValueOnce([{ defaultCurrency: "EUR" }]);

    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.pulseStats.commercialAvailable).toBe(false);
    expect(result.pulseStats.currency).toBeNull();
    expect(result.pulseStats.thisMonthCents).toBeNull();
    expect(result.pulseStats.lastMonthCents).toBeNull();
    expect(result.pulseStats.outstandingCents).toBeNull();
  });
});

describe("producer.today pulseStats authorization and lifecycle boundary", () => {
  it("scopes active projects to the producer and approved live lifecycles", async () => {
    const caller = await buildCaller();
    await caller.producer.today();

    const whereArg = activeProjectsWhereSpy.mock.calls[0]?.[0];
    const producerPredicate = findPredicate(whereArg, "eq", projects.producerId);
    const lifecyclePredicate = findPredicate(whereArg, "inArray", projects.lifecycleStatus);

    expect(producerPredicate).toEqual([projects.producerId, PRODUCER_ID]);
    expect(lifecyclePredicate).toEqual([
      projects.lifecycleStatus,
      ["waiting_for_payment", "active", "paused"],
    ]);
  });

  it("keeps upcoming sessions producer-scoped", async () => {
    const caller = await buildCaller();
    await caller.producer.today();

    const whereArg = upcomingSessionsWhereSpy.mock.calls[0]?.[0];
    expect(findPredicate(whereArg, "eq", bookings.producerId)).toEqual([
      bookings.producerId,
      PRODUCER_ID,
    ]);
  });

  it("keeps open artist comments producer-scoped through projects", async () => {
    const caller = await buildCaller();
    await caller.producer.today();

    const whereArg = openCommentsWhereSpy.mock.calls[0]?.[0];
    expect(findPredicate(whereArg, "eq", projects.producerId)).toEqual([
      projects.producerId,
      PRODUCER_ID,
    ]);
    expect(findPredicate(whereArg, "eq", trackComments.fromProducer)).toEqual([
      trackComments.fromProducer,
      false,
    ]);
    expect(findPredicate(whereArg, "isNull", trackComments.resolvedAt)).not.toBeNull();
  });
});
