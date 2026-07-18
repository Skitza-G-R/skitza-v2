import {
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
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
} from "./multipart-storage-recovery";

afterEach(() => {
  storage.send.mockReset();
});

describe("multipart storage recovery", () => {
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
