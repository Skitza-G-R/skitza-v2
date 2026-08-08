import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import {
  createPrivateSongArtworkUpload,
  finalizePrivateSongArtworkUpload,
  reconcilePrivateSongArtworkDeletion,
} from "../storage";
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
  deleteFailure: Error | null = null;
  listFailure: Error | null = null;
  preserveObjectOnDelete = false;

  client(): S3Client {
    return {
      send: (command: unknown) => Promise.resolve(this.send(command)),
    } as unknown as S3Client;
  }

  private send(command: unknown): unknown {
    if (command instanceof HeadObjectCommand) {
      const object = this.objects.get(command.input.Key ?? "");
      if (!object || (command.input.IfMatch && command.input.IfMatch !== object.etag)) {
        throw Object.assign(new Error("not found"), {
          name: "NotFound",
          $metadata: { httpStatusCode: 404 },
        });
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
      if (!this.preserveObjectOnDelete) this.objects.delete(key);
      if (this.deleteFailure) throw this.deleteFailure;
      return {};
    }
    if (command instanceof ListObjectsV2Command) {
      if (this.listFailure) throw this.listFailure;
      const prefix = command.input.Prefix ?? "";
      return {
        IsTruncated: false,
        Contents: [...this.objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((Key) => ({ Key })),
      };
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

describe("private song artwork deletion reconciliation", () => {
  function storedFinalArtwork() {
    const value = fixture();
    const storage = new FakeArtworkStorage();
    const object = {
      body: PNG_BYTES,
      contentType: "image/png",
      etag: '"art-etag"',
    };
    storage.objects.set(value.finalKey, object);
    return {
      storage,
      value,
      identity: {
        key: value.finalKey,
        contentType: "image/png" as const,
        sizeBytes: object.body.byteLength,
        objectEtag: object.etag,
      },
    };
  }

  it("deletes only an exact immutable artwork identity and proves it is absent", async () => {
    const { storage, value, identity } = storedFinalArtwork();

    await expect(
      reconcilePrivateSongArtworkDeletion(identity, storage.client()),
    ).resolves.toBeUndefined();

    expect(storage.deletedKeys).toEqual([value.finalKey]);
    expect(storage.objects.has(value.finalKey)).toBe(false);
  });

  it("refuses an identity mismatch without issuing a delete", async () => {
    const { storage, value, identity } = storedFinalArtwork();

    await expect(
      reconcilePrivateSongArtworkDeletion(
        { ...identity, objectEtag: '"different-etag"' },
        storage.client(),
      ),
    ).rejects.toThrow("artwork changed before it could be deleted");

    expect(storage.deletedKeys).toEqual([]);
    expect(storage.objects.has(value.finalKey)).toBe(true);
  });

  it("accepts an ambiguous delete response only when the final HEAD proves absence", async () => {
    const { storage, value, identity } = storedFinalArtwork();
    storage.deleteFailure = new Error("provider response was lost");

    await expect(
      reconcilePrivateSongArtworkDeletion(identity, storage.client()),
    ).resolves.toBeUndefined();

    expect(storage.deletedKeys).toEqual([value.finalKey]);
    expect(storage.objects.has(value.finalKey)).toBe(false);
  });

  it("fails closed when an ambiguous delete leaves the exact object present", async () => {
    const { storage, value, identity } = storedFinalArtwork();
    storage.deleteFailure = new Error("provider response was lost");
    storage.preserveObjectOnDelete = true;

    await expect(reconcilePrivateSongArtworkDeletion(identity, storage.client())).rejects.toThrow(
      "artwork deletion could not be verified",
    );

    expect(storage.deletedKeys).toEqual([value.finalKey]);
    expect(storage.objects.has(value.finalKey)).toBe(true);
  });

  it("does not trust a flattened HEAD 404 when exact listing also fails", async () => {
    const { storage, identity } = storedFinalArtwork();
    storage.objects.clear();
    storage.listFailure = new Error("bucket unavailable");

    await expect(reconcilePrivateSongArtworkDeletion(identity, storage.client())).rejects.toThrow(
      "artwork could not be verified for deletion",
    );
  });
});
