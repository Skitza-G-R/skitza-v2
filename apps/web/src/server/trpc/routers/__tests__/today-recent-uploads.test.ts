import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// Mirrors producer-today.test.ts's shape but extends it for two new
// fan-out legs landing on producer.today as part of the redesign:
//
//   leg 10 — recentUploads
//     joins track_versions ⨝ project_tracks ⨝ projects
//     WHERE projects.producer_id = ctx.producerId
//       AND projects.stage IN active stages
//       AND track_versions.audio_url IS NOT NULL
//     ORDER BY track_versions.uploaded_at DESC LIMIT 7.
//   plus N follow-up unread-comment counts (one SELECT FROM trackComments
//   per recent-upload row).
//
// trackVersions is now a *first-class* table marker (was opaque in the
// original producer-today test) so we can dispatch to the new mock and
// also assert auth-scoping predicates on its WHERE clause.
//
// callCounts["track_comments"] is reused: the existing producer.today
// already SELECTs from trackComments twice (open-comments count + open-
// comments rows). Per-row unread-comments queries land as the 3rd, 4th,
// ... hits and all share a single follow-up mock by default — tests
// that need granular control reset the mock between hits via
// `unreadCommentsMock.mockResolvedValueOnce(...)`.

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
  recentUploadsMock,
  recentUploadsWhereSpy,
  unreadCommentsMock,
  unreadCommentsWhereSpy,
  resetCallCounts,
  dbMock,
} = vi.hoisted(() => {
  const recentUploadsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const recentUploadsWhereSpy = vi.fn<(arg: unknown) => void>();
  // Single follow-up mock — most tests pass an array via
  // mockResolvedValueOnce per row to drive specific counts. Default is
  // empty so seeded `recentUploadsMock` rows resolve with zero unread.
  const unreadCommentsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const unreadCommentsWhereSpy = vi.fn<(arg: unknown) => void>();

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

  // Chain handler — terminal-as-promise so the router can await at any
  // hop. Same shape as producer-today.test.ts.
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

  // Default-noop terminals for every existing leg of producer.today —
  // the `today` proc fans out across 9+ legs and we only care about the
  // recentUploads + unreadComments behaviors here. Empty arrays work
  // because the existing legs already gracefully handle empty results.
  const empty = () => Promise.resolve<Record<string, unknown>[]>([]);

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === producersMarker) {
          callCounts.producers += 1;
          const n = callCounts.producers;
          // 1st producers SELECT: producer-procedure middleware (resolves
          // ctx.producerId). 2nd+: existing leg 9 (defaultCurrency).
          if (n === 1) {
            return {
              where: () => ({
                limit: () => Promise.resolve([{ id: PRODUCER_ID }]),
              }),
            };
          }
          return chain(() => Promise.resolve([{ defaultCurrency: "USD" }]));
        }
        if (table === projectsMarker) {
          callCounts.projects += 1;
          return chain(empty);
        }
        if (table === invoicesMarker) {
          callCounts.invoices += 1;
          return chain(empty);
        }
        if (table === bookingsMarker) {
          callCounts.bookings += 1;
          return chain(empty);
        }
        if (table === trackCommentsMarker) {
          callCounts.track_comments += 1;
          const n = callCounts.track_comments;
          // 1st: open-comments count (KPI piece, existing leg 5)
          // 2nd: open-comments rows (items list, existing leg 7)
          // 3rd+: per-row unread-comments follow-up SELECTs (NEW)
          if (n <= 2) return chain(empty);
          return chain(unreadCommentsMock, unreadCommentsWhereSpy);
        }
        if (table === trackVersionsMarker) {
          callCounts.track_versions += 1;
          // 1st (and only) hit on track_versions in producer.today is
          // the new recentUploads leg.
          return chain(recentUploadsMock, recentUploadsWhereSpy);
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
    recentUploadsMock,
    recentUploadsWhereSpy,
    unreadCommentsMock,
    unreadCommentsWhereSpy,
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
  // Tables referenced elsewhere in the producer router module.
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

import {
  projects,
  trackComments,
  trackVersions,
} from "@skitza/db";

beforeEach(() => {
  recentUploadsMock.mockReset().mockResolvedValue([]);
  recentUploadsWhereSpy.mockReset();
  unreadCommentsMock.mockReset().mockResolvedValue([]);
  unreadCommentsWhereSpy.mockReset();
  resetCallCounts();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_producer_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

// findPredicate — walks an arbitrarily nested and(...) tree to find
// an (operator, column) pair. Mirrors producer-today.test.ts.
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

describe("producer.today recentUploads", () => {
  it("returns an empty array when the producer has no track versions", async () => {
    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.recentUploads).toEqual([]);
  });

  it("projects DB rows into the RecentUpload shape", async () => {
    const uploadedAt = new Date("2026-04-22T12:00:00Z");
    recentUploadsMock.mockResolvedValueOnce([
      {
        versionId: "v1",
        trackId: "t1",
        title: "Sunset Mix",
        versionLabel: "v3",
        uploadedAt,
        audioUrl: "https://r2/sunset-v3.mp3",
        durationMs: 180_000,
        projectId: "p1",
        projectClientName: "Bob's EP",
        projectStage: "in_production",
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.recentUploads).toHaveLength(1);
    expect(result.recentUploads[0]).toEqual({
      versionId: "v1",
      trackId: "t1",
      title: "Sunset Mix",
      versionLabel: "v3",
      uploadedAt,
      audioUrl: "https://r2/sunset-v3.mp3",
      durationMs: 180_000,
      projectId: "p1",
      projectClientName: "Bob's EP",
      projectStage: "in_production",
      unreadComments: 0,
    });
  });

  it("caps the response at 7 rows even when more arrive from the DB", async () => {
    // Simulate the .limit(7) slip — even if the SQL ever returns more,
    // the response shape MUST stay capped. We seed 12 rows here to be
    // adversarial; the assertion below catches a regression that drops
    // a server-side .slice or relaxes the SQL limit.
    recentUploadsMock.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => ({
        versionId: `v${String(i)}`,
        trackId: `t${String(i)}`,
        title: `Track ${String(i)}`,
        versionLabel: "v1",
        uploadedAt: new Date(Date.now() - i * 60_000),
        audioUrl: `https://r2/track-${String(i)}.mp3`,
        durationMs: 200_000,
        projectId: "p1",
        projectClientName: "Client",
        projectStage: "in_production",
      })),
    );

    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.recentUploads.length).toBeLessThanOrEqual(7);
  });

  it("sets unreadComments per row from the follow-up sub-queries", async () => {
    // Two recent uploads. First has 3 unread artist comments since
    // its uploadedAt; second has 0. Each unread-comment SELECT is a
    // separate trackComments hit (the 3rd + 4th overall in this test).
    recentUploadsMock.mockResolvedValueOnce([
      {
        versionId: "v1",
        trackId: "t1",
        title: "A",
        versionLabel: "v1",
        uploadedAt: new Date("2026-04-22T10:00:00Z"),
        audioUrl: "https://r2/a.mp3",
        durationMs: 180_000,
        projectId: "p1",
        projectClientName: "Client",
        projectStage: "in_production",
      },
      {
        versionId: "v2",
        trackId: "t2",
        title: "B",
        versionLabel: "v1",
        uploadedAt: new Date("2026-04-21T10:00:00Z"),
        audioUrl: "https://r2/b.mp3",
        durationMs: 180_000,
        projectId: "p1",
        projectClientName: "Client",
        projectStage: "in_production",
      },
    ]);
    // Per-row follow-ups, in row order: 3 unread → 0 unread.
    unreadCommentsMock
      .mockResolvedValueOnce([{ id: "c1" }, { id: "c2" }, { id: "c3" }])
      .mockResolvedValueOnce([]);

    const caller = await buildCaller();
    const result = await caller.producer.today();

    expect(result.recentUploads).toHaveLength(2);
    expect(result.recentUploads[0]?.unreadComments).toBe(3);
    expect(result.recentUploads[1]?.unreadComments).toBe(0);
  });
});

describe("producer.today recentUploads auth boundary", () => {
  it("scopes the recentUploads query by ctx.producerId on projects", async () => {
    const caller = await buildCaller();
    await caller.producer.today();

    // The recent-uploads SELECT joins through projectTracks → projects;
    // the producer-scope predicate sits on projects.producer_id.
    const whereArg = recentUploadsWhereSpy.mock.calls[0]?.[0];
    const producerPred = findPredicate(whereArg, "eq", projects.producerId);
    expect(producerPred).not.toBeNull();
    if (Array.isArray(producerPred)) {
      expect(producerPred[1]).toBe(PRODUCER_ID);
    }
  });

  it("filters out archived/cancelled projects via inArray(projects.stage)", async () => {
    const caller = await buildCaller();
    await caller.producer.today();

    const whereArg = recentUploadsWhereSpy.mock.calls[0]?.[0];
    const stagePred = findPredicate(whereArg, "inArray", projects.stage);
    expect(stagePred).not.toBeNull();
    if (Array.isArray(stagePred)) {
      const allowed = stagePred[1] as string[];
      // Active stages only — terminal/paused stages must NOT be in the
      // inArray list.
      expect(allowed).not.toContain("archived");
      expect(allowed).not.toContain("cancelled");
      expect(allowed).not.toContain("paid");
      expect(allowed).not.toContain("payment_paused");
      // And the active set IS present.
      expect(allowed).toContain("in_production");
      expect(allowed).toContain("final_review");
    }
  });

  it("filters out in-flight uploads via isNotNull(track_versions.audio_url)", async () => {
    const caller = await buildCaller();
    await caller.producer.today();

    const whereArg = recentUploadsWhereSpy.mock.calls[0]?.[0];
    const audioUrlPred = findPredicate(
      whereArg,
      "isNotNull",
      trackVersions.audioUrl,
    );
    expect(audioUrlPred).not.toBeNull();
  });

  it("scopes each unread-comments follow-up by versionId + fromProducer=false + resolvedAt IS NULL + createdAt >= uploadedAt", async () => {
    const uploadedAt = new Date("2026-04-22T12:00:00Z");
    recentUploadsMock.mockResolvedValueOnce([
      {
        versionId: "v-the-target",
        trackId: "t1",
        title: "A",
        versionLabel: "v1",
        uploadedAt,
        audioUrl: "https://r2/a.mp3",
        durationMs: 180_000,
        projectId: "p1",
        projectClientName: "Client",
        projectStage: "in_production",
      },
    ]);

    const caller = await buildCaller();
    await caller.producer.today();

    const whereArg = unreadCommentsWhereSpy.mock.calls[0]?.[0];
    expect(whereArg).not.toBeUndefined();

    // versionId predicate — pins the count to this specific row.
    const versionPred = findPredicate(
      whereArg,
      "eq",
      trackComments.versionId,
    );
    expect(versionPred).not.toBeNull();
    if (Array.isArray(versionPred)) {
      expect(versionPred[1]).toBe("v-the-target");
    }

    // fromProducer=false — only count artist-side comments.
    const fromProducerPred = findPredicate(
      whereArg,
      "eq",
      trackComments.fromProducer,
    );
    expect(fromProducerPred).not.toBeNull();
    if (Array.isArray(fromProducerPred)) {
      expect(fromProducerPred[1]).toBe(false);
    }

    // resolvedAt IS NULL — only unresolved.
    const resolvedAtPred = findPredicate(
      whereArg,
      "isNull",
      trackComments.resolvedAt,
    );
    expect(resolvedAtPred).not.toBeNull();

    // createdAt >= uploadedAt — only comments posted after the version
    // landed (excludes carried-over comments from earlier versions).
    const createdAtPred = findPredicate(
      whereArg,
      "gte",
      trackComments.createdAt,
    );
    expect(createdAtPred).not.toBeNull();
    if (Array.isArray(createdAtPred)) {
      expect(createdAtPred[1]).toEqual(uploadedAt);
    }
  });
});
