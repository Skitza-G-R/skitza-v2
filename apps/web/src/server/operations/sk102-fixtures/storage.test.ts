import {
  AbortMultipartUploadCommand,
  DeleteObjectsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { emptySk102FixtureBucket } from "./storage";

describe("SK-102 isolated storage cleanup", () => {
  it("paginates object deletion and multipart aborts, then reads both states back", async () => {
    let objectListCall = 0;
    let multipartListCall = 0;
    const send = vi.fn((command: unknown): Promise<unknown> => {
      if (command instanceof ListObjectsV2Command) {
        objectListCall += 1;
        if (objectListCall === 1) {
          return Promise.resolve({
            Contents: [{ Key: "first" }, { Key: "second" }],
            IsTruncated: true,
            NextContinuationToken: "objects-page-2",
          });
        }
        if (objectListCall === 2) {
          return Promise.resolve({ Contents: [{ Key: "third" }], IsTruncated: false });
        }
        return Promise.resolve({ Contents: [], KeyCount: 0, IsTruncated: false });
      }
      if (command instanceof ListMultipartUploadsCommand) {
        multipartListCall += 1;
        if (multipartListCall === 1) {
          return Promise.resolve({
            Uploads: [{ Key: "pending-a", UploadId: "upload-a" }],
            IsTruncated: true,
            NextKeyMarker: "multipart-page-2",
            NextUploadIdMarker: "multipart-upload-page-2",
          });
        }
        if (multipartListCall === 2) {
          return Promise.resolve({
            Uploads: [{ Key: "pending-b", UploadId: "upload-b" }],
            IsTruncated: false,
          });
        }
        return Promise.resolve({ Uploads: [], IsTruncated: false });
      }
      if (
        command instanceof DeleteObjectsCommand ||
        command instanceof AbortMultipartUploadCommand
      ) {
        return Promise.resolve({});
      }
      return Promise.reject(new Error("Unexpected fake S3 command"));
    });

    await emptySk102FixtureBucket(
      { send: send as unknown as S3Client["send"] },
      "skitza-sk102-audio-fixture",
    );

    const deleteInputs = send.mock.calls.flatMap(([command]) =>
      command instanceof DeleteObjectsCommand
        ? [command.input.Delete?.Objects?.map(({ Key }) => Key)]
        : [],
    );
    expect(deleteInputs).toEqual([["first", "second"], ["third"]]);

    const abortInputs = send.mock.calls.flatMap(([command]) =>
      command instanceof AbortMultipartUploadCommand
        ? [{ key: command.input.Key, uploadId: command.input.UploadId }]
        : [],
    );
    expect(abortInputs).toEqual([
      { key: "pending-a", uploadId: "upload-a" },
      { key: "pending-b", uploadId: "upload-b" },
    ]);

    const objectLists = send.mock.calls.flatMap(([command]) =>
      command instanceof ListObjectsV2Command ? [command.input] : [],
    );
    expect(objectLists).toHaveLength(3);
    expect(objectLists[1]?.ContinuationToken).toBe("objects-page-2");
    expect(objectLists[2]?.MaxKeys).toBe(1);

    const multipartLists = send.mock.calls.flatMap(([command]) =>
      command instanceof ListMultipartUploadsCommand ? [command.input] : [],
    );
    expect(multipartLists).toHaveLength(4);
    expect(multipartLists[1]).toMatchObject({
      KeyMarker: "multipart-page-2",
      UploadIdMarker: "multipart-upload-page-2",
    });
    expect(multipartLists[3]?.MaxUploads).toBe(1);
  });

  it("fails closed when a multipart page omits an upload identity", async () => {
    const send = vi.fn((command: unknown): Promise<unknown> => {
      if (command instanceof ListMultipartUploadsCommand) {
        return Promise.resolve({
          Uploads: [{ Key: "pending-without-id" }],
          IsTruncated: false,
        });
      }
      return Promise.reject(new Error("Unexpected fake S3 command"));
    });

    await expect(
      emptySk102FixtureBucket(
        { send: send as unknown as S3Client["send"] },
        "skitza-sk102-audio-fixture",
      ),
    ).rejects.toThrow("SK102_FIXTURE_MULTIPART_IDENTITY_INVALID");
  });
});
