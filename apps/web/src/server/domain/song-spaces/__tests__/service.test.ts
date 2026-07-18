import { describe, expect, it } from "vitest";

import {
  createPurchaseOwnedSongSpace,
  type ActiveSongSpacePurchase,
  type NewSongSpaceRecord,
  type SongSpaceAtomicRepository,
  type SongSpaceAtomicTransaction,
  SongSpaceDomainError,
  type SongSpaceRecord,
  type SongSpaceScope,
} from "../service";

class MemorySongSpaceRepository implements SongSpaceAtomicRepository, SongSpaceAtomicTransaction {
  private queue: Promise<void> = Promise.resolve();
  private sequence = 0;
  readonly purchases = new Map<string, ActiveSongSpacePurchase>();
  readonly rows: SongSpaceRecord[] = [];
  readonly touchedProjects: string[] = [];

  async atomically<T>(
    _scope: SongSpaceScope,
    work: (transaction: SongSpaceAtomicTransaction) => Promise<T>,
  ): Promise<T> {
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
      .filter(
        (row) => row.producerId === scope.producerId && row.projectId === scope.projectId,
      )
      .map((row) => row.position);
    return Promise.resolve(positions.length === 0 ? 0 : Math.max(...positions) + 1);
  }

  insertSongSpace(input: NewSongSpaceRecord): Promise<SongSpaceRecord> {
    this.sequence += 1;
    const row = { ...input, id: `song-${String(this.sequence)}` };
    this.rows.push(row);
    return Promise.resolve(row);
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

function create(repository: MemorySongSpaceRepository, title: string) {
  return createPurchaseOwnedSongSpace(repository, {
    ...scope,
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
