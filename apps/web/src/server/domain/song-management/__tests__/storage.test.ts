import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  exactObjectIsAbsent: vi.fn(),
}));

vi.mock("~/server/storage/r2", () => ({
  BUCKETS: { audio: "isolated-song-management-audio" },
  getR2: () => ({ send: mocks.send }),
}));

vi.mock("~/server/audio/multipart-storage-recovery", () => ({
  exactObjectIsAbsent: mocks.exactObjectIsAbsent,
}));

import { r2ExactAudioStoragePort } from "../storage";

const KEY = "producers/producer-1/tracks/version-1/object.wav";

function sentCommand(index = 0): unknown {
  return mocks.send.mock.calls[index]?.[0] as unknown;
}

afterEach(() => {
  mocks.send.mockReset();
  mocks.exactObjectIsAbsent.mockReset();
});

describe("r2ExactAudioStoragePort", () => {
  it("reports absence only after the authoritative exact-key fallback proves it", async () => {
    const genericHead404 = Object.assign(new Error("generic HEAD failure"), {
      $metadata: { httpStatusCode: 404 },
    });
    mocks.send.mockRejectedValueOnce(genericHead404);
    mocks.exactObjectIsAbsent.mockResolvedValueOnce(true);

    await expect(r2ExactAudioStoragePort().observeExactObject({ key: KEY })).resolves.toEqual({
      kind: "absent",
    });

    const command = sentCommand();
    expect(command).toBeInstanceOf(HeadObjectCommand);
    expect((command as HeadObjectCommand).input).toEqual({
      Bucket: "isolated-song-management-audio",
      Key: KEY,
    });
    expect(mocks.exactObjectIsAbsent).toHaveBeenCalledExactlyOnceWith(KEY);
  });

  it("returns the complete ETag and byte size from a successful HEAD", async () => {
    mocks.send.mockResolvedValueOnce({ ETag: '"audio-etag"', ContentLength: 4_096 });

    await expect(r2ExactAudioStoragePort().observeExactObject({ key: KEY })).resolves.toEqual({
      kind: "present",
      objectEtag: '"audio-etag"',
      sizeBytes: 4_096,
    });
    expect(mocks.exactObjectIsAbsent).not.toHaveBeenCalled();
  });

  it("recognizes a deletion marker by its retained audio identity fingerprint", async () => {
    mocks.send.mockResolvedValueOnce({
      ETag: '"marker-etag"',
      ContentLength: 1,
      Metadata: { "skitza-deletion-fingerprint": "sha256:audio-identity" },
    });

    await expect(r2ExactAudioStoragePort().observeExactObject({ key: KEY })).resolves.toEqual({
      kind: "erased_marker",
      deletionFingerprint: "sha256:audio-identity",
    });
    expect(mocks.exactObjectIsAbsent).not.toHaveBeenCalled();
  });

  it("fails closed on an incomplete successful HEAD without reinterpreting it as absence", async () => {
    mocks.send.mockResolvedValueOnce({ ETag: "", ContentLength: 0 });
    mocks.exactObjectIsAbsent.mockResolvedValueOnce(true);

    await expect(r2ExactAudioStoragePort().observeExactObject({ key: KEY })).rejects.toThrow(
      /metadata was incomplete/i,
    );
    expect(mocks.exactObjectIsAbsent).not.toHaveBeenCalled();
  });

  it("propagates HEAD and authoritative-list failures instead of assuming absence", async () => {
    const headError = new Error("HEAD unavailable");
    mocks.send.mockRejectedValueOnce(headError);
    mocks.exactObjectIsAbsent.mockResolvedValueOnce(false);

    await expect(r2ExactAudioStoragePort().observeExactObject({ key: KEY })).rejects.toBe(
      headError,
    );

    const listError = new Error("exact listing unavailable");
    mocks.send.mockRejectedValueOnce(new Error("HEAD still unavailable"));
    mocks.exactObjectIsAbsent.mockRejectedValueOnce(listError);

    await expect(r2ExactAudioStoragePort().observeExactObject({ key: KEY })).rejects.toBe(
      listError,
    );
  });

  it("conditionally replaces only the matching audio with an identity-bound marker", async () => {
    mocks.send.mockResolvedValueOnce({});

    await expect(
      r2ExactAudioStoragePort().conditionallyEraseExactObject({
        key: KEY,
        ifMatch: '"audio-etag"',
        deletionFingerprint: "sha256:audio-identity",
      }),
    ).resolves.toBeUndefined();

    expect(mocks.send).toHaveBeenCalledTimes(1);
    const command = sentCommand();
    expect(command).toBeInstanceOf(PutObjectCommand);
    const input = (command as PutObjectCommand).input;
    expect(input).toMatchObject({
      Bucket: "isolated-song-management-audio",
      Key: KEY,
      IfMatch: '"audio-etag"',
      ContentType: "application/x-skitza-deleted-audio-marker",
      CacheControl: "no-store",
      Metadata: { "skitza-deletion-fingerprint": "sha256:audio-identity" },
    });
    expect(Array.from(input.Body as Uint8Array)).toEqual([0]);
  });

  it("removes an already-verified marker with an ordinary exact-key delete", async () => {
    mocks.send.mockResolvedValueOnce({});

    await expect(
      r2ExactAudioStoragePort().deleteErasedMarker({ key: KEY }),
    ).resolves.toBeUndefined();

    expect(mocks.send).toHaveBeenCalledTimes(1);
    const command = sentCommand();
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect((command as DeleteObjectCommand).input).toEqual({
      Bucket: "isolated-song-management-audio",
      Key: KEY,
    });
  });
});
