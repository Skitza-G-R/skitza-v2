import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// Same hoisted-mock pattern as artist-music.test.ts, extended for the
// detail + addComment procedures. Five SELECT shapes fan out:
//   1. projects        — load the requested project row
//   2. clientContacts  — resolve (producerId, clerkUserId, email) ownership
//   3. producers       — join producer display name
//   4. projectTracks   — list tracks on the project (ordered by position)
//   5. trackVersions   — stack of versions per track (desc by uploadedAt)
//   6. trackComments   — asc by createdAt
// addComment additionally resolves the track → project chain and
// INSERTs a track_comments row.
//
// The ownership guard is the tier-1 auth boundary: the helper throws
// NOT_FOUND (never UNAUTHORIZED) when the signed-in artist doesn't own
// the project via clientContacts + producerId + email match. We test
// each leak vector explicitly.

type Row = Record<string, unknown>;

const {
  clientContactsMarker,
  projectsMarker,
  projectTracksMarker,
  trackVersionsMarker,
  trackCommentsMarker,
  producersMarker,
  projectSelectQueue,
  contactsSelectQueue,
  producerSelectQueue,
  tracksSelectQueue,
  versionsSelectQueue,
  commentsSelectQueue,
  trackSelectQueue,
  versionSelectQueue,
  contactsWhereSpy,
  insertValuesSpy,
  insertReturningMock,
  dbMock,
} = vi.hoisted(() => {
  type Queue = Row[][];
  const projectSelectQueue: Queue = [];
  const contactsSelectQueue: Queue = [];
  const producerSelectQueue: Queue = [];
  const tracksSelectQueue: Queue = [];
  const versionsSelectQueue: Queue = [];
  const commentsSelectQueue: Queue = [];
  // The addComment mutation resolves trackVersion → projectTrack →
  // project chain; those use .limit(1) and are routed off the version
  // queue (first hit on trackVersions for that call) and the track
  // queue (first hit on projectTracks for that call).
  const trackSelectQueue: Queue = [];
  const versionSelectQueue: Queue = [];

  const contactsWhereSpy = vi.fn<(arg: unknown) => void>();
  const insertValuesSpy = vi.fn<(payload: Row) => void>();
  // The router calls .insert(trackComments).values(row).returning(),
  // so we surface returning() as the awaitable.
  const insertReturningMock = vi.fn<() => Promise<Row[]>>();

  const clientContactsMarker = {
    __table: "client_contacts",
    clerkUserId: { __column: "client_contacts.clerk_user_id" },
    producerId: { __column: "client_contacts.producer_id" },
    email: { __column: "client_contacts.email" },
    id: { __column: "client_contacts.id" },
    name: { __column: "client_contacts.name" },
  };
  const projectsMarker = {
    __table: "projects",
    id: { __column: "projects.id" },
    producerId: { __column: "projects.producer_id" },
    artistEmail: { __column: "projects.artist_email" },
    title: { __column: "projects.title" },
  };
  const projectTracksMarker = {
    __table: "project_tracks",
    id: { __column: "project_tracks.id" },
    projectId: { __column: "project_tracks.project_id" },
    title: { __column: "project_tracks.title" },
    position: { __column: "project_tracks.position" },
    createdAt: { __column: "project_tracks.created_at" },
  };
  const trackVersionsMarker = {
    __table: "track_versions",
    id: { __column: "track_versions.id" },
    trackId: { __column: "track_versions.track_id" },
    label: { __column: "track_versions.label" },
    audioUrl: { __column: "track_versions.audio_url" },
    durationMs: { __column: "track_versions.duration_ms" },
    peaksR2Key: { __column: "track_versions.peaks_r2_key" },
    uploadedAt: { __column: "track_versions.uploaded_at" },
  };
  const trackCommentsMarker = {
    __table: "track_comments",
    id: { __column: "track_comments.id" },
    versionId: { __column: "track_comments.version_id" },
    timestampMs: { __column: "track_comments.timestamp_ms" },
    body: { __column: "track_comments.body" },
    fromProducer: { __column: "track_comments.from_producer" },
    authorName: { __column: "track_comments.author_name" },
    authorEmail: { __column: "track_comments.author_email" },
    resolvedAt: { __column: "track_comments.resolved_at" },
    createdAt: { __column: "track_comments.created_at" },
  };
  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    displayName: { __column: "producers.display_name" },
    slug: { __column: "producers.slug" },
  };

  const shift = <T,>(q: T[][]): T[] => q.shift() ?? [];

  // Per-table call counters. A second query on the same table within
  // one caller invocation is a different semantic query — we route by
  // FIFO queue order.
  const counts = {
    projects: 0,
    projectTracks: 0,
    trackVersions: 0,
    trackComments: 0,
    producers: 0,
    contacts: 0,
  };
  const reset = () => {
    counts.projects = 0;
    counts.projectTracks = 0;
    counts.trackVersions = 0;
    counts.trackComments = 0;
    counts.producers = 0;
    counts.contacts = 0;
  };

  // Chain helper: the tests drive a mix of (.where().limit(1) |
  // .where().orderBy() | .where() only) styles. We resolve the promise
  // lazily the first time any terminal (or await on the chain) reaches
  // it, then memoize so .where().orderBy().limit() resolves the same
  // promise as .then() directly.
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
      leftJoin: () => Link;
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
      leftJoin: () => link,
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
        if (table === clientContactsMarker) {
          counts.contacts += 1;
          return chain(
            () => Promise.resolve(shift(contactsSelectQueue)),
            contactsWhereSpy,
          );
        }
        if (table === projectsMarker) {
          counts.projects += 1;
          return chain(() => Promise.resolve(shift(projectSelectQueue)));
        }
        if (table === producersMarker) {
          counts.producers += 1;
          return chain(() => Promise.resolve(shift(producerSelectQueue)));
        }
        if (table === projectTracksMarker) {
          counts.projectTracks += 1;
          // For addComment's track chain lookup, the first shift pulls
          // from trackSelectQueue so the tests can distinguish the
          // query.project's tracks-list call from the addComment's
          // single-row lookup.
          if (trackSelectQueue.length > 0) {
            return chain(() => Promise.resolve(shift(trackSelectQueue)));
          }
          return chain(() => Promise.resolve(shift(tracksSelectQueue)));
        }
        if (table === trackVersionsMarker) {
          counts.trackVersions += 1;
          if (versionSelectQueue.length > 0) {
            return chain(() => Promise.resolve(shift(versionSelectQueue)));
          }
          return chain(() => Promise.resolve(shift(versionsSelectQueue)));
        }
        if (table === trackCommentsMarker) {
          counts.trackComments += 1;
          return chain(() => Promise.resolve(shift(commentsSelectQueue)));
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
    insert: () => ({
      values: (payload: Row) => {
        insertValuesSpy(payload);
        return {
          returning: () => insertReturningMock(),
        };
      },
    }),
  };

  return {
    clientContactsMarker,
    projectsMarker,
    projectTracksMarker,
    trackVersionsMarker,
    trackCommentsMarker,
    producersMarker,
    projectSelectQueue,
    contactsSelectQueue,
    producerSelectQueue,
    tracksSelectQueue,
    versionsSelectQueue,
    commentsSelectQueue,
    trackSelectQueue,
    versionSelectQueue,
    contactsWhereSpy,
    insertValuesSpy,
    insertReturningMock,
    dbMock,
    _resetCounts: reset,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_artist_1" }),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  clientContacts: clientContactsMarker,
  projects: projectsMarker,
  projectTracks: projectTracksMarker,
  trackVersions: trackVersionsMarker,
  trackComments: trackCommentsMarker,
  producers: producersMarker,
  // Other tables referenced by the artist router — opaque markers so
  // the module loads under the test.
  bookings: { __table: "bookings" },
  invoices: { __table: "invoices" },
  availabilityBlackouts: { __table: "availability_blackouts" },
  availabilityBlocks: { __table: "availability_blocks" },
  products: { __table: "products" },
  notifications: { __table: "notifications" },
  stripeCustomers: { __table: "stripe_customers" },
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
  isNull: (col: unknown) => ({ isNull: col }),
  isNotNull: (col: unknown) => ({ isNotNull: col }),
  ilike: (col: unknown, val: unknown) => ({ ilike: [col, val] }),
  sql: () => ({ sql: true }),
}));

// Re-import the mocked symbols for the auth-boundary identity checks.
import { clientContacts } from "@skitza/db";

beforeEach(() => {
  projectSelectQueue.length = 0;
  contactsSelectQueue.length = 0;
  producerSelectQueue.length = 0;
  tracksSelectQueue.length = 0;
  versionsSelectQueue.length = 0;
  commentsSelectQueue.length = 0;
  trackSelectQueue.length = 0;
  versionSelectQueue.length = 0;
  contactsWhereSpy.mockReset();
  insertValuesSpy.mockReset();
  insertReturningMock.mockReset().mockResolvedValue([]);
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_artist_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const TRACK_VERSION_ID = "22222222-2222-2222-2222-222222222222";

// Seeds a valid ownership chain: (project → clientContacts → producer).
// Test helper for the happy paths + any test that wants to move PAST
// the ownership guard to verify downstream shape/insert behavior.
function seedOwnedProject(overrides?: { projectRow?: Partial<Row>; contactRow?: Partial<Row> }) {
  projectSelectQueue.push([
    {
      id: PROJECT_ID,
      title: "Summer EP",
      producerId: "p1",
      artistEmail: "dan@x.com",
      ...(overrides?.projectRow ?? {}),
    },
  ]);
  contactsSelectQueue.push([
    {
      id: "c1",
      producerId: "p1",
      email: "dan@x.com",
      name: "Dan The Artist",
      ...(overrides?.contactRow ?? {}),
    },
  ]);
}

// Walk an arbitrarily nested and(...) tree for a (operator, column)
// predicate — copied verbatim from artist-home.test.ts so the auth
// scoping assertions use the same helper.
function findPredicate(
  where: unknown,
  operator: "eq" | "inArray",
  columnMarker: unknown,
): unknown[] | null {
  if (!where || typeof where !== "object") return null;
  if ("and" in where && Array.isArray((where as { and: unknown[] }).and)) {
    for (const p of (where as { and: unknown[] }).and) {
      const found = findPredicate(p, operator, columnMarker);
      if (found) return found;
    }
    return null;
  }
  if (operator in where) {
    const args = (where as Record<string, unknown[]>)[operator];
    if (Array.isArray(args) && args[0] === columnMarker) return args;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
describe("artist.music.project (query)", () => {
  it("throws NOT_FOUND when the project row does not exist", async () => {
    projectSelectQueue.push([]); // no project

    const caller = await buildCaller();
    await expect(
      caller.artist.music.project({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND when the project exists but artist has no clientContacts row with the producer", async () => {
    // Project belongs to producer p1; the signed-in artist has NO
    // clientContacts row at all (or one only with a different producer).
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        title: "Someone Else's EP",
        producerId: "p1",
        artistEmail: "other@x.com",
      },
    ]);
    contactsSelectQueue.push([]); // no contact → can't own

    const caller = await buildCaller();
    await expect(
      caller.artist.music.project({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND when the signed-in artist's email doesn't match the project's artistEmail", async () => {
    // Artist has a clientContacts row with producer p1, but their email
    // (dan@x.com) doesn't match the project's artistEmail (jane@x.com).
    // In production the router issues a WHERE email = 'jane@x.com'
    // AND clerkUserId = ctx.userId AND producerId = 'p1'; seeding [] for
    // the contacts lookup mirrors the row-count that WHERE returns.
    // Same producer, different artist → NOT_FOUND to avoid leaking.
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        title: "Jane's EP",
        producerId: "p1",
        artistEmail: "jane@x.com",
      },
    ]);
    contactsSelectQueue.push([]); // no contact matches (email, producer, clerkUserId)

    const caller = await buildCaller();
    await expect(
      caller.artist.music.project({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns project + tracks (by position) + versions (desc by uploadedAt) + comments (asc by createdAt)", async () => {
    seedOwnedProject();
    // Producer display-name lookup.
    producerSelectQueue.push([{ displayName: "Gili Asraf Studio" }]);

    // Two tracks at positions 0 and 1.
    tracksSelectQueue.push([
      {
        id: "trk-a",
        projectId: PROJECT_ID,
        title: "Track A",
        artist: "feat. Someone",
        position: 0,
      },
      {
        id: "trk-b",
        projectId: PROJECT_ID,
        title: "Track B",
        artist: null,
        position: 1,
      },
    ]);

    // Two versions of Track A + one of Track B — seeded in the same
    // desc-uploadedAt order the production SQL `ORDER BY uploaded_at
    // DESC` would return them (mock's .orderBy is a no-op, matching
    // the convention in artist-music.test.ts). Track A: V2 (2026-04-17)
    // before V1 (2026-04-10). Track B's Rough (2026-04-15) slots in
    // between them in the flat result set — the router's grouping step
    // must split them back onto the right parent.
    versionsSelectQueue.push([
      {
        id: "v-a2",
        trackId: "trk-a",
        label: "V2",
        audioUrl: "https://r2/a-v2.mp3",
        durationMs: 215_000,
        peaksR2Key: null,
        uploadedAt: new Date("2026-04-17T00:00:00Z"),
      },
      {
        id: "v-b1",
        trackId: "trk-b",
        label: "Rough",
        audioUrl: "https://r2/b-r.mp3",
        durationMs: null,
        peaksR2Key: null,
        uploadedAt: new Date("2026-04-15T00:00:00Z"),
      },
      {
        id: "v-a1",
        trackId: "trk-a",
        label: "V1",
        audioUrl: "https://r2/a-v1.mp3",
        durationMs: 210_000,
        peaksR2Key: "peaks/a-v1",
        uploadedAt: new Date("2026-04-10T00:00:00Z"),
      },
    ]);

    // Comments already ordered asc by createdAt (production SQL).
    commentsSelectQueue.push([
      {
        id: "c-1",
        versionId: "v-a2",
        timestampMs: 15_000,
        body: "Nice punch on the drums",
        fromProducer: false,
        authorName: "Dan",
        authorEmail: "dan@x.com",
        resolvedAt: null,
        createdAt: new Date("2026-04-18T10:00:00Z"),
      },
      {
        id: "c-2",
        versionId: "v-a1",
        timestampMs: 90_000,
        body: "Bass comes in a beat late",
        fromProducer: false,
        authorName: "Dan",
        authorEmail: "dan@x.com",
        resolvedAt: null,
        createdAt: new Date("2026-04-18T11:00:00Z"),
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.artist.music.project({ projectId: PROJECT_ID });

    expect(result.project).toEqual({
      id: PROJECT_ID,
      title: "Summer EP",
      producerId: "p1",
      producerName: "Gili Asraf Studio",
    });

    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0]?.id).toBe("trk-a");
    expect(result.tracks[0]?.position).toBe(0);
    expect(result.tracks[0]?.title).toBe("Track A");
    expect(result.tracks[0]?.artist).toBe("feat. Someone");
    expect(result.tracks[1]?.id).toBe("trk-b");
    expect(result.tracks[1]?.artist).toBeNull();

    // Track A's versions: V2 (2026-04-17) before V1 (2026-04-10).
    expect(result.tracks[0]?.versions).toHaveLength(2);
    expect(result.tracks[0]?.versions[0]?.id).toBe("v-a2");
    expect(result.tracks[0]?.versions[0]?.label).toBe("V2");
    expect(result.tracks[0]?.versions[0]?.audioUrl).toBe("https://r2/a-v2.mp3");
    expect(result.tracks[0]?.versions[0]?.durationMs).toBe(215_000);
    expect(result.tracks[0]?.versions[0]?.peaksR2Key).toBeNull();
    expect(result.tracks[0]?.versions[1]?.id).toBe("v-a1");
    expect(result.tracks[0]?.versions[1]?.peaksR2Key).toBe("peaks/a-v1");

    // Track B's versions: one Rough.
    expect(result.tracks[1]?.versions).toHaveLength(1);
    expect(result.tracks[1]?.versions[0]?.id).toBe("v-b1");
    expect(result.tracks[1]?.versions[0]?.durationMs).toBeNull();

    // Comments on track A's versions, asc by createdAt.
    expect(result.tracks[0]?.comments).toHaveLength(2);
    expect(result.tracks[0]?.comments[0]?.id).toBe("c-1");
    expect(result.tracks[0]?.comments[0]?.versionId).toBe("v-a2");
    expect(result.tracks[0]?.comments[0]?.timeMs).toBe(15_000);
    expect(result.tracks[0]?.comments[0]?.body).toBe("Nice punch on the drums");
    expect(result.tracks[0]?.comments[0]?.fromProducer).toBe(false);
    expect(result.tracks[0]?.comments[0]?.authorName).toBe("Dan");
    expect(result.tracks[0]?.comments[1]?.id).toBe("c-2");

    // Track B has no comments.
    expect(result.tracks[1]?.comments).toEqual([]);
  });

  it("scopes ownership by clerkUserId (auth boundary)", async () => {
    // Two-studio artist — the WHERE should reference clerkUserId =
    // ctx.userId and find the contact that matches (producer p1, email
    // dan@x.com, project belongs to p1 + artistEmail dan@x.com).
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        title: "EP",
        producerId: "p1",
        artistEmail: "dan@x.com",
      },
    ]);
    contactsSelectQueue.push([
      { id: "c1", producerId: "p1", email: "dan@x.com", name: "Dan" },
    ]);
    producerSelectQueue.push([{ displayName: "Studio" }]);
    tracksSelectQueue.push([]);

    const caller = await buildCaller("user_alice");
    await caller.artist.music.project({ projectId: PROJECT_ID });

    // The contacts SELECT must filter by clerkUserId = ctx.userId. The
    // producer/email filters are a bonus (AND on top) — we only assert
    // clerkUserId identity here since that's the auth boundary.
    const contactsArg = contactsWhereSpy.mock.calls[0]?.[0];
    const clerkPred = findPredicate(
      contactsArg,
      "eq",
      clientContacts.clerkUserId,
    );
    expect(clerkPred).not.toBeNull();
    expect(clerkPred?.[1]).toBe("user_alice");
  });

  it("contactsSelect scopes by clerkUserId + producerId + email (AND predicates)", async () => {
    // Without these three predicates on the contacts SELECT, a
    // refactor that "simplifies" to WHERE clerk_user_id = … alone
    // would leak cross-producer / cross-email data. The existing
    // clerkUserId test above only locks one of the three; this one
    // pins the other two by column-marker identity so a silent drop
    // fails here.
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        title: "EP",
        producerId: "p1",
        artistEmail: "Dan@X.com", // router lowercases before match
      },
    ]);
    contactsSelectQueue.push([
      { id: "c1", producerId: "p1", email: "dan@x.com", name: "Dan" },
    ]);
    producerSelectQueue.push([{ displayName: "Studio" }]);
    tracksSelectQueue.push([]);

    const caller = await buildCaller();
    await caller.artist.music.project({ projectId: PROJECT_ID });

    const contactsArg = contactsWhereSpy.mock.calls[0]?.[0];

    // (a) clerkUserId — the Clerk identity predicate.
    const clerkPred = findPredicate(
      contactsArg,
      "eq",
      clientContacts.clerkUserId,
    );
    expect(clerkPred).not.toBeNull();
    expect(clerkPred?.[1]).toBe("user_test_artist_1");

    // (b) producerId — must reference the project's producer. A refactor
    // that drops this predicate would let a contact for producer p2
    // (same email, same user) satisfy the ownership guard for a p1
    // project — cross-producer leak.
    const producerPred = findPredicate(
      contactsArg,
      "eq",
      clientContacts.producerId,
    );
    expect(producerPred).not.toBeNull();
    expect(producerPred?.[1]).toBe("p1");

    // (c) email — must reference the project's artistEmail (lowercased).
    // A refactor that drops this predicate would let a project shared
    // to jane@x.com be read by dan@x.com's session — cross-email leak
    // within the same producer.
    const emailPred = findPredicate(
      contactsArg,
      "eq",
      clientContacts.email,
    );
    expect(emailPred).not.toBeNull();
    expect(emailPred?.[1]).toBe("dan@x.com");
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("artist.music.addComment (mutation)", () => {
  it("throws NOT_FOUND when the track's project isn't owned by this artist", async () => {
    // Resolve version → track → project chain. Project belongs to p1
    // but artist has no matching clientContacts row.
    versionSelectQueue.push([
      { id: TRACK_VERSION_ID, trackId: "trk-a", durationMs: 200_000 },
    ]);
    trackSelectQueue.push([
      { id: "trk-a", projectId: PROJECT_ID },
    ]);
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: "p1",
        artistEmail: "other@x.com",
      },
    ]);
    contactsSelectQueue.push([]); // no ownership

    const caller = await buildCaller();
    await expect(
      caller.artist.music.addComment({
        trackVersionId: TRACK_VERSION_ID,
        timeMs: 15_000,
        body: "Nice!",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it("inserts a track_comments row with fromProducer=false + authorName from clientContacts", async () => {
    versionSelectQueue.push([
      { id: TRACK_VERSION_ID, trackId: "trk-a", durationMs: 200_000 },
    ]);
    trackSelectQueue.push([
      { id: "trk-a", projectId: PROJECT_ID },
    ]);
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: "p1",
        artistEmail: "dan@x.com",
      },
    ]);
    contactsSelectQueue.push([
      {
        id: "c1",
        producerId: "p1",
        email: "dan@x.com",
        name: "Dan The Artist",
      },
    ]);
    insertReturningMock.mockResolvedValue([
      {
        id: "cm-new",
        versionId: TRACK_VERSION_ID,
        timestampMs: 15_000,
        body: "Nice groove",
        fromProducer: false,
        authorName: "Dan The Artist",
        authorEmail: "dan@x.com",
        resolvedAt: null,
        createdAt: new Date("2026-04-19T12:00:00Z"),
      },
    ]);

    const caller = await buildCaller();
    const row = await caller.artist.music.addComment({
      trackVersionId: TRACK_VERSION_ID,
      timeMs: 15_000,
      body: "Nice groove",
    });

    expect(insertValuesSpy).toHaveBeenCalledTimes(1);
    const payload = insertValuesSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.versionId).toBe(TRACK_VERSION_ID);
    expect(payload.body).toBe("Nice groove");
    expect(payload.timestampMs).toBe(15_000);
    expect(payload.fromProducer).toBe(false);
    expect(payload.authorName).toBe("Dan The Artist");
    // authorEmail is notNull in schema; router should source it from
    // the clientContacts row.
    expect(payload.authorEmail).toBe("dan@x.com");

    expect(row.id).toBe("cm-new");
    expect(row.fromProducer).toBe(false);
    expect(row.authorName).toBe("Dan The Artist");
  });

  it("rejects body > 2000 chars (zod validation)", async () => {
    const caller = await buildCaller();
    await expect(
      caller.artist.music.addComment({
        trackVersionId: TRACK_VERSION_ID,
        timeMs: 15_000,
        body: "x".repeat(2001),
      }),
    ).rejects.toThrow();
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it("rejects negative timeMs (zod validation)", async () => {
    const caller = await buildCaller();
    await expect(
      caller.artist.music.addComment({
        trackVersionId: TRACK_VERSION_ID,
        timeMs: -1,
        body: "Nice",
      }),
    ).rejects.toThrow();
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only body (zod .trim() then .min(1))", async () => {
    // Without .trim() before .min(1), Zod would accept "   " as a
    // 3-char string and let an empty comment through. With .trim()
    // the value becomes "" and .min(1) rejects.
    const caller = await buildCaller();
    await expect(
      caller.artist.music.addComment({
        trackVersionId: TRACK_VERSION_ID,
        timeMs: 10,
        body: "   ",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it("scopes ownership check by clerkUserId (auth boundary)", async () => {
    versionSelectQueue.push([
      { id: TRACK_VERSION_ID, trackId: "trk-a", durationMs: 200_000 },
    ]);
    trackSelectQueue.push([
      { id: "trk-a", projectId: PROJECT_ID },
    ]);
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: "p1",
        artistEmail: "dan@x.com",
      },
    ]);
    contactsSelectQueue.push([
      { id: "c1", producerId: "p1", email: "dan@x.com", name: "Dan" },
    ]);
    insertReturningMock.mockResolvedValue([
      {
        id: "cm-ok",
        versionId: TRACK_VERSION_ID,
        timestampMs: 5,
        body: "ok",
        fromProducer: false,
        authorName: "Dan",
        authorEmail: "dan@x.com",
        resolvedAt: null,
        createdAt: new Date("2026-04-19T12:00:00Z"),
      },
    ]);

    const caller = await buildCaller("user_alice");
    await caller.artist.music.addComment({
      trackVersionId: TRACK_VERSION_ID,
      timeMs: 5,
      body: "ok",
    });

    const contactsArg = contactsWhereSpy.mock.calls[0]?.[0];
    const clerkPred = findPredicate(
      contactsArg,
      "eq",
      clientContacts.clerkUserId,
    );
    expect(clerkPred).not.toBeNull();
    expect(clerkPred?.[1]).toBe("user_alice");
  });

  it("contactsSelect scopes by clerkUserId + producerId + email (AND predicates)", async () => {
    // Same guarantee as the music.project auth-boundary scope test,
    // applied to the mutation path. If a refactor drops any of the
    // three predicates the ownership guard on the write path would
    // silently admit cross-producer / cross-email comment inserts.
    versionSelectQueue.push([
      { id: TRACK_VERSION_ID, trackId: "trk-a", durationMs: 200_000 },
    ]);
    trackSelectQueue.push([
      { id: "trk-a", projectId: PROJECT_ID },
    ]);
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: "p1",
        artistEmail: "Dan@X.com", // router lowercases before match
      },
    ]);
    contactsSelectQueue.push([
      { id: "c1", producerId: "p1", email: "dan@x.com", name: "Dan" },
    ]);
    insertReturningMock.mockResolvedValue([
      {
        id: "cm-ok",
        versionId: TRACK_VERSION_ID,
        timestampMs: 5,
        body: "ok",
        fromProducer: false,
        authorName: "Dan",
        authorEmail: "dan@x.com",
        resolvedAt: null,
        createdAt: new Date("2026-04-19T12:00:00Z"),
      },
    ]);

    const caller = await buildCaller();
    await caller.artist.music.addComment({
      trackVersionId: TRACK_VERSION_ID,
      timeMs: 5,
      body: "ok",
    });

    const contactsArg = contactsWhereSpy.mock.calls[0]?.[0];

    const clerkPred = findPredicate(
      contactsArg,
      "eq",
      clientContacts.clerkUserId,
    );
    expect(clerkPred).not.toBeNull();
    expect(clerkPred?.[1]).toBe("user_test_artist_1");

    const producerPred = findPredicate(
      contactsArg,
      "eq",
      clientContacts.producerId,
    );
    expect(producerPred).not.toBeNull();
    expect(producerPred?.[1]).toBe("p1");

    const emailPred = findPredicate(
      contactsArg,
      "eq",
      clientContacts.email,
    );
    expect(emailPred).not.toBeNull();
    expect(emailPred?.[1]).toBe("dan@x.com");
  });
});
