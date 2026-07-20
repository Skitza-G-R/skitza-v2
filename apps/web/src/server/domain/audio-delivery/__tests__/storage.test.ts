import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/storage/r2", () => ({
  BUCKETS: { audio: "isolated-audio-delivery" },
  getR2: () => {
    throw new Error("tests must supply an isolated client");
  },
}));

import { parseSingleByteRange } from "../http";
import { AudioDeliveryStorageError, readExactAudioObject } from "../storage";

const STORAGE_KEY =
  "producers/10000000-0000-4000-8000-000000000001/tracks/50000000-0000-4000-8000-000000000005/object.wav";
const OBJECT_ETAG = '"exact-audio-etag"';
const WEB_STREAM = new ReadableStream<Uint8Array>();
const BODY = {
  transformToWebStream: () => WEB_STREAM,
};

function isolatedClient(send: ReturnType<typeof vi.fn>): S3Client {
  return { send } as unknown as S3Client;
}

function sentCommand(send: ReturnType<typeof vi.fn>): GetObjectCommand {
  return send.mock.calls[0]?.[0] as GetObjectCommand;
}

describe("exact private audio storage delivery", () => {
  it("reads the exact immutable object with If-Match and never returns its key", async () => {
    const send = vi.fn().mockResolvedValue({
      Body: BODY,
      ETag: OBJECT_ETAG,
      ContentLength: 1_000,
      ContentType: "audio/wav",
    });

    const result = await readExactAudioObject(
      {
        storageKey: STORAGE_KEY,
        objectEtag: OBJECT_ETAG,
        sizeBytes: 1_000,
      },
      isolatedClient(send),
    );

    expect(result).toEqual({
      body: WEB_STREAM,
      contentType: "audio/wav",
      contentLength: 1_000,
    });
    expect(result).not.toHaveProperty("storageKey");
    expect(result).not.toHaveProperty("objectEtag");
    expect(sentCommand(send)).toBeInstanceOf(GetObjectCommand);
    expect(sentCommand(send).input).toEqual({
      Bucket: "isolated-audio-delivery",
      Key: STORAGE_KEY,
      IfMatch: OBJECT_ETAG,
    });
  });

  it("sends one exact byte range and verifies the returned range metadata", async () => {
    const send = vi.fn().mockResolvedValue({
      Body: BODY,
      ETag: OBJECT_ETAG,
      ContentLength: 100,
      ContentRange: "bytes 100-199/1000",
      ContentType: "audio/mpeg",
    });
    const range = parseSingleByteRange("bytes=100-199", 1_000);

    await expect(
      readExactAudioObject(
        {
          storageKey: STORAGE_KEY,
          objectEtag: OBJECT_ETAG,
          sizeBytes: 1_000,
          range,
        },
        isolatedClient(send),
      ),
    ).resolves.toMatchObject({ contentLength: 100, contentType: "audio/mpeg" });

    expect(sentCommand(send).input).toMatchObject({
      Bucket: "isolated-audio-delivery",
      Key: STORAGE_KEY,
      IfMatch: OBJECT_ETAG,
      Range: "bytes=100-199",
    });
  });

  it.each([
    ["missing body", { ETag: OBJECT_ETAG, ContentLength: 1_000 }],
    [
      "changed ETag",
      { Body: BODY, ETag: '"different"', ContentLength: 1_000, ContentType: "audio/wav" },
    ],
    [
      "changed length",
      { Body: BODY, ETag: OBJECT_ETAG, ContentLength: 999, ContentType: "audio/wav" },
    ],
  ])("fails closed on %s", async (_label, response) => {
    const send = vi.fn().mockResolvedValue(response);

    await expect(
      readExactAudioObject(
        {
          storageKey: STORAGE_KEY,
          objectEtag: OBJECT_ETAG,
          sizeBytes: 1_000,
        },
        isolatedClient(send),
      ),
    ).rejects.toThrow(AudioDeliveryStorageError);
  });

  it("fails closed when R2 does not honor the exact requested range", async () => {
    const send = vi.fn().mockResolvedValue({
      Body: BODY,
      ETag: OBJECT_ETAG,
      ContentLength: 100,
      ContentRange: "bytes 200-299/1000",
      ContentType: "audio/wav",
    });

    await expect(
      readExactAudioObject(
        {
          storageKey: STORAGE_KEY,
          objectEtag: OBJECT_ETAG,
          sizeBytes: 1_000,
          range: { start: 100, end: 199, length: 100 },
        },
        isolatedClient(send),
      ),
    ).rejects.toThrow(AudioDeliveryStorageError);
  });

  it("flattens storage failures without leaking the private object key", async () => {
    const send = vi.fn().mockRejectedValue(new Error(`R2 failed for ${STORAGE_KEY}`));

    const read = readExactAudioObject(
      {
        storageKey: STORAGE_KEY,
        objectEtag: OBJECT_ETAG,
        sizeBytes: 1_000,
      },
      isolatedClient(send),
    );

    await expect(read).rejects.toThrow(AudioDeliveryStorageError);
    await expect(read).rejects.not.toThrow(STORAGE_KEY);
  });

  it("rejects incomplete stored identity before contacting R2", async () => {
    const send = vi.fn();

    await expect(
      readExactAudioObject(
        {
          storageKey: `${STORAGE_KEY}\r\nX-Leak: yes`,
          objectEtag: OBJECT_ETAG,
          sizeBytes: 1_000,
        },
        isolatedClient(send),
      ),
    ).rejects.toThrow(AudioDeliveryStorageError);
    await expect(
      readExactAudioObject(
        {
          storageKey: STORAGE_KEY,
          objectEtag: "",
          sizeBytes: 1_000,
        },
        isolatedClient(send),
      ),
    ).rejects.toThrow(AudioDeliveryStorageError);
    expect(send).not.toHaveBeenCalled();
  });
});
