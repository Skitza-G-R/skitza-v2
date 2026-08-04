import { UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
});
