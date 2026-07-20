import { describe, expect, it, vi } from "vitest";

import type { AudioDeliveryContext } from "../policy";
import {
  deliverArtistDownload,
  deliverPrivateStream,
  deliverProducerDownload,
  readDownloadOverrideState,
  setDownloadOverride,
  type AudioDeliveryRepository,
  type AudioDeliveryScope,
  type AudioDeliveryTransaction,
  type DownloadOverrideEvent,
  type NewDownloadOverrideEvent,
  type SetDownloadOverrideInput,
} from "../service";
import { AUDIO_DELIVERY_IDS, makeAudioDeliveryContext, makeAudioDeliveryLedger } from "./fixtures";

class MemoryAudioDeliveryRepository implements AudioDeliveryRepository {
  current: AudioDeliveryContext;
  readonly events: DownloadOverrideEvent[];
  readonly scopes: AudioDeliveryScope[] = [];
  private id = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(context: AudioDeliveryContext, events: readonly DownloadOverrideEvent[] = []) {
    this.current = context;
    this.events = [...events];
    this.id = events.length;
  }

  async atomically<T>(
    scope: AudioDeliveryScope,
    work: (transaction: AudioDeliveryTransaction) => Promise<T>,
  ): Promise<T> {
    this.scopes.push(scope);
    let release: () => void = () => undefined;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work(this.transaction());
    } finally {
      release();
    }
  }

  private transaction(): AudioDeliveryTransaction {
    const context = this.current;
    return {
      context,
      findOverrideOperation: (operationKey) =>
        Promise.resolve(
          this.events.find(
            (event) =>
              event.purchaseId === context.purchase.id && event.operationKey === operationKey,
          ) ?? null,
        ),
      appendOverride: (input: NewDownloadOverrideEvent) => {
        if (
          this.events.some(
            (event) =>
              (event.purchaseId === input.purchaseId &&
                event.operationKey === input.operationKey) ||
              (event.purchaseId === input.purchaseId &&
                event.versionId === input.versionId &&
                event.sequence === input.sequence),
          )
        ) {
          return Promise.reject(new Error("test override uniqueness violation"));
        }
        this.id += 1;
        const event: DownloadOverrideEvent = Object.freeze({
          ...input,
          id: `override-${String(this.id)}`,
          createdAt: new Date(input.createdAt),
        });
        this.events.push(event);
        this.current = {
          ...this.current,
          latestOverride: {
            purchaseId: event.purchaseId,
            versionId: event.versionId,
            enabled: event.enabled,
            sequence: event.sequence,
          },
        };
        return Promise.resolve(event);
      },
    };
  }
}

const OCCURRED_AT = new Date("2026-07-20T10:00:00.000Z");

function overrideInput(
  overrides: Partial<SetDownloadOverrideInput> = {},
): SetDownloadOverrideInput {
  return {
    producerId: AUDIO_DELIVERY_IDS.producerId,
    actorClerkUserId: AUDIO_DELIVERY_IDS.producerClerkUserId,
    purchaseId: AUDIO_DELIVERY_IDS.purchaseId,
    versionId: AUDIO_DELIVERY_IDS.versionId,
    enabled: true,
    operationKey: "enable-version-a",
    expectedUnpaidAmountCents: 6_000,
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

describe("SK-40 atomic audio delivery", () => {
  it("opens only after exact artist purchase/version authorization", async () => {
    const paidRepository = new MemoryAudioDeliveryRepository(
      makeAudioDeliveryContext({ ledgerKind: "paid" }),
    );
    const open = vi.fn((request: { key: string; title: string }) => Promise.resolve(request));

    const delivered = await deliverArtistDownload(
      paidRepository,
      {
        viewerClerkUserId: AUDIO_DELIVERY_IDS.artistClerkUserId,
        purchaseId: AUDIO_DELIVERY_IDS.purchaseId,
        versionId: AUDIO_DELIVERY_IDS.versionId,
      },
      open,
    );
    expect(delivered.key).toContain(AUDIO_DELIVERY_IDS.versionId);
    expect(delivered.title).toBe("Exact Song");
    expect(paidRepository.scopes).toEqual([
      {
        kind: "commercial",
        purchaseId: AUDIO_DELIVERY_IDS.purchaseId,
        versionId: AUDIO_DELIVERY_IDS.versionId,
      },
    ]);
    expect(open).toHaveBeenCalledTimes(1);

    const tamperedOpen = vi.fn(() => Promise.resolve("must-not-open"));
    await expect(
      deliverArtistDownload(
        paidRepository,
        {
          viewerClerkUserId: AUDIO_DELIVERY_IDS.artistClerkUserId,
          purchaseId: "purchase-b",
          versionId: AUDIO_DELIVERY_IDS.versionId,
        },
        tamperedOpen,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(tamperedOpen).not.toHaveBeenCalled();
  });

  it("allows private streaming before payment but keeps artist download payment-gated", async () => {
    const repository = new MemoryAudioDeliveryRepository(
      makeAudioDeliveryContext({ ledgerKind: "unpaid" }),
    );
    const streamOpen = vi.fn(() => Promise.resolve("stream-opened"));
    const downloadOpen = vi.fn(() => Promise.resolve("download-opened"));

    await expect(
      deliverPrivateStream(
        repository,
        {
          viewer: {
            role: "artist",
            clerkUserId: AUDIO_DELIVERY_IDS.artistClerkUserId,
          },
          versionId: AUDIO_DELIVERY_IDS.versionId,
        },
        streamOpen,
      ),
    ).resolves.toBe("stream-opened");
    await expect(
      deliverArtistDownload(
        repository,
        {
          viewerClerkUserId: AUDIO_DELIVERY_IDS.artistClerkUserId,
          purchaseId: AUDIO_DELIVERY_IDS.purchaseId,
          versionId: AUDIO_DELIVERY_IDS.versionId,
        },
        downloadOpen,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    expect(streamOpen).toHaveBeenCalledTimes(1);
    expect(downloadOpen).not.toHaveBeenCalled();
  });

  it("keeps playback and producer delivery independent from commercial-ledger reads", async () => {
    const repository = new MemoryAudioDeliveryRepository(
      makeAudioDeliveryContext({ ledger: null }),
    );
    const open = vi.fn(() => Promise.resolve("opened"));

    await expect(
      deliverPrivateStream(
        repository,
        {
          viewer: {
            role: "artist",
            clerkUserId: AUDIO_DELIVERY_IDS.artistClerkUserId,
          },
          versionId: AUDIO_DELIVERY_IDS.versionId,
        },
        open,
      ),
    ).resolves.toBe("opened");
    await expect(
      deliverProducerDownload(
        repository,
        {
          viewerClerkUserId: AUDIO_DELIVERY_IDS.producerClerkUserId,
          versionId: AUDIO_DELIVERY_IDS.versionId,
        },
        open,
      ),
    ).resolves.toBe("opened");
    expect(repository.scopes).toEqual([
      { kind: "audio", versionId: AUDIO_DELIVERY_IDS.versionId },
      { kind: "audio", versionId: AUDIO_DELIVERY_IDS.versionId },
    ]);

    await expect(
      deliverArtistDownload(
        repository,
        {
          viewerClerkUserId: AUDIO_DELIVERY_IDS.artistClerkUserId,
          purchaseId: AUDIO_DELIVERY_IDS.purchaseId,
          versionId: AUDIO_DELIVERY_IDS.versionId,
        },
        open,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps the producer endpoint exclusive to the exact producer owner", async () => {
    const repository = new MemoryAudioDeliveryRepository(
      makeAudioDeliveryContext({ ledgerKind: "unpaid" }),
    );
    const open = vi.fn(() => Promise.resolve("producer-download"));

    await expect(
      deliverProducerDownload(
        repository,
        {
          viewerClerkUserId: AUDIO_DELIVERY_IDS.producerClerkUserId,
          versionId: AUDIO_DELIVERY_IDS.versionId,
        },
        open,
      ),
    ).resolves.toBe("producer-download");
    await expect(
      deliverProducerDownload(
        repository,
        {
          viewerClerkUserId: AUDIO_DELIVERY_IDS.artistClerkUserId,
          versionId: AUDIO_DELIVERY_IDS.versionId,
        },
        open,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("SK-40 atomic exact-version override commands", () => {
  it("audits enable, same-state, and disable commands with monotonic sequence", async () => {
    const repository = new MemoryAudioDeliveryRepository(
      makeAudioDeliveryContext({ ledgerKind: "unpaid" }),
    );
    const first = await setDownloadOverride(repository, overrideInput());
    const second = await setDownloadOverride(
      repository,
      overrideInput({
        operationKey: "enable-version-a-again",
        occurredAt: new Date("2026-07-20T10:01:00.000Z"),
      }),
    );
    const third = await setDownloadOverride(
      repository,
      overrideInput({
        enabled: false,
        operationKey: "disable-version-a",
        occurredAt: new Date("2026-07-20T10:02:00.000Z"),
      }),
    );

    expect([first.event.sequence, second.event.sequence, third.event.sequence]).toEqual([1, 2, 3]);
    expect(repository.events.map(({ enabled }) => enabled)).toEqual([true, true, false]);
    expect(repository.events.map(({ changedByClerkUserId }) => changedByClerkUserId)).toEqual([
      AUDIO_DELIVERY_IDS.producerClerkUserId,
      AUDIO_DELIVERY_IDS.producerClerkUserId,
      AUDIO_DELIVERY_IDS.producerClerkUserId,
    ]);
    expect(repository.events.map(({ createdAt }) => createdAt.toISOString())).toEqual([
      "2026-07-20T10:00:00.000Z",
      "2026-07-20T10:01:00.000Z",
      "2026-07-20T10:02:00.000Z",
    ]);
    expect(third.state).toMatchObject({
      enabled: false,
      sequence: 3,
      fullyPaid: false,
      unpaidAmountCents: 6_000,
      currency: "ILS",
    });
  });

  it("serializes concurrent retries, replays immutable intent, and rejects changed intent", async () => {
    const repository = new MemoryAudioDeliveryRepository(
      makeAudioDeliveryContext({ ledgerKind: "unpaid" }),
    );
    const input = overrideInput({ operationKey: "retry-enable-version-a" });
    const results = await Promise.all([
      setDownloadOverride(repository, input),
      setDownloadOverride(repository, {
        ...input,
        occurredAt: new Date("2026-07-20T10:05:00.000Z"),
      }),
    ]);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(repository.events).toHaveLength(1);
    const original = repository.events[0];
    if (!original) throw new Error("missing original override event");

    repository.current = {
      ...repository.current,
      ledger: makeAudioDeliveryLedger("paid"),
      storedAudio: {
        ...repository.current.storedAudio,
        deletedAt: new Date("2026-07-20T11:00:00.000Z"),
      },
    };
    await expect(
      setDownloadOverride(repository, {
        ...input,
        occurredAt: new Date("2026-07-20T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      created: false,
      event: { id: original.id, sequence: 1 },
      state: { fullyPaid: true, unpaidAmountCents: 0 },
    });
    await expect(
      setDownloadOverride(repository, {
        ...input,
        enabled: false,
        expectedUnpaidAmountCents: 0,
      }),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
    expect(repository.events).toHaveLength(1);
  });

  it("rejects stale unpaid warnings without writing an audit event", async () => {
    const repository = new MemoryAudioDeliveryRepository(
      makeAudioDeliveryContext({ ledgerKind: "unpaid" }),
    );

    await expect(
      setDownloadOverride(repository, overrideInput({ expectedUnpaidAmountCents: 5_999 })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(repository.events).toHaveLength(0);
    await expect(
      readDownloadOverrideState(repository, {
        producerId: AUDIO_DELIVERY_IDS.producerId,
        actorClerkUserId: AUDIO_DELIVERY_IDS.producerClerkUserId,
        purchaseId: AUDIO_DELIVERY_IDS.purchaseId,
        versionId: AUDIO_DELIVERY_IDS.versionId,
      }),
    ).resolves.toMatchObject({
      enabled: false,
      fullyPaid: false,
      unpaidAmountCents: 6_000,
      sequence: 0,
    });
  });

  it("keeps a deleted version's override auditable and disableable, but never re-enables it", async () => {
    const deletedAt = new Date("2026-07-20T11:00:00.000Z");
    const repository = new MemoryAudioDeliveryRepository(
      makeAudioDeliveryContext({
        ledgerKind: "unpaid",
        latestOverride: {
          purchaseId: AUDIO_DELIVERY_IDS.purchaseId,
          versionId: AUDIO_DELIVERY_IDS.versionId,
          enabled: true,
          sequence: 2,
        },
        storedAudio: { deletedAt },
      }),
    );

    await expect(
      readDownloadOverrideState(repository, {
        producerId: AUDIO_DELIVERY_IDS.producerId,
        actorClerkUserId: AUDIO_DELIVERY_IDS.producerClerkUserId,
        purchaseId: AUDIO_DELIVERY_IDS.purchaseId,
        versionId: AUDIO_DELIVERY_IDS.versionId,
      }),
    ).resolves.toMatchObject({ enabled: true, sequence: 2, unpaidAmountCents: 6_000 });
    await expect(
      setDownloadOverride(
        repository,
        overrideInput({
          enabled: false,
          operationKey: "disable-deleted-version",
        }),
      ),
    ).resolves.toMatchObject({ created: true, state: { enabled: false, sequence: 3 } });
    await expect(
      setDownloadOverride(
        repository,
        overrideInput({
          enabled: true,
          operationKey: "re-enable-deleted-version",
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not allow a new disable after the exact purchase becomes fully paid", async () => {
    const repository = new MemoryAudioDeliveryRepository(
      makeAudioDeliveryContext({
        ledgerKind: "paid",
        latestOverride: {
          purchaseId: AUDIO_DELIVERY_IDS.purchaseId,
          versionId: AUDIO_DELIVERY_IDS.versionId,
          enabled: true,
          sequence: 4,
        },
      }),
    );

    await expect(
      setDownloadOverride(
        repository,
        overrideInput({
          enabled: false,
          operationKey: "disable-after-full-payment",
          expectedUnpaidAmountCents: 0,
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(repository.events).toHaveLength(0);
  });

  it("hides producer, actor, purchase, and version mismatches", async () => {
    const repository = new MemoryAudioDeliveryRepository(
      makeAudioDeliveryContext({ ledgerKind: "unpaid" }),
    );

    for (const input of [
      overrideInput({ producerId: "producer-b" }),
      overrideInput({ actorClerkUserId: "clerk-producer-b" }),
      overrideInput({ purchaseId: "purchase-b" }),
      overrideInput({ versionId: "version-b" }),
    ]) {
      await expect(setDownloadOverride(repository, input)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
    expect(repository.events).toHaveLength(0);
  });
});
