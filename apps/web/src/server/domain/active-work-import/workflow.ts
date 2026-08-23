import type { Db } from "@skitza/db";

import { AgreementPdfStorageError } from "../agreement-pdfs/storage";
import { deletePrivateProofObjectQuietly, ProofStorageError } from "../payment-proofs/storage";
import {
  ActiveWorkImportAgreementPdfCapabilityError,
  createActiveWorkImportAgreementPdfCapability,
  createActiveWorkImportAgreementPdfUpload,
  finalizeActiveWorkImportAgreementPdfUpload,
  verifyActiveWorkImportAgreementPdfCapability,
  type ActiveWorkImportAgreementPdfCapability,
} from "./agreement-pdf-capability";
import {
  assessStoredActiveWorkImportRow,
  cleanupUnpersistedActiveWorkImportProof,
  clearActiveWorkImportAgreementPdfUploadToken,
  clearActiveWorkImportProofUploadToken,
  loadActiveWorkImportBatch,
  loadUnmaterializedImportRow,
  markActiveWorkImportRowFailure,
  materializeActiveWorkImportRowTransaction,
  type ActiveWorkImportRowResult,
  type StoredActiveWorkImportRow,
} from "./db";
import {
  ActiveWorkImportProofCapabilityError,
  createActiveWorkImportProofCapability,
  createActiveWorkImportProofUpload,
  finalizeActiveWorkImportProofUpload,
  verifyActiveWorkImportProofCapability,
  type ActiveWorkImportProofCapability,
} from "./proof-capability";
import {
  ActiveWorkImportDomainError,
  activeWorkImportCreationDigest,
  type ActiveWorkImportReason,
  type NormalizedActiveWorkImport,
} from "./service";
import { digestCommercialSnapshot } from "../purchases/policy";

export async function prepareActiveWorkImportProof(
  db: Db,
  input: Readonly<{
    producerId: string;
    batchId: string;
    rowId: string;
    paymentOperationKey: string;
    originalFileName: string;
    contentType: string;
    sizeBytes: number;
    serverSecret: string;
  }>,
) {
  const row = await loadUnmaterializedImportRow(db, input);
  const rawPayments = Array.isArray(row.draftPayload.payments) ? row.draftPayload.payments : [];
  const matching = rawPayments.filter((raw) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
    return (raw as Record<string, unknown>).operationKey === input.paymentOperationKey;
  });
  if (matching.length !== 1) {
    throw new ActiveWorkImportDomainError(
      "INVALID_INPUT",
      "Save this payment row before adding its proof",
    );
  }
  const capability = createActiveWorkImportProofCapability(input.serverSecret, {
    producerId: input.producerId,
    batchId: input.batchId,
    rowId: input.rowId,
    paymentOperationKey: input.paymentOperationKey,
    originalFileName: input.originalFileName,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });
  const upload = await createActiveWorkImportProofUpload(input.serverSecret, capability.payload);
  return { ...upload, uploadToken: capability.token };
}

export async function prepareActiveWorkImportAgreementPdf(
  db: Db,
  input: Readonly<{
    producerId: string;
    batchId: string;
    rowId: string;
    originalFileName: string;
    contentType: string;
    sizeBytes: number;
    serverSecret: string;
  }>,
) {
  await loadUnmaterializedImportRow(db, input);
  const capability = createActiveWorkImportAgreementPdfCapability(input.serverSecret, {
    producerId: input.producerId,
    batchId: input.batchId,
    rowId: input.rowId,
    originalFileName: input.originalFileName,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });
  const upload = await createActiveWorkImportAgreementPdfUpload(
    input.serverSecret,
    capability.payload,
  );
  return { ...upload, uploadToken: capability.token };
}

function verifyImportAgreementPdf(
  verificationSecrets: readonly string[],
  token: string,
  expected: Readonly<{ producerId: string; batchId: string; rowId: string }>,
): Readonly<{ secret: string; capability: ActiveWorkImportAgreementPdfCapability }> {
  for (const secret of verificationSecrets) {
    try {
      return {
        secret,
        capability: verifyActiveWorkImportAgreementPdfCapability(secret, token, expected),
      };
    } catch (error) {
      if (!(error instanceof ActiveWorkImportAgreementPdfCapabilityError)) throw error;
    }
  }
  throw new ActiveWorkImportAgreementPdfCapabilityError();
}

function verifyImportProof(
  verificationSecrets: readonly string[],
  token: string,
  expected: Readonly<{
    producerId: string;
    batchId: string;
    rowId: string;
    paymentOperationKey: string;
  }>,
): Readonly<{ secret: string; capability: ActiveWorkImportProofCapability }> {
  for (const secret of verificationSecrets) {
    try {
      return {
        secret,
        capability: verifyActiveWorkImportProofCapability(secret, token, expected),
      };
    } catch (error) {
      if (!(error instanceof ActiveWorkImportProofCapabilityError)) throw error;
    }
  }
  throw new ActiveWorkImportProofCapabilityError();
}

type ReadyRow = Readonly<{
  state: "ready";
  row: StoredActiveWorkImportRow;
  normalized: NormalizedActiveWorkImport;
  creationDigest: string;
  proofCapabilities: ReadonlyMap<
    string,
    Readonly<{ secret: string; capability: ActiveWorkImportProofCapability }>
  >;
  agreementPdfCapability: Readonly<{
    secret: string;
    capability: ActiveWorkImportAgreementPdfCapability;
  }> | null;
}>;

type NeedsInfoRow = Readonly<{
  state: "needs_info";
  rowId: string;
  reasons: readonly ActiveWorkImportReason[];
}>;

/** Public review projection. Capability secrets, upload tokens, and internal
 * stored-row state stay server-only and can never cross tRPC serialization. */
export function publicActiveWorkImportAssessment(assessment: ReadyRow | NeedsInfoRow) {
  if (assessment.state === "needs_info") return assessment;
  return {
    state: "ready" as const,
    rowId: assessment.row.id,
    draftRevision: assessment.row.draftRevision,
    normalized: {
      ...assessment.normalized,
      agreementPdf: assessment.normalized.agreementPdf
        ? {
            fileName: assessment.normalized.agreementPdf.fileName,
            sizeBytes: assessment.normalized.agreementPdf.sizeBytes,
          }
        : null,
      payments: assessment.normalized.payments.map(({ proofUploadToken, ...payment }) => ({
        ...payment,
        hasProof: proofUploadToken !== null,
      })),
    },
    creationDigest: assessment.creationDigest,
  };
}

export async function assessActiveWorkImportRowForCreation(
  db: Db,
  input: Readonly<{
    producerId: string;
    batchId: string;
    rowId: string;
    verificationSecrets: readonly string[];
    asOf?: Date;
  }>,
): Promise<ReadyRow | NeedsInfoRow> {
  const asOf = input.asOf ?? new Date();
  const row = await loadUnmaterializedImportRow(db, input);
  const assessment = await assessStoredActiveWorkImportRow(db, { ...input, asOf });
  if (assessment.state === "needs_info") {
    return { state: "needs_info", rowId: row.id, reasons: assessment.reasons };
  }
  const verified = new Map<
    string,
    Readonly<{ secret: string; capability: ActiveWorkImportProofCapability }>
  >();
  const proofReasons: ActiveWorkImportReason[] = [];
  for (const payment of assessment.normalized.payments) {
    if (!payment.proofUploadToken) continue;
    try {
      verified.set(
        payment.operationKey,
        verifyImportProof(input.verificationSecrets, payment.proofUploadToken, {
          producerId: input.producerId,
          batchId: input.batchId,
          rowId: input.rowId,
          paymentOperationKey: payment.operationKey,
        }),
      );
    } catch (error) {
      if (!(error instanceof ActiveWorkImportProofCapabilityError)) throw error;
      proofReasons.push({
        code: "proof_invalid",
        field: `payments.${payment.operationKey}.proofUploadToken`,
        message: "Upload this payment proof again.",
      });
    }
  }
  if (proofReasons.length > 0) {
    return { state: "needs_info", rowId: row.id, reasons: proofReasons };
  }
  let agreementPdfCapability: ReadyRow["agreementPdfCapability"] = null;
  if (assessment.normalized.agreementPdf) {
    try {
      agreementPdfCapability = verifyImportAgreementPdf(
        input.verificationSecrets,
        assessment.normalized.agreementPdf.uploadToken,
        { producerId: input.producerId, batchId: input.batchId, rowId: input.rowId },
      );
    } catch (error) {
      if (!(error instanceof ActiveWorkImportAgreementPdfCapabilityError)) throw error;
      return {
        state: "needs_info",
        rowId: row.id,
        reasons: [
          {
            code: "agreement_pdf_invalid",
            field: "agreement.agreementPdf",
            message: "Upload the agreement PDF again.",
          },
        ],
      };
    }
  }
  const proofShape = [...verified.values()]
    .map(({ capability }) => ({
      paymentOperationKey: capability.paymentOperationKey,
      uploadId: capability.uploadId,
      originalFileName: capability.originalFileName,
      contentType: capability.contentType,
      sizeBytes: capability.sizeBytes,
    }))
    .sort((left, right) => left.paymentOperationKey.localeCompare(right.paymentOperationKey));
  return {
    state: "ready",
    row,
    normalized: assessment.normalized,
    creationDigest: activeWorkImportCreationDigest(
      assessment.normalized,
      proofShape,
      agreementPdfCapability
        ? {
            uploadId: agreementPdfCapability.capability.uploadId,
            originalFileName: agreementPdfCapability.capability.originalFileName,
            contentType: agreementPdfCapability.capability.contentType,
            sizeBytes: agreementPdfCapability.capability.sizeBytes,
          }
        : null,
    ),
    proofCapabilities: verified,
    agreementPdfCapability,
  };
}

/** Stable machine codes for `last_error_code`; raw error names are only logged. */
function errorCode(error: unknown): string {
  if (error instanceof ActiveWorkImportDomainError) return error.code;
  if (error instanceof ActiveWorkImportProofCapabilityError) return "PROOF_INVALID";
  if (error instanceof ProofStorageError) return "PROOF_UPLOAD_MISSING";
  if (error instanceof ActiveWorkImportAgreementPdfCapabilityError) return "AGREEMENT_PDF_INVALID";
  if (error instanceof AgreementPdfStorageError) return "AGREEMENT_PDF_UPLOAD_MISSING";
  return "UNEXPECTED";
}

function failureMessage(error: unknown): string {
  if (error instanceof ActiveWorkImportDomainError) return error.message;
  if (error instanceof ProofStorageError) {
    return "The payment proof file is no longer available. Attach it again and retry.";
  }
  if (error instanceof AgreementPdfStorageError) {
    return "The agreement PDF file is no longer available. Attach it again and retry.";
  }
  return "This row could not be created. Your draft is safe.";
}

export type MaterializeActiveWorkImportRowOutcome =
  | Readonly<{ state: "created"; result: ActiveWorkImportRowResult }>
  | NeedsInfoRow
  | Readonly<{ state: "failed"; rowId: string; code: string; message: string }>;

export async function materializeActiveWorkImportRow(
  db: Db,
  input: Readonly<{
    producerId: string;
    clerkUserId: string;
    batchId: string;
    rowId: string;
    expectedCreationDigest: string;
    verificationSecrets: readonly string[];
    importedAt?: Date;
  }>,
): Promise<MaterializeActiveWorkImportRowOutcome> {
  const importedAt = input.importedAt ?? new Date();
  const batch = await loadActiveWorkImportBatch(db, input);
  const stored = batch.rows.find((row) => row.id === input.rowId);
  if (!stored) throw new ActiveWorkImportDomainError("NOT_FOUND", "Import row was not found");
  if (stored.materializedAt) {
    if (
      stored.creationDigest !== input.expectedCreationDigest ||
      !stored.createdClientContactId ||
      !stored.createdProjectId ||
      !stored.createdPurchaseId
    ) {
      throw new ActiveWorkImportDomainError(
        "OPERATION_KEY_CONFLICT",
        "This import row was already created with different details",
      );
    }
    return {
      state: "created",
      result: {
        rowId: stored.id,
        clientContactId: stored.createdClientContactId,
        projectId: stored.createdProjectId,
        purchaseId: stored.createdPurchaseId,
        creationDigest: stored.creationDigest,
        materializedAt: stored.materializedAt,
        created: false,
      },
    };
  }

  const assessment = await assessActiveWorkImportRowForCreation(db, {
    producerId: input.producerId,
    batchId: input.batchId,
    rowId: input.rowId,
    verificationSecrets: input.verificationSecrets,
    asOf: importedAt,
  });
  if (assessment.state === "needs_info") return assessment;
  if (assessment.creationDigest !== input.expectedCreationDigest) {
    throw new ActiveWorkImportDomainError(
      "OPERATION_KEY_CONFLICT",
      "The reviewed import details changed. Review them and try again.",
    );
  }
  const finalizedStorageKeys: string[] = [];
  const missingProofOperationKeys: string[] = [];
  const missingAgreementPdfUploadIds: string[] = [];
  try {
    const capabilities = new Map(
      [...assessment.proofCapabilities].map(([key, value]) => [key, value.capability]),
    );
    const verifiedAgreementPdf = assessment.agreementPdfCapability;
    const result = await materializeActiveWorkImportRowTransaction(db, {
      agreementPdfCapability: verifiedAgreementPdf?.capability ?? null,
      finalizeAgreementPdf: async (capability) => {
        if (
          !verifiedAgreementPdf ||
          verifiedAgreementPdf.capability.uploadId !== capability.uploadId
        ) {
          throw new ActiveWorkImportAgreementPdfCapabilityError();
        }
        try {
          return await finalizeActiveWorkImportAgreementPdfUpload(
            verifiedAgreementPdf.secret,
            capability,
          );
        } catch (error) {
          if (error instanceof AgreementPdfStorageError) {
            missingAgreementPdfUploadIds.push(capability.uploadId);
          }
          throw error;
        }
      },
      producerId: input.producerId,
      clerkUserId: input.clerkUserId,
      batchId: input.batchId,
      rowId: input.rowId,
      expectedDraftRevision: assessment.row.draftRevision,
      expectedDraftDigest: digestCommercialSnapshot(assessment.row.draftPayload),
      creationDigest: assessment.creationDigest,
      normalized: assessment.normalized,
      proofCapabilities: capabilities,
      importedAt,
      finalizeProof: async (capability) => {
        const verified = assessment.proofCapabilities.get(capability.paymentOperationKey);
        if (!verified || verified.capability.uploadId !== capability.uploadId) {
          throw new ActiveWorkImportProofCapabilityError();
        }
        try {
          const storedProof = await finalizeActiveWorkImportProofUpload(
            verified.secret,
            capability,
          );
          finalizedStorageKeys.push(storedProof.storageKey);
          return storedProof;
        } catch (error) {
          if (error instanceof ProofStorageError) {
            missingProofOperationKeys.push(capability.paymentOperationKey);
          }
          throw error;
        }
      },
    });
    return { state: "created", result };
  } catch (error) {
    const scope = { rowId: input.rowId, batchId: input.batchId };
    console.error("[active-work-import] materialize failed", { ...scope, error });
    // Compensation must never hide the original failure: each step logs its
    // own problem and the row still reports the real reason below.
    for (const storageKey of finalizedStorageKeys) {
      try {
        await cleanupUnpersistedActiveWorkImportProof(db, {
          producerId: input.producerId,
          batchId: input.batchId,
          rowId: input.rowId,
          storageKey,
          deleteProof: deletePrivateProofObjectQuietly,
        });
      } catch (cleanupError) {
        console.error("[active-work-import] proof cleanup failed", {
          ...scope,
          storageKey,
          error: cleanupError,
        });
      }
    }
    for (const paymentOperationKey of missingProofOperationKeys) {
      try {
        await clearActiveWorkImportProofUploadToken(db, {
          producerId: input.producerId,
          batchId: input.batchId,
          rowId: input.rowId,
          paymentOperationKey,
          now: importedAt,
        });
      } catch (clearError) {
        console.error("[active-work-import] proof token reset failed", {
          ...scope,
          paymentOperationKey,
          error: clearError,
        });
      }
    }
    if (missingAgreementPdfUploadIds.length > 0) {
      try {
        await clearActiveWorkImportAgreementPdfUploadToken(db, {
          producerId: input.producerId,
          batchId: input.batchId,
          rowId: input.rowId,
          now: importedAt,
        });
      } catch (clearError) {
        console.error("[active-work-import] agreement PDF token reset failed", {
          ...scope,
          error: clearError,
        });
      }
    }
    const code = errorCode(error);
    try {
      await markActiveWorkImportRowFailure(db, {
        producerId: input.producerId,
        batchId: input.batchId,
        rowId: input.rowId,
        errorCode: code,
        attemptedAt: importedAt,
      });
    } catch (markError) {
      console.error("[active-work-import] failure marking failed", {
        ...scope,
        code,
        error: markError,
      });
    }
    return { state: "failed", rowId: input.rowId, code, message: failureMessage(error) };
  }
}

export async function materializeActiveWorkImportRows(
  db: Db,
  input: Readonly<{
    producerId: string;
    clerkUserId: string;
    batchId: string;
    rows: readonly Readonly<{ rowId: string; expectedCreationDigest: string }>[];
    verificationSecrets: readonly string[];
    importedAt?: Date;
  }>,
): Promise<readonly MaterializeActiveWorkImportRowOutcome[]> {
  const importedAt = input.importedAt ?? new Date();
  const outcomes: MaterializeActiveWorkImportRowOutcome[] = [];
  for (const row of input.rows) {
    try {
      outcomes.push(
        await materializeActiveWorkImportRow(db, {
          producerId: input.producerId,
          clerkUserId: input.clerkUserId,
          batchId: input.batchId,
          rowId: row.rowId,
          expectedCreationDigest: row.expectedCreationDigest,
          verificationSecrets: input.verificationSecrets,
          importedAt,
        }),
      );
    } catch (error) {
      console.error("[active-work-import] materialize failed", {
        rowId: row.rowId,
        batchId: input.batchId,
        error,
      });
      outcomes.push({
        state: "failed",
        rowId: row.rowId,
        code: errorCode(error),
        message: failureMessage(error),
      });
    }
  }
  return outcomes;
}
