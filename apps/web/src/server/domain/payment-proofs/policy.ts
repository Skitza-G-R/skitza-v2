export { proofPaymentOperationDigest } from "../purchase-ledger/operation-digest";

export const PROOF_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;

export type ProofContentType = (typeof PROOF_CONTENT_TYPES)[number];

export const MAX_PROOF_BYTES = 15 * 1024 * 1024;
export const MAX_PROOF_NOTE_LENGTH = 2_000;
export const MAX_PROOF_FILE_NAME_LENGTH = 200;

export type PaymentProofStatus = "pending" | "confirmed" | "rejected";

export class PaymentProofPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentProofPolicyError";
  }
}

export function normalizeProofFileName(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_PROOF_FILE_NAME_LENGTH) {
    throw new PaymentProofPolicyError(
      `File name must be between 1 and ${String(MAX_PROOF_FILE_NAME_LENGTH)} characters`,
    );
  }
  const containsControlCharacter = Array.from(normalized).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (normalized.includes("/") || normalized.includes("\\") || containsControlCharacter) {
    throw new PaymentProofPolicyError("File name contains unsupported characters");
  }
  return normalized;
}

export function normalizeProofNote(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > MAX_PROOF_NOTE_LENGTH) {
    throw new PaymentProofPolicyError(
      `Proof note must be at most ${String(MAX_PROOF_NOTE_LENGTH)} characters`,
    );
  }
  return normalized;
}

export function normalizeRejectionNote(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_PROOF_NOTE_LENGTH) {
    throw new PaymentProofPolicyError(
      `Rejection note must be between 1 and ${String(MAX_PROOF_NOTE_LENGTH)} characters`,
    );
  }
  return normalized;
}

export function assertProofUploadMetadata(input: {
  contentType: string;
  sizeBytes: number;
}): asserts input is { contentType: ProofContentType; sizeBytes: number } {
  if (!PROOF_CONTENT_TYPES.includes(input.contentType as ProofContentType)) {
    throw new PaymentProofPolicyError("Choose a JPG, PNG, WebP, HEIC, or PDF file");
  }
  if (
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > MAX_PROOF_BYTES
  ) {
    throw new PaymentProofPolicyError("Proof files must be between 1 byte and 15 MB");
  }
}

export function assertProofAmount(amountCents: number, remainingCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new PaymentProofPolicyError("The proof amount must be a positive locked amount");
  }
  if (!Number.isSafeInteger(remainingCents) || remainingCents < 0) {
    throw new PaymentProofPolicyError("The installment balance is invalid");
  }
  if (amountCents !== remainingCents) {
    throw new PaymentProofPolicyError(
      "The proof amount must match this installment's locked remaining balance",
    );
  }
}

export type ProofDecision =
  | Readonly<{ kind: "confirm"; changed: boolean }>
  | Readonly<{ kind: "reject"; changed: boolean; rejectionNote: string }>;

/**
 * Pure transition guard used by the transaction boundary. It makes producer
 * retries deterministic while ensuring confirm and reject can never both win.
 */
export function decideProofTransition(
  status: PaymentProofStatus,
  action: Readonly<{ kind: "confirm" } | { kind: "reject"; note: string }>,
  existingRejectionNote: string | null,
): ProofDecision {
  if (action.kind === "confirm") {
    if (status === "rejected") {
      throw new PaymentProofPolicyError("A rejected proof cannot be confirmed");
    }
    return { kind: "confirm", changed: status === "pending" };
  }

  const rejectionNote = normalizeRejectionNote(action.note);
  if (status === "confirmed") {
    throw new PaymentProofPolicyError("A confirmed proof cannot be rejected");
  }
  if (status === "rejected" && existingRejectionNote !== rejectionNote) {
    throw new PaymentProofPolicyError(
      "This proof was already rejected with a different artist-facing note",
    );
  }
  return { kind: "reject", changed: status === "pending", rejectionNote };
}

export function installmentStatusAfterDecision(input: {
  installmentAmountCents: number;
  confirmedCents: number;
  waivedCents: number;
  hasPendingProof: boolean;
  dueAt: Date | null;
  now: Date;
}): "not_paid" | "awaiting_review" | "partially_paid" | "confirmed" | "overdue" | "waived" {
  if (input.hasPendingProof) return "awaiting_review";
  if (input.confirmedCents >= input.installmentAmountCents) return "confirmed";
  if (
    input.waivedCents > 0 &&
    input.confirmedCents + input.waivedCents >= input.installmentAmountCents
  ) {
    return "waived";
  }
  if (input.confirmedCents > 0) return "partially_paid";
  if (input.dueAt !== null && input.dueAt.getTime() < input.now.getTime()) return "overdue";
  return "not_paid";
}
