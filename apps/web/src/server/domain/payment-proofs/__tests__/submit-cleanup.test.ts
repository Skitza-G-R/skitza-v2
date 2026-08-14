import { readFileSync } from "node:fs";
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

import { cancelArtistProofUpload } from "../service";
import { createProofUploadToken } from "../tokens";

const SERVER_SECRET = "unit-test-private-proof-signing-material";
const ROTATED_SERVER_SECRET = "rotated-private-proof-signing-material";
const NOW = new Date("2026-07-24T12:00:00.000Z");

describe("payment proof submit staging cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("holds the closure lock through finalization and preserves ambiguous final evidence", () => {
    const service = readFileSync(new URL("../service.ts", import.meta.url), "utf8");
    const submit = service.slice(
      service.indexOf("export async function submitArtistPaymentProof"),
      service.indexOf("function producerProofSelection"),
    );
    const lock = submit.indexOf("lockProducerClosureState(tx, context.producerId)");
    const closedGuard = submit.indexOf("lockedProducerClosedAt !== null", lock);
    const finalize = submit.indexOf("finalizePrivateProofUpload(serverSecret, token)", closedGuard);
    const insert = submit.indexOf(".insert(paymentProofs)", finalize);
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(closedGuard).toBeGreaterThan(lock);
    expect(finalize).toBeGreaterThan(closedGuard);
    expect(insert).toBeGreaterThan(finalize);
    expect(submit).toContain("await deletePrivateProofStagingUpload");
    expect(submit).toContain("if (finalizationState.storageKey)");
    expect(submit).toContain("if (!persisted) await deletePrivateProofObjectQuietly");
  });

  it("uses the matching legacy key to cancel an in-flight upload after rotation", async () => {
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
    storageMocks.deletePrivateProofStagingUpload.mockResolvedValue(undefined);

    await expect(
      cancelArtistProofUpload({
        clerkUserId: "artist-1",
        purchaseId: "purchase-1",
        installmentId: "installment-1",
        uploadToken: signed.token,
        serverSecret: [ROTATED_SERVER_SECRET, SERVER_SECRET],
        now: NOW,
      }),
    ).resolves.toEqual({ cancelled: true });
    expect(storageMocks.deletePrivateProofStagingUpload).toHaveBeenCalledWith(
      SERVER_SECRET,
      signed.payload,
    );
  });
});
