import { describe, expect, it } from "vitest";

import { resolveArtistProofUploadAvailability } from "../artist-upload-availability";

const FUTURE_INSTALLMENT = {
  position: 2,
  dueTrigger: "artist_approval" as const,
  dueAt: null,
};

describe("artist payment-proof upload availability", () => {
  it("opens only a currently payable installment with a positive server-owned amount", () => {
    expect(
      resolveArtistProofUploadAvailability({
        studioClosed: false,
        purchaseCanceled: false,
        hasPendingProof: false,
        paidInFull: false,
        selectedPayable: true,
        selectedRemainingCents: 5_015,
        nextOutstandingInstallment: FUTURE_INSTALLMENT,
      }),
    ).toEqual({ status: "available" });
  });

  it("keeps pending, paid, and canceled states closed", () => {
    const base = {
      studioClosed: false,
      purchaseCanceled: false,
      hasPendingProof: false,
      paidInFull: false,
      selectedPayable: true,
      selectedRemainingCents: 5_015,
      nextOutstandingInstallment: FUTURE_INSTALLMENT,
    } as const;

    expect(resolveArtistProofUploadAvailability({ ...base, hasPendingProof: true })).toEqual({
      status: "awaiting_review",
    });
    expect(resolveArtistProofUploadAvailability({ ...base, paidInFull: true })).toEqual({
      status: "paid_in_full",
    });
    expect(resolveArtistProofUploadAvailability({ ...base, purchaseCanceled: true })).toEqual({
      status: "purchase_canceled",
    });
    expect(resolveArtistProofUploadAvailability({ ...base, studioClosed: true })).toEqual({
      status: "studio_closed",
    });
  });

  it("preserves the exact next trigger when the remaining installment is not payable yet", () => {
    expect(
      resolveArtistProofUploadAvailability({
        studioClosed: false,
        purchaseCanceled: false,
        hasPendingProof: false,
        paidInFull: false,
        selectedPayable: false,
        selectedRemainingCents: 0,
        nextOutstandingInstallment: FUTURE_INSTALLMENT,
      }),
    ).toEqual({
      status: "not_due",
      installmentPosition: 2,
      dueTrigger: "artist_approval",
      dueAt: null,
    });
  });
});
