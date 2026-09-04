import { describe, expect, it, vi } from "vitest";

import {
  computeStoredAudioIdentityFingerprint,
  evaluateStoredAudioDeletionPolicy,
  monotonicStoredAudioDeletionTime,
  LYRICS_MAX_LENGTH,
  normalizeArtistCredit,
  normalizeLyrics,
  normalizeSongTitle,
  normalizeVersionLabel,
  planSongArchiveChange,
  reconcileExactStoredAudioDeletion,
  requireHistorySafeStoredAudioIdentity,
  storedAudioDeletionOperationDigest,
  type ExactAudioStoragePort,
  type ExactAudioStorageObservation,
  type StoredAudioDeletionCandidate,
  type StoredAudioIdentity,
} from "../service";

const version = (
  versionId: string,
  uploadedAt: string,
  producerMarkedFinalAt: Date | null = null,
): StoredAudioDeletionCandidate => ({
  versionId,
  uploadedAt: new Date(uploadedAt),
  producerMarkedFinalAt,
});

const storedIdentity = (
  overrides: Partial<Omit<StoredAudioIdentity, "fingerprint">> = {},
): StoredAudioIdentity => {
  const identity = {
    key: "audio/producer-1/version-1/object-1.mp3",
    objectEtag: '"etag-1"',
    sizeBytes: 1_024,
    ...overrides,
  };
  return {
    ...identity,
    fingerprint: computeStoredAudioIdentityFingerprint(identity),
  };
};

describe("song metadata normalization", () => {
  it("trims required song titles and version labels", () => {
    expect(normalizeSongTitle("  Midnight Drive  ")).toBe("Midnight Drive");
    expect(normalizeVersionLabel("  Final mix  ")).toBe("Final mix");
  });

  it("normalizes an omitted or blank artist credit to null", () => {
    expect(normalizeArtistCredit(undefined)).toBeNull();
    expect(normalizeArtistCredit(null)).toBeNull();
    expect(normalizeArtistCredit("   ")).toBeNull();
    expect(normalizeArtistCredit("  Maya Stone  ")).toBe("Maya Stone");
  });

  it.each([
    ["blank song title", () => normalizeSongTitle("   ")],
    ["long song title", () => normalizeSongTitle("s".repeat(121))],
    ["long artist credit", () => normalizeArtistCredit("a".repeat(121))],
    ["blank version label", () => normalizeVersionLabel("\n\t")],
    ["long version label", () => normalizeVersionLabel("v".repeat(41))],
  ])("rejects a %s", (_label, normalize) => {
    expect(normalize).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});

describe("planSongArchiveChange", () => {
  const requestedAt = new Date("2026-07-19T10:00:00.000Z");

  it("creates an archive timestamp once and preserves it on a repeated archive", () => {
    const first = planSongArchiveChange({
      currentArchivedAt: null,
      intent: "archive",
      changedAt: requestedAt,
    });
    expect(first).toEqual({ changed: true, nextArchivedAt: requestedAt });
    expect(first.nextArchivedAt).not.toBe(requestedAt);

    const repeated = planSongArchiveChange({
      currentArchivedAt: first.nextArchivedAt,
      intent: "archive",
      changedAt: new Date("2026-07-20T10:00:00.000Z"),
    });
    expect(repeated).toEqual({ changed: false, nextArchivedAt: requestedAt });
  });

  it("restores once and makes repeated restore a no-op", () => {
    expect(
      planSongArchiveChange({
        currentArchivedAt: requestedAt,
        intent: "restore",
        changedAt: new Date("2026-07-20T10:00:00.000Z"),
      }),
    ).toEqual({ changed: true, nextArchivedAt: null });
    expect(
      planSongArchiveChange({
        currentArchivedAt: null,
        intent: "restore",
        changedAt: new Date("2026-07-20T10:00:00.000Z"),
      }),
    ).toEqual({ changed: false, nextArchivedAt: null });
  });
});

describe("monotonicStoredAudioDeletionTime", () => {
  const deletionTimes = (
    overrides: Partial<Parameters<typeof monotonicStoredAudioDeletionTime>[0]> = {},
  ): Parameters<typeof monotonicStoredAudioDeletionTime>[0] => ({
    requestedAt: new Date("2026-07-19T10:00:00.000Z"),
    projectUpdatedAt: new Date("2026-07-18T10:00:00.000Z"),
    songReleasedAt: null,
    songArchivedAt: null,
    portfolioPublishedAt: null,
    versionUploadedAt: new Date("2026-07-17T10:00:00.000Z"),
    versionMarkedFinalAt: null,
    priorAudioDeletedAt: null,
    linkCreatedAt: null,
    linkEnabledAt: null,
    linkDisabledAt: null,
    linkUpdatedAt: null,
    latestPublicEventAt: null,
    ...overrides,
  });

  it("records an older delete after the later release that authorized it", () => {
    const requestedAt = new Date("2026-07-19T10:00:00.000Z");
    const releasedAt = new Date("2026-07-20T10:00:00.000Z");

    const effectiveAt = monotonicStoredAudioDeletionTime(
      deletionTimes({
        requestedAt,
        projectUpdatedAt: releasedAt,
        songReleasedAt: releasedAt,
        songArchivedAt: new Date("2026-07-20T09:58:00.000Z"),
        versionMarkedFinalAt: new Date("2026-07-20T09:59:00.000Z"),
      }),
    );

    expect(effectiveAt).toEqual(releasedAt);
    expect(effectiveAt).not.toBe(releasedAt);
  });

  it("fails safely for invalid request or stored timestamps", () => {
    expect(() =>
      monotonicStoredAudioDeletionTime(
        deletionTimes({ requestedAt: new Date(Number.NaN) }),
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(() =>
      monotonicStoredAudioDeletionTime(
        deletionTimes({ projectUpdatedAt: new Date(Number.NaN) }),
      ),
    ).toThrow(expect.objectContaining({ code: "INTEGRITY_ERROR" }));
  });
});

describe("evaluateStoredAudioDeletionPolicy", () => {
  const storedVersions = [
    version("version-1", "2026-07-01T10:00:00.000Z"),
    version("version-2", "2026-07-02T10:00:00.000Z", new Date("2026-07-03T10:00:00Z")),
    version("version-3", "2026-07-04T10:00:00.000Z"),
  ];

  it("allows an older, non-final audio deletion before release", () => {
    expect(
      evaluateStoredAudioDeletionPolicy({
        targetVersionId: "version-1",
        isReleased: false,
        storedVersions,
      }),
    ).toEqual({
      allowed: true,
      protections: [],
      nextPlaybackVersionId: "version-3",
    });
  });

  it("protects the newest/current audio before release", () => {
    expect(
      evaluateStoredAudioDeletionPolicy({
        targetVersionId: "version-3",
        isReleased: false,
        storedVersions,
      }),
    ).toEqual({
      allowed: false,
      protections: ["CURRENT_STORED_AUDIO"],
      nextPlaybackVersionId: null,
    });
  });

  it("protects producer-marked-final audio before release", () => {
    expect(
      evaluateStoredAudioDeletionPolicy({
        targetVersionId: "version-2",
        isReleased: false,
        storedVersions,
      }),
    ).toEqual({
      allowed: false,
      protections: ["PRODUCER_FINAL_AUDIO"],
      nextPlaybackVersionId: null,
    });
  });

  it("protects the last stored audio before release", () => {
    const decision = evaluateStoredAudioDeletionPolicy({
      targetVersionId: "version-only",
      isReleased: false,
      storedVersions: [version("version-only", "2026-07-01T10:00:00.000Z")],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.protections).toEqual(["LAST_STORED_AUDIO", "CURRENT_STORED_AUDIO"]);
  });

  it("allows current, final, and last audio after release and reports the fallback", () => {
    expect(
      evaluateStoredAudioDeletionPolicy({
        targetVersionId: "version-3",
        isReleased: true,
        storedVersions,
      }),
    ).toEqual({
      allowed: true,
      protections: [],
      nextPlaybackVersionId: "version-2",
    });
    expect(
      evaluateStoredAudioDeletionPolicy({
        targetVersionId: "version-only",
        isReleased: true,
        storedVersions: [
          version("version-only", "2026-07-01T10:00:00.000Z", new Date("2026-07-02T10:00:00.000Z")),
        ],
      }),
    ).toEqual({ allowed: true, protections: [], nextPlaybackVersionId: null });
  });

  it("fails closed when the target is not in the locked stored-audio snapshot", () => {
    expect(() =>
      evaluateStoredAudioDeletionPolicy({
        targetVersionId: "missing",
        isReleased: true,
        storedVersions,
      }),
    ).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });
});

describe("storedAudioDeletionOperationDigest", () => {
  const intent = {
    producerId: "producer-1",
    trackId: "track-1",
    purchaseId: "purchase-1",
    versionId: "version-1",
    actorClerkUserId: "user-1",
  };

  it("is stable for the same exact deletion intent", () => {
    const first = storedAudioDeletionOperationDigest(intent);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(storedAudioDeletionOperationDigest({ ...intent })).toBe(first);
  });

  it.each([
    ["producer", { producerId: "producer-2" }],
    ["track", { trackId: "track-2" }],
    ["purchase", { purchaseId: "purchase-2" }],
    ["version", { versionId: "version-2" }],
    ["actor", { actorClerkUserId: "user-2" }],
  ])("changes when the %s scope changes", (_label, change) => {
    expect(storedAudioDeletionOperationDigest({ ...intent, ...change })).not.toBe(
      storedAudioDeletionOperationDigest(intent),
    );
  });
});

describe("requireHistorySafeStoredAudioIdentity", () => {
  it("accepts a complete retained identity without requiring a playable URL", () => {
    const identity = storedIdentity();
    expect(
      requireHistorySafeStoredAudioIdentity({
        key: identity.key,
        objectEtag: identity.objectEtag,
        sizeBytes: identity.sizeBytes,
        fingerprint: identity.fingerprint,
      }),
    ).toEqual(identity);
  });

  it.each([
    ["missing key", { key: null }],
    ["missing ETag", { objectEtag: null }],
    ["invalid size", { sizeBytes: 0 }],
    ["wrong fingerprint", { fingerprint: "sha256:wrong" }],
  ])("rejects a history row with %s", (_label, override) => {
    expect(() =>
      requireHistorySafeStoredAudioIdentity({ ...storedIdentity(), ...override }),
    ).toThrow(expect.objectContaining({ code: "INTEGRITY_ERROR" }));
  });
});

describe("reconcileExactStoredAudioDeletion", () => {
  it("conditionally erases the matching object, removes its marker, and proves absence", async () => {
    const identity = storedIdentity();
    let observation: ExactAudioStorageObservation = {
      kind: "present",
      objectEtag: identity.objectEtag,
      sizeBytes: identity.sizeBytes,
    };
    const conditionallyEraseExactObject = vi.fn(() => {
      observation = {
        kind: "erased_marker",
        deletionFingerprint: identity.fingerprint,
      };
      return Promise.resolve();
    });
    const deleteErasedMarker = vi.fn(() => {
      observation = { kind: "absent" };
      return Promise.resolve();
    });
    const port: ExactAudioStoragePort = {
      observeExactObject: vi.fn(() => Promise.resolve(observation)),
      conditionallyEraseExactObject,
      deleteErasedMarker,
    };

    await expect(reconcileExactStoredAudioDeletion(port, identity)).resolves.toEqual({
      kind: "deleted",
    });
    expect(conditionallyEraseExactObject).toHaveBeenCalledWith({
      key: identity.key,
      ifMatch: identity.objectEtag,
      deletionFingerprint: identity.fingerprint,
    });
    expect(deleteErasedMarker).toHaveBeenCalledExactlyOnceWith({ key: identity.key });
  });

  it("lets two reconcilers converge without deleting a replacement object", async () => {
    const identity = storedIdentity();
    let observation: ExactAudioStorageObservation = {
      kind: "present",
      objectEtag: identity.objectEtag,
      sizeBytes: identity.sizeBytes,
    };
    let initialObservers = 0;
    let releaseInitialObservers: (() => void) | null = null;
    const initialObserverBarrier = new Promise<void>((resolve) => {
      releaseInitialObservers = resolve;
    });
    const deletedKinds: ExactAudioStorageObservation["kind"][] = [];

    const port: ExactAudioStoragePort = {
      observeExactObject: vi.fn(async () => {
        if (observation.kind === "present" && initialObservers < 2) {
          initialObservers += 1;
          if (initialObservers === 2) releaseInitialObservers?.();
          await initialObserverBarrier;
          return {
            kind: "present" as const,
            objectEtag: identity.objectEtag,
            sizeBytes: identity.sizeBytes,
          };
        }
        return observation;
      }),
      conditionallyEraseExactObject: vi.fn(() => {
        if (observation.kind !== "present") {
          return Promise.reject(new Error("precondition failed"));
        }
        observation = {
          kind: "erased_marker",
          deletionFingerprint: identity.fingerprint,
        };
        return Promise.resolve();
      }),
      deleteErasedMarker: vi.fn(() => {
        deletedKinds.push(observation.kind);
        if (observation.kind === "erased_marker") observation = { kind: "absent" };
        return Promise.resolve();
      }),
    };

    await expect(
      Promise.all([
        reconcileExactStoredAudioDeletion(port, identity),
        reconcileExactStoredAudioDeletion(port, identity),
      ]),
    ).resolves.toHaveLength(2);
    expect(observation).toEqual({ kind: "absent" });
    expect(deletedKinds).not.toContain("present");
  });

  it("is idempotent when the exact object is already absent", async () => {
    const port: ExactAudioStoragePort = {
      observeExactObject: vi.fn(() => Promise.resolve({ kind: "absent" } as const)),
      conditionallyEraseExactObject: vi.fn(() => Promise.resolve()),
      deleteErasedMarker: vi.fn(() => Promise.resolve()),
    };

    await expect(reconcileExactStoredAudioDeletion(port, storedIdentity())).resolves.toEqual({
      kind: "already_absent",
    });
    expect(port.conditionallyEraseExactObject).not.toHaveBeenCalled();
    expect(port.deleteErasedMarker).not.toHaveBeenCalled();
  });

  it("recovers when the conditional erase succeeded but its response was lost", async () => {
    const identity = storedIdentity();
    let observation: ExactAudioStorageObservation = {
      kind: "present",
      objectEtag: identity.objectEtag,
      sizeBytes: identity.sizeBytes,
    };
    const port: ExactAudioStoragePort = {
      observeExactObject: vi.fn(() => Promise.resolve(observation)),
      conditionallyEraseExactObject: vi.fn(() => {
        observation = {
          kind: "erased_marker",
          deletionFingerprint: identity.fingerprint,
        };
        return Promise.reject(new Error("connection closed before response"));
      }),
      deleteErasedMarker: vi.fn(() => {
        observation = { kind: "absent" };
        return Promise.resolve();
      }),
    };

    await expect(reconcileExactStoredAudioDeletion(port, identity)).resolves.toEqual({
      kind: "reconciled_after_ambiguous_delete",
    });
  });

  it("fails closed if the key is replaced between observation and conditional erasure", async () => {
    const identity = storedIdentity();
    let observation: ExactAudioStorageObservation = {
      kind: "present",
      objectEtag: identity.objectEtag,
      sizeBytes: identity.sizeBytes,
    };
    const port: ExactAudioStoragePort = {
      observeExactObject: vi.fn(() => Promise.resolve(observation)),
      conditionallyEraseExactObject: vi.fn(() => {
        observation = {
          kind: "present",
          objectEtag: '"replacement-etag"',
          sizeBytes: identity.sizeBytes + 1,
        };
        return Promise.reject(new Error("precondition failed"));
      }),
      deleteErasedMarker: vi.fn(() => Promise.resolve()),
    };

    await expect(reconcileExactStoredAudioDeletion(port, identity)).rejects.toMatchObject({
      code: "STORAGE_IDENTITY_MISMATCH",
    });
    expect(port.deleteErasedMarker).not.toHaveBeenCalled();
  });

  it("fails closed when an ambiguous erase leaves the matching object present", async () => {
    const identity = storedIdentity();
    const port: ExactAudioStoragePort = {
      observeExactObject: vi.fn(() =>
        Promise.resolve({
          kind: "present" as const,
          objectEtag: identity.objectEtag,
          sizeBytes: identity.sizeBytes,
        }),
      ),
      conditionallyEraseExactObject: vi.fn(() => Promise.reject(new Error("storage timeout"))),
      deleteErasedMarker: vi.fn(() => Promise.resolve()),
    };

    await expect(reconcileExactStoredAudioDeletion(port, identity)).rejects.toMatchObject({
      code: "STORAGE_UNCERTAIN",
    });
    expect(port.deleteErasedMarker).not.toHaveBeenCalled();
  });

  it("never erases an object that already has different identity metadata", async () => {
    const identity = storedIdentity();
    const port: ExactAudioStoragePort = {
      observeExactObject: vi.fn(() =>
        Promise.resolve({
          kind: "present" as const,
          objectEtag: '"different-etag"',
          sizeBytes: identity.sizeBytes,
        }),
      ),
      conditionallyEraseExactObject: vi.fn(() => Promise.resolve()),
      deleteErasedMarker: vi.fn(() => Promise.resolve()),
    };

    await expect(reconcileExactStoredAudioDeletion(port, identity)).rejects.toMatchObject({
      code: "STORAGE_IDENTITY_MISMATCH",
    });
    expect(port.conditionallyEraseExactObject).not.toHaveBeenCalled();
    expect(port.deleteErasedMarker).not.toHaveBeenCalled();
  });

  it("retries from a matching marker without touching the already-erased audio", async () => {
    const identity = storedIdentity();
    let observation: ExactAudioStorageObservation = {
      kind: "erased_marker",
      deletionFingerprint: identity.fingerprint,
    };
    const port: ExactAudioStoragePort = {
      observeExactObject: vi.fn(() => Promise.resolve(observation)),
      conditionallyEraseExactObject: vi.fn(() => Promise.resolve()),
      deleteErasedMarker: vi.fn(() => {
        observation = { kind: "absent" };
        return Promise.resolve();
      }),
    };

    await expect(reconcileExactStoredAudioDeletion(port, identity)).resolves.toEqual({
      kind: "reconciled_after_ambiguous_delete",
    });
    expect(port.conditionallyEraseExactObject).not.toHaveBeenCalled();
    expect(port.deleteErasedMarker).toHaveBeenCalledExactlyOnceWith({ key: identity.key });
  });

  it("never removes an unrelated deletion marker", async () => {
    const port: ExactAudioStoragePort = {
      observeExactObject: vi.fn(() =>
        Promise.resolve({
          kind: "erased_marker" as const,
          deletionFingerprint: "sha256:unrelated",
        }),
      ),
      conditionallyEraseExactObject: vi.fn(() => Promise.resolve()),
      deleteErasedMarker: vi.fn(() => Promise.resolve()),
    };

    await expect(reconcileExactStoredAudioDeletion(port, storedIdentity())).rejects.toMatchObject({
      code: "STORAGE_IDENTITY_MISMATCH",
    });
    expect(port.conditionallyEraseExactObject).not.toHaveBeenCalled();
    expect(port.deleteErasedMarker).not.toHaveBeenCalled();
  });

  it("recovers when marker deletion succeeds but its response was lost", async () => {
    const identity = storedIdentity();
    let observation: ExactAudioStorageObservation = {
      kind: "erased_marker",
      deletionFingerprint: identity.fingerprint,
    };
    const port: ExactAudioStoragePort = {
      observeExactObject: vi.fn(() => Promise.resolve(observation)),
      conditionallyEraseExactObject: vi.fn(() => Promise.resolve()),
      deleteErasedMarker: vi.fn(() => {
        observation = { kind: "absent" };
        return Promise.reject(new Error("connection closed before response"));
      }),
    };

    await expect(reconcileExactStoredAudioDeletion(port, identity)).resolves.toEqual({
      kind: "reconciled_after_ambiguous_delete",
    });
  });

  it("fails closed when a matching marker remains after deletion", async () => {
    const identity = storedIdentity();
    const port: ExactAudioStoragePort = {
      observeExactObject: vi.fn(() =>
        Promise.resolve({
          kind: "erased_marker" as const,
          deletionFingerprint: identity.fingerprint,
        }),
      ),
      conditionallyEraseExactObject: vi.fn(() => Promise.resolve()),
      deleteErasedMarker: vi.fn(() => Promise.resolve()),
    };

    await expect(reconcileExactStoredAudioDeletion(port, identity)).rejects.toMatchObject({
      code: "STORAGE_UNCERTAIN",
    });
  });
});

describe("normalizeLyrics", () => {
  it("keeps the words and the line breaks exactly as typed", () => {
    expect(normalizeLyrics("one\ntwo")).toBe("one\ntwo");
  });

  it("treats a blank sheet as no lyrics at all", () => {
    expect(normalizeLyrics("")).toBeNull();
    expect(normalizeLyrics("   \n \n  ")).toBeNull();
    expect(normalizeLyrics(null)).toBeNull();
    expect(normalizeLyrics(undefined)).toBeNull();
  });

  it("normalises Windows line endings so a paste does not double the line count", () => {
    expect(normalizeLyrics("one\r\ntwo\rthree")).toBe("one\ntwo\nthree");
  });

  it("trims the outer whitespace but never the layout inside", () => {
    expect(normalizeLyrics("\n  one\n\n  two  \n")).toBe("one\n\n  two");
  });

  it("keeps Hebrew intact", () => {
    expect(normalizeLyrics("  אין פה ציפייה לנצח\nזה משהו שרציתי  ")).toBe(
      "אין פה ציפייה לנצח\nזה משהו שרציתי",
    );
  });

  it("refuses anything past the cap rather than silently losing the last verse", () => {
    expect(() => normalizeLyrics("x".repeat(LYRICS_MAX_LENGTH + 1))).toThrow(
      /at most 8000 characters/,
    );
  });

  it("accepts exactly the cap", () => {
    expect(normalizeLyrics("x".repeat(LYRICS_MAX_LENGTH))).toHaveLength(LYRICS_MAX_LENGTH);
  });

  it("measures the cap after normalising, so trailing blank lines never push a song over", () => {
    expect(normalizeLyrics("x".repeat(LYRICS_MAX_LENGTH) + "\n\n  ")).toHaveLength(
      LYRICS_MAX_LENGTH,
    );
  });
});
