import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// Same hoisted-mock pattern as artist-home.test.ts. Two SELECTs fan
// out for `artist.music.projects`:
//   1. projects ⨝ producers ⨝ clientContacts — exact relationship pairs
//   2. trackVersions ⨝ project_tracks ⨝ clientContacts — per-project stats
//
// Test BEHAVIOR (right shape returned), with a single auth-boundary
// test crawling each WHERE clause for column-marker identity.

const {
  clientContactsMarker,
  projectsMarker,
  projectTracksMarker,
  trackVersionsMarker,
  producersMarker,
  contactsSelectMock,
  projectsSelectMock,
  trackStatsSelectMock,
  contactsWhereSpy,
  projectsWhereSpy,
  trackStatsWhereSpy,
  exactPairJoinSpy,
  clientContactLeftJoinSpy,
  resetCallCounts,
  dbMock,
} = vi.hoisted(() => {
  const contactsSelectMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const projectsSelectMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const trackStatsSelectMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const contactsWhereSpy = vi.fn<(arg: unknown) => void>();
  const projectsWhereSpy = vi.fn<(arg: unknown) => void>();
  const trackStatsWhereSpy = vi.fn<(arg: unknown) => void>();
  const exactPairJoinSpy = vi.fn<(arg: unknown) => void>();
  const clientContactLeftJoinSpy = vi.fn<(arg: unknown) => void>();

  const clientContactsMarker = {
    __table: "client_contacts",
    clerkUserId: { __column: "client_contacts.clerk_user_id" },
    producerId: { __column: "client_contacts.producer_id" },
    email: { __column: "client_contacts.email" },
    id: { __column: "client_contacts.id" },
    archivedAt: { __column: "client_contacts.archived_at" },
  };
  const projectsMarker = {
    __table: "projects",
    id: { __column: "projects.id" },
    producerId: { __column: "projects.producer_id" },
    clientContactId: { __column: "projects.client_contact_id" },
    title: { __column: "projects.title" },
    lifecycleStatus: { __column: "projects.lifecycle_status" },
  };
  const projectTracksMarker = {
    __table: "project_tracks",
    id: { __column: "project_tracks.id" },
    projectId: { __column: "project_tracks.project_id" },
    title: { __column: "project_tracks.title" },
  };
  const trackVersionsMarker = {
    __table: "track_versions",
    id: { __column: "track_versions.id" },
    trackId: { __column: "track_versions.track_id" },
    label: { __column: "track_versions.label" },
    uploadedAt: { __column: "track_versions.uploaded_at" },
  };
  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    displayName: { __column: "producers.display_name" },
    slug: { __column: "producers.slug" },
  };

  // The track-stats query is rooted at project_tracks (so it can join
  // upward to track_versions and downward as needed). Distinguish the
  // two queries by their root table.
  const callCounts = { project_tracks: 0 };
  const resetCallCounts = () => {
    callCounts.project_tracks = 0;
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
      groupBy: () => Link;
      innerJoin: (table: unknown, on?: unknown) => Link;
      leftJoin: (table: unknown, on?: unknown) => Link;
      then: Promise<Record<string, unknown>[]>["then"];
    };
    const link: Link = {
      where: (arg: unknown) => {
        whereSpy?.(arg);
        return link;
      },
      orderBy: () => link,
      limit: () => get(),
      groupBy: () => link,
      innerJoin: (table: unknown, on?: unknown) => {
        if (table === clientContactsMarker) exactPairJoinSpy(on);
        return link;
      },
      leftJoin: (table: unknown, on?: unknown) => {
        if (table === clientContactsMarker) clientContactLeftJoinSpy(on);
        return link;
      },
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
          return {
            where: (arg: unknown) => {
              contactsWhereSpy(arg);
              return contactsSelectMock();
            },
          };
        }
        if (table === projectsMarker) {
          return chain(() => projectsSelectMock(), projectsWhereSpy);
        }
        if (table === projectTracksMarker) {
          callCounts.project_tracks += 1;
          return chain(() => trackStatsSelectMock(), trackStatsWhereSpy);
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
  };

  return {
    clientContactsMarker,
    projectsMarker,
    projectTracksMarker,
    trackVersionsMarker,
    producersMarker,
    contactsSelectMock,
    projectsSelectMock,
    trackStatsSelectMock,
    contactsWhereSpy,
    projectsWhereSpy,
    trackStatsWhereSpy,
    exactPairJoinSpy,
    clientContactLeftJoinSpy,
    resetCallCounts,
    dbMock,
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
  producers: producersMarker,
  // Other tables imported elsewhere in the router module — opaque
  // markers so the router file loads inside the test.
  bookings: { __table: "bookings" },
  purchases: { __table: "purchases" },
  purchaseRequests: { __table: "purchase_requests" },
  purchaseSessionAllowances: { __table: "purchase_session_allowances" },
  availabilityBlackouts: { __table: "availability_blackouts" },
  availabilityBlocks: { __table: "availability_blocks" },
  products: { __table: "products" },
  notifications: { __table: "notifications" },
  trackComments: { __table: "track_comments" },
  versionApprovalEvents: { __table: "version_approval_events" },
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
  sql: (_strings: TemplateStringsArray, ...values: unknown[]) => ({
    sqlValues: values,
  }),
}));

// Re-import the mocked symbols so the auth-boundary tests assert the
// router's WHERE clauses reference the same column markers the rest of
// the codebase imports (both resolve to the markers via the vi.mock
// factory above).
import { clientContacts, projects } from "@skitza/db";

beforeEach(() => {
  contactsSelectMock.mockReset().mockResolvedValue([]);
  projectsSelectMock.mockReset().mockResolvedValue([]);
  trackStatsSelectMock.mockReset().mockResolvedValue([]);
  contactsWhereSpy.mockReset();
  projectsWhereSpy.mockReset();
  trackStatsWhereSpy.mockReset();
  exactPairJoinSpy.mockReset();
  clientContactLeftJoinSpy.mockReset();
  resetCallCounts();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_artist_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

describe("artist.music.projects", () => {
  it("returns [] when artist has no studios", async () => {
    contactsSelectMock.mockResolvedValueOnce([]);

    const caller = await buildCaller();
    const result = await caller.artist.music.projects();

    expect(result).toEqual({ projects: [] });
  });

  it("returns one entry per project owned by my client_contacts", async () => {
    contactsSelectMock.mockResolvedValueOnce([{ id: "c1", producerId: "p1", email: "dan@x.com" }]);
    projectsSelectMock.mockResolvedValueOnce([
      {
        projectId: "proj1",
        title: "Summer EP",
        projectLifecycleStatus: "active",
        producerId: "p1",
        producerName: "Gili Asraf Studio",
        producerSlug: "giasraf",
      },
      {
        projectId: "proj2",
        title: "Winter Single",
        projectLifecycleStatus: "completed",
        producerId: "p1",
        producerName: "Gili Asraf Studio",
        producerSlug: "giasraf",
      },
    ]);
    // Raw per-version rows. Each row is one (project, track, version)
    // tuple — the router reduces to a per-project (count, latest)
    // shape. proj1 has 3 distinct project_tracks (titles "Track A",
    // "Track B", "Track C") with one version each; proj2 has 1 track
    // ("Winter Tune") with one version.
    trackStatsSelectMock.mockResolvedValueOnce([
      {
        projectId: "proj1",
        trackId: "t-a",
        trackTitle: "Track A",
        versionLabel: "V1",
        uploadedAt: new Date("2026-04-10T00:00:00Z"),
      },
      {
        projectId: "proj1",
        trackId: "t-b",
        trackTitle: "Track B",
        versionLabel: "V1",
        uploadedAt: new Date("2026-04-12T00:00:00Z"),
      },
      {
        projectId: "proj1",
        trackId: "t-c",
        trackTitle: "Summer Song",
        versionLabel: "V2",
        uploadedAt: new Date("2026-04-17T12:00:00Z"),
      },
      {
        projectId: "proj2",
        trackId: "t-w",
        trackTitle: "Winter Tune",
        versionLabel: "Rough Mix",
        uploadedAt: new Date("2026-04-15T09:00:00Z"),
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.artist.music.projects();

    expect(result.projects).toHaveLength(2);
    expect(result.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: "proj1",
          title: "Summer EP",
          projectLifecycleStatus: "active",
          producerId: "p1",
          producerName: "Gili Asraf Studio",
          producerSlug: "giasraf",
          // Latest = the V2 of Summer Song (most recent uploadedAt).
          // Format = "<versionLabel> of <trackTitle>".
          latestTrackTitle: "V2 of Summer Song",
          latestTrackUploadedAt: new Date("2026-04-17T12:00:00Z"),
          trackCount: 3,
        }),
        expect.objectContaining({
          projectId: "proj2",
          title: "Winter Single",
          projectLifecycleStatus: "completed",
          producerId: "p1",
          producerName: "Gili Asraf Studio",
          producerSlug: "giasraf",
          latestTrackTitle: "Rough Mix of Winter Tune",
          latestTrackUploadedAt: new Date("2026-04-15T09:00:00Z"),
          trackCount: 1,
        }),
      ]),
    );
  });

  it("sorts by most-recent-track-upload desc", async () => {
    contactsSelectMock.mockResolvedValueOnce([{ id: "c1", producerId: "p1", email: "dan@x.com" }]);
    projectsSelectMock.mockResolvedValueOnce([
      {
        projectId: "older",
        title: "Older Project",
        producerId: "p1",
        producerName: "Studio A",
        producerSlug: "a",
      },
      {
        projectId: "newer",
        title: "Newer Project",
        producerId: "p1",
        producerName: "Studio A",
        producerSlug: "a",
      },
    ]);
    trackStatsSelectMock.mockResolvedValueOnce([
      {
        projectId: "older",
        trackId: "t-older-1",
        trackTitle: "Older Track",
        versionLabel: "V1",
        uploadedAt: new Date("2026-04-01T00:00:00Z"),
      },
      {
        projectId: "older",
        trackId: "t-older-2",
        trackTitle: "Older Track 2",
        versionLabel: "V1",
        uploadedAt: new Date("2026-03-15T00:00:00Z"),
      },
      {
        projectId: "newer",
        trackId: "t-newer-1",
        trackTitle: "Brand New",
        versionLabel: "V1",
        uploadedAt: new Date("2026-04-17T00:00:00Z"),
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.artist.music.projects();

    expect(result.projects).toHaveLength(2);
    expect(result.projects[0]?.projectId).toBe("newer");
    expect(result.projects[1]?.projectId).toBe("older");
  });

  it("sorts null latestTrackUploadedAt last", async () => {
    contactsSelectMock.mockResolvedValueOnce([{ id: "c1", producerId: "p1", email: "dan@x.com" }]);
    projectsSelectMock.mockResolvedValueOnce([
      {
        projectId: "no_tracks",
        title: "Just kicked off",
        projectLifecycleStatus: "canceled",
        producerId: "p1",
        producerName: "Studio A",
        producerSlug: "a",
      },
      {
        projectId: "has_track",
        title: "Old Project",
        projectLifecycleStatus: "completed",
        producerId: "p1",
        producerName: "Studio A",
        producerSlug: "a",
      },
      {
        projectId: "another_no_tracks",
        title: "Also brand new",
        projectLifecycleStatus: "active",
        producerId: "p1",
        producerName: "Studio A",
        producerSlug: "a",
      },
    ]);
    // Only one project has tracks; the other two are absent from the
    // track-stats result (no project_tracks rows at all → no entries
    // get returned by the join). The router falls back to trackCount=0
    // and latestTrackUploadedAt=null.
    trackStatsSelectMock.mockResolvedValueOnce([
      {
        projectId: "has_track",
        trackId: "t1",
        trackTitle: "First Track",
        versionLabel: "First Mix",
        uploadedAt: new Date("2026-04-01T00:00:00Z"),
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.artist.music.projects();

    expect(result.projects).toHaveLength(3);
    // The project with a track sorts first; the two with no tracks
    // come after, both with null upload date and zero tracks.
    expect(result.projects[0]?.projectId).toBe("has_track");
    expect(result.projects[0]?.latestTrackUploadedAt).toEqual(new Date("2026-04-01T00:00:00Z"));
    expect(result.projects[1]?.latestTrackUploadedAt).toBeNull();
    expect(result.projects[2]?.latestTrackUploadedAt).toBeNull();
    expect(result.projects[1]?.trackCount).toBe(0);
    expect(result.projects[2]?.trackCount).toBe(0);
    expect(result.projects[1]?.latestTrackTitle).toBeNull();
    expect(result.projects[2]?.latestTrackTitle).toBeNull();
    expect(result.projects).toContainEqual(
      expect.objectContaining({
        projectId: "no_tracks",
        projectLifecycleStatus: "canceled",
        trackCount: 0,
      }),
    );
  });

  it("correlates each project query to one exact active relationship", async () => {
    contactsSelectMock.mockResolvedValueOnce([
      { id: "c1", producerId: "p1", email: "dan@x.com" },
      { id: "c2", producerId: "p2", email: "DAN+studio@x.com" },
    ]);
    const caller = await buildCaller("user_alice");
    await caller.artist.music.projects();

    const exactRelationship = {
      and: [
        { eq: [clientContacts.clerkUserId, "user_alice"] },
        { eq: [clientContacts.id, projects.clientContactId] },
        { eq: [clientContacts.producerId, projects.producerId] },
        { isNull: clientContacts.archivedAt },
      ],
    };

    expect(exactPairJoinSpy.mock.calls.map((call) => call[0])).toEqual([
      exactRelationship,
      exactRelationship,
    ]);
    expect(clientContactLeftJoinSpy).not.toHaveBeenCalled();
  });
});
