import { describe, expect, it } from "vitest";

import {
  createPurchaseOwnedSongSpace,
  type ActiveSongSpacePurchase,
  type SongSpaceAllocationScope,
  type SongSpaceAtomicRepository,
  type SongSpaceAtomicTransaction,
  SongSpaceDomainError,
  type SongSpaceRecord,
  type SongSpaceScope,
  summarizeProjectSongSpaces,
} from "../service";

class MemorySongSpaceRepository implements SongSpaceAtomicRepository, SongSpaceAtomicTransaction {
  private queue: Promise<void> = Promise.resolve();
  readonly atomicScopes: SongSpaceAllocationScope[] = [];
  readonly purchases = new Map<string, ActiveSongSpacePurchase>();
  readonly rows: SongSpaceRecord[] = [];
  readonly touchedProjects: string[] = [];

  async atomically<T>(
    allocationScope: SongSpaceAllocationScope,
    work: (transaction: SongSpaceAtomicTransaction) => Promise<T>,
  ): Promise<T> {
    this.atomicScopes.push(allocationScope);
    const previous = this.queue;
    let release = (): void => undefined;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work(this);
    } finally {
      release();
    }
  }

  findSongSpaceByIdForUpdate(id: string): Promise<SongSpaceRecord | null> {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }

  getActivePurchaseForUpdate(scope: SongSpaceScope): Promise<ActiveSongSpacePurchase | null> {
    const purchase = this.purchases.get(scope.purchaseId);
    return Promise.resolve(
      purchase?.producerId === scope.producerId && purchase.projectId === scope.projectId
        ? purchase
        : null,
    );
  }

  countPurchaseOwnedSongSpaces(scope: SongSpaceScope): Promise<number> {
    return Promise.resolve(
      this.rows.filter(
        (row) =>
          row.producerId === scope.producerId &&
          row.projectId === scope.projectId &&
          row.purchaseId === scope.purchaseId,
      ).length,
    );
  }

  nextProjectPositionForUpdate(scope: SongSpaceScope): Promise<number> {
    const positions = this.rows
      .filter((row) => row.producerId === scope.producerId && row.projectId === scope.projectId)
      .map((row) => row.position);
    return Promise.resolve(positions.length === 0 ? 0 : Math.max(...positions) + 1);
  }

  insertSongSpace(input: SongSpaceRecord): Promise<SongSpaceRecord> {
    if (this.rows.some((row) => row.id === input.id)) {
      throw new Error(`duplicate key value violates unique constraint: ${input.id}`);
    }
    this.rows.push(input);
    return Promise.resolve(input);
  }

  touchProject(scope: SongSpaceScope): Promise<void> {
    this.touchedProjects.push(`${scope.producerId}:${scope.projectId}`);
    return Promise.resolve();
  }
}

const scope = {
  producerId: "producer-1",
  projectId: "project-1",
  purchaseId: "purchase-1",
};

function seedPurchase(repository: MemorySongSpaceRepository, includedSongSpaces: number): void {
  repository.purchases.set(scope.purchaseId, {
    ...scope,
    lifecycleStatus: "active",
    projectLifecycleStatus: "active",
    includedSongSpaces,
  } as ActiveSongSpacePurchase);
}

function create(
  repository: MemorySongSpaceRepository,
  title: string,
  operationKey = `allocate-${title}`,
) {
  return createPurchaseOwnedSongSpace(repository, {
    ...scope,
    operationKey,
    title,
    createdAt: new Date("2026-07-17T10:00:00Z"),
  });
}

describe("purchase-owned song-space allocation", () => {
  it("serializes concurrent additions so a one-space purchase cannot oversubscribe", async () => {
    const repository = new MemorySongSpaceRepository();
    seedPurchase(repository, 1);

    const results = await Promise.allSettled([
      create(repository, "Song A"),
      create(repository, "Song B"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "CAPACITY_EXCEEDED" }) as unknown,
    });
    expect(repository.rows).toHaveLength(1);
  });

  it("allocates deterministic project-wide positions under concurrent calls", async () => {
    const repository = new MemorySongSpaceRepository();
    seedPurchase(repository, 2);

    const [first, second] = await Promise.all([
      create(repository, "Song A"),
      create(repository, "Song B"),
    ]);

    expect([first.position, second.position]).toEqual([0, 1]);
    expect(repository.rows.map((row) => row.position)).toEqual([0, 1]);
  });

  it("replays one concurrent operation without consuming a second purchased space", async () => {
    const repository = new MemorySongSpaceRepository();
    seedPurchase(repository, 2);

    const [first, replay] = await Promise.all([
      create(repository, "Song A", "same-request"),
      create(repository, "Song A", "same-request"),
    ]);

    expect(first.id).toBe(replay.id);
    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(repository.rows).toHaveLength(1);
    expect(repository.touchedProjects).toHaveLength(1);
  });

  it("returns the original allocation when mutable song details changed before a replay", async () => {
    const repository = new MemorySongSpaceRepository();
    seedPurchase(repository, 2);
    const first = await create(repository, "Song A", "mutable-details-retry");
    repository.rows[0] = { ...first, title: "Renamed later", artist: "Featured later" };

    const replay = await create(repository, "Original request title", "mutable-details-retry");

    expect(replay).toEqual(repository.rows[0]);
    expect(repository.rows).toHaveLength(1);
  });

  it("rejects retargeting one operation key to another purchased entitlement", async () => {
    const repository = new MemorySongSpaceRepository();
    seedPurchase(repository, 1);
    await create(repository, "Song A", "retargeted-request");
    repository.purchases.set("purchase-2", {
      ...scope,
      purchaseId: "purchase-2",
      lifecycleStatus: "active",
      projectLifecycleStatus: "active",
      includedSongSpaces: 1,
    });

    await expect(
      createPurchaseOwnedSongSpace(repository, {
        ...scope,
        purchaseId: "purchase-2",
        operationKey: "retargeted-request",
        title: "Song A",
        createdAt: new Date("2026-07-17T10:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
    expect(repository.rows).toHaveLength(1);
  });

  it("serializes concurrent cross-project reuse before lookup and returns a domain conflict", async () => {
    const repository = new MemorySongSpaceRepository();
    seedPurchase(repository, 1);
    const otherScope = {
      producerId: scope.producerId,
      projectId: "project-2",
      purchaseId: "purchase-2",
    };
    repository.purchases.set(otherScope.purchaseId, {
      ...otherScope,
      lifecycleStatus: "active",
      projectLifecycleStatus: "active",
      includedSongSpaces: 1,
    });

    const operationKey = "cross-project-concurrent-request";
    const results = await Promise.allSettled([
      create(repository, "Project one song", operationKey),
      createPurchaseOwnedSongSpace(repository, {
        ...otherScope,
        operationKey,
        title: "Project two song",
        createdAt: new Date("2026-07-17T10:00:00Z"),
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "OPERATION_KEY_CONFLICT" }) as unknown,
    });
    expect(repository.rows).toHaveLength(1);
    expect(repository.atomicScopes).toHaveLength(2);
    expect(repository.atomicScopes[0]?.songSpaceId).toBe(repository.atomicScopes[1]?.songSpaceId);
    expect(repository.atomicScopes.map((entry) => entry.operationKey)).toEqual([
      operationKey,
      operationKey,
    ]);
  });

  it("replays a completed operation after the project is no longer active", async () => {
    const repository = new MemorySongSpaceRepository();
    seedPurchase(repository, 1);
    const first = await create(repository, "Song A", "completed-retry");
    repository.purchases.set(scope.purchaseId, {
      ...scope,
      lifecycleStatus: "active",
      projectLifecycleStatus: "completed",
      includedSongSpaces: 1,
    });

    const replay = await create(repository, "Song A", "completed-retry");

    expect(replay).toEqual(first);
    expect(repository.rows).toHaveLength(1);
    expect(repository.touchedProjects).toHaveLength(1);
  });

  it("counts capacity per purchase but positions across the whole project", async () => {
    const repository = new MemorySongSpaceRepository();
    seedPurchase(repository, 1);
    repository.rows.push({
      id: "song-existing",
      producerId: scope.producerId,
      projectId: scope.projectId,
      purchaseId: "purchase-other",
      title: "Earlier song",
      artist: null,
      position: 4,
    });

    const created = await create(repository, "New purchase song");

    expect(created.position).toBe(5);
    expect(created.purchaseId).toBe(scope.purchaseId);
  });

  it("fails closed when producer, project, or purchase ownership does not match", async () => {
    const repository = new MemorySongSpaceRepository();
    seedPurchase(repository, 1);

    await expect(
      createPurchaseOwnedSongSpace(repository, {
        ...scope,
        producerId: "producer-2",
        operationKey: "foreign-request",
        title: "Foreign song",
        createdAt: new Date("2026-07-17T10:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(SongSpaceDomainError);
    expect(repository.rows).toHaveLength(0);
  });

  it("fails closed when the locked purchase is not active", async () => {
    const repository = new MemorySongSpaceRepository();
    repository.purchases.set(scope.purchaseId, {
      ...scope,
      lifecycleStatus: "waiting_for_payment",
      projectLifecycleStatus: "active",
      includedSongSpaces: 1,
    } as ActiveSongSpacePurchase);

    await expect(create(repository, "Too early")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(repository.rows).toHaveLength(0);
    expect(repository.touchedProjects).toHaveLength(0);
  });

  it.each(["paused", "completed", "canceled"] as const)(
    "fails closed when the locked project is %s",
    async (projectLifecycleStatus) => {
      const repository = new MemorySongSpaceRepository();
      repository.purchases.set(scope.purchaseId, {
        ...scope,
        lifecycleStatus: "active",
        projectLifecycleStatus,
        includedSongSpaces: 1,
      } as ActiveSongSpacePurchase);

      await expect(create(repository, "Blocked by project lifecycle")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(repository.rows).toHaveLength(0);
      expect(repository.touchedProjects).toHaveLength(0);
    },
  );

  it("rejects zero capacity without inserting or touching the project", async () => {
    const repository = new MemorySongSpaceRepository();
    seedPurchase(repository, 0);

    await expect(create(repository, "No capacity")).rejects.toMatchObject({
      code: "CAPACITY_EXCEEDED",
    });
    expect(repository.rows).toHaveLength(0);
    expect(repository.touchedProjects).toHaveLength(0);
  });
});

const summaryScope = {
  producerId: "producer-1",
  projectId: "project-1",
};

type SummaryPurchase = {
  producerId: string;
  projectId: string;
  purchaseId: string;
  lifecycleStatus: "waiting_for_payment" | "active" | "canceled";
  includedSongSpaces: number;
  acceptedAt: Date;
};

function summaryPurchase(overrides: Partial<SummaryPurchase> = {}): SummaryPurchase {
  return {
    ...summaryScope,
    purchaseId: "purchase-1",
    lifecycleStatus: "active",
    includedSongSpaces: 1,
    acceptedAt: new Date("2026-07-17T10:00:00Z"),
    ...overrides,
  };
}

function summaryTrack(
  overrides: Partial<SongSpaceRecord> & Pick<SongSpaceRecord, "id" | "purchaseId" | "position">,
): SongSpaceRecord {
  return {
    ...summaryScope,
    title: `Track ${overrides.id}`,
    artist: null,
    ...overrides,
  };
}

describe("project song-space read model", () => {
  it("preserves every purchased track while exposing only active remaining capacity virtually", () => {
    const tracks = [
      summaryTrack({ id: "track-active", purchaseId: "purchase-a", position: 0 }),
      summaryTrack({ id: "track-waiting", purchaseId: "purchase-waiting", position: 1 }),
      summaryTrack({ id: "track-canceled", purchaseId: "purchase-canceled", position: 2 }),
    ];

    const result = summarizeProjectSongSpaces({
      ...summaryScope,
      purchases: [
        summaryPurchase({
          purchaseId: "purchase-b",
          includedSongSpaces: 1,
          acceptedAt: new Date("2026-07-17T11:00:00Z"),
        }),
        summaryPurchase({
          purchaseId: "purchase-waiting",
          lifecycleStatus: "waiting_for_payment",
          includedSongSpaces: 4,
          acceptedAt: new Date("2026-07-17T08:00:00Z"),
        }),
        summaryPurchase({
          purchaseId: "purchase-a",
          includedSongSpaces: 3,
          acceptedAt: new Date("2026-07-17T09:00:00Z"),
        }),
        summaryPurchase({
          purchaseId: "purchase-canceled",
          lifecycleStatus: "canceled",
          includedSongSpaces: 2,
          acceptedAt: new Date("2026-07-17T07:00:00Z"),
        }),
      ],
      tracks,
    });

    expect(result.tracks).toEqual(tracks);
    expect(result.emptySlots).toEqual([
      {
        id: "virtual:purchase-a:2",
        kind: "empty",
        purchaseId: "purchase-a",
        slotNumber: 2,
        label: "Song 2",
      },
      {
        id: "virtual:purchase-a:3",
        kind: "empty",
        purchaseId: "purchase-a",
        slotNumber: 3,
        label: "Song 3",
      },
      {
        id: "virtual:purchase-b:1",
        kind: "empty",
        purchaseId: "purchase-b",
        slotNumber: 1,
        label: "Song 1",
      },
    ]);
    expect(result.visibleCount).toBe(6);
    expect(result.mode).toBe("album");
  });

  it.each([
    {
      name: "one allocated track",
      purchases: [summaryPurchase({ includedSongSpaces: 1 })],
      tracks: [summaryTrack({ id: "track-1", purchaseId: "purchase-1", position: 0 })],
      expectedMode: "single",
    },
    {
      name: "one virtual space without a precreated track",
      purchases: [summaryPurchase({ includedSongSpaces: 1 })],
      tracks: [],
      expectedMode: "single",
    },
    {
      name: "two virtual spaces without precreated tracks",
      purchases: [summaryPurchase({ includedSongSpaces: 2 })],
      tracks: [],
      expectedMode: "album",
    },
  ] as const)("derives $expectedMode mode from $name", ({ purchases, tracks, expectedMode }) => {
    const result = summarizeProjectSongSpaces({ ...summaryScope, purchases, tracks });

    expect(result.visibleCount).toBe(tracks.length + result.emptySlots.length);
    expect(result.mode).toBe(expectedMode);
  });

  it("orders same-time purchases by id and produces stable slot ids and labels", () => {
    const purchases = [
      summaryPurchase({
        purchaseId: "purchase-z",
        includedSongSpaces: 1,
      }),
      summaryPurchase({
        purchaseId: "purchase-a",
        includedSongSpaces: 2,
      }),
    ];
    const tracks = [summaryTrack({ id: "track-a", purchaseId: "purchase-a", position: 0 })];
    const input = { ...summaryScope, purchases, tracks };

    const first = summarizeProjectSongSpaces(input);
    const second = summarizeProjectSongSpaces(input);

    expect(first.emptySlots).toEqual([
      {
        id: "virtual:purchase-a:2",
        kind: "empty",
        purchaseId: "purchase-a",
        slotNumber: 2,
        label: "Song 2",
      },
      {
        id: "virtual:purchase-z:1",
        kind: "empty",
        purchaseId: "purchase-z",
        slotNumber: 1,
        label: "Song 1",
      },
    ]);
    expect(second.emptySlots).toEqual(first.emptySlots);
  });

  it.each([
    {
      name: "purchase producer",
      purchases: [summaryPurchase({ producerId: "producer-2" })],
      tracks: [],
    },
    {
      name: "purchase project",
      purchases: [summaryPurchase({ projectId: "project-2" })],
      tracks: [],
    },
    {
      name: "track producer",
      purchases: [summaryPurchase()],
      tracks: [
        summaryTrack({
          id: "foreign-track",
          producerId: "producer-2",
          purchaseId: "purchase-1",
          position: 0,
        }),
      ],
    },
    {
      name: "track project",
      purchases: [summaryPurchase()],
      tracks: [
        summaryTrack({
          id: "foreign-track",
          projectId: "project-2",
          purchaseId: "purchase-1",
          position: 0,
        }),
      ],
    },
  ])("fails closed on a mismatched $name", ({ purchases, tracks }) => {
    expect(() => summarizeProjectSongSpaces({ ...summaryScope, purchases, tracks })).toThrow(
      expect.objectContaining({ code: "INTEGRITY_ERROR" }),
    );
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "fails closed on invalid included capacity %s",
    (includedSongSpaces) => {
      expect(() =>
        summarizeProjectSongSpaces({
          ...summaryScope,
          purchases: [summaryPurchase({ includedSongSpaces })],
          tracks: [],
        }),
      ).toThrow(expect.objectContaining({ code: "INTEGRITY_ERROR" }));
    },
  );

  it("fails closed instead of hiding an allocation count above purchased capacity", () => {
    expect(() =>
      summarizeProjectSongSpaces({
        ...summaryScope,
        purchases: [summaryPurchase({ includedSongSpaces: 1 })],
        tracks: [
          summaryTrack({ id: "track-1", purchaseId: "purchase-1", position: 0 }),
          summaryTrack({ id: "track-2", purchaseId: "purchase-1", position: 1 }),
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "INTEGRITY_ERROR" }));
  });
});
