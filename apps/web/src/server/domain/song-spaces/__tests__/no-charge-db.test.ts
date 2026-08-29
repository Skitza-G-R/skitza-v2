import { projectTracks, projects, producers, purchases, type Db } from "@skitza/db";
import { describe, expect, it } from "vitest";

import { NO_CHARGE_IMPORTED_WORK_REASON, noChargeProposalRepository } from "../no-charge-db";
import { SongSpaceDomainError } from "../service";

class FakeSelectQuery implements PromiseLike<readonly unknown[]> {
  #table: unknown = null;

  constructor(private readonly owner: FakeNoChargeDb) {}

  from(table: unknown): this {
    this.#table = table;
    return this;
  }

  innerJoin(): this {
    return this;
  }

  where(): this {
    return this;
  }

  orderBy(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  for(): this {
    return this;
  }

  then<TResult1 = readonly unknown[], TResult2 = never>(
    onfulfilled?: ((value: readonly unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.owner.nextRowsFor(this.#table)).then(onfulfilled, onrejected);
  }
}

/**
 * Reads are answered per source table in call order, which is exactly how the
 * repository issues them: project head, product anchor, producer identity,
 * active purchases, then allocated tracks.
 */
class FakeNoChargeDb {
  readonly #queues: Map<unknown, unknown[][]>;

  constructor(entries: readonly (readonly [unknown, unknown[][]])[]) {
    this.#queues = new Map(entries.map(([table, queue]) => [table, [...queue]]));
  }

  select(): FakeSelectQuery {
    return new FakeSelectQuery(this);
  }

  transaction<T>(work: (transaction: FakeNoChargeDb) => Promise<T>): Promise<T> {
    return work(this);
  }

  nextRowsFor(table: unknown): readonly unknown[] {
    const queue = this.#queues.get(table);
    if (!queue || queue.length === 0) {
      throw new Error("Unexpected read in the no-charge repository test double");
    }
    return queue.shift() ?? [];
  }

  asDb(): Db {
    return this as unknown as Db;
  }
}

const PRODUCER_ID = "producer-owned";
const PROJECT_ID = "project-imported";
const CLIENT_CONTACT_ID = "client-owned";

function importedProjectDb(): FakeNoChargeDb {
  return new FakeNoChargeDb([
    [
      projects,
      [
        [
          {
            producerId: PRODUCER_ID,
            producerName: "North Room",
            projectId: PROJECT_ID,
            projectTitle: "Imported album",
            projectLifecycleStatus: "active",
            clientContactId: CLIENT_CONTACT_ID,
            artistClerkUserId: "artist-clerk-user",
          },
        ],
      ],
    ],
    [
      purchases,
      [
        // No product-backed anchor: imported purchases carry productId = NULL.
        [],
        // The project's only active purchase is imported existing work.
        [
          {
            purchaseId: "purchase-imported",
            sourceKind: "imported_existing_work",
            commercialSnapshot: { includedSongSpaces: 1 },
          },
        ],
      ],
    ],
    [producers, [[]]],
    [projectTracks, [[{ purchaseId: "purchase-imported" }]]],
  ]);
}

describe("no-charge proposal source on imported existing work", () => {
  it("tells the producer that imported work has no product behind it", async () => {
    const repository = noChargeProposalRepository(importedProjectDb().asDb());

    const rejection: unknown = await repository.loadForProducer(PRODUCER_ID, PROJECT_ID).then(
      (value) => value as unknown,
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(SongSpaceDomainError);
    expect((rejection as SongSpaceDomainError).code).toBe("INVALID_INPUT");
    expect((rejection as SongSpaceDomainError).message).toBe(NO_CHARGE_IMPORTED_WORK_REASON);
    expect((rejection as SongSpaceDomainError).message).toContain("Imported existing work");
  });

  it("keeps the artist-facing lookup opaque about the same project", async () => {
    const repository = noChargeProposalRepository(importedProjectDb().asDb());

    await expect(
      repository.loadForArtist(
        {
          version: 1,
          kind: "no_charge_song_space",
          producerId: PRODUCER_ID,
          projectId: PROJECT_ID,
          clientContactId: CLIENT_CONTACT_ID,
          sourceProductId: "product-missing",
          songTitle: "Extra song",
          projectTitle: "Imported album",
          sourceProductName: "Full production",
          snapshotDigest: "a".repeat(64),
          nonce: "b".repeat(64),
        },
        "artist-clerk-user",
      ),
    ).resolves.toBeNull();
  });
});
