import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createPendingAudioInitiationDigest,
  decideMultipartCreateRecovery,
  latestPendingAudioPartCapabilityExpiry,
} from "./pending-multipart-initiation";

const INITIATION_SOURCE = readFileSync(
  new URL("./pending-multipart-initiation.ts", import.meta.url),
  "utf8",
);
const STORAGE_SOURCE = readFileSync(new URL("../storage/r2.ts", import.meta.url), "utf8");

describe("durable multipart initiation", () => {
  it("binds retries to the exact filename, content type, and byte size", () => {
    const exact = createPendingAudioInitiationDigest({
      filename: "mix.wav",
      contentType: "audio/wav",
      sizeBytes: 123_456,
    });

    expect(exact).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(
      createPendingAudioInitiationDigest({
        filename: "mix.wav",
        contentType: "audio/wav",
        sizeBytes: 123_456,
      }),
    ).toBe(exact);
    expect(
      createPendingAudioInitiationDigest({
        filename: "different.wav",
        contentType: "audio/wav",
        sizeBytes: 123_456,
      }),
    ).not.toBe(exact);
    expect(
      createPendingAudioInitiationDigest({
        filename: "mix.wav",
        contentType: "audio/flac",
        sizeBytes: 123_456,
      }),
    ).not.toBe(exact);
  });

  it("does not repeat a recently attempted remote create after a crash", () => {
    const now = new Date("2026-07-17T12:10:00.000Z");

    expect(
      decideMultipartCreateRecovery({
        observedUploadIds: [],
        createAttemptedAt: null,
        now,
      }),
    ).toEqual({ kind: "create" });
    expect(
      decideMultipartCreateRecovery({
        observedUploadIds: [],
        createAttemptedAt: new Date("2026-07-17T12:09:00.000Z"),
        now,
      }),
    ).toEqual({ kind: "wait" });
    expect(
      decideMultipartCreateRecovery({
        observedUploadIds: ["server-observed-upload"],
        createAttemptedAt: new Date("2026-07-17T12:09:00.000Z"),
        now,
      }),
    ).toEqual({ kind: "bind", uploadId: "server-observed-upload" });
  });

  it("fails closed on duplicates and never repeats an ambiguous remote create", () => {
    const now = new Date("2026-07-17T12:20:00.000Z");

    expect(
      decideMultipartCreateRecovery({
        observedUploadIds: ["upload-a", "upload-b"],
        createAttemptedAt: new Date("2026-07-17T12:00:00.000Z"),
        now,
      }),
    ).toEqual({ kind: "conflict" });
    expect(
      decideMultipartCreateRecovery({
        observedUploadIds: [],
        createAttemptedAt: new Date("2026-07-17T12:00:00.000Z"),
        now,
      }),
    ).toEqual({ kind: "abandon" });
  });

  it("uses a single-attempt client for the only non-idempotent remote create", () => {
    expect(INITIATION_SOURCE).toContain("getR2SingleAttempt().send");
    expect(INITIATION_SOURCE.match(/new CreateMultipartUploadCommand/g)).toHaveLength(1);
    expect(INITIATION_SOURCE).toContain('decision.kind === "abandon"');
    expect(STORAGE_SOURCE).toMatch(/getR2SingleAttempt[\s\S]*maxAttempts: 1/);
  });

  it("records the exact latest 900-second signed-part capability", () => {
    const issuedAt = new Date("2026-07-17T12:00:00.000Z");
    expect(latestPendingAudioPartCapabilityExpiry(null, issuedAt)).toEqual(
      new Date("2026-07-17T12:15:00.000Z"),
    );
    expect(
      latestPendingAudioPartCapabilityExpiry(new Date("2026-07-17T12:20:00.000Z"), issuedAt),
    ).toEqual(new Date("2026-07-17T12:20:00.000Z"));
  });

  it("rejects signing after completion, cancellation, or cleanup wins the row lock", () => {
    const authorize = INITIATION_SOURCE.slice(
      INITIATION_SOURCE.indexOf("export async function authorizePendingMultipartPart"),
      INITIATION_SOURCE.indexOf("async function discoverOwnedVersion"),
    );

    expect(authorize).toContain('.for("update")');
    expect(authorize).toContain("pendingAudioPartUrlsExpireAt: expiresAt");
    expect(authorize).toContain("isNull(trackVersions.pendingAudioCompleteAttemptedAt)");
    expect(authorize).toContain("isNull(trackVersions.pendingAudioCancelRequestedAt)");
    expect(authorize).toContain("isNull(trackVersions.pendingAudioCleanupEtag)");
  });
});
