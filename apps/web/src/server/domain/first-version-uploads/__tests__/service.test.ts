import { describe, expect, it } from "vitest";

import {
  FirstVersionUploadError,
  assertFirstVersionUploadDestination,
  verifyFirstVersionObject,
} from "../service";

describe("first Version upload boundary", () => {
  const completionToken = "a".repeat(64);
  const destination = {
    producerId: "producer-1",
    projectId: "project-1",
    purchaseId: "purchase-1",
    projectProducerId: "producer-1",
    projectLifecycleStatus: "active" as const,
    purchaseProducerId: "producer-1",
    purchaseProjectId: "project-1",
    purchaseLifecycleStatus: "active" as const,
    includedSongSpaces: 2,
    allocatedSongSpaces: 1,
  };

  it("accepts an active producer-owned Project and internal purchase link", () => {
    expect(
      assertFirstVersionUploadDestination(destination, {
        producerId: "producer-1",
        projectId: "project-1",
      }),
    ).toEqual(destination);
  });

  it.each(["waiting_for_payment", "paused", "completed", "canceled"] as const)(
    "rejects a %s Project before any Song is created",
    (projectLifecycleStatus) => {
      expect(() =>
        assertFirstVersionUploadDestination(
          { ...destination, projectLifecycleStatus },
          { producerId: "producer-1", projectId: "project-1" },
        ),
      ).toThrow(expect.objectContaining<Partial<FirstVersionUploadError>>({ code: "INACTIVE" }));
    },
  );

  it("reports an inactive purchase without incorrectly blaming the active Project", () => {
    expect(() =>
      assertFirstVersionUploadDestination(
        { ...destination, purchaseLifecycleStatus: "waiting_for_payment" },
        { producerId: "producer-1", projectId: "project-1" },
      ),
    ).toThrow(
      expect.objectContaining<Partial<FirstVersionUploadError>>({
        code: "INACTIVE",
        message: "This Project needs an active Song purchase before you can upload a new Song",
      }),
    );
  });

  it("preserves the purchased Song-capacity guard", () => {
    expect(() =>
      assertFirstVersionUploadDestination(
        { ...destination, allocatedSongSpaces: 2 },
        { producerId: "producer-1", projectId: "project-1" },
      ),
    ).toThrow(
      expect.objectContaining<Partial<FirstVersionUploadError>>({
        code: "CONFLICT",
        message: "This Project has no available purchased Song space",
      }),
    );
  });

  it("verifies the exact uploaded object identity before Song + V1 creation", () => {
    expect(
      verifyFirstVersionObject({
        expectedSizeBytes: 4_096,
        expectedContentType: "audio/wav",
        expectedCompletionToken: completionToken,
        observedSizeBytes: 4_096,
        observedContentType: "audio/wav",
        observedCompletionToken: completionToken,
        observedEtag: '"etag-1"',
      }),
    ).toEqual({ sizeBytes: 4_096, contentType: "audio/wav", objectEtag: '"etag-1"' });
  });

  it("rejects an object with mismatched size or server token", () => {
    expect(() =>
      verifyFirstVersionObject({
        expectedSizeBytes: 4_096,
        expectedContentType: "audio/wav",
        expectedCompletionToken: completionToken,
        observedSizeBytes: 2_048,
        observedContentType: "audio/wav",
        observedCompletionToken: "different",
        observedEtag: '"etag-1"',
      }),
    ).toThrow(expect.objectContaining<Partial<FirstVersionUploadError>>({ code: "MISMATCH" }));
  });
});
