import { describe, expect, it } from "vitest";

import {
  audioIdentityFingerprint,
  authorizeArtistDownload,
  authorizePrivateStream,
  authorizePrivateStreamForAccount,
  authorizeProducerDownload,
  authorizePublicPortfolioStream,
  paymentShortfallCents,
  type PublicAudioDeliveryContext,
} from "../policy";
import {
  AUDIO_DELIVERY_IDS,
  artistViewer,
  makeAudioDeliveryContext,
  producerViewer,
} from "./fixtures";

describe("SK-40 artist download entitlement", () => {
  it.each(["paid", "canceled_paid", "zero"] as const)(
    "unlocks every stored version when the exact purchase ledger is %s",
    (ledgerKind) => {
      const context = makeAudioDeliveryContext({ ledgerKind });

      expect(authorizeArtistDownload(context, artistViewer())).toMatchObject({
        reason: "purchase_fully_paid",
        audio: { key: context.storedAudio.key },
      });
    },
  );

  it.each(["unpaid", "waived", "canceled_unpaid"] as const)(
    "does not treat a %s ledger as full payment",
    (ledgerKind) => {
      expect(() =>
        authorizeArtistDownload(makeAudioDeliveryContext({ ledgerKind }), artistViewer()),
      ).toThrow(expect.objectContaining({ code: "PAYMENT_REQUIRED" }));
    },
  );

  it("relocks after a downward correction unless the exact version override remains enabled", () => {
    const paid = makeAudioDeliveryContext({ ledgerKind: "paid" });
    const corrected = makeAudioDeliveryContext({ ledgerKind: "corrected" });
    const correctedWithOverride = makeAudioDeliveryContext({
      ledgerKind: "corrected",
      latestOverride: {
        purchaseId: AUDIO_DELIVERY_IDS.purchaseId,
        versionId: AUDIO_DELIVERY_IDS.versionId,
        enabled: true,
        sequence: 3,
      },
    });

    expect(authorizeArtistDownload(paid, artistViewer()).reason).toBe("purchase_fully_paid");
    expect(() => authorizeArtistDownload(corrected, artistViewer())).toThrow(
      expect.objectContaining({ code: "PAYMENT_REQUIRED" }),
    );
    expect(authorizeArtistDownload(correctedWithOverride, artistViewer()).reason).toBe(
      "version_override",
    );
  });

  it("keeps paid purchase A unlocked when later purchase B is unpaid", () => {
    const paidPurchaseA = makeAudioDeliveryContext({ ledgerKind: "paid" });
    const unpaidPurchaseB = makeAudioDeliveryContext({
      purchaseId: "purchase-b",
      songId: "song-b",
      versionId: "version-b",
      ledgerKind: "unpaid",
    });

    expect(authorizeArtistDownload(paidPurchaseA, artistViewer()).reason).toBe(
      "purchase_fully_paid",
    );
    expect(() => authorizeArtistDownload(unpaidPurchaseB, artistViewer())).toThrow(
      expect.objectContaining({ code: "PAYMENT_REQUIRED" }),
    );
    expect(authorizeArtistDownload(paidPurchaseA, artistViewer()).reason).toBe(
      "purchase_fully_paid",
    );
  });

  it("accepts only an enabled override for the exact purchase and exact version", () => {
    const exactOverride = {
      purchaseId: AUDIO_DELIVERY_IDS.purchaseId,
      versionId: AUDIO_DELIVERY_IDS.versionId,
      enabled: true,
      sequence: 1,
    };
    const exact = makeAudioDeliveryContext({
      ledgerKind: "unpaid",
      latestOverride: exactOverride,
    });
    expect(authorizeArtistDownload(exact, artistViewer()).reason).toBe("version_override");

    for (const latestOverride of [
      { ...exactOverride, versionId: "sibling-version" },
      { ...exactOverride, purchaseId: "sibling-purchase" },
      { ...exactOverride, enabled: false },
    ]) {
      expect(() =>
        authorizeArtistDownload(
          makeAudioDeliveryContext({ ledgerKind: "unpaid", latestOverride }),
          artistViewer(),
        ),
      ).toThrow(expect.objectContaining({ code: "PAYMENT_REQUIRED" }));
    }
  });

  it("warns with the ledger amount still owed after separate waivers or cancellation", () => {
    expect(paymentShortfallCents(makeAudioDeliveryContext({ ledgerKind: "waived" }))).toBe(0);
    expect(paymentShortfallCents(makeAudioDeliveryContext({ ledgerKind: "canceled_unpaid" }))).toBe(
      0,
    );
  });
});

describe("SK-40 stored-audio and tenant authorization", () => {
  it("never streams or downloads deleted audio", () => {
    const context = makeAudioDeliveryContext({
      ledgerKind: "paid",
      storedAudio: { deletedAt: new Date("2026-07-20T11:00:00.000Z") },
    });

    expect(() => authorizePrivateStream(context, artistViewer())).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    expect(() => authorizeArtistDownload(context, artistViewer())).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    expect(() => authorizeProducerDownload(context, producerViewer())).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });

  it.each([
    ["pending fields", { pendingFieldsAreClear: false }],
    ["missing object key", { key: null }],
    ["missing etag", { objectEtag: null }],
    ["invalid size", { sizeBytes: 0 }],
    ["non-protected URL", { protectedAudioUrl: "https://storage.example/private.wav" }],
  ] as const)("fails closed for incomplete storage state: %s", (_label, storedAudio) => {
    expect(() =>
      authorizePrivateStream(makeAudioDeliveryContext({ storedAudio }), artistViewer()),
    ).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("rejects a stored object whose immutable identity fingerprint changed", () => {
    expect(() =>
      authorizePrivateStream(
        makeAudioDeliveryContext({ storedAudio: { fingerprint: "sha256:not-the-object" } }),
        artistViewer(),
      ),
    ).toThrow(expect.objectContaining({ code: "INTEGRITY_ERROR" }));
  });

  it("streams only to the exact active artist or exact producer owner", () => {
    const context = makeAudioDeliveryContext({ ledgerKind: "unpaid" });

    expect(authorizePrivateStream(context, artistViewer())).toMatchObject({
      key: context.storedAudio.key,
    });
    expect(authorizePrivateStream(context, producerViewer())).toMatchObject({
      key: context.storedAudio.key,
    });
    expect(() => authorizePrivateStream(context, artistViewer("clerk-artist-b"))).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    expect(() => authorizePrivateStream(context, producerViewer("clerk-producer-b"))).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    expect(() => authorizeProducerDownload(context, artistViewer())).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });

  it("authorizes a dual account through the exact ownership it has for each resource", () => {
    const dualClerkUserId = "clerk-dual";
    const artistOwned = makeAudioDeliveryContext({
      producerClerkUserId: "clerk-other-producer",
      artistClerkUserId: dualClerkUserId,
    });
    const producerOwned = makeAudioDeliveryContext({
      producerClerkUserId: dualClerkUserId,
      artistClerkUserId: "clerk-other-artist",
    });

    expect(
      authorizePrivateStreamForAccount(artistOwned, dualClerkUserId),
    ).toMatchObject({ key: artistOwned.storedAudio.key });
    expect(
      authorizePrivateStreamForAccount(producerOwned, dualClerkUserId),
    ).toMatchObject({ key: producerOwned.storedAudio.key });
    expect(() =>
      authorizePrivateStreamForAccount(artistOwned, "clerk-unrelated"),
    ).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("does not let dual-account routing revive an archived artist relationship", () => {
    const dualClerkUserId = "clerk-dual";
    const archivedArtistOwned = makeAudioDeliveryContext({
      producerClerkUserId: "clerk-other-producer",
      artistClerkUserId: dualClerkUserId,
      artistArchivedAt: new Date("2026-07-20T10:00:00.000Z"),
    });

    expect(() =>
      authorizePrivateStreamForAccount(
        archivedArtistOwned,
        dualClerkUserId,
      ),
    ).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("denies archived artists and cross-tenant graph mismatches without revealing audio", () => {
    const archived = makeAudioDeliveryContext({
      ledgerKind: "paid",
      artistArchivedAt: new Date("2026-07-20T10:00:00.000Z"),
    });
    expect(() => authorizePrivateStream(archived, artistViewer())).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    expect(() => authorizeArtistDownload(archived, artistViewer())).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );

    const valid = makeAudioDeliveryContext({ ledgerKind: "paid" });
    const crossTenant = {
      ...valid,
      song: { ...valid.song, producerId: "producer-b" },
    };
    expect(() => authorizePrivateStream(crossTenant, producerViewer())).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    expect(() => authorizeArtistDownload(crossTenant, artistViewer())).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });
});

describe("SK-40 public stream separation", () => {
  const publicContext = (): PublicAudioDeliveryContext => {
    const key = `producers/${AUDIO_DELIVERY_IDS.producerId}/tracks/${AUDIO_DELIVERY_IDS.versionId}/audio.wav`;
    const objectEtag = "etag-public-sample";
    const sizeBytes = 4_096;
    return {
      portfolioTrack: {
        id: "public-sample-a",
        producerId: AUDIO_DELIVERY_IDS.producerId,
        audioUrl: "/api/audio/public/portfolio/public-sample-a",
        expectedAudioUrl: "/api/audio/public/portfolio/public-sample-a",
        audioR2Key: key,
        sizeBytes,
        isPublicSample: true,
        title: "Public Sample",
      },
      version: {
        id: AUDIO_DELIVERY_IDS.versionId,
        producerId: AUDIO_DELIVERY_IDS.producerId,
        audioR2Key: key,
        sizeBytes,
        audioObjectEtag: objectEtag,
        audioIdentityFingerprint: audioIdentityFingerprint({ key, objectEtag, sizeBytes }),
        audioDeletedAt: null,
        label: "Master",
        pendingFieldsAreClear: true,
      },
    };
  };

  it("streams only an explicitly public sample with an exact live stored identity", () => {
    const grant = authorizePublicPortfolioStream(publicContext());

    expect(grant.key).toContain(`/tracks/${AUDIO_DELIVERY_IDS.versionId}/`);
    expect(grant.objectEtag).toBe("etag-public-sample");
  });

  it.each([
    [
      "unpublished",
      (context: PublicAudioDeliveryContext) => ({
        ...context,
        portfolioTrack: { ...context.portfolioTrack, isPublicSample: false },
      }),
    ],
    [
      "URL tampering",
      (context: PublicAudioDeliveryContext) => ({
        ...context,
        portfolioTrack: { ...context.portfolioTrack, audioUrl: "/api/download/version-a" },
      }),
    ],
    [
      "object-key tampering",
      (context: PublicAudioDeliveryContext) => ({
        ...context,
        portfolioTrack: {
          ...context.portfolioTrack,
          audioR2Key: `${context.portfolioTrack.audioR2Key ?? "missing"}-other`,
        },
      }),
    ],
    [
      "deleted audio",
      (context: PublicAudioDeliveryContext) => ({
        ...context,
        version: { ...context.version, audioDeletedAt: new Date("2026-07-20T12:00:00.000Z") },
      }),
    ],
  ] as const)("denies %s without creating download permission", (_label, mutate) => {
    expect(() => authorizePublicPortfolioStream(mutate(publicContext()))).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });
});
