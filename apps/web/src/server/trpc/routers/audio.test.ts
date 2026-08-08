import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CompletedAudioObjectCleanupRequiredError,
  completedAudioObjectIdentityMatches,
  completeOrRecoverMultipart,
  createAudioIdentityFingerprint,
  observePendingCompletedAudioObject,
  reconcilePendingAudioCleanup,
  reconcilePendingMultipartCancellation,
  resolvePendingAudioCompletion,
  validateCompletedAudioObjectIdentity,
  validateMultipartCompletionParts,
  validateUploadInput,
  type AudioMultipartCompletionPort,
  type PendingAudioCleanupPort,
  type PendingMultipartCancellationPort,
} from "./audio";
import {
  MULTIPART_TERMINAL_SEAL_CONTENT_TYPE,
  multipartTerminalSealFingerprint,
} from "../../audio/multipart-storage-recovery";

describe("track audio identity", () => {
  it("matches the database's length-prefixed UTF-8 canonical identity", () => {
    expect(
      createAudioIdentityFingerprint({
        key: "producer/אמן|take:1.wav",
        objectEtag: '"abc|def:2"',
        sizeBytes: 123_456,
      }),
    ).toBe("sha256:df7f31a4952df77f922ac5f0cf71b2b82732cc1e110fa3ad18a85fb69cf8c327");
  });

  it("deterministically fingerprints the exact completed R2 object identity", () => {
    const identity = {
      key: "producer-scoped-audio-key",
      objectEtag: '"multipart-etag-7"',
      sizeBytes: 123_456,
    };

    expect(createAudioIdentityFingerprint(identity)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(createAudioIdentityFingerprint(identity)).toBe(
      createAudioIdentityFingerprint({ ...identity }),
    );
    expect(
      createAudioIdentityFingerprint({ ...identity, objectEtag: '"different-etag-7"' }),
    ).not.toBe(createAudioIdentityFingerprint(identity));
  });
});

describe("audio upload validation", () => {
  it("rejects files over the decimal 100MB cap", () => {
    expect(() => {
      validateUploadInput({
        filename: "x.wav",
        sizeBytes: 100_000_001,
        contentType: "audio/wav",
      });
    }).toThrow(/100 ?MB/i);
  });
  it("rejects non-audio content types", () => {
    expect(() => {
      validateUploadInput({ filename: "x.jpg", sizeBytes: 1000, contentType: "image/jpeg" });
    }).toThrow(/audio/i);
  });
  it("accepts wav/mp3/flac/m4a/aiff", () => {
    for (const ct of ["audio/wav", "audio/mpeg", "audio/flac", "audio/x-m4a", "audio/aiff"]) {
      expect(() => {
        validateUploadInput({ filename: "x", sizeBytes: 1000, contentType: ct });
      }).not.toThrow();
    }
  });

  it("accepts only non-empty ETags in a strictly ascending unique part list", () => {
    expect(() => {
      validateMultipartCompletionParts([
        { partNumber: 1, eTag: '"part-1"' },
        { partNumber: 2, eTag: '"part-2"' },
      ]);
    }).not.toThrow();

    for (const parts of [
      [{ partNumber: 0, eTag: '"part"' }],
      [{ partNumber: 10_001, eTag: '"part"' }],
      [{ partNumber: 1, eTag: "   " }],
      [
        { partNumber: 1, eTag: '"part-1"' },
        { partNumber: 1, eTag: '"part-1-again"' },
      ],
      [
        { partNumber: 2, eTag: '"part-2"' },
        { partNumber: 1, eTag: '"part-1"' },
      ],
    ]) {
      expect(() => {
        validateMultipartCompletionParts(parts);
      }).toThrow(/parts/i);
    }
  });
});

describe("completed audio object identity", () => {
  it("accepts only matching authoritative R2 identity metadata", () => {
    expect(
      validateCompletedAudioObjectIdentity({
        claimedSizeBytes: 123_456,
        completionToken: "a".repeat(64),
        completedEtag: '"stable-etag"',
        observedEtag: '"stable-etag"',
        observedSizeBytes: 123_456,
        observedCompletionToken: "a".repeat(64),
      }),
    ).toEqual({ objectEtag: '"stable-etag"', sizeBytes: 123_456 });
  });

  it("allows orphan cleanup only for the exact completed ETag and byte size", () => {
    const expected = {
      objectEtag: '"stable-etag"',
      sizeBytes: 123_456,
      completionToken: "a".repeat(64),
    };

    expect(
      completedAudioObjectIdentityMatches({
        ...expected,
        observedEtag: '"stable-etag"',
        observedSizeBytes: 123_456,
        observedCompletionToken: "a".repeat(64),
      }),
    ).toBe(true);
    expect(
      completedAudioObjectIdentityMatches({
        ...expected,
        observedEtag: '"replacement-etag"',
        observedSizeBytes: 123_456,
        observedCompletionToken: "a".repeat(64),
      }),
    ).toBe(false);
    expect(
      completedAudioObjectIdentityMatches({
        ...expected,
        observedEtag: '"stable-etag"',
        observedSizeBytes: 123_455,
        observedCompletionToken: "a".repeat(64),
      }),
    ).toBe(false);
    expect(
      completedAudioObjectIdentityMatches({
        ...expected,
        observedEtag: '"stable-etag"',
        observedSizeBytes: 123_456,
        observedCompletionToken: "b".repeat(64),
      }),
    ).toBe(false);
  });

  it("rejects a client-size mismatch and an oversized completed object", () => {
    expect(() =>
      validateCompletedAudioObjectIdentity({
        claimedSizeBytes: 1,
        completionToken: "a".repeat(64),
        completedEtag: '"stable-etag"',
        observedEtag: '"stable-etag"',
        observedSizeBytes: 2,
        observedCompletionToken: "a".repeat(64),
      }),
    ).toThrow(/identity/i);
    expect(() =>
      validateCompletedAudioObjectIdentity({
        claimedSizeBytes: 100_000_001,
        completionToken: "a".repeat(64),
        completedEtag: '"stable-etag"',
        observedEtag: '"stable-etag"',
        observedSizeBytes: 100_000_001,
        observedCompletionToken: "a".repeat(64),
      }),
    ).toThrow(/identity/i);
  });
});

describe("completed multipart reconciliation", () => {
  const completionToken = "a".repeat(64);
  const exactObservation = {
    eTag: '"stable-etag"',
    sizeBytes: 123_456,
    completionToken,
  } as const;
  const input = {
    key: "producer-scoped-audio-key",
    uploadId: "private-upload",
    parts: [{ partNumber: 1, eTag: "part-etag" }],
    claimedSizeBytes: 123_456,
    completionToken,
    completeWasAttempted: false,
  } as const;

  it("recovers when CompleteMultipart commits and its response is lost", async () => {
    let completed = false;
    const port: AudioMultipartCompletionPort = {
      head() {
        return Promise.resolve(completed ? exactObservation : null);
      },
      complete() {
        completed = true;
        return Promise.reject(new Error("redacted transport loss"));
      },
    };

    await expect(completeOrRecoverMultipart(input, port)).resolves.toEqual({
      objectEtag: exactObservation.eTag,
      sizeBytes: exactObservation.sizeBytes,
    });
  });

  it("recovers when the first post-completion HEAD is temporarily ambiguous", async () => {
    let headCount = 0;
    let completed = false;
    const port: AudioMultipartCompletionPort = {
      head() {
        headCount += 1;
        if (!completed) return Promise.resolve(null);
        if (headCount === 4) {
          return Promise.reject(new Error("redacted transient head failure"));
        }
        return Promise.resolve(exactObservation);
      },
      complete() {
        completed = true;
        return Promise.resolve({ eTag: exactObservation.eTag });
      },
    };

    await expect(completeOrRecoverMultipart(input, port)).resolves.toMatchObject({
      objectEtag: exactObservation.eTag,
    });
  });

  it("fails closed on a different token-bound object or repeated observation ambiguity", async () => {
    let completeCalls = 0;
    const mismatch: AudioMultipartCompletionPort = {
      head() {
        return Promise.resolve({
          ...exactObservation,
          completionToken: "b".repeat(64),
        });
      },
      complete() {
        completeCalls += 1;
        return Promise.resolve({ eTag: exactObservation.eTag });
      },
    };
    await expect(completeOrRecoverMultipart(input, mismatch)).rejects.toThrow(/identity/i);
    expect(completeCalls).toBe(0);

    const ambiguous: AudioMultipartCompletionPort = {
      head() {
        return Promise.reject(new Error("redacted repeated head failure"));
      },
      complete() {
        completeCalls += 1;
        return Promise.resolve({ eTag: exactObservation.eTag });
      },
    };
    await expect(completeOrRecoverMultipart(input, ambiguous)).rejects.toThrow(/retry/i);
    expect(completeCalls).toBe(0);
  });

  it.each([exactObservation.sizeBytes + 1, 100_000_001])(
    "retains the authoritative ETag for cleanup when the token-bound object has %i bytes",
    async (observedSizeBytes) => {
      let completeCalls = 0;
      const port: AudioMultipartCompletionPort = {
        head() {
          return Promise.resolve({ ...exactObservation, sizeBytes: observedSizeBytes });
        },
        complete() {
          completeCalls += 1;
          return Promise.resolve({ eTag: exactObservation.eTag });
        },
      };

      const error = await completeOrRecoverMultipart(input, port).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(CompletedAudioObjectCleanupRequiredError);
      expect(error).toMatchObject({ objectEtag: exactObservation.eTag });
      expect(completeCalls).toBe(0);
    },
  );

  it("retains the authoritative ETag when completion creates an oversized object", async () => {
    let completed = false;
    let completeCalls = 0;
    const port: AudioMultipartCompletionPort = {
      head() {
        return Promise.resolve(completed ? { ...exactObservation, sizeBytes: 100_000_001 } : null);
      },
      complete() {
        completed = true;
        completeCalls += 1;
        return Promise.resolve({ eTag: exactObservation.eTag });
      },
    };

    const error = await completeOrRecoverMultipart(input, port).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CompletedAudioObjectCleanupRequiredError);
    expect(error).toMatchObject({ objectEtag: exactObservation.eTag });
    expect(completeCalls).toBe(1);
  });

  it("does not guess after a successful completion with repeatedly ambiguous HEAD", async () => {
    let headCalls = 0;
    let completeCalls = 0;
    const port: AudioMultipartCompletionPort = {
      head() {
        headCalls += 1;
        if (headCalls <= 3) return Promise.resolve(null);
        return Promise.reject(new Error("redacted repeated post-completion head failure"));
      },
      complete() {
        completeCalls += 1;
        return Promise.resolve({ eTag: exactObservation.eTag });
      },
    };

    await expect(completeOrRecoverMultipart(input, port)).rejects.toThrow(/reconciled yet/i);
    expect(completeCalls).toBe(1);
  });

  it("never replays an ambiguous durable CompleteMultipart attempt after a crash", async () => {
    let completeCalls = 0;
    const port: AudioMultipartCompletionPort = {
      head() {
        return Promise.resolve(null);
      },
      complete() {
        completeCalls += 1;
        return Promise.resolve({ eTag: exactObservation.eTag });
      },
    };

    await expect(
      completeOrRecoverMultipart({ ...input, completeWasAttempted: true }, port),
    ).rejects.toThrow(/retry/i);
    expect(completeCalls).toBe(0);
  });

  it("observes an exact inactive retry without replaying multipart completion", async () => {
    let headCalls = 0;
    const headOnlyPort: Pick<AudioMultipartCompletionPort, "head"> = {
      head() {
        headCalls += 1;
        return Promise.resolve(exactObservation);
      },
    };

    await expect(
      observePendingCompletedAudioObject(
        {
          key: input.key,
          claimedSizeBytes: input.claimedSizeBytes,
          completionToken: input.completionToken,
        },
        headOnlyPort,
      ),
    ).resolves.toEqual({
      objectEtag: exactObservation.eTag,
      sizeBytes: exactObservation.sizeBytes,
    });
    expect(headCalls).toBe(1);
  });
});

describe("durable pending audio completion", () => {
  const input = {
    key: "producer-scoped-audio-key",
    uploadId: "exact-multipart-upload-id",
    completionToken: "a".repeat(64),
    sizeBytes: 123_456,
  } as const;
  const placeholder = {
    audioUrl: null,
    audioR2Key: null,
    sizeBytes: null,
    audioObjectEtag: null,
    audioIdentityFingerprint: null,
    pendingAudioR2Key: null,
    pendingAudioUploadId: null,
    pendingAudioInitiationDigest: null,
    pendingAudioCompletionToken: null,
    pendingAudioSizeBytes: null,
    pendingAudioStartedAt: null,
    pendingAudioCreateAttemptedAt: null,
    pendingAudioCompleteAttemptedAt: null,
    pendingAudioCompleteWriteOnceProtectedAt: null,
    pendingAudioPartUrlsExpireAt: null,
    pendingAudioCancelRequestedAt: null,
    pendingAudioCleanupEtag: null,
  } as const;

  it("stages a new server-side recovery record before remote completion", () => {
    expect(resolvePendingAudioCompletion(placeholder, input)).toBe("stage");
  });

  it("resumes only the exact pending key, token, and size after restart", () => {
    const pending = {
      ...placeholder,
      pendingAudioR2Key: input.key,
      pendingAudioUploadId: input.uploadId,
      pendingAudioInitiationDigest: `sha256:${"1".repeat(64)}`,
      pendingAudioCompletionToken: input.completionToken,
      pendingAudioSizeBytes: input.sizeBytes,
      pendingAudioStartedAt: new Date("2026-07-17T12:00:00.000Z"),
      pendingAudioCreateAttemptedAt: new Date("2026-07-17T12:00:01.000Z"),
    };

    expect(resolvePendingAudioCompletion(pending, input)).toBe("resume");
    expect(() =>
      resolvePendingAudioCompletion(pending, {
        ...input,
        completionToken: "b".repeat(64),
      }),
    ).toThrow(/pending audio upload/i);
    expect(() =>
      resolvePendingAudioCompletion(pending, { ...input, sizeBytes: input.sizeBytes + 1 }),
    ).toThrow(/pending audio upload/i);
  });

  it("routes a durable completion attempt to observation-only recovery", () => {
    expect(
      resolvePendingAudioCompletion(
        {
          ...placeholder,
          pendingAudioR2Key: input.key,
          pendingAudioUploadId: input.uploadId,
          pendingAudioInitiationDigest: `sha256:${"1".repeat(64)}`,
          pendingAudioCompletionToken: input.completionToken,
          pendingAudioSizeBytes: input.sizeBytes,
          pendingAudioStartedAt: new Date("2026-07-17T12:00:00.000Z"),
          pendingAudioCreateAttemptedAt: new Date("2026-07-17T12:00:01.000Z"),
          pendingAudioCompleteAttemptedAt: new Date("2026-07-17T12:00:03.000Z"),
          pendingAudioCompleteWriteOnceProtectedAt: new Date("2026-07-17T12:00:03.000Z"),
          pendingAudioPartUrlsExpireAt: new Date("2026-07-17T12:15:02.000Z"),
        },
        input,
      ),
    ).toBe("observe_only");
  });

  it("keeps legacy completion attempts observable but rejects a forged protection boundary", () => {
    const completeAttemptedAt = new Date("2026-07-17T12:00:03.000Z");
    const legacyPending = {
      ...placeholder,
      pendingAudioR2Key: input.key,
      pendingAudioUploadId: input.uploadId,
      pendingAudioInitiationDigest: `sha256:${"1".repeat(64)}`,
      pendingAudioCompletionToken: input.completionToken,
      pendingAudioSizeBytes: input.sizeBytes,
      pendingAudioStartedAt: new Date("2026-07-17T12:00:00.000Z"),
      pendingAudioCreateAttemptedAt: new Date("2026-07-17T12:00:01.000Z"),
      pendingAudioCompleteAttemptedAt: completeAttemptedAt,
      pendingAudioPartUrlsExpireAt: new Date("2026-07-17T12:15:02.000Z"),
    };

    expect(resolvePendingAudioCompletion(legacyPending, input)).toBe("observe_only");
    expect(() =>
      resolvePendingAudioCompletion(
        {
          ...legacyPending,
          pendingAudioCompleteWriteOnceProtectedAt: new Date(completeAttemptedAt.getTime() + 1),
        },
        input,
      ),
    ).toThrow(/pending audio upload/i);
  });

  it("recognizes an already-attached retry and rejects partial journal shapes", () => {
    expect(
      resolvePendingAudioCompletion(
        {
          ...placeholder,
          audioUrl: "https://audio.invalid/exact",
          audioR2Key: input.key,
          sizeBytes: input.sizeBytes,
          audioObjectEtag: '"stable-etag"',
          audioIdentityFingerprint: `sha256:${"1".repeat(64)}`,
        },
        input,
      ),
    ).toBe("already_attached");

    expect(() =>
      resolvePendingAudioCompletion({ ...placeholder, pendingAudioR2Key: input.key }, input),
    ).toThrow(/pending audio upload/i);
  });

  it("routes only an exact durable cleanup intent away from multipart replay", () => {
    const pendingCleanup = {
      ...placeholder,
      pendingAudioR2Key: input.key,
      pendingAudioUploadId: input.uploadId,
      pendingAudioInitiationDigest: `sha256:${"1".repeat(64)}`,
      pendingAudioCompletionToken: input.completionToken,
      pendingAudioSizeBytes: input.sizeBytes,
      pendingAudioStartedAt: new Date("2026-07-17T12:00:00.000Z"),
      pendingAudioCreateAttemptedAt: new Date("2026-07-17T12:00:01.000Z"),
      pendingAudioCompleteAttemptedAt: new Date("2026-07-17T12:00:03.000Z"),
      pendingAudioCompleteWriteOnceProtectedAt: new Date("2026-07-17T12:00:03.000Z"),
      pendingAudioPartUrlsExpireAt: new Date("2026-07-17T12:15:02.000Z"),
      pendingAudioCancelRequestedAt: null,
      pendingAudioCleanupEtag: '"completed-etag"',
    };

    expect(resolvePendingAudioCompletion(pendingCleanup, input)).toBe("cleanup_pending");
    expect(() =>
      resolvePendingAudioCompletion(pendingCleanup, {
        ...input,
        completionToken: "b".repeat(64),
      }),
    ).toThrow(/pending audio upload/i);
  });

  it("routes a durable exact cancellation away from multipart completion replay", () => {
    expect(
      resolvePendingAudioCompletion(
        {
          ...placeholder,
          pendingAudioR2Key: input.key,
          pendingAudioUploadId: input.uploadId,
          pendingAudioInitiationDigest: `sha256:${"1".repeat(64)}`,
          pendingAudioCompletionToken: input.completionToken,
          pendingAudioSizeBytes: input.sizeBytes,
          pendingAudioStartedAt: new Date("2026-07-17T12:00:00.000Z"),
          pendingAudioCreateAttemptedAt: new Date("2026-07-17T12:00:01.000Z"),
          pendingAudioCancelRequestedAt: new Date("2026-07-17T12:00:01.000Z"),
        },
        input,
      ),
    ).toBe("cancel_pending");
  });
});

describe("durable multipart cancellation", () => {
  const identity = {
    key: "producer/version/exact.wav",
    uploadId: "exact-multipart-upload-id",
    objectEtag: null,
    sizeBytes: 123_456,
    completionToken: "a".repeat(64),
    terminalSealAllowed: true,
  } as const;
  const sealObservation = {
    eTag: '"terminal-seal"',
    sizeBytes: 1,
    contentType: MULTIPART_TERMINAL_SEAL_CONTENT_TYPE,
    completionToken: identity.completionToken,
    sealFingerprint: multipartTerminalSealFingerprint(identity),
  } as const;

  it("retries safely after abort and terminal sealing succeed but the database clear crashes", async () => {
    let sealed = false;
    let pending = true;
    let crashBeforeClear = true;
    const events: string[] = [];
    const port: PendingMultipartCancellationPort = {
      abortExact(exact) {
        expect(exact).toEqual(identity);
        events.push("abort-and-prove-absence");
        return Promise.resolve();
      },
      head() {
        events.push(sealed ? "head-seal" : "head-absent");
        return Promise.resolve(sealed ? sealObservation : null);
      },
      publishCleanupEtag() {
        return Promise.reject(new Error("an absent key must not publish a cleanup ETag"));
      },
      putSeal(exact) {
        expect(exact.replaceEtag).toBeNull();
        events.push("put-seal-if-absent");
        sealed = true;
        return Promise.resolve();
      },
      clearExact(exact) {
        expect(exact).toEqual(identity);
        events.push("clear-reservation");
        if (crashBeforeClear) return Promise.reject(new Error("simulated database crash"));
        pending = false;
        return Promise.resolve(true);
      },
    };

    await expect(reconcilePendingMultipartCancellation(identity, port)).rejects.toThrow(
      /database crash/i,
    );
    expect(sealed).toBe(true);
    expect(pending).toBe(true);

    crashBeforeClear = false;
    await expect(reconcilePendingMultipartCancellation(identity, port)).resolves.toBe(true);
    expect(pending).toBe(false);
    expect(events).toEqual([
      "abort-and-prove-absence",
      "head-absent",
      "put-seal-if-absent",
      "head-seal",
      "clear-reservation",
      "abort-and-prove-absence",
      "head-seal",
      "clear-reservation",
    ]);
  });

  it("journals and replaces an oversized token-bound completion before clearing", async () => {
    let object:
      | typeof sealObservation
      | Readonly<{
          eTag: string;
          sizeBytes: number;
          contentType: string;
          completionToken: string;
          sealFingerprint: undefined;
        }>
      | null = {
      eTag: '"completed-etag"',
      sizeBytes: 100_000_001,
      contentType: "audio/wav",
      completionToken: identity.completionToken,
      sealFingerprint: undefined,
    };
    let clearedIdentity: unknown;
    let publishedIdentity: unknown;
    const port: PendingMultipartCancellationPort = {
      abortExact() {
        return Promise.resolve();
      },
      head() {
        return Promise.resolve(object);
      },
      publishCleanupEtag(exact) {
        publishedIdentity = exact;
        return Promise.resolve(true);
      },
      putSeal(exact) {
        expect(exact.key).toBe(identity.key);
        expect(exact.replaceEtag).toBe('"completed-etag"');
        object = sealObservation;
        return Promise.resolve();
      },
      clearExact(exact) {
        clearedIdentity = exact;
        return Promise.resolve(true);
      },
    };

    await expect(reconcilePendingMultipartCancellation(identity, port)).resolves.toBe(true);
    expect(publishedIdentity).toEqual({ ...identity, objectEtag: '"completed-etag"' });
    expect(clearedIdentity).toEqual({ ...identity, objectEtag: '"completed-etag"' });
  });

  it("keeps legacy unconditional completion attempts fail-closed after abort", async () => {
    const events: string[] = [];
    const port: PendingMultipartCancellationPort = {
      abortExact() {
        events.push("abort-and-prove-absence");
        return Promise.resolve();
      },
      head() {
        events.push("head");
        return Promise.resolve(null);
      },
      publishCleanupEtag() {
        events.push("journal-etag");
        return Promise.resolve(true);
      },
      putSeal() {
        events.push("put-seal");
        return Promise.resolve();
      },
      clearExact() {
        events.push("clear-reservation");
        return Promise.resolve(true);
      },
    };

    await expect(
      reconcilePendingMultipartCancellation({ ...identity, terminalSealAllowed: false }, port),
    ).resolves.toBe(false);
    expect(events).toEqual(["abort-and-prove-absence"]);
  });

  it("fails closed when a different completed object owns the key", async () => {
    let sealCalls = 0;
    let clearCalls = 0;
    const port: PendingMultipartCancellationPort = {
      abortExact() {
        return Promise.resolve();
      },
      head() {
        return Promise.resolve({
          eTag: '"different-etag"',
          sizeBytes: identity.sizeBytes,
          contentType: "audio/wav",
          completionToken: "b".repeat(64),
          sealFingerprint: undefined,
        });
      },
      publishCleanupEtag() {
        return Promise.reject(new Error("mismatched objects must not publish cleanup intent"));
      },
      putSeal() {
        sealCalls += 1;
        return Promise.resolve();
      },
      clearExact() {
        clearCalls += 1;
        return Promise.resolve(true);
      },
    };

    await expect(reconcilePendingMultipartCancellation(identity, port)).resolves.toBe(false);
    expect(sealCalls).toBe(0);
    expect(clearCalls).toBe(0);
  });
});

describe("durable completed-object cleanup", () => {
  const identity = {
    key: "producer/version/exact.wav",
    uploadId: "exact-multipart-upload-id",
    objectEtag: '"completed-etag"',
    sizeBytes: 123_456,
    completionToken: "a".repeat(64),
  } as const;

  it("recovers after abort and sealing succeed but the database clear crashes", async () => {
    let sealed = false;
    let pending = true;
    let crashBeforeClear = true;
    const events: string[] = [];
    const port: PendingAudioCleanupPort = {
      abortExact(exact) {
        expect(exact).toEqual(identity);
        events.push("abort-and-prove-absence");
        return Promise.resolve(true);
      },
      sealExact(exact) {
        expect(exact).toEqual(identity);
        events.push(sealed ? "observe-seal" : "install-seal");
        sealed = true;
        return Promise.resolve(true);
      },
      clearExact(exact) {
        expect(exact).toEqual(identity);
        events.push("clear-reservation");
        if (crashBeforeClear) return Promise.reject(new Error("simulated database crash"));
        pending = false;
        return Promise.resolve(true);
      },
    };

    await expect(reconcilePendingAudioCleanup(identity, port)).rejects.toThrow(/database crash/i);
    expect(sealed).toBe(true);
    expect(pending).toBe(true);

    crashBeforeClear = false;
    await expect(reconcilePendingAudioCleanup(identity, port)).resolves.toBe(true);
    expect(pending).toBe(false);
    expect(events).toEqual([
      "abort-and-prove-absence",
      "install-seal",
      "clear-reservation",
      "abort-and-prove-absence",
      "observe-seal",
      "clear-reservation",
    ]);
  });

  it("does not seal or clear until multipart absence is proven", async () => {
    let sealCalls = 0;
    let clearCalls = 0;
    const port: PendingAudioCleanupPort = {
      abortExact() {
        return Promise.resolve(false);
      },
      sealExact() {
        sealCalls += 1;
        return Promise.resolve(true);
      },
      clearExact() {
        clearCalls += 1;
        return Promise.resolve(true);
      },
    };

    await expect(reconcilePendingAudioCleanup(identity, port)).resolves.toBe(false);
    expect(sealCalls).toBe(0);
    expect(clearCalls).toBe(0);
  });

  it("does not release the reservation when exact terminal sealing fails closed", async () => {
    let clearCalls = 0;
    const port: PendingAudioCleanupPort = {
      abortExact: () => Promise.resolve(true),
      sealExact: () => Promise.resolve(false),
      clearExact() {
        clearCalls += 1;
        return Promise.resolve(true);
      },
    };

    await expect(reconcilePendingAudioCleanup(identity, port)).resolves.toBe(false);
    expect(clearCalls).toBe(0);
  });
});

// C1 — the artist "new version uploaded" email used to fire in
// project.addVersion. That mutation runs at the START of the upload
// chain (with audioUrl=null patched later by completeMultipart), so
// emailing there pointed the artist at a missing file. Source-grep
// invariants below pin the email to completeMultipart instead.
const here = dirname(fileURLToPath(import.meta.url));
const AUDIO_SRC = readFileSync(join(here, "audio.ts"), "utf-8");
const PROJECT_SRC = readFileSync(join(here, "project.ts"), "utf-8");
const CANCELLATION_SERVICE_SRC = readFileSync(
  join(here, "../../audio/pending-multipart-cancellation.ts"),
  "utf-8",
);
const INITIATION_SERVICE_SRC = readFileSync(
  join(here, "../../audio/pending-multipart-initiation.ts"),
  "utf-8",
);
const PURCHASE_REAL_DB_TEST_SRC = readFileSync(
  join(here, "__tests__", "purchase-real-db.integration.test.ts"),
  "utf-8",
);

describe("approval audio identity fixture", () => {
  it("derives the stored fingerprint from the exact inserted object identity", () => {
    expect(PURCHASE_REAL_DB_TEST_SRC).toMatch(
      /const audioIdentityFingerprint = createAudioIdentityFingerprint\(\{\s*key: audioR2Key,\s*objectEtag: audioObjectEtag,\s*sizeBytes,\s*\}\)/,
    );
  });
});

describe("C1 — track-version-uploaded email lives in completeMultipart", () => {
  it("audio router imports sendTrackVersionUploadedEmail", () => {
    expect(AUDIO_SRC).toContain("sendTrackVersionUploadedEmail");
  });

  it("audio router imports `after` from next/server", () => {
    expect(AUDIO_SRC).toMatch(/from\s+["']next\/server["']/);
    expect(AUDIO_SRC).toMatch(/\bafter\b/);
  });

  it("audio router calls sendTrackVersionUploadedEmail (it's the new owner)", () => {
    expect(AUDIO_SRC).toMatch(/sendTrackVersionUploadedEmail\(/);
  });

  it("project router no longer sends sendTrackVersionUploadedEmail in addVersion", () => {
    // Confirm the import was dropped or, if still present, the call site
    // inside addVersion no longer fires. Cheapest invariant: ensure the
    // function isn't called anywhere in project.ts. addVersion was the
    // only caller in project.ts; if anything else needs it later, this
    // test will fire and prompt a real review.
    expect(PROJECT_SRC).not.toMatch(/sendTrackVersionUploadedEmail\(/);
  });
});

// Waveform peaks pre-compute (this task). audio.completeMultipart must
// fetch the just-uploaded bytes back from R2, decode them server-side
// via computePeaksFromBytes, and persist the array on the trackVersions
// row in the same UPDATE that sets audioUrl. The L3 song page reads
// the column on first render — without this server compute step the
// browser would still do the full decodeAudioData round-trip on every
// viewer's machine.
describe("waveform peaks pre-compute lives in audio.completeMultipart", () => {
  it("audio router imports the server peaks helper", () => {
    expect(AUDIO_SRC).toMatch(/from\s+["']~\/server\/audio\/peaks["']/);
    expect(AUDIO_SRC).toContain("computePeaksFromBytes");
  });

  it("audio router fetches the just-uploaded object back via GetObject (S3, not CDN)", () => {
    // GetObject bypasses the public CDN's potential 404 cache during
    // the eventual-consistency window right after CompleteMultipart.
    expect(AUDIO_SRC).toContain("GetObjectCommand");
  });

  it("completeMultipart writes `peaks` on the trackVersions row", () => {
    // The single UPDATE call sets audioUrl + audioR2Key + sizeBytes +
    // peaks together so the song page sees a consistent snapshot.
    expect(AUDIO_SRC).toMatch(/peaks\s*[,:]/);
    expect(AUDIO_SRC).toMatch(/\.update\(\s*trackVersions\s*\)[\s\S]*?peaks/);
  });

  it("computeUploadPeaks bounds the decode with a timeout (no hung uploads)", () => {
    // A malformed container can hang audio-decode indefinitely. The
    // race with a setTimeout keeps the producer's upload response
    // bounded — failure mode is peaks=null + client-side fallback.
    expect(AUDIO_SRC).toContain("PEAKS_COMPUTE_TIMEOUT_MS");
    expect(AUDIO_SRC).toMatch(/Promise\.race\(/);
  });
});

describe("approved audio identity persistence", () => {
  it("allows project.addVersion to create only an identity-free placeholder", () => {
    expect(PROJECT_SRC).toMatch(
      /const AddVersionInput = z\.object\(\{[\s\S]*?audioUrl: z\.null\(\)/,
    );
    expect(PROJECT_SRC).toMatch(
      /\.insert\(trackVersions\)[\s\S]*?\.values\(\{[\s\S]*?audioUrl: null/,
    );
  });

  it("binds the completed object key to the exact owned track version", () => {
    expect(AUDIO_SRC).toMatch(
      /isAudioKeyForTrackVersion\(input\.key,\s*\{\s*producerId: ctx\.producerId,\s*trackVersionId: input\.trackVersionId,\s*\}\)/,
    );
  });

  it("uses a compare-and-set boundary for one live placeholder", () => {
    expect(AUDIO_SRC).toMatch(/audioDeletedAt: trackVersions\.audioDeletedAt/);
    expect(AUDIO_SRC).toMatch(
      /function assertAvailableUploadPlaceholder[\s\S]*?version\.audioDeletedAt \|\|[\s\S]*?version\.audioUrl/,
    );
    expect(AUDIO_SRC).toMatch(
      /function assertAvailableUploadPlaceholder[\s\S]*?version\.pendingAudioR2Key[\s\S]*?version\.pendingAudioCompletionToken[\s\S]*?version\.pendingAudioSizeBytes !== null[\s\S]*?version\.pendingAudioStartedAt/,
    );
    const casStart = AUDIO_SRC.indexOf("const [updatedVersion]");
    const casEnd = AUDIO_SRC.indexOf("if (!updatedVersion)", casStart);
    expect(casStart).toBeGreaterThanOrEqual(0);
    expect(casEnd).toBeGreaterThan(casStart);
    const casUpdate = AUDIO_SRC.slice(casStart, casEnd);
    expect(casUpdate).toContain(".update(trackVersions)");
    expect(casUpdate).toContain("isNull(trackVersions.audioDeletedAt)");
    expect(casUpdate).toContain("isNull(trackVersions.audioUrl)");
    expect(casUpdate).toContain("isNull(trackVersions.audioR2Key)");
    expect(casUpdate).toContain("isNull(trackVersions.audioIdentityFingerprint)");
    expect(casUpdate).toContain("eq(trackVersions.pendingAudioR2Key, input.key)");
    expect(casUpdate).toContain(
      "eq(trackVersions.pendingAudioCompletionToken, input.completionToken)",
    );
    expect(casUpdate).toContain("pendingAudioR2Key: null");
    expect(casUpdate).toContain("pendingAudioCompletionToken: null");
    expect(casUpdate).toContain("pendingAudioSizeBytes: null");
    expect(casUpdate).toContain("pendingAudioStartedAt: null");
    expect(casUpdate).toContain("pendingAudioCleanupEtag: null");
    expect(casUpdate).toContain(".returning");
    expect(AUDIO_SRC).toMatch(/if \(!updatedVersion\)[\s\S]*?code: "CONFLICT"/);
  });

  it("fails closed without a completed-object ETag and stores its fingerprint", () => {
    expect(AUDIO_SRC).toContain("HeadObjectCommand");
    expect(AUDIO_SRC).toMatch(/completed\.ETag/);
    expect(AUDIO_SRC).toMatch(/head\.ETag/);
    expect(AUDIO_SRC).toMatch(/head\.ContentLength/);
    expect(AUDIO_SRC).toContain("AUDIO_UPLOAD_COMPLETION_TOKEN_METADATA");
    expect(AUDIO_SRC).toMatch(/audioObjectEtag: objectEtag/);
    expect(AUDIO_SRC).toMatch(/sizeBytes: observedSizeBytes/);
    expect(AUDIO_SRC).toMatch(
      /createAudioIdentityFingerprint\(\{\s*key: input\.key,\s*objectEtag,\s*sizeBytes: observedSizeBytes/,
    );
  });

  it("writes producer ownership on version and comment records", () => {
    expect(PROJECT_SRC).toMatch(/\.insert\(trackVersions\)[\s\S]*?producerId: ctx\.producerId/);
    expect(PROJECT_SRC).toMatch(/\.insert\(trackComments\)[\s\S]*?producerId: ctx\.producerId/);
  });
});

describe("purchase-owned audio lifecycle boundary", () => {
  it("presigns browser part transfers with the checksum-safe R2 client", () => {
    const signStart = AUDIO_SRC.indexOf("signPart:");
    const completeStart = AUDIO_SRC.indexOf("completeMultipart:", signStart);
    const signSource = AUDIO_SRC.slice(signStart, completeStart);

    expect(signSource).toContain("getSignedUrl(getR2BrowserUpload()");
    expect(signSource).toContain("ContentLength: contentLength");
    expect(signSource).toContain('signableHeaders: new Set(["content-length"])');
    expect(signSource).not.toContain("getSignedUrl(getR2(), cmd");
  });

  it("rechecks an active project and purchase before every presign boundary", () => {
    const initStart = AUDIO_SRC.indexOf("initMultipart:");
    const signStart = AUDIO_SRC.indexOf("signPart:");
    const completeStart = AUDIO_SRC.indexOf("completeMultipart:");
    const initSource = AUDIO_SRC.slice(initStart, signStart);
    const signSource = AUDIO_SRC.slice(signStart, completeStart);

    expect(initSource).toContain("createOrResumePendingMultipartUpload");
    expect(signSource).toContain("authorizePendingMultipartPart");
    expect(signSource).toContain("signingDate: issuedAt");
    expect(signSource.indexOf("authorizePendingMultipartPart")).toBeLessThan(
      signSource.indexOf("getSignedUrl(getR2BrowserUpload()"),
    );
    expect(INITIATION_SERVICE_SRC).toContain("assertActiveVersionUploadLifecycle");
    expect(AUDIO_SRC).toContain("purchaseLifecycleStatus: purchases.lifecycleStatus");
    expect(AUDIO_SRC).toContain("projectLifecycleStatus: projects.lifecycleStatus");
  });

  it("serializes project then purchase and rechecks lifecycle after R2 completion", () => {
    const completeStart = AUDIO_SRC.indexOf("completeMultipart:");
    const completeSource = AUDIO_SRC.slice(completeStart);
    const r2Completion = completeSource.indexOf("completeOrRecoverMultipart");
    const finalTransaction = completeSource.lastIndexOf("ctx.db.transaction");
    const projectLock = completeSource.indexOf(".from(projects)", finalTransaction);
    const purchaseLock = completeSource.indexOf(".from(purchases)", projectLock);
    const lifecycleRecheck = completeSource.lastIndexOf("assertVersionUploadAllowed");
    const compareAndSet = completeSource.indexOf(".update(trackVersions)", lifecycleRecheck);

    expect(r2Completion).toBeGreaterThanOrEqual(0);
    expect(finalTransaction).toBeGreaterThan(r2Completion);
    expect(projectLock).toBeGreaterThan(finalTransaction);
    expect(purchaseLock).toBeGreaterThan(projectLock);
    expect(completeSource.slice(projectLock, purchaseLock)).toContain('.for("update")');
    expect(completeSource.slice(purchaseLock, lifecycleRecheck)).toContain('.for("update")');
    expect(lifecycleRecheck).toBeGreaterThan(purchaseLock);
    expect(compareAndSet).toBeGreaterThan(lifecycleRecheck);
  });

  it("journals the exact pending object before R2 completion and blocks new uploads", () => {
    const completeStart = AUDIO_SRC.indexOf("completeMultipart:");
    const completeSource = AUDIO_SRC.slice(completeStart);
    const journal = INITIATION_SERVICE_SRC.indexOf("pendingAudioR2Key: proposedKey");
    const remoteCreate = INITIATION_SERVICE_SRC.indexOf("new CreateMultipartUploadCommand");
    const bindUploadId = INITIATION_SERVICE_SRC.indexOf("pendingAudioUploadId: uploadId");
    const cleanupResume = completeSource.indexOf('staged.kind === "cleanup_pending"');
    const remoteCompletion = completeSource.indexOf("completeOrRecoverMultipart");
    const decision = completeSource.indexOf("const decision = resolvePendingAudioCompletion");
    const stagingLifecycleCheck = completeSource.indexOf("assertVersionUploadAllowed", decision);
    const durableCleanupDecision = completeSource.indexOf(
      'decision === "cleanup_pending"',
      decision,
    );

    expect(journal).toBeGreaterThanOrEqual(0);
    expect(remoteCreate).toBeGreaterThan(journal);
    expect(bindUploadId).toBeGreaterThan(remoteCreate);
    expect(cleanupResume).toBeGreaterThanOrEqual(0);
    expect(cleanupResume).toBeLessThan(remoteCompletion);
    expect(durableCleanupDecision).toBeGreaterThan(decision);
    expect(durableCleanupDecision).toBeLessThan(stagingLifecycleCheck);
    expect(completeSource).toContain("The server-issued multipart identity was not initialized.");
    expect(AUDIO_SRC).toMatch(
      /function assertAvailableUploadPlaceholder[\s\S]*?pendingAudioR2Key[\s\S]*?pendingAudioCompletionToken[\s\S]*?pendingAudioSizeBytes[\s\S]*?pendingAudioStartedAt/,
    );
    expect(AUDIO_SRC).toContain("resolvePendingAudioCompletion(lockedVersion");
  });

  it("validates the exact ordered part list before consuming the one-shot completion marker", () => {
    const completeStart = AUDIO_SRC.indexOf("completeMultipart:");
    const completeSource = AUDIO_SRC.slice(completeStart);
    const validation = completeSource.indexOf("validateMultipartCompletionParts(input.parts)");
    const oneShotMarker = completeSource.indexOf(
      "pendingAudioCompleteWriteOnceProtectedAt: completeAttemptedAt",
    );
    const remoteComplete = AUDIO_SRC.indexOf("new CompleteMultipartUploadCommand");
    const conditionalPublish = AUDIO_SRC.indexOf('IfNoneMatch: "*"', remoteComplete);
    const protectedCompletionCall = completeSource.indexOf(
      "completeOrRecoverMultipart",
      oneShotMarker,
    );

    expect(validation).toBeGreaterThanOrEqual(0);
    expect(oneShotMarker).toBeGreaterThan(validation);
    expect(remoteComplete).toBeGreaterThanOrEqual(0);
    expect(conditionalPublish).toBeGreaterThan(remoteComplete);
    expect(AUDIO_SRC.match(/new CompleteMultipartUploadCommand/g)).toHaveLength(1);
    expect(protectedCompletionCall).toBeGreaterThan(oneShotMarker);
  });

  it("routes an inactive exact pending retry through head-only cleanup before multipart replay", () => {
    const completeStart = AUDIO_SRC.indexOf("completeMultipart:");
    const abortStart = AUDIO_SRC.indexOf("abortMultipart:", completeStart);
    const completeSource = AUDIO_SRC.slice(completeStart, abortStart);
    const inactiveRoute = completeSource.indexOf('kind: "inactive_pending"');
    const headOnlyRecovery = completeSource.indexOf("observePendingCompletedAudioObject");
    const multipartReplay = completeSource.indexOf("completeOrRecoverMultipart");

    expect(inactiveRoute).toBeGreaterThanOrEqual(0);
    expect(headOnlyRecovery).toBeGreaterThan(inactiveRoute);
    expect(headOnlyRecovery).toBeLessThan(multipartReplay);
    expect(completeSource.slice(inactiveRoute, multipartReplay)).toContain(
      "cleanupCompletedAudioObjectIfIdentityMatches",
    );
  });

  it("routes abort and ghost cleanup through the same durable cancellation service", () => {
    const abortStart = AUDIO_SRC.indexOf("abortMultipart:");
    const abortSource = AUDIO_SRC.slice(abortStart);
    const deleteStart = PROJECT_SRC.indexOf("deleteVersion:");
    const deleteSource = PROJECT_SRC.slice(
      deleteStart,
      PROJECT_SRC.indexOf("setPaid:", deleteStart),
    );

    expect(abortSource).toContain("trackVersionId: z.string().uuid()");
    expect(abortSource).toContain("completionToken: z.string().regex");
    expect(abortSource).toContain("await cancelPendingMultipartUpload(ctx");
    expect(abortSource).not.toContain("new AbortMultipartUploadCommand");
    expect(deleteSource).toContain("await cancelPendingMultipartUpload(ctx");
    expect(CANCELLATION_SERVICE_SRC).toContain("pendingAudioCancelRequestedAt");
    expect(CANCELLATION_SERVICE_SRC).toContain("reconcilePendingMultipartCancellation");
    expect(CANCELLATION_SERVICE_SRC).not.toContain("$metadata?.httpStatusCode === 404");
    expect(AUDIO_SRC).not.toContain("$metadata?.httpStatusCode === 404");
  });

  it("identity-checks and conditionally seals only the protected object after attach failure", () => {
    const completeStart = AUDIO_SRC.indexOf("completeMultipart:");
    const abortStart = AUDIO_SRC.indexOf("abortMultipart:", completeStart);
    const completeSource = AUDIO_SRC.slice(completeStart, abortStart);
    const attachCatch = completeSource.indexOf("catch (error)");

    const cleanupStart = AUDIO_SRC.indexOf(
      "async function cleanupCompletedAudioObjectIfIdentityMatches",
    );
    const cleanupEnd = AUDIO_SRC.indexOf("class AudioObjectObservationPending", cleanupStart);
    const cleanupSource = AUDIO_SRC.slice(cleanupStart, cleanupEnd);
    const protectedGate = cleanupSource.indexOf(
      "version.pendingAudioCompleteWriteOnceProtectedAt instanceof Date",
    );
    const firstStorageObservation = cleanupSource.indexOf("exactObjectIsAbsent(input.key)");

    expect(AUDIO_SRC).not.toContain("DeleteObjectCommand");
    expect(AUDIO_SRC).toContain("cleanupCompletedAudioObjectIfIdentityMatches");
    expect(AUDIO_SRC).toContain("eq(trackVersions.audioR2Key, input.key)");
    expect(AUDIO_SRC).toMatch(
      /version\.audioUrl !== null \|\|[\s\S]*?version\.audioR2Key !== null[\s\S]*?return false;/,
    );
    expect(protectedGate).toBeGreaterThanOrEqual(0);
    expect(firstStorageObservation).toBeGreaterThan(protectedGate);
    expect(cleanupSource).toContain("abortMultipartUploadAndObserve(exact.key, exact.uploadId)");
    expect(cleanupSource).toContain("reconcileMultipartTerminalSeal");
    expect(cleanupSource).toContain("putSeal: putMultipartTerminalSeal");
    expect(AUDIO_SRC).toMatch(
      /observedCompletionToken: head\.Metadata\?\.\[AUDIO_UPLOAD_COMPLETION_TOKEN_METADATA\]/,
    );
    expect(attachCatch).toBeGreaterThanOrEqual(0);
    expect(completeSource.slice(attachCatch)).toContain(
      "cleanupCompletedAudioObjectIfIdentityMatches",
    );
    expect(completeSource.slice(attachCatch)).toContain("mapVersionUploadDomainError(error)");

    const intentWrite = AUDIO_SRC.indexOf(".set({ pendingAudioCleanupEtag: cleanupEtag })");
    const conditionalSeal = AUDIO_SRC.indexOf("reconcileMultipartTerminalSeal", intentWrite);
    expect(intentWrite).toBeGreaterThanOrEqual(0);
    expect(conditionalSeal).toBeGreaterThan(intentWrite);
    const intentSource = AUDIO_SRC.slice(intentWrite, conditionalSeal);
    expect(intentSource).toContain("eq(trackVersions.producerId, ctx.producerId)");
    expect(intentSource).toContain("eq(trackVersions.trackId, input.trackId)");
    expect(intentSource).toContain("eq(trackVersions.purchaseId, input.purchaseId)");
    expect(intentSource).toContain("eq(trackVersions.pendingAudioR2Key, input.key)");
    expect(intentSource).toContain(
      "eq(trackVersions.pendingAudioCompletionToken, input.completionToken)",
    );
  });

  it("journals and terminally seals token-bound size mismatches before releasing reservation", () => {
    const observeStart = AUDIO_SRC.indexOf("async function observeCompletedAudioObject");
    const completionStart = AUDIO_SRC.indexOf("completeMultipart:");
    const abortStart = AUDIO_SRC.indexOf("abortMultipart:", completionStart);
    const completionSource = AUDIO_SRC.slice(completionStart, abortStart);
    const cleanupStart = AUDIO_SRC.indexOf(
      "async function cleanupCompletedAudioObjectIfIdentityMatches",
    );
    const cleanupEnd = AUDIO_SRC.indexOf("class AudioObjectObservationPending", cleanupStart);
    const cleanupSource = AUDIO_SRC.slice(cleanupStart, cleanupEnd);
    const transactionStarts = Array.from(
      cleanupSource.matchAll(/ctx\.db\.transaction\(async \(tx\)/g),
      (match) => match.index,
    );

    expect(AUDIO_SRC.slice(observeStart, completionStart)).toContain(
      "CompletedAudioObjectCleanupRequiredError",
    );
    expect(completionSource).toMatch(
      /catch \(error\)[\s\S]*error instanceof CompletedAudioObjectCleanupRequiredError[\s\S]*cleanupCompletedAudioObjectIfIdentityMatches/,
    );
    expect(cleanupSource).toContain("pendingAudioCleanupEtag: cleanupEtag");
    expect(cleanupSource).toContain("tokenBoundCompletedObjectCleanupMatches");
    expect(cleanupSource).toContain("pendingAudioCompleteWriteOnceProtectedAt");
    expect(cleanupSource).toContain("reconcileMultipartTerminalSeal");
    expect(cleanupSource).toContain("pendingAudioSizeBytes: null");
    expect(transactionStarts).toHaveLength(2);
    for (const [index, start] of transactionStarts.entries()) {
      const end = transactionStarts[index + 1] ?? cleanupSource.length;
      const transaction = cleanupSource.slice(start, end);
      const quotaLock = transaction.indexOf("lockProducerAudioStorageQuota(tx");
      const projectLock = transaction.indexOf("pg_advisory_xact_lock(hashtextextended");
      expect(quotaLock).toBeGreaterThanOrEqual(0);
      expect(projectLock).toBeGreaterThan(quotaLock);
    }
  });

  it("clears the write-once protection field with every full pending-audio reset", () => {
    for (const source of [
      AUDIO_SRC,
      CANCELLATION_SERVICE_SRC,
      INITIATION_SERVICE_SRC,
      PROJECT_SRC,
    ]) {
      const completionClears = source.match(/pendingAudioCompleteAttemptedAt: null/g) ?? [];
      const protectionClears =
        source.match(/pendingAudioCompleteWriteOnceProtectedAt: null/g) ?? [];
      expect(protectionClears).toHaveLength(completionClears.length);
    }

    const deleteStart = PROJECT_SRC.indexOf("deleteVersion:");
    const deleteSource = PROJECT_SRC.slice(deleteStart);
    expect(deleteSource).toContain(
      "isNull(trackVersions.pendingAudioCompleteWriteOnceProtectedAt)",
    );
    expect(INITIATION_SERVICE_SRC).toContain(
      "isNull(trackVersions.pendingAudioCompleteWriteOnceProtectedAt)",
    );
    expect(CANCELLATION_SERVICE_SRC).toContain(
      "trackVersions.pendingAudioCompleteWriteOnceProtectedAt",
    );
  });

  it("creates version placeholders only inside the same active lifecycle boundary", () => {
    const addVersionStart = PROJECT_SRC.indexOf("addVersion:");
    const deleteVersionStart = PROJECT_SRC.indexOf("deleteVersion:", addVersionStart);
    const addVersionSource = PROJECT_SRC.slice(addVersionStart, deleteVersionStart);

    expect(addVersionSource).toContain("ctx.db.transaction");
    expect(addVersionSource).toContain("assertActiveVersionUploadLifecycle");
    expect(addVersionSource).toContain(".from(projects)");
    expect(addVersionSource).toContain(".from(purchases)");
    expect(addVersionSource.match(/\.for\("update"\)/g)).toHaveLength(3);
  });
});
