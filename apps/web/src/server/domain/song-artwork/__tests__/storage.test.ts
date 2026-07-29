import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { createPrivateSongArtworkUpload, finalizePrivateSongArtworkUpload } from "../storage";
import {
  createSongArtworkUploadToken,
  songArtworkObjectKeys,
  songArtworkRevisionFingerprint,
} from "../tokens";

type StoredObject = {
  body: Uint8Array;
  contentType: string;
  etag: string;
};

class FakeArtworkStorage {
  readonly objects = new Map<string, StoredObject>();
  readonly copyInputs: CopyObjectCommand["input"][] = [];
  readonly deletedKeys: string[] = [];

  client(): S3Client {
    return {
      send: (command: unknown) => Promise.resolve(this.send(command)),
    } as unknown as S3Client;
  }

  private send(command: unknown): unknown {
    if (command instanceof HeadObjectCommand) {
      const object = this.objects.get(command.input.Key ?? "");
      if (!object || (command.input.IfMatch && command.input.IfMatch !== object.etag)) {
        throw new Error("not found");
      }
      return {
        ContentType: object.contentType,
        ContentLength: object.body.byteLength,
        ETag: object.etag,
      };
    }
    if (command instanceof GetObjectCommand) {
      const object = this.objects.get(command.input.Key ?? "");
      if (!object || (command.input.IfMatch && command.input.IfMatch !== object.etag)) {
        throw new Error("not found");
      }
      return {
        Body: {
          transformToByteArray: () => Promise.resolve(object.body.slice(0, 32)),
        },
      };
    }
    if (command instanceof CopyObjectCommand) {
      expect(Reflect.get(command as object, "destinationCondition")).toEqual({
        header: "cf-copy-destination-if-none-match",
        value: "*",
      });
      this.copyInputs.push(command.input);
      const source = [...this.objects.entries()].find(([key]) =>
        command.input.CopySource?.endsWith(key),
      );
      if (!source) throw new Error("source not found");
      const destinationKey = command.input.Key ?? "";
      if (this.objects.has(destinationKey)) {
        throw new Error("destination exists");
      }
      const copied = { ...source[1], body: source[1].body.slice() };
      this.objects.set(destinationKey, copied);
      return { CopyObjectResult: { ETag: copied.etag } };
    }
    if (command instanceof DeleteObjectCommand) {
      const key = command.input.Key ?? "";
      this.deletedKeys.push(key);
      this.objects.delete(key);
      return {};
    }
    throw new Error("unsupported command");
  }
}

const SECRET = "song-artwork-test-secret-at-least-20";
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function fixture() {
  const payload = createSongArtworkUploadToken(SECRET, {
    baseRevision: songArtworkRevisionFingerprint(SECRET, null),
    producerId: "10000000-0000-4000-8000-000000000001",
    trackId: "20000000-0000-4000-8000-000000000002",
    originalFileName: "cover.png",
    contentType: "image/png",
    sizeBytes: PNG_BYTES.byteLength,
  }).payload;
  return { payload, ...songArtworkObjectKeys(SECRET, payload) };
}

describe("private song artwork finalization", () => {
  it("presigns a browser PUT without an empty-body checksum and signs its type", async () => {
    const value = fixture();
    const client = new S3Client({
      region: "auto",
      endpoint: "https://example.r2.cloudflarestorage.com",
      credentials: {
        accessKeyId: "unit-test-access-key",
        secretAccessKey: "unit-test-secret-key",
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
    });

    const upload = await createPrivateSongArtworkUpload(SECRET, value.payload, client);
    const url = new URL(upload.uploadUrl);

    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(url.searchParams.has("x-amz-sdk-checksum-algorithm")).toBe(false);
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain("content-type");
  });

  it("checks the browser-observed ETag and conditionally creates one final object", async () => {
    const value = fixture();
    const storage = new FakeArtworkStorage();
    storage.objects.set(value.stagingKey, {
      body: PNG_BYTES,
      contentType: "image/png",
      etag: '"art-etag"',
    });

    const result = await finalizePrivateSongArtworkUpload(
      SECRET,
      value.payload,
      '"art-etag"',
      storage.client(),
    );

    expect(result).toMatchObject({
      storageKey: value.finalKey,
      contentType: "image/png",
      sizeBytes: PNG_BYTES.byteLength,
      objectEtag: '"art-etag"',
    });
    expect(storage.copyInputs[0]).toMatchObject({
      Key: value.finalKey,
      CopySourceIfMatch: '"art-etag"',
    });
    expect(storage.copyInputs[0]?.CopySource).toMatch(/^\//);
    expect(storage.copyInputs[0]?.IfNoneMatch).toBeUndefined();
    expect(storage.objects.has(value.stagingKey)).toBe(true);
    expect(storage.objects.has(value.finalKey)).toBe(true);
  });

  it("rejects a stale completion after another upload replaced staging", async () => {
    const value = fixture();
    const storage = new FakeArtworkStorage();
    storage.objects.set(value.stagingKey, {
      body: PNG_BYTES,
      contentType: "image/png",
      etag: '"newer-etag"',
    });

    await expect(
      finalizePrivateSongArtworkUpload(SECRET, value.payload, '"stale-etag"', storage.client()),
    ).rejects.toThrow("artwork changed");
    expect(storage.copyInputs).toHaveLength(0);
  });

  it("reconciles an immutable final copy whose provider ETag differs from staging", async () => {
    const value = fixture();
    const storage = new FakeArtworkStorage();
    storage.objects.set(value.stagingKey, {
      body: PNG_BYTES,
      contentType: "image/png",
      etag: '"source-etag"',
    });
    storage.objects.set(value.finalKey, {
      body: PNG_BYTES,
      contentType: "image/png",
      etag: '"copied-etag"',
    });

    await expect(
      finalizePrivateSongArtworkUpload(SECRET, value.payload, '"source-etag"', storage.client()),
    ).resolves.toMatchObject({
      storageKey: value.finalKey,
      objectEtag: '"copied-etag"',
    });
    expect(storage.copyInputs).toHaveLength(0);
    expect(storage.objects.has(value.stagingKey)).toBe(true);
  });

  it("rejects bytes whose signature does not match the allowed image type", async () => {
    const value = fixture();
    const storage = new FakeArtworkStorage();
    storage.objects.set(value.stagingKey, {
      body: new TextEncoder().encode("<html>not an image</html>"),
      contentType: "image/png",
      etag: '"bad-etag"',
    });

    await expect(
      finalizePrivateSongArtworkUpload(
        SECRET,
        { ...value.payload, sizeBytes: 25 },
        '"bad-etag"',
        storage.client(),
      ),
    ).rejects.toThrow("not a valid JPG, PNG, or WebP");
    expect(storage.copyInputs).toHaveLength(0);
  });
});
