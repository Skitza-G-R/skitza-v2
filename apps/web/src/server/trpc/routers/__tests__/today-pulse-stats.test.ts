import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// Tests producer.today's pulseStats fan-out leg, the second of the two
// new legs landing as part of the Today redesign:
//
//   leg 11 — pulseStats
//     A. lastMonthRevenue   — paid invoices with paidAt in [lastMonthStart, monthStart)
//     B. sparkline          — daily-bucket revenue rows over the last 30 days
//   plus reuse of the existing leg-2 thisMonthRevenue rows for the
//   "this-month" big number, and the producer's defaultCurrency from
//   the existing leg-9 profile lookup.
//
// pulseStats's footer counts (activeProjects, upcomingSessions7d,
// unresolvedItems) are re-projections of the existing kpis fields —
// no new round-trips. Tests below assert this re-projection.
//
// Invoice queries dispatched by call-order: the existing producer.today
// hits `invoices` 3 times (revenue, unpaidCount, unpaidRows). The new
// pulse leg adds 2 more hits (lastMonthRevenue, sparkline) for a total
// of 5 — the dispatch table below routes call 4 → lastMonthMock and
// call 5 → sparklineMock.

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
  thisMonthMock,
  unpaidCountMock,
  unpaidRowsMock,
  lastMonthMock,
  sparklineMock,
  lastMonthWhereSpy,
  sparklineWhereSpy,
  activeProjectsMock,
  upcomingSessionsMock,
  openCommentsCountMock,
  resetCallCounts,
  dbMock,
} = vi.hoisted(() => {
  const thisMonthMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const unpaidCountMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const unpaidRowsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const lastMonthMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const sparklineMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const lastMonthWhereSpy = vi.fn<(arg: unknown) => void>();
  const sparklineWhereSpy = vi.fn<(arg: unknown) => void>();
  const activeProjectsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const upcomingSessionsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const openCommentsCountMock = vi.fn<() => Promise<Record<string, unknown>[]>>();

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
  const leadsMarker = {
    __table: "leads",
    id: { __column: "leads.id" },
    producerId: { __column: "leads.producer_id" },
    name: { __column: "leads.name" },
    email: { __column: "leads.email" },
    source: { __column: "leads.source" },
    createdAt: { __column: "leads.created_at" },
  };

  const callCounts = {
    projects: 0,
    invoices: 0,
    bookings: 0,
    track_comments: 0,
    track_versions: 0,
    leads: 0,
    producers: 0,
  };
  const resetCallCounts = () => {
    callCounts.projects = 0;
    callCounts.invoices = 0;
    callCounts.bookings = 0;
    callCounts.track_comments = 0;
    callCounts.track_versions = 0;
    callCounts.leads = 0;
    callCounts.producers = 0;
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

  const empty = () => Promise.resolve<Record<string, unknown>[]>([]);

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === producersMarker) {
          callCounts.producers += 1;
          const n = callCounts.producers;
          if (n === 1) {
            return {
              where: () => ({
                limit: () => Promise.resolve([{ id: PRODUCER_ID }]),
              }),
            };
          }
          // 2nd hit on producers: defaultCurrency lookup (existing leg 9).
          return chain(() => Promise.resolve([{ defaultCurrency: "USD" }]));
        }
        if (table === projectsMarker) {
          callCounts.projects += 1;
          // 1st hit: active-projects KPI.
          return chain(activeProjectsMock);
        }
        if (table === invoicesMarker) {
          callCounts.invoices += 1;
          const n = callCounts.invoices;
          // 1st: this-month revenue (existing leg 2)
          // 2nd: unpaid count (KPI piece, existing leg 3)
          // 3rd: unpaid rows (items list, existing leg 6)
          // 4th: NEW — lastMonthRevenue
          // 5th: NEW — sparkline (30-day buckets)
          if (n === 1) return chain(thisMonthMock);
          if (n === 2) return chain(unpaidCountMock);
          if (n === 3) return chain(unpaidRowsMock);
          if (n === 4) return chain(lastMonthMock, lastMonthWhereSpy);
          return chain(sparklineMock, sparklineWhereSpy);
        }
        if (table === bookingsMarker) {
          callCounts.bookings += 1;
          return chain(upcomingSessionsMock);
        }
        if (table === trackCommentsMarker) {
          callCounts.track_comments += 1;
          const n = callCounts.track_comments;
          if (n === 1) return chain(openCommentsCountMock);
          // 2nd: open-comments rows (items list).
          // 3rd+: per-row unread-comments follow-ups (recentUploads leg).
          return chain(empty);
        }
        if (table === trackVersionsMarker) {
          callCounts.track_versions += 1;
          // recentUploads leg (no rows seeded — pulse tests don't care).
          return chain(empty);
        }
        if (table === leadsMarker) {
          callCounts.leads += 1;
          return chain(empty);
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
    thisMonthMock,
    unpaidCountMock,
    unpaidRowsMock,
    lastMonthMock,
    sparklineMock,
    lastMonthWhereSpy,
    sparklineWhereSpy,
    activeProjectsMock,
    upcomingSessionsMock,
    openCommentsCountMock,
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

import { invoices } from "@skitza/db";

beforeEach(() => {
  thisMonthMock.mockReset().mockResolvedValue([]);
  unpaidCountMock.mockReset().mockResolvedValue([]);
  unpaidRowsMock.mockReset().mockResolvedValue([]);
  lastMonthMock.mockReset().mockResolvedValue([]);
  sparklineMock.mockReset().mockResolvedValue([]);
  lastMonthWhereSpy.mockReset();
  sparklineWhereSpy.mockReset();
  activeProjectsMock.mockReset().mockResolvedValue([]);
  upcomingSessionsMock.mockReset().mockResolvedValue([]);
  openCommentsCountMock.mockReset().mockResolvedValue([]);
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

describe("producer.today pulseStats", () => {
  it("returns a fully zero-filled PulseStats when the producer has no data", async () => {
    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.pulseStats).toBeDefined();
    expect(result.pulseStats.thisMonthCents).toBe(0);
    expect(result.pulseStats.lastMonthCents).toBe(0);
    expect(result.pulseStats.deltaPct).toBeNull();
    expect(result.pulseStats.sparkline).toHaveLength(30);
    expect(result.pulseStats.sparkline.every((v) => v === 0)).toBe(true);
    expect(result.pulseStats.activeProjects).toBe(0);
    expect(result.pulseStats.upcomingSessions7d).toBe(0);
    expect(result.pulseStats.unresolvedItems).toBe(0);
    expect(typeof result.pulseStats.currency).toBe("string");
  });

  it("computes deltaPct = round((this - last) / last * 100) when lastMonth > 0", async () => {
    // This month: $5,000 (one paid invoice, USD).
    thisMonthMock.mockResolvedValueOnce([
      { amountCents: 500_000, currency: "USD" },
    ]);
    // Last month: $4,000 — delta = (5000-4000)/4000*100 = 25%.
    lastMonthMock.mockResolvedValueOnce([
      { amountCents: 400_000, currency: "USD" },
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.pulseStats.thisMonthCents).toBe(500_000);
    expect(result.pulseStats.lastMonthCents).toBe(400_000);
    expect(result.pulseStats.deltaPct).toBe(25);
  });

  it("returns deltaPct === null when lastMonthCents is 0 (avoid +∞%)", async () => {
    thisMonthMock.mockResolvedValueOnce([
      { amountCents: 100_000, currency: "USD" },
    ]);
    // Last month: empty rows (no paid invoices).
    lastMonthMock.mockResolvedValueOnce([]);

    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.pulseStats.lastMonthCents).toBe(0);
    expect(result.pulseStats.deltaPct).toBeNull();
  });

  it("rounds a negative delta correctly when revenue dropped", async () => {
    thisMonthMock.mockResolvedValueOnce([
      { amountCents: 200_000, currency: "USD" },
    ]);
    lastMonthMock.mockResolvedValueOnce([
      { amountCents: 400_000, currency: "USD" },
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.today();

    // (200000-400000)/400000*100 = -50.
    expect(result.pulseStats.deltaPct).toBe(-50);
  });

  it("zero-fills missing days in the 30-day sparkline (length always 30)", async () => {
    // Seed 3 sparse daily buckets — rest must be zero-filled, length 30.
    const today = new Date();
    const dayAtNoon = (offset: number) => {
      const d = new Date(today);
      d.setUTCHours(12, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - offset);
      return d;
    };
    sparklineMock.mockResolvedValueOnce([
      // 25 days ago → small revenue
      { day: dayAtNoon(25).toISOString().slice(0, 10), cents: 10_000 },
      // 10 days ago → larger revenue
      { day: dayAtNoon(10).toISOString().slice(0, 10), cents: 50_000 },
      // 0 days ago (today) → revenue
      { day: dayAtNoon(0).toISOString().slice(0, 10), cents: 25_000 },
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.pulseStats.sparkline).toHaveLength(30);
    // Index 29 = today; index 0 = 30 days ago. So today's revenue lands
    // at index 29.
    expect(result.pulseStats.sparkline[29]).toBe(25_000);
    // 10 days ago = index 19 (29 - 10).
    expect(result.pulseStats.sparkline[19]).toBe(50_000);
    // Days with no buckets are zero-filled.
    const nonZeros = result.pulseStats.sparkline.filter((v) => v > 0);
    expect(nonZeros).toHaveLength(3);
  });

  it("re-projects footer counts (activeProjects, upcomingSessions7d, unresolvedItems) from existing kpis", async () => {
    activeProjectsMock.mockResolvedValueOnce([
      { id: "p1" },
      { id: "p2" },
      { id: "p3" },
    ]);
    upcomingSessionsMock.mockResolvedValueOnce([
      {
        id: "b1",
        startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        durationMin: 120,
        artistName: "Alice",
        packageNameSnapshot: "2h Mix",
      },
      {
        id: "b2",
        startsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        durationMin: 60,
        artistName: "Bob",
        packageNameSnapshot: "1h Jam",
      },
    ]);
    unpaidCountMock.mockResolvedValueOnce([{ id: "i1" }]);
    openCommentsCountMock.mockResolvedValueOnce([
      { id: "c1" },
      { id: "c2" },
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.today();

    // Footer counts MUST match the existing kpis exactly — same source
    // rows, no second round-trip.
    expect(result.pulseStats.activeProjects).toBe(result.kpis.activeProjects);
    expect(result.pulseStats.upcomingSessions7d).toBe(
      result.kpis.upcomingSessions7d,
    );
    expect(result.pulseStats.unresolvedItems).toBe(
      result.kpis.unresolvedItems,
    );
    // And concrete values for sanity.
    expect(result.pulseStats.activeProjects).toBe(3);
    expect(result.pulseStats.upcomingSessions7d).toBe(2);
    expect(result.pulseStats.unresolvedItems).toBe(3); // 1 unpaid + 2 comments
  });

  it("filters out non-default-currency rows from thisMonthCents and lastMonthCents", async () => {
    // Mix USD + EUR. The producer's defaultCurrency is USD (seeded by
    // the test mock), so EUR rows are dropped.
    thisMonthMock.mockResolvedValueOnce([
      { amountCents: 100_000, currency: "USD" },
      { amountCents: 999_999, currency: "EUR" }, // dropped
    ]);
    lastMonthMock.mockResolvedValueOnce([
      { amountCents: 200_000, currency: "USD" },
      { amountCents: 999_999, currency: "EUR" }, // dropped
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.pulseStats.thisMonthCents).toBe(100_000);
    expect(result.pulseStats.lastMonthCents).toBe(200_000);
    expect(result.pulseStats.currency).toBe("USD");
  });
});

describe("producer.today pulseStats auth boundary", () => {
  it("scopes the lastMonthRevenue query by producerId + status=paid", async () => {
    const caller = await buildCaller();
    await caller.producer.today();

    const whereArg = lastMonthWhereSpy.mock.calls[0]?.[0];
    expect(whereArg).not.toBeUndefined();

    const producerPred = findPredicate(whereArg, "eq", invoices.producerId);
    expect(producerPred).not.toBeNull();
    if (Array.isArray(producerPred)) {
      expect(producerPred[1]).toBe(PRODUCER_ID);
    }

    const statusPred = findPredicate(whereArg, "eq", invoices.status);
    expect(statusPred).not.toBeNull();
    if (Array.isArray(statusPred)) {
      expect(statusPred[1]).toBe("paid");
    }
  });

  it("scopes the sparkline query by producerId + status=paid", async () => {
    const caller = await buildCaller();
    await caller.producer.today();

    const whereArg = sparklineWhereSpy.mock.calls[0]?.[0];
    expect(whereArg).not.toBeUndefined();

    const producerPred = findPredicate(whereArg, "eq", invoices.producerId);
    expect(producerPred).not.toBeNull();
    if (Array.isArray(producerPred)) {
      expect(producerPred[1]).toBe(PRODUCER_ID);
    }

    const statusPred = findPredicate(whereArg, "eq", invoices.status);
    expect(statusPred).not.toBeNull();
    if (Array.isArray(statusPred)) {
      expect(statusPred[1]).toBe("paid");
    }
  });
});
