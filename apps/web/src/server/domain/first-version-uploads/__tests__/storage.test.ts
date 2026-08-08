import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
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
  reconcileFirstVersionFinalDeletion,
  reconcileFirstVersionStagingDeletion,
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

  it("rejects a presigned URL whose authoritative AWS expiry cannot be derived", async () => {
    mocks.getSignedUrl.mockResolvedValueOnce("https://upload.example.test/intent");

    await expect(
      createFirstVersionUploadUrl(
        { key: "staging/upload.wav", ...expectation },
        {} as never,
      ),
    ).rejects.toMatchObject({ name: "FirstVersionUploadPresignError" });
  });

  it("returns every signed browser PUT header", async () => {
    mocks.getSignedUrl.mockResolvedValueOnce(
      "https://upload.example.test/intent?X-Amz-Date=20260808T120000Z&X-Amz-Expires=900",
    );
    const client = {};

    await expect(
      createFirstVersionUploadUrl({ key: "staging/upload.wav", ...expectation }, client as never),
    ).resolves.toEqual({
      uploadUrl:
        "https://upload.example.test/intent?X-Amz-Date=20260808T120000Z&X-Amz-Expires=900",
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
        "If-None-Match": "*",
        "x-amz-meta-skitza-upload-token": expectation.completionToken,
      },
      expiresInSeconds: 900,
      expiresAt: new Date("2026-08-08T12:15:00.000Z"),
    });

    const signedCommand = mocks.getSignedUrl.mock.calls[0]?.[1] as unknown;
    expect(signedCommand).toBeInstanceOf(PutObjectCommand);
    expect((signedCommand as PutObjectCommand).input).toMatchObject({
      Bucket: "isolated-first-version-audio",
      Key: "staging/upload.wav",
      ContentType: "audio/wav",
      CacheControl: "no-store",
      ContentLength: expectation.sizeBytes,
      IfNoneMatch: "*",
      Metadata: { "skitza-upload-token": expectation.completionToken },
    });
    expect(mocks.getSignedUrl.mock.calls[0]?.[2]).toMatchObject({
      signableHeaders: new Set([
        "content-type",
        "cache-control",
        "content-length",
        "if-none-match",
      ]),
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

  it("proves a rolled-back server-final key absent before reservation release", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ContentLength: expectation.sizeBytes,
        ContentType: expectation.contentType,
        Metadata: { "skitza-upload-token": expectation.completionToken },
        ETag: '"final-etag"',
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ IsTruncated: false, Contents: [] });

    await expect(
      reconcileFirstVersionFinalDeletion(
        { key: "producers/p/tracks/v/audio.wav", ...expectation },
        { send } as never,
      ),
    ).resolves.toBeUndefined();
    expect(sentCommand(send, 1)).toBeInstanceOf(DeleteObjectCommand);
    expect(sentCommand(send, 2)).toBeInstanceOf(ListObjectsV2Command);
  });

  it("retains an exact permanent marker that blocks every stale conditional PUT", async () => {
    let state: "present" | "marker" = "present";
    let markerFingerprint = "";
    let markerSource = "";
    const send = vi.fn((command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        if (state === "marker") {
          return {
            ContentLength: 1,
            ContentType: "application/x-skitza-sealed-first-version-staging-marker",
            ETag: '"marker-etag"',
            Metadata: {
              "skitza-upload-token": expectation.completionToken,
              "skitza-staging-seal": markerFingerprint,
              "skitza-staging-seal-source": markerSource,
            },
          };
        }
        return {
          ContentLength: expectation.sizeBytes,
          ContentType: expectation.contentType,
          Metadata: { "skitza-upload-token": expectation.completionToken },
          ETag: '"exact-staging"',
        };
      }
      if (command instanceof PutObjectCommand) {
        markerFingerprint = command.input.Metadata?.["skitza-staging-seal"] ?? "";
        markerSource = command.input.Metadata?.["skitza-staging-seal-source"] ?? "";
        state = "marker";
        return {};
      }
      throw new Error("Unexpected command");
    });
    const input = {
      key: "first-version-staging/producers/p/intents/i/upload",
      ...expectation,
    };

    await expect(reconcileFirstVersionStagingDeletion(input, { send } as never)).resolves.toBeUndefined();
    await expect(reconcileFirstVersionStagingDeletion(input, { send } as never)).resolves.toBeUndefined();

    const markerWrite = send.mock.calls
      .map(([command]) => command)
      .find((command) => command instanceof PutObjectCommand) as PutObjectCommand;
    expect(markerWrite.input).toMatchObject({
      Key: input.key,
      IfMatch: '"exact-staging"',
      ContentType: "application/x-skitza-sealed-first-version-staging-marker",
    });
    expect(
      (markerWrite.input.Metadata?.["skitza-staging-seal"] ?? "").startsWith("sha256:"),
    ).toBe(true);
    expect(send.mock.calls.some(([command]) => command instanceof DeleteObjectCommand)).toBe(false);
  });

  it("seals a token-owned oversized or mistyped staging body by its observed ETag", async () => {
    let sealMetadata: Record<string, string> | undefined;
    const send = vi.fn((command: unknown) => {
      if (command instanceof HeadObjectCommand && !sealMetadata) {
        return {
          ContentLength: 200_000_000,
          ContentType: "application/octet-stream",
          Metadata: { "skitza-upload-token": expectation.completionToken },
          ETag: '"oversized-etag"',
        };
      }
      if (command instanceof PutObjectCommand) {
        sealMetadata = command.input.Metadata;
        return {};
      }
      if (command instanceof HeadObjectCommand && sealMetadata) {
        return {
          ContentLength: 1,
          ContentType: "application/x-skitza-sealed-first-version-staging-marker",
          Metadata: sealMetadata,
          ETag: '"marker-etag"',
        };
      }
      throw new Error("Unexpected command");
    });

    await expect(
      reconcileFirstVersionStagingDeletion(
        {
          key: "first-version-staging/producers/p/intents/i/upload",
          ...expectation,
        },
        { send } as never,
      ),
    ).resolves.toBeUndefined();

    const markerWrite = sentCommand(send, 1) as PutObjectCommand;
    expect(markerWrite.input.IfMatch).toBe('"oversized-etag"');
  });

  it("seals proven absence with If-None-Match so a concurrent browser PUT must lose", async () => {
    let sealMetadata: Record<string, string> | undefined;
    const send = vi.fn((command: unknown) => {
      if (command instanceof HeadObjectCommand && !sealMetadata) {
        throw Object.assign(new Error("missing"), { name: "NotFound" });
      }
      if (command instanceof ListObjectsV2Command) {
        return { IsTruncated: false, Contents: [] };
      }
      if (command instanceof PutObjectCommand) {
        sealMetadata = command.input.Metadata;
        return {};
      }
      if (command instanceof HeadObjectCommand && sealMetadata) {
        return {
          ContentLength: 1,
          ContentType: "application/x-skitza-sealed-first-version-staging-marker",
          Metadata: sealMetadata,
          ETag: '"marker-etag"',
        };
      }
      throw new Error("Unexpected command");
    });

    await reconcileFirstVersionStagingDeletion(
      {
        key: "first-version-staging/producers/p/intents/i/upload",
        ...expectation,
      },
      { send } as never,
    );

    const markerWrite = send.mock.calls
      .map(([command]) => command)
      .find((command) => command instanceof PutObjectCommand) as PutObjectCommand;
    expect(markerWrite.input.IfNoneMatch).toBe("*");
  });

  it("refuses hard-delete staging cleanup when the intent token changed", async () => {
    const send = vi.fn().mockResolvedValueOnce({
      ContentLength: expectation.sizeBytes,
      ContentType: expectation.contentType,
      Metadata: { "skitza-upload-token": "b".repeat(64) },
      ETag: '"changed"',
    });

    await expect(
      reconcileFirstVersionStagingDeletion(
        {
          key: "first-version-staging/producers/p/intents/i/upload",
          ...expectation,
        },
        { send } as never,
      ),
    ).rejects.toThrow("ownership changed before sealing");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
