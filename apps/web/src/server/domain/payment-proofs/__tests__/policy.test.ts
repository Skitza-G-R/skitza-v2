import { describe, expect, it } from "vitest";

import {
  assertProofAmount,
  assertProofUploadMetadata,
  decideProofTransition,
  installmentStatusAfterDecision,
  MAX_PROOF_BYTES,
  normalizeProofFileName,
  normalizeProofNote,
  normalizeRejectionNote,
  PaymentProofPolicyError,
  proofPaymentOperationDigest,
} from "../policy";

describe("payment proof input policy", () => {
  it("accepts supported private evidence and rejects size/type abuse", () => {
    expect(() => {
      assertProofUploadMetadata({ contentType: "application/pdf", sizeBytes: MAX_PROOF_BYTES });
    }).not.toThrow();
    expect(() => {
      assertProofUploadMetadata({ contentType: "text/html", sizeBytes: 10 });
    }).toThrow(PaymentProofPolicyError);
    expect(() => {
      assertProofUploadMetadata({ contentType: "image/png", sizeBytes: 0 });
    }).toThrow(PaymentProofPolicyError);
    expect(() => {
      assertProofUploadMetadata({ contentType: "image/png", sizeBytes: MAX_PROOF_BYTES + 1 });
    }).toThrow(PaymentProofPolicyError);
  });

  it("accepts a safe partial amount but never more than the exact remainder", () => {
    expect(() => {
      assertProofAmount(1, 10_000);
    }).not.toThrow();
    expect(() => {
      assertProofAmount(4_000, 10_000);
    }).not.toThrow();
    expect(() => {
      assertProofAmount(10_000, 10_000);
    }).not.toThrow();
    expect(() => {
      assertProofAmount(0, 10_000);
    }).toThrow(PaymentProofPolicyError);
    expect(() => {
      assertProofAmount(10_001, 10_000);
    }).toThrow(/remaining balance/);
    expect(() => {
      assertProofAmount(1.5, 10_000);
    }).toThrow(PaymentProofPolicyError);
  });

  it("normalizes artist-facing text without accepting paths or blank rejection notes", () => {
    expect(normalizeProofFileName(" receipt.pdf ")).toBe("receipt.pdf");
    expect(() => normalizeProofFileName("../receipt.pdf")).toThrow(PaymentProofPolicyError);
    expect(normalizeProofNote("  Bit sent in two transfers. ")).toBe("Bit sent in two transfers.");
    expect(normalizeProofNote("   ")).toBeNull();
    expect(normalizeRejectionNote("  Please upload the full receipt. ")).toBe(
      "Please upload the full receipt.",
    );
    expect(() => normalizeRejectionNote("   ")).toThrow(PaymentProofPolicyError);
  });
});

describe("payment proof review transitions", () => {
  it("makes confirm retries idempotent and blocks confirm after rejection", () => {
    expect(decideProofTransition("pending", { kind: "confirm" }, null)).toEqual({
      kind: "confirm",
      changed: true,
    });
    expect(decideProofTransition("confirmed", { kind: "confirm" }, null)).toEqual({
      kind: "confirm",
      changed: false,
    });
    expect(() => decideProofTransition("rejected", { kind: "confirm" }, "Not clear")).toThrow(
      /cannot be confirmed/,
    );
  });

  it("makes an identical reject retry idempotent and blocks conflicting races", () => {
    expect(decideProofTransition("pending", { kind: "reject", note: " Not clear " }, null)).toEqual(
      { kind: "reject", changed: true, rejectionNote: "Not clear" },
    );
    expect(
      decideProofTransition("rejected", { kind: "reject", note: "Not clear" }, "Not clear"),
    ).toEqual({ kind: "reject", changed: false, rejectionNote: "Not clear" });
    expect(() =>
      decideProofTransition("rejected", { kind: "reject", note: "Wrong amount" }, "Not clear"),
    ).toThrow(/different artist-facing note/);
    expect(() =>
      decideProofTransition("confirmed", { kind: "reject", note: "Not clear" }, null),
    ).toThrow(/cannot be rejected/);
  });

  it("derives pending, partial, full, waived, overdue, and empty installment states", () => {
    const base = {
      installmentAmountCents: 10_000,
      confirmedCents: 0,
      waivedCents: 0,
      hasPendingProof: false,
      dueAt: null,
      now: new Date("2026-07-20T10:00:00.000Z"),
    };
    expect(installmentStatusAfterDecision({ ...base, hasPendingProof: true })).toBe(
      "awaiting_review",
    );
    expect(installmentStatusAfterDecision({ ...base, confirmedCents: 4_000 })).toBe(
      "partially_paid",
    );
    expect(installmentStatusAfterDecision({ ...base, confirmedCents: 10_000 })).toBe("confirmed");
    expect(installmentStatusAfterDecision({ ...base, waivedCents: 10_000 })).toBe("waived");
    expect(
      installmentStatusAfterDecision({ ...base, dueAt: new Date("2026-07-19T10:00:00.000Z") }),
    ).toBe("overdue");
    expect(installmentStatusAfterDecision(base)).toBe("not_paid");
  });

  it("uses a stable digest for the one proof-sourced payment", () => {
    const input = {
      proofId: "proof-1",
      purchaseId: "purchase-1",
      installmentId: "installment-1",
      amountCents: 4_000,
      currency: "ILS",
    };
    expect(proofPaymentOperationDigest(input)).toBe(proofPaymentOperationDigest(input));
    expect(proofPaymentOperationDigest({ ...input, amountCents: 4_001 })).not.toBe(
      proofPaymentOperationDigest(input),
    );
  });
});
