import { UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createFirstVersionUploadUrl } from "~/server/domain/first-version-uploads/storage";
import { getR2BrowserUpload } from "../r2";

describe("R2 browser upload presigning", () => {
  beforeAll(() => {
    vi.stubEnv("R2_ACCOUNT_ID", "test-account");
    vi.stubEnv("R2_ACCESS_KEY_ID", "test-access-key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret-key");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("does not sign an empty-body checksum into multipart part URLs", async () => {
    const signed = await getSignedUrl(
      getR2BrowserUpload(),
      new UploadPartCommand({
        Bucket: "test-audio",
        Key: "producers/producer/tracks/version/audio.wav",
        UploadId: "test-upload",
        PartNumber: 1,
      }),
      {
        expiresIn: 60,
        signingDate: new Date("2026-08-04T00:00:00.000Z"),
      },
    );
    const query = new URL(signed).searchParams;

    expect(query.has("x-amz-checksum-crc32")).toBe(false);
    expect(query.has("x-amz-sdk-checksum-algorithm")).toBe(false);
    expect(query.get("X-Amz-Content-Sha256")).toBe("UNSIGNED-PAYLOAD");
  });

  it("signs the exact headers sent by a 39.2 MB first-Version browser PUT", async () => {
    const upload = await createFirstVersionUploadUrl({
      key: "first-version-staging/producers/producer/intents/intent/upload",
      sizeBytes: 41_104_179,
      contentType: "audio/wav",
      completionToken: "a".repeat(64),
    });
    const query = new URL(upload.uploadUrl).searchParams;
    const signedHeaders = new Set((query.get("X-Amz-SignedHeaders") ?? "").split(";"));
    const unsignedBrowserHeaders = Object.keys(upload.headers)
      .map((header) => header.toLowerCase())
      .filter((header) => !signedHeaders.has(header));

    expect(unsignedBrowserHeaders).toEqual([]);
    expect(signedHeaders).not.toContain("content-length");
    expect(query.has("x-amz-meta-skitza-upload-token")).toBe(false);
    expect(query.has("x-amz-checksum-crc32")).toBe(false);
    expect(query.has("x-amz-sdk-checksum-algorithm")).toBe(false);
    expect(query.get("X-Amz-Content-Sha256")).toBe("UNSIGNED-PAYLOAD");
  });
});
