import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { AUDIO_STORAGE_FULL_MESSAGE } from "~/lib/audio/storage-limits";

import {
  AudioStorageQuotaError,
  assertProducerAudioStorageAvailable,
  buildProducerAudioStorageQuota,
  producerAudioStorageAdvisoryLockKey,
  readProducerAudioStorageQuota,
  type AudioStorageQuotaDb,
} from "../quota";

function quotaDb(
  rows: readonly Readonly<{ usedBytes: number | string; reservedBytes: number | string }>[],
) {
  const execute = vi.fn(() => Promise.resolve({ rows }));
  return {
    db: { execute: execute as unknown as AudioStorageQuotaDb["execute"] },
    execute,
  };
}

describe("producer audio storage quota", () => {
  it("reports stored and reserved bytes without hiding either", () => {
    expect(
      buildProducerAudioStorageQuota({ usedBytes: 760_000_000, reservedBytes: 40_000_000 }),
    ).toEqual({
      usedBytes: 760_000_000,
      reservedBytes: 40_000_000,
      committedBytes: 800_000_000,
      availableBytes: 200_000_000,
      limitBytes: 1_000_000_000,
      warningBytes: 800_000_000,
      isAtOrAboveWarning: true,
      isFull: false,
    });
  });

  it("allows an upload that reaches exactly 1GB and rejects one byte more", async () => {
    const atBoundary = quotaDb([{ usedBytes: "900000000", reservedBytes: "0" }]);
    const oneByteOver = quotaDb([{ usedBytes: "900000001", reservedBytes: "0" }]);

    await expect(
      assertProducerAudioStorageAvailable(atBoundary.db, "producer-1", 100_000_000),
    ).resolves.toMatchObject({ committedBytes: 900_000_000 });
    await expect(
      assertProducerAudioStorageAvailable(oneByteOver.db, "producer-1", 100_000_000),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AudioStorageQuotaError>>({
        code: "LIMIT_EXCEEDED",
        message: AUDIO_STORAGE_FULL_MESSAGE,
      }),
    );
  });

  it("reads completed bytes plus active reservations in one database snapshot", async () => {
    const { db, execute } = quotaDb([{ usedBytes: 125_000_000, reservedBytes: 75_000_000 }]);

    await expect(readProducerAudioStorageQuota(db, "producer-1")).resolves.toMatchObject({
      usedBytes: 125_000_000,
      reservedBytes: 75_000_000,
      committedBytes: 200_000_000,
    });
    expect(execute).toHaveBeenCalledOnce();
    const source = readFileSync(new URL("../quota.ts", import.meta.url), "utf8");
    expect(source).toContain('tv."audio_storage_deleted_at" is null');
    expect(source).toContain('tv."pending_audio_size_bytes" is not null');
    expect(source).not.toContain('tv."pending_audio_cancel_requested_at" is null');
    expect(source).toContain('from "first_version_upload_intents" fvi');
    expect(source).toContain('fvi."staging_sealed_at" is null');
  });

  it("uses one producer-wide advisory namespace", () => {
    expect(producerAudioStorageAdvisoryLockKey("producer-1")).toBe(
      "producer-audio-storage:producer-1",
    );
  });
});
