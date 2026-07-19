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
  sourceKind: "store_product" | "private_offer" | "session_product" | "paid_add_on" | "no_charge_add_on";
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

    loadPurchaseSourceDescriptor: async (source: PurchaseSource): Promise<PurchaseSourceDescriptor> => {
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
      return row ? acceptanceRecord(row) : null;
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
