import {
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("~/server/storage/r2", () => ({
  BUCKETS: { audio: "isolated-test-audio" },
  getR2: () => storage,
}));

import {
  abortMultipartUploadAndVerifyAbsent,
  abortMultipartUploadAndObserve,
  exactObjectIsAbsent,
  listExactMultipartUploadIds,
  MULTIPART_TERMINAL_SEAL_CONTENT_TYPE,
  MULTIPART_TERMINAL_SEAL_METADATA,
  multipartTerminalSealFingerprint,
  putMultipartTerminalSeal,
  reconcileMultipartTerminalSeal,
  tokenBoundCompletedObjectCleanupMatches,
} from "./multipart-storage-recovery";

afterEach(() => {
  storage.send.mockReset();
});

describe("multipart storage recovery", () => {
  const sealIdentity = {
    key: "owned/exact.wav",
    uploadId: "server-upload-id",
    completionToken: "a".repeat(64),
    objectEtag: null,
  } as const;

  const sealObservation = {
    eTag: '"seal-etag"',
    sizeBytes: 1,
    contentType: MULTIPART_TERMINAL_SEAL_CONTENT_TYPE,
    completionToken: sealIdentity.completionToken,
    sealFingerprint: multipartTerminalSealFingerprint(sealIdentity),
  } as const;

  it("authorizes cleanup by token and ETag without trusting the claimed byte size", () => {
    const completionToken = "a".repeat(64);

    expect(
      tokenBoundCompletedObjectCleanupMatches({
        expectedEtag: null,
        expectedCompletionToken: completionToken,
        observedEtag: '"oversized-object"',
        observedCompletionToken: completionToken,
      }),
    ).toBe(true);
    expect(
      tokenBoundCompletedObjectCleanupMatches({
        expectedEtag: '"oversized-object"',
        expectedCompletionToken: completionToken,
        observedEtag: '"replacement"',
        observedCompletionToken: completionToken,
      }),
    ).toBe(false);
    expect(
      tokenBoundCompletedObjectCleanupMatches({
        expectedEtag: null,
        expectedCompletionToken: completionToken,
        observedEtag: '"oversized-object"',
        observedCompletionToken: "b".repeat(64),
      }),
    ).toBe(false);
  });

  it("seals after a late conditional completion wins the absent-key race", async () => {
    let object:
      | typeof sealObservation
      | Readonly<{
          eTag: string;
          sizeBytes: number;
          contentType: string;
          completionToken: string;
          sealFingerprint: undefined;
        }>
      | null = null;
    const events: string[] = [];
    let publishedEtag: string | null = null;

    const result = await reconcileMultipartTerminalSeal(sealIdentity, {
      head() {
        events.push(object === null ? "head-absent" : "head-present");
        return Promise.resolve(object);
      },
      publishCleanupEtag(exact) {
        events.push("journal-etag");
        publishedEtag = exact.objectEtag;
        return Promise.resolve(true);
      },
      putSeal({ replaceEtag }) {
        if (replaceEtag === null) {
          events.push("put-if-absent-conflict");
          object = {
            eTag: '"late-complete-etag"',
            sizeBytes: 100_000_001,
            contentType: "audio/wav",
            completionToken: sealIdentity.completionToken,
            sealFingerprint: undefined,
          };
          return Promise.reject(new Error("late conditional complete won"));
        }
        events.push("put-if-match");
        expect(replaceEtag).toBe('"late-complete-etag"');
        object = sealObservation;
        return Promise.resolve();
      },
    });

    expect(result).toEqual({ ...sealIdentity, objectEtag: '"late-complete-etag"' });
    expect(publishedEtag).toBe('"late-complete-etag"');
    expect(events).toEqual([
      "head-absent",
      "put-if-absent-conflict",
      "head-present",
      "journal-etag",
      "put-if-match",
      "head-present",
    ]);
  });

  it("accepts an ambiguously successful seal only after observing its fingerprint", async () => {
    let object: typeof sealObservation | null = null;
    let putCalls = 0;

    await expect(
      reconcileMultipartTerminalSeal(sealIdentity, {
        head: () => Promise.resolve(object),
        publishCleanupEtag: () => Promise.resolve(false),
        putSeal() {
          putCalls += 1;
          object = sealObservation;
          return Promise.reject(new Error("response lost after conditional put"));
        },
      }),
    ).resolves.toEqual(sealIdentity);
    expect(putCalls).toBe(1);
  });

  it("does not replace an object with a different completion token", async () => {
    let putCalls = 0;
    await expect(
      reconcileMultipartTerminalSeal(sealIdentity, {
        head: () =>
          Promise.resolve({
            eTag: '"unrelated"',
            sizeBytes: 1,
            contentType: "audio/wav",
            completionToken: "b".repeat(64),
            sealFingerprint: undefined,
          }),
        publishCleanupEtag: () => Promise.resolve(true),
        putSeal() {
          putCalls += 1;
          return Promise.resolve();
        },
      }),
    ).resolves.toBeNull();
    expect(putCalls).toBe(0);
  });

  it("writes the one-byte token-bound marker with exact conditional headers", async () => {
    storage.send.mockResolvedValue({ ETag: '"seal-etag"' });

    await putMultipartTerminalSeal({ ...sealIdentity, replaceEtag: null });
    await putMultipartTerminalSeal({ ...sealIdentity, replaceEtag: '"completed-etag"' });

    expect(storage.send).toHaveBeenCalledTimes(2);
    const absentCommand = storage.send.mock.calls[0]?.[0] as unknown;
    const replacementCommand = storage.send.mock.calls[1]?.[0] as unknown;
    if (
      !(absentCommand instanceof PutObjectCommand) ||
      !(replacementCommand instanceof PutObjectCommand)
    ) {
      throw new Error("Expected two concrete PutObject commands");
    }
    expect(absentCommand).toBeInstanceOf(PutObjectCommand);
    expect(absentCommand.input).toMatchObject({
      Key: sealIdentity.key,
      IfNoneMatch: "*",
      ContentLength: 1,
      ContentType: MULTIPART_TERMINAL_SEAL_CONTENT_TYPE,
      CacheControl: "no-store",
    });
    expect(absentCommand.input.Metadata).toMatchObject({
      "skitza-upload-token": sealIdentity.completionToken,
      [MULTIPART_TERMINAL_SEAL_METADATA]: multipartTerminalSealFingerprint(sealIdentity),
    });
    expect(replacementCommand.input).toMatchObject({
      IfMatch: '"completed-etag"',
      ContentLength: 1,
    });
  });

  it("exhaustively proves one exact object key is absent across sibling pages", async () => {
    let page = 0;
    storage.send.mockImplementation((command: unknown) => {
      expect(command).toBeInstanceOf(ListObjectsV2Command);
      page += 1;
      if (page === 1) {
        expect((command as ListObjectsV2Command).input).toMatchObject({
          Prefix: "owned/exact.wav",
        });
        return Promise.resolve({
          IsTruncated: true,
          Contents: [{ Key: "owned/exact.wav-sibling" }],
          NextContinuationToken: "next-page",
        });
      }
      expect((command as ListObjectsV2Command).input.ContinuationToken).toBe("next-page");
      return Promise.resolve({
        IsTruncated: false,
        Contents: [{ Key: "owned/exact.wav/child" }],
      });
    });

    await expect(exactObjectIsAbsent("owned/exact.wav")).resolves.toBe(true);
    expect(storage.send).toHaveBeenCalledTimes(2);
  });

  it("still exhausts the listing when the exact object exists", async () => {
    let page = 0;
    storage.send.mockImplementation((command: unknown) => {
      expect(command).toBeInstanceOf(ListObjectsV2Command);
      page += 1;
      return page === 1
        ? Promise.resolve({
            IsTruncated: true,
            Contents: [{ Key: "owned/exact.wav" }],
            NextContinuationToken: "next-page",
          })
        : Promise.resolve({
            IsTruncated: false,
            Contents: [{ Key: "owned/exact.wav-sibling" }],
          });
    });

    await expect(exactObjectIsAbsent("owned/exact.wav")).resolves.toBe(false);
    expect(storage.send).toHaveBeenCalledTimes(2);
  });

  it("fails closed on bucket errors and malformed object-list cursors", async () => {
    const missingBucket = new Error("missing bucket");
    missingBucket.name = "NoSuchBucket";
    storage.send.mockRejectedValueOnce(missingBucket);

    await expect(exactObjectIsAbsent("owned/exact.wav")).rejects.toBe(missingBucket);

    storage.send.mockResolvedValueOnce({
      IsTruncated: true,
      Contents: [],
    });
    await expect(exactObjectIsAbsent("owned/exact.wav")).rejects.toThrow(
      /object listing cursor was invalid/i,
    );
  });

  it("exhaustively discovers only upload ids for the exact pending key", async () => {
    let page = 0;
    storage.send.mockImplementation((command: unknown) => {
      expect(command).toBeInstanceOf(ListMultipartUploadsCommand);
      page += 1;
      if (page === 1) {
        return Promise.resolve({
          IsTruncated: true,
          Uploads: [
            { Key: "owned/exact.wav", UploadId: "upload-b" },
            { Key: "owned/exact.wav-sibling", UploadId: "ignored" },
          ],
          NextKeyMarker: "owned/exact.wav",
          NextUploadIdMarker: "upload-b",
        });
      }
      return Promise.resolve({
        IsTruncated: false,
        Uploads: [{ Key: "owned/exact.wav", UploadId: "upload-a" }],
      });
    });

    await expect(listExactMultipartUploadIds("owned/exact.wav")).resolves.toEqual([
      "upload-a",
      "upload-b",
    ]);
    expect(storage.send).toHaveBeenCalledTimes(2);
  });

  it("repeats abort until ListParts proves the exact upload is absent", async () => {
    let aborts = 0;
    let partChecks = 0;
    storage.send.mockImplementation((command: unknown) => {
      if (command instanceof AbortMultipartUploadCommand) {
        aborts += 1;
        return Promise.resolve({});
      }
      expect(command).toBeInstanceOf(ListPartsCommand);
      partChecks += 1;
      if (partChecks === 1) {
        return Promise.resolve({
          IsTruncated: false,
          Parts: [{ PartNumber: 1, ETag: '"part-etag"' }],
        });
      }
      const missing = new Error("missing upload");
      missing.name = "NoSuchUpload";
      return Promise.reject(missing);
    });

    await expect(
      abortMultipartUploadAndVerifyAbsent("owned/exact.wav", "server-issued-upload"),
    ).resolves.toBe(true);
    expect(aborts).toBe(2);
    expect(partChecks).toBe(2);
  });

  it("does not mistake a generic 404 or missing bucket for an absent upload", async () => {
    const missingBucket = new Error("missing bucket") as Error & {
      $metadata: { httpStatusCode: number };
    };
    missingBucket.name = "NoSuchBucket";
    missingBucket.$metadata = { httpStatusCode: 404 };
    storage.send.mockRejectedValue(missingBucket);

    await expect(
      abortMultipartUploadAndVerifyAbsent("owned/exact.wav", "server-issued-upload"),
    ).rejects.toMatchObject({ name: "NoSuchBucket" });
  });

  it("reports a successful remote abort as activity before stable cleanup", async () => {
    storage.send.mockImplementation((command: unknown) => {
      if (command instanceof AbortMultipartUploadCommand) return Promise.resolve({});
      expect(command).toBeInstanceOf(ListPartsCommand);
      const missing = new Error("missing upload");
      missing.name = "NoSuchUpload";
      return Promise.reject(missing);
    });

    await expect(
      abortMultipartUploadAndObserve("owned/exact.wav", "server-issued-upload"),
    ).resolves.toEqual({ absent: true, observedRemoteActivity: true });
  });
});
