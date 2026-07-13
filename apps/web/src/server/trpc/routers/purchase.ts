import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  agreementAcceptances,
  and,
  clientContacts,
  desc,
  eq,
  inArray,
  invoices,
  isNull,
  notifications,
  paymentProofs,
  producers,
  products,
  projects,
  purchaseRequests,
  sql,
} from "@skitza/db";
import type { Db, PaymentPlan, PaymentProof, Product, PurchaseRequest } from "@skitza/db";
import { TRPCError } from "@trpc/server";
import { after } from "next/server";
import { z } from "zod";

import { snapshotProductPrice, validatePerSongUnit } from "~/lib/purchase/price-snapshot";
import { commercialTermsFingerprint } from "~/lib/purchase/commercial-terms-fingerprint";
import { safeAgreementUrl } from "~/lib/agreement-url";
import { computeProjectSessionCount } from "~/lib/pricing";
import { checkRateLimit } from "~/lib/rate-limit/in-memory";
import {
  generateRefNumber,
  isUniqueViolation,
  offeredPlans,
  planIsOffered,
  PURCHASE_APPROVAL_UNDO_MS,
  purchaseApprovalUndoableUntil,
} from "~/lib/purchase/request-helpers";
import type { PaymentPlanChoice } from "~/lib/purchase/request-helpers";
import { decodeDescription } from "~/app/(producer)/dashboard/store/description-encoding";
import { calculateCharges } from "~/server/payments/plan";
import {
  buildPlanOptions,
  chargesProgress,
  invoiceKindForCharge,
  planOption,
} from "~/server/payments/plan-preview";
import {
  BUCKETS,
  buildFinalProofKey,
  buildProofStagingKey,
  encodeR2CopySource,
  getR2,
  hasValidProofFileSignature,
} from "~/server/storage/r2";
import {
  emitAgreementAccepted,
  emitProofSubmitted,
  emitPurchaseApproved,
  emitPurchaseDeclined,
  emitPurchaseRequested,
} from "~/server/notifications/emit";
import {
  sendProofRejectedEmail,
  sendProofVerifiedEmail,
  sendPurchaseApprovedEmail,
  sendPurchaseDeclinedEmail,
} from "~/server/email/send";
import { artistProcedure } from "../artist-procedure";
import { producerProcedure } from "../producer-procedure";
import { router } from "../init";

// Per Raz's call, the engagement project is NOT created on approve — it's
// deferred until the Gate-1 undo window elapses — so undo has nothing to
// reverse.

const PAYMENT_PLAN_INPUT = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("full") }),
  z.object({ kind: z.literal("split_50_50") }),
  z.object({
    kind: z.literal("monthly"),
    installments: z.number().int().min(2).max(12),
  }),
  // BE-2: the choice carries no schedule — the server embeds the
  // product's own milestone rows at snapshot time (resolvePlanChoice).
  z.object({ kind: z.literal("milestones") }),
]);

// Rows that can still occupy the artist's single active-purchase slot.
// `paid` means at least one payment was confirmed and sessions unlocked;
// it continues to block until confirmed invoices cover the FULL snapshot.
const BLOCKING_CANDIDATE_STATUSES = ["pending", "approved", "verifying", "paid"] as const;

// Statuses in which money screens (S7-S9) are reachable.
const PAYING_STATUSES = new Set<PurchaseRequest["status"]>(["approved", "verifying", "paid"]);

const PROOF_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;
const MAX_PROOF_BYTES = 15 * 1024 * 1024;

// Running total confirmed for a purchase = SUM of its paid invoices.
async function paidTotalCents(db: Pick<Db, "select">, purchaseRequestId: string): Promise<number> {
  const rows = await db
    .select({ amountCents: invoices.amountCents })
    .from(invoices)
    .where(and(eq(invoices.purchaseRequestId, purchaseRequestId), eq(invoices.status, "paid")));
  return rows.reduce((sum, r) => sum + r.amountCents, 0);
}

async function pendingProofTotalCents(db: Db, purchaseRequestId: string): Promise<number> {
  const rows = await db
    .select({ amountCents: paymentProofs.amountCents })
    .from(paymentProofs)
    .where(
      and(
        eq(paymentProofs.purchaseRequestId, purchaseRequestId),
        eq(paymentProofs.status, "pending"),
      ),
    );
  return rows.reduce((sum, row) => sum + row.amountCents, 0);
}

/**
 * Materialize the paid purchase as the single project/credit consumed by the
 * existing artist booking flow. The caller must hold the request advisory
 * lock so concurrent proof confirmations cannot create two projects.
 */
async function ensurePurchaseProject(
  db: Pick<Db, "select" | "update" | "insert">,
  request: PurchaseRequest,
  paidCents: number,
): Promise<string | null> {
  const charges = calculateCharges(request.paymentPlanSnapshot, request.priceCents);
  const progress = chargesProgress(charges, paidCents);
  const depositDue = charges[0] ?? request.priceCents;
  if (paidCents < depositDue) return request.projectId;

  const product =
    request.sessionCountSnapshot === null && request.productId
      ? await db
          .select({
            id: products.id,
            pricingModel: products.pricingModel,
            sessionCount: products.sessionCount,
          })
          .from(products)
          .where(
            and(eq(products.id, request.productId), eq(products.producerId, request.producerId)),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null;
  const recoveredSessionCount =
    request.sessionCountSnapshot ??
    (product ? computeProjectSessionCount(product, request.songQty) : null);
  const finalPaid = paidCents >= request.priceCents;
  const now = new Date();
  const financialSnapshot = {
    depositPaid: true,
    finalPaid,
    productId: product?.id ?? request.productId,
    engagementTotalCents: request.priceCents,
    depositCents: depositDue,
    songQty: request.songQty,
    unitPriceCents: request.unitPriceCents,
    paymentPlanKind: request.paymentPlanSnapshot.kind,
    installments:
      request.paymentPlanSnapshot.kind === "monthly"
        ? request.paymentPlanSnapshot.installments
        : null,
    chargesCompleted: progress.chargesCompleted,
    chargesTotal: charges.length,
    totalAmountCents: request.priceCents,
    currency: request.currency,
    updatedAt: now,
  } as const;

  let projectId = request.projectId;
  if (projectId) {
    const [updated] = await db
      .update(projects)
      // Pre-0025 requests can outlive their product. In that legacy case the
      // attached project's existing credit is better evidence than a guessed
      // one-session fallback, so leave sessionCount untouched.
      .set({
        ...financialSnapshot,
        ...(recoveredSessionCount === null ? {} : { sessionCount: recoveredSessionCount }),
      })
      .where(and(eq(projects.id, projectId), eq(projects.producerId, request.producerId)))
      .returning({ id: projects.id });
    if (!updated) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "The paid purchase could not be linked to its project.",
      });
    }
  } else {
    const [created] = await db
      .insert(projects)
      .values({
        producerId: request.producerId,
        title: request.productNameSnapshot,
        stage: "booked",
        artistName: request.artistName,
        artistEmail: request.artistEmail.trim().toLowerCase(),
        clientName: request.artistName,
        clientEmail: request.artistEmail.trim().toLowerCase(),
        // A brand-new legacy project has no prior credit to preserve. Keep the
        // documented one-session fallback only for this creation path.
        sessionCount: recoveredSessionCount ?? 1,
        ...financialSnapshot,
      })
      .returning({ id: projects.id });
    if (!created) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "The paid purchase could not create its booking project.",
      });
    }
    projectId = created.id;
  }

  await db
    .update(purchaseRequests)
    .set(
      request.status === "paid"
        ? { projectId }
        : { projectId, status: "paid", statusChangedAt: now },
    )
    .where(
      and(eq(purchaseRequests.id, request.id), eq(purchaseRequests.producerId, request.producerId)),
    );
  await db
    .update(paymentProofs)
    .set({ projectId })
    .where(
      and(
        eq(paymentProofs.purchaseRequestId, request.id),
        eq(paymentProofs.producerId, request.producerId),
      ),
    );
  await db
    .update(invoices)
    .set({ projectId })
    .where(
      and(eq(invoices.purchaseRequestId, request.id), eq(invoices.producerId, request.producerId)),
    );

  return projectId;
}

async function markProofNotificationsReadQuietly(
  db: Db,
  producerId: string,
  proofId: string,
  purchaseRequestId: string,
): Promise<void> {
  try {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.producerId, producerId),
          eq(notifications.id, proofId),
          eq(notifications.purchaseRequestId, purchaseRequestId),
          eq(notifications.kind, "proof_submitted"),
          isNull(notifications.readAt),
        ),
      );
  } catch {
    // A stale bell item must never roll back a proof decision or invoice.
    console.error("[notify] proof notification refresh failed");
  }
}

async function deleteProofObjectQuietly(key: string): Promise<void> {
  try {
    await getR2().send(new DeleteObjectCommand({ Bucket: BUCKETS.docs, Key: key }));
  } catch {
    // Lifecycle rules are the final safety net for staging/orphan cleanup.
    // Never include an object key or storage error (which can contain request
    // metadata) in logs.
    console.error("[proof] object cleanup failed");
  }
}

async function assertProofObjectIntegrity(
  proof: Pick<PaymentProof, "storageKey" | "objectEtag" | "contentType" | "sizeBytes"> & {
    // Keep this runtime boundary wider than the Drizzle literal type: a
    // malformed or legacy row must still be rejected before any R2 call.
    storageBucket: string;
  },
): Promise<void> {
  if (proof.storageBucket !== "docs" || !proof.objectEtag) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This proof file needs to be uploaded again before it can be reviewed.",
    });
  }

  try {
    const object = await getR2().send(
      new HeadObjectCommand({
        Bucket: BUCKETS.docs,
        Key: proof.storageKey,
        IfMatch: proof.objectEtag,
      }),
    );
    if (
      object.ETag !== proof.objectEtag ||
      object.ContentLength !== proof.sizeBytes ||
      (object.ContentType ?? "").toLowerCase() !== proof.contentType.toLowerCase()
    ) {
      throw new Error("proof metadata mismatch");
    }
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This proof file changed or is unavailable. Ask the artist to upload it again.",
    });
  }
}

// Resolve a client plan choice into a snapshot-safe PaymentPlan. The
// milestones choice gets the PRODUCT's schedule embedded so a tampered
// payload can't invent one. Null = the product can't satisfy the choice.
function resolvePlanChoice(
  choice: PaymentPlanChoice,
  product: {
    depositModel: string;
    milestones: { label: string; pct: number }[] | null;
  },
): PaymentPlan | null {
  if (choice.kind !== "milestones") return choice;
  if (product.depositModel !== "milestones" || !product.milestones?.length) {
    return null;
  }
  return { kind: "milestones", milestones: product.milestones };
}

function planFromFrozenOptions(
  choice: PaymentPlanChoice,
  plans: PaymentPlan[],
): PaymentPlan | null {
  return (
    plans.find((plan) => {
      if (plan.kind !== choice.kind) return false;
      if (plan.kind === "monthly" && choice.kind === "monthly") {
        return plan.installments === choice.installments;
      }
      return true;
    }) ?? null
  );
}

// A purchase accepts a proof while Gate 1 has passed and money is still
// owed. Returns the charge math so callers don't recompute it.
async function assertAcceptsProof(db: Db, request: PurchaseRequest) {
  if (!PAYING_STATUSES.has(request.status)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This purchase isn't ready for a payment yet.",
    });
  }
  if (!request.paymentPlanChosenAt) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a payment plan before uploading proof.",
    });
  }
  const charges = calculateCharges(request.paymentPlanSnapshot, request.priceCents);
  const paid = await paidTotalCents(db, request.id);
  const reserved = await pendingProofTotalCents(db, request.id);
  const progress = chargesProgress(charges, paid, reserved);
  if (progress.remainingCents <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This purchase is already paid in full.",
    });
  }
  if (progress.reservedCents > 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "A payment proof is already being reviewed.",
    });
  }
  return { charges, paid, reserved, progress };
}

function frozenPlanOptions(request: PurchaseRequest): PaymentPlan[] {
  return request.paymentPlanOptionsSnapshot?.length
    ? request.paymentPlanOptionsSnapshot
    : [request.paymentPlanSnapshot];
}

function effectiveAgreementText(product: {
  agreementText: string | null;
  description: string | null;
}): string | null {
  // An explicit empty string is a deliberate clear and must not resurrect
  // encoded legacy text. Null means the row has not migrated yet.
  if (product.agreementText !== null) {
    return product.agreementText.trim().length > 0 ? product.agreementText : null;
  }
  return decodeDescription(product.description).contractText || null;
}

async function productCommercialTermsColumnsAvailable(db: Pick<Db, "execute">): Promise<boolean> {
  const result = await db.execute<{ columnCount: number }>(sql`
    select count(*)::int as "columnCount"
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'products'
      and column_name in ('royalty_terms', 'agreement_text')
  `);
  return (result.rows[0]?.columnCount ?? 0) === 2;
}

function purchaseProductColumns(includeCommercialTerms: boolean) {
  return {
    id: products.id,
    producerId: products.producerId,
    name: products.name,
    description: products.description,
    durationMin: products.durationMin,
    sessionCount: products.sessionCount,
    priceCents: products.priceCents,
    currency: products.currency,
    depositPct: products.depositPct,
    active: products.active,
    position: products.position,
    kind: products.kind,
    locationType: products.locationType,
    bufferMinutes: products.bufferMinutes,
    minLeadHours: products.minLeadHours,
    pricingModel: products.pricingModel,
    volumeTiers: products.volumeTiers,
    hourlyRateCents: products.hourlyRateCents,
    deliverables: products.deliverables,
    depositModel: products.depositModel,
    milestones: products.milestones,
    archivedAt: products.archivedAt,
    paymentPlans: products.paymentPlans,
    contractUrl: products.contractUrl,
    createdAt: products.createdAt,
    ...(includeCommercialTerms
      ? {
          royaltyTerms: products.royaltyTerms,
          agreementText: products.agreementText,
        }
      : {}),
  } as const;
}

// Load a private proof the signed-in producer owns. Keep ownership predicates
// in SQL so a foreign proof id is indistinguishable from a missing one, and
// load the purchase through the schema-aware helper so a 0023-only database
// never names the commercial-term columns introduced by migration 0024.
async function loadProducerProof(db: Db, producerId: string, proofId: string) {
  const [row] = await db
    .select({
      proof: paymentProofs,
      producerName: producers.displayName,
    })
    .from(paymentProofs)
    .innerJoin(purchaseRequests, eq(purchaseRequests.id, paymentProofs.purchaseRequestId))
    .innerJoin(producers, eq(producers.id, paymentProofs.producerId))
    .where(
      and(
        eq(paymentProofs.id, proofId),
        eq(paymentProofs.producerId, producerId),
        eq(purchaseRequests.producerId, producerId),
      ),
    )
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  const request = await loadPurchaseRequestRow(db, row.proof.purchaseRequestId, true, producerId);
  if (!request) throw new TRPCError({ code: "NOT_FOUND" });
  return { ...row, request };
}

export async function listPendingProducerProofs(
  db: Db,
  producerId: string,
  purchaseRequestId?: string,
) {
  if (!(await paymentProofsTableAvailable(db))) {
    return { available: false as const, proofs: [] };
  }

  if (purchaseRequestId) {
    const [ownedRequest] = await db
      .select({ id: purchaseRequests.id })
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.id, purchaseRequestId),
          eq(purchaseRequests.producerId, producerId),
        ),
      )
      .limit(1);
    if (!ownedRequest) throw new TRPCError({ code: "NOT_FOUND" });
  }

  const filters = [
    eq(paymentProofs.producerId, producerId),
    eq(purchaseRequests.producerId, producerId),
    eq(paymentProofs.status, "pending"),
  ];
  if (purchaseRequestId) {
    filters.push(eq(paymentProofs.purchaseRequestId, purchaseRequestId));
    filters.push(eq(purchaseRequests.id, purchaseRequestId));
  }
  const rows = await db
    .select({
      proofId: paymentProofs.id,
      amountCents: paymentProofs.amountCents,
      currency: paymentProofs.currency,
      originalFileName: paymentProofs.originalFileName,
      contentType: paymentProofs.contentType,
      sizeBytes: paymentProofs.sizeBytes,
      proofNote: paymentProofs.note,
      createdAt: paymentProofs.createdAt,
      purchaseRequestId: purchaseRequests.id,
      refNumber: purchaseRequests.refNumber,
      artistName: purchaseRequests.artistName,
      productNameSnapshot: purchaseRequests.productNameSnapshot,
      totalCents: purchaseRequests.priceCents,
    })
    .from(paymentProofs)
    .innerJoin(purchaseRequests, eq(purchaseRequests.id, paymentProofs.purchaseRequestId))
    .where(and(...filters))
    .orderBy(desc(paymentProofs.createdAt));
  return { available: true as const, proofs: rows };
}

// Migration 0023 adds the explicit post-approval plan-choice fields. Preview
// deployments intentionally run against the still-pre-0023 database during
// the production cutover, so every Gate-1 read must avoid naming those
// columns until they exist. The explicit base selection works on both schemas;
// migrated databases still load the two new fields through the full selection.
type LegacyPurchaseRequest = Omit<
  PurchaseRequest,
  | "paymentPlanOptionsSnapshot"
  | "paymentPlanChosenAt"
  | "royaltyTermsSnapshot"
  | "agreementTextSnapshot"
  | "sessionCountSnapshot"
>;

type PreCommercialTermsPurchaseRequest = Omit<
  PurchaseRequest,
  "royaltyTermsSnapshot" | "agreementTextSnapshot" | "sessionCountSnapshot"
>;

type PreSessionCountPurchaseRequest = Omit<PurchaseRequest, "sessionCountSnapshot">;

function legacyPurchaseRequestColumns() {
  return {
    id: purchaseRequests.id,
    producerId: purchaseRequests.producerId,
    clientContactId: purchaseRequests.clientContactId,
    productId: purchaseRequests.productId,
    projectId: purchaseRequests.projectId,
    bookingId: purchaseRequests.bookingId,
    refNumber: purchaseRequests.refNumber,
    status: purchaseRequests.status,
    statusChangedAt: purchaseRequests.statusChangedAt,
    approvedAt: purchaseRequests.approvedAt,
    declinedAt: purchaseRequests.declinedAt,
    artistName: purchaseRequests.artistName,
    artistEmail: purchaseRequests.artistEmail,
    productNameSnapshot: purchaseRequests.productNameSnapshot,
    priceCents: purchaseRequests.priceCents,
    currency: purchaseRequests.currency,
    paymentPlanSnapshot: purchaseRequests.paymentPlanSnapshot,
    songQty: purchaseRequests.songQty,
    unitPriceCents: purchaseRequests.unitPriceCents,
    contractUrlSnapshot: purchaseRequests.contractUrlSnapshot,
    createdAt: purchaseRequests.createdAt,
  } as const;
}

function preCommercialTermsPurchaseRequestColumns() {
  return {
    ...legacyPurchaseRequestColumns(),
    paymentPlanOptionsSnapshot: purchaseRequests.paymentPlanOptionsSnapshot,
    paymentPlanChosenAt: purchaseRequests.paymentPlanChosenAt,
  } as const;
}

function preSessionCountPurchaseRequestColumns() {
  return {
    ...preCommercialTermsPurchaseRequestColumns(),
    royaltyTermsSnapshot: purchaseRequests.royaltyTermsSnapshot,
    agreementTextSnapshot: purchaseRequests.agreementTextSnapshot,
  } as const;
}

async function purchasePlanColumnsAvailable(db: Pick<Db, "execute">): Promise<boolean> {
  const result = await db.execute<{ columnCount: number }>(sql`
    select count(*)::int as "columnCount"
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'purchase_requests'
      and column_name in ('payment_plan_options_snapshot', 'payment_plan_chosen_at')
  `);
  return (result.rows[0]?.columnCount ?? 0) === 2;
}

async function purchaseCommercialTermsColumnsAvailable(db: Pick<Db, "execute">): Promise<boolean> {
  const result = await db.execute<{ columnCount: number }>(sql`
    select count(*)::int as "columnCount"
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'purchase_requests'
      and column_name in ('royalty_terms_snapshot', 'agreement_text_snapshot')
  `);
  return (result.rows[0]?.columnCount ?? 0) === 2;
}

async function purchaseSessionCountSnapshotColumnAvailable(
  db: Pick<Db, "execute">,
): Promise<boolean> {
  const result = await db.execute<{ columnCount: number }>(sql`
    select count(*)::int as "columnCount"
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'purchase_requests'
      and column_name = 'session_count_snapshot'
  `);
  return (result.rows[0]?.columnCount ?? 0) === 1;
}

async function paymentProofsTableAvailable(db: Pick<Db, "execute">): Promise<boolean> {
  const result = await db.execute<{ tableCount: number }>(sql`
    select count(*)::int as "tableCount"
    from information_schema.tables
    where table_schema = current_schema()
      and table_name = 'payment_proofs'
  `);
  return (result.rows[0]?.tableCount ?? 0) === 1;
}

async function assertPaymentProofsTableAvailable(db: Pick<Db, "execute">): Promise<void> {
  if (await paymentProofsTableAvailable(db)) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "Payment proof upload isn't available in this environment yet.",
  });
}

function withLegacyPlanFields(request: LegacyPurchaseRequest): PurchaseRequest {
  return {
    ...request,
    paymentPlanOptionsSnapshot: null,
    paymentPlanChosenAt: null,
    royaltyTermsSnapshot: null,
    agreementTextSnapshot: null,
    sessionCountSnapshot: null,
  };
}

function withLegacyCommercialTermsFields(
  request: PreCommercialTermsPurchaseRequest,
): PurchaseRequest {
  return {
    ...request,
    royaltyTermsSnapshot: null,
    agreementTextSnapshot: null,
    sessionCountSnapshot: null,
  };
}

function withLegacySessionCountField(request: PreSessionCountPurchaseRequest): PurchaseRequest {
  return { ...request, sessionCountSnapshot: null };
}

export async function loadPurchaseRequestRow(
  db: Pick<Db, "execute" | "select">,
  id: string,
  knownPlanColumnsAvailable?: boolean,
  producerId?: string,
): Promise<PurchaseRequest | undefined> {
  const hasPlanColumns = knownPlanColumnsAvailable ?? (await purchasePlanColumnsAvailable(db));
  const hasCommercialTermsColumns =
    hasPlanColumns && (await purchaseCommercialTermsColumnsAvailable(db));
  const hasSessionCountSnapshotColumn =
    hasCommercialTermsColumns && (await purchaseSessionCountSnapshotColumnAvailable(db));
  const ownerFilter = producerId
    ? and(eq(purchaseRequests.id, id), eq(purchaseRequests.producerId, producerId))
    : eq(purchaseRequests.id, id);
  if (hasPlanColumns && hasCommercialTermsColumns && hasSessionCountSnapshotColumn) {
    const [request] = await db.select().from(purchaseRequests).where(ownerFilter).limit(1);
    return request;
  }

  if (hasPlanColumns && hasCommercialTermsColumns) {
    const [request] = await db
      .select(preSessionCountPurchaseRequestColumns())
      .from(purchaseRequests)
      .where(ownerFilter)
      .limit(1);
    return request ? withLegacySessionCountField(request) : undefined;
  }

  if (hasPlanColumns) {
    const [request] = await db
      .select(preCommercialTermsPurchaseRequestColumns())
      .from(purchaseRequests)
      .where(ownerFilter)
      .limit(1);
    return request ? withLegacyCommercialTermsFields(request) : undefined;
  }

  const [request] = await db
    .select(legacyPurchaseRequestColumns())
    .from(purchaseRequests)
    .where(ownerFilter)
    .limit(1);
  return request ? withLegacyPlanFields(request) : undefined;
}

// Insert a purchase request, retrying with a fresh ref_number on the
// (astronomically unlikely) UNIQUE clash. ON CONFLICT avoids aborting the
// surrounding PostgreSQL transaction, which a caught 23505 would do.
export async function insertPurchaseRequest(
  db: Pick<Db, "execute" | "insert">,
  values: Omit<typeof purchaseRequests.$inferInsert, "refNumber">,
): Promise<PurchaseRequest> {
  const hasPlanColumns = await purchasePlanColumnsAvailable(db);
  const hasCommercialTermsColumns =
    hasPlanColumns && (await purchaseCommercialTermsColumnsAvailable(db));
  const hasSessionCountSnapshotColumn =
    hasCommercialTermsColumns && (await purchaseSessionCountSnapshotColumnAvailable(db));
  for (let attempt = 0; attempt < 5; attempt++) {
    const refNumber = generateRefNumber();
    if (hasPlanColumns && hasCommercialTermsColumns && hasSessionCountSnapshotColumn) {
      const [row] = await db
        .insert(purchaseRequests)
        .values({ ...values, refNumber })
        .onConflictDoNothing({ target: purchaseRequests.refNumber })
        .returning();
      if (row) return row;
    } else if (hasPlanColumns && hasCommercialTermsColumns) {
      // Migration 0024 can be live briefly before 0025. Use the exact 0024
      // shape so a rolling code deploy never names session_count_snapshot
      // before the migration adds it.
      const result = await db.execute<PreSessionCountPurchaseRequest>(sql`
        insert into "public"."purchase_requests" (
          "producer_id",
          "client_contact_id",
          "product_id",
          "project_id",
          "booking_id",
          "ref_number",
          "status",
          "status_changed_at",
          "approved_at",
          "declined_at",
          "artist_name",
          "artist_email",
          "product_name_snapshot",
          "price_cents",
          "currency",
          "payment_plan_snapshot",
          "song_qty",
          "unit_price_cents",
          "contract_url_snapshot",
          "payment_plan_options_snapshot",
          "payment_plan_chosen_at",
          "royalty_terms_snapshot",
          "agreement_text_snapshot"
        ) values (
          ${values.producerId},
          ${values.clientContactId},
          ${values.productId ?? null},
          ${values.projectId ?? null},
          ${values.bookingId ?? null},
          ${refNumber},
          ${values.status ?? "pending"}::"public"."purchase_request_status",
          ${values.statusChangedAt ?? null},
          ${values.approvedAt ?? null},
          ${values.declinedAt ?? null},
          ${values.artistName},
          ${values.artistEmail},
          ${values.productNameSnapshot},
          ${values.priceCents},
          ${values.currency},
          ${JSON.stringify(values.paymentPlanSnapshot)}::jsonb,
          ${values.songQty ?? null},
          ${values.unitPriceCents ?? null},
          ${values.contractUrlSnapshot ?? null},
          ${JSON.stringify(values.paymentPlanOptionsSnapshot ?? null)}::jsonb,
          ${values.paymentPlanChosenAt ?? null},
          ${JSON.stringify(values.royaltyTermsSnapshot ?? null)}::jsonb,
          ${values.agreementTextSnapshot ?? null}
        )
        on conflict ("ref_number") do nothing
        returning
          "id" as "id",
          "producer_id" as "producerId",
          "client_contact_id" as "clientContactId",
          "product_id" as "productId",
          "project_id" as "projectId",
          "booking_id" as "bookingId",
          "ref_number" as "refNumber",
          "status" as "status",
          "status_changed_at" as "statusChangedAt",
          "approved_at" as "approvedAt",
          "declined_at" as "declinedAt",
          "artist_name" as "artistName",
          "artist_email" as "artistEmail",
          "product_name_snapshot" as "productNameSnapshot",
          "price_cents" as "priceCents",
          "currency" as "currency",
          "payment_plan_snapshot" as "paymentPlanSnapshot",
          "song_qty" as "songQty",
          "unit_price_cents" as "unitPriceCents",
          "contract_url_snapshot" as "contractUrlSnapshot",
          "payment_plan_options_snapshot" as "paymentPlanOptionsSnapshot",
          "payment_plan_chosen_at" as "paymentPlanChosenAt",
          "royalty_terms_snapshot" as "royaltyTermsSnapshot",
          "agreement_text_snapshot" as "agreementTextSnapshot",
          "created_at" as "createdAt"
      `);
      const row = result.rows[0];
      if (row) return withLegacySessionCountField(row);
    } else if (hasPlanColumns) {
      // Migration 0023 can exist briefly before 0024. Keep the insert on the
      // exact 0023 shape so the current Drizzle schema never names 0024's
      // commercial-term snapshot columns until they are present.
      const result = await db.execute<PreCommercialTermsPurchaseRequest>(sql`
        insert into "public"."purchase_requests" (
          "producer_id",
          "client_contact_id",
          "product_id",
          "project_id",
          "booking_id",
          "ref_number",
          "status",
          "status_changed_at",
          "approved_at",
          "declined_at",
          "artist_name",
          "artist_email",
          "product_name_snapshot",
          "price_cents",
          "currency",
          "payment_plan_snapshot",
          "song_qty",
          "unit_price_cents",
          "contract_url_snapshot",
          "payment_plan_options_snapshot",
          "payment_plan_chosen_at"
        ) values (
          ${values.producerId},
          ${values.clientContactId},
          ${values.productId ?? null},
          ${values.projectId ?? null},
          ${values.bookingId ?? null},
          ${refNumber},
          ${values.status ?? "pending"}::"public"."purchase_request_status",
          ${values.statusChangedAt ?? null},
          ${values.approvedAt ?? null},
          ${values.declinedAt ?? null},
          ${values.artistName},
          ${values.artistEmail},
          ${values.productNameSnapshot},
          ${values.priceCents},
          ${values.currency},
          ${JSON.stringify(values.paymentPlanSnapshot)}::jsonb,
          ${values.songQty ?? null},
          ${values.unitPriceCents ?? null},
          ${values.contractUrlSnapshot ?? null},
          ${JSON.stringify(values.paymentPlanOptionsSnapshot ?? null)}::jsonb,
          ${values.paymentPlanChosenAt ?? null}
        )
        on conflict ("ref_number") do nothing
        returning
          "id" as "id",
          "producer_id" as "producerId",
          "client_contact_id" as "clientContactId",
          "product_id" as "productId",
          "project_id" as "projectId",
          "booking_id" as "bookingId",
          "ref_number" as "refNumber",
          "status" as "status",
          "status_changed_at" as "statusChangedAt",
          "approved_at" as "approvedAt",
          "declined_at" as "declinedAt",
          "artist_name" as "artistName",
          "artist_email" as "artistEmail",
          "product_name_snapshot" as "productNameSnapshot",
          "price_cents" as "priceCents",
          "currency" as "currency",
          "payment_plan_snapshot" as "paymentPlanSnapshot",
          "song_qty" as "songQty",
          "unit_price_cents" as "unitPriceCents",
          "contract_url_snapshot" as "contractUrlSnapshot",
          "payment_plan_options_snapshot" as "paymentPlanOptionsSnapshot",
          "payment_plan_chosen_at" as "paymentPlanChosenAt",
          "created_at" as "createdAt"
      `);
      const row = result.rows[0];
      if (row) return withLegacyCommercialTermsFields(row);
    } else {
      // Drizzle's INSERT builder enumerates every column in the current
      // TypeScript schema even when a value key is omitted (the missing value
      // becomes DEFAULT). That still names migration-0023 columns and makes a
      // pre-0023 database reject a brand-new request. Use the exact 0021 table
      // shape here so the fallback is a real compatibility path, not only a
      // legacy RETURNING projection.
      const result = await db.execute<LegacyPurchaseRequest>(sql`
        insert into "public"."purchase_requests" (
          "producer_id",
          "client_contact_id",
          "product_id",
          "project_id",
          "booking_id",
          "ref_number",
          "status",
          "status_changed_at",
          "approved_at",
          "declined_at",
          "artist_name",
          "artist_email",
          "product_name_snapshot",
          "price_cents",
          "currency",
          "payment_plan_snapshot",
          "song_qty",
          "unit_price_cents",
          "contract_url_snapshot"
        ) values (
          ${values.producerId},
          ${values.clientContactId},
          ${values.productId ?? null},
          ${values.projectId ?? null},
          ${values.bookingId ?? null},
          ${refNumber},
          ${values.status ?? "pending"}::"public"."purchase_request_status",
          ${values.statusChangedAt ?? null},
          ${values.approvedAt ?? null},
          ${values.declinedAt ?? null},
          ${values.artistName},
          ${values.artistEmail},
          ${values.productNameSnapshot},
          ${values.priceCents},
          ${values.currency},
          ${JSON.stringify(values.paymentPlanSnapshot)}::jsonb,
          ${values.songQty ?? null},
          ${values.unitPriceCents ?? null},
          ${values.contractUrlSnapshot ?? null}
        )
        on conflict ("ref_number") do nothing
        returning
          "id" as "id",
          "producer_id" as "producerId",
          "client_contact_id" as "clientContactId",
          "product_id" as "productId",
          "project_id" as "projectId",
          "booking_id" as "bookingId",
          "ref_number" as "refNumber",
          "status" as "status",
          "status_changed_at" as "statusChangedAt",
          "approved_at" as "approvedAt",
          "declined_at" as "declinedAt",
          "artist_name" as "artistName",
          "artist_email" as "artistEmail",
          "product_name_snapshot" as "productNameSnapshot",
          "price_cents" as "priceCents",
          "currency" as "currency",
          "payment_plan_snapshot" as "paymentPlanSnapshot",
          "song_qty" as "songQty",
          "unit_price_cents" as "unitPriceCents",
          "contract_url_snapshot" as "contractUrlSnapshot",
          "created_at" as "createdAt"
      `);
      const row = result.rows[0];
      if (row) return withLegacyPlanFields(row);
    }
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Couldn't create a unique purchase reference. Try again.",
  });
}

// Load a request the signed-in ARTIST owns. NOT_FOUND on any miss
// (request absent OR not this artist's) so we never leak existence.
async function resolveOwnedRequest(
  db: Db,
  clerkUserId: string,
  purchaseRequestId: string,
): Promise<PurchaseRequest> {
  const request = await loadPurchaseRequestRow(db, purchaseRequestId);
  if (!request) throw new TRPCError({ code: "NOT_FOUND" });

  const [contact] = await db
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.id, request.clientContactId),
        eq(clientContacts.clerkUserId, clerkUserId),
        eq(clientContacts.producerId, request.producerId),
        isNull(clientContacts.archivedAt),
      ),
    )
    .limit(1);
  if (!contact) throw new TRPCError({ code: "NOT_FOUND" });
  return request;
}

// Load a request the signed-in PRODUCER owns, plus their display name
// for outgoing emails. Scope in SQL so cross-tenant ids are never exposed.
async function loadProducerRequest(
  db: Pick<Db, "execute" | "select">,
  producerId: string,
  id: string,
): Promise<PurchaseRequest & { producerName: string | null }> {
  const request = await loadPurchaseRequestRow(db, id, undefined, producerId);
  if (!request) throw new TRPCError({ code: "NOT_FOUND" });
  const [producer] = await db
    .select({ producerName: producers.displayName })
    .from(producers)
    .where(eq(producers.id, producerId))
    .limit(1);
  return { ...request, producerName: producer?.producerName ?? null };
}

// Frozen-contract stub. BE-2/3/4 replace the body; the typed input +
// annotated return shape are stable so the Screens track can build now.
function notImplemented(slice: string): never {
  throw new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: `${slice} — frozen contract stub, lands in a later backend slice`,
  });
}

// ─── artist.purchase ────────────────────────────────────────────────
export const artistPurchaseRouter = router({
  // Create a purchase request. Price LOCKS here (snapshot of product +
  // chosen plan + contract); no payment is taken. While a request is
  // pending with this studio the artist can't start a second one
  // (additional sessions on a live product are a separate flow — BE-3).
  request: artistProcedure
    .input(
      z.object({
        productId: z.string().uuid(),
        paymentPlan: PAYMENT_PLAN_INPUT,
        agreementAccepted: z.literal(true),
        commercialTermsFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        // Required for per_song products; ignored otherwise. The unit
        // price is re-validated against the volume-tier ladder so a
        // tampered payload can't lock an unauthorised rate.
        songQty: z.number().int().min(1).max(1000).optional(),
        unitPriceCents: z.number().int().min(0).max(100_000_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Load product (live + sellable). NOT_FOUND if missing/archived.
      const hasCommercialTermsColumns = await productCommercialTermsColumnsAvailable(ctx.db);
      const [productRow] = await ctx.db
        .select(purchaseProductColumns(hasCommercialTermsColumns))
        .from(products)
        .where(
          and(
            eq(products.id, input.productId),
            eq(products.active, true),
            isNull(products.archivedAt),
          ),
        )
        .limit(1);
      if (!productRow) throw new TRPCError({ code: "NOT_FOUND" });
      const prod: Product = {
        ...productRow,
        royaltyTerms: "royaltyTerms" in productRow ? (productRow.royaltyTerms ?? null) : null,
        agreementText: "agreementText" in productRow ? (productRow.agreementText ?? null) : null,
      };

      const agreementTextSnapshot = effectiveAgreementText(prod);
      const paymentPlanOptionsSnapshot = offeredPlans(prod);
      // Legacy rows may contain a non-web scheme from before agreement URL
      // validation existed. Only freeze the same HTTP(S) reference the artist
      // was actually shown on the review screen.
      const contractUrlSnapshot = safeAgreementUrl(prod.contractUrl);
      const currentTermsFingerprint = commercialTermsFingerprint({
        productName: prod.name,
        priceCents: prod.priceCents,
        currency: prod.currency,
        paymentPlans: paymentPlanOptionsSnapshot,
        royaltyTerms: prod.royaltyTerms ?? null,
        agreementText: agreementTextSnapshot,
        contractUrl: contractUrlSnapshot,
      });
      if (input.commercialTermsFingerprint !== currentTermsFingerprint) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "These product terms changed. Refresh and review them again before sending.",
        });
      }

      // 2. Resolve the artist's contact under this producer (identity
      //    snapshot + the "my studio" access gate). NOT_FOUND on miss.
      const [contact] = await ctx.db
        .select({
          id: clientContacts.id,
          email: clientContacts.email,
          name: clientContacts.name,
        })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.clerkUserId, ctx.clerkUserId),
            eq(clientContacts.producerId, prod.producerId),
            isNull(clientContacts.archivedAt),
          ),
        )
        .limit(1);
      if (!contact) throw new TRPCError({ code: "NOT_FOUND" });

      // 3. The chosen plan must be one the product offers. The snapshot
      //    embeds the product's milestone schedule for that plan kind —
      //    this is PROVISIONAL: decision 3 (2026-07-05) moves the real
      //    choice to S7 post-approval via paymentPlan.choose.
      if (!planIsOffered(input.paymentPlan, paymentPlanOptionsSnapshot)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That payment plan isn't offered for this product.",
        });
      }
      const snapshotPlan = resolvePlanChoice(input.paymentPlan, prod);
      if (!snapshotPlan) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That payment plan isn't offered for this product.",
        });
      }

      // 4. Price-lock snapshot — covers all four pricing models.
      let priceCents: number;
      let songQty: number | null;
      let unitPriceCents: number | null;
      if (prod.pricingModel === "per_song") {
        const v = validatePerSongUnit(prod, input.songQty, input.unitPriceCents);
        if (!v.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Per-song products need a valid song count — pick one and try again.",
          });
        }
        const snap = snapshotProductPrice(prod, {
          songQty: v.songQty,
          unitPriceCents: v.unitPriceCents,
        });
        priceCents = snap.priceCents;
        songQty = snap.songQty;
        unitPriceCents = snap.unitPriceCents;
      } else {
        const snap = snapshotProductPrice(prod, {});
        priceCents = snap.priceCents;
        songQty = snap.songQty;
        unitPriceCents = snap.unitPriceCents;
      }
      if (priceCents <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This product isn't available for purchase yet — contact the producer directly.",
        });
      }

      // 5. Serialize the artist/studio slot. The advisory lock closes the
      //    double-click race that a SELECT followed by INSERT cannot close.
      //    A partially-paid row remains blocking until paid invoices reach
      //    the full price snapshot.
      const inserted = await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${contact.id}, 0))`);

        const candidates = await tx
          .select({
            id: purchaseRequests.id,
            status: purchaseRequests.status,
            priceCents: purchaseRequests.priceCents,
          })
          .from(purchaseRequests)
          .where(
            and(
              eq(purchaseRequests.clientContactId, contact.id),
              inArray(purchaseRequests.status, [...BLOCKING_CANDIDATE_STATUSES]),
            ),
          );

        const paidCandidateIds = candidates
          .filter((candidate) => candidate.status === "paid")
          .map((candidate) => candidate.id);
        const paidRows =
          paidCandidateIds.length > 0
            ? await tx
                .select({
                  purchaseRequestId: invoices.purchaseRequestId,
                  amountCents: invoices.amountCents,
                })
                .from(invoices)
                .where(
                  and(
                    inArray(invoices.purchaseRequestId, paidCandidateIds),
                    eq(invoices.status, "paid"),
                  ),
                )
            : [];
        const paidByRequest = new Map<string, number>();
        for (const row of paidRows) {
          if (!row.purchaseRequestId) continue;
          paidByRequest.set(
            row.purchaseRequestId,
            (paidByRequest.get(row.purchaseRequestId) ?? 0) + row.amountCents,
          );
        }

        for (const candidate of candidates) {
          let blocks = candidate.status !== "paid";
          if (candidate.status === "paid") {
            const paidCents = paidByRequest.get(candidate.id) ?? 0;
            blocks = paidCents < candidate.priceCents;
          }
          if (blocks) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "You already have an active purchase with this studio. Finish paying it before starting another.",
            });
          }
        }

        // 6. Price, agreement URL, chosen plan, and every offered plan are
        //    frozen in the same transaction as the acceptance record.
        const request = await insertPurchaseRequest(tx, {
          producerId: prod.producerId,
          clientContactId: contact.id,
          productId: prod.id,
          status: "pending",
          artistName: contact.name,
          artistEmail: contact.email,
          productNameSnapshot: prod.name,
          priceCents,
          currency: prod.currency,
          paymentPlanSnapshot: snapshotPlan,
          paymentPlanOptionsSnapshot,
          sessionCountSnapshot: computeProjectSessionCount(prod, songQty),
          songQty,
          unitPriceCents,
          contractUrlSnapshot,
          royaltyTermsSnapshot: prod.royaltyTerms ?? null,
          agreementTextSnapshot,
        });
        await tx.insert(agreementAcceptances).values({
          purchaseRequestId: request.id,
          producerId: request.producerId,
          clientContactId: request.clientContactId,
          acceptedByClerkUserId: ctx.clerkUserId,
          agreementUrl: request.contractUrlSnapshot ?? null,
        });
        return request;
      });

      // 7. Notify the producer (in-app inbox). Fire-and-forget.
      try {
        await emitPurchaseRequested(ctx.db, {
          producerId: prod.producerId,
          purchaseRequestId: inserted.id,
          artistName: contact.name,
          artistEmail: contact.email,
          productName: prod.name,
          refNumber: inserted.refNumber,
        });
      } catch (err) {
        console.error("[notify] purchase-requested failed", err);
      }

      return {
        purchaseRequestId: inserted.id,
        refNumber: inserted.refNumber,
        status: "pending" as const,
        priceCents: inserted.priceCents,
        currency: inserted.currency,
      };
    }),

  // Accept the producer's agreement (inline checkbox). Only valid once
  // the request is approved (Gate 1 passed). Idempotent.
  acceptAgreement: artistProcedure
    .input(z.object({ purchaseRequestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
      if (request.status !== "approved") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This request hasn't been approved yet.",
        });
      }

      const [existing] = await ctx.db
        .select()
        .from(agreementAcceptances)
        .where(eq(agreementAcceptances.purchaseRequestId, request.id))
        .limit(1);
      if (existing) {
        return {
          ok: true as const,
          agreementAcceptanceId: existing.id,
          acceptedAt: existing.acceptedAt,
        };
      }

      let accept: typeof agreementAcceptances.$inferSelect;
      try {
        const [row] = await ctx.db
          .insert(agreementAcceptances)
          .values({
            purchaseRequestId: request.id,
            producerId: request.producerId,
            clientContactId: request.clientContactId,
            acceptedByClerkUserId: ctx.clerkUserId,
            agreementUrl: request.contractUrlSnapshot ?? null,
          })
          .returning();
        if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        accept = row;
      } catch (err) {
        // Concurrent accept lost the race on the UNIQUE(request) index —
        // re-read the winner and return it idempotently.
        if (isUniqueViolation(err)) {
          const [winner] = await ctx.db
            .select()
            .from(agreementAcceptances)
            .where(eq(agreementAcceptances.purchaseRequestId, request.id))
            .limit(1);
          if (winner) {
            return {
              ok: true as const,
              agreementAcceptanceId: winner.id,
              acceptedAt: winner.acceptedAt,
            };
          }
        }
        throw err;
      }

      try {
        await emitAgreementAccepted(ctx.db, {
          producerId: request.producerId,
          purchaseRequestId: request.id,
          artistName: request.artistName,
          productName: request.productNameSnapshot,
          refNumber: request.refNumber,
        });
      } catch (err) {
        console.error("[notify] agreement-accepted failed", err);
      }

      return {
        ok: true as const,
        agreementAcceptanceId: accept.id,
        acceptedAt: accept.acceptedAt,
      };
    }),

  // Single-request read for the artist's purchase-status surfaces.
  get: artistProcedure
    .input(z.object({ purchaseRequestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
      const [accept] = await ctx.db
        .select({ id: agreementAcceptances.id })
        .from(agreementAcceptances)
        .where(eq(agreementAcceptances.purchaseRequestId, request.id))
        .limit(1);
      return {
        id: request.id,
        refNumber: request.refNumber,
        status: request.status,
        productNameSnapshot: request.productNameSnapshot,
        priceCents: request.priceCents,
        currency: request.currency,
        paymentPlan: request.paymentPlanSnapshot,
        songQty: request.songQty,
        unitPriceCents: request.unitPriceCents,
        contractUrlSnapshot: request.contractUrlSnapshot,
        royaltyTermsSnapshot: request.royaltyTermsSnapshot,
        agreementTextSnapshot: request.agreementTextSnapshot,
        agreementAccepted: Boolean(accept),
        createdAt: request.createdAt,
      };
    }),

  // The artist's open request with one studio, if any. Read-only — the S3
  // entry screen uses this to disable "Request to book" while a request is
  // in review (Gate 1 allows one open request per studio; the `request`
  // mutation enforces it with CONFLICT, this read just surfaces it early).
  // Added by the Screens track (SK-46) following BE-1's patterns.
  pending: artistProcedure
    .input(z.object({ producerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [contact] = await ctx.db
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.clerkUserId, ctx.clerkUserId),
            eq(clientContacts.producerId, input.producerId),
            isNull(clientContacts.archivedAt),
          ),
        )
        .limit(1);
      if (!contact) return { pending: null };

      const rows = await ctx.db
        .select({
          id: purchaseRequests.id,
          producerId: purchaseRequests.producerId,
          refNumber: purchaseRequests.refNumber,
          productId: purchaseRequests.productId,
          projectId: purchaseRequests.projectId,
          status: purchaseRequests.status,
          priceCents: purchaseRequests.priceCents,
          createdAt: purchaseRequests.createdAt,
        })
        .from(purchaseRequests)
        .where(
          and(
            eq(purchaseRequests.clientContactId, contact.id),
            inArray(purchaseRequests.status, [...BLOCKING_CANDIDATE_STATUSES]),
          ),
        )
        .orderBy(desc(purchaseRequests.createdAt));

      for (const row of rows) {
        if (row.status !== "paid") return { pending: row };
        const paidCents = await paidTotalCents(ctx.db, row.id);
        if (paidCents < row.priceCents) return { pending: row };
      }
      return { pending: null };
    }),

  // The home heartbeat's read (S6, W2.4): the artist's LATEST request
  // with this studio in ANY state the card renders — open money-loop
  // states always; 'paid' for 30 days after its last transition (the
  // book-your-session nudge); 'declined' for 7 days (the generic
  // couldn't-confirm state). Older terminal rows fall off the card.
  current: artistProcedure
    .input(z.object({ producerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [contact] = await ctx.db
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.clerkUserId, ctx.clerkUserId),
            eq(clientContacts.producerId, input.producerId),
            isNull(clientContacts.archivedAt),
          ),
        )
        .limit(1);
      if (!contact) return { current: null };

      const [row] = await ctx.db
        .select({
          id: purchaseRequests.id,
          producerId: purchaseRequests.producerId,
          refNumber: purchaseRequests.refNumber,
          productId: purchaseRequests.productId,
          projectId: purchaseRequests.projectId,
          status: purchaseRequests.status,
          productNameSnapshot: purchaseRequests.productNameSnapshot,
          priceCents: purchaseRequests.priceCents,
          currency: purchaseRequests.currency,
          statusChangedAt: purchaseRequests.statusChangedAt,
          createdAt: purchaseRequests.createdAt,
        })
        .from(purchaseRequests)
        .where(eq(purchaseRequests.clientContactId, contact.id))
        .orderBy(desc(purchaseRequests.createdAt))
        .limit(1);
      if (!row) return { current: null };

      const anchor = row.statusChangedAt ?? row.createdAt;
      const ageMs = Date.now() - anchor.getTime();
      const DAY = 24 * 60 * 60 * 1000;
      const paidCents = await paidTotalCents(ctx.db, row.id);
      const paidInFull = paidCents >= row.priceCents;
      const visible =
        ["pending", "approved", "verifying"].includes(row.status) ||
        (row.status === "paid" && (!paidInFull || ageMs <= 30 * DAY)) ||
        (row.status === "declined" && ageMs <= 7 * DAY);
      if (!visible) return { current: null };
      const hasProofTable = await paymentProofsTableAvailable(ctx.db);
      const pendingProofCents = hasProofTable ? await pendingProofTotalCents(ctx.db, row.id) : 0;
      return {
        current: {
          ...row,
          paidCents,
          pendingProofCents,
          remainingCents: Math.max(0, row.priceCents - paidCents),
          paidInFull,
        },
      };
    }),

  // ── BE-2 — payment plans (S7) ──────────────────────────────────────
  paymentPlan: router({
    // Frozen-contract shape: the CURRENT snapshot plan's charge math and
    // progress against confirmed invoices.
    preview: artistProcedure
      .input(z.object({ purchaseRequestId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
        const plan = request.paymentPlanSnapshot;
        const charges = calculateCharges(plan, request.priceCents);
        const paid = await paidTotalCents(ctx.db, request.id);
        const progress = chargesProgress(charges, paid);
        return {
          kind: plan.kind,
          totalCents: request.priceCents,
          currency: request.currency,
          charges,
          chargesTotal: charges.length,
          chargesCompleted: progress.chargesCompleted,
        };
      }),

    // Every plan offered at REQUEST TIME, priced against the locked total.
    // Never read the live product here: the artist agreed to this snapshot.
    options: artistProcedure
      .input(z.object({ purchaseRequestId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
        const offered = frozenPlanOptions(request);
        const [producer] = await ctx.db
          .select({ displayName: producers.displayName })
          .from(producers)
          .where(eq(producers.id, request.producerId))
          .limit(1);
        return {
          productId: request.productId,
          productName: request.productNameSnapshot,
          producerName: producer?.displayName ?? "Your producer",
          status: request.status,
          chosenPlan: request.paymentPlanSnapshot,
          chosenAt: request.paymentPlanChosenAt,
          totalCents: request.priceCents,
          currency: request.currency,
          options: buildPlanOptions(offered, request.priceCents),
        };
      }),

    // Decision 3 (2026-07-05): the artist picks the plan AFTER approval
    // (S7), before the first invoice exists — overwriting the
    // provisional snapshot taken at request time.
    choose: artistProcedure
      .input(
        z.object({
          purchaseRequestId: z.string().uuid(),
          paymentPlan: PAYMENT_PLAN_INPUT,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
        const snapshotPlan = await ctx.db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${request.id}, 0))`);
          const hasPlanColumns = await purchasePlanColumnsAvailable(tx);
          const lockedRequest = await loadPurchaseRequestRow(tx, request.id, hasPlanColumns);
          if (!lockedRequest) throw new TRPCError({ code: "NOT_FOUND" });
          if (lockedRequest.status !== "approved") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "A plan can be chosen once the request is approved and before the first payment.",
            });
          }
          const offered = frozenPlanOptions(lockedRequest);
          if (!planIsOffered(input.paymentPlan, offered)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "That payment plan isn't offered for this product.",
            });
          }
          const selectedPlan = planFromFrozenOptions(input.paymentPlan, offered);
          if (!selectedPlan) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "That payment plan isn't offered for this product.",
            });
          }
          if (lockedRequest.paymentPlanChosenAt) {
            if (
              JSON.stringify(lockedRequest.paymentPlanSnapshot) === JSON.stringify(selectedPlan)
            ) {
              return selectedPlan;
            }
            throw new TRPCError({
              code: "CONFLICT",
              message: "Your payment plan is already locked.",
            });
          }

          const [inFlightInvoice] = await tx
            .select({ id: invoices.id })
            .from(invoices)
            .where(
              and(
                eq(invoices.purchaseRequestId, lockedRequest.id),
                inArray(invoices.status, ["sent", "paid"]),
              ),
            )
            .limit(1);
          const hasProofTable = await paymentProofsTableAvailable(tx);
          const inFlightProof = hasProofTable
            ? (
                await tx
                  .select({ id: paymentProofs.id })
                  .from(paymentProofs)
                  .where(
                    and(
                      eq(paymentProofs.purchaseRequestId, lockedRequest.id),
                      eq(paymentProofs.status, "pending"),
                    ),
                  )
                  .limit(1)
              )[0]
            : undefined;
          if (inFlightInvoice || inFlightProof) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "The plan is locked — a payment is already in flight.",
            });
          }
          await tx
            .update(purchaseRequests)
            .set(
              hasPlanColumns
                ? {
                    paymentPlanSnapshot: selectedPlan,
                    paymentPlanChosenAt: new Date(),
                  }
                : { paymentPlanSnapshot: selectedPlan },
            )
            .where(eq(purchaseRequests.id, lockedRequest.id));
          return selectedPlan;
        });
        return {
          ok: true as const,
          plan: planOption(snapshotPlan, request.priceCents),
        };
      }),
  }),

  // ── BE-2 — off-app payment instructions (S8) ───────────────────────
  paymentInstructions: artistProcedure
    .input(z.object({ purchaseRequestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
      if (!PAYING_STATUSES.has(request.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This purchase isn't awaiting payment.",
        });
      }
      const hasPlanColumns = await purchasePlanColumnsAvailable(ctx.db);
      const hasProofTable = await paymentProofsTableAvailable(ctx.db);
      if (hasPlanColumns && !request.paymentPlanChosenAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose a payment plan first.",
        });
      }
      const [producer] = await ctx.db
        .select({
          displayName: producers.displayName,
          paymentDetails: producers.paymentDetails,
        })
        .from(producers)
        .where(eq(producers.id, request.producerId))
        .limit(1);
      const details = producer?.paymentDetails ?? {};
      const charges = calculateCharges(request.paymentPlanSnapshot, request.priceCents);
      const paid = await paidTotalCents(ctx.db, request.id);
      const reserved = hasProofTable ? await pendingProofTotalCents(ctx.db, request.id) : 0;
      const progress = chargesProgress(charges, paid, reserved);
      const hasDetails = [details.bankTransfer, details.bitPhone].some((v) => Boolean(v?.trim()));
      return {
        refNumber: request.refNumber,
        productId: request.productId,
        productName: request.productNameSnapshot,
        planKind: request.paymentPlanSnapshot.kind,
        planInstallments:
          request.paymentPlanSnapshot.kind === "monthly"
            ? request.paymentPlanSnapshot.installments
            : null,
        currency: request.currency,
        totalCents: request.priceCents,
        paidCents: paid,
        pendingProofCents: reserved,
        remainingCents: progress.remainingCents,
        amountDueNowCents: progress.availableToSubmitCents > 0 ? progress.nextDueCents : null,
        availableToSubmitCents: progress.availableToSubmitCents,
        producerName: producer?.displayName ?? null,
        proofUploadsAvailable: hasProofTable,
        hasDetails,
        bankTransfer: details.bankTransfer ?? null,
        bitPhone: details.bitPhone ?? null,
        note: details.note ?? null,
      };
    }),

  // ── BE-2 — proof of payment (S9, Gate 2 in) ────────────────────────
  proofOfPayment: router({
    // Everything S9 needs, derived from the locked request and the private
    // proof ledger. No storage key or public object URL leaves this query.
    state: artistProcedure
      .input(z.object({ purchaseRequestId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
        const [producer] = await ctx.db
          .select({ displayName: producers.displayName })
          .from(producers)
          .where(eq(producers.id, request.producerId))
          .limit(1);
        const hasProofTable = await paymentProofsTableAvailable(ctx.db);
        const proofs = hasProofTable
          ? await ctx.db
              .select({
                id: paymentProofs.id,
                amountCents: paymentProofs.amountCents,
                status: paymentProofs.status,
                rejectionNote: paymentProofs.rejectionNote,
                createdAt: paymentProofs.createdAt,
              })
              .from(paymentProofs)
              .where(eq(paymentProofs.purchaseRequestId, request.id))
              .orderBy(paymentProofs.createdAt)
          : [];
        const charges = calculateCharges(request.paymentPlanSnapshot, request.priceCents);
        const paid = await paidTotalCents(ctx.db, request.id);
        const reserved = proofs
          .filter((proof) => proof.status === "pending")
          .reduce((sum, proof) => sum + proof.amountCents, 0);
        const progress = chargesProgress(charges, paid, reserved);
        return {
          purchaseRequestId: request.id,
          producerId: request.producerId,
          productId: request.productId,
          projectId: request.projectId,
          productName: request.productNameSnapshot,
          producerName: producer?.displayName ?? "Your producer",
          proofUploadsAvailable: hasProofTable,
          requestStatus: request.status,
          planChosenAt: request.paymentPlanChosenAt,
          currency: request.currency,
          totalCents: request.priceCents,
          paidCents: paid,
          pendingProofCents: reserved,
          remainingCents: progress.remainingCents,
          amountDueNowCents: progress.nextDueCents ?? 0,
          availableToSubmitCents: progress.availableToSubmitCents,
          paidInFull: progress.remainingCents === 0,
          proofs,
        };
      }),

    // Presigned browser PUT for one deterministic PRIVATE staging object.
    // The submitted evidence is copied to a never-client-exposed final key.
    presign: artistProcedure
      .input(
        z.object({
          purchaseRequestId: z.string().uuid(),
          fileName: z.string().min(1).max(200),
          contentType: z.enum(PROOF_CONTENT_TYPES),
          sizeBytes: z.number().int().positive().max(MAX_PROOF_BYTES),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
        await assertPaymentProofsTableAvailable(ctx.db);
        await assertAcceptsProof(ctx.db, request);
        const rate = checkRateLimit(
          `proof-presign:${ctx.clerkUserId}:${request.id}`,
          10,
          10 * 60 * 1000,
        );
        if (!rate.ok) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Too many upload attempts. Wait a few minutes and try again.",
          });
        }
        const key = buildProofStagingKey({
          producerId: request.producerId,
          purchaseRequestId: request.id,
        });
        const uploadUrl = await getSignedUrl(
          getR2(),
          new PutObjectCommand({
            Bucket: BUCKETS.docs,
            Key: key,
            ContentType: input.contentType,
            ContentLength: input.sizeBytes,
          }),
          { expiresIn: 300 },
        );
        return { uploadUrl };
      }),

    // Finalizes and records a private proof. The client can overwrite its one
    // staging object before submit, but never receives PUT access to the final
    // evidence key. CopySourceIfMatch pins the exact bytes that were checked.
    submit: artistProcedure
      .input(
        z.object({
          purchaseRequestId: z.string().uuid(),
          amountCents: z.number().int().positive(),
          originalFileName: z.string().trim().min(1).max(200),
          note: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const request = await resolveOwnedRequest(ctx.db, ctx.clerkUserId, input.purchaseRequestId);
        await assertPaymentProofsTableAvailable(ctx.db);
        const stagingKey = buildProofStagingKey({
          producerId: request.producerId,
          purchaseRequestId: request.id,
        });

        const preflight = await assertAcceptsProof(ctx.db, request);
        if (
          !preflight.progress.nextDueCents ||
          input.amountCents !== preflight.progress.nextDueCents
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The proof amount must match the payment currently due.",
          });
        }

        let sizeBytes = 0;
        let contentType = "";
        let stagingEtag = "";
        try {
          const object = await getR2().send(
            new HeadObjectCommand({
              Bucket: BUCKETS.docs,
              Key: stagingKey,
            }),
          );
          sizeBytes = object.ContentLength ?? 0;
          contentType = (object.ContentType ?? "").toLowerCase();
          stagingEtag = object.ETag ?? "";
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The proof upload could not be found. Upload it again.",
          });
        }
        if (
          sizeBytes <= 0 ||
          sizeBytes > MAX_PROOF_BYTES ||
          !stagingEtag ||
          !PROOF_CONTENT_TYPES.includes(contentType as (typeof PROOF_CONTENT_TYPES)[number])
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That proof file isn't a supported image or PDF.",
          });
        }

        try {
          const sample = await getR2().send(
            new GetObjectCommand({
              Bucket: BUCKETS.docs,
              Key: stagingKey,
              Range: "bytes=0-31",
              IfMatch: stagingEtag,
            }),
          );
          const bytes = await sample.Body?.transformToByteArray();
          if (!bytes || !hasValidProofFileSignature(contentType, bytes)) {
            throw new Error("invalid proof signature");
          }
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The uploaded file contents don't match a supported image or PDF.",
          });
        }

        const finalKey = buildFinalProofKey({
          producerId: request.producerId,
          purchaseRequestId: request.id,
          filename: input.originalFileName,
        });
        let finalEtag = "";
        let copyEtag = "";
        try {
          const copied = await getR2().send(
            new CopyObjectCommand({
              Bucket: BUCKETS.docs,
              Key: finalKey,
              CopySource: encodeR2CopySource(BUCKETS.docs, stagingKey),
              CopySourceIfMatch: stagingEtag,
              MetadataDirective: "COPY",
            }),
          );
          copyEtag = copied.CopyObjectResult?.ETag ?? "";
          if (!copyEtag) throw new Error("copy did not return an ETag");
          const finalized = await getR2().send(
            new HeadObjectCommand({
              Bucket: BUCKETS.docs,
              Key: finalKey,
              IfMatch: copyEtag,
            }),
          );
          finalEtag = finalized.ETag ?? "";
          if (
            !finalEtag ||
            finalEtag !== copyEtag ||
            finalized.ContentLength !== sizeBytes ||
            (finalized.ContentType ?? "").toLowerCase() !== contentType
          ) {
            throw new Error("final proof metadata mismatch");
          }
        } catch {
          await deleteProofObjectQuietly(finalKey);
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The proof changed while it was being submitted. Upload it again.",
          });
        }

        let row: PaymentProof;
        try {
          row = await ctx.db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${request.id}, 0))`);
            const lockedRequest = await loadPurchaseRequestRow(
              tx,
              request.id,
              true,
              request.producerId,
            );
            if (
              !lockedRequest ||
              !PAYING_STATUSES.has(lockedRequest.status) ||
              !lockedRequest.paymentPlanChosenAt
            ) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "This purchase isn't ready for a payment yet.",
              });
            }
            const paidRows = await tx
              .select({ amountCents: invoices.amountCents })
              .from(invoices)
              .where(
                and(eq(invoices.purchaseRequestId, lockedRequest.id), eq(invoices.status, "paid")),
              );
            const pendingRows = await tx
              .select({ amountCents: paymentProofs.amountCents })
              .from(paymentProofs)
              .where(
                and(
                  eq(paymentProofs.purchaseRequestId, lockedRequest.id),
                  eq(paymentProofs.status, "pending"),
                ),
              );
            const paid = paidRows.reduce((sum, item) => sum + item.amountCents, 0);
            const reserved = pendingRows.reduce((sum, item) => sum + item.amountCents, 0);
            const charges = calculateCharges(
              lockedRequest.paymentPlanSnapshot,
              lockedRequest.priceCents,
            );
            const progress = chargesProgress(charges, paid, reserved);
            if (progress.reservedCents > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "A payment proof is already being reviewed.",
              });
            }
            if (!progress.nextDueCents || input.amountCents !== progress.nextDueCents) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "The proof amount must match the payment currently due.",
              });
            }
            const kind = invoiceKindForCharge(
              lockedRequest.paymentPlanSnapshot.kind,
              progress.chargesCompleted,
              charges.length,
            );
            const [proof] = await tx
              .insert(paymentProofs)
              .values({
                producerId: lockedRequest.producerId,
                projectId: lockedRequest.projectId,
                purchaseRequestId: lockedRequest.id,
                amountCents: input.amountCents,
                currency: lockedRequest.currency,
                kind,
                storageBucket: "docs",
                storageKey: finalKey,
                objectEtag: finalEtag,
                originalFileName: input.originalFileName,
                contentType,
                sizeBytes,
                status: "pending",
                note: input.note ?? null,
              })
              .returning();
            if (!proof) {
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
            }
            if (lockedRequest.status === "approved") {
              await tx
                .update(purchaseRequests)
                .set({ status: "verifying", statusChangedAt: new Date() })
                .where(
                  and(
                    eq(purchaseRequests.id, lockedRequest.id),
                    eq(purchaseRequests.producerId, lockedRequest.producerId),
                    eq(purchaseRequests.status, "approved"),
                  ),
                );
            }
            return proof;
          });
        } catch (error) {
          await deleteProofObjectQuietly(finalKey);
          throw error;
        }

        await deleteProofObjectQuietly(stagingKey);

        try {
          await emitProofSubmitted(ctx.db, {
            proofId: row.id,
            producerId: request.producerId,
            purchaseRequestId: request.id,
            artistName: request.artistName,
            productName: request.productNameSnapshot,
            refNumber: request.refNumber,
            amountCents: input.amountCents,
            currency: request.currency,
          });
        } catch (err) {
          console.error("[notify] proof-submitted failed", err);
        }

        return {
          ok: true as const,
          proofId: row.id,
          purchaseRequestId: request.id,
          productId: request.productId,
        };
      }),
  }),
  session: router({
    schedule: artistProcedure
      .input(
        z.object({
          purchaseRequestId: z.string().uuid(),
          startsAt: z.coerce.date(),
          durationMin: z.number().int().positive(),
          songId: z.string().uuid().optional(),
        }),
      )
      .mutation((): { bookingId: string; projectId: string } =>
        notImplemented("BE-3 artist.purchase.session.schedule"),
      ),
  }),
  delivery: router({
    canDownload: artistProcedure
      .input(z.object({ versionId: z.string().uuid() }))
      .query((): { locked: boolean; reason?: "unpaid" } =>
        notImplemented("BE-4 artist.purchase.delivery.canDownload"),
      ),
  }),
});

// ─── producer.purchase ──────────────────────────────────────────────
export const producerPurchaseRouter = router({
  // Gate 1 — approve. Defers project creation (decision: created once the
  // 5-min undo window elapses). Idempotent on an already-approved row.
  approve: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const transition = await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.id}, 0))`);
        const req = await loadProducerRequest(tx, ctx.producerId, input.id);
        if (req.status === "approved") {
          return {
            req,
            didChange: false,
            approvedAt: req.approvedAt ?? req.statusChangedAt ?? req.createdAt,
          };
        }
        if (req.status !== "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot approve a ${req.status} request.`,
          });
        }

        const now = new Date();
        const [updated] = await tx
          .update(purchaseRequests)
          .set({ status: "approved", approvedAt: now, statusChangedAt: now })
          .where(and(eq(purchaseRequests.id, req.id), eq(purchaseRequests.status, "pending")))
          .returning({ id: purchaseRequests.id });
        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This request was updated in another tab. Refresh and try again.",
          });
        }
        return { req, didChange: true, approvedAt: now };
      });
      const { req, approvedAt } = transition;

      if (transition.didChange) {
        try {
          await emitPurchaseApproved(ctx.db, {
            producerId: req.producerId,
            purchaseRequestId: req.id,
            artistName: req.artistName,
            productName: req.productNameSnapshot,
            refNumber: req.refNumber,
          });
        } catch (err) {
          console.error("[notify] purchase-approved failed", err);
        }

        after(async () => {
          try {
            await sendPurchaseApprovedEmail(req.artistEmail, {
              artistName: req.artistName,
              producerName: req.producerName ?? "Your producer",
              productName: req.productNameSnapshot,
              refNumber: req.refNumber,
              currency: req.currency,
              priceCents: req.priceCents,
            });
          } catch (err) {
            console.error("[email] purchase-approved failed", err);
          }
        });
      }

      return {
        ok: true as const,
        status: "approved" as const,
        approvedAt,
        undoableUntil: new Date(approvedAt.getTime() + PURCHASE_APPROVAL_UNDO_MS),
        projectId: req.projectId,
      };
    }),

  // Gate 1 — decline. Artist always sees a generic message; the reason
  // (if any) is recorded only on the producer's in-app notification.
  decline: producerProcedure
    .input(z.object({ id: z.string().uuid(), reason: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const transition = await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.id}, 0))`);
        const req = await loadProducerRequest(tx, ctx.producerId, input.id);
        if (req.status === "declined") {
          return {
            req,
            didChange: false,
            declinedAt: req.declinedAt ?? req.statusChangedAt ?? req.createdAt,
          };
        }
        if (req.status !== "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot decline a ${req.status} request.`,
          });
        }

        const now = new Date();
        const [updated] = await tx
          .update(purchaseRequests)
          .set({ status: "declined", declinedAt: now, statusChangedAt: now })
          .where(and(eq(purchaseRequests.id, req.id), eq(purchaseRequests.status, "pending")))
          .returning({ id: purchaseRequests.id });
        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This request was updated in another tab. Refresh and try again.",
          });
        }
        return { req, didChange: true, declinedAt: now };
      });
      const { req, declinedAt } = transition;

      if (transition.didChange) {
        try {
          await emitPurchaseDeclined(ctx.db, {
            producerId: req.producerId,
            purchaseRequestId: req.id,
            artistName: req.artistName,
            productName: req.productNameSnapshot,
            refNumber: req.refNumber,
            reason: input.reason ?? null,
          });
        } catch (err) {
          console.error("[notify] purchase-declined failed", err);
        }

        after(async () => {
          try {
            await sendPurchaseDeclinedEmail(req.artistEmail, {
              artistName: req.artistName,
              producerName: req.producerName ?? "Your producer",
              productName: req.productNameSnapshot,
              refNumber: req.refNumber,
            });
          } catch (err) {
            console.error("[email] purchase-declined failed", err);
          }
        });
      }

      return { ok: true as const, status: "declined" as const, declinedAt };
    }),

  // Reverse a just-made approval inside the 5-min window. Enforced at
  // call-time (no scheduler). Nothing to unwind because project creation
  // was deferred.
  undoApproval: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.id}, 0))`);
        const req = await loadProducerRequest(tx, ctx.producerId, input.id);
        if (req.status !== "approved" || !req.approvedAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "There's no approval to undo.",
          });
        }
        if (!purchaseApprovalUndoableUntil(req.approvedAt)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The undo window has elapsed.",
          });
        }

        const hasProofTable = await paymentProofsTableAvailable(tx);
        const proofActivity = hasProofTable
          ? (
              await tx
                .select({ id: paymentProofs.id })
                .from(paymentProofs)
                .where(eq(paymentProofs.purchaseRequestId, req.id))
                .limit(1)
            )[0]
          : undefined;
        const [invoiceActivity] = await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(eq(invoices.purchaseRequestId, req.id))
          .limit(1);
        if (req.paymentPlanChosenAt || proofActivity || invoiceActivity) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payment setup has started, so this approval can no longer be undone.",
          });
        }

        const now = new Date();
        const [updated] = await tx
          .update(purchaseRequests)
          .set({ status: "pending", approvedAt: null, statusChangedAt: now })
          .where(and(eq(purchaseRequests.id, req.id), eq(purchaseRequests.status, "approved")))
          .returning({ id: purchaseRequests.id });
        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This request was updated in another tab. Refresh and try again.",
          });
        }
      });

      return { ok: true as const, status: "pending" as const };
    }),

  // Producer hub list, optional status filter, newest first.
  list: producerProcedure
    .input(
      z
        .object({
          status: z.enum(["pending", "approved", "verifying", "paid", "declined"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const filters = [eq(purchaseRequests.producerId, ctx.producerId)];
      if (input?.status) {
        filters.push(eq(purchaseRequests.status, input.status));
      }
      const rows = await ctx.db
        .select({
          id: purchaseRequests.id,
          refNumber: purchaseRequests.refNumber,
          status: purchaseRequests.status,
          artistName: purchaseRequests.artistName,
          artistEmail: purchaseRequests.artistEmail,
          productNameSnapshot: purchaseRequests.productNameSnapshot,
          priceCents: purchaseRequests.priceCents,
          currency: purchaseRequests.currency,
          createdAt: purchaseRequests.createdAt,
        })
        .from(purchaseRequests)
        .where(and(...filters))
        .orderBy(desc(purchaseRequests.createdAt));
      return { requests: rows };
    }),

  // Gate 1 review detail. This deliberately returns the request-time
  // snapshots rather than live product data: a producer must review the
  // exact price, payment options, and agreement the artist accepted even
  // after the product has been edited or removed.
  get: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const request = await loadProducerRequest(ctx.db, ctx.producerId, input.id);
      const [acceptance] = await ctx.db
        .select({
          acceptedAt: agreementAcceptances.acceptedAt,
          agreementUrl: agreementAcceptances.agreementUrl,
        })
        .from(agreementAcceptances)
        .where(
          and(
            eq(agreementAcceptances.purchaseRequestId, request.id),
            eq(agreementAcceptances.producerId, ctx.producerId),
          ),
        )
        .limit(1);

      return {
        request: {
          id: request.id,
          refNumber: request.refNumber,
          status: request.status,
          statusChangedAt: request.statusChangedAt,
          approvedAt: request.approvedAt,
          declinedAt: request.declinedAt,
          createdAt: request.createdAt,
          artistName: request.artistName,
          artistEmail: request.artistEmail,
          productId: request.productId,
          productNameSnapshot: request.productNameSnapshot,
          priceCents: request.priceCents,
          currency: request.currency,
          sessionCountSnapshot: request.sessionCountSnapshot,
          songQty: request.songQty,
          unitPriceCents: request.unitPriceCents,
          paymentPlanSnapshot: request.paymentPlanSnapshot,
          paymentPlanOptionsSnapshot: frozenPlanOptions(request),
          paymentPlanChosenAt: request.paymentPlanChosenAt,
          royaltyTermsSnapshot: request.royaltyTermsSnapshot,
          agreementTextSnapshot: request.agreementTextSnapshot,
          undoableUntil:
            request.status === "approved" && request.paymentPlanChosenAt === null
              ? purchaseApprovalUndoableUntil(request.approvedAt)
              : null,
          contractUrlSnapshot: request.contractUrlSnapshot,
        },
        agreement: {
          acceptedAt: acceptance?.acceptedAt ?? null,
          agreementUrl: safeAgreementUrl(acceptance?.agreementUrl ?? request.contractUrlSnapshot),
        },
      };
    }),

  // ── BE-2 — Gate 2: verify / reject proofs ──────────────────────────
  proofOfPayment: router({
    // The hub's verification queue: every awaiting proof, newest first.
    pending: producerProcedure
      .input(z.object({ purchaseRequestId: z.string().uuid().optional() }).optional())
      .query(({ ctx, input }) =>
        listPendingProducerProofs(ctx.db, ctx.producerId, input?.purchaseRequestId),
      ),

    view: producerProcedure
      .input(z.object({ proofId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertPaymentProofsTableAvailable(ctx.db);
        const { proof } = await loadProducerProof(ctx.db, ctx.producerId, input.proofId);
        await assertProofObjectIntegrity(proof);
        const url = await getSignedUrl(
          getR2(),
          new GetObjectCommand({
            Bucket: BUCKETS.docs,
            Key: proof.storageKey,
          }),
          { expiresIn: 300 },
        );
        return { url, expiresInSeconds: 300 };
      }),

    // Gate-2 approve: confirm the private proof and atomically create ONE
    // paid ledger invoice. The proof-id unique index makes retries safe.
    confirm: producerProcedure
      .input(z.object({ proofId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await assertPaymentProofsTableAvailable(ctx.db);
        const loaded = await loadProducerProof(ctx.db, ctx.producerId, input.proofId);
        const { proof, request } = loaded;
        if (proof.status === "confirmed") {
          await markProofNotificationsReadQuietly(ctx.db, ctx.producerId, proof.id, request.id);
          // Re-read the ledger only after taking the request lock. Otherwise
          // an idempotent retry of an earlier installment can race a later
          // confirmation and overwrite the project with stale progress.
          const retryState = await ctx.db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${request.id}, 0))`);
            const lockedRequest = await loadPurchaseRequestRow(
              tx,
              request.id,
              true,
              ctx.producerId,
            );
            if (!lockedRequest) throw new TRPCError({ code: "NOT_FOUND" });
            const paid = await paidTotalCents(tx, lockedRequest.id);
            const [depositDue = lockedRequest.priceCents] = calculateCharges(
              lockedRequest.paymentPlanSnapshot,
              lockedRequest.priceCents,
            );
            const projectId =
              paid >= depositDue
                ? await ensurePurchaseProject(tx, lockedRequest, paid)
                : lockedRequest.projectId;
            return {
              paid,
              depositDue,
              priceCents: lockedRequest.priceCents,
              projectId,
            };
          });
          return {
            ok: true as const,
            purchaseRequestId: request.id,
            projectId: retryState.projectId,
            proofStatus: "confirmed" as const,
            invoiceStatus: "paid" as const,
            depositPaid: retryState.paid >= retryState.depositDue,
            finalPaid: retryState.paid >= retryState.priceCents,
          };
        }
        if (proof.status !== "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot confirm a ${proof.status} proof.`,
          });
        }
        await assertProofObjectIntegrity(proof);
        const result = await ctx.db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${request.id}, 0))`);
          const lockedRequest = await loadPurchaseRequestRow(tx, request.id, true, ctx.producerId);
          if (!lockedRequest) throw new TRPCError({ code: "NOT_FOUND" });
          const [lockedProof] = await tx
            .select()
            .from(paymentProofs)
            .where(
              and(
                eq(paymentProofs.id, proof.id),
                eq(paymentProofs.producerId, ctx.producerId),
                eq(paymentProofs.purchaseRequestId, lockedRequest.id),
              ),
            )
            .limit(1);
          if (!lockedProof) throw new TRPCError({ code: "NOT_FOUND" });
          if (lockedProof.status === "rejected") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Cannot confirm a rejected proof.",
            });
          }
          const now = new Date();
          const didConfirm = lockedProof.status === "pending";
          if (lockedProof.status === "pending") {
            const paidBeforeRows = await tx
              .select({ amountCents: invoices.amountCents })
              .from(invoices)
              .where(
                and(eq(invoices.purchaseRequestId, lockedRequest.id), eq(invoices.status, "paid")),
              );
            const paidBefore = paidBeforeRows.reduce((sum, item) => sum + item.amountCents, 0);
            const charges = calculateCharges(
              lockedRequest.paymentPlanSnapshot,
              lockedRequest.priceCents,
            );
            const due = chargesProgress(charges, paidBefore).nextDueCents;
            if (!due || lockedProof.amountCents !== due) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "This proof no longer matches the amount due. Reject it and ask for a new proof.",
              });
            }
            const [confirmedProof] = await tx
              .update(paymentProofs)
              .set({ status: "confirmed", confirmedAt: now })
              .where(
                and(
                  eq(paymentProofs.id, lockedProof.id),
                  eq(paymentProofs.producerId, ctx.producerId),
                  eq(paymentProofs.purchaseRequestId, lockedRequest.id),
                  eq(paymentProofs.status, "pending"),
                ),
              )
              .returning({ id: paymentProofs.id });
            if (!confirmedProof) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "This proof was updated in another tab. Refresh and try again.",
              });
            }
            await tx.insert(invoices).values({
              producerId: lockedRequest.producerId,
              projectId: lockedRequest.projectId,
              purchaseRequestId: lockedRequest.id,
              paymentProofId: lockedProof.id,
              amountCents: lockedProof.amountCents,
              currency: lockedRequest.currency,
              description: `Confirmed off-app payment — ${lockedRequest.refNumber}`,
              kind: lockedProof.kind,
              status: "paid",
              paidAt: now,
              customerEmail: lockedRequest.artistEmail,
              customerName: lockedRequest.artistName,
            });
          }
          const paidRows = await tx
            .select({ amountCents: invoices.amountCents })
            .from(invoices)
            .where(
              and(eq(invoices.purchaseRequestId, lockedRequest.id), eq(invoices.status, "paid")),
            );
          const paid = paidRows.reduce((sum, item) => sum + item.amountCents, 0);
          const [depositDue = lockedRequest.priceCents] = calculateCharges(
            lockedRequest.paymentPlanSnapshot,
            lockedRequest.priceCents,
          );
          const depositPaid = paid >= depositDue;
          const projectId = depositPaid
            ? await ensurePurchaseProject(tx, lockedRequest, paid)
            : lockedRequest.projectId;
          return {
            paid,
            depositPaid,
            finalPaid: paid >= lockedRequest.priceCents,
            didConfirm,
            projectId,
          };
        });

        await markProofNotificationsReadQuietly(ctx.db, ctx.producerId, proof.id, request.id);

        if (result.didConfirm) {
          after(async () => {
            try {
              await sendProofVerifiedEmail(request.artistEmail, {
                artistName: request.artistName,
                producerName: loaded.producerName ?? "Your producer",
                productName: request.productNameSnapshot,
                refNumber: request.refNumber,
                currency: request.currency,
                amountCents: proof.amountCents,
                paidCents: result.paid,
                totalCents: request.priceCents,
                paidInFull: result.finalPaid,
              });
            } catch (err) {
              console.error("[email] proof-verified failed", err);
            }
          });
        }

        return {
          ok: true as const,
          purchaseRequestId: request.id,
          projectId: result.projectId,
          proofStatus: "confirmed" as const,
          invoiceStatus: "paid" as const,
          depositPaid: result.depositPaid,
          finalPaid: result.finalPaid,
        };
      }),

    // Gate-2 reject with an ARTIST-FACING note (unlike Gate-1 declines).
    // Confirmation and rejection take the same per-request lock so they
    // cannot both win when two producer tabs act at nearly the same time.
    reject: producerProcedure
      .input(
        z.object({
          proofId: z.string().uuid(),
          note: z.string().trim().min(1).max(2000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertPaymentProofsTableAvailable(ctx.db);
        const loaded = await loadProducerProof(ctx.db, ctx.producerId, input.proofId);
        const { proof, request } = loaded;
        if (proof.status === "rejected") {
          await markProofNotificationsReadQuietly(ctx.db, ctx.producerId, proof.id, request.id);
          return {
            ok: true as const,
            purchaseRequestId: request.id,
            proofStatus: "rejected" as const,
          };
        }
        if (proof.status !== "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot reject a ${proof.status} proof.`,
          });
        }
        const didReject = await ctx.db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${request.id}, 0))`);
          const lockedRequest = await loadPurchaseRequestRow(tx, request.id, true, ctx.producerId);
          if (!lockedRequest) throw new TRPCError({ code: "NOT_FOUND" });
          const [lockedProof] = await tx
            .select()
            .from(paymentProofs)
            .where(
              and(
                eq(paymentProofs.id, proof.id),
                eq(paymentProofs.producerId, ctx.producerId),
                eq(paymentProofs.purchaseRequestId, lockedRequest.id),
              ),
            )
            .limit(1);
          if (!lockedProof) throw new TRPCError({ code: "NOT_FOUND" });
          if (lockedProof.status === "confirmed") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Cannot reject a confirmed proof.",
            });
          }
          if (lockedProof.status === "rejected") return false;

          const now = new Date();
          const [rejectedProof] = await tx
            .update(paymentProofs)
            .set({
              status: "rejected",
              rejectionNote: input.note,
              rejectedAt: now,
            })
            .where(
              and(
                eq(paymentProofs.id, lockedProof.id),
                eq(paymentProofs.producerId, ctx.producerId),
                eq(paymentProofs.purchaseRequestId, lockedRequest.id),
                eq(paymentProofs.status, "pending"),
              ),
            )
            .returning({ id: paymentProofs.id });
          if (!rejectedProof) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "This proof was updated in another tab. Refresh and try again.",
            });
          }

          // Before the first confirmed payment, rejection returns the request
          // to awaiting-payment. After a deposit it stays paid/sessions-open.
          if (lockedRequest.status === "verifying") {
            const paidRows = await tx
              .select({ amountCents: invoices.amountCents })
              .from(invoices)
              .where(
                and(eq(invoices.purchaseRequestId, lockedRequest.id), eq(invoices.status, "paid")),
              );
            if (paidRows.length === 0) {
              await tx
                .update(purchaseRequests)
                .set({ status: "approved", statusChangedAt: now })
                .where(
                  and(
                    eq(purchaseRequests.id, lockedRequest.id),
                    eq(purchaseRequests.producerId, ctx.producerId),
                    eq(purchaseRequests.status, "verifying"),
                  ),
                );
            }
          }
          return true;
        });

        await markProofNotificationsReadQuietly(ctx.db, ctx.producerId, proof.id, request.id);

        if (didReject) {
          after(async () => {
            try {
              await sendProofRejectedEmail(request.artistEmail, {
                artistName: request.artistName,
                producerName: loaded.producerName ?? "Your producer",
                productName: request.productNameSnapshot,
                refNumber: request.refNumber,
                note: input.note,
              });
            } catch (err) {
              console.error("[email] proof-rejected failed", err);
            }
          });
        }

        return {
          ok: true as const,
          purchaseRequestId: request.id,
          proofStatus: "rejected" as const,
        };
      }),
  }),
  session: router({
    confirm: producerProcedure
      .input(z.object({ bookingId: z.string().uuid() }))
      .mutation((): { ok: true; status: "confirmed"; projectId: string } =>
        notImplemented("BE-3 producer.purchase.session.confirm"),
      ),
  }),
});
