import { eq, paymentProofs, type Db } from "@skitza/db";

import { isInstallmentPayableForInstructions } from "~/server/domain/payment-instructions/policy";
import {
  lockPurchaseLedgerScope,
  purchaseLedgerRepositoryForTransaction,
} from "~/server/domain/purchase-ledger/db";
import { recordConfirmedPurchasePayment } from "~/server/domain/purchase-ledger/service";
import {
  resolveCapabilitySecret,
  type CapabilityVerificationSecrets,
} from "~/server/security/capability-secrets";

import {
  assertProofUploadMetadata,
  normalizeProofFileName,
  normalizeProofNote,
  type ProofContentType,
} from "./policy";
import {
  asDomainError,
  cancelArtistProofUpload,
  exactSignedProofReplay,
  installmentRemainingCents,
  loadInstallments,
  loadLedgerSnapshot,
  loadProducerPurchaseContext,
  loadProofRows,
  lockProducerClosureState,
  PaymentProofDomainError,
  requireServerSecret,
  type InstallmentRow,
  type LedgerSnapshot,
  type ProofDecisionEmail,
  type ProofDb,
  type PurchaseContext,
} from "./service";
import {
  createPrivateProofUpload,
  deletePrivateProofObjectQuietly,
  deletePrivateProofStagingUpload,
  finalizePrivateProofUpload,
} from "./storage";
import { createProofUploadToken, proofObjectKeys, verifyProofUploadToken } from "./tokens";

// SK-260 — a producer records money received outside Skitza (cash, bank
// transfer, Bit) on one installment, optionally attaching the receipt the
// client sent them. The receipt reuses the private proof pipeline, but it is
// inserted already `confirmed`: the producer is the reviewer, so there is
// nothing left to review. The payment itself is a regular `manual` ledger
// row, so every downstream rule (activation, downloads, reminders) is shared
// with artist-submitted proofs.

type ManualPaymentBlocker =
  | "purchase_canceled"
  | "studio_closed"
  | "installment_settled"
  | "installment_not_due"
  | "proof_pending"
  | "nothing_remaining";

const BLOCKER_MESSAGES: Readonly<Record<ManualPaymentBlocker, string>> = {
  purchase_canceled: "A canceled purchase cannot take a payment",
  studio_closed: "A closed studio cannot record a payment",
  installment_settled: "This payment is already settled",
  installment_not_due: "This payment is not due yet",
  proof_pending:
    "This payment has a proof waiting for review. Confirm or reject that proof instead.",
  nothing_remaining: "Nothing is left to pay on this installment",
};

function blocked(reason: ManualPaymentBlocker): never {
  throw new PaymentProofDomainError("CONFLICT", BLOCKER_MESSAGES[reason]);
}

/**
 * Shared eligibility gate for both the presign and the final record step,
 * so a receipt can only be staged for an installment that can actually take
 * the payment right now.
 */
export function assertInstallmentAcceptsManualPayment(input: {
  context: Pick<PurchaseContext, "lifecycleStatus" | "producerClosedAt">;
  installment: InstallmentRow;
  ledger: LedgerSnapshot;
  proofs: readonly Pick<(typeof paymentProofs)["$inferSelect"], "installmentId" | "status">[];
  now: Date;
}): number {
  if (input.context.producerClosedAt !== null) blocked("studio_closed");
  if (input.context.lifecycleStatus === "canceled") blocked("purchase_canceled");
  if (
    input.proofs.some(
      (proof) => proof.installmentId === input.installment.id && proof.status === "pending",
    )
  ) {
    blocked("proof_pending");
  }
  const status = input.installment.status;
  if (status === "confirmed" || status === "waived" || status === "canceled") {
    blocked("installment_settled");
  }
  if (!isInstallmentPayableForInstructions(input.installment, input.now)) {
    blocked("installment_not_due");
  }
  const remaining = installmentRemainingCents(input.installment, input.ledger);
  if (remaining <= 0) blocked("nothing_remaining");
  return remaining;
}

function assertManualAmount(amountCents: number, remainingCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new PaymentProofDomainError("INVALID_INPUT", "Enter an amount above zero");
  }
  if (amountCents > remainingCents) {
    throw new PaymentProofDomainError(
      "INVALID_INPUT",
      "The amount is more than what is left on this payment",
    );
  }
}

async function loadOwnedInstallment(
  tx: ProofDb,
  context: PurchaseContext,
  installmentId: string,
): Promise<InstallmentRow> {
  const installments = await loadInstallments(tx, context);
  const installment = installments.find((row) => row.id === installmentId);
  if (!installment) {
    throw new PaymentProofDomainError("NOT_FOUND", "Payment installment was not found");
  }
  return installment;
}

export async function prepareProducerReceiptUpload(
  db: Db,
  input: {
    producerId: string;
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
  const now = input.now ?? new Date();
  try {
    const originalFileName = normalizeProofFileName(input.originalFileName);
    assertProofUploadMetadata({ contentType: input.contentType, sizeBytes: input.sizeBytes });
    return await db.transaction(async (tx) => {
      const context = await loadProducerPurchaseContext(tx, input.producerId, input.purchaseId);
      if (!context) throw new PaymentProofDomainError("NOT_FOUND", "Purchase was not found");
      const producerClosedAt = await lockProducerClosureState(tx, context.producerId);
      const installment = await loadOwnedInstallment(tx, context, input.installmentId);
      const [ledger, proofs] = await Promise.all([
        loadLedgerSnapshot(tx, context),
        loadProofRows(tx, context),
      ]);
      assertInstallmentAcceptsManualPayment({
        context: { lifecycleStatus: context.lifecycleStatus, producerClosedAt },
        installment,
        ledger,
        proofs,
        now,
      });
      const signed = createProofUploadToken(
        requireServerSecret(input.serverSecret),
        {
          purchaseId: context.purchaseId,
          installmentId: installment.id,
          viewerClerkUserId: input.clerkUserId,
          originalFileName,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          operationKey: input.operationKey,
        },
        now,
      );
      const upload = await createPrivateProofUpload(input.serverSecret, signed.payload);
      return { ...upload, uploadToken: signed.token };
    });
  } catch (error) {
    asDomainError(error);
  }
}

/** Token ownership is the only check, so the artist implementation is reused as-is. */
export const cancelProducerReceiptUpload = cancelArtistProofUpload;

export type RecordProducerManualPaymentResult = Readonly<{
  paymentId: string;
  proofId: string | null;
  purchaseId: string;
  installmentId: string;
  installmentPosition: number;
  projectId: string;
  installmentStatus: InstallmentRow["status"];
  paidInFull: boolean;
  created: boolean;
  artistClerkUserId: string | null;
  email: ProofDecisionEmail | null;
}>;

export async function recordProducerManualPayment(
  db: Db,
  input: {
    producerId: string;
    clerkUserId: string;
    purchaseId: string;
    installmentId: string;
    operationKey: string;
    amountCents: number;
    paidAt: Date;
    note?: string | undefined;
    uploadToken?: string | undefined;
    serverSecret: CapabilityVerificationSecrets;
    now?: Date | undefined;
  },
): Promise<RecordProducerManualPaymentResult> {
  const now = input.now ?? new Date();
  const finalizationState: { storageKey: string | null } = { storageKey: null };
  let verifiedUpload: ReturnType<typeof verifyProofUploadToken> | null = null;
  let verifiedServerSecret: string | null = null;
  try {
    const note = normalizeProofNote(input.note);
    if (Number.isNaN(input.paidAt.getTime()) || input.paidAt.getTime() > now.getTime() + 60_000) {
      throw new PaymentProofDomainError(
        "INVALID_INPUT",
        "The payment date cannot be in the future",
      );
    }

    let finalStorageKey: string | null = null;
    if (input.uploadToken) {
      const verified = resolveCapabilitySecret(input.serverSecret, (secret) =>
        verifyProofUploadToken(requireServerSecret(secret), input.uploadToken ?? "", now),
      );
      const { secret: serverSecret, value: token } = verified;
      if (
        token.viewerClerkUserId !== input.clerkUserId ||
        token.purchaseId !== input.purchaseId ||
        token.installmentId !== input.installmentId
      ) {
        throw new PaymentProofDomainError("NOT_FOUND", "Receipt upload was not found");
      }
      verifiedUpload = token;
      verifiedServerSecret = serverSecret;
      finalStorageKey = proofObjectKeys(serverSecret, token.uploadId).finalKey;
    }

    const result = await db.transaction(async (tx) => {
      const ledgerScope = { producerId: input.producerId, purchaseId: input.purchaseId };
      await lockPurchaseLedgerScope(tx, ledgerScope);
      const context = await loadProducerPurchaseContext(
        tx,
        input.producerId,
        input.purchaseId,
        true,
      );
      if (!context) throw new PaymentProofDomainError("NOT_FOUND", "Purchase was not found");
      const producerClosedAt = await lockProducerClosureState(tx, context.producerId);
      const installment = await loadOwnedInstallment(tx, context, input.installmentId);
      const [ledger, proofs] = await Promise.all([
        loadLedgerSnapshot(tx, context),
        loadProofRows(tx, context),
      ]);

      let proofId: string | null = null;
      let proofCreated = false;
      const replayedProof =
        finalStorageKey !== null
          ? proofs.find((proof) => proof.storageKey === finalStorageKey)
          : undefined;
      if (replayedProof && verifiedUpload) {
        if (
          !exactSignedProofReplay(replayedProof, {
            purchaseId: context.purchaseId,
            installmentId: installment.id,
            producerId: context.producerId,
            amountCents: input.amountCents,
            currency: context.currency,
            storageKey: replayedProof.storageKey,
            originalFileName: verifiedUpload.originalFileName,
            contentType: verifiedUpload.contentType,
            sizeBytes: verifiedUpload.sizeBytes,
            note,
          })
        ) {
          throw new PaymentProofDomainError(
            "CONFLICT",
            "This receipt already belongs to a different payment",
          );
        }
        proofId = replayedProof.id;
      } else {
        // A fresh write (not an exact replay) must pass the full gate.
        const remaining = assertInstallmentAcceptsManualPayment({
          context: { lifecycleStatus: context.lifecycleStatus, producerClosedAt },
          installment,
          ledger,
          proofs,
          now,
        });
        assertManualAmount(input.amountCents, remaining);

        if (verifiedUpload && verifiedServerSecret) {
          const proofObject = await finalizePrivateProofUpload(
            verifiedServerSecret,
            verifiedUpload,
          );
          finalizationState.storageKey = proofObject.storageKey;
          const [proof] = await tx
            .insert(paymentProofs)
            .values({
              purchaseId: context.purchaseId,
              installmentId: installment.id,
              producerId: context.producerId,
              projectId: context.projectId,
              clientContactId: context.clientContactId,
              replacesProofId: null,
              amountCents: input.amountCents,
              currency: context.currency,
              storageBucket: "docs",
              storageKey: proofObject.storageKey,
              objectEtag: proofObject.objectEtag,
              originalFileName: verifiedUpload.originalFileName,
              contentType: proofObject.contentType,
              sizeBytes: proofObject.sizeBytes,
              status: "confirmed",
              note,
              confirmedAt: now,
              createdAt: now,
            })
            .returning({ id: paymentProofs.id });
          if (!proof) {
            throw new PaymentProofDomainError(
              "INTEGRITY_ERROR",
              "Receipt insert did not return a row",
            );
          }
          proofId = proof.id;
          proofCreated = true;
        }
      }

      const ledgerResult = await recordConfirmedPurchasePayment(
        purchaseLedgerRepositoryForTransaction(tx, ledgerScope),
        {
          producerId: context.producerId,
          purchaseId: context.purchaseId,
          installmentId: installment.id,
          operationKey: input.operationKey,
          source: "manual",
          proofId,
          amountCents: input.amountCents,
          currency: context.currency,
          paidAt: input.paidAt,
          actorId: input.clerkUserId,
          note,
          occurredAt: now,
        },
      );
      if (proofCreated && !ledgerResult.created) {
        throw new PaymentProofDomainError(
          "INTEGRITY_ERROR",
          "Receipt and immutable payment history disagree",
        );
      }
      const projectedInstallment = ledgerResult.projection.installments.find(
        (row) => row.id === installment.id,
      );
      if (!projectedInstallment) {
        throw new PaymentProofDomainError(
          "INTEGRITY_ERROR",
          "Recorded payment lost its accepted installment schedule",
        );
      }
      const paidInFull = ledgerResult.projection.fullyPaidForDownloads;
      return Object.freeze({
        paymentId: ledgerResult.record.id,
        proofId,
        purchaseId: context.purchaseId,
        installmentId: installment.id,
        installmentPosition: installment.position,
        projectId: context.projectId,
        installmentStatus: projectedInstallment.status,
        paidInFull,
        created: ledgerResult.created,
        artistClerkUserId: context.artistClerkUserId,
        email: ledgerResult.created
          ? {
              artistEmail: context.artistEmail,
              artistName: context.artistName,
              producerName: context.producerName ?? "Your producer",
              productName: context.commercialSnapshot.productOrOfferName,
              refNumber: context.refNumber,
              currency: context.currency,
              amountCents: input.amountCents,
              paidCents: ledgerResult.projection.paidCents,
              totalCents: context.totalCents,
              paidInFull,
            }
          : null,
      });
    });

    // Finalize already removes the staging copy on a fresh write. On an exact
    // replay nothing was finalized, so a re-uploaded staging object would
    // otherwise linger in the private bucket.
    if (verifiedUpload && verifiedServerSecret && !result.created) {
      try {
        await deletePrivateProofStagingUpload(verifiedServerSecret, verifiedUpload);
      } catch {
        console.error("[proof-storage] private staging cleanup failed");
      }
    }
    return result;
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
        persisted = true;
      }
      if (!persisted) await deletePrivateProofObjectQuietly(finalizedStorageKey);
    }
    asDomainError(error);
  }
}
