import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// Mirrors producer-today.test.ts's shape: marker objects per table,
// a dbMock that dispatches by table to a per-table mock fn, and a
// WHERE-spy that captures the predicate tree so the auth-scoping
// test can walk it via findPredicate.
//
// producer.music.list is a single-leg query — joins track_versions →
// project_tracks → projects → producers, filters by
// projects.producerId = ctx.producerId, orders by
// track_versions.uploadedAt desc, limit 100. The producers table is
// also hit once by producerProcedure to resolve ctx.producerId from
// ctx.userId.

const PRODUCER_ID = "producer-uuid-1";

const {
  producersMarker,
  projectsMarker,
  trackVersionsMarker,
  projectTracksMarker,
  trackCommentsMarker,
  musicListMock,
  musicListWhereSpy,
  trackVersionsQueue,
  trackVersionsWhereSpies,
  trackCommentsQueue,
  trackCommentsWhereSpies,
  dbMock,
} = vi.hoisted(() => {
  const musicListMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const musicListWhereSpy = vi.fn<(arg: unknown) => void>();
  // Queues used by the detail test — each .from(trackVersions) call
  // shifts one mock off the front. Simpler than threading per-test
  // mocks through; the test sets them up via beforeEach.
  const trackVersionsQueue: (() => Promise<Record<string, unknown>[]>)[] = [];
  const trackVersionsWhereSpies: ((arg: unknown) => void)[] = [];
  const trackCommentsQueue: (() => Promise<Record<string, unknown>[]>)[] = [];
  const trackCommentsWhereSpies: ((arg: unknown) => void)[] = [];

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
    clientName: { __column: "projects.client_name" },
  };
  const trackVersionsMarker = {
    __table: "track_versions",
    id: { __column: "track_versions.id" },
    trackId: { __column: "track_versions.track_id" },
    label: { __column: "track_versions.label" },
    audioUrl: { __column: "track_versions.audio_url" },
    uploadedAt: { __column: "track_versions.uploaded_at" },
    durationMs: { __column: "track_versions.duration_ms" },
    approvedAt: { __column: "track_versions.approved_at" },
  };
  const projectTracksMarker = {
    __table: "project_tracks",
    id: { __column: "project_tracks.id" },
    projectId: { __column: "project_tracks.project_id" },
    title: { __column: "project_tracks.title" },
    artist: { __column: "project_tracks.artist" },
  };
  const trackCommentsMarker = {
    __table: "track_comments",
    id: { __column: "track_comments.id" },
    versionId: { __column: "track_comments.version_id" },
    timestampMs: { __column: "track_comments.timestamp_ms" },
    body: { __column: "track_comments.body" },
    fromProducer: { __column: "track_comments.from_producer" },
    authorName: { __column: "track_comments.author_name" },
    createdAt: { __column: "track_comments.created_at" },
    resolvedAt: { __column: "track_comments.resolved_at" },
  };

  // Chain handler — any terminal (.where, .orderBy, .limit, .then)
  // resolves the same cached promise so the router can `await` at any
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
          return {
            where: () => ({
              limit: () => Promise.resolve([{ id: PRODUCER_ID }]),
            }),
          };
        }
        // producer.music.list AND producer.music.detail both .from(trackVersions).
        // The list test puts the music-list mock in the queue head; the detail
        // test enqueues the head + version-stack mocks.
        if (table === trackVersionsMarker) {
          // Detail tests enqueue per-call mocks. List tests rely on
          // musicListMock as the catch-all fallback.
          const next = trackVersionsQueue.shift();
          if (next) {
            const spy = trackVersionsWhereSpies.shift();
            return chain(next, spy);
          }
          return chain(() => musicListMock(), musicListWhereSpy);
        }
        if (table === trackCommentsMarker) {
          const next = trackCommentsQueue.shift();
          if (next) {
            const spy = trackCommentsWhereSpies.shift();
            return chain(next, spy);
          }
          return chain(() => Promise.resolve([]));
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
  };

  return {
    producersMarker,
    projectsMarker,
    trackVersionsMarker,
    projectTracksMarker,
    trackCommentsMarker,
    musicListMock,
    musicListWhereSpy,
    trackVersionsQueue,
    trackVersionsWhereSpies,
    trackCommentsQueue,
    trackCommentsWhereSpies,
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
  trackVersions: trackVersionsMarker,
  projectTracks: projectTracksMarker,
  trackComments: trackCommentsMarker,
  // Tables referenced elsewhere in the producer router module — opaque
  // markers so the router loads inside the test without exercising them.
  invoices: { __table: "invoices" },
  bookings: { __table: "bookings" },
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

// Re-import so the auth-boundary test asserts against the same column
// markers the router imports from.
import { projects, trackVersions, trackComments } from "@skitza/db";

beforeEach(() => {
  musicListMock.mockReset().mockResolvedValue([]);
  musicListWhereSpy.mockReset();
  trackVersionsQueue.length = 0;
  trackVersionsWhereSpies.length = 0;
  trackCommentsQueue.length = 0;
  trackCommentsWhereSpies.length = 0;
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_producer_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

// Walks an arbitrarily nested `and(...)` tree to find an (operator,
// column) pair. Same helper used in producer-today.test.ts + artist-home.
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

describe("producer.music.list", () => {
  it("returns empty array for producer with no tracks", async () => {
    // musicListMock defaults to [] via beforeEach.
    const caller = await buildCaller();
    const result = await caller.producer.music.list();

    expect(result.tracks).toEqual([]);
  });

  it("scopes the query to ctx.producerId (auth boundary)", async () => {
    const caller = await buildCaller();
    await caller.producer.music.list();

    // The music-list WHERE must reference projects.producerId with an
    // eq(<col>, PRODUCER_ID). findPredicate walks any nested and(...).
    const whereArg = musicListWhereSpy.mock.calls[0]?.[0];
    const pred = findPredicate(whereArg, "eq", projects.producerId);
    expect(pred).not.toBeNull();
    if (Array.isArray(pred)) {
      expect(pred[1]).toBe(PRODUCER_ID);
    }
  });

  it("sorts tracks by uploadedAt desc", async () => {
    const now = Date.now();
    const newest = new Date(now);
    const middle = new Date(now - 60_000);
    const oldest = new Date(now - 2 * 60_000);
    // Rows already arrive in desc order (the DB enforces it via the
    // ORDER BY clause). We verify the router surfaces them in the same
    // order — i.e. doesn't reverse them or re-sort by a different key.
    musicListMock.mockResolvedValueOnce([
      {
        id: "v-newest",
        trackTitle: "Newest",
        label: "Master",
        projectId: "p1",
        projectTitle: "Project 1",
        clientName: "Alice",
        uploadedAt: newest,
        audioUrl: "https://cdn/newest.mp3",
      },
      {
        id: "v-middle",
        trackTitle: "Middle",
        label: "Mix v2",
        projectId: "p1",
        projectTitle: "Project 1",
        clientName: "Alice",
        uploadedAt: middle,
        audioUrl: "https://cdn/middle.mp3",
      },
      {
        id: "v-oldest",
        trackTitle: "Oldest",
        label: "Mix v1",
        projectId: "p2",
        projectTitle: "Project 2",
        clientName: "Bob",
        uploadedAt: oldest,
        audioUrl: "https://cdn/oldest.mp3",
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.music.list();

    expect(result.tracks.map((t) => t.id)).toEqual([
      "v-newest",
      "v-middle",
      "v-oldest",
    ]);
  });

  it("returns full row shape: track title + label + project context + audioUrl + uploadedAt", async () => {
    const uploadedAt = new Date("2026-04-15T12:00:00Z");
    musicListMock.mockResolvedValueOnce([
      {
        id: "v1",
        trackTitle: "Midnight Drive",
        label: "Master",
        projectId: "p1",
        projectTitle: "Alice EP",
        clientName: "Alice Records",
        uploadedAt,
        audioUrl: "https://cdn/midnight.mp3",
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.music.list();

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toEqual({
      id: "v1",
      trackTitle: "Midnight Drive",
      label: "Master",
      projectId: "p1",
      projectTitle: "Alice EP",
      clientName: "Alice Records",
      uploadedAt,
      audioUrl: "https://cdn/midnight.mp3",
    });
  });

  it("caps at 100 rows", async () => {
    // Seed 150 rows. Even if the DB layer returned more than 100, the
    // router's response must be ≤ 100. (The router enforces this via
    // .limit(100) in the query; this test is a belt-and-braces assertion
    // on the response shape.)
    musicListMock.mockResolvedValueOnce(
      Array.from({ length: 150 }, (_, i) => ({
        id: `v-${String(i)}`,
        trackTitle: `Track ${String(i)}`,
        label: "Mix",
        projectId: "p1",
        projectTitle: "Project 1",
        clientName: "Alice",
        uploadedAt: new Date(Date.now() - i * 60_000),
        audioUrl: `https://cdn/${String(i)}.mp3`,
      })),
    );

    const caller = await buildCaller();
    const result = await caller.producer.music.list();

    expect(result.tracks.length).toBeLessThanOrEqual(100);
  });
});

describe("producer.music.detail", () => {
  // The detail procedure executes 3 SELECTs in order:
  //   1. head: trackVersions ⋈ projectTracks ⋈ projects (auth-scoped)
  //   2. version stack: trackVersions WHERE trackId = head.trackId
  //   3. comments: trackComments WHERE versionId IN (...)
  // Tests enqueue mocks for each in order and assert the response shape
  // and auth-scope predicates.

  it("throws NOT_FOUND when no version matches under this producer", async () => {
    const headWhereSpy = vi.fn<(arg: unknown) => void>();
    trackVersionsWhereSpies.push(headWhereSpy);
    trackVersionsQueue.push(() => Promise.resolve([]));

    const caller = await buildCaller();
    await expect(
      caller.producer.music.detail({
        versionId: "00000000-0000-0000-0000-000000000001",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("scopes the head query to ctx.producerId AND the input versionId (auth boundary)", async () => {
    const headWhereSpy = vi.fn<(arg: unknown) => void>();
    trackVersionsWhereSpies.push(headWhereSpy);
    trackVersionsQueue.push(() => Promise.resolve([]));

    const caller = await buildCaller();
    await caller.producer.music
      .detail({ versionId: "00000000-0000-0000-0000-000000000001" })
      .catch(() => {});

    const whereArg = headWhereSpy.mock.calls[0]?.[0];
    // Must filter by projects.producerId — this is the auth boundary.
    const producerPred = findPredicate(whereArg, "eq", projects.producerId);
    expect(producerPred).not.toBeNull();
    if (Array.isArray(producerPred)) {
      expect(producerPred[1]).toBe(PRODUCER_ID);
    }
    // And by trackVersions.id — the actual lookup key.
    const versionPred = findPredicate(whereArg, "eq", trackVersions.id);
    expect(versionPred).not.toBeNull();
  });

  it("returns track + version stack + comments grouped per version", async () => {
    const versionId = "11111111-1111-1111-1111-111111111111";
    const trackId = "22222222-2222-2222-2222-222222222222";

    // Head row.
    trackVersionsWhereSpies.push(vi.fn<(arg: unknown) => void>());
    trackVersionsQueue.push(() =>
      Promise.resolve([
        {
          versionId,
          trackId,
          trackTitle: "Midnight Drive",
          trackArtist: "Alice",
          projectId: "p1",
          projectTitle: "Alice EP",
          clientName: "Alice Records",
        },
      ]),
    );

    // Version stack — desc by uploadedAt.
    const versionStackSpy = vi.fn<(arg: unknown) => void>();
    trackVersionsWhereSpies.push(versionStackSpy);
    trackVersionsQueue.push(() =>
      Promise.resolve([
        {
          id: versionId,
          label: "Master",
          audioUrl: "https://cdn/master.mp3",
          durationMs: 240_000,
          uploadedAt: new Date("2026-04-15T12:00:00Z"),
          approvedAt: null,
        },
        {
          id: "v-prev",
          label: "Mix v2",
          audioUrl: "https://cdn/mix2.mp3",
          durationMs: 240_000,
          uploadedAt: new Date("2026-04-14T12:00:00Z"),
          approvedAt: null,
        },
      ]),
    );

    // Comments across both versions.
    const commentsSpy = vi.fn<(arg: unknown) => void>();
    trackCommentsWhereSpies.push(commentsSpy);
    trackCommentsQueue.push(() =>
      Promise.resolve([
        {
          id: "c1",
          versionId,
          timeMs: 30_000,
          body: "Bring vox up at 0:30",
          fromProducer: false,
          authorName: "Alice",
          createdAt: new Date("2026-04-15T13:00:00Z"),
          resolvedAt: null,
        },
        {
          id: "c2",
          versionId: "v-prev",
          timeMs: 60_000,
          body: "Bass too loud",
          fromProducer: false,
          authorName: "Alice",
          createdAt: new Date("2026-04-14T13:00:00Z"),
          resolvedAt: null,
        },
      ]),
    );

    const caller = await buildCaller();
    const result = await caller.producer.music.detail({ versionId });

    expect(result.track).toEqual({
      id: trackId,
      title: "Midnight Drive",
      artist: "Alice",
      projectId: "p1",
      projectTitle: "Alice EP",
      clientName: "Alice Records",
    });
    expect(result.versions).toHaveLength(2);
    expect(result.versions[0]?.id).toBe(versionId);
    expect(result.versions[0]?.label).toBe("Master");
    expect(result.comments).toHaveLength(2);
    expect(result.selectedVersionId).toBe(versionId);

    // Version stack must be filtered by trackId (the parent track),
    // not by versionId — otherwise we'd only show one version on the L3 page.
    const versionStackWhere = versionStackSpy.mock.calls[0]?.[0];
    const stackPred = findPredicate(
      versionStackWhere,
      "eq",
      trackVersions.trackId,
    );
    expect(stackPred).not.toBeNull();
    if (Array.isArray(stackPred)) {
      expect(stackPred[1]).toBe(trackId);
    }

    // Comments filtered by inArray(versionId, [...]).
    const commentsWhere = commentsSpy.mock.calls[0]?.[0];
    const cPred = findPredicate(
      commentsWhere,
      "inArray",
      trackComments.versionId,
    );
    expect(cPred).not.toBeNull();
  });

  it("returns empty comments array when no versions exist (defensive)", async () => {
    // Edge case: head returns a row but versions are empty. Should
    // short-circuit the comments fetch and return [] without hitting
    // the trackComments table at all.
    trackVersionsWhereSpies.push(vi.fn<(arg: unknown) => void>());
    trackVersionsQueue.push(() =>
      Promise.resolve([
        {
          versionId: "v-only",
          trackId: "t-only",
          trackTitle: "Solo",
          trackArtist: null,
          projectId: "p1",
          projectTitle: "Solo Project",
          clientName: null,
        },
      ]),
    );
    // Empty version stack.
    trackVersionsWhereSpies.push(vi.fn<(arg: unknown) => void>());
    trackVersionsQueue.push(() => Promise.resolve([]));

    const caller = await buildCaller();
    const result = await caller.producer.music.detail({
      versionId: "00000000-0000-0000-0000-000000000099",
    });

    expect(result.versions).toEqual([]);
    expect(result.comments).toEqual([]);
  });
});
