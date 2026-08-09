import { describe, expect, it, vi } from "vitest";

import {
  FirstVersionUploadError,
  assertFirstVersionAudioFile,
  assertFirstVersionUploadDestination,
  createAudioFinalizationDigest,
  createStagedAudioRequestDigest,
  presignFirstVersionUploadWithCompensation,
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

  it("enforces the same decimal 100MB cap as later Versions", () => {
    expect(() => {
      assertFirstVersionAudioFile({
        filename: "mix.wav",
        sizeBytes: 100_000_000,
        contentType: "audio/wav",
      });
    }).not.toThrow();
    expect(() => {
      assertFirstVersionAudioFile({
        filename: "mix.wav",
        sizeBytes: 100_000_001,
        contentType: "audio/wav",
      });
    }).toThrow(
      expect.objectContaining<Partial<FirstVersionUploadError>>({
        code: "BAD_REQUEST",
        message: "File too large. Max 100MB.",
      }),
    );
  });

  it.each([
    ["mix.wav", "audio/wav"],
    ["mix.mp3", "audio/mpeg"],
    ["mix.flac", "audio/flac"],
    ["mix.m4a", "audio/mp4"],
    ["mix.aiff", "audio/aiff"],
  ])(
    "accepts the supported audio file %s before destination metadata exists",
    (filename, contentType) => {
      expect(() => {
        assertFirstVersionAudioFile({ filename, sizeBytes: 4_096, contentType });
      }).not.toThrow();
    },
  );

  it("uses only immutable file identity for a staged-upload retry", () => {
    const first = createStagedAudioRequestDigest({
      filename: "mix.flac",
      sizeBytes: 4_096,
      contentType: "audio/flac",
    });
    const same = createStagedAudioRequestDigest({
      filename: "mix.flac",
      sizeBytes: 4_096,
      contentType: " AUDIO/FLAC ",
    });
    const replacement = createStagedAudioRequestDigest({
      filename: "mix-v2.flac",
      sizeBytes: 4_096,
      contentType: "audio/flac",
    });

    expect(first).toBe(same);
    expect(replacement).not.toBe(first);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("freezes destination and durable metadata separately from the staged file", () => {
    const newSong = createAudioFinalizationDigest({
      createsTrack: true,
      projectId: "project-1",
      purchaseId: "purchase-1",
      trackId: "track-1",
      title: "Night Drive",
      artist: null,
      label: "V1",
      description: null,
      durationMs: 120_000,
    });
    const retry = createAudioFinalizationDigest({
      createsTrack: true,
      projectId: "project-1",
      purchaseId: "purchase-1",
      trackId: "track-1",
      title: "Night Drive",
      artist: null,
      label: "V1",
      description: null,
      durationMs: 120_000,
    });
    const laterVersion = createAudioFinalizationDigest({
      createsTrack: false,
      projectId: "project-1",
      purchaseId: "purchase-1",
      trackId: "track-1",
      title: "Night Drive",
      artist: null,
      label: "V1",
      description: null,
      durationMs: 120_000,
    });

    expect(retry).toBe(newSong);
    expect(laterVersion).not.toBe(newSong);
  });

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

  it("compensates only a newly inserted intent when presigning fails", async () => {
    const presignFailure = new Error("safe presign failure");
    const compensate = vi.fn(() => Promise.resolve());

    await expect(
      presignFirstVersionUploadWithCompensation({
        newlyInserted: true,
        presign: () => Promise.reject(presignFailure),
        compensate,
      }),
    ).rejects.toBe(presignFailure);

    expect(compensate).toHaveBeenCalledOnce();

    await expect(
      presignFirstVersionUploadWithCompensation({
        newlyInserted: false,
        presign: () => Promise.reject(presignFailure),
        compensate,
      }),
    ).rejects.toBe(presignFailure);
    expect(compensate).toHaveBeenCalledOnce();
  });

  it("preserves the typed presign failure if compensation itself fails", async () => {
    const presignFailure = new Error("safe presign failure");

    await expect(
      presignFirstVersionUploadWithCompensation({
        newlyInserted: true,
        presign: () => Promise.reject(presignFailure),
        compensate: () => Promise.reject(new Error("database cleanup failed")),
      }),
    ).rejects.toBe(presignFailure);
  });
});
