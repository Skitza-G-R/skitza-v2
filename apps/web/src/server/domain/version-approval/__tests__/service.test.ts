import { describe, expect, it } from "vitest";

import {
  approveExactReadyVersion,
  markProducerVersionReady,
  presentVersionApprovalHistory,
  reopenArtistApprovedSong,
  VersionApprovalDomainError,
  type VersionApprovalAtomicScope,
  type VersionApprovalEventRecord,
  type VersionApprovalGraph,
  type VersionApprovalRepository,
  type VersionApprovalTransaction,
} from "../service";

const PRODUCER_ID = "producer-1";
const ARTIST_ID = "artist-1";
const CLIENT_ID = "client-1";
const PROJECT_ID = "project-1";
const PURCHASE_ID = "purchase-1";
const TRACK_1 = "track-1";
const TRACK_2 = "track-2";
const VERSION_1 = "version-1";
const VERSION_2 = "version-2";
const VERSION_3 = "version-3";
const BASE_TIME = new Date("2026-07-20T08:00:00.000Z");

function at(offsetMs: number): Date {
  return new Date(BASE_TIME.getTime() + offsetMs);
}

function fingerprint(versionId: string): string {
  return `sha256:${versionId.padEnd(64, "0").slice(0, 64)}`;
}

function graph(songCount = 1): VersionApprovalGraph {
  const tracks = [
    {
      id: TRACK_1,
      projectId: PROJECT_ID,
      purchaseId: PURCHASE_ID,
      archivedAt: null,
    },
    ...(songCount > 1
      ? [
          {
            id: TRACK_2,
            projectId: PROJECT_ID,
            purchaseId: PURCHASE_ID,
            archivedAt: null,
          },
        ]
      : []),
  ];
  return {
    project: {
      id: PROJECT_ID,
      producerId: PRODUCER_ID,
      clientContactId: CLIENT_ID,
      lifecycleStatus: "active",
    },
    purchase: {
      id: PURCHASE_ID,
      projectId: PROJECT_ID,
      producerId: PRODUCER_ID,
      clientContactId: CLIENT_ID,
      lifecycleStatus: "active",
      paymentPlanKind: "split_50_50",
      includedSongSpaces: songCount,
    },
    artistOwnerClerkUserId: ARTIST_ID,
    tracks,
    versions: [
      {
        id: VERSION_1,
        trackId: TRACK_1,
        purchaseId: PURCHASE_ID,
        producerId: PRODUCER_ID,
        audioIdentityFingerprint: fingerprint(VERSION_1),
        audioUrl: `/audio/${VERSION_1}`,
        audioDeletedAt: null,
        producerMarkedFinalAt: null,
      },
      {
        id: VERSION_2,
        trackId: TRACK_1,
        purchaseId: PURCHASE_ID,
        producerId: PRODUCER_ID,
        audioIdentityFingerprint: fingerprint(VERSION_2),
        audioUrl: `/audio/${VERSION_2}`,
        audioDeletedAt: null,
        producerMarkedFinalAt: null,
      },
      ...(songCount > 1
        ? [
            {
              id: VERSION_3,
              trackId: TRACK_2,
              purchaseId: PURCHASE_ID,
              producerId: PRODUCER_ID,
              audioIdentityFingerprint: fingerprint(VERSION_3),
              audioUrl: `/audio/${VERSION_3}`,
              audioDeletedAt: null,
              producerMarkedFinalAt: null,
            },
          ]
        : []),
    ],
    approvalEvents: [],
    installments: [
      {
        id: "installment-1",
        purchaseId: PURCHASE_ID,
        producerId: PRODUCER_ID,
        position: 1,
        dueTrigger: "acceptance",
        dueAt: at(-10_000),
        triggeredAt: at(-10_000),
        status: "confirmed",
      },
      {
        id: "installment-2",
        purchaseId: PURCHASE_ID,
        producerId: PRODUCER_ID,
        position: 2,
        dueTrigger: "artist_approval",
        dueAt: null,
        triggeredAt: null,
        status: "not_paid",
      },
    ],
  };
}

function cloneDate(value: Date | null): Date | null {
  return value === null ? null : new Date(value);
}

function cloneGraph(value: VersionApprovalGraph): VersionApprovalGraph {
  return {
    project: { ...value.project },
    purchase: { ...value.purchase },
    artistOwnerClerkUserId: value.artistOwnerClerkUserId,
    tracks: value.tracks.map((track) => ({ ...track, archivedAt: cloneDate(track.archivedAt) })),
    versions: value.versions.map((version) => ({
      ...version,
      audioDeletedAt: cloneDate(version.audioDeletedAt),
      producerMarkedFinalAt: cloneDate(version.producerMarkedFinalAt),
    })),
    approvalEvents: value.approvalEvents.map((event) => ({
      ...event,
      createdAt: new Date(event.createdAt),
    })),
    installments: value.installments.map((installment) => ({
      ...installment,
      dueAt: cloneDate(installment.dueAt),
      triggeredAt: cloneDate(installment.triggeredAt),
    })),
  };
}

class MemoryRepository implements VersionApprovalRepository {
  graph: VersionApprovalGraph;
  approvalEventWrites = 0;
  finalTriggerWrites = 0;
  private eventSequence = 0;
  private queue = Promise.resolve();

  constructor(initial = graph()) {
    this.graph = cloneGraph(initial);
  }

  async atomically<T>(
    scope: VersionApprovalAtomicScope,
    work: (transaction: VersionApprovalTransaction) => Promise<T>,
  ): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const draft = cloneGraph(this.graph);
    const version =
      "versionId" in scope
        ? draft.versions.find((candidate) => candidate.id === scope.versionId)
        : undefined;
    const track =
      scope.kind === "producer_reopen"
        ? draft.tracks.find((candidate) => candidate.id === scope.trackId)
        : draft.tracks.find((candidate) => candidate.id === version?.trackId);
    const authorized =
      Boolean(track) &&
      (scope.kind === "artist_approve"
        ? scope.artistClerkUserId === draft.artistOwnerClerkUserId
        : scope.producerId === draft.project.producerId);

    const transaction: VersionApprovalTransaction = {
      graph: authorized ? draft : null,
      setProducerReadyVersion: (input) => {
        const target = draft.versions.find((candidate) => candidate.id === input.versionId);
        if (!target || target.trackId !== input.trackId) return Promise.resolve(null);
        for (const candidate of draft.versions) {
          if (candidate.trackId === input.trackId) candidate.producerMarkedFinalAt = null;
        }
        target.producerMarkedFinalAt = cloneDate(input.markedFinalAt);
        return Promise.resolve({
          ...target,
          producerMarkedFinalAt: cloneDate(target.producerMarkedFinalAt),
        });
      },
      appendApprovalEvent: (input) => {
        this.eventSequence += 1;
        const row: VersionApprovalEventRecord = {
          id: `event-${String(this.eventSequence)}`,
          ...input,
          createdAt: new Date(input.createdAt),
        };
        draft.approvalEvents = [row, ...draft.approvalEvents];
        this.approvalEventWrites += 1;
        return Promise.resolve(row);
      },
      triggerFinalInstallment: (input) => {
        const installment = draft.installments.find(
          (candidate) =>
            candidate.id === input.installmentId &&
            candidate.purchaseId === input.purchaseId &&
            candidate.producerId === input.producerId,
        );
        if (!installment || installment.triggeredAt !== null) return Promise.resolve(null);
        installment.triggeredAt = new Date(input.triggeredAt);
        installment.dueAt = new Date(input.triggeredAt);
        this.finalTriggerWrites += 1;
        return Promise.resolve({
          ...installment,
          dueAt: cloneDate(installment.dueAt),
          triggeredAt: cloneDate(installment.triggeredAt),
        });
      },
    };

    try {
      const result = await work(transaction);
      if (authorized) this.graph = draft;
      return result;
    } finally {
      release();
    }
  }
}

async function ready(repo: MemoryRepository, versionId: string, changedAt: Date): Promise<void> {
  await markProducerVersionReady(repo, {
    producerId: PRODUCER_ID,
    versionId,
    ready: true,
    changedAt,
  });
}

async function approve(repo: MemoryRepository, versionId: string, approvedAt: Date) {
  return approveExactReadyVersion(repo, {
    artistClerkUserId: ARTIST_ID,
    versionId,
    approvedAt,
  });
}

describe("exact-version artist approval", () => {
  it("keeps producer readiness separate from artist approval and payment", async () => {
    const repo = new MemoryRepository();
    const result = await markProducerVersionReady(repo, {
      producerId: PRODUCER_ID,
      versionId: VERSION_1,
      ready: true,
      changedAt: at(1_000),
    });

    expect(result).toMatchObject({ changed: true, readyVersionId: VERSION_1 });
    expect(repo.graph.versions.find((version) => version.id === VERSION_1)?.producerMarkedFinalAt)
      .toEqual(at(1_000));
    expect(repo.graph.approvalEvents).toEqual([]);
    expect(repo.graph.installments[1]?.triggeredAt).toBeNull();
  });

  it("returns the same non-leaking not-found failure for foreign producers and artists", async () => {
    const producerAttempt = markProducerVersionReady(new MemoryRepository(), {
      producerId: "foreign-producer",
      versionId: VERSION_1,
      ready: true,
      changedAt: at(1_000),
    });
    await expect(producerAttempt).rejects.toMatchObject({ code: "NOT_FOUND" });

    const repo = new MemoryRepository();
    await ready(repo, VERSION_1, at(1_000));
    const artistAttempt = approveExactReadyVersion(repo, {
      artistClerkUserId: "foreign-artist",
      versionId: VERSION_1,
      approvedAt: at(2_000),
    });
    await expect(artistAttempt).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires the exact completed producer-ready version", async () => {
    const repo = new MemoryRepository();
    await ready(repo, VERSION_1, at(1_000));

    await expect(approve(repo, VERSION_2, at(2_000))).rejects.toMatchObject({
      code: "NOT_READY",
    });
    expect(repo.graph.approvalEvents).toEqual([]);
  });

  it("triggers a single-song 50/50 final installment exactly once", async () => {
    const repo = new MemoryRepository();
    await ready(repo, VERSION_1, at(1_000));

    const [first, retry] = await Promise.all([
      approve(repo, VERSION_1, at(2_000)),
      approve(repo, VERSION_1, at(2_000)),
    ]);

    expect([first.changed, retry.changed].sort()).toEqual([false, true]);
    expect(repo.graph.approvalEvents.filter((event) => event.action === "approved")).toHaveLength(1);
    expect(repo.approvalEventWrites).toBe(1);
    expect(repo.finalTriggerWrites).toBe(1);
    expect(repo.graph.installments[1]?.triggeredAt).toEqual(at(2_000));
  });

  it("waits for every included album song before triggering the final installment", async () => {
    const repo = new MemoryRepository(graph(2));
    await ready(repo, VERSION_1, at(1_000));
    await ready(repo, VERSION_3, at(1_100));

    const first = await approve(repo, VERSION_1, at(2_000));
    expect(first.finalInstallmentTriggered).toBe(false);
    expect(repo.graph.installments[1]?.triggeredAt).toBeNull();

    const second = await approve(repo, VERSION_3, at(3_000));
    expect(second.finalInstallmentTriggered).toBe(true);
    expect(repo.graph.installments[1]?.triggeredAt).toEqual(at(3_000));
  });

  it("preserves approval history on reopen, unlocks the song, and requires new readiness", async () => {
    const repo = new MemoryRepository();
    await ready(repo, VERSION_1, at(1_000));
    await approve(repo, VERSION_1, at(2_000));

    const [first, retry] = await Promise.all([
      reopenArtistApprovedSong(repo, {
        producerId: PRODUCER_ID,
        actorClerkUserId: "producer-user-1",
        trackId: TRACK_1,
        reopenedAt: at(3_000),
      }),
      reopenArtistApprovedSong(repo, {
        producerId: PRODUCER_ID,
        actorClerkUserId: "producer-user-1",
        trackId: TRACK_1,
        reopenedAt: at(3_000),
      }),
    ]);

    expect([first.changed, retry.changed].sort()).toEqual([false, true]);
    expect(repo.graph.approvalEvents.map((event) => event.action)).toEqual([
      "revoked",
      "approved",
    ]);
    expect(
      repo.graph.versions.filter((version) => version.trackId === TRACK_1 && version.producerMarkedFinalAt),
    ).toEqual([]);
    expect(repo.graph.installments[1]?.triggeredAt).toEqual(at(2_000));

    await expect(approve(repo, VERSION_1, at(4_000))).rejects.toMatchObject({
      code: "NOT_READY",
    });
    await ready(repo, VERSION_2, at(5_000));
    await expect(approve(repo, VERSION_2, at(6_000))).resolves.toMatchObject({ changed: true });
    expect(repo.graph.approvalEvents.map((event) => event.action)).toEqual([
      "approved",
      "revoked",
      "approved",
    ]);
  });

  it("blocks producer final changes while the artist approval lock is current", async () => {
    const repo = new MemoryRepository();
    await ready(repo, VERSION_1, at(1_000));
    await approve(repo, VERSION_1, at(2_000));

    await expect(ready(repo, VERSION_2, at(3_000))).rejects.toMatchObject({ code: "LOCKED" });
    expect(repo.graph.versions.find((version) => version.id === VERSION_1)?.producerMarkedFinalAt)
      .toEqual(at(1_000));
  });

  it("uses a domain error type with stable transport-facing codes", () => {
    const error = new VersionApprovalDomainError("NOT_FOUND", "The approval target was not found");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("NOT_FOUND");
  });

  it("presents current approval separately from preserved reopened history", () => {
    const events = [
      {
        id: "event-2",
        versionId: VERSION_1,
        action: "revoked" as const,
        createdAt: at(3_000),
      },
      {
        id: "event-1",
        versionId: VERSION_1,
        action: "approved" as const,
        createdAt: at(2_000),
      },
    ];
    expect(presentVersionApprovalHistory([VERSION_1, VERSION_2], events).get(VERSION_1)).toEqual({
      artistApprovedAt: null,
      previouslyArtistApprovedAt: at(2_000),
    });
    expect(presentVersionApprovalHistory([VERSION_1, VERSION_2], events).get(VERSION_2)).toEqual({
      artistApprovedAt: null,
      previouslyArtistApprovedAt: null,
    });
  });
});
