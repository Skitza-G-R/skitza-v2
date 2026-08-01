import {
  AudioDeliveryDomainError,
  authorizeProducerOwner,
  paymentShortfallCents,
  requireCommercialLedger,
  type AudioDeliveryContext,
  type AudioDeliveryViewer,
} from "./policy";
import type { DownloadOverrideState } from "./service";

export type ProducerDownloadStateBatchScope = Readonly<{
  producerId: string;
  actorClerkUserId: string;
  trackId: string;
  purchaseId: string;
  versionIds: readonly string[];
}>;

export interface ProducerDownloadStateBatchRepository {
  atomically<T>(
    scope: ProducerDownloadStateBatchScope,
    work: (contexts: readonly AudioDeliveryContext[]) => Promise<T>,
  ): Promise<T>;
}

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

function exactVersionIds(versionIds: readonly string[]): readonly string[] {
  if (versionIds.length === 0) {
    throw new AudioDeliveryDomainError("INVALID_INPUT", "At least one version id is required");
  }
  const normalized = versionIds.map((versionId) => identifier(versionId, "Version id"));
  if (new Set(normalized).size !== normalized.length) {
    throw new AudioDeliveryDomainError("INVALID_INPUT", "Version ids must be unique");
  }
  return normalized;
}

function notFound(): never {
  throw new AudioDeliveryDomainError("NOT_FOUND", "Audio was not found");
}

function stateFor(context: AudioDeliveryContext): DownloadOverrideState {
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

/**
 * Read every producer override state for one exact track and purchase snapshot.
 * The repository owns the shared transaction and returns contexts from that
 * snapshot; this service keeps authorization and state projection in policy.
 */
export async function readProducerDownloadOverrideStates(
  repository: ProducerDownloadStateBatchRepository,
  input: ProducerDownloadStateBatchScope,
): Promise<readonly DownloadOverrideState[]> {
  const producerId = identifier(input.producerId, "Producer id");
  const actorClerkUserId = identifier(input.actorClerkUserId, "Override actor id");
  const trackId = identifier(input.trackId, "Track id");
  const purchaseId = identifier(input.purchaseId, "Purchase id");
  const versionIds = exactVersionIds(input.versionIds);
  const requestedVersionIds = new Set(versionIds);
  const viewer: AudioDeliveryViewer = { role: "producer", clerkUserId: actorClerkUserId };

  return repository.atomically(
    { producerId, actorClerkUserId, trackId, purchaseId, versionIds },
    (contexts) => {
      if (contexts.length !== versionIds.length) notFound();

      const contextsByVersionId = new Map<string, AudioDeliveryContext>();
      for (const context of contexts) {
        if (
          !requestedVersionIds.has(context.version.id) ||
          contextsByVersionId.has(context.version.id) ||
          context.producer.id !== producerId ||
          context.purchase.id !== purchaseId ||
          context.song.id !== trackId ||
          context.version.trackId !== trackId ||
          context.version.purchaseId !== purchaseId
        ) {
          notFound();
        }
        authorizeProducerOwner(context, viewer);
        contextsByVersionId.set(context.version.id, context);
      }

      return Promise.resolve(
        versionIds.map((versionId) => {
          const context = contextsByVersionId.get(versionId);
          if (!context) notFound();
          return stateFor(context);
        }),
      );
    },
  );
}
