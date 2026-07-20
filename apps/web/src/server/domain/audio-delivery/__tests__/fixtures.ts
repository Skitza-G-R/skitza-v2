import type { PurchaseLedgerProjection } from "../../purchase-ledger/policy";
import {
  audioIdentityFingerprint,
  type AudioDeliveryContext,
  type AudioDeliveryViewer,
  type StoredAudioCandidate,
} from "../policy";
import { privateVersionStreamPath } from "../urls";

export const AUDIO_DELIVERY_IDS = Object.freeze({
  producerId: "producer-a",
  producerClerkUserId: "clerk-producer-a",
  projectId: "project-a",
  purchaseId: "purchase-a",
  artistId: "artist-a",
  artistClerkUserId: "clerk-artist-a",
  songId: "song-a",
  versionId: "version-a",
});

export type TestLedgerKind =
  | "paid"
  | "unpaid"
  | "waived"
  | "canceled_unpaid"
  | "canceled_paid"
  | "corrected"
  | "zero";

export function makeAudioDeliveryLedger(
  kind: TestLedgerKind,
  scope: Readonly<{
    purchaseId?: string;
    producerId?: string;
    currency?: string;
  }> = {},
): PurchaseLedgerProjection {
  const purchaseId = scope.purchaseId ?? AUDIO_DELIVERY_IDS.purchaseId;
  const producerId = scope.producerId ?? AUDIO_DELIVERY_IDS.producerId;
  const currency = scope.currency ?? "ILS";
  const zero = kind === "zero";
  const fullyPaid = kind === "paid" || kind === "canceled_paid" || zero;
  const paidCents = fullyPaid && !zero ? 10_000 : zero ? 0 : 4_000;
  const waivedCents = kind === "waived" ? 6_000 : 0;
  const canceled = kind === "canceled_paid" || kind === "canceled_unpaid";
  const remainingCents = zero || fullyPaid || kind === "waived" || canceled ? 0 : 6_000;
  const activationSatisfied = fullyPaid;
  const settled = zero || fullyPaid || kind === "waived" || canceled;
  const status = canceled
    ? ("canceled" as const)
    : kind === "waived"
      ? ("waived" as const)
      : fullyPaid
        ? ("confirmed" as const)
        : ("partially_paid" as const);
  const installments = zero
    ? []
    : [
        {
          id: `installment-${purchaseId}`,
          position: 1,
          amountCents: 10_000,
          currency,
          dueAt: new Date("2026-07-01T09:00:00.000Z"),
          requiredForActivation: true,
          status,
          paidCents,
          waivedCents,
          remainingCents,
          overpaidCents: 0,
        },
      ];

  return {
    purchaseId,
    producerId,
    currency,
    installments,
    paidCents,
    waivedCents,
    remainingCents,
    overpaidCents: 0,
    activationSatisfied,
    activationRemainsSatisfied: activationSatisfied || kind === "corrected",
    fullyPaidForDownloads: fullyPaid,
    settled,
  };
}

export type AudioDeliveryContextOptions = Readonly<{
  producerId?: string;
  producerClerkUserId?: string;
  projectId?: string;
  purchaseId?: string;
  artistId?: string;
  artistClerkUserId?: string | null;
  artistArchivedAt?: Date | null;
  songId?: string;
  versionId?: string;
  currency?: string;
  ledgerKind?: TestLedgerKind;
  ledger?: PurchaseLedgerProjection | null;
  latestOverride?: AudioDeliveryContext["latestOverride"];
  storedAudio?: Partial<StoredAudioCandidate>;
}>;

export function makeAudioDeliveryContext(
  options: AudioDeliveryContextOptions = {},
): AudioDeliveryContext {
  const producerId = options.producerId ?? AUDIO_DELIVERY_IDS.producerId;
  const projectId = options.projectId ?? AUDIO_DELIVERY_IDS.projectId;
  const purchaseId = options.purchaseId ?? AUDIO_DELIVERY_IDS.purchaseId;
  const artistId = options.artistId ?? AUDIO_DELIVERY_IDS.artistId;
  const songId = options.songId ?? AUDIO_DELIVERY_IDS.songId;
  const versionId = options.versionId ?? AUDIO_DELIVERY_IDS.versionId;
  const currency = options.currency ?? "ILS";
  const key = `producers/${producerId}/tracks/${versionId}/audio.wav`;
  const objectEtag = "etag-audio-a";
  const sizeBytes = 12_345;
  const protectedAudioUrl = privateVersionStreamPath(versionId);
  const storedAudio: StoredAudioCandidate = {
    versionId,
    producerId,
    protectedAudioUrl,
    expectedProtectedAudioUrl: protectedAudioUrl,
    key,
    objectEtag,
    sizeBytes,
    fingerprint: audioIdentityFingerprint({ key, objectEtag, sizeBytes }),
    deletedAt: null,
    pendingFieldsAreClear: true,
    ...options.storedAudio,
  };

  return {
    producer: {
      id: producerId,
      clerkUserId: options.producerClerkUserId ?? AUDIO_DELIVERY_IDS.producerClerkUserId,
    },
    project: {
      id: projectId,
      producerId,
      clientContactId: artistId,
    },
    purchase: {
      id: purchaseId,
      producerId,
      projectId,
      clientContactId: artistId,
      currency,
    },
    artist: {
      id: artistId,
      producerId,
      clerkUserId:
        options.artistClerkUserId === undefined
          ? AUDIO_DELIVERY_IDS.artistClerkUserId
          : options.artistClerkUserId,
      archivedAt: options.artistArchivedAt ?? null,
    },
    song: {
      id: songId,
      producerId,
      projectId,
      purchaseId,
      title: "Exact Song",
    },
    version: {
      id: versionId,
      producerId,
      trackId: songId,
      purchaseId,
      label: "Mix 3",
    },
    storedAudio,
    ledger:
      options.ledger === undefined
        ? makeAudioDeliveryLedger(options.ledgerKind ?? "unpaid", {
            purchaseId,
            producerId,
            currency,
          })
        : options.ledger,
    latestOverride: options.latestOverride ?? null,
  };
}

export function artistViewer(
  clerkUserId: string = AUDIO_DELIVERY_IDS.artistClerkUserId,
): AudioDeliveryViewer {
  return { role: "artist", clerkUserId };
}

export function producerViewer(
  clerkUserId: string = AUDIO_DELIVERY_IDS.producerClerkUserId,
): AudioDeliveryViewer {
  return { role: "producer", clerkUserId };
}
