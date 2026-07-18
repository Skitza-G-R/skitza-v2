import type { PurchaseInstallment } from "@skitza/db";

export const EXTERNAL_PAYMENT_BOUNDARY = Object.freeze({
  mode: "external_record_only" as const,
  processorConnectionRequired: false,
  cardCheckoutAvailable: false,
  holdsFunds: false,
  routesFunds: false,
  splitsFunds: false,
  issuesRefundsOrCredits: false,
});

export type PaymentInstructions = Readonly<{
  bankTransfer?: string | undefined;
  bitPhone?: string | undefined;
  note?: string | undefined;
}>;

const FIELD_LIMITS = {
  bankTransfer: { label: "Bank transfer details", max: 500 },
  bitPhone: { label: "Bit phone number", max: 32 },
  note: { label: "Payment note", max: 500 },
} as const;

function normalizedField(
  value: string | undefined,
  field: keyof typeof FIELD_LIMITS,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  const limit = FIELD_LIMITS[field];
  if (normalized.length > limit.max) {
    throw new Error(`${limit.label} must be at most ${String(limit.max)} characters`);
  }
  return normalized;
}

/**
 * Current instructions are producer configuration, never accepted purchase
 * terms. Blank fields are removed so clearing the form persists `{}` rather
 * than ambiguous whitespace.
 */
export function normalizePaymentInstructions(
  input: Readonly<{
    bankTransfer?: string | undefined;
    bitPhone?: string | undefined;
    note?: string | undefined;
  }>,
): PaymentInstructions {
  const bankTransfer = normalizedField(input.bankTransfer, "bankTransfer");
  const bitPhone = normalizedField(input.bitPhone, "bitPhone");
  const note = normalizedField(input.note, "note");

  return Object.freeze({
    ...(bankTransfer === undefined ? {} : { bankTransfer }),
    ...(bitPhone === undefined ? {} : { bitPhone }),
    ...(note === undefined ? {} : { note }),
  });
}

export function hasPaymentInstructions(instructions: PaymentInstructions): boolean {
  return Boolean(instructions.bankTransfer || instructions.bitPhone || instructions.note);
}

type InstallmentEligibility = Pick<
  PurchaseInstallment,
  "status" | "dueTrigger" | "dueAt" | "triggeredAt"
>;

/**
 * Instructions belong to collectible installments, not to a purchase or
 * project lifecycle as a whole. A canceled purchase may still have an already
 * due installment, while terminal or proof-under-review installments must not
 * expose another payment prompt.
 */
export function isInstallmentPayableForInstructions(
  installment: InstallmentEligibility,
  now: Date,
): boolean {
  switch (installment.status) {
    case "confirmed":
    case "waived":
    case "canceled":
    case "awaiting_review":
      return false;
    case "partially_paid":
    case "overdue":
      return true;
    case "not_paid":
      return (
        installment.dueTrigger === "acceptance" ||
        installment.triggeredAt !== null ||
        (installment.dueAt !== null && installment.dueAt.getTime() <= now.getTime())
      );
  }
}
