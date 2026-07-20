import {
  and,
  clientContacts,
  eq,
  inArray,
  isNull,
  products,
  producers,
  projects,
  purchaseAcceptances,
  purchaseRequests,
  purchases,
  type Db,
  type PaymentPlan,
  type PurchaseCommercialSnapshot,
} from "@skitza/db";

import {
  buildStorePurchaseSnapshot,
  StoreProductCommercialError,
} from "~/server/domain/store-products/service";
import { createInstallmentSchedule } from "./ledger";
import { purchaseRepositoryForTransaction } from "./db";
import { digestCommercialSnapshot } from "./policy";
import { acceptPurchase, PurchaseDomainError } from "./service";

export type StoreAcceptanceErrorCode = "NOT_FOUND" | "NOT_APPROVED" | "TERMS_CHANGED" | "INVALID";

export class StoreAcceptanceError extends Error {
  readonly code: StoreAcceptanceErrorCode;

  constructor(code: StoreAcceptanceErrorCode, message: string) {
    super(message);
    this.name = "StoreAcceptanceError";
    this.code = code;
  }
}

export type StoreAcceptancePreview = {
  productId: string;
  productName: string;
  producerName: string;
  status: "approved";
  target:
    | { kind: "new" }
    | {
        kind: "existing";
        projectId: string;
        projectTitle: string;
        lifecycleStatus: "waiting_for_payment" | "active";
        workflowStage: "brief" | "production" | "mixing" | "mastering" | "done";
        updatedAtIso: string;
      };
  snapshot: PurchaseCommercialSnapshot;
  snapshotDigest: string;
  schedule: Array<{ label: string; amountCents: number }>;
};

type AcceptanceContext = Awaited<ReturnType<typeof loadArtistAcceptanceContext>>;

export function storePurchaseSourceKind(
  session: PurchaseCommercialSnapshot["session"],
): "store_product" | "session_product" {
  return session === null ? "store_product" : "session_product";
}

function planKey(plan: PaymentPlan): string {
  return plan.kind === "monthly" ? `monthly:${String(plan.installments)}` : plan.kind;
}

function scheduleLabel(plan: PaymentPlan, sequence: number): string {
  if (plan.kind === "full") return "Due at acceptance";
  if (plan.kind === "split_50_50") {
    return sequence === 1
      ? "50% due at acceptance"
      : "50% due when the artist approves the final version";
  }
  return sequence === 1 ? "First payment due at acceptance" : `Monthly payment ${String(sequence)}`;
}

function snapshotMoney(cents: number, currency: string): string {
  const value = BigInt(cents);
  return `${currency} ${String(value / 100n)}.${String(value % 100n).padStart(2, "0")}`;
}

function mapCommercialError(error: unknown): never {
  if (error instanceof StoreProductCommercialError) {
    throw new StoreAcceptanceError("INVALID", error.message);
  }
  if (error instanceof PurchaseDomainError) {
    if (error.code === "OPERATION_KEY_CONFLICT") {
      throw new StoreAcceptanceError("TERMS_CHANGED", error.message);
    }
    if (error.code === "NOT_FOUND" || error.code === "NOT_OWNER") {
      throw new StoreAcceptanceError("NOT_FOUND", "Purchase request was not found.");
    }
    throw new StoreAcceptanceError("INVALID", error.message);
  }
  throw error;
}

async function loadArtistAcceptanceContext(
  db: Pick<Db, "select">,
  input: { clerkUserId: string; purchaseRequestId: string },
) {
  const [row] = await db
    .select({
      request: purchaseRequests,
      product: products,
      producerName: producers.displayName,
      taxMode: producers.taxMode,
      taxRatePct: producers.taxRatePct,
    })
    .from(purchaseRequests)
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, purchaseRequests.clientContactId),
        eq(clientContacts.producerId, purchaseRequests.producerId),
        eq(clientContacts.clerkUserId, input.clerkUserId),
        isNull(clientContacts.archivedAt),
      ),
    )
    .innerJoin(
      products,
      and(
        eq(products.id, purchaseRequests.productId),
        eq(products.producerId, purchaseRequests.producerId),
      ),
    )
    .innerJoin(producers, eq(producers.id, purchaseRequests.producerId))
    .where(eq(purchaseRequests.id, input.purchaseRequestId))
    .limit(1);
  if (!row) throw new StoreAcceptanceError("NOT_FOUND", "Purchase request was not found.");
  return row;
}

function buildTerms(
  context: AcceptanceContext,
  selectedPaymentPlan: PaymentPlan,
  target: StoreAcceptancePreview["target"],
) {
  try {
    const built = buildStorePurchaseSnapshot({
      product: context.product,
      requestedSongQty: context.request.requestedSongQty,
      taxMode: context.taxMode,
      taxRatePct: context.taxRatePct,
      selectedPaymentPlan,
    });
    const installments = createInstallmentSchedule(selectedPaymentPlan, built.snapshot.totalCents);
    const schedule = installments.map((installment) => ({
      sequence: installment.sequence,
      trigger: installment.trigger,
      label: scheduleLabel(selectedPaymentPlan, installment.sequence),
      amountCents: installment.amountCents,
    }));
    const targetAgreement =
      target.kind === "new"
        ? "Project target: Start a new project."
        : `Project target: ${target.projectTitle} (${target.projectId}).`;
    const scheduleAgreement = schedule.map(
      (installment) =>
        `- ${String(installment.sequence)}. ${installment.label}: ${snapshotMoney(installment.amountCents, built.snapshot.currency)} [${installment.trigger}]`,
    );
    const snapshot: PurchaseCommercialSnapshot = {
      ...built.snapshot,
      agreementText: [
        built.snapshot.agreementText,
        targetAgreement,
        "Exact installment schedule:",
        ...scheduleAgreement,
      ].join("\n"),
    };
    return {
      snapshot,
      snapshotDigest: digestCommercialSnapshot(snapshot),
      schedule,
    };
  } catch (error) {
    if (
      !(error instanceof StoreProductCommercialError) &&
      !(error instanceof PurchaseDomainError)
    ) {
      throw new StoreAcceptanceError(
        "INVALID",
        "This payment plan cannot create a valid installment schedule for the current total.",
      );
    }
    mapCommercialError(error);
  }
}

async function targetPreview(
  db: Pick<Db, "select">,
  context: AcceptanceContext,
): Promise<StoreAcceptancePreview["target"]> {
  if (context.request.projectId === null) return { kind: "new" };
  const [project] = await db
    .select({
      id: projects.id,
      title: projects.title,
      lifecycleStatus: projects.lifecycleStatus,
      workflowStage: projects.workflowStage,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, context.request.projectId),
        eq(projects.producerId, context.request.producerId),
        eq(projects.clientContactId, context.request.clientContactId),
        inArray(projects.lifecycleStatus, ["waiting_for_payment", "active"]),
      ),
    )
    .limit(1);
  if (!project) throw new StoreAcceptanceError("NOT_FOUND", "Purchase target was not found.");
  return {
    kind: "existing",
    projectId: project.id,
    projectTitle: project.title,
    lifecycleStatus: project.lifecycleStatus as "waiting_for_payment" | "active",
    workflowStage: project.workflowStage,
    updatedAtIso: project.updatedAt.toISOString(),
  };
}

async function lockAcceptanceTarget(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  context: AcceptanceContext,
): Promise<StoreAcceptancePreview["target"]> {
  if (context.request.projectId === null) return { kind: "new" };
  const [project] = await tx
    .select({
      id: projects.id,
      title: projects.title,
      lifecycleStatus: projects.lifecycleStatus,
      workflowStage: projects.workflowStage,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, context.request.projectId),
        eq(projects.producerId, context.request.producerId),
        eq(projects.clientContactId, context.request.clientContactId),
        inArray(projects.lifecycleStatus, ["waiting_for_payment", "active"]),
      ),
    )
    .limit(1)
    .for("update");
  if (!project) throw new StoreAcceptanceError("NOT_FOUND", "Purchase target was not found.");
  return {
    kind: "existing",
    projectId: project.id,
    projectTitle: project.title,
    lifecycleStatus: project.lifecycleStatus as "waiting_for_payment" | "active",
    workflowStage: project.workflowStage,
    updatedAtIso: project.updatedAt.toISOString(),
  };
}

export async function previewStorePurchaseAcceptance(
  db: Db,
  input: {
    clerkUserId: string;
    purchaseRequestId: string;
    selectedPaymentPlan: PaymentPlan;
  },
): Promise<StoreAcceptancePreview> {
  const context = await loadArtistAcceptanceContext(db, input);
  if (context.request.status !== "approved") {
    throw new StoreAcceptanceError(
      "NOT_APPROVED",
      "The producer must approve this request before final acceptance.",
    );
  }
  const target = await targetPreview(db, context);
  const terms = buildTerms(context, input.selectedPaymentPlan, target);
  return {
    productId: context.product.id,
    productName: context.product.name,
    producerName: context.producerName ?? "Your producer",
    status: "approved",
    target,
    snapshot: terms.snapshot,
    snapshotDigest: terms.snapshotDigest,
    schedule: terms.schedule,
  };
}

export async function acceptStorePurchase(
  db: Db,
  input: {
    clerkUserId: string;
    purchaseRequestId: string;
    selectedPaymentPlan: PaymentPlan;
    expectedSnapshotDigest: string;
    operationKey: string;
    agreementAccepted: boolean;
  },
): Promise<{
  purchaseId: string;
  productId: string;
  created: boolean;
  notification: null | {
    producerId: string;
    purchaseRequestId: string;
    artistName: string;
    productName: string;
    refNumber: string;
  };
}> {
  if (!input.agreementAccepted) {
    throw new StoreAcceptanceError("INVALID", "The exact agreement must be accepted.");
  }

  return db.transaction(async (tx) => {
    const [context] = await tx
      .select({
        request: purchaseRequests,
        product: products,
        producerName: producers.displayName,
        taxMode: producers.taxMode,
        taxRatePct: producers.taxRatePct,
      })
      .from(purchaseRequests)
      .innerJoin(
        clientContacts,
        and(
          eq(clientContacts.id, purchaseRequests.clientContactId),
          eq(clientContacts.producerId, purchaseRequests.producerId),
          eq(clientContacts.clerkUserId, input.clerkUserId),
          isNull(clientContacts.archivedAt),
        ),
      )
      .innerJoin(
        products,
        and(
          eq(products.id, purchaseRequests.productId),
          eq(products.producerId, purchaseRequests.producerId),
        ),
      )
      .innerJoin(producers, eq(producers.id, purchaseRequests.producerId))
      .where(eq(purchaseRequests.id, input.purchaseRequestId))
      .limit(1)
      .for("update");
    if (!context) {
      throw new StoreAcceptanceError("NOT_FOUND", "Purchase request was not found.");
    }

    if (context.request.status === "converted") {
      const [existing] = await tx
        .select({
          id: purchases.id,
          productId: purchases.productId,
          operationKey: purchases.operationKey,
          snapshotDigest: purchases.snapshotDigest,
          commercialSnapshot: purchases.commercialSnapshot,
          acceptedByClerkUserId: purchaseAcceptances.acceptedByClerkUserId,
        })
        .from(purchases)
        .innerJoin(purchaseAcceptances, eq(purchaseAcceptances.purchaseId, purchases.id))
        .where(eq(purchases.purchaseRequestId, context.request.id))
        .limit(1);
      if (
        !existing ||
        existing.productId === null ||
        existing.operationKey !== input.operationKey ||
        existing.snapshotDigest !== input.expectedSnapshotDigest ||
        existing.acceptedByClerkUserId !== input.clerkUserId ||
        digestCommercialSnapshot(existing.commercialSnapshot.selectedPaymentPlan) !==
          digestCommercialSnapshot(input.selectedPaymentPlan)
      ) {
        throw new StoreAcceptanceError(
          "TERMS_CHANGED",
          "This acceptance key already belongs to different terms.",
        );
      }
      return {
        purchaseId: existing.id,
        productId: existing.productId,
        created: false,
        notification: null,
      };
    }

    if (context.request.status !== "approved") {
      throw new StoreAcceptanceError(
        "NOT_APPROVED",
        "The producer must approve this request before final acceptance.",
      );
    }

    const target = await lockAcceptanceTarget(tx, context);
    const terms = buildTerms(context, input.selectedPaymentPlan, target);
    if (terms.snapshotDigest !== input.expectedSnapshotDigest) {
      throw new StoreAcceptanceError(
        "TERMS_CHANGED",
        "The commercial terms or project target changed. Review the exact agreement again before accepting.",
      );
    }

    let projectId = context.request.projectId;
    if (projectId === null) {
      const now = new Date();
      const [project] = await tx
        .insert(projects)
        .values({
          producerId: context.request.producerId,
          clientContactId: context.request.clientContactId,
          title: context.product.name,
          lifecycleStatus: "waiting_for_payment",
          lifecycleChangedAt: now,
          clientName: context.request.artistName,
          clientEmail: context.request.artistEmail,
          artistName: context.request.artistName,
          artistEmail: context.request.artistEmail,
          updatedAt: now,
        })
        .returning({ id: projects.id });
      if (!project) throw new Error("Project creation did not return a row");
      projectId = project.id;
      const [targeted] = await tx
        .update(purchaseRequests)
        .set({ projectId, updatedAt: now })
        .where(
          and(eq(purchaseRequests.id, context.request.id), eq(purchaseRequests.status, "approved")),
        )
        .returning({ id: purchaseRequests.id });
      if (!targeted) {
        throw new StoreAcceptanceError(
          "TERMS_CHANGED",
          "This purchase target changed. Review the agreement again.",
        );
      }
      context.request.projectId = projectId;
    }

    const acceptedAt = new Date();
    let result;
    try {
      result = await acceptPurchase(purchaseRepositoryForTransaction(tx), {
        producerId: context.request.producerId,
        projectId,
        clientContactId: context.request.clientContactId,
        source: {
          kind: storePurchaseSourceKind(terms.snapshot.session),
          productId: context.product.id,
          privateOfferId: null,
          purchaseRequestId: context.request.id,
        },
        acceptedByClerkUserId: input.clerkUserId,
        operationKey: input.operationKey,
        totalCents: terms.snapshot.totalCents,
        plan: input.selectedPaymentPlan,
        commercialSnapshot: terms.snapshot,
        acceptedAt,
      });
    } catch (error) {
      mapCommercialError(error);
    }

    const [converted] = await tx
      .update(purchaseRequests)
      .set({
        status: "converted",
        statusChangedAt: acceptedAt,
        convertedAt: acceptedAt,
        updatedAt: acceptedAt,
      })
      .where(
        and(
          eq(purchaseRequests.id, context.request.id),
          eq(purchaseRequests.producerId, context.request.producerId),
          eq(purchaseRequests.clientContactId, context.request.clientContactId),
          eq(purchaseRequests.projectId, projectId),
          eq(purchaseRequests.status, "approved"),
        ),
      )
      .returning({ id: purchaseRequests.id });
    if (!converted) {
      throw new StoreAcceptanceError(
        "TERMS_CHANGED",
        "This request changed during acceptance. Refresh before trying again.",
      );
    }
    return {
      purchaseId: result.purchase.id,
      productId: context.product.id,
      created: result.created,
      notification: result.created
        ? {
            producerId: context.request.producerId,
            purchaseRequestId: context.request.id,
            artistName: context.request.artistName,
            productName: terms.snapshot.productOrOfferName,
            refNumber: context.request.refNumber,
          }
        : null,
    };
  });
}

export function storeAcceptancePlanKey(plan: PaymentPlan): string {
  return planKey(plan);
}
