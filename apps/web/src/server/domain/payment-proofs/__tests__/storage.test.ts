import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import {
  assertExpectedProofObjectMetadata,
  finalizePrivateProofUpload,
  ProofStorageError,
} from "../storage";
import { createProofUploadToken, proofObjectKeys } from "../tokens";

type StoredObject = {
  body: Uint8Array;
  contentType: string;
  etag: string;
};

class FakeProofStorage {
  readonly objects = new Map<string, StoredObject>();
  readonly copyInputs: CopyObjectCommand["input"][] = [];
  readonly deletedKeys: string[] = [];
  raceCopy = false;

  client(): S3Client {
    return {
      send: (command: unknown) => Promise.resolve(this.send(command)),
    } as unknown as S3Client;
  }

  private send(command: unknown): unknown {
    if (command instanceof HeadObjectCommand) {
      const key = command.input.Key ?? "";
      const object = this.objects.get(key);
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
      const key = command.input.Key ?? "";
      const object = this.objects.get(key);
      if (!object || (command.input.IfMatch && command.input.IfMatch !== object.etag)) {
        throw new Error("not found");
      }
      return { Body: { transformToByteArray: () => Promise.resolve(object.body.slice(0, 32)) } };
    }

    if (command instanceof CopyObjectCommand) {
      this.copyInputs.push(command.input);
      const source = [...this.objects.entries()].find(([key]) =>
        command.input.CopySource?.endsWith(key),
      );
      if (!source) throw new Error("source not found");
      const sourceObject = source[1];
      const destinationKey = command.input.Key ?? "";
      if (this.raceCopy) {
        this.objects.set(destinationKey, { ...sourceObject, body: sourceObject.body.slice() });
        throw new Error("conditional copy conflict");
      }
      if (command.input.IfNoneMatch === "*" && this.objects.has(destinationKey)) {
        throw new Error("destination exists");
      }
      this.objects.set(destinationKey, { ...sourceObject, body: sourceObject.body.slice() });
      return { CopyObjectResult: { ETag: sourceObject.etag } };
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

const SERVER_SECRET = "unit-test-private-proof-signing-material";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nprivate proof");

function proofFixture() {
  const payload = createProofUploadToken(SERVER_SECRET, {
    purchaseId: "purchase-1",
    installmentId: "installment-1",
    viewerClerkUserId: "artist-1",
    originalFileName: "receipt.pdf",
    contentType: "application/pdf",
    sizeBytes: PDF_BYTES.byteLength,
  }).payload;
  return { payload, ...proofObjectKeys(SERVER_SECRET, payload.uploadId) };
}

describe("private proof object finalization metadata", () => {
  it("requires the exact signed type, size, and immutable ETag", () => {
    expect(
      assertExpectedProofObjectMetadata(
        { contentType: "application/pdf", sizeBytes: 1_024, objectEtag: '"etag-1"' },
        { contentType: "application/pdf", sizeBytes: 1_024 },
      ),
    ).toEqual({ contentType: "application/pdf", sizeBytes: 1_024, objectEtag: '"etag-1"' });

    expect(() =>
      assertExpectedProofObjectMetadata(
        { contentType: "image/png", sizeBytes: 1_024, objectEtag: '"etag-1"' },
        { contentType: "application/pdf", sizeBytes: 1_024 },
      ),
    ).toThrow(ProofStorageError);
    expect(() =>
      assertExpectedProofObjectMetadata(
        { contentType: "application/pdf", sizeBytes: 1_025, objectEtag: '"etag-1"' },
        { contentType: "application/pdf", sizeBytes: 1_024 },
      ),
    ).toThrow(ProofStorageError);
    expect(() =>
      assertExpectedProofObjectMetadata(
        { contentType: "application/pdf", sizeBytes: 1_024, objectEtag: "" },
        { contentType: "application/pdf", sizeBytes: 1_024 },
      ),
    ).toThrow(ProofStorageError);
  });

  it("creates the immutable final object with a destination precondition", async () => {
    const fixture = proofFixture();
    const storage = new FakeProofStorage();
    storage.objects.set(fixture.stagingKey, {
      body: PDF_BYTES,
      contentType: "application/pdf",
      etag: '"etag-1"',
    });

    const result = await finalizePrivateProofUpload(
      SERVER_SECRET,
      fixture.payload,
      storage.client(),
    );

    expect(result).toMatchObject({ storageKey: fixture.finalKey, objectEtag: '"etag-1"' });
    expect(storage.copyInputs).toHaveLength(1);
    expect(storage.copyInputs[0]).toMatchObject({
      Key: fixture.finalKey,
      CopySourceIfMatch: '"etag-1"',
      IfNoneMatch: "*",
    });
    expect(storage.objects.has(fixture.stagingKey)).toBe(false);
    expect(storage.objects.has(fixture.finalKey)).toBe(true);
  });

  it("preserves an existing final when a valid upload URL is replayed", async () => {
    const fixture = proofFixture();
    const storage = new FakeProofStorage();
    storage.objects.set(fixture.finalKey, {
      body: PDF_BYTES,
      contentType: "application/pdf",
      etag: '"accepted-etag"',
    });
    storage.objects.set(fixture.stagingKey, {
      body: new TextEncoder().encode("%PDF-1.7\ndifferent proof"),
      contentType: "application/pdf",
      etag: '"replayed-etag"',
    });

    const result = await finalizePrivateProofUpload(
      SERVER_SECRET,
      fixture.payload,
      storage.client(),
    );

    expect(result.objectEtag).toBe('"accepted-etag"');
    expect(storage.copyInputs).toHaveLength(0);
    expect(storage.objects.get(fixture.finalKey)?.etag).toBe('"accepted-etag"');
    expect(storage.deletedKeys).toEqual([fixture.stagingKey]);
  });

  it("recovers the winner of concurrent finalization without deleting it", async () => {
    const fixture = proofFixture();
    const storage = new FakeProofStorage();
    storage.raceCopy = true;
    storage.objects.set(fixture.stagingKey, {
      body: PDF_BYTES,
      contentType: "application/pdf",
      etag: '"race-etag"',
    });

    const result = await finalizePrivateProofUpload(
      SERVER_SECRET,
      fixture.payload,
      storage.client(),
    );

    expect(result).toMatchObject({ storageKey: fixture.finalKey, objectEtag: '"race-etag"' });
    expect(storage.copyInputs[0]?.IfNoneMatch).toBe("*");
    expect(storage.objects.has(fixture.finalKey)).toBe(true);
    expect(storage.deletedKeys).not.toContain(fixture.finalKey);
  });
});
