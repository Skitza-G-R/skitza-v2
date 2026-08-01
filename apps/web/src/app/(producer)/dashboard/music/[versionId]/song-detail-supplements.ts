import type { DownloadOverrideState } from "~/server/domain/audio-delivery/service";

export interface ProducerSongSharingState {
  trackId: string;
  linkEnabled: boolean;
  portfolioPublished: boolean;
  remainingAudioCount: number;
  tokenVersion: number | null;
  publicUrl: string | null;
}

interface ProducerSongSupplementCaller {
  songPublication: {
    producerState(input: { trackId: string }): Promise<ProducerSongSharingState>;
  };
  audioDelivery: {
    overrideStates(input: {
      purchaseId: string;
      trackId: string;
      versionIds: string[];
    }): Promise<{ states: readonly DownloadOverrideState[] }>;
  };
}

interface ProducerSongSupplementData {
  track: { id: string };
  versions: readonly { id: string; purchaseId: string }[];
}

function exactBatchScope(data: ProducerSongSupplementData): {
  purchaseId: string;
  trackId: string;
  versionIds: string[];
} | null {
  if (data.versions.length === 0) return null;

  const first = data.versions[0];
  if (!first) return null;
  const versionIds = data.versions.map((version) => version.id);
  if (new Set(versionIds).size !== versionIds.length) {
    throw new Error("Song detail returned duplicate version identities");
  }
  if (data.versions.some((version) => version.purchaseId !== first.purchaseId)) {
    throw new Error("Song detail versions crossed a purchase boundary");
  }
  return {
    purchaseId: first.purchaseId,
    trackId: data.track.id,
    versionIds,
  };
}

/**
 * Loads the two authenticated song-page supplements in one deterministic lock
 * order. Both procedures take transaction-scoped locks across the same song,
 * purchase, project, and producer graph; overlapping them can deadlock the
 * server render. Delivery remains one exact-track batch, so adding versions
 * cannot add page-level tRPC calls or repeat the same purchase-ledger read.
 */
export async function loadProducerSongSupplements(
  caller: ProducerSongSupplementCaller,
  data: ProducerSongSupplementData,
): Promise<{
  sharing: ProducerSongSharingState;
  overrideByVersion: ReadonlyMap<string, DownloadOverrideState>;
}> {
  const batchScope = exactBatchScope(data);
  const sharing = await caller.songPublication.producerState({ trackId: data.track.id });

  if (!batchScope) {
    return {
      sharing,
      overrideByVersion: new Map(),
    };
  }

  const delivery = await caller.audioDelivery.overrideStates(batchScope);
  const requested = new Set(batchScope.versionIds);
  const overrideByVersion = new Map<string, DownloadOverrideState>();
  for (const state of delivery.states) {
    if (
      state.purchaseId !== batchScope.purchaseId ||
      !requested.has(state.versionId) ||
      overrideByVersion.has(state.versionId)
    ) {
      throw new Error("Song delivery batch returned an invalid version scope");
    }
    overrideByVersion.set(state.versionId, state);
  }
  if (overrideByVersion.size !== batchScope.versionIds.length) {
    throw new Error("Song delivery batch omitted a requested version");
  }

  return { sharing, overrideByVersion };
}
