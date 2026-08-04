import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  bookingsMarker,
  clientContactsMarker,
  projectsMarker,
  purchasesMarker,
  trackVersionsMarker,
  nextSessionMock,
  upcomingSessionsMock,
  latestMixMock,
  activityTracksMock,
  activityBookingsMock,
  ownerJoinSpy,
  resetCallCounts,
  dbMock,
} = vi.hoisted(() => {
  const clientContactsMarker = {
    __table: "client_contacts",
    id: { __column: "client_contacts.id" },
    clerkUserId: { __column: "client_contacts.clerk_user_id" },
    producerId: { __column: "client_contacts.producer_id" },
    archivedAt: { __column: "client_contacts.archived_at" },
    lastSeenAt: { __column: "client_contacts.last_seen_at" },
  };
  const bookingsMarker = {
    __table: "bookings",
    id: { __column: "bookings.id" },
    producerId: { __column: "bookings.producer_id" },
    projectId: { __column: "bookings.project_id" },
    purchaseId: { __column: "bookings.purchase_id" },
    status: { __column: "bookings.status" },
    startsAt: { __column: "bookings.starts_at" },
    durationMin: { __column: "bookings.duration_min" },
    statusChangedAt: { __column: "bookings.status_changed_at" },
  };
  const projectsMarker = {
    __table: "projects",
    id: { __column: "projects.id" },
    producerId: { __column: "projects.producer_id" },
    clientContactId: { __column: "projects.client_contact_id" },
    lifecycleStatus: { __column: "projects.lifecycle_status" },
  };
  const purchasesMarker = {
    __table: "purchases",
    id: { __column: "purchases.id" },
    projectId: { __column: "purchases.project_id" },
    producerId: { __column: "purchases.producer_id" },
    clientContactId: { __column: "purchases.client_contact_id" },
    commercialSnapshot: { __column: "purchases.commercial_snapshot" },
  };
  const trackVersionsMarker = {
    __table: "track_versions",
    id: { __column: "track_versions.id" },
    trackId: { __column: "track_versions.track_id" },
    label: { __column: "track_versions.label" },
    uploadedAt: { __column: "track_versions.uploaded_at" },
    audioUrl: { __column: "track_versions.audio_url" },
    audioDeletedAt: { __column: "track_versions.audio_deleted_at" },
  };
  const nextSessionMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const upcomingSessionsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const latestMixMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const activityTracksMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const activityBookingsMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const ownerJoinSpy = vi.fn<(value: unknown) => void>();
  const counts = { bookings: 0, tracks: 0 };
  const resetCallCounts = () => {
    counts.bookings = 0;
    counts.tracks = 0;
  };

  function chain(terminal: () => Promise<Record<string, unknown>[]>) {
    let resolved: Promise<Record<string, unknown>[]> | undefined;
    const get = () => (resolved ??= terminal());
    type Link = {
      innerJoin: (table: unknown, predicate?: unknown) => Link;
      leftJoin: (table: unknown, predicate?: unknown) => Link;
      where: () => Link;
      orderBy: () => Link;
      limit: () => Promise<Record<string, unknown>[]>;
      then: Promise<Record<string, unknown>[]>["then"];
    };
    const link: Link = {
      innerJoin: (table, predicate) => {
        if (table === clientContactsMarker) ownerJoinSpy(predicate);
        return link;
      },
      leftJoin: () => link,
      where: () => link,
      orderBy: () => link,
      limit: () => get(),
      get then() {
        return get().then.bind(get());
      },
    };
    return link;
  }

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === bookingsMarker) {
          counts.bookings += 1;
          const terminal =
            counts.bookings === 1
              ? nextSessionMock
              : counts.bookings === 2
                ? upcomingSessionsMock
                : activityBookingsMock;
          return chain(() => terminal());
        }
        if (table === trackVersionsMarker) {
          counts.tracks += 1;
          return chain(() => (counts.tracks === 1 ? latestMixMock() : activityTracksMock()));
        }
        throw new Error(`unexpected table ${String(table)}`);
      },
    }),
  };

  return {
    bookingsMarker,
    clientContactsMarker,
    projectsMarker,
    purchasesMarker,
    trackVersionsMarker,
    nextSessionMock,
    upcomingSessionsMock,
    latestMixMock,
    activityTracksMock,
    activityBookingsMock,
    ownerJoinSpy,
    resetCallCounts,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "artist-1" }),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  bookings: bookingsMarker,
  artistNotifications: {
    __table: "artist_notifications",
    recipientClerkUserId: { __column: "artist_notifications.recipient_clerk_user_id" },
    producerId: { __column: "artist_notifications.producer_id" },
    kind: { __column: "artist_notifications.kind" },
    subjectType: { __column: "artist_notifications.subject_type" },
    subjectId: { __column: "artist_notifications.subject_id" },
    inAppVisible: { __column: "artist_notifications.in_app_visible" },
    archivedAt: { __column: "artist_notifications.archived_at" },
    openedAt: { __column: "artist_notifications.opened_at" },
  },
  clientContacts: clientContactsMarker,
  projects: projectsMarker,
  purchases: purchasesMarker,
  trackVersions: trackVersionsMarker,
  projectTracks: {
    __table: "project_tracks",
    id: { __column: "project_tracks.id" },
    projectId: { __column: "project_tracks.project_id" },
    title: { __column: "project_tracks.title" },
  },
  producers: {
    __table: "producers",
    id: { __column: "producers.id" },
    displayName: { __column: "producers.display_name" },
    slug: { __column: "producers.slug" },
  },
  availabilityBlackouts: { __table: "availability_blackouts" },
  availabilityBlocks: { __table: "availability_blocks" },
  products: { __table: "products" },
  purchaseRequests: { __table: "purchase_requests" },
  purchaseSessionAllowances: { __table: "purchase_session_allowances" },
  trackComments: { __table: "track_comments" },
  versionApprovalEvents: { __table: "version_approval_events" },
  notifications: { __table: "notifications" },
  and: (...conditions: unknown[]) => ({ and: conditions }),
  asc: (column: unknown) => ({ asc: column }),
  desc: (column: unknown) => ({ desc: column }),
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  ne: (column: unknown, value: unknown) => ({ ne: [column, value] }),
  gte: (column: unknown, value: unknown) => ({ gte: [column, value] }),
  inArray: (column: unknown, values: unknown[]) => ({ inArray: [column, values] }),
  isNull: (column: unknown) => ({ isNull: column }),
  isNotNull: (column: unknown) => ({ isNotNull: column }),
  lte: (column: unknown, value: unknown) => ({ lte: [column, value] }),
  sql: (_strings: TemplateStringsArray, ...values: unknown[]) => ({ sqlValues: values }),
}));

beforeEach(() => {
  nextSessionMock.mockReset().mockResolvedValue([]);
  upcomingSessionsMock.mockReset().mockResolvedValue([]);
  latestMixMock.mockReset().mockResolvedValue([]);
  activityTracksMock.mockReset().mockResolvedValue([]);
  activityBookingsMock.mockReset().mockResolvedValue([]);
  ownerJoinSpy.mockReset();
  resetCallCounts();
  process.env.DATABASE_URL = "postgresql://test/test";
});

async function caller(userId = "artist-1") {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
}

const snapshot = {
  productOrOfferName: "4-hour Mix Session",
} as const;
const producerId = "11111111-1111-4111-8111-111111111111";

describe("artist.home", () => {
  it("returns no commercial state when there are no owned rows", async () => {
    const result = await (await caller()).artist.home({ producerId });
    expect(result).toEqual({
      nextSession: null,
      upcomingSessions: [],
      latestMix: null,
      outstandingBalance: null,
      activity: [],
    });
  });

  it("names confirmed sessions from the immutable purchase snapshot", async () => {
    nextSessionMock.mockResolvedValueOnce([
      {
        id: "booking-1",
        startsAt: new Date("2026-07-20T12:00:00.000Z"),
        durationMin: 240,
        producerName: "Gili Studio",
        producerSlug: "gili",
        commercialSnapshot: snapshot,
      },
    ]);

    const result = await (await caller()).artist.home({ producerId });
    expect(result.nextSession).toMatchObject({
      id: "booking-1",
      productName: "4-hour Mix Session",
    });
  });

  it("returns the newest owned mix with its unread flag", async () => {
    latestMixMock.mockResolvedValueOnce([
      {
        id: "version-1",
        trackTitle: "Summer Song",
        label: "V2",
        producerName: "Gili Studio",
        producerSlug: "gili",
        projectId: "project-1",
        uploadedAt: new Date("2026-07-17T12:00:00.000Z"),
        audioUrl: "https://audio.invalid/v2.mp3",
        unread: true,
      },
    ]);

    const result = await (await caller()).artist.home({ producerId });
    expect(result.latestMix).toMatchObject({ id: "version-1", unread: true });
  });

  it("merges booking and track activity without inventing payment events", async () => {
    activityTracksMock.mockResolvedValueOnce(
      Array.from({ length: 6 }, (_, index) => ({
        id: `version-${String(index)}`,
        trackTitle: `Track ${String(index)}`,
        label: "V1",
        producerName: "Gili",
        projectId: `project-${String(index)}`,
        uploadedAt: new Date(`2026-07-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`),
      })),
    );
    activityBookingsMock.mockResolvedValueOnce(
      Array.from({ length: 6 }, (_, index) => ({
        id: `booking-${String(index)}`,
        producerName: "Gili",
        statusChangedAt: new Date(`2026-07-${String(index + 7).padStart(2, "0")}T10:00:00.000Z`),
        startsAt: new Date("2026-08-01T10:00:00.000Z"),
      })),
    );

    const result = await (await caller()).artist.home({ producerId });
    expect(result.activity).toHaveLength(10);
    expect(result.activity.every((item) => item.kind !== "invoice_paid")).toBe(true);
  });

  it("joins every project and booking to the exact stable client owner", async () => {
    await (await caller("artist-owner")).artist.home({ producerId });
    const predicates = ownerJoinSpy.mock.calls.map((call) => call[0]);
    expect(predicates).toHaveLength(5);
    expect(predicates).toContainEqual({
      and: [
        { eq: [clientContactsMarker.clerkUserId, "artist-owner"] },
        { eq: [clientContactsMarker.id, purchasesMarker.clientContactId] },
        { eq: [clientContactsMarker.producerId, purchasesMarker.producerId] },
        { isNull: clientContactsMarker.archivedAt },
      ],
    });
    expect(predicates).toContainEqual({
      and: [
        { eq: [clientContactsMarker.clerkUserId, "artist-owner"] },
        { eq: [clientContactsMarker.id, projectsMarker.clientContactId] },
        { eq: [clientContactsMarker.producerId, projectsMarker.producerId] },
        { isNull: clientContactsMarker.archivedAt },
      ],
    });
  });

  it("keeps booking-level pending payment state explicitly unavailable", async () => {
    const result = await (await caller()).artist.book.myPendingPayments();
    expect(result).toEqual({ available: false, bookings: [] });
  });
});
