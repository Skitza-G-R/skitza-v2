import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// projectRoom.music returns the §11.6 Music tab payload — tracks +
// versions + comments. Each track payload also includes a denormalized
// `unresolvedComments` field that's joined across all versions of the
// track (the cross-version persistence query — see project-room.music-
// cross-version.test.ts for the dedicated assertion).

const PRODUCER_ID = "producer-uuid-1";
const PROJECT_ID = "00000000-0000-0000-0000-000000000a01";

const {
  projectsMarker,
  producersMarker,
  projectTracksMarker,
  trackVersionsMarker,
  trackCommentsMarker,
  producerSelectQueue,
  projectSelectQueue,
  projectTracksMock,
  trackVersionsMock,
  trackCommentsCrossVersionMock,
  projectsWhereSpy,
  trackCommentsCrossVersionWhereSpy,
  resetCallCounts,
  dbMock,
} = vi.hoisted(() => {
  const projectsMarker: Record<string, unknown> = { __table: "projects" };
  projectsMarker.id = { __column: "projects.id" };
  projectsMarker.producerId = { __column: "projects.producer_id" };

  const producersMarker = { __table: "producers" };
  const projectTracksMarker: Record<string, unknown> = {
    __table: "project_tracks",
  };
  projectTracksMarker.projectId = {
    __column: "project_tracks.project_id",
  };
  projectTracksMarker.id = { __column: "project_tracks.id" };
  projectTracksMarker.trackId = { __column: "project_tracks.track_id" };

  const trackVersionsMarker: Record<string, unknown> = {
    __table: "track_versions",
  };
  trackVersionsMarker.trackId = { __column: "track_versions.track_id" };
  trackVersionsMarker.id = { __column: "track_versions.id" };

  const trackCommentsMarker: Record<string, unknown> = {
    __table: "track_comments",
  };
  trackCommentsMarker.versionId = { __column: "track_comments.version_id" };
  trackCommentsMarker.resolvedAt = { __column: "track_comments.resolved_at" };

  type Row = Record<string, unknown>;
  const producerSelectQueue: Row[][] = [];
  const projectSelectQueue: Row[][] = [];
  const projectTracksMock = vi.fn<() => Promise<Row[]>>();
  const trackVersionsMock = vi.fn<() => Promise<Row[]>>();
  const trackCommentsCrossVersionMock = vi.fn<() => Promise<Row[]>>();
  const projectsWhereSpy = vi.fn<(arg: unknown) => void>();
  const trackCommentsCrossVersionWhereSpy = vi.fn<(arg: unknown) => void>();

  const callCounts = { trackComments: 0 };
  const resetCallCounts = () => {
    callCounts.trackComments = 0;
  };

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
        if (table === projectTracksMarker) {
          return chain(() => projectTracksMock());
        }
        if (table === trackVersionsMarker) {
          return chain(() => trackVersionsMock());
        }
        if (table === trackCommentsMarker) {
          callCounts.trackComments += 1;
          // Every trackComments SELECT in the music procedure is the
          // cross-version unresolved query (one per track via
          // Promise.all). Each hit returns the same fixture by default;
          // tests that need per-track variation can swap the mock
          // implementation to a counter-based shift().
          return chain(
            () => trackCommentsCrossVersionMock(),
            trackCommentsCrossVersionWhereSpy,
          );
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
    producerSelectQueue,
    projectSelectQueue,
    projectTracksMock,
    trackVersionsMock,
    trackCommentsCrossVersionMock,
    projectsWhereSpy,
    trackCommentsCrossVersionWhereSpy,
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
  // Other tables imported transitively through the project router file —
  // opaque markers so the module loads inside the test.
  bookings: { __table: "bookings" },
  invoices: { __table: "invoices" },
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
  trackCommentsCrossVersionMock.mockReset().mockResolvedValue([]);
  projectsWhereSpy.mockReset();
  trackCommentsCrossVersionWhereSpy.mockReset();
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
      ...overrides,
    },
  ]);
};

describe("projectRoom.music", () => {
  it("returns empty tracks list when project has no tracks", async () => {
    seedProject();
    const caller = await buildCaller();
    const result = await caller.projectRoom.music({ projectId: PROJECT_ID });
    expect(result).toEqual({ tracks: [] });
  });

  it("scopes the projects ownership SELECT by producerId (auth boundary)", async () => {
    seedProject();
    const caller = await buildCaller();
    await caller.projectRoom.music({ projectId: PROJECT_ID });

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
      caller.projectRoom.music({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns tracks with versions sorted by uploadedAt desc", async () => {
    seedProject();
    projectTracksMock.mockResolvedValueOnce([
      {
        id: "track-1",
        title: "Lead Single",
        artist: "feat. X",
        position: 0,
        createdAt: new Date("2026-04-10T10:00:00Z"),
      },
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
        status: "revisit",
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.music({ projectId: PROJECT_ID });

    expect(result.tracks).toHaveLength(1);
    const track = result.tracks[0];
    expect(track).toBeDefined();
    if (!track) return;
    expect(track.id).toBe("track-1");
    expect(track.title).toBe("Lead Single");
    expect(track.versions).toHaveLength(2);
    expect(track.versions[0]).toMatchObject({
      id: "v2",
      label: "V2",
      audioUrl: "https://r2/v2.mp3",
      statusEnum: "draft",
    });
  });

  it("returns unresolvedComments per track (placeholder for cross-version test)", async () => {
    // Smoke test: the `unresolvedComments` field exists on every track
    // payload. The cross-version-unresolved file owns the deeper assertion.
    seedProject();
    projectTracksMock.mockResolvedValueOnce([
      {
        id: "track-1",
        title: "Single",
        artist: null,
        position: 0,
        createdAt: new Date("2026-04-10T10:00:00Z"),
      },
    ]);
    trackVersionsMock.mockResolvedValueOnce([
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
    trackCommentsCrossVersionMock.mockResolvedValueOnce([
      {
        id: "c1",
        versionId: "v1",
        versionLabel: "V1",
        authorName: "Maya",
        body: "boost vox",
        timestampMs: 12000,
        endTimestampMs: null,
        fromProducer: false,
        resolvedAt: null,
        createdAt: new Date("2026-04-15T11:00:00Z"),
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.music({ projectId: PROJECT_ID });

    const track = result.tracks[0];
    expect(track).toBeDefined();
    if (!track) return;
    expect(Array.isArray(track.unresolvedComments)).toBe(true);
    expect(track.unresolvedComments.length).toBe(1);
    expect(track.unresolvedComments[0]).toMatchObject({
      id: "c1",
      body: "boost vox",
      versionLabel: "V1",
    });
  });
});
