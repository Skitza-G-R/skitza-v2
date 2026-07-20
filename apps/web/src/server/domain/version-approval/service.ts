export type VersionApprovalProjectStatus =
  | "waiting_for_payment"
  | "active"
  | "paused"
  | "completed"
  | "canceled";

export type VersionApprovalPurchaseStatus = "waiting_for_payment" | "active" | "canceled";
export type VersionApprovalPaymentPlan = "full" | "split_50_50" | "monthly" | null;
export type VersionApprovalAction = "approved" | "revoked";

export type VersionApprovalProjectRecord = {
  id: string;
  producerId: string;
  clientContactId: string;
  lifecycleStatus: VersionApprovalProjectStatus;
};

export type VersionApprovalPurchaseRecord = {
  id: string;
  projectId: string;
  producerId: string;
  clientContactId: string;
  lifecycleStatus: VersionApprovalPurchaseStatus;
  paymentPlanKind: VersionApprovalPaymentPlan;
  includedSongSpaces: number;
};

export type VersionApprovalTrackRecord = {
  id: string;
  projectId: string;
  purchaseId: string;
  archivedAt: Date | null;
};

export type VersionApprovalVersionRecord = {
  id: string;
  trackId: string;
  purchaseId: string;
  producerId: string;
  audioIdentityFingerprint: string | null;
  audioUrl: string | null;
  audioDeletedAt: Date | null;
  producerMarkedFinalAt: Date | null;
};

export type VersionApprovalEventRecord = {
  id: string;
  versionId: string;
  trackId: string;
  purchaseId: string;
  producerId: string;
  clientContactId: string;
  audioIdentityFingerprint: string;
  action: VersionApprovalAction;
  actedByClerkUserId: string;
  createdAt: Date;
};

export type VersionApprovalInstallmentRecord = {
  id: string;
  purchaseId: string;
  producerId: string;
  position: number;
  dueTrigger: "acceptance" | "monthly_anniversary" | "artist_approval";
  dueAt: Date | null;
  triggeredAt: Date | null;
  status:
    | "not_paid"
    | "awaiting_review"
    | "partially_paid"
    | "confirmed"
    | "overdue"
    | "waived"
    | "canceled";
};

export type VersionApprovalGraph = {
  project: VersionApprovalProjectRecord;
  purchase: VersionApprovalPurchaseRecord;
  artistOwnerClerkUserId: string | null;
  tracks: VersionApprovalTrackRecord[];
  versions: VersionApprovalVersionRecord[];
  /** Newest first. The service still sorts defensively before evaluating state. */
  approvalEvents: VersionApprovalEventRecord[];
  installments: VersionApprovalInstallmentRecord[];
};

export type VersionApprovalAtomicScope =
  | { kind: "producer_ready"; producerId: string; versionId: string }
  | { kind: "artist_approve"; artistClerkUserId: string; versionId: string }
  | {
      kind: "producer_reopen";
      producerId: string;
      trackId: string;
    };

export interface VersionApprovalTransaction {
  readonly graph: VersionApprovalGraph | null;
  setProducerReadyVersion(input: {
    producerId: string;
    projectId: string;
    purchaseId: string;
    trackId: string;
    versionId: string;
    markedFinalAt: Date | null;
    changedAt: Date;
  }): Promise<VersionApprovalVersionRecord | null>;
  appendApprovalEvent(
    input: Omit<VersionApprovalEventRecord, "id">,
  ): Promise<VersionApprovalEventRecord | null>;
  triggerFinalInstallment(input: {
    installmentId: string;
    purchaseId: string;
    producerId: string;
    triggeredAt: Date;
  }): Promise<VersionApprovalInstallmentRecord | null>;
}

export interface VersionApprovalRepository {
  atomically<T>(
    scope: VersionApprovalAtomicScope,
    work: (transaction: VersionApprovalTransaction) => Promise<T>,
  ): Promise<T>;
}

export type VersionApprovalDomainErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "NOT_READY"
  | "LOCKED"
  | "INACTIVE"
  | "CONCURRENT_CHANGE"
  | "INTEGRITY_ERROR";

export class VersionApprovalDomainError extends Error {
  constructor(
    readonly code: VersionApprovalDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VersionApprovalDomainError";
  }
}

function identifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new VersionApprovalDomainError("INVALID_INPUT", `${label} must not be empty`);
  }
  return normalized;
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new VersionApprovalDomainError("INVALID_INPUT", `${label} must be a valid date`);
  }
  return new Date(value);
}

function notFound(): never {
  throw new VersionApprovalDomainError("NOT_FOUND", "The approval target was not found");
}

function integrity(message: string): never {
  throw new VersionApprovalDomainError("INTEGRITY_ERROR", message);
}

function ownedGraph(
  graph: VersionApprovalGraph | null,
  scope: VersionApprovalAtomicScope,
): VersionApprovalGraph {
  if (!graph) notFound();
  const { project, purchase } = graph;
  if (
    purchase.projectId !== project.id ||
    purchase.producerId !== project.producerId ||
    purchase.clientContactId !== project.clientContactId
  ) {
    integrity("The locked purchase does not match its project owner");
  }
  if (scope.kind === "artist_approve") {
    if (
      graph.artistOwnerClerkUserId !== scope.artistClerkUserId ||
      !graph.artistOwnerClerkUserId
    ) {
      notFound();
    }
  } else if (project.producerId !== scope.producerId) {
    notFound();
  }

  const trackIds = new Set<string>();
  for (const track of graph.tracks) {
    if (
      trackIds.has(track.id) ||
      track.projectId !== project.id ||
      track.purchaseId !== purchase.id
    ) {
      integrity("The locked song graph does not match the purchase");
    }
    trackIds.add(track.id);
  }

  const versionIds = new Set<string>();
  const versionById = new Map<string, VersionApprovalVersionRecord>();
  for (const version of graph.versions) {
    if (
      versionIds.has(version.id) ||
      !trackIds.has(version.trackId) ||
      version.purchaseId !== purchase.id ||
      version.producerId !== project.producerId
    ) {
      integrity("The locked version graph does not match the purchase owner");
    }
    versionIds.add(version.id);
    versionById.set(version.id, version);
  }

  const eventIds = new Set<string>();
  for (const event of graph.approvalEvents) {
    const version = versionById.get(event.versionId);
    if (
      eventIds.has(event.id) ||
      !version ||
      event.trackId !== version.trackId ||
      event.purchaseId !== purchase.id ||
      event.producerId !== project.producerId ||
      event.clientContactId !== project.clientContactId ||
      event.audioIdentityFingerprint !== version.audioIdentityFingerprint ||
      !event.actedByClerkUserId.trim() ||
      Number.isNaN(event.createdAt.getTime())
    ) {
      integrity("The approval history does not match the exact audio owner");
    }
    eventIds.add(event.id);
  }

  for (const installment of graph.installments) {
    if (
      installment.purchaseId !== purchase.id ||
      installment.producerId !== project.producerId ||
      !Number.isSafeInteger(installment.position) ||
      installment.position <= 0
    ) {
      integrity("The installment schedule does not match the purchase owner");
    }
  }
  return graph;
}

function targetTrack(
  graph: VersionApprovalGraph,
  scope: VersionApprovalAtomicScope,
): VersionApprovalTrackRecord {
  const trackId =
    scope.kind === "producer_reopen"
      ? scope.trackId
      : graph.versions.find((version) => version.id === scope.versionId)?.trackId;
  const track = graph.tracks.find((candidate) => candidate.id === trackId);
  if (!track) notFound();
  return track;
}

function targetVersion(
  graph: VersionApprovalGraph,
  versionId: string,
  trackId: string,
): VersionApprovalVersionRecord {
  const version = graph.versions.find(
    (candidate) => candidate.id === versionId && candidate.trackId === trackId,
  );
  if (!version) notFound();
  return version;
}

function newestFirst(
  left: VersionApprovalEventRecord,
  right: VersionApprovalEventRecord,
): number {
  const time = right.createdAt.getTime() - left.createdAt.getTime();
  return time === 0 ? right.id.localeCompare(left.id) : time;
}

export function latestSongApprovalEvent(
  graph: VersionApprovalGraph,
  trackId: string,
): VersionApprovalEventRecord | null {
  return (
    graph.approvalEvents
      .filter((event) => event.trackId === trackId)
      .sort(newestFirst)[0] ?? null
  );
}

export function isSongArtistApprovalLocked(
  graph: VersionApprovalGraph,
  trackId: string,
): boolean {
  return latestSongApprovalEvent(graph, trackId)?.action === "approved";
}

export type VersionApprovalPresentation = Readonly<{
  artistApprovedAt: Date | null;
  previouslyArtistApprovedAt: Date | null;
}>;

/**
 * Keeps the current exact approval distinct from preserved approval history.
 * Events must belong to the same song; unknown version ids are ignored so a
 * caller cannot accidentally surface another song's history.
 */
export function presentVersionApprovalHistory(
  versionIds: readonly string[],
  events: readonly Pick<
    VersionApprovalEventRecord,
    "id" | "versionId" | "action" | "createdAt"
  >[],
): ReadonlyMap<string, VersionApprovalPresentation> {
  const knownVersions = new Set(versionIds);
  const ordered = events
    .filter((event) => knownVersions.has(event.versionId))
    .sort((left, right) => {
      const time = right.createdAt.getTime() - left.createdAt.getTime();
      return time === 0 ? right.id.localeCompare(left.id) : time;
    });
  const current = ordered[0] ?? null;
  const latestApprovalByVersion = new Map<string, Date>();
  for (const event of ordered) {
    if (event.action === "approved" && !latestApprovalByVersion.has(event.versionId)) {
      latestApprovalByVersion.set(event.versionId, new Date(event.createdAt));
    }
  }

  return new Map(
    versionIds.map((versionId) => {
      const isCurrent = current?.action === "approved" && current.versionId === versionId;
      const historicalApproval = latestApprovalByVersion.get(versionId) ?? null;
      return [
        versionId,
        {
          artistApprovedAt: isCurrent ? new Date(current.createdAt) : null,
          previouslyArtistApprovedAt: isCurrent ? null : historicalApproval,
        },
      ];
    }),
  );
}

function assertActive(graph: VersionApprovalGraph, track: VersionApprovalTrackRecord): void {
  if (
    graph.project.lifecycleStatus !== "active" ||
    graph.purchase.lifecycleStatus !== "active"
  ) {
    throw new VersionApprovalDomainError(
      "INACTIVE",
      "Exact-version approval is available only while the project and purchase are active",
    );
  }
  if (track.archivedAt !== null) {
    throw new VersionApprovalDomainError(
      "INACTIVE",
      "Restore this archived song before changing its final approval",
    );
  }
}

function assertReadyAudio(version: VersionApprovalVersionRecord): string {
  if (
    version.audioUrl === null ||
    version.audioDeletedAt !== null ||
    version.audioIdentityFingerprint === null
  ) {
    throw new VersionApprovalDomainError(
      "NOT_READY",
      "Only completed, stored audio can be marked ready or approved",
    );
  }
  return version.audioIdentityFingerprint;
}

function nextEventTime(requestedAt: Date, current: VersionApprovalEventRecord | null): Date {
  if (!current || requestedAt.getTime() > current.createdAt.getTime()) return requestedAt;
  return new Date(current.createdAt.getTime() + 1);
}

function readyVersionForTrack(
  graph: VersionApprovalGraph,
  trackId: string,
): VersionApprovalVersionRecord | null {
  const ready = graph.versions.filter(
    (version) => version.trackId === trackId && version.producerMarkedFinalAt !== null,
  );
  if (ready.length > 1) integrity("A song has more than one producer-ready version");
  return ready[0] ?? null;
}

function everyIncludedSongApproved(graph: VersionApprovalGraph): boolean {
  const expected = graph.purchase.includedSongSpaces;
  if (!Number.isSafeInteger(expected) || expected < 0) {
    integrity("The purchase has an invalid included-song count");
  }
  if (expected === 0 || graph.tracks.length !== expected) return false;

  return graph.tracks.every((track) => {
    const ready = readyVersionForTrack(graph, track.id);
    if (!ready || ready.audioIdentityFingerprint === null) return false;
    const latest = latestSongApprovalEvent(graph, track.id);
    return (
      latest?.action === "approved" &&
      latest.versionId === ready.id &&
      latest.audioIdentityFingerprint === ready.audioIdentityFingerprint
    );
  });
}

function finalApprovalInstallment(
  graph: VersionApprovalGraph,
): VersionApprovalInstallmentRecord {
  const matches = graph.installments.filter(
    (installment) => installment.position === 2 && installment.dueTrigger === "artist_approval",
  );
  if (matches.length !== 1) {
    integrity("The 50/50 purchase does not have one exact artist-approval installment");
  }
  return matches[0] as VersionApprovalInstallmentRecord;
}

export async function markProducerVersionReady(
  repository: VersionApprovalRepository,
  input: {
    producerId: string;
    versionId: string;
    ready: boolean;
    changedAt: Date;
  },
): Promise<{ changed: boolean; readyVersionId: string | null; markedFinalAt: Date | null }> {
  const producerId = identifier(input.producerId, "Producer id");
  const versionId = identifier(input.versionId, "Version id");
  const changedAt = validDate(input.changedAt, "Ready change time");
  if (typeof input.ready !== "boolean") {
    throw new VersionApprovalDomainError("INVALID_INPUT", "Ready state must be boolean");
  }

  return repository.atomically(
    { kind: "producer_ready", producerId, versionId },
    async (transaction) => {
      const graph = ownedGraph(transaction.graph, {
        kind: "producer_ready",
        producerId,
        versionId,
      });
      const track = targetTrack(graph, { kind: "producer_ready", producerId, versionId });
      const version = targetVersion(graph, versionId, track.id);
      assertActive(graph, track);
      if (isSongArtistApprovalLocked(graph, track.id)) {
        throw new VersionApprovalDomainError(
          "LOCKED",
          "Reopen this artist-approved song before changing its ready version",
        );
      }

      if (input.ready) {
        assertReadyAudio(version);
        const current = readyVersionForTrack(graph, track.id);
        if (current?.id === version.id && current.producerMarkedFinalAt !== null) {
          return {
            changed: false,
            readyVersionId: version.id,
            markedFinalAt: new Date(current.producerMarkedFinalAt),
          };
        }
      } else if (version.producerMarkedFinalAt === null) {
        return { changed: false, readyVersionId: null, markedFinalAt: null };
      }

      const markedFinalAt = input.ready ? changedAt : null;
      const updated = await transaction.setProducerReadyVersion({
        producerId,
        projectId: graph.project.id,
        purchaseId: graph.purchase.id,
        trackId: track.id,
        versionId,
        markedFinalAt,
        changedAt,
      });
      if (
        !updated ||
        updated.id !== version.id ||
        updated.trackId !== track.id ||
        updated.purchaseId !== graph.purchase.id ||
        updated.producerId !== producerId ||
        (updated.producerMarkedFinalAt?.getTime() ?? null) !== (markedFinalAt?.getTime() ?? null)
      ) {
        throw new VersionApprovalDomainError(
          "CONCURRENT_CHANGE",
          "The producer-ready version changed concurrently",
        );
      }
      return {
        changed: true,
        readyVersionId: input.ready ? version.id : null,
        markedFinalAt,
      };
    },
  );
}

export async function approveExactReadyVersion(
  repository: VersionApprovalRepository,
  input: { artistClerkUserId: string; versionId: string; approvedAt: Date },
): Promise<{
  changed: boolean;
  approvedVersionId: string;
  approvedAt: Date;
  finalInstallmentTriggered: boolean;
}> {
  const artistClerkUserId = identifier(input.artistClerkUserId, "Artist account id");
  const versionId = identifier(input.versionId, "Version id");
  const requestedAt = validDate(input.approvedAt, "Approval time");

  return repository.atomically(
    { kind: "artist_approve", artistClerkUserId, versionId },
    async (transaction) => {
      const graph = ownedGraph(transaction.graph, {
        kind: "artist_approve",
        artistClerkUserId,
        versionId,
      });
      const track = targetTrack(graph, {
        kind: "artist_approve",
        artistClerkUserId,
        versionId,
      });
      const version = targetVersion(graph, versionId, track.id);
      assertActive(graph, track);
      const fingerprint = assertReadyAudio(version);
      const ready = readyVersionForTrack(graph, track.id);
      if (!ready || ready.id !== version.id || ready.audioIdentityFingerprint !== fingerprint) {
        throw new VersionApprovalDomainError(
          "NOT_READY",
          "The producer has not marked this exact audio version ready",
        );
      }

      const current = latestSongApprovalEvent(graph, track.id);
      if (current?.action === "approved") {
        if (
          current.versionId !== version.id ||
          current.audioIdentityFingerprint !== fingerprint ||
          current.actedByClerkUserId !== artistClerkUserId
        ) {
          throw new VersionApprovalDomainError(
            "LOCKED",
            "This song already has a different current artist approval",
          );
        }
        return {
          changed: false,
          approvedVersionId: version.id,
          approvedAt: new Date(current.createdAt),
          finalInstallmentTriggered: false,
        };
      }

      const approvedAt = nextEventTime(requestedAt, current);
      const event = await transaction.appendApprovalEvent({
        versionId: version.id,
        trackId: track.id,
        purchaseId: graph.purchase.id,
        producerId: graph.project.producerId,
        clientContactId: graph.project.clientContactId,
        audioIdentityFingerprint: fingerprint,
        action: "approved",
        actedByClerkUserId: artistClerkUserId,
        createdAt: approvedAt,
      });
      if (
        !event ||
        event.versionId !== version.id ||
        event.trackId !== track.id ||
        event.action !== "approved" ||
        event.actedByClerkUserId !== artistClerkUserId ||
        event.createdAt.getTime() !== approvedAt.getTime()
      ) {
        throw new VersionApprovalDomainError(
          "CONCURRENT_CHANGE",
          "The exact-version approval changed concurrently",
        );
      }

      const nextGraph: VersionApprovalGraph = {
        ...graph,
        approvalEvents: [event, ...graph.approvalEvents],
      };
      let finalInstallmentTriggered = false;
      if (
        graph.purchase.paymentPlanKind === "split_50_50" &&
        everyIncludedSongApproved(nextGraph)
      ) {
        const installment = finalApprovalInstallment(graph);
        if (installment.triggeredAt === null) {
          if (installment.status !== "not_paid" || installment.dueAt !== null) {
            integrity("The conditional final installment is already collectible without a trigger");
          }
          const triggered = await transaction.triggerFinalInstallment({
            installmentId: installment.id,
            purchaseId: graph.purchase.id,
            producerId: graph.project.producerId,
            triggeredAt: approvedAt,
          });
          if (
            !triggered ||
            triggered.id !== installment.id ||
            triggered.triggeredAt?.getTime() !== approvedAt.getTime() ||
            triggered.dueAt?.getTime() !== approvedAt.getTime()
          ) {
            throw new VersionApprovalDomainError(
              "CONCURRENT_CHANGE",
              "The final installment trigger changed concurrently",
            );
          }
          finalInstallmentTriggered = true;
        }
      }

      return {
        changed: true,
        approvedVersionId: version.id,
        approvedAt,
        finalInstallmentTriggered,
      };
    },
  );
}

export async function reopenArtistApprovedSong(
  repository: VersionApprovalRepository,
  input: {
    producerId: string;
    actorClerkUserId: string;
    trackId: string;
    reopenedAt: Date;
  },
): Promise<{ changed: boolean; previouslyApprovedVersionId: string | null; reopenedAt: Date | null }> {
  const producerId = identifier(input.producerId, "Producer id");
  const actorClerkUserId = identifier(input.actorClerkUserId, "Producer account id");
  const trackId = identifier(input.trackId, "Song id");
  const requestedAt = validDate(input.reopenedAt, "Reopen time");

  return repository.atomically(
    { kind: "producer_reopen", producerId, trackId },
    async (transaction) => {
      const graph = ownedGraph(transaction.graph, {
        kind: "producer_reopen",
        producerId,
        trackId,
      });
      const track = targetTrack(graph, { kind: "producer_reopen", producerId, trackId });
      assertActive(graph, track);
      const current = latestSongApprovalEvent(graph, track.id);
      if (!current || current.action === "revoked") {
        return { changed: false, previouslyApprovedVersionId: null, reopenedAt: null };
      }

      const version = targetVersion(graph, current.versionId, track.id);
      if (
        version.audioIdentityFingerprint === null ||
        current.audioIdentityFingerprint !== version.audioIdentityFingerprint
      ) {
        integrity("The current approval no longer matches its immutable audio identity");
      }
      const reopenedAt = nextEventTime(requestedAt, current);
      const event = await transaction.appendApprovalEvent({
        versionId: version.id,
        trackId: track.id,
        purchaseId: graph.purchase.id,
        producerId,
        clientContactId: graph.project.clientContactId,
        audioIdentityFingerprint: current.audioIdentityFingerprint,
        action: "revoked",
        actedByClerkUserId: actorClerkUserId,
        createdAt: reopenedAt,
      });
      if (
        !event ||
        event.versionId !== version.id ||
        event.trackId !== track.id ||
        event.action !== "revoked" ||
        event.actedByClerkUserId !== actorClerkUserId ||
        event.createdAt.getTime() !== reopenedAt.getTime()
      ) {
        throw new VersionApprovalDomainError(
          "CONCURRENT_CHANGE",
          "The song reopen changed concurrently",
        );
      }

      const cleared = await transaction.setProducerReadyVersion({
        producerId,
        projectId: graph.project.id,
        purchaseId: graph.purchase.id,
        trackId: track.id,
        versionId: version.id,
        markedFinalAt: null,
        changedAt: reopenedAt,
      });
      if (!cleared || cleared.id !== version.id || cleared.producerMarkedFinalAt !== null) {
        throw new VersionApprovalDomainError(
          "CONCURRENT_CHANGE",
          "The producer-ready version changed during reopen",
        );
      }
      return { changed: true, previouslyApprovedVersionId: version.id, reopenedAt };
    },
  );
}
