import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// projectRoom.music.unresolvedComments — the cross-version persistence
// query. This file owns the "unresolved comments stay visible across
// versions" assertion (PRD §11.6 + S06): when a producer uploads V2,
// the unresolved feedback from V1 follows forward (rendered with a
// `(from V1)` subscript) until either party explicitly resolves it.
//
// Setup pattern: track with V1+V2; one resolved comment on V1, one
// unresolved on V1, one unresolved on V2. The procedure must return
// 2 unresolved comments for the track — both V1 + V2 unresolved, the
// resolved V1 one absent.
//
// The query joins track_comments → track_versions on track_id, filters
// by track_versions.track_id = $trackId AND track_comments.resolved_at
// IS NULL. The new index `track_comments_version_unresolved_idx` from
// S01 covers this access pattern.

const PRODUCER_ID = "producer-uuid-1";
const PROJECT_ID = "00000000-0000-0000-0000-000000000a01";
const TRACK_ID = "00000000-0000-0000-0000-000000000b01";

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
  trackCommentsCrossVersionWhereSpy,
  dbMock,
} = vi.hoisted(() => {
  const projectsMarker: Record<string, unknown> = { __table: "projects" };
  projectsMarker.id = { __column: "projects.id" };
  projectsMarker.producerId = { __column: "projects.producer_id" };

  const producersMarker = { __table: "producers" };
  const projectTracksMarker: Record<string, unknown> = {
    __table: "project_tracks",
  };
  projectTracksMarker.projectId = { __column: "project_tracks.project_id" };
  projectTracksMarker.id = { __column: "project_tracks.id" };

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
  const trackCommentsCrossVersionWhereSpy = vi.fn<(arg: unknown) => void>();

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
            where: () => ({
              limit: () => Promise.resolve(shift(projectSelectQueue)),
            }),
          };
        }
        if (table === projectTracksMarker) {
          return chain(() => projectTracksMock());
        }
        if (table === trackVersionsMarker) {
          return chain(() => trackVersionsMock());
        }
        if (table === trackCommentsMarker) {
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
    trackCommentsCrossVersionWhereSpy,
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

import { trackComments, trackVersions } from "@skitza/db";

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
  trackCommentsCrossVersionWhereSpy.mockReset();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

function findPredicate(
  where: unknown,
  columnMarker: unknown,
  operator: "eq" | "isNull" = "eq",
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

describe("projectRoom.music — cross-version unresolved persistence", () => {
  it("returns the 2 unresolved comments (one per version), excludes the resolved V1 comment", async () => {
    // Setup: 1 track, V1+V2.
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: PRODUCER_ID,
        title: "EP",
        artistName: "Maya",
        artistEmail: "maya@example.com",
        stage: "in_production",
      },
    ]);
    projectTracksMock.mockResolvedValueOnce([
      {
        id: TRACK_ID,
        title: "Lead Single",
        artist: null,
        position: 0,
        createdAt: new Date("2026-04-10T10:00:00Z"),
      },
    ]);
    trackVersionsMock.mockResolvedValueOnce([
      {
        id: "v2",
        trackId: TRACK_ID,
        label: "V2",
        audioUrl: "https://r2/v2.mp3",
        uploadedAt: new Date("2026-04-20T10:00:00Z"),
        sizeBytes: 5_000_000,
        status: "draft",
      },
      {
        id: "v1",
        trackId: TRACK_ID,
        label: "V1",
        audioUrl: "https://r2/v1.mp3",
        uploadedAt: new Date("2026-04-15T10:00:00Z"),
        sizeBytes: 4_000_000,
        status: "revisit",
      },
    ]);
    // The cross-version query already filters by resolved_at IS NULL
    // server-side, so the mock returns only the 2 unresolved comments.
    // The resolved V1 comment is implicitly absent from this fixture
    // (it's filtered by the SQL WHERE before reaching us). The test
    // asserts the procedure returns exactly what the query returns,
    // and that the WHERE clause carries the isNull(resolved_at)
    // predicate (so the filter happens in SQL — not in JS).
    trackCommentsCrossVersionMock.mockResolvedValueOnce([
      {
        id: "c-v2-unresolved",
        versionId: "v2",
        versionLabel: "V2",
        authorName: "Maya",
        body: "still want vocals louder",
        timestampMs: 30000,
        endTimestampMs: null,
        fromProducer: false,
        createdAt: new Date("2026-04-20T11:00:00Z"),
      },
      {
        id: "c-v1-unresolved",
        versionId: "v1",
        versionLabel: "V1",
        authorName: "Maya",
        body: "boost vocals around 0:30",
        timestampMs: 30000,
        endTimestampMs: null,
        fromProducer: false,
        createdAt: new Date("2026-04-15T11:00:00Z"),
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.music({ projectId: PROJECT_ID });

    expect(result.tracks).toHaveLength(1);
    const track = result.tracks[0];
    expect(track).toBeDefined();
    if (!track) return;

    // The Replay-style cross-version persistence assertion:
    // BOTH unresolved comments (V1 + V2) should appear on the track
    // even though they live on different track_versions rows.
    expect(track.unresolvedComments).toHaveLength(2);
    const ids = track.unresolvedComments.map((c) => c.id);
    expect(ids).toContain("c-v2-unresolved");
    expect(ids).toContain("c-v1-unresolved");
    // The resolved V1 comment is NOT present.
    expect(ids).not.toContain("c-v1-resolved");

    // Each entry carries its origin version's label so the UI can
    // render the `(from V1)` subscript on V2 view.
    const v1Comment = track.unresolvedComments.find(
      (c) => c.id === "c-v1-unresolved",
    );
    expect(v1Comment?.versionLabel).toBe("V1");
  });

  it("WHERE clause uses isNull(resolved_at) so the filter happens server-side (index hits)", async () => {
    // Setup: 1 track, 1 version. We don't care about the result — we
    // care that the query sent to drizzle has the right predicates so
    // it hits the track_comments_version_unresolved_idx index from S01.
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: PRODUCER_ID,
        title: "X",
        artistName: "Y",
        artistEmail: "y@example.com",
        stage: "in_production",
      },
    ]);
    projectTracksMock.mockResolvedValueOnce([
      {
        id: TRACK_ID,
        title: "T",
        artist: null,
        position: 0,
        createdAt: new Date(),
      },
    ]);
    trackVersionsMock.mockResolvedValueOnce([
      {
        id: "v1",
        trackId: TRACK_ID,
        label: "V1",
        audioUrl: null,
        uploadedAt: new Date(),
        sizeBytes: null,
        status: "draft",
      },
    ]);
    trackCommentsCrossVersionMock.mockResolvedValueOnce([]);

    const caller = await buildCaller();
    await caller.projectRoom.music({ projectId: PROJECT_ID });

    // The cross-version query must filter on:
    //   1. trackVersions.trackId = $trackId  (the join chain)
    //   2. trackComments.resolvedAt IS NULL  (the unresolved filter)
    const whereArg = trackCommentsCrossVersionWhereSpy.mock.calls[0]?.[0];
    expect(
      findPredicate(whereArg, trackVersions.trackId, "eq", TRACK_ID),
    ).toBe(true);
    expect(findPredicate(whereArg, trackComments.resolvedAt, "isNull")).toBe(
      true,
    );
  });
});
