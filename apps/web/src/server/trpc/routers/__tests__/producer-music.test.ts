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
  musicListMock,
  musicListWhereSpy,
  dbMock,
} = vi.hoisted(() => {
  const musicListMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const musicListWhereSpy = vi.fn<(arg: unknown) => void>();

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
  };
  const projectTracksMarker = {
    __table: "project_tracks",
    id: { __column: "project_tracks.id" },
    projectId: { __column: "project_tracks.project_id" },
    title: { __column: "project_tracks.title" },
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
        // producer.music.list starts its select from trackVersions and
        // joins outward to projects. The first .from(trackVersions) in
        // the router is the single music-list query.
        if (table === trackVersionsMarker) {
          return chain(() => musicListMock(), musicListWhereSpy);
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
    musicListMock,
    musicListWhereSpy,
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
  // Tables referenced elsewhere in the producer router module — opaque
  // markers so the router loads inside the test without exercising them.
  invoices: { __table: "invoices" },
  bookings: { __table: "bookings" },
  trackComments: { __table: "track_comments" },
  leads: { __table: "leads" },
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
import { projects } from "@skitza/db";

beforeEach(() => {
  musicListMock.mockReset().mockResolvedValue([]);
  musicListWhereSpy.mockReset();
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
