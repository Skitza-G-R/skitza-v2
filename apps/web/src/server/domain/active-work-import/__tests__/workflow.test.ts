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

import { ProofStorageError } from "../../payment-proofs/storage";
import { createActiveWorkImportProofCapability } from "../proof-capability";
import { assessActiveWorkImportDraft } from "../service";
import { assessActiveWorkImportRowForCreation, materializeActiveWorkImportRow } from "../workflow";

const SECRET = "skitza-import-proof-test-secret-long-enough";
const PRODUCER_ID = "10000000-0000-4000-8000-000000000001";
const BATCH_ID = "20000000-0000-4000-8000-000000000002";
const ROW_ID = "30000000-0000-4000-8000-000000000003";
const IMPORTED_AT = new Date("2026-08-22T09:00:00.000Z");
const db = {} as Db;

function draft(proofUploadToken: string | null) {
  return {
    client: { name: "Noga Artist", email: "noga@example.com", phone: null },
    project: { title: "Existing EP", deadlineAt: null },
    agreement: {
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

async function readyScenario(proofUploadToken: string | null) {
  const payload = draft(proofUploadToken);
  const row = storedRow(payload);
  mocks.loadBatch.mockResolvedValue({ batch: { id: BATCH_ID }, rows: [row] });
  mocks.loadRow.mockResolvedValue(row);
  mocks.assessStored.mockResolvedValue(assessActiveWorkImportDraft(payload, IMPORTED_AT));
  const assessment = await assessActiveWorkImportRowForCreation(db, {
    producerId: PRODUCER_ID,
    batchId: BATCH_ID,
    rowId: ROW_ID,
    verificationSecrets: [SECRET],
    asOf: IMPORTED_AT,
  });
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
      expect(consoleError).toHaveBeenNthCalledWith(
        1,
        "[active-work-import] materialize failed",
        { rowId: ROW_ID, batchId: BATCH_ID, error: failure },
      );
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
