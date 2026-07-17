import { describe, expect, it } from "vitest";

import {
  canonicalizeCommercialSnapshot,
  decideVersionDownload,
  digestCommercialSnapshot,
  nextMonotonicActivationAt,
  snapshotCommercialTerms,
} from "../policy";

const purchase = {
  purchaseId: "purchase-1",
  producerId: "producer-1",
  projectId: "project-1",
  clientContactId: "client-1",
};

const version = {
  versionId: "version-1",
  purchaseId: "purchase-1",
  producerId: "producer-1",
  projectId: "project-1",
  audioStored: true,
};

describe("commercial snapshot canonicalization", () => {
  it("produces the same canonical JSON and SHA-256 digest for equivalent key order", () => {
    const left = {
      totalCents: 12_000,
      product: { name: "Mix", deliverables: ["WAV", "Stems"] },
      tax: null,
    };
    const right = {
      tax: null,
      product: { deliverables: ["WAV", "Stems"], name: "Mix" },
      totalCents: 12_000,
    };

    expect(canonicalizeCommercialSnapshot(left)).toBe(canonicalizeCommercialSnapshot(right));
    expect(digestCommercialSnapshot(left)).toBe(digestCommercialSnapshot(right));
    expect(digestCommercialSnapshot(left)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("preserves array order and returns an immutable snapshot descriptor", () => {
    const first = snapshotCommercialTerms({ songs: ["A", "B"] });
    const second = snapshotCommercialTerms({ songs: ["B", "A"] });

    expect(first.digest).not.toBe(second.digest);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("fails closed for values JSON cannot preserve exactly", () => {
    expect(() => canonicalizeCommercialSnapshot({ missing: undefined })).toThrow(/JSON-safe/);
    expect(() => canonicalizeCommercialSnapshot({ invalid: Number.NaN })).toThrow(/finite/);
  });
});

describe("monotonic activation", () => {
  it("does not activate for a partial first installment", () => {
    expect(nextMonotonicActivationAt(null, false, new Date("2026-07-01T00:00:00Z"))).toBeNull();
  });

  it("never removes an existing activation after a downward correction", () => {
    const activatedAt = new Date("2026-07-01T00:00:00Z");
    const correctedAt = new Date("2026-07-03T00:00:00Z");

    expect(nextMonotonicActivationAt(activatedAt, false, correctedAt)).toEqual(activatedAt);
  });
});

describe("exact-version download policy", () => {
  it("allows the owning artist after that purchase is fully paid", () => {
    expect(
      decideVersionDownload({
        actor: {
          kind: "artist",
          producerId: "producer-1",
          clientContactId: "client-1",
        },
        purchase,
        version,
        fullyPaid: true,
        override: null,
      }),
    ).toEqual({ allowed: true, reason: "purchase_fully_paid" });
  });

  it("allows an unpaid purchase only for the exact actively overridden version", () => {
    const exact = decideVersionDownload({
      actor: {
        kind: "artist",
        producerId: "producer-1",
        clientContactId: "client-1",
      },
      purchase,
      version,
      fullyPaid: false,
      override: {
        purchaseId: "purchase-1",
        versionId: "version-1",
        enabled: true,
      },
    });
    const sibling = decideVersionDownload({
      actor: {
        kind: "artist",
        producerId: "producer-1",
        clientContactId: "client-1",
      },
      purchase,
      version: { ...version, versionId: "version-2" },
      fullyPaid: false,
      override: {
        purchaseId: "purchase-1",
        versionId: "version-1",
        enabled: true,
      },
    });

    expect(exact).toEqual({ allowed: true, reason: "version_override" });
    expect(sibling).toEqual({ allowed: false, reason: "payment_required" });
  });

  it("fails closed across tenant, project, purchase, client, or missing-audio boundaries", () => {
    const actor = {
      kind: "artist" as const,
      producerId: "producer-1",
      clientContactId: "client-1",
    };

    expect(
      decideVersionDownload({
        actor,
        purchase,
        version: { ...version, projectId: "project-2" },
        fullyPaid: true,
        override: null,
      }),
    ).toEqual({ allowed: false, reason: "scope_mismatch" });
    expect(
      decideVersionDownload({
        actor: { ...actor, clientContactId: "client-2" },
        purchase,
        version,
        fullyPaid: true,
        override: null,
      }),
    ).toEqual({ allowed: false, reason: "not_owner" });
    expect(
      decideVersionDownload({
        actor,
        purchase,
        version: { ...version, audioStored: false },
        fullyPaid: true,
        override: null,
      }),
    ).toEqual({ allowed: false, reason: "audio_unavailable" });
  });

  it("allows the owning producer without treating payment as authorization", () => {
    expect(
      decideVersionDownload({
        actor: { kind: "producer", producerId: "producer-1" },
        purchase,
        version,
        fullyPaid: false,
        override: null,
      }),
    ).toEqual({ allowed: true, reason: "producer_owner" });
  });
});
