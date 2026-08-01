import {
  and,
  clientContacts,
  eq,
  isNull,
  privateOffers,
  products,
  projects,
  purchaseAcceptances,
  purchaseInstallments,
  purchaseRequests,
  purchaseSessionAllowances,
  purchases,
  sql,
  type Db,
  type PaymentPlan,
  type PurchaseCommercialSnapshot,
} from "@skitza/db";

import { generateRefNumber } from "~/lib/purchase/request-helpers";
import { snapshotCommercialTerms } from "./policy";
import type {
  AcceptedPurchase,
  PurchaseAcceptanceRecord,
  PurchaseAtomicRepository,
  PurchaseAtomicScope,
  PurchaseAtomicTransaction,
  PurchaseProjectActivation,
  PurchaseSource,
  PurchaseSourceDescriptor,
} from "./service";

export type PurchaseSessionAllowanceDraft = Readonly<{
  purchaseId: string;
  producerId: string;
  bookingEnabledSnapshot: true;
  kind: "fixed" | "unlimited";
  sessionLimit: number | null;
  durationMin: number;
  locationType: string;
  bufferMinutes: number;
  minLeadHours: number;
  createdAt: Date;
}>;

/**
 * Derive the immutable booking allowance from accepted commercial truth.
 * Store session products are deliberately distinguished in purchase
 * provenance; private offers retain their source kind while using the same
 * frozen session terms.
 */
export function purchaseSessionAllowanceDraft(
  purchase: Pick<
    AcceptedPurchase,
    "id" | "producerId" | "source" | "commercialSnapshot" | "acceptedAt"
  >,
): PurchaseSessionAllowanceDraft | null {
  const session = purchase.commercialSnapshot.value.session;
  const explicitlyBookable =
    purchase.commercialSnapshot.value.version === 2 &&
    purchase.commercialSnapshot.value.bookingEnabled === true;
  if (!explicitlyBookable) {
    return null;
  }
  if (session === null) {
    throw new Error("A booking-enabled purchase is missing frozen session terms");
  }
  // SK-95 accepted Store rows used store_product before SK-68 introduced
  // explicit session_product provenance. Their immutable session snapshot is
  // still authoritative; all new Store session acceptances use session_product.
  return {
    purchaseId: purchase.id,
    producerId: purchase.producerId,
    bookingEnabledSnapshot: true,
    kind: session.limit.kind,
    sessionLimit: session.limit.kind === "fixed" ? session.limit.count : null,
    durationMin: session.durationMin,
    locationType: session.locationType,
    bufferMinutes: session.bufferMinutes,
    minLeadHours: session.minLeadHours,
    createdAt: purchase.acceptedAt,
  };
}

/** Create exactly one allowance, or prove an idempotent replay is identical. */
export async function ensurePurchaseSessionAllowance(
  tx: PurchaseTransactionDb,
  purchase: Pick<
    AcceptedPurchase,
    "id" | "producerId" | "source" | "commercialSnapshot" | "acceptedAt"
  >,
): Promise<void> {
  const draft = purchaseSessionAllowanceDraft(purchase);
  // Non-session purchases cannot own session capacity. Return before touching
  // the allowance relation so unrelated purchase flows stay independent of
  // the session-booking schema during a staged deployment.
  if (draft === null) return;

  const [existing] = await tx
    .select()
    .from(purchaseSessionAllowances)
    .where(eq(purchaseSessionAllowances.purchaseId, purchase.id))
    .limit(1);

  let row = existing;
  if (!row) {
    [row] = await tx
      .insert(purchaseSessionAllowances)
      .values(draft)
      .onConflictDoNothing({ target: purchaseSessionAllowances.purchaseId })
      .returning();
    if (!row) {
      [row] = await tx
        .select()
        .from(purchaseSessionAllowances)
        .where(eq(purchaseSessionAllowances.purchaseId, purchase.id))
        .limit(1);
    }
  }

  if (
    !row ||
    row.producerId !== draft.producerId ||
    row.bookingEnabledSnapshot !== draft.bookingEnabledSnapshot ||
    row.kind !== draft.kind ||
    row.sessionLimit !== draft.sessionLimit ||
    row.durationMin !== draft.durationMin ||
    row.locationType !== draft.locationType ||
    row.bufferMinutes !== draft.bufferMinutes ||
    row.minLeadHours !== draft.minLeadHours
  ) {
    throw new Error("Stored purchase session allowance differs from frozen commercial terms");
  }
}

/**
 * The Store acceptance orchestrator owns the surrounding interactive
 * transaction. Keeping this adapter transaction-bound lets its request lock,
 * product lock, purchase insert, immutable acceptance, and request conversion
 * commit as one operation.
 */
export type PurchaseTransactionDb = Pick<Db, "select" | "insert" | "update" | "execute">;

function paymentPlanForRow(
  kind: "full" | "split_50_50" | "monthly" | null,
  installmentCount: number,
): PaymentPlan | null {
  if (kind === null) return null;
  return kind === "monthly" ? { kind, installments: installmentCount } : { kind };
}

function sourceForRow(row: {
  sourceKind:
    | "store_product"
    | "private_offer"
    | "session_product"
    | "paid_add_on"
    | "no_charge_add_on";
  productId: string | null;
  privateOfferId: string | null;
  purchaseRequestId: string | null;
}): PurchaseSource {
  if (row.sourceKind === "store_product" || row.sourceKind === "session_product") {
    if (row.productId === null || row.purchaseRequestId === null || row.privateOfferId !== null) {
      throw new Error("Stored Store purchase source is invalid");
    }
    return {
      kind: row.sourceKind,
      productId: row.productId,
      privateOfferId: null,
      purchaseRequestId: row.purchaseRequestId,
    };
  }
  if (row.sourceKind === "private_offer") {
    if (row.privateOfferId === null || row.purchaseRequestId !== null) {
      throw new Error("Stored private-offer source is invalid");
    }
    return {
      kind: "private_offer",
      productId: row.productId,
      privateOfferId: row.privateOfferId,
      purchaseRequestId: null,
    };
  }
  return {
    kind: row.sourceKind,
    productId: row.productId,
    privateOfferId: row.privateOfferId,
    purchaseRequestId: row.purchaseRequestId,
  };
}

async function loadAcceptedPurchase(
  tx: PurchaseTransactionDb,
  where: ReturnType<typeof and> | ReturnType<typeof eq>,
  lock: boolean,
): Promise<AcceptedPurchase | null> {
  const query = tx.select().from(purchases).where(where).limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) return null;

  const scheduleRows = await tx
    .select()
    .from(purchaseInstallments)
    .where(eq(purchaseInstallments.purchaseId, row.id))
    .orderBy(purchaseInstallments.position);
  const frozen = snapshotCommercialTerms(row.commercialSnapshot);
  if (frozen.digest !== row.snapshotDigest) {
    throw new Error("Stored commercial snapshot digest is invalid");
  }
  const lifecycleChangedAt =
    row.lifecycleStatus === "active"
      ? (row.activatedAt ?? row.acceptedAt)
      : row.lifecycleStatus === "canceled"
        ? (row.canceledAt ?? row.acceptedAt)
        : row.acceptedAt;

  return {
    id: row.id,
    producerId: row.producerId,
    projectId: row.projectId,
    clientContactId: row.clientContactId,
    source: sourceForRow(row),
    operationKey: row.operationKey,
    operationDigest: row.operationDigest,
    commercialSnapshot: frozen,
    totalCents: row.totalCents,
    plan: paymentPlanForRow(row.paymentPlanKind, scheduleRows.length),
    schedule: scheduleRows.map((installment) => ({
      sequence: installment.position,
      amountCents: installment.amountCents,
      trigger: installment.dueTrigger,
      status: installment.status,
    })),
    acceptedAt: row.acceptedAt,
    lifecycleStatus: row.lifecycleStatus,
    lifecycleChangedAt,
    activatedAt: row.activatedAt,
  };
}

export type AcceptedPurchaseForProducerRequest = Readonly<{
  purchase: AcceptedPurchase;
  acceptance: PurchaseAcceptanceRecord;
}>;

/**
 * Load immutable commercial truth for one converted Store request.
 *
 * All three ownership anchors are part of the lookup. A request that belongs
 * to another producer or client is therefore indistinguishable from a missing
 * request to the caller, while a half-written purchase/acceptance pair fails
 * closed as an integrity error.
 */
export async function loadAcceptedPurchaseForProducerRequest(
  db: Db,
  input: {
    producerId: string;
    clientContactId: string;
    purchaseRequestId: string;
  },
): Promise<AcceptedPurchaseForProducerRequest | null> {
  const purchase = await loadAcceptedPurchase(
    db,
    and(
      eq(purchases.producerId, input.producerId),
      eq(purchases.clientContactId, input.clientContactId),
      eq(purchases.purchaseRequestId, input.purchaseRequestId),
    ),
    false,
  );
  if (!purchase) return null;

  const [acceptanceRow] = await db
    .select()
    .from(purchaseAcceptances)
    .where(
      and(
        eq(purchaseAcceptances.purchaseId, purchase.id),
        eq(purchaseAcceptances.producerId, input.producerId),
        eq(purchaseAcceptances.clientContactId, input.clientContactId),
      ),
    )
    .limit(1);
  if (!acceptanceRow) {
    throw new Error("Accepted request is missing its immutable acceptance record");
  }

  const acceptance = acceptanceRecord(acceptanceRow);
  if (
    (purchase.source.kind !== "store_product" && purchase.source.kind !== "session_product") ||
    purchase.source.purchaseRequestId !== input.purchaseRequestId ||
    purchase.id !== acceptance.purchaseId ||
    purchase.producerId !== acceptance.producerId ||
    purchase.clientContactId !== acceptance.clientContactId ||
    purchase.commercialSnapshot.digest !== acceptance.commercialSnapshot.digest ||
    purchase.acceptedAt.getTime() !== acceptance.acceptedAt.getTime()
  ) {
    throw new Error("Accepted request commercial history is inconsistent");
  }

  return Object.freeze({ purchase, acceptance });
}

function acceptanceRecord(row: {
  id: string;
  purchaseId: string;
  producerId: string;
  clientContactId: string;
  acceptedByClerkUserId: string;
  acceptedSnapshot: PurchaseCommercialSnapshot;
  snapshotDigest: string;
  acceptedAt: Date;
}): PurchaseAcceptanceRecord {
  const frozen = snapshotCommercialTerms(row.acceptedSnapshot);
  if (frozen.digest !== row.snapshotDigest) {
    throw new Error("Stored acceptance snapshot digest is invalid");
  }
  return {
    id: row.id,
    purchaseId: row.purchaseId,
    producerId: row.producerId,
    clientContactId: row.clientContactId,
    acceptedByClerkUserId: row.acceptedByClerkUserId,
    commercialSnapshot: frozen,
    snapshotDigest: row.snapshotDigest,
    acceptedAt: row.acceptedAt,
  };
}

function unsupportedLedgerMethod(): never {
  throw new Error("The Store acceptance repository does not expose payment-ledger mutations");
}

function transactionAdapter(tx: PurchaseTransactionDb): PurchaseAtomicTransaction {
  return {
    getProjectForUpdate: async (projectId) => {
      const [project] = await tx
        .select({
          id: projects.id,
          producerId: projects.producerId,
          clientContactId: projects.clientContactId,
          clientClerkUserId: clientContacts.clerkUserId,
          lifecycleStatus: projects.lifecycleStatus,
        })
        .from(projects)
        .innerJoin(
          clientContacts,
          and(
            eq(clientContacts.id, projects.clientContactId),
            eq(clientContacts.producerId, projects.producerId),
            isNull(clientContacts.archivedAt),
          ),
        )
        .where(eq(projects.id, projectId))
        .limit(1)
        .for("update");
      return project ?? null;
    },

    loadPurchaseSourceDescriptor: async (
      source: PurchaseSource,
    ): Promise<PurchaseSourceDescriptor> => {
      const [product, privateOffer, purchaseRequest] = await Promise.all([
        source.productId === null
          ? Promise.resolve(null)
          : tx
              .select({ id: products.id, producerId: products.producerId })
              .from(products)
              .where(eq(products.id, source.productId))
              .limit(1)
              .then((rows) => rows[0] ?? null),
        source.privateOfferId === null
          ? Promise.resolve(null)
          : tx
              .select({
                id: privateOffers.id,
                producerId: privateOffers.producerId,
                clientContactId: privateOffers.clientContactId,
                targetProjectId: privateOffers.targetProjectId,
                productId: privateOffers.productId,
              })
              .from(privateOffers)
              .where(eq(privateOffers.id, source.privateOfferId))
              .limit(1)
              .then((rows) => rows[0] ?? null),
        source.purchaseRequestId === null
          ? Promise.resolve(null)
          : tx
              .select({
                id: purchaseRequests.id,
                producerId: purchaseRequests.producerId,
                clientContactId: purchaseRequests.clientContactId,
                projectId: purchaseRequests.projectId,
                productId: purchaseRequests.productId,
              })
              .from(purchaseRequests)
              .where(eq(purchaseRequests.id, source.purchaseRequestId))
              .limit(1)
              .then((rows) => rows[0] ?? null),
      ]);
      return { product, privateOffer, purchaseRequest };
    },

    findPurchaseByOperationKey: (scope) =>
      loadAcceptedPurchase(
        tx,
        and(
          eq(purchases.producerId, scope.producerId),
          eq(purchases.clientContactId, scope.clientContactId),
          eq(purchases.operationKey, scope.operationKey),
        ),
        false,
      ),

    insertPurchase: async (input) => {
      const snapshot = input.commercialSnapshot.value as PurchaseCommercialSnapshot;
      const [row] = await tx
        .insert(purchases)
        .values({
          producerId: input.producerId,
          projectId: input.projectId,
          clientContactId: input.clientContactId,
          productId: input.source.productId,
          privateOfferId: input.source.privateOfferId,
          purchaseRequestId: input.source.purchaseRequestId,
          sourceKind: input.source.kind,
          operationKey: input.operationKey,
          operationDigest: input.operationDigest,
          refNumber: generateRefNumber(),
          lifecycleStatus: input.lifecycleStatus,
          paymentPlanKind: input.plan?.kind ?? null,
          snapshotVersion: snapshot.version,
          snapshotDigest: input.commercialSnapshot.digest,
          commercialSnapshot: snapshot,
          subtotalCents: snapshot.subtotalCents,
          taxCents: snapshot.tax.amountCents,
          totalCents: snapshot.totalCents,
          currency: snapshot.currency,
          acceptedAt: input.acceptedAt,
          activatedAt: input.activatedAt,
          updatedAt: input.acceptedAt,
        })
        .returning({ id: purchases.id });
      if (!row) throw new Error("Purchase insert did not return a row");

      if (input.schedule.length > 0) {
        await tx.insert(purchaseInstallments).values(
          input.schedule.map((installment) => ({
            purchaseId: row.id,
            producerId: input.producerId,
            position: installment.sequence,
            amountCents: installment.amountCents,
            currency: snapshot.currency,
            dueTrigger: installment.trigger,
            dueAt: installment.sequence === 1 ? input.acceptedAt : null,
            triggeredAt: installment.sequence === 1 ? input.acceptedAt : null,
            requiredForActivation: installment.sequence === 1,
            status: installment.status,
            updatedAt: input.acceptedAt,
          })),
        );
      }
      const inserted = await loadAcceptedPurchase(tx, eq(purchases.id, row.id), false);
      if (!inserted) throw new Error("Inserted purchase could not be reloaded");
      return inserted;
    },

    findAcceptanceForPurchase: async (purchaseId) => {
      const [row] = await tx
        .select()
        .from(purchaseAcceptances)
        .where(eq(purchaseAcceptances.purchaseId, purchaseId))
        .limit(1);
      if (!row) return null;
      const purchase = await loadAcceptedPurchase(tx, eq(purchases.id, purchaseId), false);
      if (!purchase) throw new Error("Purchase acceptance points to a missing purchase");
      await ensurePurchaseSessionAllowance(tx, purchase);
      return acceptanceRecord(row);
    },

    insertAcceptanceFromPurchase: async (purchase, acceptedByClerkUserId) => {
      const [row] = await tx
        .insert(purchaseAcceptances)
        .values({
          purchaseId: purchase.id,
          producerId: purchase.producerId,
          clientContactId: purchase.clientContactId,
          acceptedByClerkUserId,
          acceptedSnapshot: purchase.commercialSnapshot.value as PurchaseCommercialSnapshot,
          snapshotDigest: purchase.commercialSnapshot.digest,
          acceptedAt: purchase.acceptedAt,
        })
        .returning();
      if (!row) throw new Error("Purchase acceptance insert did not return a row");
      await ensurePurchaseSessionAllowance(tx, purchase);
      return acceptanceRecord(row);
    },

    getPurchaseForUpdate: (purchaseId) =>
      loadAcceptedPurchase(tx, eq(purchases.id, purchaseId), true),
    findPaymentByOperationKey: () => unsupportedLedgerMethod(),
    insertPayment: () => unsupportedLedgerMethod(),
    listPayments: () => unsupportedLedgerMethod(),
    listCorrections: () => unsupportedLedgerMethod(),
    listWaivers: () => unsupportedLedgerMethod(),
    isInstallmentCollectible: () => unsupportedLedgerMethod(),

    activatePurchaseAndProject: async (
      purchase,
      activatedAt,
    ): Promise<PurchaseProjectActivation> => {
      const [purchaseRow] = await tx
        .update(purchases)
        .set({ lifecycleStatus: "active", activatedAt, updatedAt: activatedAt })
        .where(
          and(
            eq(purchases.id, purchase.id),
            eq(purchases.producerId, purchase.producerId),
            eq(purchases.projectId, purchase.projectId),
          ),
        )
        .returning({
          id: purchases.id,
          producerId: purchases.producerId,
          projectId: purchases.projectId,
          lifecycleStatus: purchases.lifecycleStatus,
          activatedAt: purchases.activatedAt,
        });
      const [projectRow] = await tx
        .update(projects)
        .set({ lifecycleStatus: "active", lifecycleChangedAt: activatedAt, updatedAt: activatedAt })
        .where(
          and(
            eq(projects.id, purchase.projectId),
            eq(projects.producerId, purchase.producerId),
            eq(projects.clientContactId, purchase.clientContactId),
          ),
        )
        .returning({
          lifecycleStatus: projects.lifecycleStatus,
          lifecycleChangedAt: projects.lifecycleChangedAt,
        });
      if (!purchaseRow?.activatedAt || !projectRow) {
        throw new Error("Purchase/project activation failed");
      }
      return {
        purchaseId: purchaseRow.id,
        producerId: purchaseRow.producerId,
        projectId: purchaseRow.projectId,
        purchaseLifecycleStatus: purchaseRow.lifecycleStatus,
        purchaseLifecycleChangedAt: purchaseRow.activatedAt,
        purchaseActivatedAt: purchaseRow.activatedAt,
        projectLifecycleStatus: projectRow.lifecycleStatus,
        projectLifecycleChangedAt: projectRow.lifecycleChangedAt,
      };
    },
  };
}

export function purchaseRepositoryForTransaction(
  tx: PurchaseTransactionDb,
): PurchaseAtomicRepository {
  return {
    atomically: async <T>(
      scope: PurchaseAtomicScope,
      work: (transaction: PurchaseAtomicTransaction) => Promise<T>,
    ) => {
      const key =
        scope.kind === "purchase_operation"
          ? `purchase-operation:${scope.producerId}:${scope.clientContactId}:${scope.operationKey}`
          : `purchase-ledger:${scope.purchaseId}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
      return work(transactionAdapter(tx));
    },
  };
}
