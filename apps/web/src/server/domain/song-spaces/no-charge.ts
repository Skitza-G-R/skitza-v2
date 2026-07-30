import type { PurchaseCommercialSnapshot } from "@skitza/db";

import { assertCommercialSnapshotMatchesAcceptance } from "../purchases/commercial-snapshot";
import {
  acceptPurchase,
  PurchaseDomainError,
  type PurchaseAtomicRepository,
} from "../purchases/service";
import { digestCommercialSnapshot } from "../purchases/policy";
import {
  deriveNoChargeProposalNonce,
  signNoChargeProposalToken,
  verifyNoChargeProposalToken,
  type NoChargeProposalPayload,
} from "./no-charge-token";
import { SongSpaceDomainError, type NewSongSpaceRecord, type SongSpaceRecord } from "./service";

const NO_CHARGE_CURRENCY = "ILS";

export type NoChargeProposalContext = Readonly<{
  producerId: string;
  producerName: string | null;
  projectId: string;
  projectTitle: string;
  projectLifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
  clientContactId: string;
  artistClerkUserId: string | null;
  artistHasProducerIdentity: boolean;
  activeSongSpaceCapacityExhausted: boolean;
  sourceProductId: string;
  sourceProductName: string;
  sourceCurrency: string;
}>;

export interface NoChargeProposalAcceptTransaction {
  readonly purchaseRepository: PurchaseAtomicRepository;
  loadForArtistForUpdate(
    payload: NoChargeProposalPayload,
    clerkUserId: string,
  ): Promise<NoChargeProposalContext | null>;
  hasPurchaseForOperation(
    producerId: string,
    clientContactId: string,
    operationKey: string,
  ): Promise<boolean>;
  findSongSpaceForPurchase(purchaseId: string): Promise<SongSpaceRecord | null>;
  nextProjectPosition(projectId: string): Promise<number>;
  insertSongSpace(input: NewSongSpaceRecord): Promise<SongSpaceRecord>;
  touchProject(producerId: string, projectId: string, changedAt: Date): Promise<void>;
}

export interface NoChargeProposalRepository {
  loadForProducer(producerId: string, projectId: string): Promise<NoChargeProposalContext | null>;
  loadForArtist(
    payload: NoChargeProposalPayload,
    clerkUserId: string,
  ): Promise<NoChargeProposalContext | null>;
  acceptAtomically<T>(
    payload: NoChargeProposalPayload,
    work: (transaction: NoChargeProposalAcceptTransaction) => Promise<T>,
  ): Promise<T>;
}

export type CreatedNoChargeProposal = Readonly<{
  proposalToken: string;
  projectId: string;
  projectTitle: string;
  songTitle: string;
  created: true;
}>;

export type NoChargeProposalPreview = Readonly<{
  proposalToken: string;
  producerId: string;
  projectId: string;
  projectTitle: string;
  songTitle: string;
  producerName: string;
  sourceProductId: string;
  sourceProductName: string;
  snapshot: PurchaseCommercialSnapshot;
  snapshotDigest: string;
}>;

export type AcceptedNoChargeProposal = Readonly<{
  purchaseId: string;
  projectId: string;
  trackId: string;
  created: boolean;
}>;

function text(value: string, label: string, maximum?: number): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new SongSpaceDomainError("INVALID_INPUT", `${label} must not be empty`);
  }
  if (maximum !== undefined && normalized.length > maximum) {
    throw new SongSpaceDomainError(
      "INVALID_INPUT",
      `${label} must be at most ${String(maximum)} characters`,
    );
  }
  return normalized;
}

function canonicalArtistClerkUserId(value: string): string {
  if (!value || value !== value.trim()) {
    throw new SongSpaceDomainError("NOT_FOUND", "No-charge proposal was not found");
  }
  return value;
}

function date(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new SongSpaceDomainError("INVALID_INPUT", `${label} must be a valid date`);
  }
  return new Date(value);
}

function isExplicitBoolean(value: unknown, expected: boolean): boolean {
  return typeof value === "boolean" && value === expected;
}

function noChargeSnapshot(input: {
  projectTitle: string;
  songTitle: string;
  sourceProductName: string;
}): PurchaseCommercialSnapshot {
  const snapshot: PurchaseCommercialSnapshot = {
    version: 2,
    bookingEnabled: false,
    productOrOfferName: `No charge song · ${input.songTitle}`,
    service: "no_charge_add_on",
    deliverables: ["One song space"],
    lineItems: [
      {
        label: `No charge song space · ${input.songTitle}`,
        quantity: 1,
        listUnitPriceCents: 0,
        unitPriceCents: 0,
        totalCents: 0,
      },
    ],
    listSubtotalCents: 0,
    discountCents: 0,
    subtotalCents: 0,
    tax: { mode: "tax_free", ratePct: 0, amountCents: 0 },
    totalCents: 0,
    currency: NO_CHARGE_CURRENCY,
    includedSongSpaces: 1,
    session: null,
    revisionRule: null,
    royaltyTerms: null,
    rights: [],
    selectedPaymentPlan: null,
    offeredPaymentPlans: [],
    agreementText: [
      `No charge add-on for one song space in “${input.projectTitle}”.`,
      `Song title: “${input.songTitle}”.`,
      `Source product: “${input.sourceProductName}”.`,
      "Total due: ₪0. No payment plan or installment applies.",
      "The signed-in artist accepts this exact complimentary addition.",
    ].join("\n"),
  };
  assertCommercialSnapshotMatchesAcceptance(snapshot, 0, null);
  return snapshot;
}

function validContext(
  context: NoChargeProposalContext | null,
  expected: {
    producerId: string;
    projectId: string;
    clientContactId?: string;
    sourceProductId?: string;
    clerkUserId?: string;
  },
): context is NoChargeProposalContext {
  return Boolean(
    context &&
    context.producerId === expected.producerId &&
    context.projectId === expected.projectId &&
    context.projectLifecycleStatus === "active" &&
    context.sourceCurrency === NO_CHARGE_CURRENCY &&
    (!expected.clientContactId || context.clientContactId === expected.clientContactId) &&
    (!expected.sourceProductId || context.sourceProductId === expected.sourceProductId) &&
    (!expected.clerkUserId || context.artistClerkUserId === expected.clerkUserId) &&
    typeof context.artistClerkUserId === "string" &&
    context.artistClerkUserId.length > 0 &&
    context.artistClerkUserId === context.artistClerkUserId.trim() &&
    isExplicitBoolean(context.artistHasProducerIdentity, false) &&
    Boolean(context.sourceProductId.trim()),
  );
}

function assertPurchasedCapacityIsExhausted(context: NoChargeProposalContext): void {
  if (!isExplicitBoolean(context.activeSongSpaceCapacityExhausted, true)) {
    throw new SongSpaceDomainError(
      "CAPACITY_EXCEEDED",
      "Use every existing purchased song space before offering an extra no-charge song",
    );
  }
}

function purchaseOperationKey(payload: NoChargeProposalPayload): string {
  return `sk92:no-charge:${payload.nonce}`;
}

function mapPurchaseError(error: unknown): never {
  if (!(error instanceof PurchaseDomainError)) throw error;
  if (error.code === "NOT_FOUND" || error.code === "NOT_OWNER") {
    throw new SongSpaceDomainError("NOT_FOUND", "No-charge proposal was not found");
  }
  if (error.code === "OPERATION_KEY_CONFLICT") {
    throw new SongSpaceDomainError("OPERATION_KEY_CONFLICT", error.message);
  }
  if (error.code === "INTEGRITY_ERROR") {
    throw new SongSpaceDomainError("INTEGRITY_ERROR", error.message);
  }
  throw new SongSpaceDomainError("INVALID_INPUT", error.message);
}

function verifyPayloadSnapshot(payload: NoChargeProposalPayload): PurchaseCommercialSnapshot {
  const snapshot = noChargeSnapshot(payload);
  if (digestCommercialSnapshot(snapshot) !== payload.snapshotDigest) {
    throw new SongSpaceDomainError("NOT_FOUND", "No-charge proposal was not found");
  }
  return snapshot;
}

export async function createNoChargeSongSpaceProposal(
  repository: NoChargeProposalRepository,
  input: {
    producerId: string;
    projectId: string;
    operationKey: string;
    songTitle: string;
    signingSecret: string;
  },
): Promise<CreatedNoChargeProposal> {
  const producerId = text(input.producerId, "producerId");
  const projectId = text(input.projectId, "projectId");
  const operationKey = text(input.operationKey, "operationKey", 200);
  const songTitle = text(input.songTitle, "songTitle", 120);
  const context = await repository.loadForProducer(producerId, projectId);
  if (!validContext(context, { producerId, projectId })) {
    throw new SongSpaceDomainError(
      "NOT_FOUND",
      "Active producer-owned project with a signed-in artist and valid product source was not found",
    );
  }
  assertPurchasedCapacityIsExhausted(context);
  const projectTitle = text(context.projectTitle, "project title", 120);
  const sourceProductName = text(context.sourceProductName, "source product name", 200);
  const snapshot = noChargeSnapshot({ projectTitle, songTitle, sourceProductName });
  const payload: NoChargeProposalPayload = {
    version: 1,
    kind: "no_charge_song_space",
    producerId,
    projectId,
    clientContactId: context.clientContactId,
    sourceProductId: context.sourceProductId,
    songTitle,
    projectTitle,
    sourceProductName,
    snapshotDigest: digestCommercialSnapshot(snapshot),
    nonce: deriveNoChargeProposalNonce(input.signingSecret, producerId, operationKey),
  };
  return {
    proposalToken: signNoChargeProposalToken(input.signingSecret, payload),
    projectId,
    projectTitle,
    songTitle,
    // Stateless creation emits the same token for the same exact inputs; there
    // is intentionally no durable pre-acceptance row to distinguish retries.
    created: true,
  };
}

export async function previewNoChargeSongSpaceProposal(
  repository: NoChargeProposalRepository,
  input: { proposalToken: string; clerkUserId: string; signingSecret: string },
): Promise<NoChargeProposalPreview> {
  const clerkUserId = canonicalArtistClerkUserId(input.clerkUserId);
  const payload = verifyNoChargeProposalToken(input.signingSecret, input.proposalToken);
  const snapshot = verifyPayloadSnapshot(payload);
  const context = await repository.loadForArtist(payload, clerkUserId);
  if (
    !validContext(context, {
      producerId: payload.producerId,
      projectId: payload.projectId,
      clientContactId: payload.clientContactId,
      sourceProductId: payload.sourceProductId,
      clerkUserId,
    })
  ) {
    throw new SongSpaceDomainError("NOT_FOUND", "No-charge proposal was not found");
  }
  return {
    proposalToken: input.proposalToken,
    producerId: payload.producerId,
    projectId: payload.projectId,
    projectTitle: payload.projectTitle,
    songTitle: payload.songTitle,
    producerName: context.producerName?.trim() || "Your producer",
    sourceProductId: payload.sourceProductId,
    sourceProductName: payload.sourceProductName,
    snapshot,
    snapshotDigest: payload.snapshotDigest,
  };
}

export async function acceptNoChargeSongSpaceProposal(
  repository: NoChargeProposalRepository,
  input: {
    proposalToken: string;
    clerkUserId: string;
    signingSecret: string;
    expectedSnapshotDigest: string;
    agreementAccepted: boolean;
    acceptedAt: Date;
  },
): Promise<AcceptedNoChargeProposal> {
  const clerkUserId = canonicalArtistClerkUserId(input.clerkUserId);
  const expectedSnapshotDigest = text(input.expectedSnapshotDigest, "expectedSnapshotDigest");
  if (!/^[a-f0-9]{64}$/.test(expectedSnapshotDigest)) {
    throw new SongSpaceDomainError("INVALID_INPUT", "expectedSnapshotDigest is invalid");
  }
  if (!input.agreementAccepted) {
    throw new SongSpaceDomainError("INVALID_INPUT", "The exact agreement must be accepted");
  }
  const acceptedAt = date(input.acceptedAt, "acceptedAt");
  const payload = verifyNoChargeProposalToken(input.signingSecret, input.proposalToken);
  const snapshot = verifyPayloadSnapshot(payload);
  if (payload.snapshotDigest !== expectedSnapshotDigest) {
    throw new SongSpaceDomainError(
      "OPERATION_KEY_CONFLICT",
      "The no-charge terms changed. Review the exact agreement again",
    );
  }

  return repository.acceptAtomically(payload, async (transaction) => {
    const context = await transaction.loadForArtistForUpdate(payload, clerkUserId);
    if (
      !validContext(context, {
        producerId: payload.producerId,
        projectId: payload.projectId,
        clientContactId: payload.clientContactId,
        sourceProductId: payload.sourceProductId,
        clerkUserId,
      })
    ) {
      throw new SongSpaceDomainError("NOT_FOUND", "No-charge proposal was not found");
    }

    const operationKey = purchaseOperationKey(payload);
    const isReplay = await transaction.hasPurchaseForOperation(
      payload.producerId,
      payload.clientContactId,
      operationKey,
    );
    if (!isReplay) {
      assertPurchasedCapacityIsExhausted(context);
    }

    let accepted;
    try {
      accepted = await acceptPurchase(transaction.purchaseRepository, {
        producerId: payload.producerId,
        projectId: payload.projectId,
        clientContactId: payload.clientContactId,
        source: {
          kind: "no_charge_add_on",
          productId: payload.sourceProductId,
          privateOfferId: null,
          purchaseRequestId: null,
        },
        acceptedByClerkUserId: clerkUserId,
        operationKey,
        totalCents: 0,
        plan: null,
        commercialSnapshot: snapshot,
        acceptedAt,
      });
    } catch (error) {
      mapPurchaseError(error);
    }

    const existingTrack = await transaction.findSongSpaceForPurchase(accepted.purchase.id);
    let track: SongSpaceRecord;
    if (accepted.created) {
      if (existingTrack) {
        throw new SongSpaceDomainError(
          "INTEGRITY_ERROR",
          "New no-charge purchase already owns a song space",
        );
      }
      const position = await transaction.nextProjectPosition(payload.projectId);
      if (!Number.isSafeInteger(position) || position < 0) {
        throw new SongSpaceDomainError("INTEGRITY_ERROR", "Next song-space position is invalid");
      }
      track = await transaction.insertSongSpace({
        producerId: payload.producerId,
        projectId: payload.projectId,
        purchaseId: accepted.purchase.id,
        title: payload.songTitle,
        artist: null,
        position,
      });
      await transaction.touchProject(payload.producerId, payload.projectId, acceptedAt);
    } else {
      if (!existingTrack) {
        throw new SongSpaceDomainError(
          "INTEGRITY_ERROR",
          "Accepted no-charge purchase is missing its song space",
        );
      }
      track = existingTrack;
    }
    if (
      track.producerId !== payload.producerId ||
      track.projectId !== payload.projectId ||
      track.purchaseId !== accepted.purchase.id ||
      (accepted.created && track.title !== payload.songTitle)
    ) {
      throw new SongSpaceDomainError(
        "INTEGRITY_ERROR",
        "No-charge song-space allocation does not match its signed proposal",
      );
    }
    return {
      purchaseId: accepted.purchase.id,
      projectId: payload.projectId,
      trackId: track.id,
      created: accepted.created,
    };
  });
}
