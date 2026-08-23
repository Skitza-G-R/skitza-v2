import {
  and,
  asc,
  artistHistoricalAccessGrants,
  clientContacts,
  desc,
  eq,
  isNull,
  notifications,
  paymentProofs,
  producers,
  projects,
  purchaseInstallments,
  purchasePaymentCorrections,
  purchasePayments,
  purchases,
  purchaseWaivers,
  sql,
  type Db,
} from "@skitza/db";

import { activeArtistClientOwner } from "~/server/artist/access";
import { isInstallmentPayableForInstructions } from "~/server/domain/payment-instructions/policy";
import {
  lockPurchaseLedgerScope,
  purchaseLedgerRepositoryForTransaction,
} from "~/server/domain/purchase-ledger/db";
import { PurchaseLedgerDomainError } from "~/server/domain/purchase-ledger/policy";
import {
  reconcilePurchaseLedger,
  recordConfirmedPurchasePayment,
} from "~/server/domain/purchase-ledger/service";
import {
  resolveCapabilitySecret,
  type CapabilityVerificationSecrets,
} from "~/server/security/capability-secrets";

import {
  assertProofAmount,
  assertProofUploadMetadata,
  decideProofTransition,
  normalizeProofFileName,
  normalizeProofNote,
  PaymentProofPolicyError,
  type ProofContentType,
} from "./policy";
import {
  createPrivateProofUpload,
  deletePrivateProofObjectQuietly,
  deletePrivateProofStagingUpload,
  finalizePrivateProofUpload,
  ProofStorageError,
} from "./storage";
import {
  createProofEvidenceToken,
  createProofUploadToken,
  PROOF_EVIDENCE_TTL_SECONDS,
  proofObjectKeys,
  ProofTokenError,
  verifyOwnedProofUploadToken,
  verifyProofUploadToken,
} from "./tokens";
import {
  resolveArtistProofUploadAvailability,
  type ArtistProofUploadAvailability,
} from "./artist-upload-availability";

export type PaymentProofDomainErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTEGRITY_ERROR";

export class PaymentProofDomainError extends Error {
  readonly code: PaymentProofDomainErrorCode;

  constructor(code: PaymentProofDomainErrorCode, message: string) {
    super(message);
    this.name = "PaymentProofDomainError";
    this.code = code;
  }
}

export type ProofDb = Pick<Db, "select" | "insert" | "update" | "execute">;
type ProofStatus = (typeof paymentProofs.$inferSelect)["status"];
type InstallmentStatus = (typeof purchaseInstallments.$inferSelect)["status"];

export type PurchaseContext = Readonly<{
  purchaseId: string;
  producerId: string;
  projectId: string;
  clientContactId: string;
  productId: string | null;
  purchaseRequestId: string | null;
  refNumber: string;
  lifecycleStatus: (typeof purchases.$inferSelect)["lifecycleStatus"];
  commercialSnapshot: (typeof purchases.$inferSelect)["commercialSnapshot"];
  totalCents: number;
  currency: string;
  projectTitle: string;
  projectLifecycleStatus: (typeof projects.$inferSelect)["lifecycleStatus"];
  artistName: string;
  artistEmail: string;
  artistClerkUserId: string | null;
  artistArchivedAt: Date | null;
  producerName: string | null;
  producerClosedAt: Date | null;
}>;

export type InstallmentRow = typeof purchaseInstallments.$inferSelect;

export type PaymentProofHistoryItem = Readonly<{
  proofId: string;
  purchaseId: string;
  installmentId: string;
  installmentPosition: number;
  installmentAmountCents: number;
  amountCents: number;
  currency: string;
  status: ProofStatus;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  note: string | null;
  rejectionNote: string | null;
  confirmedAt: Date | null;
  rejectedAt: Date | null;
  createdAt: Date;
}>;

export type ArtistPaymentProofState = Readonly<{
  purchaseId: string;
  purchaseRequestId: string | null;
  producerId: string;
  productId: string | null;
  projectId: string;
  installmentId: string;
  installmentPosition: number;
  installmentAmountCents: number;
  productName: string;
  producerName: string;
  projectTitle: string;
  proofUploadsAvailable: boolean;
  proofUploadAvailability: ArtistProofUploadAvailability;
  currency: string;
  totalCents: number;
  paidCents: number;
  pendingProofCents: number;
  remainingCents: number;
  amountDueNowCents: number;
  availableToSubmitCents: number;
  paidInFull: boolean;
  proofs: readonly (PaymentProofHistoryItem & { evidenceUrl: string })[];
}>;

export type ProducerPendingPaymentProof = Readonly<{
  proofId: string;
  purchaseId: string;
  purchaseRequestId: string | null;
  installmentId: string;
  installmentPosition: number;
  installmentAmountCents: number;
  refNumber: string;
  artistName: string;
  projectId: string;
  projectTitle: string;
  productNameSnapshot: string;
  amountCents: number;
  totalCents: number;
  currency: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  proofNote: string | null;
  createdAt: Date;
}>;

export type ProducerPaymentProofHistory = ProducerPendingPaymentProof &
  Readonly<{
    status: ProofStatus;
    rejectionNote: string | null;
    confirmedAt: Date | null;
    rejectedAt: Date | null;
  }>;

export type ProducerPaymentProofReview = Readonly<{
  proof: ProducerPaymentProofHistory;
  evidenceUrl: string;
  evidenceExpiresInSeconds: number;
  history: readonly ProducerPaymentProofHistory[];
}>;

export type LedgerSnapshot = Readonly<{
  paidByInstallment: ReadonlyMap<string, number>;
  waivedByInstallment: ReadonlyMap<string, number>;
  paidCents: number;
  waivedCents: number;
}>;

export function asDomainError(error: unknown): never {
  if (error instanceof PaymentProofDomainError) throw error;
  if (error instanceof PurchaseLedgerDomainError) {
    const code =
      error.code === "INVALID_INPUT"
        ? "INVALID_INPUT"
        : error.code === "NOT_FOUND"
          ? "NOT_FOUND"
          : error.code === "INTEGRITY_ERROR"
            ? "INTEGRITY_ERROR"
            : "CONFLICT";
    throw new PaymentProofDomainError(code, error.message);
  }
  if (error instanceof PaymentProofPolicyError || error instanceof ProofStorageError) {
    throw new PaymentProofDomainError("INVALID_INPUT", error.message);
  }
  if (error instanceof ProofTokenError) {
    throw new PaymentProofDomainError("NOT_FOUND", error.message);
  }
  throw error;
}

export function requireServerSecret(serverSecret: string): string {
  if (serverSecret.length < 20) {
    throw new Error("Private payment proof service requires the server auth secret");
  }
  return serverSecret;
}

async function loadPurchaseContext(
  db: ProofDb,
  where: ReturnType<typeof and> | ReturnType<typeof eq>,
  lock = false,
): Promise<PurchaseContext | null> {
  const query = db
    .select({
      purchaseId: purchases.id,
      producerId: purchases.producerId,
      projectId: purchases.projectId,
      clientContactId: purchases.clientContactId,
      productId: purchases.productId,
      purchaseRequestId: purchases.purchaseRequestId,
      refNumber: purchases.refNumber,
      lifecycleStatus: purchases.lifecycleStatus,
      commercialSnapshot: purchases.commercialSnapshot,
      totalCents: purchases.totalCents,
      currency: purchases.currency,
      projectTitle: projects.title,
      projectLifecycleStatus: projects.lifecycleStatus,
      artistName: clientContacts.name,
      artistEmail: clientContacts.email,
      artistClerkUserId: clientContacts.clerkUserId,
      artistArchivedAt: clientContacts.archivedAt,
      producerName: producers.displayName,
      producerClosedAt: producers.closedAt,
    })
    .from(purchases)
    .innerJoin(
      projects,
      and(
        eq(projects.id, purchases.projectId),
        eq(projects.producerId, purchases.producerId),
        eq(projects.clientContactId, purchases.clientContactId),
      ),
    )
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, purchases.clientContactId),
        eq(clientContacts.producerId, purchases.producerId),
      ),
    )
    .innerJoin(producers, eq(producers.id, purchases.producerId))
    .where(where)
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  return row ?? null;
}

async function loadArtistPurchaseContext(
  db: ProofDb,
  clerkUserId: string,
  purchaseId: string,
  lock = false,
): Promise<PurchaseContext | null> {
  return loadPurchaseContext(
    db,
    and(
      eq(purchases.id, purchaseId),
      activeArtistClientOwner(clerkUserId, {
        producerId: purchases.producerId,
        clientContactId: purchases.clientContactId,
      }),
    ),
    lock,
  );
}

export async function loadProducerPurchaseContext(
  db: ProofDb,
  producerId: string,
  purchaseId: string,
  lock = false,
): Promise<PurchaseContext | null> {
  return loadPurchaseContext(
    db,
    and(eq(purchases.id, purchaseId), eq(purchases.producerId, producerId)),
    lock,
  );
}

/**
 * Serialize proof-write capabilities with Producer closure. The query does
 * not filter closed rows because submit must still inspect immutable proof
 * state and permit an exact replay of a write committed before closure.
 */
export async function lockProducerClosureState(
  db: ProofDb,
  producerId: string,
): Promise<Date | null> {
  const [producer] = await db
    .select({ id: producers.id, closedAt: producers.closedAt })
    .from(producers)
    .where(eq(producers.id, producerId))
    .limit(1)
    .for("share");
  if (!producer) {
    throw new PaymentProofDomainError("NOT_FOUND", "Purchase was not found");
  }
  return producer.closedAt;
}

export async function loadInstallments(
  db: ProofDb,
  context: PurchaseContext,
): Promise<InstallmentRow[]> {
  return db
    .select()
    .from(purchaseInstallments)
    .where(
      and(
        eq(purchaseInstallments.purchaseId, context.purchaseId),
        eq(purchaseInstallments.producerId, context.producerId),
      ),
    )
    .orderBy(asc(purchaseInstallments.position));
}

export async function loadLedgerSnapshot(
  db: ProofDb,
  context: PurchaseContext,
): Promise<LedgerSnapshot> {
  const [payments, corrections, waivers] = await Promise.all([
    db
      .select({
        id: purchasePayments.id,
        installmentId: purchasePayments.installmentId,
        amountCents: purchasePayments.amountCents,
      })
      .from(purchasePayments)
      .where(
        and(
          eq(purchasePayments.purchaseId, context.purchaseId),
          eq(purchasePayments.producerId, context.producerId),
        ),
      ),
    db
      .select({
        paymentId: purchasePaymentCorrections.paymentId,
        sequence: purchasePaymentCorrections.sequence,
        newAmountCents: purchasePaymentCorrections.newAmountCents,
      })
      .from(purchasePaymentCorrections)
      .where(
        and(
          eq(purchasePaymentCorrections.purchaseId, context.purchaseId),
          eq(purchasePaymentCorrections.producerId, context.producerId),
        ),
      )
      .orderBy(asc(purchasePaymentCorrections.paymentId), asc(purchasePaymentCorrections.sequence)),
    db
      .select({
        installmentId: purchaseWaivers.installmentId,
        amountCents: purchaseWaivers.amountCents,
      })
      .from(purchaseWaivers)
      .where(
        and(
          eq(purchaseWaivers.purchaseId, context.purchaseId),
          eq(purchaseWaivers.producerId, context.producerId),
        ),
      ),
  ]);

  const correctedPayments = new Map(payments.map((payment) => [payment.id, { ...payment }]));
  for (const correction of corrections) {
    const payment = correctedPayments.get(correction.paymentId);
    if (!payment) {
      throw new PaymentProofDomainError(
        "INTEGRITY_ERROR",
        "A payment correction lost its immutable payment",
      );
    }
    payment.amountCents = correction.newAmountCents;
  }

  const paidByInstallment = new Map<string, number>();
  let paidCents = 0;
  for (const payment of correctedPayments.values()) {
    paidByInstallment.set(
      payment.installmentId,
      (paidByInstallment.get(payment.installmentId) ?? 0) + payment.amountCents,
    );
    paidCents += payment.amountCents;
  }
  const waivedByInstallment = new Map<string, number>();
  let waivedCents = 0;
  for (const waiver of waivers) {
    waivedByInstallment.set(
      waiver.installmentId,
      (waivedByInstallment.get(waiver.installmentId) ?? 0) + waiver.amountCents,
    );
    waivedCents += waiver.amountCents;
  }
  return { paidByInstallment, waivedByInstallment, paidCents, waivedCents };
}

export async function loadProofRows(db: ProofDb, context: PurchaseContext) {
  return db
    .select()
    .from(paymentProofs)
    .where(
      and(
        eq(paymentProofs.purchaseId, context.purchaseId),
        eq(paymentProofs.producerId, context.producerId),
      ),
    )
    .orderBy(asc(paymentProofs.createdAt), asc(paymentProofs.id));
}

export function installmentRemainingCents(
  installment: InstallmentRow,
  ledger: LedgerSnapshot,
): number {
  return Math.max(
    0,
    installment.amountCents -
      (ledger.paidByInstallment.get(installment.id) ?? 0) -
      (ledger.waivedByInstallment.get(installment.id) ?? 0),
  );
}

function exactPurchaseRemainingCents(
  installments: readonly InstallmentRow[],
  ledger: LedgerSnapshot,
): number {
  return installments.reduce(
    (sum, installment) =>
      sum +
      (installment.status === "canceled" ? 0 : installmentRemainingCents(installment, ledger)),
    0,
  );
}

function exactPurchasePaidInFull(
  installments: readonly InstallmentRow[],
  ledger: LedgerSnapshot,
): boolean {
  return installments.every(
    (installment) => (ledger.paidByInstallment.get(installment.id) ?? 0) >= installment.amountCents,
  );
}

function proofHistoryItem(
  proof: typeof paymentProofs.$inferSelect,
  installment: InstallmentRow,
): PaymentProofHistoryItem {
  return Object.freeze({
    proofId: proof.id,
    purchaseId: proof.purchaseId,
    installmentId: proof.installmentId,
    installmentPosition: installment.position,
    installmentAmountCents: installment.amountCents,
    amountCents: proof.amountCents,
    currency: proof.currency,
    status: proof.status,
    originalFileName: proof.originalFileName ?? "Payment proof",
    contentType: proof.contentType,
    sizeBytes: proof.sizeBytes,
    note: proof.note,
    rejectionNote: proof.rejectionNote,
    confirmedAt: proof.confirmedAt,
    rejectedAt: proof.rejectedAt,
    createdAt: proof.createdAt,
  });
}

function chooseInstallment(input: {
  installments: readonly InstallmentRow[];
  proofs: readonly (typeof paymentProofs.$inferSelect)[];
  ledger: LedgerSnapshot;
  installmentId?: string | undefined;
  now: Date;
}): InstallmentRow {
  if (input.installmentId) {
    const exact = input.installments.find((row) => row.id === input.installmentId);
    if (!exact) {
      throw new PaymentProofDomainError("NOT_FOUND", "Payment installment was not found");
    }
    return exact;
  }
  const pending = input.proofs.find((proof) => proof.status === "pending");
  const pendingInstallment = pending
    ? input.installments.find((row) => row.id === pending.installmentId)
    : undefined;
  if (pendingInstallment) return pendingInstallment;

  const collectible = input.installments.find(
    (row) =>
      isInstallmentPayableForInstructions(row, input.now) &&
      installmentRemainingCents(row, input.ledger) > 0,
  );
  if (collectible) return collectible;

  const latestProof = input.proofs.at(-1);
  const historical = latestProof
    ? input.installments.find((row) => row.id === latestProof.installmentId)
    : undefined;
  const fallback = historical ?? input.installments.at(-1);
  if (!fallback) {
    throw new PaymentProofDomainError("NOT_FOUND", "Payment installment was not found");
  }
  return fallback;
}

function evidenceHref(token: string): string {
  return `/api/payment-proofs/evidence?token=${encodeURIComponent(token)}`;
}

export async function loadArtistPaymentProofState(
  db: ProofDb,
  input: {
    clerkUserId: string;
    purchaseId: string;
    installmentId?: string | undefined;
    serverSecret: string;
    now?: Date | undefined;
  },
): Promise<ArtistPaymentProofState> {
  const now = input.now ?? new Date();
  const context = await loadArtistPurchaseContext(db, input.clerkUserId, input.purchaseId);
  if (!context) throw new PaymentProofDomainError("NOT_FOUND", "Purchase was not found");
  const [installments, ledger, proofs] = await Promise.all([
    loadInstallments(db, context),
    loadLedgerSnapshot(db, context),
    loadProofRows(db, context),
  ]);
  const selected = chooseInstallment({
    installments,
    ledger,
    proofs,
    installmentId: input.installmentId,
    now,
  });
  const installmentById = new Map(installments.map((row) => [row.id, row]));
  const selectedProofs = proofs.filter((proof) => proof.installmentId === selected.id);
  const pending = selectedProofs.find((proof) => proof.status === "pending") ?? null;
  const amountDueNowCents = installmentRemainingCents(selected, ledger);
  const paidInFull = exactPurchasePaidInFull(installments, ledger);
  const nextOutstandingInstallment = installments.find(
    (installment) =>
      installment.status !== "canceled" && installmentRemainingCents(installment, ledger) > 0,
  );
  const proofUploadAvailability = resolveArtistProofUploadAvailability({
    studioClosed: context.producerClosedAt !== null,
    purchaseCanceled: context.lifecycleStatus === "canceled",
    hasPendingProof: pending !== null,
    paidInFull,
    selectedPayable: isInstallmentPayableForInstructions(selected, now),
    selectedRemainingCents: amountDueNowCents,
    nextOutstandingInstallment: nextOutstandingInstallment
      ? {
          position: nextOutstandingInstallment.position,
          dueTrigger: nextOutstandingInstallment.dueTrigger,
          dueAt: nextOutstandingInstallment.dueAt,
        }
      : null,
  });
  const proofUploadsAvailable = proofUploadAvailability.status === "available";
  const serverSecret = requireServerSecret(input.serverSecret);

  return Object.freeze({
    purchaseId: context.purchaseId,
    purchaseRequestId: context.purchaseRequestId,
    producerId: context.producerId,
    productId: context.productId,
    projectId: context.projectId,
    installmentId: selected.id,
    installmentPosition: selected.position,
    installmentAmountCents: selected.amountCents,
    productName: context.commercialSnapshot.productOrOfferName,
    producerName: context.producerName ?? "Your producer",
    projectTitle: context.projectTitle,
    proofUploadsAvailable,
    proofUploadAvailability,
    currency: context.currency,
    totalCents: context.totalCents,
    paidCents: ledger.paidCents,
    pendingProofCents: pending?.amountCents ?? 0,
    remainingCents: exactPurchaseRemainingCents(installments, ledger),
    amountDueNowCents,
    availableToSubmitCents: proofUploadsAvailable ? amountDueNowCents : 0,
    paidInFull,
    proofs: proofs.map((proof) => {
      const installment = installmentById.get(proof.installmentId);
      if (!installment) {
        throw new PaymentProofDomainError(
          "INTEGRITY_ERROR",
          "Payment proof lost its exact installment",
        );
      }
      const token = createProofEvidenceToken(
        serverSecret,
        {
          proofId: proof.id,
          viewerClerkUserId: input.clerkUserId,
          viewerRole: "artist",
        },
        now,
      );
      return Object.freeze({
        ...proofHistoryItem(proof, installment),
        evidenceUrl: evidenceHref(token),
      });
    }),
  });
}

export async function prepareArtistProofUpload(
  db: Db,
  input: {
    clerkUserId: string;
    purchaseId: string;
    installmentId: string;
    operationKey: string;
    originalFileName: string;
    contentType: ProofContentType;
    sizeBytes: number;
    serverSecret: string;
    now?: Date | undefined;
  },
): Promise<{ uploadUrl: string; uploadToken: string; expiresInSeconds: number }> {
  try {
    const originalFileName = normalizeProofFileName(input.originalFileName);
    assertProofUploadMetadata({ contentType: input.contentType, sizeBytes: input.sizeBytes });
    return await db.transaction(async (tx) => {
      const context = await loadArtistPurchaseContext(tx, input.clerkUserId, input.purchaseId);
      if (!context) throw new PaymentProofDomainError("NOT_FOUND", "Purchase was not found");

      // Hold this exact Producer row lock through both signing and presigning.
      // Closure either commits first (and this request fails) or waits until
      // the already-issued short-lived capability has its fixed expiry.
      const producerClosedAt = await lockProducerClosureState(tx, context.producerId);
      if (producerClosedAt !== null) {
        throw new PaymentProofDomainError(
          "CONFLICT",
          "A closed studio cannot accept a new payment proof",
        );
      }

      const state = await loadArtistPaymentProofState(tx, {
        clerkUserId: input.clerkUserId,
        purchaseId: input.purchaseId,
        installmentId: input.installmentId,
        serverSecret: input.serverSecret,
        now: input.now,
      });
      if (!state.proofUploadsAvailable) {
        throw new PaymentProofDomainError(
          "CONFLICT",
          "This installment is not ready for another payment proof",
        );
      }
      const signed = createProofUploadToken(
        requireServerSecret(input.serverSecret),
        {
          purchaseId: state.purchaseId,
          installmentId: state.installmentId,
          viewerClerkUserId: input.clerkUserId,
          originalFileName,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          operationKey: input.operationKey,
        },
        input.now,
      );
      const upload = await createPrivateProofUpload(input.serverSecret, signed.payload);
      return { ...upload, uploadToken: signed.token };
    });
  } catch (error) {
    asDomainError(error);
  }
}

export async function cancelArtistProofUpload(input: {
  clerkUserId: string;
  purchaseId: string;
  installmentId: string;
  uploadToken: string;
  serverSecret: CapabilityVerificationSecrets;
  now?: Date | undefined;
}): Promise<{ cancelled: true }> {
  try {
    const verified = resolveCapabilitySecret(input.serverSecret, (secret) =>
      verifyOwnedProofUploadToken(
        requireServerSecret(secret),
        input.uploadToken,
        {
          viewerClerkUserId: input.clerkUserId,
          purchaseId: input.purchaseId,
          installmentId: input.installmentId,
        },
        input.now,
      ),
    );
    const { secret: serverSecret, value: token } = verified;
    await deletePrivateProofStagingUpload(serverSecret, token);
    return { cancelled: true };
  } catch (error) {
    asDomainError(error);
  }
}

export function exactSignedProofReplay(
  proof: typeof paymentProofs.$inferSelect,
  input: {
    purchaseId: string;
    installmentId: string;
    producerId: string;
    amountCents: number;
    currency: string;
    storageKey: string;
    originalFileName: string;
    contentType: string;
    sizeBytes: number;
    note: string | null;
  },
): boolean {
  return (
    proof.purchaseId === input.purchaseId &&
    proof.installmentId === input.installmentId &&
    proof.producerId === input.producerId &&
    proof.amountCents === input.amountCents &&
    proof.currency === input.currency &&
    proof.storageKey === input.storageKey &&
    proof.originalFileName === input.originalFileName &&
    proof.contentType === input.contentType &&
    proof.sizeBytes === input.sizeBytes &&
    proof.note === input.note
  );
}

export type SubmitArtistProofResult = Readonly<{
  proofId: string;
  purchaseId: string;
  installmentId: string;
  productId: string | null;
  projectId: string;
  created: boolean;
  notification: Readonly<{
    proofId: string;
    producerId: string;
    purchaseId: string;
    projectId: string;
    artistName: string;
    productName: string;
    refNumber: string;
    amountCents: number;
    currency: string;
  }> | null;
}>;

export async function submitArtistPaymentProof(
  db: Db,
  input: {
    clerkUserId: string;
    purchaseId: string;
    installmentId: string;
    uploadToken: string;
    amountCents: number;
    note?: string | undefined;
    serverSecret: CapabilityVerificationSecrets;
    now?: Date | undefined;
  },
): Promise<SubmitArtistProofResult> {
  const now = input.now ?? new Date();
  const finalizationState: { storageKey: string | null } = { storageKey: null };
  let verifiedUpload: ReturnType<typeof verifyProofUploadToken> | null = null;
  let verifiedServerSecret: string | null = null;
  try {
    const verified = resolveCapabilitySecret(input.serverSecret, (secret) =>
      verifyProofUploadToken(requireServerSecret(secret), input.uploadToken, now),
    );
    const { secret: serverSecret, value: token } = verified;
    if (
      token.viewerClerkUserId !== input.clerkUserId ||
      token.purchaseId !== input.purchaseId ||
      token.installmentId !== input.installmentId
    ) {
      throw new PaymentProofDomainError("NOT_FOUND", "Proof upload was not found");
    }
    verifiedUpload = token;
    verifiedServerSecret = serverSecret;
    const note = normalizeProofNote(input.note);
    const finalStorageKey = proofObjectKeys(serverSecret, token.uploadId).finalKey;

    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`purchase-ledger:${input.purchaseId}`}, 0))`,
      );
      const context = await loadArtistPurchaseContext(
        tx,
        input.clerkUserId,
        input.purchaseId,
        true,
      );
      if (!context) throw new PaymentProofDomainError("NOT_FOUND", "Purchase was not found");
      const lockedProducerClosedAt = await lockProducerClosureState(tx, context.producerId);
      const installments = await loadInstallments(tx, context);
      const installment = installments.find((row) => row.id === input.installmentId);
      if (!installment) {
        throw new PaymentProofDomainError("NOT_FOUND", "Payment installment was not found");
      }
      const signedReplayInput = {
        purchaseId: context.purchaseId,
        installmentId: installment.id,
        producerId: context.producerId,
        amountCents: input.amountCents,
        currency: context.currency,
        storageKey: finalStorageKey,
        originalFileName: token.originalFileName,
        contentType: token.contentType,
        sizeBytes: token.sizeBytes,
        note,
      };
      const [existing] = await tx
        .select()
        .from(paymentProofs)
        .where(eq(paymentProofs.storageKey, finalStorageKey))
        .limit(1);
      if (existing) {
        if (!exactSignedProofReplay(existing, signedReplayInput)) {
          throw new PaymentProofDomainError(
            "CONFLICT",
            "This upload token already belongs to a different proof submission",
          );
        }
        return {
          proof: existing,
          context,
          created: false,
        };
      }
      if (lockedProducerClosedAt !== null) {
        throw new PaymentProofDomainError(
          "CONFLICT",
          "A closed studio cannot accept a new payment proof",
        );
      }
      if (context.lifecycleStatus === "canceled") {
        throw new PaymentProofDomainError("CONFLICT", "A canceled purchase cannot accept proof");
      }
      const [ledger, proofs] = await Promise.all([
        loadLedgerSnapshot(tx, context),
        loadProofRows(tx, context),
      ]);
      if (!isInstallmentPayableForInstructions(installment, now)) {
        throw new PaymentProofDomainError(
          "CONFLICT",
          "This installment is not currently collectible",
        );
      }
      if (
        proofs.some((proof) => proof.installmentId === installment.id && proof.status === "pending")
      ) {
        throw new PaymentProofDomainError(
          "CONFLICT",
          "This installment already has a proof waiting for review",
        );
      }
      assertProofAmount(input.amountCents, installmentRemainingCents(installment, ledger));

      // Keep the Producer closure lock through the final R2 copy. Closure
      // either wins first and rejects this write, or waits for this exact
      // submission to commit before starting its capability-expiry clock.
      const proofObject = await finalizePrivateProofUpload(serverSecret, token);
      finalizationState.storageKey = proofObject.storageKey;

      const replacedIds = new Set(
        proofs.map((proof) => proof.replacesProofId).filter((id): id is string => id !== null),
      );
      const replacesProof = [...proofs]
        .reverse()
        .find(
          (proof) =>
            proof.installmentId === installment.id &&
            proof.status === "rejected" &&
            !replacedIds.has(proof.id),
        );
      const [proof] = await tx
        .insert(paymentProofs)
        .values({
          purchaseId: context.purchaseId,
          installmentId: installment.id,
          producerId: context.producerId,
          projectId: context.projectId,
          clientContactId: context.clientContactId,
          replacesProofId: replacesProof?.id ?? null,
          amountCents: input.amountCents,
          currency: context.currency,
          storageBucket: "docs",
          storageKey: proofObject.storageKey,
          objectEtag: proofObject.objectEtag,
          originalFileName: token.originalFileName,
          contentType: proofObject.contentType,
          sizeBytes: proofObject.sizeBytes,
          status: "pending",
          note,
          createdAt: now,
        })
        .returning();
      if (!proof) {
        throw new PaymentProofDomainError("INTEGRITY_ERROR", "Proof insert did not return a row");
      }
      await tx
        .update(purchaseInstallments)
        .set({ status: "awaiting_review", updatedAt: now })
        .where(
          and(
            eq(purchaseInstallments.id, installment.id),
            eq(purchaseInstallments.purchaseId, context.purchaseId),
            eq(purchaseInstallments.producerId, context.producerId),
          ),
        );
      return { proof, context, created: true };
    });

    return Object.freeze({
      proofId: result.proof.id,
      purchaseId: result.context.purchaseId,
      installmentId: result.proof.installmentId,
      productId: result.context.productId,
      projectId: result.context.projectId,
      created: result.created,
      notification: result.created
        ? {
            proofId: result.proof.id,
            producerId: result.context.producerId,
            purchaseId: result.context.purchaseId,
            projectId: result.context.projectId,
            artistName: result.context.artistName,
            productName: result.context.commercialSnapshot.productOrOfferName,
            refNumber: result.context.refNumber,
            amountCents: result.proof.amountCents,
            currency: result.proof.currency,
          }
        : null,
    });
  } catch (error) {
    if (verifiedUpload && verifiedServerSecret) {
      try {
        await deletePrivateProofStagingUpload(verifiedServerSecret, verifiedUpload);
      } catch {
        console.error("[proof-storage] private staging cleanup failed");
      }
    }
    if (finalizationState.storageKey) {
      const finalizedStorageKey = finalizationState.storageKey;
      let persisted = false;
      try {
        const [row] = await db
          .select({ id: paymentProofs.id })
          .from(paymentProofs)
          .where(eq(paymentProofs.storageKey, finalizedStorageKey))
          .limit(1);
        persisted = Boolean(row);
      } catch {
        // A database failure can be ambiguous after commit. Preserve the
        // private object rather than deleting evidence a committed row owns.
        persisted = true;
      }
      if (!persisted) await deletePrivateProofObjectQuietly(finalizedStorageKey);
    }
    asDomainError(error);
  }
}

function producerProofSelection() {
  return {
    proofId: paymentProofs.id,
    purchaseId: paymentProofs.purchaseId,
    purchaseRequestId: purchases.purchaseRequestId,
    installmentId: paymentProofs.installmentId,
    installmentPosition: purchaseInstallments.position,
    installmentAmountCents: purchaseInstallments.amountCents,
    refNumber: purchases.refNumber,
    artistName: clientContacts.name,
    projectId: projects.id,
    projectTitle: projects.title,
    productNameSnapshot: purchases.commercialSnapshot,
    amountCents: paymentProofs.amountCents,
    totalCents: purchases.totalCents,
    currency: paymentProofs.currency,
    originalFileName: paymentProofs.originalFileName,
    contentType: paymentProofs.contentType,
    sizeBytes: paymentProofs.sizeBytes,
    proofNote: paymentProofs.note,
    status: paymentProofs.status,
    rejectionNote: paymentProofs.rejectionNote,
    confirmedAt: paymentProofs.confirmedAt,
    rejectedAt: paymentProofs.rejectedAt,
    createdAt: paymentProofs.createdAt,
  };
}

function producerProofJoins(db: ProofDb) {
  return db
    .select(producerProofSelection())
    .from(paymentProofs)
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, paymentProofs.purchaseId),
        eq(purchases.producerId, paymentProofs.producerId),
      ),
    )
    .innerJoin(
      purchaseInstallments,
      and(
        eq(purchaseInstallments.id, paymentProofs.installmentId),
        eq(purchaseInstallments.purchaseId, paymentProofs.purchaseId),
        eq(purchaseInstallments.producerId, paymentProofs.producerId),
      ),
    )
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, paymentProofs.clientContactId),
        eq(clientContacts.producerId, paymentProofs.producerId),
      ),
    )
    .innerJoin(
      projects,
      and(
        eq(projects.id, paymentProofs.projectId),
        eq(projects.producerId, paymentProofs.producerId),
        eq(projects.clientContactId, paymentProofs.clientContactId),
      ),
    );
}

type ProducerProofRow = Awaited<ReturnType<ReturnType<typeof producerProofJoins>["limit"]>>[number];

function toProducerHistory(row: ProducerProofRow): ProducerPaymentProofHistory {
  return Object.freeze({
    proofId: row.proofId,
    purchaseId: row.purchaseId,
    purchaseRequestId: row.purchaseRequestId,
    installmentId: row.installmentId,
    installmentPosition: row.installmentPosition,
    installmentAmountCents: row.installmentAmountCents,
    refNumber: row.refNumber,
    artistName: row.artistName,
    projectId: row.projectId,
    projectTitle: row.projectTitle,
    productNameSnapshot: row.productNameSnapshot.productOrOfferName,
    amountCents: row.amountCents,
    totalCents: row.totalCents,
    currency: row.currency,
    originalFileName: row.originalFileName ?? "Payment proof",
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    proofNote: row.proofNote,
    status: row.status,
    rejectionNote: row.rejectionNote,
    confirmedAt: row.confirmedAt,
    rejectedAt: row.rejectedAt,
    createdAt: row.createdAt,
  });
}

function toProducerPending(row: ProducerProofRow): ProducerPendingPaymentProof {
  const proof = toProducerHistory(row);
  return Object.freeze({
    proofId: proof.proofId,
    purchaseId: proof.purchaseId,
    purchaseRequestId: proof.purchaseRequestId,
    installmentId: proof.installmentId,
    installmentPosition: proof.installmentPosition,
    installmentAmountCents: proof.installmentAmountCents,
    refNumber: proof.refNumber,
    artistName: proof.artistName,
    projectId: proof.projectId,
    projectTitle: proof.projectTitle,
    productNameSnapshot: proof.productNameSnapshot,
    amountCents: proof.amountCents,
    totalCents: proof.totalCents,
    currency: proof.currency,
    originalFileName: proof.originalFileName,
    contentType: proof.contentType,
    sizeBytes: proof.sizeBytes,
    proofNote: proof.proofNote,
    createdAt: proof.createdAt,
  });
}

export async function listProducerPendingPaymentProofs(
  db: Db,
  producerId: string,
  purchaseId?: string,
): Promise<readonly ProducerPendingPaymentProof[]> {
  const rows = await producerProofJoins(db)
    .where(
      and(
        eq(paymentProofs.producerId, producerId),
        eq(paymentProofs.status, "pending"),
        purchaseId ? eq(paymentProofs.purchaseId, purchaseId) : undefined,
      ),
    )
    .orderBy(desc(paymentProofs.createdAt), desc(paymentProofs.id));
  return rows.map(toProducerPending);
}

export async function listProducerPaymentProofHistory(
  db: Db,
  input: {
    producerId: string;
    purchaseId?: string | undefined;
    clientContactId?: string | undefined;
    limit?: number | undefined;
  },
): Promise<readonly ProducerPaymentProofHistory[]> {
  const limit = Math.min(200, Math.max(1, input.limit ?? 100));
  const rows = await producerProofJoins(db)
    .where(
      and(
        eq(paymentProofs.producerId, input.producerId),
        input.purchaseId ? eq(paymentProofs.purchaseId, input.purchaseId) : undefined,
        input.clientContactId
          ? eq(paymentProofs.clientContactId, input.clientContactId)
          : undefined,
      ),
    )
    .orderBy(desc(paymentProofs.createdAt), desc(paymentProofs.id))
    .limit(limit);
  return rows.map(toProducerHistory);
}

async function loadProducerProofRow(
  db: ProofDb,
  producerId: string,
  proofId: string,
): Promise<ProducerProofRow | null> {
  const [row] = await producerProofJoins(db)
    .where(and(eq(paymentProofs.id, proofId), eq(paymentProofs.producerId, producerId)))
    .limit(1);
  return row ?? null;
}

export async function loadProducerPaymentProofReview(
  db: Db,
  input: {
    producerId: string;
    clerkUserId: string;
    proofId: string;
    serverSecret: string;
    now?: Date | undefined;
  },
): Promise<ProducerPaymentProofReview> {
  const row = await loadProducerProofRow(db, input.producerId, input.proofId);
  if (!row) throw new PaymentProofDomainError("NOT_FOUND", "Payment proof was not found");
  const history = await listProducerPaymentProofHistory(db, {
    producerId: input.producerId,
    purchaseId: row.purchaseId,
  });
  const token = createProofEvidenceToken(
    requireServerSecret(input.serverSecret),
    {
      proofId: row.proofId,
      viewerClerkUserId: input.clerkUserId,
      viewerRole: "producer",
    },
    input.now,
  );
  return Object.freeze({
    proof: toProducerHistory(row),
    evidenceUrl: evidenceHref(token),
    evidenceExpiresInSeconds: PROOF_EVIDENCE_TTL_SECONDS,
    history,
  });
}

type EvidenceRecord = Readonly<{
  proofId: string;
  storageKey: string;
  objectEtag: string;
  contentType: string;
  sizeBytes: number;
  originalFileName: string;
}>;

function evidenceSelection() {
  return {
    proofId: paymentProofs.id,
    storageKey: paymentProofs.storageKey,
    objectEtag: paymentProofs.objectEtag,
    contentType: paymentProofs.contentType,
    sizeBytes: paymentProofs.sizeBytes,
    originalFileName: paymentProofs.originalFileName,
  };
}

export async function authorizePrivateProofEvidence(
  db: Db,
  input:
    | { role: "producer"; clerkUserId: string; proofId: string }
    | { role: "artist"; clerkUserId: string; proofId: string },
): Promise<EvidenceRecord> {
  if (input.role === "producer") {
    const [row] = await db
      .select(evidenceSelection())
      .from(paymentProofs)
      .innerJoin(producers, eq(producers.id, paymentProofs.producerId))
      .where(and(eq(paymentProofs.id, input.proofId), eq(producers.clerkUserId, input.clerkUserId)))
      .limit(1);
    if (!row) throw new PaymentProofDomainError("NOT_FOUND", "Payment proof was not found");
    return { ...row, originalFileName: row.originalFileName ?? "payment-proof" };
  }

  const [row] = await db
    .select(evidenceSelection())
    .from(paymentProofs)
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, paymentProofs.clientContactId),
        eq(clientContacts.producerId, paymentProofs.producerId),
      ),
    )
    .where(
      and(
        eq(paymentProofs.id, input.proofId),
        eq(clientContacts.clerkUserId, input.clerkUserId),
        isNull(clientContacts.archivedAt),
      ),
    )
    .limit(1);
  if (row) return { ...row, originalFileName: row.originalFileName ?? "payment-proof" };

  const [historical] = await db
    .select({
      ...evidenceSelection(),
      producerId: paymentProofs.producerId,
    })
    .from(paymentProofs)
    .innerJoin(
      artistHistoricalAccessGrants,
      and(
        eq(artistHistoricalAccessGrants.resourceType, "payment_proof"),
        eq(artistHistoricalAccessGrants.resourceId, paymentProofs.id),
        eq(artistHistoricalAccessGrants.producerId, paymentProofs.producerId),
      ),
    )
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, paymentProofs.clientContactId),
        eq(clientContacts.producerId, paymentProofs.producerId),
        eq(clientContacts.clerkUserId, input.clerkUserId),
      ),
    )
    .where(
      and(
        eq(paymentProofs.id, input.proofId),
        eq(artistHistoricalAccessGrants.artistClerkUserId, input.clerkUserId),
      ),
    )
    .limit(1);
  if (!historical) {
    throw new PaymentProofDomainError("NOT_FOUND", "Payment proof was not found");
  }
  const [studioGrant] = await db
    .select({ resourceId: artistHistoricalAccessGrants.resourceId })
    .from(artistHistoricalAccessGrants)
    .where(
      and(
        eq(artistHistoricalAccessGrants.artistClerkUserId, input.clerkUserId),
        eq(artistHistoricalAccessGrants.producerId, historical.producerId),
        eq(artistHistoricalAccessGrants.resourceType, "studio"),
        eq(artistHistoricalAccessGrants.resourceId, historical.producerId),
      ),
    )
    .limit(1);
  if (!studioGrant) {
    throw new PaymentProofDomainError("NOT_FOUND", "Payment proof was not found");
  }
  return {
    proofId: historical.proofId,
    storageKey: historical.storageKey,
    objectEtag: historical.objectEtag,
    contentType: historical.contentType,
    sizeBytes: historical.sizeBytes,
    originalFileName: historical.originalFileName ?? "payment-proof",
  };
}

async function markProofNotificationRead(
  db: ProofDb,
  producerId: string,
  proofId: string,
  now: Date,
) {
  await db
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(notifications.id, proofId),
        eq(notifications.producerId, producerId),
        eq(notifications.kind, "proof_submitted"),
      ),
    );
}

export type ProofDecisionEmail = Readonly<{
  artistEmail: string;
  artistName: string;
  producerName: string;
  productName: string;
  refNumber: string;
  currency: string;
  amountCents: number;
  paidCents: number;
  totalCents: number;
  paidInFull: boolean;
  rejectionNote?: string | undefined;
}>;

export type ConfirmProducerProofResult = Readonly<{
  proofId: string;
  purchaseId: string;
  installmentId: string;
  projectId: string;
  paymentId: string;
  proofStatus: "confirmed";
  installmentStatus: InstallmentStatus;
  firstInstallmentPaid: boolean;
  paidInFull: boolean;
  created: boolean;
  email: ProofDecisionEmail | null;
}>;

export async function confirmProducerPaymentProof(
  db: Db,
  input: {
    producerId: string;
    clerkUserId: string;
    proofId: string;
    now?: Date | undefined;
  },
): Promise<ConfirmProducerProofResult> {
  const now = input.now ?? new Date();
  const initial = await loadProducerProofRow(db, input.producerId, input.proofId);
  if (!initial) throw new PaymentProofDomainError("NOT_FOUND", "Payment proof was not found");

  try {
    return await db.transaction(async (tx) => {
      const ledgerScope = { producerId: input.producerId, purchaseId: initial.purchaseId };
      await lockPurchaseLedgerScope(tx, ledgerScope);
      const context = await loadProducerPurchaseContext(
        tx,
        input.producerId,
        initial.purchaseId,
        true,
      );
      if (!context) throw new PaymentProofDomainError("NOT_FOUND", "Payment proof was not found");
      const [proof] = await tx
        .select()
        .from(paymentProofs)
        .where(
          and(
            eq(paymentProofs.id, input.proofId),
            eq(paymentProofs.purchaseId, context.purchaseId),
            eq(paymentProofs.producerId, input.producerId),
          ),
        )
        .limit(1);
      if (!proof) throw new PaymentProofDomainError("NOT_FOUND", "Payment proof was not found");
      const decision = decideProofTransition(
        proof.status,
        { kind: "confirm" },
        proof.rejectionNote,
      );
      const installments = await loadInstallments(tx, context);
      const installment = installments.find((row) => row.id === proof.installmentId);
      if (!installment) {
        throw new PaymentProofDomainError(
          "INTEGRITY_ERROR",
          "Payment proof lost its exact installment",
        );
      }

      let paidAt = proof.confirmedAt ?? now;
      if (decision.changed) {
        const ledgerBefore = await loadLedgerSnapshot(tx, context);
        assertProofAmount(proof.amountCents, installmentRemainingCents(installment, ledgerBefore));
        const [confirmed] = await tx
          .update(paymentProofs)
          .set({ status: "confirmed", confirmedAt: now })
          .where(
            and(
              eq(paymentProofs.id, proof.id),
              eq(paymentProofs.producerId, input.producerId),
              eq(paymentProofs.status, "pending"),
            ),
          )
          .returning({ id: paymentProofs.id });
        if (!confirmed) {
          throw new PaymentProofDomainError(
            "CONFLICT",
            "This proof changed in another review. Refresh and try again",
          );
        }
        paidAt = now;
      }

      const operationKey = `proof:${proof.id}`;
      const ledgerResult = await recordConfirmedPurchasePayment(
        purchaseLedgerRepositoryForTransaction(tx, ledgerScope),
        {
          producerId: context.producerId,
          purchaseId: context.purchaseId,
          installmentId: installment.id,
          operationKey,
          source: "proof",
          proofId: proof.id,
          amountCents: proof.amountCents,
          currency: proof.currency,
          paidAt,
          actorId: input.clerkUserId,
          note: proof.note,
          occurredAt: now,
        },
      );
      if (ledgerResult.created !== decision.changed) {
        throw new PaymentProofDomainError(
          "INTEGRITY_ERROR",
          "Payment proof and immutable payment history disagree",
        );
      }
      const projectedInstallment = ledgerResult.projection.installments.find(
        (row) => row.id === installment.id,
      );
      const firstInstallment = ledgerResult.projection.installments[0];
      if (!projectedInstallment || !firstInstallment) {
        throw new PaymentProofDomainError(
          "INTEGRITY_ERROR",
          "Confirmed proof lost its accepted installment schedule",
        );
      }
      const installmentStatus = projectedInstallment.status;
      const firstInstallmentPaid = firstInstallment.paidCents >= firstInstallment.amountCents;
      await markProofNotificationRead(tx, input.producerId, proof.id, now);
      const paidInFull = ledgerResult.projection.fullyPaidForDownloads;
      const created = ledgerResult.created;
      return Object.freeze({
        proofId: proof.id,
        purchaseId: context.purchaseId,
        installmentId: installment.id,
        projectId: context.projectId,
        paymentId: ledgerResult.record.id,
        proofStatus: "confirmed" as const,
        installmentStatus,
        firstInstallmentPaid,
        paidInFull,
        created,
        email: created
          ? {
              artistEmail: context.artistEmail,
              artistName: context.artistName,
              producerName: context.producerName ?? "Your producer",
              productName: context.commercialSnapshot.productOrOfferName,
              refNumber: context.refNumber,
              currency: context.currency,
              amountCents: proof.amountCents,
              paidCents: ledgerResult.projection.paidCents,
              totalCents: context.totalCents,
              paidInFull,
            }
          : null,
      });
    });
  } catch (error) {
    asDomainError(error);
  }
}

export type RejectProducerProofResult = Readonly<{
  proofId: string;
  purchaseId: string;
  installmentId: string;
  projectId: string;
  proofStatus: "rejected";
  installmentStatus: InstallmentStatus;
  changed: boolean;
  email: ProofDecisionEmail | null;
}>;

export async function rejectProducerPaymentProof(
  db: Db,
  input: {
    producerId: string;
    clerkUserId: string;
    proofId: string;
    note: string;
    now?: Date | undefined;
  },
): Promise<RejectProducerProofResult> {
  const now = input.now ?? new Date();
  const initial = await loadProducerProofRow(db, input.producerId, input.proofId);
  if (!initial) throw new PaymentProofDomainError("NOT_FOUND", "Payment proof was not found");
  try {
    return await db.transaction(async (tx) => {
      const ledgerScope = { producerId: input.producerId, purchaseId: initial.purchaseId };
      await lockPurchaseLedgerScope(tx, ledgerScope);
      const context = await loadProducerPurchaseContext(
        tx,
        input.producerId,
        initial.purchaseId,
        true,
      );
      if (!context) throw new PaymentProofDomainError("NOT_FOUND", "Payment proof was not found");
      const [proof] = await tx
        .select()
        .from(paymentProofs)
        .where(
          and(
            eq(paymentProofs.id, input.proofId),
            eq(paymentProofs.purchaseId, context.purchaseId),
            eq(paymentProofs.producerId, input.producerId),
          ),
        )
        .limit(1);
      if (!proof) throw new PaymentProofDomainError("NOT_FOUND", "Payment proof was not found");
      const decision = decideProofTransition(
        proof.status,
        { kind: "reject", note: input.note },
        proof.rejectionNote,
      );
      if (decision.kind !== "reject") {
        throw new PaymentProofDomainError("INTEGRITY_ERROR", "Invalid proof rejection decision");
      }
      const installments = await loadInstallments(tx, context);
      const installment = installments.find((row) => row.id === proof.installmentId);
      if (!installment) {
        throw new PaymentProofDomainError(
          "INTEGRITY_ERROR",
          "Payment proof lost its exact installment",
        );
      }
      if (decision.changed) {
        const [rejected] = await tx
          .update(paymentProofs)
          .set({
            status: "rejected",
            rejectionNote: decision.rejectionNote,
            rejectedAt: now,
          })
          .where(
            and(
              eq(paymentProofs.id, proof.id),
              eq(paymentProofs.producerId, input.producerId),
              eq(paymentProofs.status, "pending"),
            ),
          )
          .returning({ id: paymentProofs.id });
        if (!rejected) {
          throw new PaymentProofDomainError(
            "CONFLICT",
            "This proof changed in another review. Refresh and try again",
          );
        }
      }
      const reconciled = await reconcilePurchaseLedger(
        purchaseLedgerRepositoryForTransaction(tx, ledgerScope),
        { ...ledgerScope, asOf: now },
      );
      const projectedInstallment = reconciled.projection.installments.find(
        (row) => row.id === installment.id,
      );
      if (!projectedInstallment) {
        throw new PaymentProofDomainError(
          "INTEGRITY_ERROR",
          "Rejected proof lost its exact installment",
        );
      }
      const installmentStatus = projectedInstallment.status;
      await markProofNotificationRead(tx, input.producerId, proof.id, now);
      return Object.freeze({
        proofId: proof.id,
        purchaseId: context.purchaseId,
        installmentId: installment.id,
        projectId: context.projectId,
        proofStatus: "rejected" as const,
        installmentStatus,
        changed: decision.changed,
        email: decision.changed
          ? {
              artistEmail: context.artistEmail,
              artistName: context.artistName,
              producerName: context.producerName ?? "Your producer",
              productName: context.commercialSnapshot.productOrOfferName,
              refNumber: context.refNumber,
              currency: context.currency,
              amountCents: proof.amountCents,
              paidCents: reconciled.projection.paidCents,
              totalCents: context.totalCents,
              paidInFull: reconciled.projection.fullyPaidForDownloads,
              rejectionNote: decision.rejectionNote,
            }
          : null,
      });
    });
  } catch (error) {
    asDomainError(error);
  }
}
