import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSignedUrl: vi.fn(),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mocks.getSignedUrl,
}));

vi.mock("~/server/storage/r2", () => ({
  BUCKETS: { audio: "isolated-first-version-audio" },
  encodeR2CopySource: (bucket: string, key: string) =>
    `${encodeURIComponent(bucket)}/${key
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")}`,
  getR2: vi.fn(),
  getR2BrowserUpload: vi.fn(),
}));

vi.mock("~/server/audio/peaks", () => ({
  computePeaksFromBytes: vi.fn(),
}));

import {
  createFirstVersionUploadUrl,
  deleteFirstVersionUploadIfExact,
  finalizeFirstVersionUpload,
  observeFirstVersionUpload,
} from "../storage";

const expectation = {
  sizeBytes: 4_096,
  contentType: "audio/wav",
  completionToken: "a".repeat(64),
};

function sentCommand(send: ReturnType<typeof vi.fn>, index = 0): unknown {
  return send.mock.calls[index]?.[0] as unknown;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("first Version upload storage", () => {
  it("replaces presigner failures with a user-safe link-preparation error", async () => {
    mocks.getSignedUrl.mockRejectedValueOnce(
      new Error(
        "request failed for https://storage.invalid/?X-Amz-Credential=private-token",
      ),
    );

    const failure = await createFirstVersionUploadUrl(
      { key: "staging/upload.wav", ...expectation },
      {} as never,
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: "FirstVersionUploadPresignError",
      message: "Upload link preparation failed. Please try again.",
    });
    expect(String(failure)).not.toContain("private-token");
  });

  it("returns every signed browser PUT header", async () => {
    mocks.getSignedUrl.mockResolvedValueOnce("https://upload.example.test/intent");
    const client = {};

    await expect(
      createFirstVersionUploadUrl({ key: "staging/upload.wav", ...expectation }, client as never),
    ).resolves.toEqual({
      uploadUrl: "https://upload.example.test/intent",
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
        "x-amz-meta-skitza-upload-token": expectation.completionToken,
      },
      expiresInSeconds: 900,
    });

    const signedCommand = mocks.getSignedUrl.mock.calls[0]?.[1] as unknown;
    expect(signedCommand).toBeInstanceOf(PutObjectCommand);
    expect((signedCommand as PutObjectCommand).input).toMatchObject({
      Bucket: "isolated-first-version-audio",
      Key: "staging/upload.wav",
      ContentType: "audio/wav",
      CacheControl: "no-store",
      Metadata: { "skitza-upload-token": expectation.completionToken },
    });
    expect((signedCommand as PutObjectCommand).input).not.toHaveProperty("ContentLength");
    expect(mocks.getSignedUrl.mock.calls[0]?.[2]).toMatchObject({
      signableHeaders: new Set(["content-type", "cache-control"]),
      unhoistableHeaders: new Set(["x-amz-meta-skitza-upload-token"]),
    });
  });

  it("accepts only the exact server-issued object identity", async () => {
    const send = vi.fn().mockResolvedValueOnce({
      ContentLength: 4_096,
      ContentType: "audio/wav",
      Metadata: { "skitza-upload-token": expectation.completionToken },
      ETag: '"staged-etag"',
    });

    await expect(
      observeFirstVersionUpload({ key: "staging/upload.wav", ...expectation }, { send } as never),
    ).resolves.toEqual({
      sizeBytes: 4_096,
      contentType: "audio/wav",
      objectEtag: '"staged-etag"',
    });
    expect(sentCommand(send)).toBeInstanceOf(HeadObjectCommand);
  });

  it("freezes staging bytes into an immutable final key before completion", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("missing"), { name: "NotFound" }))
      .mockResolvedValueOnce({
        ContentLength: 4_096,
        ContentType: "audio/wav",
        Metadata: { "skitza-upload-token": expectation.completionToken },
        ETag: '"staged-etag"',
      })
      .mockResolvedValueOnce({ CopyObjectResult: { ETag: '"final-etag"' } })
      .mockResolvedValueOnce({
        ContentLength: 4_096,
        ContentType: "audio/wav",
        Metadata: { "skitza-upload-token": expectation.completionToken },
        ETag: '"final-etag"',
      });

    await expect(
      finalizeFirstVersionUpload(
        {
          stagingKey: "staging/upload.wav",
          finalKey: "producers/p/tracks/v/upload.wav",
          ...expectation,
        },
        { send } as never,
      ),
    ).resolves.toEqual({
      sizeBytes: 4_096,
      contentType: "audio/wav",
      objectEtag: '"final-etag"',
    });

    const copy = sentCommand(send, 2);
    expect(copy).toBeInstanceOf(CopyObjectCommand);
    expect((copy as CopyObjectCommand).input).toMatchObject({
      Bucket: "isolated-first-version-audio",
      Key: "producers/p/tracks/v/upload.wav",
      CopySource: "/isolated-first-version-audio/staging/upload.wav",
      CopySourceIfMatch: '"staged-etag"',
      MetadataDirective: "COPY",
    });
  });

  it("refuses cleanup when the current object no longer matches the intent", async () => {
    const send = vi.fn().mockResolvedValueOnce({
      ContentLength: 4_096,
      ContentType: "audio/wav",
      Metadata: { "skitza-upload-token": "b".repeat(64) },
      ETag: '"changed-etag"',
    });

    await expect(
      deleteFirstVersionUploadIfExact({ key: "staging/upload.wav", ...expectation }, {
        send,
      } as never),
    ).resolves.toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("deletes only after observing the exact intent-bound object", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ContentLength: 4_096,
        ContentType: "audio/wav",
        Metadata: { "skitza-upload-token": expectation.completionToken },
        ETag: '"exact-etag"',
      })
      .mockResolvedValueOnce({});

    await expect(
      deleteFirstVersionUploadIfExact({ key: "staging/upload.wav", ...expectation }, {
        send,
      } as never),
    ).resolves.toBe(true);
    const deletion = sentCommand(send, 1);
    expect(deletion).toBeInstanceOf(DeleteObjectCommand);
    expect((deletion as DeleteObjectCommand).input).toMatchObject({
      Bucket: "isolated-first-version-audio",
      Key: "staging/upload.wav",
      IfMatch: '"exact-etag"',
    });
  });
});
