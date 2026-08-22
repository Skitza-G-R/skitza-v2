import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  PRODUCER_ID,
  OWNED_CLIENT_ID,
  EMPTY_CLIENT_ID,
  OWNED_PROJECT_ID,
  OTHER_OWNED_PROJECT_ID,
  FOREIGN_PRODUCER_ID,
  FOREIGN_CLIENT_ID,
  FOREIGN_PROJECT_ID,
  producers,
  projects,
  bookings,
  projectTracks,
  purchases,
  purchaseRequests,
  privateOffers,
  notifications,
  trackComments,
  trackVersions,
  clientContacts,
  createDb,
  getClientMoneyLedger,
  canPermanentlyDeleteEmptyDraftClient,
  queryCounts,
  wherePredicates,
  findEqValue,
  resetDatabaseObservations,
} = vi.hoisted(() => {
  const PRODUCER_ID = "00000000-0000-4000-8000-000000000145";
  const OWNED_CLIENT_ID = "00000000-0000-4000-8000-000000000146";
  const EMPTY_CLIENT_ID = "00000000-0000-4000-8000-000000000147";
  const OWNED_PROJECT_ID = "00000000-0000-4000-8000-000000000148";
  const OTHER_OWNED_PROJECT_ID = "00000000-0000-4000-8000-000000000149";
  const FOREIGN_PRODUCER_ID = "00000000-0000-4000-8000-000000000245";
  const FOREIGN_CLIENT_ID = "00000000-0000-4000-8000-000000000246";
  const FOREIGN_PROJECT_ID = "00000000-0000-4000-8000-000000000247";

  const column = (name: string) => ({ __column: name });
  const producers = {
    __table: "producers",
    id: column("producers.id"),
    clerkUserId: column("producers.clerk_user_id"),
  };
  const projects = {
    __table: "projects",
    id: column("projects.id"),
    producerId: column("projects.producer_id"),
    title: column("projects.title"),
    lifecycleStatus: column("projects.lifecycle_status"),
    workflowStage: column("projects.workflow_stage"),
    deadlineAt: column("projects.deadline_at"),
    createdAt: column("projects.created_at"),
    updatedAt: column("projects.updated_at"),
    clientContactId: column("projects.client_contact_id"),
    clientName: column("projects.client_name"),
    clientEmail: column("projects.client_email"),
    artistName: column("projects.artist_name"),
    artistEmail: column("projects.artist_email"),
    position: column("projects.position"),
  };
  const bookings = {
    __table: "bookings",
    projectId: column("bookings.project_id"),
    producerId: column("bookings.producer_id"),
    startsAt: column("bookings.starts_at"),
    status: column("bookings.status"),
  };
  const projectTracks = {
    __table: "project_tracks",
    id: column("project_tracks.id"),
    projectId: column("project_tracks.project_id"),
  };
  const purchases = {
    __table: "purchases",
    producerId: column("purchases.producer_id"),
    projectId: column("purchases.project_id"),
  };
  const purchaseRequests = {
    __table: "purchase_requests",
    producerId: column("purchase_requests.producer_id"),
    projectId: column("purchase_requests.project_id"),
  };
  const privateOffers = {
    __table: "private_offers",
    producerId: column("private_offers.producer_id"),
    targetProjectId: column("private_offers.target_project_id"),
  };
  const notifications = {
    __table: "notifications",
    producerId: column("notifications.producer_id"),
    projectId: column("notifications.project_id"),
  };
  const trackComments = {
    __table: "track_comments",
    versionId: column("track_comments.version_id"),
    createdAt: column("track_comments.created_at"),
    resolvedAt: column("track_comments.resolved_at"),
    fromProducer: column("track_comments.from_producer"),
  };
  const trackVersions = {
    __table: "track_versions",
    id: column("track_versions.id"),
    trackId: column("track_versions.track_id"),
  };
  const clientContacts = {
    __table: "client_contacts",
    id: column("client_contacts.id"),
    producerId: column("client_contacts.producer_id"),
    email: column("client_contacts.email"),
    name: column("client_contacts.name"),
    phone: column("client_contacts.phone"),
    firstSeenAt: column("client_contacts.first_seen_at"),
    lastSeenAt: column("client_contacts.last_seen_at"),
    tags: column("client_contacts.tags"),
    notes: column("client_contacts.notes"),
    producerArchivedAt: column("client_contacts.producer_archived_at"),
    referralSource: column("client_contacts.referral_source"),
    invitedAt: column("client_contacts.invited_at"),
    clerkUserId: column("client_contacts.clerk_user_id"),
    archivedAt: column("client_contacts.archived_at"),
    position: column("client_contacts.position"),
  };

  type Predicate =
    | { operator: "eq"; left: unknown; right: unknown }
    | { operator: "and"; conditions: Predicate[] };

  function findEqValue(predicate: unknown, targetColumn: unknown): unknown {
    if (!predicate || typeof predicate !== "object") return undefined;
    const candidate = predicate as Partial<Predicate> & {
      left?: unknown;
      right?: unknown;
      conditions?: Predicate[];
    };
    if (candidate.operator === "eq" && candidate.left === targetColumn) {
      return candidate.right;
    }
    if (candidate.operator === "and" && Array.isArray(candidate.conditions)) {
      for (const condition of candidate.conditions) {
        const value = findEqValue(condition, targetColumn);
        if (value !== undefined) return value;
      }
    }
    return undefined;
  }

  const ownedProjectUpdatedAt = new Date("2026-07-25T09:00:00.000Z");
  const ownedProjectCommentAt = new Date("2026-07-27T11:30:00.000Z");
  const ownedClientFirstSeenAt = new Date("2026-06-01T08:00:00.000Z");
  const ownedClientLastSeenAt = new Date("2026-07-24T08:00:00.000Z");
  const emptyClientFirstSeenAt = new Date("2026-07-18T08:00:00.000Z");
  const emptyClientLastSeenAt = new Date("2026-07-20T08:00:00.000Z");

  const projectRows = [
    {
      producerId: PRODUCER_ID,
      id: OWNED_PROJECT_ID,
      title: "Owned album",
      lifecycleStatus: "active",
      workflowStage: "production",
      deadlineAt: new Date("2026-08-15T12:00:00.000Z"),
      createdAt: new Date("2026-06-02T09:00:00.000Z"),
      updatedAt: ownedProjectUpdatedAt,
      clientContactId: OWNED_CLIENT_ID,
      clientName: "Owned Artist",
      clientEmail: "owned@example.test",
      artistName: "Owned Artist",
      artistEmail: "owned@example.test",
      nextSessionAt: new Date("2026-08-02T15:00:00.000Z"),
      canPermanentlyDelete: false,
    },
    {
      producerId: PRODUCER_ID,
      id: OTHER_OWNED_PROJECT_ID,
      title: "Other owned project",
      lifecycleStatus: "active",
      workflowStage: "brief",
      deadlineAt: null,
      createdAt: new Date("2026-06-04T09:00:00.000Z"),
      updatedAt: new Date("2026-07-23T09:00:00.000Z"),
      clientContactId: EMPTY_CLIENT_ID,
      clientName: "Empty Draft",
      clientEmail: "empty@example.test",
      artistName: "Empty Draft",
      artistEmail: "empty@example.test",
      nextSessionAt: null,
      canPermanentlyDelete: false,
    },
    {
      producerId: FOREIGN_PRODUCER_ID,
      id: FOREIGN_PROJECT_ID,
      title: "Foreign project",
      lifecycleStatus: "active",
      workflowStage: "mixing",
      deadlineAt: null,
      createdAt: new Date("2026-06-03T09:00:00.000Z"),
      updatedAt: new Date("2026-07-26T09:00:00.000Z"),
      clientContactId: FOREIGN_CLIENT_ID,
      clientName: "Foreign Artist",
      clientEmail: "foreign@example.test",
      artistName: "Foreign Artist",
      artistEmail: "foreign@example.test",
      nextSessionAt: null,
      canPermanentlyDelete: false,
    },
  ];
  const commentRows = [
    {
      producerId: PRODUCER_ID,
      projectId: OWNED_PROJECT_ID,
      lastComment: ownedProjectCommentAt,
      unresolved: 2,
    },
    {
      producerId: FOREIGN_PRODUCER_ID,
      projectId: FOREIGN_PROJECT_ID,
      lastComment: new Date("2026-07-28T07:00:00.000Z"),
      unresolved: 99,
    },
  ];
  const contactRows = [
    {
      producerId: PRODUCER_ID,
      id: OWNED_CLIENT_ID,
      email: "owned@example.test",
      name: "Owned Artist",
      phone: "+1 555 0145",
      firstSeenAt: ownedClientFirstSeenAt,
      lastSeenAt: ownedClientLastSeenAt,
      tags: ["album"],
      notes: "Representative owned client",
      archivedAt: null,
      producerArchivedAt: null,
      referralSource: "referral",
      invitedAt: new Date("2026-06-04T08:00:00.000Z"),
      clerkUserId: "clerk_owned_artist",
    },
    {
      producerId: PRODUCER_ID,
      id: EMPTY_CLIENT_ID,
      email: "empty@example.test",
      name: "Empty Draft",
      phone: null,
      firstSeenAt: emptyClientFirstSeenAt,
      lastSeenAt: emptyClientLastSeenAt,
      tags: [],
      notes: null,
      archivedAt: null,
      producerArchivedAt: null,
      referralSource: null,
      invitedAt: null,
      clerkUserId: null,
    },
    {
      producerId: FOREIGN_PRODUCER_ID,
      id: FOREIGN_CLIENT_ID,
      email: "foreign@example.test",
      name: "Foreign Artist",
      phone: null,
      firstSeenAt: new Date("2026-06-05T08:00:00.000Z"),
      lastSeenAt: new Date("2026-07-28T08:00:00.000Z"),
      tags: ["foreign"],
      notes: "Must not leak",
      archivedAt: null,
      producerArchivedAt: null,
      referralSource: null,
      invitedAt: null,
      clerkUserId: "clerk_foreign_artist",
    },
  ];

  const queryCounts = {
    producers: 0,
    projects: 0,
    trackComments: 0,
    trackVersions: 0,
    clientContacts: 0,
  };
  const wherePredicates = {
    producers: [] as unknown[],
    projects: [] as unknown[],
    trackComments: [] as unknown[],
    trackVersions: [] as unknown[],
    clientContacts: [] as unknown[],
  };

  type QueryTable =
    | typeof producers
    | typeof projects
    | typeof trackComments
    | typeof trackVersions
    | typeof clientContacts;

  function tableKey(table: QueryTable): keyof typeof queryCounts {
    if (table === producers) return "producers";
    if (table === projects) return "projects";
    if (table === trackComments) return "trackComments";
    if (table === trackVersions) return "trackVersions";
    if (table === clientContacts) return "clientContacts";
    throw new Error("Unexpected query table");
  }

  function rowsFor(table: QueryTable, predicate: unknown): Record<string, unknown>[] {
    if (table === producers) {
      const userId = findEqValue(predicate, producers.clerkUserId);
      return userId === "user_sk145" ? [{ id: PRODUCER_ID }] : [];
    }
    if (table === trackVersions) return [{ n: 3 }];

    const producerColumn =
      table === projects
        ? projects.producerId
        : table === trackComments
          ? projects.producerId
          : clientContacts.producerId;
    const scopedProducerId = findEqValue(predicate, producerColumn);
    const candidates =
      table === projects ? projectRows : table === trackComments ? commentRows : contactRows;
    const scopedClientId =
      table === clientContacts
        ? findEqValue(predicate, clientContacts.id)
        : table === projects
          ? findEqValue(predicate, projects.clientContactId)
          : undefined;
    return candidates.filter((row) => {
      const candidateClientId =
        table === projects
          ? (row as { clientContactId?: unknown }).clientContactId
          : (row as { id?: unknown }).id;
      return (
        (scopedProducerId === undefined || row.producerId === scopedProducerId) &&
        (scopedClientId === undefined || candidateClientId === scopedClientId)
      );
    });
  }

  function queryChain(table: QueryTable) {
    let predicate: unknown;
    let result: Promise<Record<string, unknown>[]> | null = null;
    const resolve = () => {
      result ??= Promise.resolve(rowsFor(table, predicate));
      return result;
    };
    type QueryLink = {
      leftJoin: (...args: unknown[]) => QueryLink;
      innerJoin: (...args: unknown[]) => QueryLink;
      where: (value: unknown) => QueryLink;
      groupBy: (...args: unknown[]) => QueryLink;
      orderBy: (...args: unknown[]) => QueryLink;
      limit: (...args: unknown[]) => Promise<Record<string, unknown>[]>;
      then: Promise<Record<string, unknown>[]>["then"];
    };
    const link: QueryLink = {
      leftJoin: () => link,
      innerJoin: () => link,
      where: (value) => {
        predicate = value;
        wherePredicates[tableKey(table)].push(value);
        return link;
      },
      groupBy: () => link,
      orderBy: () => link,
      limit: () => resolve(),
      get then() {
        return resolve().then.bind(resolve());
      },
    };
    return link;
  }

  const dbMock = {
    select: () => ({
      from: (table: QueryTable) => {
        const key = tableKey(table);
        queryCounts[key] += 1;
        return queryChain(table);
      },
    }),
  };
  const createDb = vi.fn(() => dbMock);
  const getClientMoneyLedger = vi.fn();
  const canPermanentlyDeleteEmptyDraftClient = vi.fn();

  function resetDatabaseObservations() {
    createDb.mockClear();
    for (const key of Object.keys(queryCounts) as Array<keyof typeof queryCounts>) {
      queryCounts[key] = 0;
      wherePredicates[key].length = 0;
    }
  }

  return {
    PRODUCER_ID,
    OWNED_CLIENT_ID,
    EMPTY_CLIENT_ID,
    OWNED_PROJECT_ID,
    OTHER_OWNED_PROJECT_ID,
    FOREIGN_PRODUCER_ID,
    FOREIGN_CLIENT_ID,
    FOREIGN_PROJECT_ID,
    producers,
    projects,
    bookings,
    projectTracks,
    purchases,
    purchaseRequests,
    privateOffers,
    notifications,
    trackComments,
    trackVersions,
    clientContacts,
    createDb,
    getClientMoneyLedger,
    canPermanentlyDeleteEmptyDraftClient,
    queryCounts,
    wherePredicates,
    findEqValue,
    resetDatabaseObservations,
  };
});

vi.mock("@skitza/db", () => ({
  createDb,
  producers,
  projects,
  bookings,
  projectTracks,
  purchases,
  purchaseRequests,
  privateOffers,
  notifications,
  trackComments,
  trackVersions,
  clientContacts,
  eq: (left: unknown, right: unknown) => ({ operator: "eq", left, right }),
  and: (...conditions: unknown[]) => ({ operator: "and", conditions }),
  asc: (value: unknown) => ({ direction: "asc", value }),
  desc: (value: unknown) => ({ direction: "desc", value }),
  inArray: (left: unknown, right: unknown[]) => ({ operator: "inArray", left, right }),
  isNull: (value: unknown) => ({ operator: "isNull", value }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    { raw: (value: string) => ({ raw: value }) },
  ),
}));

vi.mock("~/server/domain/client-management/db", () => ({
  clientManagementRepository: vi.fn(),
}));
vi.mock("~/server/domain/client-invitations/db", () => ({
  clientInvitationDeliveryRepository: vi.fn(),
  loadCurrentClientInvitationStates: vi.fn(() => Promise.resolve(new Map())),
  reserveClientInvitationEmail: vi.fn(),
}));
vi.mock("~/server/domain/client-management/service", () => ({
  archiveClient: vi.fn(),
  editClient: vi.fn(),
  inviteClient: vi.fn(),
  restoreClient: vi.fn(),
  ClientManagementDomainError: class ClientManagementDomainError extends Error {},
}));
vi.mock("~/server/domain/client-money/db", () => ({
  clientMoneyRepository: vi.fn(),
}));
vi.mock("~/server/domain/client-money/service", () => ({
  getClientMoneyLedger,
  ClientMoneyDomainError: class ClientMoneyDomainError extends Error {},
}));
vi.mock("~/server/domain/history-deletion/db", () => ({
  historicalDeletionRepository: vi.fn(),
}));
vi.mock("~/server/domain/history-deletion/service", () => ({
  canPermanentlyDeleteEmptyDraftClient,
  permanentlyDeleteEmptyDraftClient: vi.fn(),
  HistoricalDeletionDomainError: class HistoricalDeletionDomainError extends Error {},
}));
vi.mock("~/server/email/send", () => ({
  SITE_URL: "https://skitza.test",
  sendClientInviteEmail: vi.fn(),
}));

import { clientContactsRouter } from "../client-contacts";

const unavailableCommercial = {
  availability: "unavailable",
  reason: "purchase_payments_projection_pending",
  currency: null,
  totalCents: null,
  outstandingCents: null,
  lifetimeCents: null,
  paidThisMonthCents: null,
} as const;

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://test.invalid/sk145";
  resetDatabaseObservations();
  getClientMoneyLedger.mockReset();
  getClientMoneyLedger.mockResolvedValue({ legacy: true });
  canPermanentlyDeleteEmptyDraftClient.mockReset();
  canPermanentlyDeleteEmptyDraftClient.mockResolvedValue(false);
});

describe("clientContacts.listWithProjects workspace runtime", () => {
  it("loads each producer-scoped input once and returns equivalent project and client views", async () => {
    const allProjectsCaller = clientContactsRouter.createCaller({ userId: "user_sk145" });
    const allProjectsResult = await allProjectsCaller.listWithProjects({
      view: "all-projects",
    });
    if (allProjectsResult.view !== "all-projects") {
      throw new Error("Expected the all-projects projection");
    }

    resetDatabaseObservations();
    const byClientCaller = clientContactsRouter.createCaller({ userId: "user_sk145" });
    const byClientResult = await byClientCaller.listWithProjects({ view: "by-client" });
    if (byClientResult.view !== "by-client") {
      throw new Error("Expected the by-client projection");
    }

    resetDatabaseObservations();
    const caller = clientContactsRouter.createCaller({ userId: "user_sk145" });
    const result = await caller.listWithProjects({ view: "workspace" });
    if (result.view !== "workspace") {
      throw new Error("Expected the combined workspace projection");
    }

    expect(createDb).toHaveBeenCalledOnce();
    expect(queryCounts).toEqual({
      producers: 1,
      projects: 1,
      trackComments: 1,
      trackVersions: 0,
      clientContacts: 1,
    });
    expect(findEqValue(wherePredicates.projects[0], projects.producerId)).toBe(PRODUCER_ID);
    expect(findEqValue(wherePredicates.trackComments[0], projects.producerId)).toBe(PRODUCER_ID);
    expect(findEqValue(wherePredicates.clientContacts[0], clientContacts.producerId)).toBe(
      PRODUCER_ID,
    );
    expect(result.projects).toEqual(allProjectsResult.projects);
    expect(result.clients).toEqual(byClientResult.clients);

    expect(result).toEqual({
      view: "workspace",
      projects: [
        {
          id: OWNED_PROJECT_ID,
          title: "Owned album",
          lifecycleStatus: "active",
          workflowStage: "production",
          deadlineAt: new Date("2026-08-15T12:00:00.000Z"),
          createdAt: new Date("2026-06-02T09:00:00.000Z"),
          updatedAt: new Date("2026-07-25T09:00:00.000Z"),
          clientContactId: OWNED_CLIENT_ID,
          clientName: "Owned Artist",
          clientEmail: "owned@example.test",
          artistName: "Owned Artist",
          artistEmail: "owned@example.test",
          commercial: unavailableCommercial,
          nextSessionAt: new Date("2026-08-02T15:00:00.000Z"),
          lastActivity: new Date("2026-07-27T11:30:00.000Z"),
          unresolvedComments: 2,
          isActive: true,
          canPermanentlyDelete: false,
          client: {
            id: OWNED_CLIENT_ID,
            email: "owned@example.test",
            name: "Owned Artist",
            phone: "+1 555 0145",
            tags: ["album"],
            notes: "Representative owned client",
            producerArchivedAt: null,
            invitedAt: null,
            providerAcceptedAt: null,
            invitationState: "connected",
            clerkUserId: "clerk_owned_artist",
          },
        },
        {
          id: OTHER_OWNED_PROJECT_ID,
          title: "Other owned project",
          lifecycleStatus: "active",
          workflowStage: "brief",
          deadlineAt: null,
          createdAt: new Date("2026-06-04T09:00:00.000Z"),
          updatedAt: new Date("2026-07-23T09:00:00.000Z"),
          clientContactId: EMPTY_CLIENT_ID,
          clientName: "Empty Draft",
          clientEmail: "empty@example.test",
          artistName: "Empty Draft",
          artistEmail: "empty@example.test",
          commercial: unavailableCommercial,
          nextSessionAt: null,
          lastActivity: new Date("2026-07-23T09:00:00.000Z"),
          unresolvedComments: 0,
          isActive: true,
          canPermanentlyDelete: false,
          client: {
            id: EMPTY_CLIENT_ID,
            email: "empty@example.test",
            name: "Empty Draft",
            phone: null,
            tags: [],
            notes: null,
            producerArchivedAt: null,
            invitedAt: null,
            providerAcceptedAt: null,
            invitationState: "available",
            clerkUserId: null,
          },
        },
      ],
      clients: [
        {
          id: OWNED_CLIENT_ID,
          email: "owned@example.test",
          name: "Owned Artist",
          firstSeenAt: new Date("2026-06-01T08:00:00.000Z"),
          lastSeenAt: new Date("2026-07-24T08:00:00.000Z"),
          tags: ["album"],
          notes: "Representative owned client",
          phone: "+1 555 0145",
          referralSource: "referral",
          producerArchivedAt: null,
          invitedAt: null,
          providerAcceptedAt: null,
          invitationState: "connected",
          clerkUserId: "clerk_owned_artist",
          activeProjectCount: 1,
          archiveBlockingProjectCount: 1,
          totalProjectCount: 1,
          commercial: unavailableCommercial,
          unresolvedComments: 2,
          lastActivity: new Date("2026-07-27T11:30:00.000Z"),
          needsAttention: true,
          isStale: false,
        },
        {
          id: EMPTY_CLIENT_ID,
          email: "empty@example.test",
          name: "Empty Draft",
          firstSeenAt: new Date("2026-07-18T08:00:00.000Z"),
          lastSeenAt: new Date("2026-07-20T08:00:00.000Z"),
          tags: [],
          notes: null,
          phone: null,
          referralSource: null,
          producerArchivedAt: null,
          invitedAt: null,
          providerAcceptedAt: null,
          invitationState: "available",
          clerkUserId: null,
          activeProjectCount: 1,
          archiveBlockingProjectCount: 1,
          totalProjectCount: 1,
          commercial: unavailableCommercial,
          unresolvedComments: 0,
          lastActivity: new Date("2026-07-23T09:00:00.000Z"),
          needsAttention: false,
          isStale: false,
        },
      ],
    });

    expect(result.projects.map((project) => project.id)).not.toContain(FOREIGN_PROJECT_ID);
    expect(result.clients.map((client) => client.id)).not.toContain(FOREIGN_CLIENT_ID);
    expect(result.projects).not.toContainEqual(
      expect.objectContaining({ clientEmail: "foreign@example.test" }),
    );
    expect(result.clients).not.toContainEqual(
      expect.objectContaining({ email: "foreign@example.test" }),
    );
    expect(FOREIGN_PRODUCER_ID).not.toBe(PRODUCER_ID);
  });

  it("keeps Client Space lean while preserving the legacy detail work", async () => {
    const caller = clientContactsRouter.createCaller({ userId: "user_sk145" });

    const leanResult = await caller.clientSpaceDetail({ id: OWNED_CLIENT_ID });

    expect(queryCounts).toEqual({
      producers: 1,
      projects: 1,
      trackComments: 0,
      trackVersions: 0,
      clientContacts: 1,
    });
    expect(getClientMoneyLedger).not.toHaveBeenCalled();
    expect(canPermanentlyDeleteEmptyDraftClient).not.toHaveBeenCalled();
    expect(leanResult).not.toHaveProperty("money");
    expect(leanResult).not.toHaveProperty("comments");
    expect(leanResult.stats).not.toHaveProperty("trackCount");
    expect(leanResult.contact.id).toBe(OWNED_CLIENT_ID);
    expect(leanResult.projects.map((project) => project.id)).toEqual([OWNED_PROJECT_ID]);
    expect(leanResult.projects.map((project) => project.id)).not.toContain(OTHER_OWNED_PROJECT_ID);
    expect(leanResult.stats).toMatchObject({
      activeProjectCount: 1,
      archiveBlockingProjectCount: 1,
      totalProjectCount: 1,
    });

    resetDatabaseObservations();
    const fullResult = await caller.detail({ id: OWNED_CLIENT_ID });

    expect(queryCounts.projects).toBe(1);
    expect(queryCounts.trackComments).toBe(1);
    expect(queryCounts.trackVersions).toBe(1);
    expect(queryCounts.clientContacts).toBe(1);
    expect(getClientMoneyLedger).toHaveBeenCalledOnce();
    expect(fullResult.money).toEqual({ legacy: true });
    expect(fullResult.stats.trackCount).toBe(3);
  });

  it("keeps foreign Client Space ids behind the producer boundary", async () => {
    const caller = clientContactsRouter.createCaller({ userId: "user_sk145" });

    await expect(caller.clientSpaceDetail({ id: FOREIGN_CLIENT_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(queryCounts.clientContacts).toBe(1);
    expect(queryCounts.projects).toBe(0);
    expect(getClientMoneyLedger).not.toHaveBeenCalled();
  });
});
