import {
  clientContacts,
  type Db,
  products,
  projectTracks,
  projects,
  producers,
  purchases,
  songPublicLinks,
  trackComments,
  trackVersions,
} from "@skitza/db";
import { describe, expect, it } from "vitest";

import {
  getMusicProjectSongSpaces,
  listMusicSongSpaces,
  type MusicLibraryReadModel,
  type MusicProjectReadModel,
} from "../music-read-model";

type JoinCall = Readonly<{ table: unknown; on: unknown }>;

class FakeSelectQuery {
  table: unknown = null;
  whereExpression: unknown = null;
  readonly joins: JoinCall[] = [];
  readonly orderByExpressions: unknown[] = [];

  constructor(private readonly owner: FakeMusicDb) {}

  from(table: unknown): this {
    this.table = table;
    return this;
  }

  innerJoin(table: unknown, on: unknown): this {
    this.joins.push({ table, on });
    return this;
  }

  leftJoin(table: unknown, on: unknown): this {
    this.joins.push({ table, on });
    return this;
  }

  where(expression: unknown): this {
    this.whereExpression = expression;
    return this;
  }

  orderBy(...expressions: unknown[]): this {
    this.orderByExpressions.push(...expressions);
    return this;
  }

  then<TResult1 = readonly unknown[], TResult2 = never>(
    onfulfilled?: ((value: readonly unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.owner.rowsFor(this.table)).then(onfulfilled, onrejected);
  }
}

class FakeMusicDb {
  readonly queries: FakeSelectQuery[] = [];
  readonly transactionOptions: unknown[] = [];
  private readonly rowsByTable: Map<unknown, readonly unknown[]>;

  constructor(entries: readonly (readonly [unknown, readonly unknown[]])[]) {
    this.rowsByTable = new Map(entries);
  }

  select(): FakeSelectQuery {
    const query = new FakeSelectQuery(this);
    this.queries.push(query);
    return query;
  }

  transaction<T>(work: (transaction: FakeMusicDb) => Promise<T>, options?: unknown): Promise<T> {
    this.transactionOptions.push(options);
    return work(this);
  }

  rowsFor(table: unknown): readonly unknown[] {
    return this.rowsByTable.get(table) ?? [];
  }

  asDb(): Db {
    return this as unknown as Db;
  }
}

type SqlFacts = {
  params: unknown[];
  columns: unknown[];
  fragments: string[];
};

function collectSqlFacts(...expressions: unknown[]): SqlFacts {
  const facts: SqlFacts = { params: [], columns: [], fragments: [] };
  const seen = new Set<object>();

  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    const constructorName = value.constructor.name;

    if (constructorName === "Param") {
      facts.params.push(record.value);
      return;
    }
    if (constructorName === "StringChunk") {
      const fragments = record.value;
      if (Array.isArray(fragments)) {
        facts.fragments.push(
          ...fragments.filter((part): part is string => typeof part === "string"),
        );
      }
      return;
    }
    if (
      typeof record.name === "string" &&
      "table" in record &&
      typeof record.columnType === "string"
    ) {
      facts.columns.push(value);
      return;
    }

    const chunks = record.queryChunks;
    if (Array.isArray(chunks)) chunks.forEach(visit);
  };

  expressions.forEach(visit);
  return facts;
}

function queryFor(db: FakeMusicDb, table: unknown): FakeSelectQuery {
  const query = db.queries.find((candidate) => candidate.table === table);
  if (!query) throw new Error("Expected read-model query was not executed");
  return query;
}

function projectById(library: MusicLibraryReadModel, projectId: string): MusicProjectReadModel {
  const project = library.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error(`Expected project ${projectId} in music read model`);
  return project;
}

describe("music song-space ownership", () => {
  it("scopes a producer project lookup by both producer and project id", async () => {
    const db = new FakeMusicDb([[projects, []]]);

    await expect(
      getMusicProjectSongSpaces(
        db.asDb(),
        { kind: "producer", producerId: "producer-owned" },
        "project-owned",
      ),
    ).resolves.toBeNull();

    const query = queryFor(db, projects);
    expect(query.joins.map((join) => join.table)).toEqual([clientContacts]);
    const joinFacts = collectSqlFacts(...query.joins.map((join) => join.on));
    expect(joinFacts.columns).toEqual(
      expect.arrayContaining([
        clientContacts.id,
        projects.clientContactId,
        clientContacts.producerId,
        projects.producerId,
      ]),
    );
    const facts = collectSqlFacts(query.whereExpression);
    expect(facts.params).toEqual(expect.arrayContaining(["producer-owned", "project-owned"]));
    expect(facts.columns).toEqual(expect.arrayContaining([projects.producerId, projects.id]));
  });

  it("scopes an artist lookup through the exact active producer contact", async () => {
    const db = new FakeMusicDb([[projects, []]]);

    await expect(
      getMusicProjectSongSpaces(
        db.asDb(),
        { kind: "artist", clerkUserId: "artist-clerk-user" },
        "project-owned",
      ),
    ).resolves.toBeNull();

    const query = queryFor(db, projects);
    expect(query.joins.map((join) => join.table)).toEqual([producers, clientContacts]);

    const joinFacts = collectSqlFacts(...query.joins.map((join) => join.on));
    expect(joinFacts.params).toContain("artist-clerk-user");
    expect(joinFacts.columns).toEqual(
      expect.arrayContaining([
        producers.id,
        projects.producerId,
        clientContacts.id,
        projects.clientContactId,
        clientContacts.producerId,
        clientContacts.clerkUserId,
        clientContacts.archivedAt,
      ]),
    );
    expect(joinFacts.fragments.join(" ")).toContain("is null");

    const whereFacts = collectSqlFacts(query.whereExpression);
    expect(whereFacts.params).toEqual(
      expect.arrayContaining(["project-owned", "waiting_for_payment"]),
    );
    expect(whereFacts.columns).toEqual(
      expect.arrayContaining([projects.id, projects.lifecycleStatus]),
    );
  });

  it("does not expose producer paid-extra product choices on the artist read", async () => {
    const now = new Date("2026-07-19T08:00:00Z");
    const db = new FakeMusicDb([
      [
        projects,
        [
          {
            id: "project-artist",
            producerId: "producer-owned",
            title: "Artist project",
            partnerName: "Producer",
            lifecycleStatus: "active",
            createdAt: now,
            updatedAt: now,
          },
        ],
      ],
      [
        products,
        [
          {
            id: "product-private-to-producer-read",
            name: "Extra production",
            priceCents: 120_000,
            currency: "ILS",
          },
        ],
      ],
      [
        purchases,
        [
          {
            purchaseId: "purchase-artist",
            producerId: "producer-owned",
            projectId: "project-artist",
            lifecycleStatus: "active",
            acceptedAt: now,
            commercialEstablishedAt: now,
            productId: "product-private-to-producer-read",
            currency: "ILS",
            commercialSnapshot: { includedSongSpaces: 1 },
          },
        ],
      ],
      [projectTracks, []],
    ]);

    const result = await listMusicSongSpaces(db.asDb(), {
      kind: "artist",
      clerkUserId: "artist-clerk-user",
    });

    expect(result.projects).toEqual([]);
    expect(
      result.activeProjects.find((project) => project.id === "project-artist")?.paidExtraProducts,
    ).toEqual([]);
    expect(db.queries.some((query) => query.table === products)).toBe(false);
  });
});

describe("music song-space projection", () => {
  it("projects durable Songs without inventing rows from paid capacity or incomplete uploads", async () => {
    const createdAt = new Date("2026-07-10T08:00:00Z");
    const projectUpdatedAt = new Date("2026-07-15T08:00:00Z");
    const latestUploadedAt = new Date("2026-07-18T08:00:00Z");
    const projectRows = [
      {
        id: "project-active",
        producerId: "producer-owned",
        clientContactId: "client-active",
        artistContactId: "client-active",
        artistContactProducerId: "producer-owned",
        artistClerkUserId: "artist-active",
        artistHasProducerIdentity: false,
        artistContactArchivedAt: null,
        title: "Album project",
        partnerName: "Artist One",
        lifecycleStatus: "active",
        createdAt,
        updatedAt: projectUpdatedAt,
      },
      {
        id: "project-virtual-only",
        producerId: "producer-owned",
        clientContactId: "client-virtual",
        artistContactId: "client-virtual",
        artistContactProducerId: "producer-owned",
        artistClerkUserId: "artist-virtual",
        artistHasProducerIdentity: false,
        artistContactArchivedAt: null,
        title: "Paid single",
        partnerName: "Artist Two",
        lifecycleStatus: "active",
        createdAt,
        updatedAt: new Date("2026-07-14T08:00:00Z"),
      },
      {
        id: "project-waiting-only",
        producerId: "producer-owned",
        clientContactId: "client-waiting",
        artistContactId: "client-waiting",
        artistContactProducerId: "producer-owned",
        artistClerkUserId: "artist-waiting",
        artistHasProducerIdentity: false,
        artistContactArchivedAt: null,
        title: "Not paid yet",
        partnerName: "Artist Three",
        lifecycleStatus: "active",
        createdAt,
        updatedAt: new Date("2026-07-13T08:00:00Z"),
      },
    ];
    const purchaseRows = [
      {
        purchaseId: "purchase-active",
        producerId: "producer-owned",
        projectId: "project-active",
        clientContactId: "client-active",
        lifecycleStatus: "active",
        acceptedAt: new Date("2026-07-10T09:00:00Z"),
        commercialEstablishedAt: new Date("2026-07-10T09:00:00Z"),
        productId: "product-reusable",
        sourceProductId: "product-reusable",
        sourceProductProducerId: "producer-owned",
        currency: "ILS",
        commercialSnapshot: { includedSongSpaces: 3 },
      },
      {
        purchaseId: "purchase-waiting-extra",
        producerId: "producer-owned",
        projectId: "project-active",
        clientContactId: "client-active",
        lifecycleStatus: "waiting_for_payment",
        acceptedAt: new Date("2026-07-11T09:00:00Z"),
        commercialEstablishedAt: new Date("2026-07-11T09:00:00Z"),
        commercialSnapshot: { includedSongSpaces: 2 },
      },
      {
        purchaseId: "purchase-canceled-extra",
        producerId: "producer-owned",
        projectId: "project-active",
        clientContactId: "client-active",
        lifecycleStatus: "canceled",
        acceptedAt: new Date("2026-07-12T09:00:00Z"),
        commercialEstablishedAt: new Date("2026-07-12T09:00:00Z"),
        commercialSnapshot: { includedSongSpaces: 2 },
      },
      {
        purchaseId: "purchase-virtual",
        producerId: "producer-owned",
        projectId: "project-virtual-only",
        clientContactId: "client-virtual",
        lifecycleStatus: "active",
        acceptedAt: new Date("2026-07-10T10:00:00Z"),
        commercialEstablishedAt: new Date("2026-07-10T10:00:00Z"),
        commercialSnapshot: { includedSongSpaces: 1 },
      },
      {
        purchaseId: "purchase-waiting-only",
        producerId: "producer-owned",
        projectId: "project-waiting-only",
        clientContactId: "client-waiting",
        lifecycleStatus: "waiting_for_payment",
        acceptedAt: new Date("2026-07-10T11:00:00Z"),
        commercialEstablishedAt: new Date("2026-07-10T11:00:00Z"),
        commercialSnapshot: { includedSongSpaces: 4 },
      },
    ];
    const trackRows = [
      {
        id: "track-versioned",
        projectId: "project-active",
        purchaseId: "purchase-active",
        title: "Versioned song",
        artist: "Artist One",
        position: 0,
        archivedAt: null,
        releasedAt: new Date("2026-07-18T12:00:00Z"),
        portfolioPublishedAt: new Date("2026-07-18T13:00:00Z"),
        createdAt,
      },
      {
        id: "track-zero-version",
        projectId: "project-active",
        purchaseId: "purchase-active",
        title: "Song before audio",
        artist: "Artist One",
        position: 1,
        archivedAt: new Date("2026-07-18T10:00:00Z"),
        releasedAt: null,
        portfolioPublishedAt: null,
        createdAt,
      },
      {
        id: "track-from-canceled-purchase",
        projectId: "project-active",
        purchaseId: "purchase-canceled-extra",
        title: "Preserved purchased song",
        artist: "Artist One",
        position: 2,
        archivedAt: null,
        releasedAt: null,
        portfolioPublishedAt: null,
        createdAt,
      },
    ];
    const versionRows = [
      {
        id: "version-pending-newer",
        trackId: "track-versioned",
        label: "v3 pending",
        audioUrl: null,
        audioDeletedAt: null,
        durationMs: null,
        uploadedAt: new Date("2026-07-19T08:00:00Z"),
      },
      {
        id: "version-deleted-newest",
        trackId: "track-versioned",
        label: "V3 deleted",
        audioUrl: "https://audio.invalid/deleted.wav",
        audioDeletedAt: new Date("2026-07-19T07:30:00Z"),
        durationMs: 130_000,
        uploadedAt: new Date("2026-07-19T07:00:00Z"),
      },
      {
        id: "version-new",
        trackId: "track-versioned",
        label: "v2",
        audioUrl: "https://audio.invalid/new.wav",
        audioDeletedAt: null,
        durationMs: 125_000,
        uploadedAt: latestUploadedAt,
      },
      {
        id: "version-old",
        trackId: "track-versioned",
        label: "v1",
        audioUrl: "https://audio.invalid/old.wav",
        audioDeletedAt: null,
        durationMs: 120_000,
        uploadedAt: new Date("2026-07-16T08:00:00Z"),
      },
      {
        id: "version-deleted-only",
        trackId: "track-zero-version",
        label: "V1 deleted",
        audioUrl: "https://audio.invalid/deleted-only.wav",
        audioDeletedAt: new Date("2026-07-18T10:30:00Z"),
        durationMs: 90_000,
        uploadedAt: new Date("2026-07-17T08:00:00Z"),
      },
    ];
    const db = new FakeMusicDb([
      [projects, projectRows],
      [
        products,
        [
          {
            id: "product-extra-one",
            name: "Extra production",
            priceCents: 120_000,
            currency: "ILS",
          },
          {
            id: "product-extra-two",
            name: "Mixing add-on",
            priceCents: 80_000,
            currency: "ILS",
          },
        ],
      ],
      [purchases, purchaseRows],
      [projectTracks, trackRows],
      [songPublicLinks, [{ trackId: "track-versioned" }]],
      [trackVersions, versionRows],
      [
        trackComments,
        [
          { versionId: "version-new" },
          { versionId: "version-new" },
          { versionId: "version-deleted-only" },
        ],
      ],
    ]);

    const result = await listMusicSongSpaces(db.asDb(), {
      kind: "producer",
      producerId: "producer-owned",
    });

    expect(result.projects.map((project) => project.id)).toEqual(["project-active"]);
    expect(result.activeProjects.map((project) => project.id)).toEqual([
      "project-active",
      "project-virtual-only",
      "project-waiting-only",
    ]);
    expect(result.uploadableProjects.map((project) => project.id)).toEqual([
      "project-active",
      "project-virtual-only",
    ]);

    const album = projectById(result, "project-active");
    expect(album.visibleCount).toBe(4);
    expect(album.mode).toBe("album");
    expect(album.noChargeAvailable).toBe(false);
    expect(album.noChargeUnavailableReason).toContain("existing purchased song space");
    expect(album.paidExtraProducts).toEqual([
      {
        id: "product-extra-one",
        name: "Extra production",
        priceCents: 120_000,
        currency: "ILS",
      },
      {
        id: "product-extra-two",
        name: "Mixing add-on",
        priceCents: 80_000,
        currency: "ILS",
      },
    ]);
    expect(album.latestActivityAt).toEqual(latestUploadedAt);
    expect(album.songs.map((song) => song.id)).toEqual(["track-versioned", "track-zero-version"]);
    expect(album.emptySlots).toEqual([
      {
        id: "virtual:purchase-active:3",
        kind: "empty",
        purchaseId: "purchase-active",
        slotNumber: 3,
        label: "Song 3",
        title: "Song 3",
      },
    ]);

    const latestSong = album.songs[0];
    expect(latestSong?.latestVersion).toMatchObject({
      id: "version-new",
      label: "v2",
      audioUrl: "https://audio.invalid/new.wav",
    });
    expect(latestSong?.latestHistoryVersion).toMatchObject({
      id: "version-deleted-newest",
      label: "V3 deleted",
      audioDeletedAt: new Date("2026-07-19T07:30:00Z"),
    });
    expect(latestSong?.unreadComments).toBe(2);
    expect(latestSong?.purchaseLifecycleStatus).toBe("active");
    expect(latestSong?.archivedAt).toBeNull();
    expect(latestSong?.releasedAt).toEqual(new Date("2026-07-18T12:00:00Z"));
    expect(latestSong?.versionCount).toBe(3);
    expect(latestSong?.publicExposure).toBe("link_and_portfolio");

    const zeroVersionSong = album.songs[1];
    expect(zeroVersionSong?.latestVersion).toBeNull();
    expect(zeroVersionSong?.latestHistoryVersion).toMatchObject({
      id: "version-deleted-only",
      label: "V1 deleted",
    });
    expect(zeroVersionSong?.unreadComments).toBe(1);
    expect(zeroVersionSong?.archivedAt).toEqual(new Date("2026-07-18T10:00:00Z"));
    expect(zeroVersionSong?.versionCount).toBe(1);
    expect(zeroVersionSong?.publicExposure).toBe("none");

    const paidSingle = result.activeProjects.find(
      (project) => project.id === "project-virtual-only",
    );
    if (!paidSingle) throw new Error("Expected active upload destination");
    expect(result.projects.some((project) => project.id === paidSingle.id)).toBe(false);
    expect(paidSingle.songs).toEqual([]);
    expect(paidSingle.visibleCount).toBe(1);
    expect(paidSingle.mode).toBe("single");
    expect(paidSingle.noChargeAvailable).toBe(false);
    expect(paidSingle.noChargeUnavailableReason).toContain("product-backed");
    expect(paidSingle.paidExtraProducts).toEqual(album.paidExtraProducts);
    expect(paidSingle.emptySlots).toHaveLength(1);
    const emptySlot = paidSingle.emptySlots[0];
    expect(emptySlot).toMatchObject({
      id: "virtual:purchase-virtual:1",
      kind: "empty",
      title: "Song 1",
    });
    expect(emptySlot).not.toHaveProperty("trackId");
    expect(emptySlot).not.toHaveProperty("latestVersion");
    expect(emptySlot).not.toHaveProperty("audioUrl");

    // Waiting/canceled purchases retain commercial accounting but contribute
    // neither Library rows nor unused active capacity.
    expect(result.projects.some((project) => project.id === "project-waiting-only")).toBe(false);
    expect(album.songs.some((song) => song.id === "track-from-canceled-purchase")).toBe(false);
    expect(album.emptySlots.some((slot) => slot.purchaseId === "purchase-waiting-extra")).toBe(
      false,
    );
    expect(album.emptySlots.some((slot) => slot.purchaseId === "purchase-canceled-extra")).toBe(
      false,
    );

    const versionQuery = queryFor(db, trackVersions);
    const orderFacts = collectSqlFacts(...versionQuery.orderByExpressions);
    expect(orderFacts.columns).toEqual(
      expect.arrayContaining([trackVersions.uploadedAt, trackVersions.id]),
    );
    expect(orderFacts.fragments.filter((fragment) => fragment.includes("desc"))).toHaveLength(2);
    const versionWhereFacts = collectSqlFacts(versionQuery.whereExpression);
    expect(versionWhereFacts.params).toContain("producer-owned");
    expect(versionWhereFacts.columns).toEqual(
      expect.arrayContaining([
        trackVersions.producerId,
        trackVersions.audioDeletedAt,
        trackVersions.audioUrl,
      ]),
    );
    expect(db.transactionOptions).toEqual([
      { isolationLevel: "repeatable read", accessMode: "read only" },
    ]);

    const paidExtraQuery = queryFor(db, products);
    const paidExtraWhere = collectSqlFacts(paidExtraQuery.whereExpression);
    expect(paidExtraWhere.params).toEqual(
      expect.arrayContaining(["producer-owned", true, "per_song", 0]),
    );
    expect(paidExtraWhere.columns).toEqual(
      expect.arrayContaining([
        products.producerId,
        products.active,
        products.archivedAt,
        products.pricingModel,
        products.priceCents,
      ]),
    );
    const paidExtraOrder = collectSqlFacts(...paidExtraQuery.orderByExpressions);
    expect(paidExtraOrder.columns).toEqual(
      expect.arrayContaining([products.position, products.id]),
    );

    const purchaseQuery = queryFor(db, purchases);
    expect(purchaseQuery.joins.map((join) => join.table)).toEqual([products]);
    const purchaseJoin = collectSqlFacts(...purchaseQuery.joins.map((join) => join.on));
    expect(purchaseJoin.columns).toEqual(
      expect.arrayContaining([
        products.id,
        products.producerId,
        purchases.productId,
        purchases.producerId,
      ]),
    );
  });

  it.each([
    {
      name: "an exact active same-client product-backed ILS source",
      head: {},
      purchase: {},
      available: true,
      reason: null,
    },
    {
      name: "a non-active project",
      head: { lifecycleStatus: "completed" },
      purchase: {},
      available: false,
      reason: "active projects",
    },
    {
      name: "a missing linked artist contact",
      head: { artistContactId: null },
      purchase: {},
      available: false,
      reason: "signed-in artist",
    },
    {
      name: "a contact owned by another producer",
      head: { artistContactProducerId: "producer-foreign" },
      purchase: {},
      available: false,
      reason: "signed-in artist",
    },
    {
      name: "an archived artist contact",
      head: { artistContactArchivedAt: new Date("2026-07-18T08:00:00Z") },
      purchase: {},
      available: false,
      reason: "signed-in artist",
    },
    {
      name: "an empty Clerk artist identity",
      head: { artistClerkUserId: "  " },
      purchase: {},
      available: false,
      reason: "signed-in artist",
    },
    {
      name: "an artist Clerk identity that also belongs to a producer",
      head: { artistHasProducerIdentity: true },
      purchase: {},
      available: false,
      reason: "producer identity",
    },
    {
      name: "a purchase that is not active",
      head: {},
      purchase: { lifecycleStatus: "waiting_for_payment" },
      available: false,
      reason: "active ILS product-backed",
    },
    {
      name: "a non-ILS purchase",
      head: {},
      purchase: { currency: "USD" },
      available: false,
      reason: "active ILS product-backed",
    },
    {
      name: "a purchase for a different client",
      head: {},
      purchase: { clientContactId: "client-foreign" },
      available: false,
      reason: "active ILS product-backed",
    },
    {
      name: "all-null source provenance",
      head: {},
      purchase: {
        productId: null,
        sourceProductId: null,
        sourceProductProducerId: null,
      },
      available: false,
      reason: "active ILS product-backed",
    },
    {
      name: "a missing source product",
      head: {},
      purchase: { sourceProductId: null },
      available: false,
      reason: "active ILS product-backed",
    },
    {
      name: "a source product owned by another producer",
      head: {},
      purchase: { sourceProductProducerId: "producer-foreign" },
      available: false,
      reason: "active ILS product-backed",
    },
    {
      name: "an unused active purchased song space",
      head: {},
      purchase: { commercialSnapshot: { includedSongSpaces: 2 } },
      available: false,
      reason: "existing purchased song space",
    },
  ] as const)(
    "derives no-charge availability from $name",
    async ({ head: headOverrides, purchase: purchaseOverrides, available, reason }) => {
      const now = new Date("2026-07-19T08:00:00Z");
      const projectRow = {
        id: "project-eligibility",
        producerId: "producer-owned",
        clientContactId: "client-owned",
        artistContactId: "client-owned",
        artistContactProducerId: "producer-owned",
        artistClerkUserId: "artist-clerk-user",
        artistHasProducerIdentity: false,
        artistContactArchivedAt: null,
        title: "Eligibility project",
        partnerName: "Artist",
        lifecycleStatus: "active",
        createdAt: now,
        updatedAt: now,
        ...headOverrides,
      };
      const purchaseRow = {
        purchaseId: "purchase-eligibility",
        producerId: "producer-owned",
        projectId: "project-eligibility",
        clientContactId: "client-owned",
        lifecycleStatus: "active",
        acceptedAt: now,
        commercialEstablishedAt: now,
        productId: "product-source",
        sourceProductId: "product-source",
        sourceProductProducerId: "producer-owned",
        currency: "ILS",
        commercialSnapshot: { includedSongSpaces: 1 },
        ...purchaseOverrides,
      };
      const db = new FakeMusicDb([
        [projects, [projectRow]],
        [products, []],
        [purchases, [purchaseRow]],
        [
          projectTracks,
          [
            {
              id: "track-eligibility",
              projectId: "project-eligibility",
              purchaseId: "purchase-eligibility",
              title: "Existing purchased song",
              artist: "Artist",
              position: 0,
              createdAt: now,
            },
          ],
        ],
        [
          trackVersions,
          [
            {
              id: "version-eligibility",
              trackId: "track-eligibility",
              label: "V1",
              audioUrl: "https://audio.invalid/eligibility.wav",
              audioDeletedAt: null,
              durationMs: 90_000,
              uploadedAt: now,
            },
          ],
        ],
      ]);

      const result = await listMusicSongSpaces(db.asDb(), {
        kind: "producer",
        producerId: "producer-owned",
      });
      const project = [...result.projects, ...result.activeProjects].find(
        (candidate) => candidate.id === "project-eligibility",
      );
      if (!project) throw new Error("Expected eligibility project in music read model");

      expect(project.noChargeAvailable).toBe(available);
      if (reason === null) {
        expect(project.noChargeUnavailableReason).toBeNull();
      } else {
        expect(project.noChargeUnavailableReason).toContain(reason);
      }
    },
  );
});
