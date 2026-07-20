import { createHash } from "node:crypto";

import type { PurchaseLedgerProjection } from "../purchase-ledger/policy";

export type AudioDeliveryErrorCode =
  | "NOT_FOUND"
  | "PAYMENT_REQUIRED"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "OPERATION_KEY_CONFLICT"
  | "INTEGRITY_ERROR";

export class AudioDeliveryDomainError extends Error {
  constructor(
    readonly code: AudioDeliveryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AudioDeliveryDomainError";
  }
}

export type AudioDeliveryViewer = Readonly<{
  role: "artist" | "producer";
  clerkUserId: string;
}>;

export type StoredAudioCandidate = Readonly<{
  versionId: string;
  producerId: string;
  protectedAudioUrl: string | null;
  expectedProtectedAudioUrl: string;
  key: string | null;
  objectEtag: string | null;
  sizeBytes: number | null;
  fingerprint: string | null;
  deletedAt: Date | null;
  pendingFieldsAreClear: boolean;
}>;

export type AuthorizedStoredAudio = Readonly<{
  key: string;
  objectEtag: string;
  sizeBytes: number;
}>;

export type PublicAudioDeliveryContext = Readonly<{
  portfolioTrack: Readonly<{
    id: string;
    producerId: string;
    audioUrl: string | null;
    expectedAudioUrl: string;
    audioR2Key: string | null;
    sizeBytes: number | null;
    isPublicSample: boolean;
    title: string;
  }>;
  version: Readonly<{
    id: string;
    producerId: string;
    audioR2Key: string | null;
    sizeBytes: number | null;
    audioObjectEtag: string | null;
    audioIdentityFingerprint: string | null;
    audioDeletedAt: Date | null;
    label: string;
    pendingFieldsAreClear: boolean;
  }>;
}>;

export type AudioDeliveryContext = Readonly<{
  producer: Readonly<{ id: string; clerkUserId: string }>;
  project: Readonly<{ id: string; producerId: string; clientContactId: string }>;
  purchase: Readonly<{
    id: string;
    producerId: string;
    projectId: string;
    clientContactId: string;
    currency: string;
  }>;
  artist: Readonly<{
    id: string;
    producerId: string;
    clerkUserId: string | null;
    archivedAt: Date | null;
  }>;
  song: Readonly<{
    id: string;
    producerId: string;
    projectId: string;
    purchaseId: string;
    title: string;
  }>;
  version: Readonly<{
    id: string;
    producerId: string;
    trackId: string;
    purchaseId: string;
    label: string;
  }>;
  storedAudio: StoredAudioCandidate;
  ledger: PurchaseLedgerProjection | null;
  latestOverride: Readonly<{
    purchaseId: string;
    versionId: string;
    enabled: boolean;
    sequence: number;
  }> | null;
}>;

export function audioIdentityFingerprint(input: {
  key: string;
  objectEtag: string;
  sizeBytes: number;
}): string {
  const encodePart = (value: string): string =>
    `${Buffer.byteLength(value, "utf8").toString()}:${value}`;
  const canonical = [
    "skitza-track-audio-v1",
    encodePart(input.key),
    encodePart(input.objectEtag),
    encodePart(input.sizeBytes.toString()),
  ].join("|");
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

function audioKeyBelongsToVersion(key: string, producerId: string, versionId: string): boolean {
  const prefix = `producers/${producerId}/tracks/${versionId}/`;
  if (!key.startsWith(prefix)) return false;
  const suffix = key.slice(prefix.length);
  return suffix.length > 0 && !suffix.includes("/");
}

export function authorizePublicPortfolioStream(
  context: PublicAudioDeliveryContext,
): AuthorizedStoredAudio {
  const { portfolioTrack, version } = context;
  if (
    !portfolioTrack.isPublicSample ||
    portfolioTrack.producerId !== version.producerId ||
    portfolioTrack.audioUrl !== portfolioTrack.expectedAudioUrl ||
    portfolioTrack.audioR2Key === null ||
    portfolioTrack.audioR2Key !== version.audioR2Key ||
    portfolioTrack.sizeBytes === null ||
    portfolioTrack.sizeBytes !== version.sizeBytes ||
    version.audioObjectEtag === null ||
    version.audioObjectEtag.length === 0 ||
    version.audioIdentityFingerprint === null ||
    version.audioDeletedAt !== null ||
    !version.pendingFieldsAreClear ||
    !Number.isSafeInteger(version.sizeBytes) ||
    version.sizeBytes <= 0
  ) {
    throw new AudioDeliveryDomainError("NOT_FOUND", "Audio was not found");
  }
  if (!audioKeyBelongsToVersion(portfolioTrack.audioR2Key, version.producerId, version.id)) {
    throw new AudioDeliveryDomainError("INTEGRITY_ERROR", "Stored audio identity is invalid");
  }
  if (
    version.audioIdentityFingerprint !==
    audioIdentityFingerprint({
      key: portfolioTrack.audioR2Key,
      objectEtag: version.audioObjectEtag,
      sizeBytes: version.sizeBytes,
    })
  ) {
    throw new AudioDeliveryDomainError("INTEGRITY_ERROR", "Stored audio identity is invalid");
  }
  return {
    key: portfolioTrack.audioR2Key,
    objectEtag: version.audioObjectEtag,
    sizeBytes: version.sizeBytes,
  };
}

function ownershipGraphMatches(context: AudioDeliveryContext): boolean {
  return (
    context.producer.id === context.purchase.producerId &&
    context.project.id === context.purchase.projectId &&
    context.project.producerId === context.purchase.producerId &&
    context.project.clientContactId === context.purchase.clientContactId &&
    context.artist.id === context.purchase.clientContactId &&
    context.artist.producerId === context.purchase.producerId &&
    context.song.producerId === context.purchase.producerId &&
    context.song.projectId === context.purchase.projectId &&
    context.song.purchaseId === context.purchase.id &&
    context.version.producerId === context.purchase.producerId &&
    context.version.trackId === context.song.id &&
    context.version.purchaseId === context.purchase.id &&
    context.storedAudio.versionId === context.version.id &&
    context.storedAudio.producerId === context.purchase.producerId
  );
}

export function requireCommercialLedger(context: AudioDeliveryContext): PurchaseLedgerProjection {
  if (
    !ownershipGraphMatches(context) ||
    context.ledger === null ||
    context.ledger.purchaseId !== context.purchase.id ||
    context.ledger.producerId !== context.purchase.producerId ||
    context.ledger.currency !== context.purchase.currency
  ) {
    throw new AudioDeliveryDomainError("NOT_FOUND", "Audio was not found");
  }
  return context.ledger;
}

export function requireAuthorizedStoredAudio(context: AudioDeliveryContext): AuthorizedStoredAudio {
  if (!ownershipGraphMatches(context)) {
    throw new AudioDeliveryDomainError("NOT_FOUND", "Audio was not found");
  }
  const candidate = context.storedAudio;
  if (
    candidate.deletedAt !== null ||
    candidate.protectedAudioUrl !== candidate.expectedProtectedAudioUrl ||
    candidate.key === null ||
    candidate.key.length === 0 ||
    candidate.objectEtag === null ||
    candidate.objectEtag.length === 0 ||
    candidate.sizeBytes === null ||
    !Number.isSafeInteger(candidate.sizeBytes) ||
    candidate.sizeBytes <= 0 ||
    candidate.fingerprint === null ||
    !candidate.pendingFieldsAreClear
  ) {
    throw new AudioDeliveryDomainError("NOT_FOUND", "Audio was not found");
  }
  if (!audioKeyBelongsToVersion(candidate.key, candidate.producerId, candidate.versionId)) {
    throw new AudioDeliveryDomainError("INTEGRITY_ERROR", "Stored audio identity is invalid");
  }
  if (
    candidate.fingerprint !==
    audioIdentityFingerprint({
      key: candidate.key,
      objectEtag: candidate.objectEtag,
      sizeBytes: candidate.sizeBytes,
    })
  ) {
    throw new AudioDeliveryDomainError("INTEGRITY_ERROR", "Stored audio identity is invalid");
  }
  return {
    key: candidate.key,
    objectEtag: candidate.objectEtag,
    sizeBytes: candidate.sizeBytes,
  };
}

function exactProducerOwner(context: AudioDeliveryContext, viewer: AudioDeliveryViewer): boolean {
  return (
    viewer.role === "producer" &&
    viewer.clerkUserId === context.producer.clerkUserId &&
    context.producer.id === context.purchase.producerId
  );
}

export function authorizeProducerOwner(
  context: AudioDeliveryContext,
  viewer: AudioDeliveryViewer,
): void {
  if (!ownershipGraphMatches(context) || !exactProducerOwner(context, viewer)) {
    throw new AudioDeliveryDomainError("NOT_FOUND", "Audio was not found");
  }
}

function exactArtistOwner(context: AudioDeliveryContext, viewer: AudioDeliveryViewer): boolean {
  return (
    viewer.role === "artist" &&
    viewer.clerkUserId === context.artist.clerkUserId &&
    context.artist.archivedAt === null &&
    context.artist.id === context.purchase.clientContactId &&
    context.artist.producerId === context.purchase.producerId
  );
}

export function authorizePrivateStream(
  context: AudioDeliveryContext,
  viewer: AudioDeliveryViewer,
): AuthorizedStoredAudio {
  if (
    !ownershipGraphMatches(context) ||
    (!exactProducerOwner(context, viewer) && !exactArtistOwner(context, viewer))
  ) {
    throw new AudioDeliveryDomainError("NOT_FOUND", "Audio was not found");
  }
  return requireAuthorizedStoredAudio(context);
}

export function authorizeProducerDownload(
  context: AudioDeliveryContext,
  viewer: AudioDeliveryViewer,
): AuthorizedStoredAudio {
  authorizeProducerOwner(context, viewer);
  return requireAuthorizedStoredAudio(context);
}

export function authorizeArtistDownload(
  context: AudioDeliveryContext,
  viewer: AudioDeliveryViewer,
): Readonly<{
  audio: AuthorizedStoredAudio;
  reason: "purchase_fully_paid" | "version_override";
}> {
  const ledger = requireCommercialLedger(context);
  if (!exactArtistOwner(context, viewer)) {
    throw new AudioDeliveryDomainError("NOT_FOUND", "Audio was not found");
  }
  const audio = requireAuthorizedStoredAudio(context);
  if (ledger.fullyPaidForDownloads) {
    return { audio, reason: "purchase_fully_paid" };
  }
  if (
    context.latestOverride?.enabled === true &&
    context.latestOverride.purchaseId === context.purchase.id &&
    context.latestOverride.versionId === context.version.id
  ) {
    return { audio, reason: "version_override" };
  }
  throw new AudioDeliveryDomainError("PAYMENT_REQUIRED", "Full payment is required");
}

export function paymentShortfallCents(context: AudioDeliveryContext): number {
  return requireCommercialLedger(context).remainingCents;
}

export function authorizeProducerOverrideManagement(
  context: AudioDeliveryContext,
  viewer: AudioDeliveryViewer,
): void {
  authorizeProducerOwner(context, viewer);
  if (requireCommercialLedger(context).fullyPaidForDownloads) {
    throw new AudioDeliveryDomainError(
      "CONFLICT",
      "A fully paid purchase no longer needs an early-download override",
    );
  }
}
