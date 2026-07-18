import { describe, expect, expectTypeOf, it } from "vitest";

import type { PurchaseCommercialSnapshot } from "@skitza/db";

import type { DebtWaiver, PaymentCorrection } from "../ledger";
import {
  acceptPurchase,
  confirmPurchasePayment,
  PurchaseDomainError,
  type AcceptPurchaseInput,
  type AcceptedPurchase,
  type ConfirmedPaymentRecord,
  type NewAcceptedPurchase,
  type NewConfirmedPaymentRecord,
  type PurchaseAtomicRepository,
  type PurchaseAtomicScope,
  type PurchaseAtomicTransaction,
  type PurchaseAcceptanceRecord,
  type PurchaseOperationScope,
  type PurchaseProjectActivation,
  type PurchaseSource,
  type PurchaseSourceDescriptor,
} from "../service";

function requiredFixture<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required purchase test fixture is missing");
  return value;
}

class MemoryPurchaseRepository implements PurchaseAtomicRepository, PurchaseAtomicTransaction {
  private queue: Promise<void> = Promise.resolve();
  private projectLockHeld = false;
  private purchaseNumber = 0;
  private acceptanceNumber = 0;
  private paymentNumber = 0;
  readonly purchases = new Map<string, AcceptedPurchase>();
  readonly acceptances = new Map<string, PurchaseAcceptanceRecord>();
  readonly payments: ConfirmedPaymentRecord[] = [];
  readonly corrections: PaymentCorrection[] = [];
  readonly waivers: DebtWaiver[] = [];
  readonly nonCollectibleInstallments = new Set<string>();
  readonly acceptanceEvents: string[] = [];
  readonly targetProjects = new Map<
    string,
    {
      id: string;
      producerId: string;
      clientContactId: string;
      lifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
    }
  >([
    [
      "project-1",
      {
        id: "project-1",
        producerId: "producer-1",
        clientContactId: "client-1",
        lifecycleStatus: "waiting_for_payment" as const,
      },
    ],
  ]);
  pendingProjectLifecycleTransition:
    | "waiting_for_payment"
    | "active"
    | "paused"
    | "completed"
    | "canceled"
    | null = null;
  readonly sourceProducts = new Map<string, NonNullable<PurchaseSourceDescriptor["product"]>>([
    ["product-1", { id: "product-1", producerId: "producer-1" }],
    ["product-2", { id: "product-2", producerId: "producer-1" }],
  ]);
  readonly sourcePrivateOffers = new Map<
    string,
    NonNullable<PurchaseSourceDescriptor["privateOffer"]>
  >([
    [
      "offer-zero",
      {
        id: "offer-zero",
        producerId: "producer-1",
        clientContactId: "client-1",
        targetProjectId: "project-1",
        productId: null,
      },
    ],
    [
      "offer-product-1",
      {
        id: "offer-product-1",
        producerId: "producer-1",
        clientContactId: "client-1",
        targetProjectId: "project-1",
        productId: "product-1",
      },
    ],
  ]);
  readonly sourcePurchaseRequests = new Map<
    string,
    NonNullable<PurchaseSourceDescriptor["purchaseRequest"]>
  >([
    [
      "request-1",
      {
        id: "request-1",
        producerId: "producer-1",
        clientContactId: "client-1",
        projectId: "project-1",
        productId: "product-1",
      },
    ],
  ]);
  insertedSourceOverride: AcceptedPurchase["source"] | null = null;
  insertedPaymentOverride: Partial<ConfirmedPaymentRecord> | null = null;
  activationOverride: PurchaseProjectActivation | null = null;
  readonly projectLifecycles = new Map<
    string,
    {
      status: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
      changedAt: Date;
    }
  >();

  async atomically<T>(
    _scope: PurchaseAtomicScope,
    work: (transaction: PurchaseAtomicTransaction) => Promise<T>,
  ): Promise<T> {
    const previous = this.queue;
    let release = (): void => undefined;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work(this);
    } finally {
      if (this.pendingProjectLifecycleTransition !== null && this.projectLockHeld) {
        const project = this.targetProjects.get("project-1");
        if (project) {
          this.targetProjects.set("project-1", {
            ...project,
            lifecycleStatus: this.pendingProjectLifecycleTransition,
          });
          this.acceptanceEvents.push("project-transition-applied-after-transaction");
        }
        this.pendingProjectLifecycleTransition = null;
      }
      this.projectLockHeld = false;
      release();
    }
  }

  getProjectForUpdate(projectId: string) {
    this.projectLockHeld = true;
    this.acceptanceEvents.push(`project-lock:${projectId}`);
    return Promise.resolve(this.targetProjects.get(projectId) ?? null);
  }

  loadPurchaseSourceDescriptor(source: PurchaseSource): Promise<PurchaseSourceDescriptor> {
    if (this.pendingProjectLifecycleTransition !== null) {
      if (this.projectLockHeld) {
        this.acceptanceEvents.push("project-transition-waiting-on-lock");
      } else {
        const project = this.targetProjects.get("project-1");
        if (project) {
          this.targetProjects.set("project-1", {
            ...project,
            lifecycleStatus: this.pendingProjectLifecycleTransition,
          });
        }
        this.pendingProjectLifecycleTransition = null;
        this.acceptanceEvents.push("project-transition-applied-before-source");
      }
    }
    this.acceptanceEvents.push("source-load");
    return Promise.resolve({
      product:
        source.productId === null ? null : (this.sourceProducts.get(source.productId) ?? null),
      privateOffer:
        source.privateOfferId === null
          ? null
          : (this.sourcePrivateOffers.get(source.privateOfferId) ?? null),
      purchaseRequest:
        source.purchaseRequestId === null
          ? null
          : (this.sourcePurchaseRequests.get(source.purchaseRequestId) ?? null),
    });
  }

  findPurchaseByOperationKey(scope: PurchaseOperationScope): Promise<AcceptedPurchase | null> {
    this.acceptanceEvents.push("operation-key-read");
    return Promise.resolve(
      [...this.purchases.values()].find(
        (purchase) =>
          purchase.producerId === scope.producerId &&
          purchase.clientContactId === scope.clientContactId &&
          purchase.operationKey === scope.operationKey,
      ) ?? null,
    );
  }

  insertPurchase(input: NewAcceptedPurchase): Promise<AcceptedPurchase> {
    this.acceptanceEvents.push("purchase-insert");
    this.purchaseNumber += 1;
    const purchase = {
      ...input,
      id: `purchase-${String(this.purchaseNumber)}`,
      source: this.insertedSourceOverride ?? input.source,
    };
    this.purchases.set(purchase.id, purchase);
    return Promise.resolve(purchase);
  }

  findAcceptanceForPurchase(purchaseId: string): Promise<PurchaseAcceptanceRecord | null> {
    return Promise.resolve(this.acceptances.get(purchaseId) ?? null);
  }

  insertAcceptanceFromPurchase(
    purchase: AcceptedPurchase,
    acceptedByClerkUserId: string,
  ): Promise<PurchaseAcceptanceRecord> {
    this.acceptanceNumber += 1;
    const acceptance = {
      id: `acceptance-${String(this.acceptanceNumber)}`,
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

  getPurchaseForUpdate(purchaseId: string): Promise<AcceptedPurchase | null> {
    return Promise.resolve(this.purchases.get(purchaseId) ?? null);
  }

  findPaymentByOperationKey(
    purchaseId: string,
    operationKey: string,
  ): Promise<ConfirmedPaymentRecord | null> {
    return Promise.resolve(
      this.payments.find(
        (payment) => payment.purchaseId === purchaseId && payment.operationKey === operationKey,
      ) ?? null,
    );
  }

  insertPayment(input: NewConfirmedPaymentRecord): Promise<ConfirmedPaymentRecord> {
    this.paymentNumber += 1;
    const payment = {
      ...input,
      id: `payment-${String(this.paymentNumber)}`,
      ...this.insertedPaymentOverride,
    };
    this.payments.push(payment);
    return Promise.resolve(payment);
  }

  listPayments(purchaseId: string): Promise<readonly ConfirmedPaymentRecord[]> {
    return Promise.resolve(this.payments.filter((payment) => payment.purchaseId === purchaseId));
  }

  listCorrections(purchaseId: string): Promise<readonly PaymentCorrection[]> {
    const paymentIds = new Set(
      this.payments
        .filter((payment) => payment.purchaseId === purchaseId)
        .map((payment) => payment.id),
    );
    return Promise.resolve(
      this.corrections.filter((correction) => paymentIds.has(correction.paymentId)),
    );
  }

  listWaivers(purchaseId: string): Promise<readonly DebtWaiver[]> {
    void purchaseId;
    return Promise.resolve(this.waivers);
  }

  isInstallmentCollectible(purchaseId: string, installmentSequence: number): Promise<boolean> {
    return Promise.resolve(
      !this.nonCollectibleInstallments.has(`${purchaseId}:${String(installmentSequence)}`),
    );
  }

  activatePurchaseAndProject(
    suppliedPurchase: AcceptedPurchase,
    activatedAt: Date,
  ): Promise<PurchaseProjectActivation> {
    const purchase = this.purchases.get(suppliedPurchase.id);
    if (!purchase) throw new Error("missing purchase");
    if (purchase.lifecycleStatus === "canceled") throw new Error("canceled purchase");
    if (this.activationOverride) return Promise.resolve(this.activationOverride);
    const activePurchase: AcceptedPurchase =
      purchase.lifecycleStatus === "active"
        ? purchase
        : {
            ...purchase,
            lifecycleStatus: "active",
            lifecycleChangedAt: activatedAt,
            activatedAt,
          };
    this.purchases.set(activePurchase.id, activePurchase);

    const projectKey = `${purchase.producerId}:${purchase.projectId}`;
    const project = this.projectLifecycles.get(projectKey) ?? {
      status: "waiting_for_payment" as const,
      changedAt: purchase.acceptedAt,
    };
    if (project.status !== "waiting_for_payment" && project.status !== "active") {
      throw new Error("terminal project");
    }
    const activeProject =
      project.status === "active" ? project : { status: "active" as const, changedAt: activatedAt };
    this.projectLifecycles.set(projectKey, activeProject);

    return Promise.resolve({
      purchaseId: activePurchase.id,
      producerId: activePurchase.producerId,
      projectId: activePurchase.projectId,
      purchaseLifecycleStatus: "active",
      purchaseLifecycleChangedAt: activePurchase.lifecycleChangedAt,
      purchaseActivatedAt: activePurchase.activatedAt ?? activatedAt,
      projectLifecycleStatus: "active",
      projectLifecycleChangedAt: activeProject.changedAt,
    });
  }
}

function commercialSnapshot(
  totalCents: number,
  selectedPaymentPlan: PurchaseCommercialSnapshot["selectedPaymentPlan"],
): PurchaseCommercialSnapshot {
  return {
    version: 1,
    productOrOfferName: "Mix",
    deliverables: ["Stereo mix"],
    lineItems:
      totalCents === 0
        ? []
        : [
            {
              label: "Mix",
              quantity: 1,
              listUnitPriceCents: totalCents,
              unitPriceCents: totalCents,
              totalCents,
            },
          ],
    listSubtotalCents: totalCents,
    discountCents: 0,
    subtotalCents: totalCents,
    tax: { mode: "tax_free", ratePct: 0, amountCents: 0 },
    totalCents,
    currency: "ILS",
    includedSongSpaces: 1,
    session: null,
    revisionRule: null,
    royaltyTerms: null,
    rights: [],
    selectedPaymentPlan,
    offeredPaymentPlans: selectedPaymentPlan ? [selectedPaymentPlan] : [],
    agreementText: "Approved commercial terms",
  };
}

const baseAcceptance = {
  producerId: "producer-1",
  projectId: "project-1",
  clientContactId: "client-1",
  source: {
    kind: "store_product" as const,
    productId: "product-1",
    privateOfferId: null,
    purchaseRequestId: "request-1",
  },
  acceptedByClerkUserId: "clerk-artist-1",
  totalCents: 10_000,
  plan: { kind: "full" as const },
  commercialSnapshot: commercialSnapshot(10_000, { kind: "full" }),
  acceptedAt: new Date("2026-07-01T10:00:00Z"),
};

const noChargeSource = {
  kind: "no_charge_add_on" as const,
  productId: "product-1",
  privateOfferId: null,
  purchaseRequestId: null,
};

describe("acceptPurchase", () => {
  it("requires the database commercial snapshot shape at the acceptance boundary", () => {
    expectTypeOf<
      AcceptPurchaseInput["commercialSnapshot"]
    >().toEqualTypeOf<PurchaseCommercialSnapshot>();
  });

  it("collapses concurrent exact operation-key retries into one purchase", async () => {
    const repository = new MemoryPurchaseRepository();
    const input = { ...baseAcceptance, operationKey: "request-1" };

    const [left, right] = await Promise.all([
      acceptPurchase(repository, input),
      acceptPurchase(repository, input),
    ]);

    expect(repository.purchases.size).toBe(1);
    expect(repository.acceptances.size).toBe(1);
    expect(left.purchase.id).toBe(right.purchase.id);
    expect(left.acceptance.id).toBe(right.acceptance.id);
    expect([left.created, right.created].sort()).toEqual([false, true]);
  });

  it.each(["waiting_for_payment", "active"] as const)(
    "locks an exact owned %s project before source validation and purchase insertion",
    async (lifecycleStatus) => {
      const repository = new MemoryPurchaseRepository();
      repository.targetProjects.set("project-1", {
        ...requiredFixture(repository.targetProjects.get("project-1")),
        lifecycleStatus,
      });

      await expect(
        acceptPurchase(repository, {
          ...baseAcceptance,
          operationKey: `allowed-project-${lifecycleStatus}`,
        }),
      ).resolves.toMatchObject({ created: true });
      expect(repository.acceptanceEvents.slice(0, 4)).toEqual([
        "project-lock:project-1",
        "source-load",
        "operation-key-read",
        "purchase-insert",
      ]);
    },
  );

  it.each(["paused", "completed", "canceled"] as const)(
    "rejects a %s target project before reading source anchors",
    async (lifecycleStatus) => {
      const repository = new MemoryPurchaseRepository();
      repository.targetProjects.set("project-1", {
        ...requiredFixture(repository.targetProjects.get("project-1")),
        lifecycleStatus,
      });

      await expect(
        acceptPurchase(repository, {
          ...baseAcceptance,
          operationKey: `blocked-project-${lifecycleStatus}`,
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(repository.acceptanceEvents).toEqual(["project-lock:project-1"]);
      expect(repository.purchases.size).toBe(0);
    },
  );

  it.each<[string, (repository: MemoryPurchaseRepository) => void, PurchaseDomainError["code"]]>([
    [
      "missing",
      (repository) => {
        repository.targetProjects.delete("project-1");
      },
      "NOT_FOUND",
    ],
    [
      "wrong producer",
      (repository) => {
        repository.targetProjects.set("project-1", {
          ...requiredFixture(repository.targetProjects.get("project-1")),
          producerId: "producer-2",
        });
      },
      "NOT_OWNER",
    ],
    [
      "wrong identifier",
      (repository) => {
        repository.targetProjects.set("project-1", {
          ...requiredFixture(repository.targetProjects.get("project-1")),
          id: "project-2",
        });
      },
      "INTEGRITY_ERROR",
    ],
    [
      "wrong client",
      (repository) => {
        repository.targetProjects.set("project-1", {
          ...requiredFixture(repository.targetProjects.get("project-1")),
          clientContactId: "client-2",
        });
      },
      "NOT_OWNER",
    ],
  ])("rejects a %s project target before source validation", async (_label, mutate, code) => {
    const repository = new MemoryPurchaseRepository();
    mutate(repository);

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: `invalid-project-${_label}`,
      }),
    ).rejects.toMatchObject({ code });
    expect(repository.acceptanceEvents).toEqual(["project-lock:project-1"]);
    expect(repository.purchases.size).toBe(0);
  });

  it("holds the project row lock while source validation serializes a lifecycle race", async () => {
    const repository = new MemoryPurchaseRepository();
    repository.pendingProjectLifecycleTransition = "canceled";

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: "project-lifecycle-race",
      }),
    ).resolves.toMatchObject({ created: true });
    expect(repository.acceptanceEvents).toEqual([
      "project-lock:project-1",
      "project-transition-waiting-on-lock",
      "source-load",
      "operation-key-read",
      "purchase-insert",
      "project-transition-applied-after-transaction",
    ]);
    expect(repository.targetProjects.get("project-1")?.lifecycleStatus).toBe("canceled");
  });

  it("revalidates the locked target project before an operation-key replay", async () => {
    const repository = new MemoryPurchaseRepository();
    const input = { ...baseAcceptance, operationKey: "project-lifecycle-replay" };
    await acceptPurchase(repository, input);
    repository.targetProjects.set("project-1", {
      ...requiredFixture(repository.targetProjects.get("project-1")),
      lifecycleStatus: "completed",
    });
    repository.acceptanceEvents.length = 0;

    await expect(acceptPurchase(repository, input)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(repository.acceptanceEvents).toEqual(["project-lock:project-1"]);
    expect(repository.purchases.size).toBe(1);
  });

  it("freezes purchase provenance and binds it into operation-key retries", async () => {
    const repository = new MemoryPurchaseRepository();
    const source = { ...baseAcceptance.source };
    const first = await acceptPurchase(repository, {
      ...baseAcceptance,
      source,
      operationKey: "source-bound-operation",
    });

    expect(first.purchase).toMatchObject({ source: baseAcceptance.source });
    expect(Object.isFrozen(first.purchase.source)).toBe(true);
    source.productId = "mutated-after-acceptance";
    expect(first.purchase.source.productId).toBe("product-1");

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        source: {
          kind: "session_product",
          productId: "product-1",
          privateOfferId: null,
          purchaseRequestId: "request-1",
        },
        operationKey: "source-bound-operation",
      }),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
  });

  it("rejects missing or contradictory catalog and private-offer provenance", async () => {
    const repository = new MemoryPurchaseRepository();

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        source: {
          kind: "store_product",
          productId: "",
          privateOfferId: null,
          purchaseRequestId: "request-1",
        },
        operationKey: "missing-product-provenance",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        source: {
          kind: "private_offer",
          productId: null,
          privateOfferId: "",
          purchaseRequestId: null,
        },
        operationKey: "missing-offer-provenance",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repository.purchases.size).toBe(0);
  });

  it.each<[string, (repository: MemoryPurchaseRepository) => void, PurchaseDomainError["code"]]>([
    [
      "missing request",
      (repository) => {
        repository.sourcePurchaseRequests.delete("request-1");
      },
      "NOT_FOUND",
    ],
    [
      "wrong product producer",
      (repository) => {
        repository.sourceProducts.set("product-1", {
          id: "product-1",
          producerId: "producer-2",
        });
      },
      "NOT_OWNER",
    ],
    [
      "wrong request producer",
      (repository) => {
        repository.sourcePurchaseRequests.set("request-1", {
          ...requiredFixture(repository.sourcePurchaseRequests.get("request-1")),
          producerId: "producer-2",
        });
      },
      "NOT_OWNER",
    ],
    [
      "wrong request client",
      (repository) => {
        repository.sourcePurchaseRequests.set("request-1", {
          ...requiredFixture(repository.sourcePurchaseRequests.get("request-1")),
          clientContactId: "client-2",
        });
      },
      "NOT_OWNER",
    ],
    [
      "wrong request project",
      (repository) => {
        repository.sourcePurchaseRequests.set("request-1", {
          ...requiredFixture(repository.sourcePurchaseRequests.get("request-1")),
          projectId: "project-2",
        });
      },
      "NOT_OWNER",
    ],
    [
      "wrong request product",
      (repository) => {
        repository.sourcePurchaseRequests.set("request-1", {
          ...requiredFixture(repository.sourcePurchaseRequests.get("request-1")),
          productId: "product-2",
        });
      },
      "INVALID_INPUT",
    ],
  ])("validates exact store/session source descriptors: %s", async (_label, mutate, code) => {
    const repository = new MemoryPurchaseRepository();
    mutate(repository);

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: `store-source-${_label}`,
      }),
    ).rejects.toMatchObject({ code });
    expect(repository.purchases.size).toBe(0);
  });

  it.each<[string, (repository: MemoryPurchaseRepository) => void, PurchaseDomainError["code"]]>([
    [
      "missing offer",
      (repository) => {
        repository.sourcePrivateOffers.delete("offer-zero");
      },
      "NOT_FOUND",
    ],
    [
      "wrong producer",
      (repository) => {
        repository.sourcePrivateOffers.set("offer-zero", {
          ...requiredFixture(repository.sourcePrivateOffers.get("offer-zero")),
          producerId: "producer-2",
        });
      },
      "NOT_OWNER",
    ],
    [
      "wrong client",
      (repository) => {
        repository.sourcePrivateOffers.set("offer-zero", {
          ...requiredFixture(repository.sourcePrivateOffers.get("offer-zero")),
          clientContactId: "client-2",
        });
      },
      "NOT_OWNER",
    ],
    [
      "wrong project",
      (repository) => {
        repository.sourcePrivateOffers.set("offer-zero", {
          ...requiredFixture(repository.sourcePrivateOffers.get("offer-zero")),
          targetProjectId: "project-2",
        });
      },
      "NOT_OWNER",
    ],
    [
      "wrong nullable product",
      (repository) => {
        repository.sourcePrivateOffers.set("offer-zero", {
          ...requiredFixture(repository.sourcePrivateOffers.get("offer-zero")),
          productId: "product-1",
        });
      },
      "INVALID_INPUT",
    ],
  ])("validates exact private-offer source descriptors: %s", async (_label, mutate, code) => {
    const repository = new MemoryPurchaseRepository();
    mutate(repository);

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        source: {
          kind: "private_offer",
          productId: null,
          privateOfferId: "offer-zero",
          purchaseRequestId: null,
        },
        operationKey: `private-offer-source-${_label}`,
        totalCents: 0,
        plan: null,
        commercialSnapshot: commercialSnapshot(0, null),
      }),
    ).rejects.toMatchObject({ code });
    expect(repository.purchases.size).toBe(0);
  });

  it("validates every supplied add-on anchor without fabricating omitted links", async () => {
    await expect(
      acceptPurchase(new MemoryPurchaseRepository(), {
        ...baseAcceptance,
        source: {
          kind: "paid_add_on",
          productId: null,
          privateOfferId: null,
          purchaseRequestId: null,
        },
        operationKey: "missing-all-add-on-anchors",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const requestOnlyRepository = new MemoryPurchaseRepository();
    const requestOnly = await acceptPurchase(requestOnlyRepository, {
      ...baseAcceptance,
      source: {
        kind: "no_charge_add_on",
        productId: null,
        privateOfferId: null,
        purchaseRequestId: "request-1",
      },
      operationKey: "request-only-add-on-source",
      totalCents: 0,
      plan: null,
      commercialSnapshot: commercialSnapshot(0, null),
    });
    expect(requestOnly.purchase.source).toEqual({
      kind: "no_charge_add_on",
      productId: null,
      privateOfferId: null,
      purchaseRequestId: "request-1",
    });

    const offerOnlyRepository = new MemoryPurchaseRepository();
    const offerOnly = await acceptPurchase(offerOnlyRepository, {
      ...baseAcceptance,
      source: {
        kind: "no_charge_add_on",
        productId: null,
        privateOfferId: "offer-product-1",
        purchaseRequestId: null,
      },
      operationKey: "offer-only-add-on-source",
      totalCents: 0,
      plan: null,
      commercialSnapshot: commercialSnapshot(0, null),
    });
    expect(offerOnly.purchase.source).toEqual({
      kind: "no_charge_add_on",
      productId: null,
      privateOfferId: "offer-product-1",
      purchaseRequestId: null,
    });

    await expect(
      acceptPurchase(new MemoryPurchaseRepository(), {
        ...baseAcceptance,
        source: {
          kind: "paid_add_on",
          productId: "product-1",
          privateOfferId: "offer-zero",
          purchaseRequestId: "request-1",
        },
        operationKey: "generic-offer-with-product-anchors",
      }),
    ).resolves.toMatchObject({ created: true });

    const missingAnchorRepository = new MemoryPurchaseRepository();
    await expect(
      acceptPurchase(missingAnchorRepository, {
        ...baseAcceptance,
        source: {
          kind: "paid_add_on",
          productId: "product-1",
          privateOfferId: "missing-offer",
          purchaseRequestId: "request-1",
        },
        operationKey: "missing-add-on-anchor",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const misScopedRepository = new MemoryPurchaseRepository();
    misScopedRepository.sourcePrivateOffers.set("offer-product-1", {
      ...requiredFixture(misScopedRepository.sourcePrivateOffers.get("offer-product-1")),
      targetProjectId: "project-2",
    });
    await expect(
      acceptPurchase(misScopedRepository, {
        ...baseAcceptance,
        source: {
          kind: "paid_add_on",
          productId: null,
          privateOfferId: "offer-product-1",
          purchaseRequestId: null,
        },
        operationKey: "mis-scoped-add-on-anchor",
      }),
    ).rejects.toMatchObject({ code: "NOT_OWNER" });

    const contradictoryRepository = new MemoryPurchaseRepository();
    contradictoryRepository.sourcePrivateOffers.set("offer-product-2", {
      id: "offer-product-2",
      producerId: "producer-1",
      clientContactId: "client-1",
      targetProjectId: "project-1",
      productId: "product-2",
    });
    await expect(
      acceptPurchase(contradictoryRepository, {
        ...baseAcceptance,
        source: {
          kind: "paid_add_on",
          productId: null,
          privateOfferId: "offer-product-2",
          purchaseRequestId: "request-1",
        },
        operationKey: "contradictory-add-on-anchors",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("revalidates source descriptors atomically before an operation-key replay", async () => {
    const repository = new MemoryPurchaseRepository();
    const input = { ...baseAcceptance, operationKey: "source-descriptor-replay" };
    await acceptPurchase(repository, input);
    repository.sourcePurchaseRequests.delete("request-1");

    await expect(acceptPurchase(repository, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(repository.purchases.size).toBe(1);
  });

  it("enforces the source-kind amount matrix without inventing a payment plan", async () => {
    const invalidInputs: AcceptPurchaseInput[] = [
      {
        ...baseAcceptance,
        source: { ...baseAcceptance.source },
        operationKey: "zero-store-product",
        totalCents: 0,
        plan: null,
        commercialSnapshot: commercialSnapshot(0, null),
      },
      {
        ...baseAcceptance,
        source: {
          kind: "session_product",
          productId: "product-1",
          privateOfferId: null,
          purchaseRequestId: "request-1",
        },
        operationKey: "zero-session-product",
        totalCents: 0,
        plan: null,
        commercialSnapshot: commercialSnapshot(0, null),
      },
      {
        ...baseAcceptance,
        source: {
          kind: "paid_add_on",
          productId: "product-1",
          privateOfferId: null,
          purchaseRequestId: null,
        },
        operationKey: "zero-paid-add-on",
        totalCents: 0,
        plan: null,
        commercialSnapshot: commercialSnapshot(0, null),
      },
      {
        ...baseAcceptance,
        source: noChargeSource,
        operationKey: "positive-no-charge-add-on",
      },
    ];

    for (const input of invalidInputs) {
      await expect(acceptPurchase(new MemoryPurchaseRepository(), input)).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    }

    await expect(
      acceptPurchase(new MemoryPurchaseRepository(), {
        ...baseAcceptance,
        source: {
          kind: "private_offer",
          productId: null,
          privateOfferId: "offer-zero",
          purchaseRequestId: null,
        },
        operationKey: "zero-private-offer",
        totalCents: 0,
        plan: null,
        commercialSnapshot: commercialSnapshot(0, null),
      }),
    ).resolves.toMatchObject({ created: true });
  });

  it("fails closed when persistence changes source on insert or replay", async () => {
    const inserted = new MemoryPurchaseRepository();
    inserted.insertedSourceOverride = {
      kind: "session_product",
      productId: "product-1",
      privateOfferId: null,
      purchaseRequestId: "request-1",
    };
    await expect(
      acceptPurchase(inserted, {
        ...baseAcceptance,
        operationKey: "source-changed-on-insert",
      }),
    ).rejects.toMatchObject({ code: "INTEGRITY_ERROR" });

    const replayed = new MemoryPurchaseRepository();
    const original = await acceptPurchase(replayed, {
      ...baseAcceptance,
      operationKey: "source-changed-on-replay",
    });
    replayed.purchases.set(original.purchase.id, {
      ...original.purchase,
      source: {
        kind: "session_product",
        productId: "product-1",
        privateOfferId: null,
        purchaseRequestId: "request-1",
      },
    });
    await expect(
      acceptPurchase(replayed, {
        ...baseAcceptance,
        operationKey: "source-changed-on-replay",
      }),
    ).rejects.toMatchObject({ code: "INTEGRITY_ERROR" });
  });

  it("allows legitimate simultaneous unpaid purchases with separate operation keys", async () => {
    const repository = new MemoryPurchaseRepository();

    const [first, second] = await Promise.all([
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: "request-1",
      }),
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: "request-2",
      }),
    ]);

    expect(repository.purchases.size).toBe(2);
    expect(first.purchase.id).not.toBe(second.purchase.id);
    expect(first.purchase.activatedAt).toBeNull();
    expect(second.purchase.activatedAt).toBeNull();
    expect(first.purchase.lifecycleStatus).toBe("waiting_for_payment");
    expect(second.purchase.lifecycleStatus).toBe("waiting_for_payment");
  });

  it("rejects unsafe reuse of an operation key for changed commercial intent", async () => {
    const repository = new MemoryPurchaseRepository();
    await acceptPurchase(repository, {
      ...baseAcceptance,
      operationKey: "request-1",
    });

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: "request-1",
        totalCents: 12_000,
        commercialSnapshot: commercialSnapshot(12_000, { kind: "full" }),
      }),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
  });

  it("rejects a commercial snapshot whose total differs from the accepted total", async () => {
    const repository = new MemoryPurchaseRepository();

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: "request-total-mismatch",
        commercialSnapshot: commercialSnapshot(12_000, { kind: "full" }),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repository.purchases.size).toBe(0);
  });

  it("requires the exact included-tax portion implied by the frozen gross total and rate", async () => {
    const repository = new MemoryPurchaseRepository();
    const invalidSnapshot = commercialSnapshot(10_000, { kind: "full" });
    invalidSnapshot.tax = { mode: "tax_included", ratePct: 18, amountCents: 1 };

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: "request-invalid-included-tax",
        commercialSnapshot: invalidSnapshot,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const exactSnapshot = commercialSnapshot(10_000, { kind: "full" });
    exactSnapshot.tax = { mode: "tax_included", ratePct: 18, amountCents: 1_525 };
    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: "request-exact-included-tax",
        commercialSnapshot: exactSnapshot,
      }),
    ).resolves.toMatchObject({ created: true });

    const zeroRateSnapshot = commercialSnapshot(10_000, { kind: "full" });
    zeroRateSnapshot.tax = { mode: "tax_included", ratePct: 0, amountCents: 0 };
    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: "request-zero-rate-included-tax",
        commercialSnapshot: zeroRateSnapshot,
      }),
    ).resolves.toMatchObject({ created: true });
  });

  it("freezes an explicit volume discount without hiding the base unit price", async () => {
    const repository = new MemoryPurchaseRepository();
    const snapshot = commercialSnapshot(40_000, { kind: "full" });
    snapshot.lineItems = [
      {
        label: "Five mixes",
        quantity: 5,
        listUnitPriceCents: 10_000,
        unitPriceCents: 8_000,
        totalCents: 40_000,
      },
    ] as PurchaseCommercialSnapshot["lineItems"];
    Object.assign(snapshot, { listSubtotalCents: 50_000, discountCents: 10_000 });

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: "request-explicit-volume-discount",
        totalCents: 40_000,
        commercialSnapshot: snapshot,
      }),
    ).resolves.toMatchObject({ created: true });

    const inconsistent = structuredClone(snapshot);
    inconsistent.discountCents = 9_999;
    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: "request-inconsistent-volume-discount",
        totalCents: 40_000,
        commercialSnapshot: inconsistent,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects a zero-total commercial snapshot with a selected payment plan", async () => {
    const repository = new MemoryPurchaseRepository();

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        source: noChargeSource,
        operationKey: "request-zero-with-plan",
        totalCents: 0,
        plan: null,
        commercialSnapshot: commercialSnapshot(0, { kind: "full" }),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repository.purchases.size).toBe(0);
  });

  it("rejects a paid commercial snapshot with no selected payment plan", async () => {
    const repository = new MemoryPurchaseRepository();

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: "request-paid-without-plan",
        commercialSnapshot: commercialSnapshot(10_000, null),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repository.purchases.size).toBe(0);
  });

  it("rejects a selected commercial plan that differs from the accepted schedule", async () => {
    const repository = new MemoryPurchaseRepository();

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: "request-plan-mismatch",
        commercialSnapshot: commercialSnapshot(10_000, { kind: "split_50_50" }),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repository.purchases.size).toBe(0);
  });

  it("rejects a selected commercial plan that was not among the approved options", async () => {
    const repository = new MemoryPurchaseRepository();
    const snapshot = commercialSnapshot(10_000, { kind: "full" });
    snapshot.offeredPaymentPlans = [{ kind: "split_50_50" }];

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: "request-unapproved-plan",
        commercialSnapshot: snapshot,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repository.purchases.size).toBe(0);
  });

  it("rejects unsupported runtime payment-plan options before persisting the snapshot", async () => {
    const repository = new MemoryPurchaseRepository();
    const snapshot = commercialSnapshot(10_000, { kind: "full" });
    (snapshot as unknown as { offeredPaymentPlans: unknown[] }).offeredPaymentPlans = [
      { kind: "full" },
      { kind: "none" },
    ];

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: "request-invalid-offered-plan",
        commercialSnapshot: snapshot,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repository.purchases.size).toBe(0);
  });

  it("rejects duplicate runtime payment-plan options before persisting the snapshot", async () => {
    const repository = new MemoryPurchaseRepository();
    const snapshot = commercialSnapshot(10_000, { kind: "full" });
    snapshot.offeredPaymentPlans = [{ kind: "full" }, { kind: "full" }];

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: "request-duplicate-offered-plan",
        commercialSnapshot: snapshot,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repository.purchases.size).toBe(0);
  });

  it("rejects paid plan options on a true zero-total commercial snapshot", async () => {
    const repository = new MemoryPurchaseRepository();
    const snapshot = commercialSnapshot(0, null);
    snapshot.offeredPaymentPlans = [{ kind: "full" }];

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        source: noChargeSource,
        operationKey: "request-zero-offered-plan",
        totalCents: 0,
        plan: null,
        commercialSnapshot: snapshot,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repository.purchases.size).toBe(0);
  });

  it.each<[string, (snapshot: PurchaseCommercialSnapshot) => void]>([
    [
      "missing product name",
      (snapshot) => {
        delete (snapshot as Partial<PurchaseCommercialSnapshot>).productOrOfferName;
      },
    ],
    [
      "non-array deliverables",
      (snapshot) => {
        (snapshot as unknown as { deliverables: unknown }).deliverables = "WAV";
      },
    ],
    [
      "line-item arithmetic mismatch",
      (snapshot) => {
        const item = snapshot.lineItems[0];
        if (item) item.totalCents = 9_999;
      },
    ],
    [
      "subtotal mismatch",
      (snapshot) => {
        snapshot.subtotalCents = 9_999;
      },
    ],
    [
      "invalid tax mode",
      (snapshot) => {
        (snapshot.tax as unknown as { mode: unknown }).mode = "none";
      },
    ],
    [
      "empty currency",
      (snapshot) => {
        snapshot.currency = "";
      },
    ],
    [
      "negative song-space count",
      (snapshot) => {
        snapshot.includedSongSpaces = -1;
      },
    ],
    [
      "invalid session duration",
      (snapshot) => {
        snapshot.session = {
          limit: { kind: "fixed", count: 1 },
          durationMin: 0,
          locationType: "studio",
          bufferMinutes: 0,
          minLeadHours: 0,
        };
      },
    ],
    [
      "invalid revision count",
      (snapshot) => {
        snapshot.revisionRule = { kind: "fixed", count: -1 };
      },
    ],
    [
      "invalid royalty percentage",
      (snapshot) => {
        snapshot.royaltyTerms = {
          master: { mode: "percentage", bps: 10_001 },
          composition: { mode: "none" },
        };
      },
    ],
    [
      "non-string right",
      (snapshot) => {
        (snapshot as unknown as { rights: unknown[] }).rights = [1];
      },
    ],
    [
      "non-string agreement",
      (snapshot) => {
        (snapshot as unknown as { agreementText: unknown }).agreementText = 1;
      },
    ],
    [
      "unexpected field",
      (snapshot) => {
        (snapshot as PurchaseCommercialSnapshot & { unexpected?: boolean }).unexpected = true;
      },
    ],
  ])("rejects malformed commercial snapshot structure: %s", async (_label, mutate) => {
    const repository = new MemoryPurchaseRepository();
    const snapshot = commercialSnapshot(10_000, { kind: "full" });
    mutate(snapshot);

    await expect(
      acceptPurchase(repository, {
        ...baseAcceptance,
        operationKey: `malformed-${_label}`,
        commercialSnapshot: snapshot,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repository.purchases.size).toBe(0);
  });

  it("stores a parsed immutable commercial snapshot together with its digest", async () => {
    const repository = new MemoryPurchaseRepository();
    const source = commercialSnapshot(10_000, { kind: "full" });
    const result = await acceptPurchase(repository, {
      ...baseAcceptance,
      operationKey: "request-frozen-snapshot",
      commercialSnapshot: source,
    });

    expect(result.purchase.commercialSnapshot.value).toEqual(source);
    expect(result.purchase.commercialSnapshot.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(result.purchase.commercialSnapshot.value)).toBe(true);
    expect(Object.isFrozen(result.purchase.commercialSnapshot.value.lineItems)).toBe(true);
    expect(Object.isFrozen(result.purchase.commercialSnapshot.value.lineItems[0])).toBe(true);
    source.productOrOfferName = "Changed after acceptance";
    expect(result.purchase.commercialSnapshot.value.productOrOfferName).toBe("Mix");
    expect(result.acceptance.commercialSnapshot).toBe(result.purchase.commercialSnapshot);
    expect(result.acceptance.snapshotDigest).toBe(result.purchase.commercialSnapshot.digest);
    expect(result.acceptance.acceptedAt).toBe(result.purchase.acceptedAt);
  });

  it("activates a zero-total purchase and project immediately without payment", async () => {
    const repository = new MemoryPurchaseRepository();
    const result = await acceptPurchase(repository, {
      ...baseAcceptance,
      source: noChargeSource,
      operationKey: "no-charge-1",
      totalCents: 0,
      plan: null,
      commercialSnapshot: commercialSnapshot(0, null),
    });

    expect(result.purchase.activatedAt).toEqual(baseAcceptance.acceptedAt);
    expect(result.purchase.lifecycleStatus).toBe("active");
    expect(result.purchase.lifecycleChangedAt).toEqual(baseAcceptance.acceptedAt);
    expect(result.purchase.schedule).toEqual([]);
    expect(repository.projectLifecycles.get("producer-1:project-1")).toEqual({
      status: "active",
      changedAt: baseAcceptance.acceptedAt,
    });
  });

  it("fails closed when atomic activation reports an inactive purchase or project", async () => {
    const activationTime = baseAcceptance.acceptedAt;
    const invalidActivations: PurchaseProjectActivation[] = [
      {
        purchaseId: "purchase-1",
        producerId: "producer-1",
        projectId: "project-1",
        purchaseLifecycleStatus: "waiting_for_payment",
        purchaseLifecycleChangedAt: activationTime,
        purchaseActivatedAt: activationTime,
        projectLifecycleStatus: "active",
        projectLifecycleChangedAt: activationTime,
      },
      {
        purchaseId: "purchase-1",
        producerId: "producer-1",
        projectId: "project-1",
        purchaseLifecycleStatus: "active",
        purchaseLifecycleChangedAt: activationTime,
        purchaseActivatedAt: activationTime,
        projectLifecycleStatus: "paused",
        projectLifecycleChangedAt: activationTime,
      },
    ];

    for (const [index, activationOverride] of invalidActivations.entries()) {
      const repository = new MemoryPurchaseRepository();
      repository.activationOverride = activationOverride;

      await expect(
        acceptPurchase(repository, {
          ...baseAcceptance,
          source: noChargeSource,
          operationKey: `invalid-activation-${String(index)}`,
          totalCents: 0,
          plan: null,
          commercialSnapshot: commercialSnapshot(0, null),
        }),
      ).rejects.toMatchObject({ code: "INTEGRITY_ERROR" });
    }
  });
});

describe("confirmPurchasePayment", () => {
  it("keeps a partial first installment waiting, then activates atomically when complete", async () => {
    const repository = new MemoryPurchaseRepository();
    const accepted = await acceptPurchase(repository, {
      ...baseAcceptance,
      operationKey: "request-1",
      plan: { kind: "split_50_50" },
      commercialSnapshot: commercialSnapshot(10_000, { kind: "split_50_50" }),
    });
    const scope = {
      purchaseId: accepted.purchase.id,
      producerId: "producer-1",
      projectId: "project-1",
      clientContactId: "client-1",
      installmentSequence: 1,
    };

    const partial = await confirmPurchasePayment(repository, {
      ...scope,
      operationKey: "proof-1",
      amountCents: 2_000,
      confirmedAt: new Date("2026-07-02T10:00:00Z"),
    });
    const completion = await confirmPurchasePayment(repository, {
      ...scope,
      operationKey: "proof-2",
      amountCents: 3_000,
      confirmedAt: new Date("2026-07-03T10:00:00Z"),
    });

    expect(partial.purchase.activatedAt).toBeNull();
    expect(partial.purchase.lifecycleStatus).toBe("waiting_for_payment");
    expect(partial.ledger.remainingBalanceCents).toBe(8_000);
    expect(completion.purchase.activatedAt).toEqual(new Date("2026-07-03T10:00:00Z"));
    expect(completion.purchase.lifecycleStatus).toBe("active");
    expect(completion.purchase.lifecycleChangedAt).toEqual(new Date("2026-07-03T10:00:00Z"));
    expect(repository.projectLifecycles.get("producer-1:project-1")).toEqual({
      status: "active",
      changedAt: new Date("2026-07-03T10:00:00Z"),
    });
    expect(completion.ledger.firstInstallmentPaid).toBe(true);

    const laterInstallment = await confirmPurchasePayment(repository, {
      ...scope,
      installmentSequence: 2,
      operationKey: "proof-3",
      amountCents: 5_000,
      confirmedAt: new Date("2026-08-03T10:00:00Z"),
    });
    expect(laterInstallment.purchase.lifecycleStatus).toBe("active");
    expect(laterInstallment.purchase.activatedAt).toEqual(new Date("2026-07-03T10:00:00Z"));
    expect(laterInstallment.purchase.lifecycleChangedAt).toEqual(new Date("2026-07-03T10:00:00Z"));
    expect(repository.projectLifecycles.get("producer-1:project-1")?.changedAt).toEqual(
      new Date("2026-07-03T10:00:00Z"),
    );
  });

  it("accepts overpayment and makes concurrent exact payment retries idempotent", async () => {
    const repository = new MemoryPurchaseRepository();
    const accepted = await acceptPurchase(repository, {
      ...baseAcceptance,
      operationKey: "request-1",
    });
    const input = {
      purchaseId: accepted.purchase.id,
      producerId: "producer-1",
      projectId: "project-1",
      clientContactId: "client-1",
      installmentSequence: 1,
      operationKey: "proof-1",
      amountCents: 11_500,
      confirmedAt: new Date("2026-07-02T10:00:00Z"),
    };

    const [left, right] = await Promise.all([
      confirmPurchasePayment(repository, input),
      confirmPurchasePayment(repository, input),
    ]);

    expect(repository.payments).toHaveLength(1);
    expect(left.payment.id).toBe(right.payment.id);
    expect(left.ledger.overpaidCents).toBe(1_500);
    expect(right.ledger.fullyPaid).toBe(true);
  });

  it("treats the immutable payment date as part of the operation intent", async () => {
    const repository = new MemoryPurchaseRepository();
    const accepted = await acceptPurchase(repository, {
      ...baseAcceptance,
      operationKey: "request-payment-date",
    });
    const input = {
      purchaseId: accepted.purchase.id,
      producerId: "producer-1",
      projectId: "project-1",
      clientContactId: "client-1",
      installmentSequence: 1,
      operationKey: "proof-payment-date",
      amountCents: 10_000,
      confirmedAt: new Date("2026-07-02T10:00:00Z"),
    };

    await confirmPurchasePayment(repository, input);

    await expect(
      confirmPurchasePayment(repository, {
        ...input,
        confirmedAt: new Date("2026-07-03T10:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
  });

  it("fails closed if storage changes a payment returned from insert or replay", async () => {
    const insertedRepository = new MemoryPurchaseRepository();
    const insertedPurchase = await acceptPurchase(insertedRepository, {
      ...baseAcceptance,
      operationKey: "request-corrupt-inserted-payment",
    });
    insertedRepository.insertedPaymentOverride = {
      confirmedAt: new Date("2026-07-04T10:00:00Z"),
    };

    await expect(
      confirmPurchasePayment(insertedRepository, {
        purchaseId: insertedPurchase.purchase.id,
        producerId: "producer-1",
        projectId: "project-1",
        clientContactId: "client-1",
        installmentSequence: 1,
        operationKey: "proof-corrupt-insert",
        amountCents: 10_000,
        confirmedAt: new Date("2026-07-02T10:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "INTEGRITY_ERROR" });

    const replayRepository = new MemoryPurchaseRepository();
    const replayPurchase = await acceptPurchase(replayRepository, {
      ...baseAcceptance,
      operationKey: "request-corrupt-replayed-payment",
    });
    const replayInput = {
      purchaseId: replayPurchase.purchase.id,
      producerId: "producer-1",
      projectId: "project-1",
      clientContactId: "client-1",
      installmentSequence: 1,
      operationKey: "proof-corrupt-replay",
      amountCents: 10_000,
      confirmedAt: new Date("2026-07-02T10:00:00Z"),
    };
    const original = await confirmPurchasePayment(replayRepository, replayInput);
    replayRepository.payments[0] = {
      ...original.payment,
      amountCents: 9_999,
    };

    await expect(confirmPurchasePayment(replayRepository, replayInput)).rejects.toMatchObject({
      code: "INTEGRITY_ERROR",
    });
  });

  it("records still-due debt on a canceled purchase without reactivating it", async () => {
    const repository = new MemoryPurchaseRepository();
    const accepted = await acceptPurchase(repository, {
      ...baseAcceptance,
      operationKey: "request-canceled-debt",
    });
    const canceledAt = new Date("2026-07-02T10:00:00Z");
    repository.purchases.set(accepted.purchase.id, {
      ...accepted.purchase,
      lifecycleStatus: "canceled",
      lifecycleChangedAt: canceledAt,
    });

    const payment = await confirmPurchasePayment(repository, {
      purchaseId: accepted.purchase.id,
      producerId: "producer-1",
      projectId: "project-1",
      clientContactId: "client-1",
      installmentSequence: 1,
      operationKey: "proof-canceled-debt",
      amountCents: 10_000,
      confirmedAt: new Date("2026-07-03T10:00:00Z"),
    });

    expect(payment.created).toBe(true);
    expect(payment.purchase.lifecycleStatus).toBe("canceled");
    expect(payment.purchase.lifecycleChangedAt).toEqual(canceledAt);
    expect(payment.purchase.activatedAt).toBeNull();
    expect(repository.projectLifecycles.get("producer-1:project-1")).toBeUndefined();
  });

  it("rejects new payment for canceled debt that is no longer collectible but preserves retries", async () => {
    const repository = new MemoryPurchaseRepository();
    const accepted = await acceptPurchase(repository, {
      ...baseAcceptance,
      operationKey: "request-canceled-waiver",
    });
    repository.purchases.set(accepted.purchase.id, {
      ...accepted.purchase,
      lifecycleStatus: "canceled",
      lifecycleChangedAt: new Date("2026-07-02T10:00:00Z"),
    });
    const input = {
      purchaseId: accepted.purchase.id,
      producerId: "producer-1",
      projectId: "project-1",
      clientContactId: "client-1",
      installmentSequence: 1,
      operationKey: "proof-before-waiver",
      amountCents: 1_000,
      confirmedAt: new Date("2026-07-03T10:00:00Z"),
    };
    const original = await confirmPurchasePayment(repository, input);
    repository.nonCollectibleInstallments.add(`${accepted.purchase.id}:1`);

    const retry = await confirmPurchasePayment(repository, input);
    await expect(
      confirmPurchasePayment(repository, {
        ...input,
        operationKey: "proof-after-waiver",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    expect(original.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.payment.id).toBe(original.payment.id);
    expect(repository.payments).toHaveLength(1);
  });

  it("fails closed when the supplied tenant, project, or client does not own the purchase", async () => {
    const repository = new MemoryPurchaseRepository();
    const accepted = await acceptPurchase(repository, {
      ...baseAcceptance,
      operationKey: "request-1",
    });

    await expect(
      confirmPurchasePayment(repository, {
        purchaseId: accepted.purchase.id,
        producerId: "producer-2",
        projectId: "project-1",
        clientContactId: "client-1",
        installmentSequence: 1,
        operationKey: "proof-1",
        amountCents: 10_000,
        confirmedAt: new Date("2026-07-02T10:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(PurchaseDomainError);
    expect(repository.payments).toHaveLength(0);
  });
});
