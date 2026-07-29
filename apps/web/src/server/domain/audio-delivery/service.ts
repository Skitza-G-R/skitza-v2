import { digestCommercialSnapshot } from "../purchases/policy";
import {
  AudioDeliveryDomainError,
  authorizeArtistDownload,
  authorizeArtistOwner,
  authorizePrivateStream,
  authorizePublicPortfolioStream,
  authorizeProducerDownload,
  authorizeProducerOverrideManagement,
  authorizeProducerOwner,
  paymentShortfallCents,
  requireCommercialLedger,
  requireAuthorizedStoredAudio,
  type AudioDeliveryContext,
  type AudioDeliveryViewer,
  type AuthorizedStoredAudio,
  type PublicAudioDeliveryContext,
} from "./policy";

export {
  readProducerDownloadOverrideStates as readDownloadOverrideStates,
  type ProducerDownloadStateBatchRepository,
  type ProducerDownloadStateBatchScope,
} from "./producer-download-state";

export type DownloadOverrideEvent = Readonly<{
  id: string;
  purchaseId: string;
  versionId: string;
  producerId: string;
  sequence: number;
  operationKey: string;
  operationDigest: string;
  enabled: boolean;
  changedByClerkUserId: string;
  createdAt: Date;
}>;

export type NewDownloadOverrideEvent = Omit<DownloadOverrideEvent, "id">;

export interface AudioDeliveryTransaction {
  readonly context: AudioDeliveryContext;
  findOverrideOperation(operationKey: string): Promise<DownloadOverrideEvent | null>;
  appendOverride(input: NewDownloadOverrideEvent): Promise<DownloadOverrideEvent>;
}

export type AudioDeliveryScope =
  | Readonly<{ kind: "audio"; versionId: string }>
  | Readonly<{ kind: "commercial"; versionId: string; purchaseId: string }>;

export interface AudioDeliveryRepository {
  atomically<T>(
    scope: AudioDeliveryScope,
    work: (transaction: AudioDeliveryTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface PublicAudioDeliveryRepository {
  atomically<T>(
    portfolioTrackId: string,
    work: (context: PublicAudioDeliveryContext) => Promise<T>,
  ): Promise<T>;
}

export type AudioObjectRequest = AuthorizedStoredAudio &
  Readonly<{
    title: string;
    versionLabel: string;
  }>;

function identifier(value: string, label: string, maximum = 200): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AudioDeliveryDomainError("INVALID_INPUT", `${label} is required`);
  }
  if (normalized.length > maximum) {
    throw new AudioDeliveryDomainError(
      "INVALID_INPUT",
      `${label} must be at most ${String(maximum)} characters`,
    );
  }
  return normalized;
}

function nonnegativeCents(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AudioDeliveryDomainError("INVALID_INPUT", `${label} must be nonnegative whole cents`);
  }
  return value;
}

function date(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new AudioDeliveryDomainError("INVALID_INPUT", "Override time must be valid");
  }
  return new Date(value);
}

function exactScope(
  context: AudioDeliveryContext,
  scope: Readonly<{ purchaseId?: string; versionId: string }>,
): void {
  if (
    context.version.id !== scope.versionId ||
    (scope.purchaseId !== undefined && context.purchase.id !== scope.purchaseId)
  ) {
    throw new AudioDeliveryDomainError("NOT_FOUND", "Audio was not found");
  }
}

function audioRequest(
  context: AudioDeliveryContext,
  audio: AuthorizedStoredAudio,
): AudioObjectRequest {
  return {
    ...audio,
    title: context.song.title,
    versionLabel: context.version.label,
  };
}

export async function deliverPrivateStream<Result>(
  repository: AudioDeliveryRepository,
  input: Readonly<{ viewer: AudioDeliveryViewer; versionId: string }>,
  open: (request: AudioObjectRequest) => Promise<Result>,
): Promise<Result> {
  const versionId = identifier(input.versionId, "Version id");
  return repository.atomically({ kind: "audio", versionId }, async (transaction) => {
    exactScope(transaction.context, { versionId });
    const audio = authorizePrivateStream(transaction.context, input.viewer);
    return open(audioRequest(transaction.context, audio));
  });
}

export async function deliverArtistDownload<Result>(
  repository: AudioDeliveryRepository,
  input: Readonly<{
    viewerClerkUserId: string;
    purchaseId: string;
    versionId: string;
  }>,
  open: (request: AudioObjectRequest) => Promise<Result>,
): Promise<Result> {
  const purchaseId = identifier(input.purchaseId, "Purchase id");
  const versionId = identifier(input.versionId, "Version id");
  const viewer: AudioDeliveryViewer = {
    role: "artist",
    clerkUserId: identifier(input.viewerClerkUserId, "Viewer id"),
  };
  return repository.atomically({ kind: "commercial", purchaseId, versionId }, (transaction) => {
    exactScope(transaction.context, { purchaseId, versionId });
    const { audio } = authorizeArtistDownload(transaction.context, viewer);
    return open(audioRequest(transaction.context, audio));
  });
}

export async function deliverProducerDownload<Result>(
  repository: AudioDeliveryRepository,
  input: Readonly<{ viewerClerkUserId: string; versionId: string }>,
  open: (request: AudioObjectRequest) => Promise<Result>,
): Promise<Result> {
  const versionId = identifier(input.versionId, "Version id");
  const viewer: AudioDeliveryViewer = {
    role: "producer",
    clerkUserId: identifier(input.viewerClerkUserId, "Viewer id"),
  };
  return repository.atomically({ kind: "audio", versionId }, async (transaction) => {
    exactScope(transaction.context, { versionId });
    const audio = authorizeProducerDownload(transaction.context, viewer);
    return open(audioRequest(transaction.context, audio));
  });
}

export async function deliverPublicPortfolioStream<Result>(
  repository: PublicAudioDeliveryRepository,
  input: Readonly<{ portfolioTrackId: string; producerId: string }>,
  open: (request: AudioObjectRequest) => Promise<Result>,
): Promise<Result> {
  const portfolioTrackId = identifier(input.portfolioTrackId, "Public sample id");
  const producerId = identifier(input.producerId, "Producer id");
  return repository.atomically(portfolioTrackId, async (context) => {
    if (
      context.portfolioTrack.id !== portfolioTrackId ||
      context.portfolioTrack.producerId !== producerId
    ) {
      throw new AudioDeliveryDomainError("NOT_FOUND", "Audio was not found");
    }
    const audio = authorizePublicPortfolioStream(context);
    return open({
      ...audio,
      title: context.portfolioTrack.title,
      versionLabel: context.version.label,
    });
  });
}

export type DownloadOverrideState = Readonly<{
  purchaseId: string;
  versionId: string;
  enabled: boolean;
  fullyPaid: boolean;
  unpaidAmountCents: number;
  currency: string;
  overdue: boolean;
  sequence: number;
}>;

function overrideState(context: AudioDeliveryContext): DownloadOverrideState {
  const ledger = requireCommercialLedger(context);
  return {
    purchaseId: context.purchase.id,
    versionId: context.version.id,
    enabled: context.latestOverride?.enabled ?? false,
    fullyPaid: ledger.fullyPaidForDownloads,
    unpaidAmountCents: paymentShortfallCents(context),
    currency: context.purchase.currency,
    overdue: ledger.installments.some(
      (installment) => installment.status === "overdue" && installment.remainingCents > 0,
    ),
    sequence: context.latestOverride?.sequence ?? 0,
  };
}

export type ArtistDownloadEntitlement = DownloadOverrideState &
  Readonly<{
    canDownload: boolean;
    permission: "purchase_fully_paid" | "version_override" | "payment_required" | "audio_deleted";
  }>;

/**
 * Read the exact Chat 17 authorization result for artist UI. Money never gets
 * interpreted in React: the policy decides paid, override, or payment-required.
 */
export async function readArtistDownloadEntitlement(
  repository: AudioDeliveryRepository,
  input: Readonly<{
    artistClerkUserId: string;
    purchaseId: string;
    versionId: string;
  }>,
): Promise<ArtistDownloadEntitlement> {
  const purchaseId = identifier(input.purchaseId, "Purchase id");
  const versionId = identifier(input.versionId, "Version id");
  const viewer: AudioDeliveryViewer = {
    role: "artist",
    clerkUserId: identifier(input.artistClerkUserId, "Artist id"),
  };
  return repository.atomically({ kind: "commercial", purchaseId, versionId }, (transaction) => {
    exactScope(transaction.context, { purchaseId, versionId });
    const state = overrideState(transaction.context);
    authorizeArtistOwner(transaction.context, viewer);
    if (transaction.context.storedAudio.deletedAt !== null) {
      return Promise.resolve<ArtistDownloadEntitlement>({
        ...state,
        canDownload: false,
        permission: "audio_deleted",
      });
    }
    try {
      const authorized = authorizeArtistDownload(transaction.context, viewer);
      return Promise.resolve<ArtistDownloadEntitlement>({
        ...state,
        canDownload: true,
        permission: authorized.reason,
      });
    } catch (error) {
      if (!(error instanceof AudioDeliveryDomainError) || error.code !== "PAYMENT_REQUIRED") {
        throw error;
      }
      return Promise.resolve<ArtistDownloadEntitlement>({
        ...state,
        canDownload: false,
        permission: "payment_required",
      });
    }
  });
}

export async function readDownloadOverrideState(
  repository: AudioDeliveryRepository,
  input: Readonly<{
    producerId: string;
    actorClerkUserId: string;
    purchaseId: string;
    versionId: string;
  }>,
): Promise<DownloadOverrideState> {
  const producerId = identifier(input.producerId, "Producer id");
  const purchaseId = identifier(input.purchaseId, "Purchase id");
  const versionId = identifier(input.versionId, "Version id");
  const viewer: AudioDeliveryViewer = {
    role: "producer",
    clerkUserId: identifier(input.actorClerkUserId, "Override actor id"),
  };
  return repository.atomically({ kind: "commercial", purchaseId, versionId }, (transaction) => {
    exactScope(transaction.context, { purchaseId, versionId });
    if (transaction.context.producer.id !== producerId) {
      throw new AudioDeliveryDomainError("NOT_FOUND", "Audio was not found");
    }
    authorizeProducerOwner(transaction.context, viewer);
    return Promise.resolve(overrideState(transaction.context));
  });
}

export type SetDownloadOverrideInput = Readonly<{
  producerId: string;
  actorClerkUserId: string;
  purchaseId: string;
  versionId: string;
  enabled: boolean;
  operationKey: string;
  expectedUnpaidAmountCents: number;
  occurredAt?: Date;
}>;

export type SetDownloadOverrideResult = Readonly<{
  event: DownloadOverrideEvent;
  state: DownloadOverrideState;
  created: boolean;
}>;

function operationConflict(): never {
  throw new AudioDeliveryDomainError(
    "OPERATION_KEY_CONFLICT",
    "This operation key already belongs to a different override change",
  );
}

export async function setDownloadOverride(
  repository: AudioDeliveryRepository,
  rawInput: SetDownloadOverrideInput,
): Promise<SetDownloadOverrideResult> {
  const producerId = identifier(rawInput.producerId, "Producer id");
  const actorClerkUserId = identifier(rawInput.actorClerkUserId, "Override actor id");
  const purchaseId = identifier(rawInput.purchaseId, "Purchase id");
  const versionId = identifier(rawInput.versionId, "Version id");
  const operationKey = identifier(rawInput.operationKey, "Operation key");
  const expectedUnpaidAmountCents = nonnegativeCents(
    rawInput.expectedUnpaidAmountCents,
    "Expected unpaid amount",
  );
  const occurredAt = date(rawInput.occurredAt ?? new Date());
  const viewer: AudioDeliveryViewer = { role: "producer", clerkUserId: actorClerkUserId };
  const operationDigest = digestCommercialSnapshot({
    kind: "purchase-version-download-override-v1",
    producerId,
    purchaseId,
    versionId,
    enabled: rawInput.enabled,
    actorClerkUserId,
    expectedUnpaidAmountCents,
  });

  return repository.atomically(
    { kind: "commercial", purchaseId, versionId },
    async (transaction) => {
      const context = transaction.context;
      exactScope(context, { purchaseId, versionId });
      if (context.producer.id !== producerId) {
        throw new AudioDeliveryDomainError("NOT_FOUND", "Audio was not found");
      }
      authorizeProducerOwner(context, viewer);

      // A lost-response retry remains idempotent even if a later payment,
      // deletion, correction, or opposite override changed current eligibility.
      const existing = await transaction.findOverrideOperation(operationKey);
      if (existing) {
        if (
          existing.operationDigest !== operationDigest ||
          existing.producerId !== producerId ||
          existing.purchaseId !== purchaseId ||
          existing.versionId !== versionId ||
          existing.enabled !== rawInput.enabled ||
          existing.changedByClerkUserId !== actorClerkUserId
        ) {
          operationConflict();
        }
        return { event: existing, state: overrideState(context), created: false };
      }

      authorizeProducerOverrideManagement(context, viewer);
      if (rawInput.enabled) requireAuthorizedStoredAudio(context);
      const unpaidAmountCents = paymentShortfallCents(context);
      if (unpaidAmountCents !== expectedUnpaidAmountCents) {
        throw new AudioDeliveryDomainError(
          "CONFLICT",
          "The unpaid amount changed. Review the current amount before continuing",
        );
      }
      const sequence = (context.latestOverride?.sequence ?? 0) + 1;
      const event = await transaction.appendOverride({
        purchaseId,
        versionId,
        producerId,
        sequence,
        operationKey,
        operationDigest,
        enabled: rawInput.enabled,
        changedByClerkUserId: actorClerkUserId,
        createdAt: occurredAt,
      });
      if (
        event.sequence !== sequence ||
        event.operationDigest !== operationDigest ||
        event.purchaseId !== purchaseId ||
        event.versionId !== versionId
      ) {
        throw new AudioDeliveryDomainError(
          "INTEGRITY_ERROR",
          "The override audit event was not stored immutably",
        );
      }
      return {
        event,
        state: {
          ...overrideState(context),
          enabled: event.enabled,
          sequence: event.sequence,
        },
        created: true,
      };
    },
  );
}
