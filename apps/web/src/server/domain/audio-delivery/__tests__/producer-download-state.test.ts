import { describe, expect, it } from "vitest";

import type { AudioDeliveryContext } from "../policy";
import {
  readProducerDownloadOverrideStates,
  type ProducerDownloadStateBatchRepository,
  type ProducerDownloadStateBatchScope,
} from "../producer-download-state";
import { AUDIO_DELIVERY_IDS, makeAudioDeliveryContext } from "./fixtures";

class MemoryBatchRepository implements ProducerDownloadStateBatchRepository {
  readonly scopes: ProducerDownloadStateBatchScope[] = [];

  constructor(readonly contexts: readonly AudioDeliveryContext[]) {}

  atomically<T>(
    scope: ProducerDownloadStateBatchScope,
    work: (contexts: readonly AudioDeliveryContext[]) => Promise<T>,
  ): Promise<T> {
    this.scopes.push(scope);
    return work(this.contexts);
  }
}

function batchInput(
  overrides: Partial<ProducerDownloadStateBatchScope> = {},
): ProducerDownloadStateBatchScope {
  return {
    producerId: AUDIO_DELIVERY_IDS.producerId,
    actorClerkUserId: AUDIO_DELIVERY_IDS.producerClerkUserId,
    trackId: AUDIO_DELIVERY_IDS.songId,
    purchaseId: AUDIO_DELIVERY_IDS.purchaseId,
    versionIds: ["version-b", AUDIO_DELIVERY_IDS.versionId],
    ...overrides,
  };
}

function versionContext(
  versionId: string,
  override?: AudioDeliveryContext["latestOverride"],
): AudioDeliveryContext {
  return makeAudioDeliveryContext({
    versionId,
    latestOverride: override ?? null,
    ledgerKind: "unpaid",
  });
}

describe("SK-144 producer download-state batch service", () => {
  it("returns exact states in requested order from one atomic repository read", async () => {
    const repository = new MemoryBatchRepository([
      versionContext(AUDIO_DELIVERY_IDS.versionId),
      versionContext("version-b", {
        purchaseId: AUDIO_DELIVERY_IDS.purchaseId,
        versionId: "version-b",
        enabled: true,
        sequence: 7,
      }),
    ]);

    await expect(readProducerDownloadOverrideStates(repository, batchInput())).resolves.toEqual([
      {
        purchaseId: AUDIO_DELIVERY_IDS.purchaseId,
        versionId: "version-b",
        enabled: true,
        fullyPaid: false,
        unpaidAmountCents: 6_000,
        currency: "ILS",
        overdue: false,
        sequence: 7,
      },
      {
        purchaseId: AUDIO_DELIVERY_IDS.purchaseId,
        versionId: AUDIO_DELIVERY_IDS.versionId,
        enabled: false,
        fullyPaid: false,
        unpaidAmountCents: 6_000,
        currency: "ILS",
        overdue: false,
        sequence: 0,
      },
    ]);
    expect(repository.scopes).toEqual([batchInput()]);
  });

  it("rejects empty and duplicate normalized ids before opening a transaction", async () => {
    let atomicReads = 0;
    const repository: ProducerDownloadStateBatchRepository = {
      atomically: () => {
        atomicReads += 1;
        return Promise.reject(new Error("must not open a transaction"));
      },
    };

    await expect(
      readProducerDownloadOverrideStates(repository, batchInput({ versionIds: [] })),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      readProducerDownloadOverrideStates(
        repository,
        batchInput({ versionIds: ["version-a", " version-a "] }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(atomicReads).toBe(0);
  });

  it("fails closed on missing, duplicate, or foreign repository contexts", async () => {
    const validA = versionContext(AUDIO_DELIVERY_IDS.versionId);
    const cases: readonly (readonly AudioDeliveryContext[])[] = [
      [validA],
      [validA, validA],
      [validA, versionContext("version-c")],
      [validA, makeAudioDeliveryContext({ versionId: "version-b", songId: "song-b" })],
      [validA, makeAudioDeliveryContext({ versionId: "version-b", purchaseId: "purchase-b" })],
    ];

    for (const contexts of cases) {
      await expect(
        readProducerDownloadOverrideStates(new MemoryBatchRepository(contexts), batchInput()),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("uses existing producer ownership and commercial-ledger policy for every version", async () => {
    const versionA = versionContext(AUDIO_DELIVERY_IDS.versionId);
    const versionB = versionContext("version-b");

    await expect(
      readProducerDownloadOverrideStates(
        new MemoryBatchRepository([versionA, versionB]),
        batchInput({ actorClerkUserId: "clerk-producer-b" }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      readProducerDownloadOverrideStates(
        new MemoryBatchRepository([
          versionA,
          makeAudioDeliveryContext({ versionId: "version-b", ledger: null }),
        ]),
        batchInput(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
