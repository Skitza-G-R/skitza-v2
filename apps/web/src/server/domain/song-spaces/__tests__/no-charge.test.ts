import { describe, expect, it } from "vitest";

import type {
  AcceptedPurchase,
  NewAcceptedPurchase,
  PurchaseAcceptanceRecord,
  PurchaseAtomicRepository,
  PurchaseAtomicScope,
  PurchaseAtomicTransaction,
  PurchaseOperationScope,
  PurchaseSource,
} from "../../purchases/service";
import {
  acceptNoChargeSongSpaceProposal,
  createNoChargeSongSpaceProposal,
  previewNoChargeSongSpaceProposal,
  type NoChargeProposalAcceptTransaction,
  type NoChargeProposalContext,
  type NoChargeProposalRepository,
} from "../no-charge";
import {
  signNoChargeProposalToken,
  type NoChargeProposalPayload,
  verifyNoChargeProposalToken,
} from "../no-charge-token";
import type { NewSongSpaceRecord, SongSpaceRecord } from "../service";

const SIGNING_SECRET = "test-only-no-charge-signing-key-32-bytes-long";
const ROTATED_SIGNING_SECRET = "rotated-no-charge-signing-key-is-32-bytes-long";
const ACCEPTED_AT = new Date("2026-07-19T10:00:00.000Z");
const ARTIST_CLERK_USER_ID = "artist-clerk-1";

const context: NoChargeProposalContext = {
  producerId: "producer-1",
  producerName: "North Studio",
  projectId: "project-1",
  projectTitle: "Night Drive",
  projectLifecycleStatus: "active",
  clientContactId: "client-1",
  artistClerkUserId: ARTIST_CLERK_USER_ID,
  artistHasProducerIdentity: false,
  activeSongSpaceCapacityExhausted: true,
  sourceProductId: "product-1",
  sourceProductName: "Single Production",
  sourceCurrency: "ILS",
};

class MemoryPurchaseRepository implements PurchaseAtomicRepository, PurchaseAtomicTransaction {
  readonly purchases = new Map<string, AcceptedPurchase>();
  readonly acceptances = new Map<string, PurchaseAcceptanceRecord>();

  constructor(private readonly context: () => NoChargeProposalContext | null) {}

  atomically<T>(
    _scope: PurchaseAtomicScope,
    work: (transaction: PurchaseAtomicTransaction) => Promise<T>,
  ): Promise<T> {
    return work(this);
  }

  getProjectForUpdate(projectId: string) {
    const current = this.context();
    return Promise.resolve(
      current && projectId === current.projectId
        ? {
            id: current.projectId,
            producerId: current.producerId,
            clientContactId: current.clientContactId,
            clientClerkUserId: current.artistClerkUserId,
            lifecycleStatus: current.projectLifecycleStatus,
          }
        : null,
    );
  }

  loadPurchaseSourceDescriptor(source: PurchaseSource) {
    const current = this.context();
    return Promise.resolve({
      product:
        current && source.productId === current.sourceProductId
          ? { id: current.sourceProductId, producerId: current.producerId }
          : null,
      privateOffer: null,
      purchaseRequest: null,
    });
  }

  findPurchaseByOperationKey(scope: PurchaseOperationScope) {
    return Promise.resolve(
      [...this.purchases.values()].find(
        (purchase) =>
          purchase.producerId === scope.producerId &&
          purchase.clientContactId === scope.clientContactId &&
          purchase.operationKey === scope.operationKey,
      ) ?? null,
    );
  }

  insertPurchase(input: NewAcceptedPurchase) {
    const purchase: AcceptedPurchase = {
      ...input,
      id: `purchase-${String(this.purchases.size + 1)}`,
    };
    this.purchases.set(purchase.id, purchase);
    return Promise.resolve(purchase);
  }

  findAcceptanceForPurchase(purchaseId: string) {
    return Promise.resolve(this.acceptances.get(purchaseId) ?? null);
  }

  insertAcceptanceFromPurchase(purchase: AcceptedPurchase, acceptedByClerkUserId: string) {
    const acceptance: PurchaseAcceptanceRecord = {
      id: `acceptance-${purchase.id}`,
      purchaseId: purchase.id,
      producerId: purchase.producerId,
      clientContactId: purchase.clientContactId,
      acceptedByClerkUserId,
      commercialSnapshot: purchase.commercialSnapshot,
      snapshotDigest: purchase.commercialSnapshot.digest,
      acceptedAt: purchase.acceptedAt,
    };
    this.acceptances.set(purchase.id, acceptance);
    return Promise.resolve(acceptance);
  }

  getPurchaseForUpdate(purchaseId: string) {
    return Promise.resolve(this.purchases.get(purchaseId) ?? null);
  }

  findPaymentByOperationKey() {
    return Promise.resolve(null);
  }

  insertPayment(): never {
    throw new Error("not used");
  }

  listPayments() {
    return Promise.resolve([]);
  }

  listCorrections() {
    return Promise.resolve([]);
  }

  listWaivers() {
    return Promise.resolve([]);
  }

  isInstallmentCollectible() {
    return Promise.resolve(false);
  }

  activatePurchaseAndProject(purchase: AcceptedPurchase, activatedAt: Date) {
    const active: AcceptedPurchase = {
      ...purchase,
      lifecycleStatus: "active",
      lifecycleChangedAt: purchase.lifecycleChangedAt,
      activatedAt: purchase.activatedAt ?? activatedAt,
    };
    this.purchases.set(active.id, active);
    return Promise.resolve({
      purchaseId: active.id,
      producerId: active.producerId,
      projectId: active.projectId,
      purchaseLifecycleStatus: "active" as const,
      purchaseLifecycleChangedAt: active.lifecycleChangedAt,
      purchaseActivatedAt: active.activatedAt ?? activatedAt,
      projectLifecycleStatus: "active" as const,
      projectLifecycleChangedAt: active.lifecycleChangedAt,
    });
  }
}

class MemoryNoChargeProposalRepository implements NoChargeProposalRepository {
  readonly purchaseRepository: MemoryPurchaseRepository;
  readonly tracks: SongSpaceRecord[] = [];
  producerLoads = 0;
  artistLoads = 0;
  atomicAccepts = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(public currentContext: NoChargeProposalContext | null = context) {
    this.purchaseRepository = new MemoryPurchaseRepository(() => this.currentContext);
  }

  loadForProducer(producerId: string, projectId: string) {
    this.producerLoads += 1;
    const row = this.currentContext;
    return Promise.resolve(
      row?.producerId === producerId && row.projectId === projectId ? row : null,
    );
  }

  loadForArtist(payload: NoChargeProposalPayload, clerkUserId: string) {
    this.artistLoads += 1;
    const row = this.currentContext;
    return Promise.resolve(
      row?.producerId === payload.producerId &&
        row.projectId === payload.projectId &&
        row.artistClerkUserId === clerkUserId
        ? row
        : null,
    );
  }

  async acceptAtomically<T>(
    _payload: NoChargeProposalPayload,
    work: (transaction: NoChargeProposalAcceptTransaction) => Promise<T>,
  ): Promise<T> {
    this.atomicAccepts += 1;
    const previous = this.queue;
    let release = (): void => undefined;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work({
        purchaseRepository: this.purchaseRepository,
        loadForArtistForUpdate: (payload, clerkUserId) => this.loadForArtist(payload, clerkUserId),
        hasPurchaseForOperation: (producerId, clientContactId, operationKey) =>
          Promise.resolve(
            [...this.purchaseRepository.purchases.values()].some(
              (purchase) =>
                purchase.producerId === producerId &&
                purchase.clientContactId === clientContactId &&
                purchase.operationKey === operationKey,
            ),
          ),
        findSongSpaceForPurchase: (purchaseId) =>
          Promise.resolve(this.tracks.find((track) => track.purchaseId === purchaseId) ?? null),
        nextProjectPosition: () => Promise.resolve(this.tracks.length),
        insertSongSpace: (input: NewSongSpaceRecord) => {
          const row: SongSpaceRecord = {
            ...input,
            id: `track-${String(this.tracks.length + 1)}`,
          };
          this.tracks.push(row);
          return Promise.resolve(row);
        },
        touchProject: () => Promise.resolve(),
      });
    } finally {
      release();
    }
  }
}

async function proposal(
  repository: MemoryNoChargeProposalRepository,
  patch: Partial<Parameters<typeof createNoChargeSongSpaceProposal>[1]> = {},
) {
  return createNoChargeSongSpaceProposal(repository, {
    producerId: context.producerId,
    projectId: context.projectId,
    operationKey: "proposal-operation-1",
    songTitle: "Neon Signs",
    signingSecret: SIGNING_SECRET,
    ...patch,
  });
}

async function preview(
  repository: MemoryNoChargeProposalRepository,
  proposalToken: string,
  clerkUserId = ARTIST_CLERK_USER_ID,
) {
  return previewNoChargeSongSpaceProposal(repository, {
    proposalToken,
    clerkUserId,
    signingSecret: SIGNING_SECRET,
  });
}

async function accept(
  repository: MemoryNoChargeProposalRepository,
  proposalToken: string,
  expectedSnapshotDigest: string,
  patch: Partial<Parameters<typeof acceptNoChargeSongSpaceProposal>[1]> = {},
) {
  return acceptNoChargeSongSpaceProposal(repository, {
    proposalToken,
    clerkUserId: ARTIST_CLERK_USER_ID,
    signingSecret: SIGNING_SECRET,
    expectedSnapshotDigest,
    agreementAccepted: true,
    acceptedAt: ACCEPTED_AT,
    ...patch,
  });
}

function expectNoAcceptanceWrites(repository: MemoryNoChargeProposalRepository): void {
  expect(repository.purchaseRepository.purchases.size).toBe(0);
  expect(repository.purchaseRepository.acceptances.size).toBe(0);
  expect(repository.tracks).toHaveLength(0);
}

describe("stateless no-charge song-space proposals", () => {
  it("creates the same signed proposal for an exact producer operation retry", async () => {
    const repository = new MemoryNoChargeProposalRepository();
    const first = await proposal(repository);
    const replay = await proposal(repository);

    expect(first).toEqual(replay);
    expect(first.created).toBe(true);
    expect(first.proposalToken).not.toContain(SIGNING_SECRET);
    expectNoAcceptanceWrites(repository);
    expect(verifyNoChargeProposalToken(SIGNING_SECRET, first.proposalToken)).toMatchObject({
      producerId: context.producerId,
      projectId: context.projectId,
      clientContactId: context.clientContactId,
      sourceProductId: context.sourceProductId,
      songTitle: "Neon Signs",
      projectTitle: context.projectTitle,
      sourceProductName: context.sourceProductName,
    });
  });

  it("keeps an existing durable proposal usable after the active key rotates", async () => {
    const repository = new MemoryNoChargeProposalRepository();
    const created = await proposal(repository);
    const signingSecret = [ROTATED_SIGNING_SECRET, SIGNING_SECRET];

    const exact = await previewNoChargeSongSpaceProposal(repository, {
      proposalToken: created.proposalToken,
      clerkUserId: ARTIST_CLERK_USER_ID,
      signingSecret,
    });
    const accepted = await acceptNoChargeSongSpaceProposal(repository, {
      proposalToken: created.proposalToken,
      clerkUserId: ARTIST_CLERK_USER_ID,
      signingSecret,
      expectedSnapshotDigest: exact.snapshotDigest,
      agreementAccepted: true,
      acceptedAt: ACCEPTED_AT,
    });

    expect(accepted.created).toBe(true);
    expect(repository.tracks.find((track) => track.id === accepted.trackId)?.title).toBe(
      "Neon Signs",
    );
  });

  it("fails closed before proposal creation for a producer identity or malformed artist contact", async () => {
    for (const changed of [
      { ...context, artistHasProducerIdentity: true },
      { ...context, artistClerkUserId: ` ${ARTIST_CLERK_USER_ID} ` },
      { ...context, artistClerkUserId: "" },
    ]) {
      const repository = new MemoryNoChargeProposalRepository(changed);

      await expect(proposal(repository)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expectNoAcceptanceWrites(repository);
    }
  });

  it("requires every existing active purchased song space to be allocated", async () => {
    const repository = new MemoryNoChargeProposalRepository({
      ...context,
      activeSongSpaceCapacityExhausted: false,
    });

    await expect(proposal(repository)).rejects.toMatchObject({ code: "CAPACITY_EXCEEDED" });
    expectNoAcceptanceWrites(repository);
  });

  it("previews exact frozen zero terms only for the matching signed-in artist", async () => {
    const repository = new MemoryNoChargeProposalRepository();
    const created = await proposal(repository);
    const result = await preview(repository, created.proposalToken);

    expect(result).toMatchObject({
      producerId: context.producerId,
      projectId: context.projectId,
      projectTitle: context.projectTitle,
      songTitle: "Neon Signs",
      producerName: context.producerName,
      sourceProductId: context.sourceProductId,
      sourceProductName: context.sourceProductName,
      snapshot: {
        totalCents: 0,
        currency: "ILS",
        includedSongSpaces: 1,
        selectedPaymentPlan: null,
        offeredPaymentPlans: [],
      },
    });
    await expect(
      preview(repository, created.proposalToken, "foreign-artist"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expectNoAcceptanceWrites(repository);
  });

  it("rejects a non-canonical signed-in artist before preview repository access", async () => {
    const repository = new MemoryNoChargeProposalRepository();
    const created = await proposal(repository);

    await expect(
      preview(repository, created.proposalToken, ` ${ARTIST_CLERK_USER_ID} `),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(repository.artistLoads).toBe(0);
    expectNoAcceptanceWrites(repository);
  });

  it("revalidates producer-role exclusion on preview without hiding accepted-term retries", async () => {
    const repository = new MemoryNoChargeProposalRepository();
    const created = await proposal(repository);

    repository.currentContext = { ...context, artistHasProducerIdentity: true };
    await expect(preview(repository, created.proposalToken)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    repository.currentContext = { ...context, activeSongSpaceCapacityExhausted: false };
    const retryPreview = await preview(repository, created.proposalToken);
    expect(retryPreview.snapshotDigest).toMatch(/^[a-f0-9]{64}$/);
    expectNoAcceptanceWrites(repository);
  });

  it("rejects payload and signature tampering before any repository lookup", async () => {
    const repository = new MemoryNoChargeProposalRepository();
    const created = await proposal(repository);
    const [payload = "", signature = ""] = created.proposalToken.split(".");

    await expect(preview(repository, `${payload}x.${signature}`)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(preview(repository, `${payload}.${signature}x`)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(repository.artistLoads).toBe(0);
    expectNoAcceptanceWrites(repository);
  });

  it("rejects non-canonical base64url signatures even when they decode to the same bytes", async () => {
    const repository = new MemoryNoChargeProposalRepository();
    const created = await proposal(repository);
    const [payload = "", signature = ""] = created.proposalToken.split(".");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = signature.at(-1) ?? "";
    const index = alphabet.indexOf(last);
    expect(index).toBeGreaterThanOrEqual(0);
    const alternateLast = alphabet[(index & ~3) + ((index + 1) & 3)];
    expect(alternateLast).toBeDefined();
    const alternateSignature = `${signature.slice(0, -1)}${alternateLast ?? ""}`;
    expect(Buffer.from(alternateSignature, "base64url")).toEqual(
      Buffer.from(signature, "base64url"),
    );

    await expect(preview(repository, `${payload}.${alternateSignature}`)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(repository.artistLoads).toBe(0);
  });

  it("revalidates active project, client, product source, and artist on preview", async () => {
    const repository = new MemoryNoChargeProposalRepository();
    const created = await proposal(repository);

    for (const changed of [
      { ...context, projectLifecycleStatus: "paused" as const },
      { ...context, clientContactId: "other-client" },
      { ...context, sourceProductId: "other-product" },
      { ...context, artistClerkUserId: "other-artist" },
    ]) {
      repository.currentContext = changed;
      await expect(preview(repository, created.proposalToken)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
    expectNoAcceptanceWrites(repository);
  });

  it("fails closed during acceptance for a producer actor or identity, inactive project, or changed source", async () => {
    const cases: ReadonlyArray<{
      contextPatch?: Partial<NoChargeProposalContext>;
      clerkUserId?: string;
    }> = [
      { clerkUserId: "producer-clerk-1" },
      { contextPatch: { artistHasProducerIdentity: true } },
      { contextPatch: { projectLifecycleStatus: "paused" } },
      { contextPatch: { sourceProductId: "product-2" } },
      { contextPatch: { sourceCurrency: "USD" } },
    ];

    for (const testCase of cases) {
      const repository = new MemoryNoChargeProposalRepository();
      const created = await proposal(repository);
      const exact = await preview(repository, created.proposalToken);
      repository.currentContext = { ...context, ...testCase.contextPatch };

      await expect(
        accept(repository, created.proposalToken, exact.snapshotDigest, {
          ...(testCase.clerkUserId ? { clerkUserId: testCase.clerkUserId } : {}),
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expectNoAcceptanceWrites(repository);
    }
  });

  it("rejects a non-canonical signed-in artist before the acceptance transaction", async () => {
    const repository = new MemoryNoChargeProposalRepository();
    const created = await proposal(repository);
    const exact = await preview(repository, created.proposalToken);

    await expect(
      accept(repository, created.proposalToken, exact.snapshotDigest, {
        clerkUserId: ` ${ARTIST_CLERK_USER_ID} `,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(repository.atomicAccepts).toBe(0);
    expectNoAcceptanceWrites(repository);
  });

  it("rechecks exhausted purchased capacity in the acceptance transaction before writing", async () => {
    const repository = new MemoryNoChargeProposalRepository();
    const created = await proposal(repository);
    const exact = await preview(repository, created.proposalToken);
    repository.currentContext = { ...context, activeSongSpaceCapacityExhausted: false };

    await expect(
      accept(repository, created.proposalToken, exact.snapshotDigest),
    ).rejects.toMatchObject({ code: "CAPACITY_EXCEEDED" });
    expectNoAcceptanceWrites(repository);
  });

  it("requires explicit agreement and the exact preview digest", async () => {
    const repository = new MemoryNoChargeProposalRepository();
    const created = await proposal(repository);
    const exact = await preview(repository, created.proposalToken);

    await expect(
      accept(repository, created.proposalToken, exact.snapshotDigest, {
        agreementAccepted: false,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(accept(repository, created.proposalToken, "0".repeat(64))).rejects.toMatchObject({
      code: "OPERATION_KEY_CONFLICT",
    });
    expect(repository.atomicAccepts).toBe(0);
    expectNoAcceptanceWrites(repository);
  });

  it("calls the canonical acceptance boundary and creates one active ₪0 purchase plus one song", async () => {
    const repository = new MemoryNoChargeProposalRepository();
    const created = await proposal(repository);
    const exact = await preview(repository, created.proposalToken);
    const result = await accept(repository, created.proposalToken, exact.snapshotDigest);

    expect(result).toMatchObject({ projectId: context.projectId, created: true });
    const purchase = repository.purchaseRepository.purchases.get(result.purchaseId);
    expect(purchase).toMatchObject({
      producerId: context.producerId,
      projectId: context.projectId,
      clientContactId: context.clientContactId,
      source: {
        kind: "no_charge_add_on",
        productId: context.sourceProductId,
        privateOfferId: null,
        purchaseRequestId: null,
      },
      totalCents: 0,
      plan: null,
      lifecycleStatus: "active",
      activatedAt: ACCEPTED_AT,
    });
    expect(purchase?.commercialSnapshot.value.includedSongSpaces).toBe(1);
    expect(purchase?.commercialSnapshot.value).toMatchObject({
      version: 2,
      bookingEnabled: false,
      session: null,
    });
    expect(purchase?.commercialSnapshot.value.agreementText).toContain(context.projectTitle);
    expect(purchase?.commercialSnapshot.value.agreementText).toContain("Neon Signs");
    expect(purchase?.commercialSnapshot.value.agreementText).toContain(context.sourceProductName);
    expect(repository.purchaseRepository.acceptances.get(result.purchaseId)).toMatchObject({
      acceptedByClerkUserId: context.artistClerkUserId,
    });
    expect(repository.purchaseRepository.acceptances.size).toBe(1);
    expect(repository.tracks).toEqual([
      expect.objectContaining({
        id: result.trackId,
        projectId: context.projectId,
        purchaseId: result.purchaseId,
        title: "Neon Signs",
      }),
    ]);
  });

  it("replays an accepted proposal without changing its artist, time, purchase, or song", async () => {
    const repository = new MemoryNoChargeProposalRepository();
    const created = await proposal(repository);
    const exact = await preview(repository, created.proposalToken);
    const first = await accept(repository, created.proposalToken, exact.snapshotDigest);
    repository.currentContext = { ...context, activeSongSpaceCapacityExhausted: false };
    const replay = await accept(repository, created.proposalToken, exact.snapshotDigest, {
      acceptedAt: new Date("2026-07-19T11:00:00.000Z"),
    });

    expect(first.created).toBe(true);
    expect(replay).toEqual({ ...first, created: false });
    expect(repository.purchaseRepository.purchases.size).toBe(1);
    expect(repository.purchaseRepository.acceptances.size).toBe(1);
    expect(repository.purchaseRepository.acceptances.get(first.purchaseId)).toMatchObject({
      acceptedByClerkUserId: context.artistClerkUserId,
      acceptedAt: ACCEPTED_AT,
    });
    expect(repository.tracks).toHaveLength(1);
  });

  it("replays after the allocated song is renamed without recycling or duplicating it", async () => {
    const repository = new MemoryNoChargeProposalRepository();
    const created = await proposal(repository);
    const exact = await preview(repository, created.proposalToken);
    const first = await accept(repository, created.proposalToken, exact.snapshotDigest);
    const stored = repository.tracks[0];
    if (!stored) throw new Error("Missing accepted song fixture");
    repository.tracks[0] = { ...stored, title: "Renamed after acceptance" };

    const replay = await accept(repository, created.proposalToken, exact.snapshotDigest);

    expect(replay).toEqual({ ...first, created: false });
    expect(repository.tracks).toEqual([
      expect.objectContaining({ id: first.trackId, title: "Renamed after acceptance" }),
    ]);
    expect(repository.purchaseRepository.purchases.size).toBe(1);
    expect(repository.purchaseRepository.acceptances.size).toBe(1);
  });

  it("collapses concurrent acceptance retries onto one purchase and one allocation", async () => {
    const repository = new MemoryNoChargeProposalRepository();
    const created = await proposal(repository);
    const exact = await preview(repository, created.proposalToken);

    const [first, replay] = await Promise.all([
      accept(repository, created.proposalToken, exact.snapshotDigest),
      accept(repository, created.proposalToken, exact.snapshotDigest, {
        acceptedAt: new Date("2026-07-19T10:00:01.000Z"),
      }),
    ]);

    expect(first.purchaseId).toBe(replay.purchaseId);
    expect(first.trackId).toBe(replay.trackId);
    expect([first.created, replay.created].sort()).toEqual([false, true]);
    expect(repository.purchaseRepository.purchases.size).toBe(1);
    expect(repository.purchaseRepository.acceptances.size).toBe(1);
    expect(repository.tracks).toHaveLength(1);
  });

  it("fails closed when a signed proposal is retargeted to foreign ownership", async () => {
    const repository = new MemoryNoChargeProposalRepository();
    const created = await proposal(repository);
    const payload = verifyNoChargeProposalToken(SIGNING_SECRET, created.proposalToken);
    const foreignToken = signNoChargeProposalToken(SIGNING_SECRET, {
      ...payload,
      projectId: "foreign-project",
    });

    await expect(preview(repository, foreignToken)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expectNoAcceptanceWrites(repository);
  });

  it("prevents title, project, or product-source retargeting of one operation identity", async () => {
    const cases: ReadonlyArray<{
      contextPatch?: Partial<NoChargeProposalContext>;
      proposalPatch: Partial<Parameters<typeof createNoChargeSongSpaceProposal>[1]>;
    }> = [
      { proposalPatch: { songTitle: "Changed title" } },
      {
        contextPatch: { projectId: "project-2", projectTitle: "Different project" },
        proposalPatch: { projectId: "project-2" },
      },
      {
        contextPatch: {
          sourceProductId: "product-2",
          sourceProductName: "Different product",
        },
        proposalPatch: {},
      },
    ];

    for (const testCase of cases) {
      const repository = new MemoryNoChargeProposalRepository();
      const first = await proposal(repository);
      const firstPreview = await preview(repository, first.proposalToken);
      await accept(repository, first.proposalToken, firstPreview.snapshotDigest);

      repository.currentContext = { ...context, ...testCase.contextPatch };
      const changed = await proposal(repository, testCase.proposalPatch);
      const changedPreview = await preview(repository, changed.proposalToken);
      await expect(
        accept(repository, changed.proposalToken, changedPreview.snapshotDigest),
      ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });

      const [purchase] = repository.purchaseRepository.purchases.values();
      expect(purchase).toMatchObject({
        projectId: context.projectId,
        source: { productId: context.sourceProductId },
      });
      expect(repository.purchaseRepository.purchases.size).toBe(1);
      expect(repository.purchaseRepository.acceptances.size).toBe(1);
      expect(repository.tracks).toEqual([
        expect.objectContaining({
          projectId: context.projectId,
          title: "Neon Signs",
        }),
      ]);
    }
  });
});
