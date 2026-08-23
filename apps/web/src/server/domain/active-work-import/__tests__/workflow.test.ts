import type { Db } from "@skitza/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

type UnknownAsyncMock = (...args: unknown[]) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  assessStored: vi.fn<UnknownAsyncMock>(),
  cleanupProof: vi.fn<UnknownAsyncMock>(),
  clearProofToken: vi.fn<UnknownAsyncMock>(),
  loadBatch: vi.fn<UnknownAsyncMock>(),
  loadRow: vi.fn<UnknownAsyncMock>(),
  markFailure: vi.fn<UnknownAsyncMock>(),
  materializeTransaction: vi.fn<UnknownAsyncMock>(),
  finalizeUpload: vi.fn<UnknownAsyncMock>(),
  clearAgreementPdfToken: vi.fn<UnknownAsyncMock>(),
  finalizeAgreementPdf: vi.fn<UnknownAsyncMock>(),
}));

vi.mock("../db", () => ({
  assessStoredActiveWorkImportRow: (...args: unknown[]) => mocks.assessStored(...args),
  cleanupUnpersistedActiveWorkImportProof: (...args: unknown[]) => {
    mocks.events.push("cleanup");
    return mocks.cleanupProof(...args);
  },
  clearActiveWorkImportProofUploadToken: (...args: unknown[]) => {
    mocks.events.push("clear-token");
    return mocks.clearProofToken(...args);
  },
  clearActiveWorkImportAgreementPdfUploadToken: (...args: unknown[]) => {
    mocks.events.push("clear-agreement-pdf-token");
    return mocks.clearAgreementPdfToken(...args);
  },
  loadActiveWorkImportBatch: (...args: unknown[]) => mocks.loadBatch(...args),
  loadUnmaterializedImportRow: (...args: unknown[]) => mocks.loadRow(...args),
  markActiveWorkImportRowFailure: (...args: unknown[]) => {
    mocks.events.push("mark-failure");
    return mocks.markFailure(...args);
  },
  materializeActiveWorkImportRowTransaction: (...args: unknown[]) =>
    mocks.materializeTransaction(...args),
}));

vi.mock("../../payment-proofs/storage", () => {
  class ProofStorageError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ProofStorageError";
    }
  }
  return {
    ProofStorageError,
    createPrivateProofUpload: vi.fn(),
    deletePrivateProofObjectQuietly: vi.fn(),
    finalizePrivateProofUpload: (...args: unknown[]) => mocks.finalizeUpload(...args),
  };
});

vi.mock("../../agreement-pdfs/storage", () => {
  class AgreementPdfStorageError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AgreementPdfStorageError";
    }
  }
  return {
    AgreementPdfStorageError,
    createPrivateAgreementPdfUpload: vi.fn(),
    finalizePrivateAgreementPdfUpload: (...args: unknown[]) => mocks.finalizeAgreementPdf(...args),
  };
});

import { AgreementPdfStorageError } from "../../agreement-pdfs/storage";
import { ProofStorageError } from "../../payment-proofs/storage";
import { createActiveWorkImportAgreementPdfCapability } from "../agreement-pdf-capability";
import { createActiveWorkImportProofCapability } from "../proof-capability";
import { activeWorkImportCreationDigest, assessActiveWorkImportDraft } from "../service";
import {
  assessActiveWorkImportRowForCreation,
  materializeActiveWorkImportRow,
  publicActiveWorkImportAssessment,
} from "../workflow";

const SECRET = "skitza-import-proof-test-secret-long-enough";
const PRODUCER_ID = "10000000-0000-4000-8000-000000000001";
const BATCH_ID = "20000000-0000-4000-8000-000000000002";
const ROW_ID = "30000000-0000-4000-8000-000000000003";
const IMPORTED_AT = new Date("2026-08-22T09:00:00.000Z");
const db = {} as Db;

function draft(
  proofUploadToken: string | null,
  agreementPdf: { uploadToken: string; fileName: string; sizeBytes: number } | null = null,
) {
  return {
    client: { name: "Noga Artist", email: "noga@example.com", phone: null },
    project: { title: "Existing EP", deadlineAt: null },
    agreement: {
      agreementPdf,
      name: "EP production",
      deliverables: ["4 produced tracks"],
      rights: ["Artist owns the masters"],
      agreementText: "Our signed agreement remains the source of truth.",
      subtotalCents: 100_00,
      taxMode: "tax_free",
      taxRatePct: 0,
      taxAmountCents: 0,
      totalCents: 100_00,
      currency: "USD",
      includedSongSpaces: 4,
      plan: { kind: "full" },
    },
    payments: [
      {
        operationKey: "history-1",
        installmentPosition: 1,
        amountCents: 40_00,
        paidAt: "2026-01-10",
        note: "Bank transfer",
        proofUploadToken,
      },
    ],
  };
}

function storedRow(draftPayload: Record<string, unknown>) {
  return {
    id: ROW_ID,
    batchId: BATCH_ID,
    producerId: PRODUCER_ID,
    operationKey: "row-operation-1",
    draftRevision: 2,
    draftPayload,
    creationDigest: null,
    createdClientContactId: null,
    createdProjectId: null,
    createdPurchaseId: null,
    materializedAt: null,
    lastAttemptedAt: null,
    lastErrorCode: null,
    createdAt: IMPORTED_AT,
    updatedAt: IMPORTED_AT,
  };
}

async function assessScenario(
  proofUploadToken: string | null,
  agreementPdf: { uploadToken: string; fileName: string; sizeBytes: number } | null = null,
) {
  const payload = draft(proofUploadToken, agreementPdf);
  const row = storedRow(payload);
  mocks.loadBatch.mockResolvedValue({ batch: { id: BATCH_ID }, rows: [row] });
  mocks.loadRow.mockResolvedValue(row);
  mocks.assessStored.mockResolvedValue(assessActiveWorkImportDraft(payload, IMPORTED_AT));
  return assessActiveWorkImportRowForCreation(db, {
    producerId: PRODUCER_ID,
    batchId: BATCH_ID,
    rowId: ROW_ID,
    verificationSecrets: [SECRET],
    asOf: IMPORTED_AT,
  });
}

async function readyScenario(
  proofUploadToken: string | null,
  agreementPdf: { uploadToken: string; fileName: string; sizeBytes: number } | null = null,
) {
  const assessment = await assessScenario(proofUploadToken, agreementPdf);
  if (assessment.state !== "ready") throw new Error("expected a Ready row");
  return assessment.creationDigest;
}

function materialize(expectedCreationDigest: string) {
  return materializeActiveWorkImportRow(db, {
    producerId: PRODUCER_ID,
    clerkUserId: "producer-clerk-user",
    batchId: BATCH_ID,
    rowId: ROW_ID,
    expectedCreationDigest,
    verificationSecrets: [SECRET],
    importedAt: IMPORTED_AT,
  });
}

describe("active work import materialization failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.cleanupProof.mockResolvedValue("deleted");
    mocks.clearProofToken.mockResolvedValue({ cleared: true });
    mocks.markFailure.mockResolvedValue(undefined);
  });

  it("asks for the proof again when its finalized object is no longer available", async () => {
    const signed = createActiveWorkImportProofCapability(SECRET, {
      producerId: PRODUCER_ID,
      batchId: BATCH_ID,
      rowId: ROW_ID,
      paymentOperationKey: "history-1",
      originalFileName: "receipt.pdf",
      contentType: "application/pdf",
      sizeBytes: 512,
    });
    const creationDigest = await readyScenario(signed.token);
    const storageFailure = new ProofStorageError(
      "The proof upload could not be found. Upload it again",
    );
    mocks.finalizeUpload.mockRejectedValue(storageFailure);
    mocks.materializeTransaction.mockImplementation(async (_db, rawInput) => {
      const input = rawInput as {
        proofCapabilities: ReadonlyMap<string, unknown>;
        finalizeProof: (capability: unknown) => Promise<unknown>;
      };
      for (const capability of input.proofCapabilities.values()) {
        await input.finalizeProof(capability);
      }
      throw new Error("unreachable");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      mocks.events.push("log");
    });

    try {
      const outcome = await materialize(creationDigest);

      expect(outcome).toEqual({
        state: "failed",
        rowId: ROW_ID,
        code: "PROOF_UPLOAD_MISSING",
        message: "The payment proof file is no longer available. Attach it again and retry.",
      });
      expect(consoleError).toHaveBeenCalledWith("[active-work-import] materialize failed", {
        rowId: ROW_ID,
        batchId: BATCH_ID,
        error: storageFailure,
      });
      expect(mocks.events[0]).toBe("log");
      expect(mocks.clearProofToken).toHaveBeenCalledWith(db, {
        producerId: PRODUCER_ID,
        batchId: BATCH_ID,
        rowId: ROW_ID,
        paymentOperationKey: "history-1",
        now: IMPORTED_AT,
      });
      expect(mocks.markFailure).toHaveBeenCalledWith(db, {
        producerId: PRODUCER_ID,
        batchId: BATCH_ID,
        rowId: ROW_ID,
        errorCode: "PROOF_UPLOAD_MISSING",
        attemptedAt: IMPORTED_AT,
      });
      expect(mocks.cleanupProof).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps the original failure when compensation itself fails and stores a stable code", async () => {
    const creationDigest = await readyScenario(null);
    const failure = new TypeError("Cannot read properties of undefined (reading 'id')");
    mocks.materializeTransaction.mockRejectedValue(failure);
    mocks.markFailure.mockRejectedValue(new Error("database unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const outcome = await materialize(creationDigest);

      expect(outcome).toEqual({
        state: "failed",
        rowId: ROW_ID,
        code: "UNEXPECTED",
        message: "This row could not be created. Your draft is safe.",
      });
      expect(consoleError).toHaveBeenNthCalledWith(1, "[active-work-import] materialize failed", {
        rowId: ROW_ID,
        batchId: BATCH_ID,
        error: failure,
      });
      expect(consoleError).toHaveBeenNthCalledWith(
        2,
        "[active-work-import] failure marking failed",
        expect.objectContaining({ rowId: ROW_ID, batchId: BATCH_ID }),
      );
      expect(mocks.clearProofToken).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("active work import agreement PDF", () => {
  const signedPdf = () =>
    createActiveWorkImportAgreementPdfCapability(SECRET, {
      producerId: PRODUCER_ID,
      batchId: BATCH_ID,
      rowId: ROW_ID,
      originalFileName: "deal.pdf",
      contentType: "application/pdf",
      sizeBytes: 2_048,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.clearAgreementPdfToken.mockResolvedValue({ cleared: true });
    mocks.markFailure.mockResolvedValue(undefined);
  });

  it("verifies the attached PDF, binds it to the digest, and finalizes it at creation", async () => {
    const signed = signedPdf();
    const reference = { uploadToken: signed.token, fileName: "deal.pdf", sizeBytes: 2_048 };
    const assessment = await assessScenario(null, reference);
    expect(assessment.state).toBe("ready");
    if (assessment.state !== "ready") throw new Error("expected a Ready row");
    expect(assessment.agreementPdfCapability?.capability).toEqual(signed.payload);
    expect(assessment.creationDigest).toBe(
      activeWorkImportCreationDigest(assessment.normalized, [], {
        uploadId: signed.payload.uploadId,
        originalFileName: "deal.pdf",
        contentType: "application/pdf",
        sizeBytes: 2_048,
      }),
    );
    expect(publicActiveWorkImportAssessment(assessment)).toMatchObject({
      state: "ready",
      normalized: { agreementPdf: { fileName: "deal.pdf", sizeBytes: 2_048 } },
    });
    expect(
      JSON.stringify(publicActiveWorkImportAssessment(assessment)).includes(signed.token),
    ).toBe(false);

    const finalized = { storageBucket: "docs", storageKey: "agreement-pdfs/abc" };
    mocks.finalizeAgreementPdf.mockResolvedValue(finalized);
    mocks.materializeTransaction.mockImplementation(async (_db, rawInput) => {
      const input = rawInput as {
        agreementPdfCapability: unknown;
        finalizeAgreementPdf: (capability: unknown) => Promise<unknown>;
      };
      expect(input.agreementPdfCapability).toEqual(signed.payload);
      expect(await input.finalizeAgreementPdf(input.agreementPdfCapability)).toBe(finalized);
      return {
        rowId: ROW_ID,
        clientContactId: "c",
        projectId: "p",
        purchaseId: "u",
        creationDigest: assessment.creationDigest,
        materializedAt: IMPORTED_AT,
        created: true,
      };
    });

    const outcome = await materialize(assessment.creationDigest);
    expect(outcome.state).toBe("created");
    expect(mocks.finalizeAgreementPdf).toHaveBeenCalledWith(SECRET, signed.payload);
  });

  it("keeps a tampered or foreign agreement PDF token at Needs info", async () => {
    const foreign = createActiveWorkImportAgreementPdfCapability(`${SECRET}-other`, {
      producerId: PRODUCER_ID,
      batchId: BATCH_ID,
      rowId: ROW_ID,
      originalFileName: "deal.pdf",
      contentType: "application/pdf",
      sizeBytes: 2_048,
    });
    const assessment = await assessScenario(null, {
      uploadToken: foreign.token,
      fileName: "deal.pdf",
      sizeBytes: 2_048,
    });
    expect(assessment).toEqual({
      state: "needs_info",
      rowId: ROW_ID,
      reasons: [
        {
          code: "agreement_pdf_invalid",
          field: "agreement.agreementPdf",
          message: "Upload the agreement PDF again.",
        },
      ],
    });
  });

  it("asks for the agreement PDF again when its staged file is gone", async () => {
    const signed = signedPdf();
    const creationDigest = await readyScenario(null, {
      uploadToken: signed.token,
      fileName: "deal.pdf",
      sizeBytes: 2_048,
    });
    const storageFailure = new AgreementPdfStorageError(
      "The agreement upload expired. Upload it again.",
    );
    mocks.finalizeAgreementPdf.mockRejectedValue(storageFailure);
    mocks.materializeTransaction.mockImplementation(async (_db, rawInput) => {
      const input = rawInput as {
        agreementPdfCapability: unknown;
        finalizeAgreementPdf: (capability: unknown) => Promise<unknown>;
      };
      await input.finalizeAgreementPdf(input.agreementPdfCapability);
      throw new Error("unreachable");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const outcome = await materialize(creationDigest);

      expect(outcome).toEqual({
        state: "failed",
        rowId: ROW_ID,
        code: "AGREEMENT_PDF_UPLOAD_MISSING",
        message: "The agreement PDF file is no longer available. Attach it again and retry.",
      });
      expect(mocks.clearAgreementPdfToken).toHaveBeenCalledWith(db, {
        producerId: PRODUCER_ID,
        batchId: BATCH_ID,
        rowId: ROW_ID,
        now: IMPORTED_AT,
      });
      expect(mocks.markFailure).toHaveBeenCalledWith(db, {
        producerId: PRODUCER_ID,
        batchId: BATCH_ID,
        rowId: ROW_ID,
        errorCode: "AGREEMENT_PDF_UPLOAD_MISSING",
        attemptedAt: IMPORTED_AT,
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
