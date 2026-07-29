import { describe, expect, it, vi } from "vitest";

import type { DownloadOverrideState } from "~/server/domain/audio-delivery/service";

import { loadProducerSongSupplements } from "../song-detail-supplements";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const sharing = {
  trackId: "track-1",
  linkEnabled: false,
  portfolioPublished: false,
  remainingAudioCount: 3,
  tokenVersion: null,
  publicUrl: null,
};

function state(versionId: string): DownloadOverrideState {
  return {
    purchaseId: "purchase-1",
    versionId,
    enabled: false,
    fullyPaid: false,
    unpaidAmountCents: 10_000,
    currency: "ILS",
    overdue: false,
    sequence: 0,
  };
}

describe("loadProducerSongSupplements", () => {
  it("starts publication and one delivery batch together for every version", async () => {
    const publication = deferred<typeof sharing>();
    const delivery = deferred<{ states: DownloadOverrideState[] }>();
    const producerState = vi.fn(() => publication.promise);
    const overrideStates = vi.fn(() => delivery.promise);

    const resultPromise = loadProducerSongSupplements(
      {
        songPublication: { producerState },
        audioDelivery: { overrideStates },
      },
      {
        track: { id: "track-1" },
        versions: [
          { id: "version-1", purchaseId: "purchase-1" },
          { id: "version-2", purchaseId: "purchase-1" },
          { id: "version-3", purchaseId: "purchase-1" },
        ],
      },
    );

    await Promise.resolve();
    expect(producerState).toHaveBeenCalledOnce();
    expect(overrideStates).toHaveBeenCalledOnce();
    expect(overrideStates).toHaveBeenCalledWith({
      purchaseId: "purchase-1",
      trackId: "track-1",
      versionIds: ["version-1", "version-2", "version-3"],
    });

    publication.resolve(sharing);
    delivery.resolve({
      states: [state("version-1"), state("version-2"), state("version-3")],
    });
    const result = await resultPromise;
    expect([...result.overrideByVersion]).toEqual([
      ["version-1", state("version-1")],
      ["version-2", state("version-2")],
      ["version-3", state("version-3")],
    ]);
  });

  it("fails closed before a batch call when versions cross purchase boundaries", async () => {
    const overrideStates = vi.fn();
    await expect(
      loadProducerSongSupplements(
        {
          songPublication: { producerState: vi.fn().mockResolvedValue(sharing) },
          audioDelivery: { overrideStates },
        },
        {
          track: { id: "track-1" },
          versions: [
            { id: "version-1", purchaseId: "purchase-1" },
            { id: "version-2", purchaseId: "purchase-2" },
          ],
        },
      ),
    ).rejects.toThrow("crossed a purchase boundary");
    expect(overrideStates).not.toHaveBeenCalled();
  });

  it("rejects missing, duplicate, or foreign delivery states", async () => {
    const baseCaller = {
      songPublication: { producerState: vi.fn().mockResolvedValue(sharing) },
    };
    const data = {
      track: { id: "track-1" },
      versions: [
        { id: "version-1", purchaseId: "purchase-1" },
        { id: "version-2", purchaseId: "purchase-1" },
      ],
    };

    await expect(
      loadProducerSongSupplements(
        {
          ...baseCaller,
          audioDelivery: {
            overrideStates: vi.fn().mockResolvedValue({ states: [state("version-1")] }),
          },
        },
        data,
      ),
    ).rejects.toThrow("omitted a requested version");

    await expect(
      loadProducerSongSupplements(
        {
          ...baseCaller,
          audioDelivery: {
            overrideStates: vi
              .fn()
              .mockResolvedValue({ states: [state("version-1"), state("version-1")] }),
          },
        },
        data,
      ),
    ).rejects.toThrow("invalid version scope");

    await expect(
      loadProducerSongSupplements(
        {
          ...baseCaller,
          audioDelivery: {
            overrideStates: vi
              .fn()
              .mockResolvedValue({ states: [state("version-1"), state("version-foreign")] }),
          },
        },
        data,
      ),
    ).rejects.toThrow("invalid version scope");
  });
});
