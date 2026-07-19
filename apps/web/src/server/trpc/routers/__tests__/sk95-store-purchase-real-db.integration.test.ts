import { randomUUID } from "node:crypto";

import {
  and,
  clientContacts,
  createDb,
  eq,
  producers,
  products,
  projects,
  purchaseAcceptances,
  purchaseRequests,
  purchases,
  sql,
  type Db,
  type PaymentPlan,
} from "@skitza/db";
import { beforeAll, describe, expect, it } from "vitest";

import { correctProducerPurchaseTarget } from "~/server/domain/purchase-targeting/db";
import { PurchaseTargetingError } from "~/server/domain/purchase-targeting/service";
import {
  acceptStorePurchase,
  previewStorePurchaseAcceptance,
  StoreAcceptanceError,
} from "~/server/domain/purchases/store-acceptance";
import { approvedPurchaseRealDbTarget } from "./purchase-real-db-target-gate";

const approvedTarget = approvedPurchaseRealDbTarget(process.env);

/**
 * This suite creates immutable purchase history and races interactive
 * transactions. It is skipped before createDb unless the existing SK-90 gate
 * proves an explicitly approved, disposable, isolated non-production target.
 */
const describeWithSafeDatabase = approvedTarget ? describe : describe.skip;

async function safely<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    // Never let a driver error disclose connection metadata in test output.
    throw new Error("SK-95 isolated database operation failed");
  }
}

async function storeError(operation: Promise<unknown>): Promise<StoreAcceptanceError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(StoreAcceptanceError);
    return error as StoreAcceptanceError;
  }
  throw new Error("Expected StoreAcceptanceError");
}

async function targetingError(operation: Promise<unknown>): Promise<PurchaseTargetingError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PurchaseTargetingError);
    return error as PurchaseTargetingError;
  }
  throw new Error("Expected PurchaseTargetingError");
}

describeWithSafeDatabase("SK-95 Store purchase — isolated disposable Postgres", () => {
  const suffix = randomUUID();
  const artistClerkUserId = `sk95-artist-${suffix}`;
  let db: Db | undefined;
  let producerId = "";
  let clientContactId = "";
  let foreignProducerId = "";
  let foreignClientContactId = "";
  let sameProducerForeignClientId = "";

  function activeDb(): Db {
    if (!db) throw new Error("SK-95 isolated database was not initialized");
    return db;
  }

  async function createProject(input: {
    title: string;
    ownerProducerId?: string;
    ownerClientContactId?: string;
  }): Promise<string> {
    const ownerProducerId = input.ownerProducerId ?? producerId;
    const ownerClientContactId = input.ownerClientContactId ?? clientContactId;
    const [row] = await safely(() =>
      activeDb()
        .insert(projects)
        .values({
          producerId: ownerProducerId,
          clientContactId: ownerClientContactId,
          title: input.title,
          artistName: "SK-95 Artist",
          artistEmail: `sk95-${suffix}@example.invalid`,
        })
        .returning({ id: projects.id }),
    );
    if (!row) throw new Error("SK-95 project fixture was not created");
    return row.id;
  }

  async function createProduct(input: {
    name?: string;
    priceCents?: number;
    paymentPlans?: PaymentPlan[];
  } = {}): Promise<string> {
    const [row] = await safely(() =>
      activeDb()
        .insert(products)
        .values({
          producerId,
          name: input.name ?? "SK-95 Mix",
          description: "A release-ready mix\n---\nrevisions: 2\ncontract_text: ",
          durationMin: 60,
          sessionCount: 1,
          priceCents: input.priceCents ?? 100_000,
          currency: "USD",
          active: true,
          kind: "mix",
          locationType: "remote",
          bufferMinutes: 0,
          minLeadHours: 12,
          pricingModel: "flat",
          deliverables: ["Stereo WAV"],
          paymentPlans: input.paymentPlans ?? [{ kind: "full" }],
          royaltyTerms: {
            master: { mode: "none" },
            composition: { mode: "none" },
          },
          agreementText: "SK-95 exact Store terms.",
        })
        .returning({ id: products.id }),
    );
    if (!row) throw new Error("SK-95 product fixture was not created");
    return row.id;
  }

  async function createApprovedRequest(input: {
    productId: string;
    projectId: string | null;
  }): Promise<string> {
    const now = new Date();
    const operationKey = `sk95-request-${randomUUID()}`;
    const [row] = await safely(() =>
      activeDb()
        .insert(purchaseRequests)
        .values({
          producerId,
          clientContactId,
          productId: input.productId,
          projectId: input.projectId,
          operationKey,
          operationDigest: `digest-${operationKey}`,
          refNumber: `SK95-${randomUUID()}`,
          status: "approved",
          artistName: "SK-95 Artist",
          artistEmail: `sk95-${suffix}@example.invalid`,
          statusChangedAt: now,
          approvedAt: now,
          updatedAt: now,
        })
        .returning({ id: purchaseRequests.id }),
    );
    if (!row) throw new Error("SK-95 purchase-request fixture was not created");
    return row.id;
  }

  async function previewFull(purchaseRequestId: string) {
    return previewStorePurchaseAcceptance(activeDb(), {
      clerkUserId: artistClerkUserId,
      purchaseRequestId,
      selectedPaymentPlan: { kind: "full" },
    });
  }

  beforeAll(async () => {
    const target = approvedTarget;
    if (!target) throw new Error("SK-95 isolated database opt-in was not complete");
    db = createDb(target.targetDatabaseUrl);

    const marker = await safely(() =>
      activeDb().execute<{
        databaseName: string;
        constraintCount: number;
        triggerCount: number;
      }>(sql`
        select
          current_database()::text as "databaseName",
          (
            select count(*)::int
            from pg_constraint
            where connamespace = 'public'::regnamespace
              and conname in (
                'purchase_requests_id_project_owner_unique',
                'purchases_purchase_request_owner_fk',
                'purchase_acceptances_purchase_snapshot_fk',
                'purchase_installments_purchase_position_unique'
              )
          ) as "constraintCount",
          (
            select count(*)::int
            from pg_trigger
            where tgname in (
                'purchase_requests_protect_identity',
                'purchase_acceptances_validate_purchase',
                'purchase_acceptances_validate_schedule'
              )
              and tgenabled = 'O'
              and not tgisinternal
          ) as "triggerCount"
      `),
    );
    const markerRow = marker.rows[0];
    if (
      markerRow?.databaseName !== target.databaseName ||
      markerRow.constraintCount !== 4 ||
      markerRow.triggerCount !== 3
    ) {
      throw new Error("SK-95 isolated database identity or schema marker mismatch");
    }

    const [producer] = await safely(() =>
      activeDb()
        .insert(producers)
        .values({
          clerkUserId: `sk95-producer-${suffix}`,
          email: `sk95-producer-${suffix}@example.invalid`,
          slug: `sk95-producer-${suffix}`,
          displayName: "SK-95 Studio",
          taxMode: "tax_free",
          taxRatePct: 18,
        })
        .returning({ id: producers.id }),
    );
    if (!producer) throw new Error("SK-95 producer fixture was not created");
    producerId = producer.id;

    const [contact] = await safely(() =>
      activeDb()
        .insert(clientContacts)
        .values({
          producerId,
          emailHash: `sk95-hash-${suffix}`,
          email: `sk95-${suffix}@example.invalid`,
          name: "SK-95 Artist",
          clerkUserId: artistClerkUserId,
        })
        .returning({ id: clientContacts.id }),
    );
    if (!contact) throw new Error("SK-95 contact fixture was not created");
    clientContactId = contact.id;

    const [sameProducerForeignClient] = await safely(() =>
      activeDb()
        .insert(clientContacts)
        .values({
          producerId,
          emailHash: `sk95-foreign-client-hash-${suffix}`,
          email: `sk95-foreign-client-${suffix}@example.invalid`,
          name: "SK-95 Foreign Client",
          clerkUserId: `sk95-foreign-client-${suffix}`,
        })
        .returning({ id: clientContacts.id }),
    );
    if (!sameProducerForeignClient) {
      throw new Error("SK-95 foreign-client fixture was not created");
    }
    sameProducerForeignClientId = sameProducerForeignClient.id;

    const [foreignProducer] = await safely(() =>
      activeDb()
        .insert(producers)
        .values({
          clerkUserId: `sk95-foreign-producer-${suffix}`,
          email: `sk95-foreign-producer-${suffix}@example.invalid`,
          slug: `sk95-foreign-producer-${suffix}`,
          displayName: "Foreign SK-95 Studio",
        })
        .returning({ id: producers.id }),
    );
    if (!foreignProducer) throw new Error("SK-95 foreign producer was not created");
    foreignProducerId = foreignProducer.id;

    const [foreignContact] = await safely(() =>
      activeDb()
        .insert(clientContacts)
        .values({
          producerId: foreignProducerId,
          emailHash: `sk95-foreign-hash-${suffix}`,
          email: `sk95-foreign-${suffix}@example.invalid`,
          name: "Foreign SK-95 Artist",
        })
        .returning({ id: clientContacts.id }),
    );
    if (!foreignContact) throw new Error("SK-95 foreign contact was not created");
    foreignClientContactId = foreignContact.id;
  });

  it("allows only enabled plans and gives foreign/missing artists the same generic outcome", async () => {
    const projectId = await createProject({ title: "SK-95 plan project" });
    const productId = await createProduct({ paymentPlans: [{ kind: "full" }] });
    const requestId = await createApprovedRequest({ productId, projectId });

    const unoffered = await storeError(
      previewStorePurchaseAcceptance(activeDb(), {
        clerkUserId: artistClerkUserId,
        purchaseRequestId: requestId,
        selectedPaymentPlan: { kind: "split_50_50" },
      }),
    );
    expect(unoffered).toMatchObject({ code: "INVALID" });

    const missing = await storeError(
      previewStorePurchaseAcceptance(activeDb(), {
        clerkUserId: artistClerkUserId,
        purchaseRequestId: randomUUID(),
        selectedPaymentPlan: { kind: "full" },
      }),
    );
    const foreign = await storeError(
      previewStorePurchaseAcceptance(activeDb(), {
        clerkUserId: `not-${artistClerkUserId}`,
        purchaseRequestId: requestId,
        selectedPaymentPlan: { kind: "full" },
      }),
    );
    expect({ code: foreign.code, message: foreign.message }).toEqual({
      code: missing.code,
      message: missing.message,
    });
    expect(missing).toMatchObject({
      code: "NOT_FOUND",
      message: "Purchase request was not found.",
    });
  });

  it("creates the default new-project target only after the owning artist accepts", async () => {
    const productId = await createProduct({ name: "SK-95 New Project Mix" });
    const requestId = await createApprovedRequest({ productId, projectId: null });
    const preview = await previewFull(requestId);
    expect(preview.target).toEqual({ kind: "new" });
    expect(preview.snapshot.agreementText).toContain("Project target: Start a new project.");

    const accepted = await acceptStorePurchase(activeDb(), {
      clerkUserId: artistClerkUserId,
      purchaseRequestId: requestId,
      selectedPaymentPlan: { kind: "full" },
      expectedSnapshotDigest: preview.snapshotDigest,
      operationKey: `sk95-new-target-${randomUUID()}`,
      agreementAccepted: true,
    });
    const [row] = await safely(() =>
      activeDb()
        .select({
          purchaseProjectId: purchases.projectId,
          requestProjectId: purchaseRequests.projectId,
          projectProducerId: projects.producerId,
          projectClientContactId: projects.clientContactId,
          acceptedByClerkUserId: purchaseAcceptances.acceptedByClerkUserId,
          acceptedSnapshot: purchaseAcceptances.acceptedSnapshot,
        })
        .from(purchases)
        .innerJoin(purchaseRequests, eq(purchaseRequests.id, purchases.purchaseRequestId))
        .innerJoin(projects, eq(projects.id, purchases.projectId))
        .innerJoin(purchaseAcceptances, eq(purchaseAcceptances.purchaseId, purchases.id))
        .where(eq(purchases.id, accepted.purchaseId))
        .limit(1),
    );
    expect(row).toMatchObject({
      projectProducerId: producerId,
      projectClientContactId: clientContactId,
      acceptedByClerkUserId: artistClerkUserId,
      acceptedSnapshot: preview.snapshot,
    });
    expect(row?.purchaseProjectId).toBe(row?.requestProjectId);
  });

  it("invalidates a proposal digest after a product edit without creating history", async () => {
    const projectId = await createProject({ title: "SK-95 stale product project" });
    const productId = await createProduct({ priceCents: 100_000 });
    const requestId = await createApprovedRequest({ productId, projectId });
    const preview = await previewFull(requestId);

    await safely(() =>
      activeDb()
        .update(products)
        .set({
          priceCents: 125_000,
          agreementText: "Edited future SK-95 terms.",
        })
        .where(and(eq(products.id, productId), eq(products.producerId, producerId))),
    );

    const failure = await storeError(
      acceptStorePurchase(activeDb(), {
        clerkUserId: artistClerkUserId,
        purchaseRequestId: requestId,
        selectedPaymentPlan: { kind: "full" },
        expectedSnapshotDigest: preview.snapshotDigest,
        operationKey: `sk95-stale-product-${randomUUID()}`,
        agreementAccepted: true,
      }),
    );
    expect(failure).toMatchObject({ code: "TERMS_CHANGED" });

    const [requestRow] = await safely(() =>
      activeDb()
        .select({ status: purchaseRequests.status })
        .from(purchaseRequests)
        .where(eq(purchaseRequests.id, requestId))
        .limit(1),
    );
    const purchaseRows = await safely(() =>
      activeDb()
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.purchaseRequestId, requestId)),
    );
    expect(requestRow?.status).toBe("approved");
    expect(purchaseRows).toEqual([]);
  });

  it("keeps purchase and acceptance snapshots immutable after future product edits", async () => {
    const projectId = await createProject({ title: "SK-95 immutable snapshot project" });
    const correctionProjectId = await createProject({ title: "SK-95 post-accept correction" });
    const productId = await createProduct({ name: "Original SK-95 Mix", priceCents: 110_000 });
    const requestId = await createApprovedRequest({ productId, projectId });
    const preview = await previewFull(requestId);
    const accepted = await acceptStorePurchase(activeDb(), {
      clerkUserId: artistClerkUserId,
      purchaseRequestId: requestId,
      selectedPaymentPlan: { kind: "full" },
      expectedSnapshotDigest: preview.snapshotDigest,
      operationKey: `sk95-immutable-${randomUUID()}`,
      agreementAccepted: true,
    });

    const [before] = await safely(() =>
      activeDb()
        .select({
          purchaseSnapshot: purchases.commercialSnapshot,
          purchaseDigest: purchases.snapshotDigest,
          acceptedSnapshot: purchaseAcceptances.acceptedSnapshot,
          acceptanceDigest: purchaseAcceptances.snapshotDigest,
        })
        .from(purchases)
        .innerJoin(purchaseAcceptances, eq(purchaseAcceptances.purchaseId, purchases.id))
        .where(eq(purchases.id, accepted.purchaseId))
        .limit(1),
    );
    if (!before) throw new Error("SK-95 accepted snapshot was not created");

    await safely(() =>
      activeDb()
        .update(products)
        .set({
          name: "Future SK-95 Mix",
          priceCents: 175_000,
          deliverables: ["Future stems"],
          royaltyTerms: {
            master: { mode: "percentage", bps: 1_000 },
            composition: { mode: "none" },
          },
          agreementText: "Future purchases use these edited terms.",
        })
        .where(and(eq(products.id, productId), eq(products.producerId, producerId))),
    );

    const [after] = await safely(() =>
      activeDb()
        .select({
          purchaseSnapshot: purchases.commercialSnapshot,
          purchaseDigest: purchases.snapshotDigest,
          acceptedSnapshot: purchaseAcceptances.acceptedSnapshot,
          acceptanceDigest: purchaseAcceptances.snapshotDigest,
        })
        .from(purchases)
        .innerJoin(purchaseAcceptances, eq(purchaseAcceptances.purchaseId, purchases.id))
        .where(eq(purchases.id, accepted.purchaseId))
        .limit(1),
    );
    expect(after).toEqual(before);
    expect(after?.purchaseSnapshot).toEqual(preview.snapshot);
    expect(after?.acceptedSnapshot).toEqual(preview.snapshot);

    const locked = await targetingError(
      correctProducerPurchaseTarget(activeDb(), {
        producerId,
        purchaseRequestId: requestId,
        projectId: correctionProjectId,
      }),
    );
    expect(locked).toMatchObject({ code: "LOCKED" });
  });

  it("serializes target correction against acceptance so exactly one proposal wins", async () => {
    const firstProjectId = await createProject({ title: "SK-95 race first target" });
    const secondProjectId = await createProject({ title: "SK-95 race second target" });
    const productId = await createProduct({ priceCents: 90_000 });
    const requestId = await createApprovedRequest({ productId, projectId: firstProjectId });
    const preview = await previewFull(requestId);

    const [correction, acceptance] = await Promise.allSettled([
      correctProducerPurchaseTarget(activeDb(), {
        producerId,
        purchaseRequestId: requestId,
        projectId: secondProjectId,
      }),
      acceptStorePurchase(activeDb(), {
        clerkUserId: artistClerkUserId,
        purchaseRequestId: requestId,
        selectedPaymentPlan: { kind: "full" },
        expectedSnapshotDigest: preview.snapshotDigest,
        operationKey: `sk95-target-race-${randomUUID()}`,
        agreementAccepted: true,
      }),
    ]);
    expect([correction, acceptance].filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );

    const [requestRow] = await safely(() =>
      activeDb()
        .select({ status: purchaseRequests.status, projectId: purchaseRequests.projectId })
        .from(purchaseRequests)
        .where(eq(purchaseRequests.id, requestId))
        .limit(1),
    );
    const purchaseRows = await safely(() =>
      activeDb()
        .select({ id: purchases.id, projectId: purchases.projectId })
        .from(purchases)
        .where(eq(purchases.purchaseRequestId, requestId)),
    );

    if (acceptance.status === "fulfilled") {
      expect(correction.status).toBe("rejected");
      if (correction.status === "rejected") {
        expect(correction.reason).toBeInstanceOf(PurchaseTargetingError);
      }
      expect(requestRow).toEqual({ status: "converted", projectId: firstProjectId });
      expect(purchaseRows).toHaveLength(1);
      expect(purchaseRows[0]?.projectId).toBe(firstProjectId);
    } else {
      expect(correction.status).toBe("fulfilled");
      expect(acceptance.reason).toBeInstanceOf(StoreAcceptanceError);
      expect(acceptance.reason).toMatchObject({ code: "TERMS_CHANGED" });
      expect(requestRow).toEqual({ status: "approved", projectId: secondProjectId });
      expect(purchaseRows).toEqual([]);
    }
  });

  it("does not distinguish missing, foreign-client, or foreign-producer target IDs", async () => {
    const projectId = await createProject({ title: "SK-95 ownership request target" });
    const foreignClientProjectId = await createProject({
      title: "SK-95 foreign-client target",
      ownerClientContactId: sameProducerForeignClientId,
    });
    const foreignProducerProjectId = await createProject({
      title: "SK-95 foreign-producer target",
      ownerProducerId: foreignProducerId,
      ownerClientContactId: foreignClientContactId,
    });
    const productId = await createProduct();
    const requestId = await createApprovedRequest({ productId, projectId });

    const failures = await Promise.all(
      [randomUUID(), foreignClientProjectId, foreignProducerProjectId].map((targetProjectId) =>
        targetingError(
          correctProducerPurchaseTarget(activeDb(), {
            producerId,
            purchaseRequestId: requestId,
            projectId: targetProjectId,
          }),
        ),
      ),
    );
    expect(
      failures.map((failure) => ({ code: failure.code, message: failure.message })),
    ).toEqual([
      { code: "NOT_FOUND", message: "Purchase request or target was not found." },
      { code: "NOT_FOUND", message: "Purchase request or target was not found." },
      { code: "NOT_FOUND", message: "Purchase request or target was not found." },
    ]);
  });

  it("revokes preview and acceptance when the artist disconnects", async () => {
    const projectId = await createProject({ title: "SK-95 disconnected target" });
    const productId = await createProduct();
    const requestId = await createApprovedRequest({ productId, projectId });

    await safely(() =>
      activeDb()
        .update(clientContacts)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(clientContacts.id, clientContactId),
            eq(clientContacts.producerId, producerId),
          ),
        ),
    );

    const previewFailure = await storeError(
      previewStorePurchaseAcceptance(activeDb(), {
        clerkUserId: artistClerkUserId,
        purchaseRequestId: requestId,
        selectedPaymentPlan: { kind: "full" },
      }),
    );
    const acceptanceFailure = await storeError(
      acceptStorePurchase(activeDb(), {
        clerkUserId: artistClerkUserId,
        purchaseRequestId: requestId,
        selectedPaymentPlan: { kind: "full" },
        expectedSnapshotDigest: "0".repeat(64),
        operationKey: `sk95-disconnected-${randomUUID()}`,
        agreementAccepted: true,
      }),
    );
    expect({ code: acceptanceFailure.code, message: acceptanceFailure.message }).toEqual({
      code: previewFailure.code,
      message: previewFailure.message,
    });
    expect(previewFailure).toMatchObject({
      code: "NOT_FOUND",
      message: "Purchase request was not found.",
    });
    const history = await safely(() =>
      activeDb()
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.purchaseRequestId, requestId)),
    );
    expect(history).toEqual([]);
  });
});
