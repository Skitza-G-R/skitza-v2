import type { Db } from "@skitza/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  deletePrivateProofObjectQuietly: vi.fn(),
  deletePrivateProofStagingUpload: vi.fn(),
  finalizePrivateProofUpload: vi.fn(),
}));

vi.mock("../storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage")>();
  return {
    ...actual,
    deletePrivateProofObjectQuietly: storageMocks.deletePrivateProofObjectQuietly,
    deletePrivateProofStagingUpload: storageMocks.deletePrivateProofStagingUpload,
    finalizePrivateProofUpload: storageMocks.finalizePrivateProofUpload,
  };
});

import { submitArtistPaymentProof } from "../service";
import { createProofUploadToken, proofObjectKeys } from "../tokens";

const SERVER_SECRET = "unit-test-private-proof-signing-material";
const NOW = new Date("2026-07-24T12:00:00.000Z");

describe("payment proof submit staging cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("deletes only staging after finalization rejects and preserves possible final evidence", async () => {
    const signed = createProofUploadToken(
      SERVER_SECRET,
      {
        purchaseId: "purchase-1",
        installmentId: "installment-1",
        viewerClerkUserId: "artist-1",
        originalFileName: "receipt.pdf",
        contentType: "application/pdf",
        sizeBytes: 512,
      },
      NOW,
    );
    const keys = proofObjectKeys(SERVER_SECRET, signed.payload.uploadId);
    const objects = new Set([keys.stagingKey]);
    storageMocks.finalizePrivateProofUpload.mockImplementation(() => {
      objects.add(keys.finalKey);
      return Promise.reject(new Error("finalization rejected"));
    });
    storageMocks.deletePrivateProofStagingUpload.mockImplementation(
      (serverSecret: string, payload: typeof signed.payload) => {
        objects.delete(proofObjectKeys(serverSecret, payload.uploadId).stagingKey);
        return Promise.resolve();
      },
    );

    await expect(
      submitArtistPaymentProof({} as Db, {
        clerkUserId: "artist-1",
        purchaseId: "purchase-1",
        installmentId: "installment-1",
        uploadToken: signed.token,
        amountCents: 12_000,
        serverSecret: SERVER_SECRET,
        now: NOW,
      }),
    ).rejects.toThrow("finalization rejected");

    expect(storageMocks.deletePrivateProofStagingUpload).toHaveBeenCalledWith(
      SERVER_SECRET,
      signed.payload,
    );
    expect(objects.has(keys.stagingKey)).toBe(false);
    expect(objects.has(keys.finalKey)).toBe(true);
    expect(storageMocks.deletePrivateProofObjectQuietly).not.toHaveBeenCalled();
  });
});
