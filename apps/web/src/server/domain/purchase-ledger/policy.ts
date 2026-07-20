import { isOverdueOnLocalDate } from "./schedule";

export type PurchaseLedgerDomainErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "OPERATION_KEY_CONFLICT"
  | "INTEGRITY_ERROR";

export class PurchaseLedgerDomainError extends Error {
  constructor(
    readonly code: PurchaseLedgerDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PurchaseLedgerDomainError";
  }
}

export type LedgerInstallmentStatus =
  | "not_paid"
  | "awaiting_review"
  | "partially_paid"
  | "confirmed"
  | "overdue"
  | "waived"
  | "canceled";

export type LedgerPurchaseInput = Readonly<{
  id: string;
  producerId: string;
  currency: string;
  lifecycleStatus: "waiting_for_payment" | "active" | "canceled";
  wasActivated: boolean;
}>;

export type LedgerInstallmentInput = Readonly<{
  id: string;
  purchaseId: string;
  producerId: string;
  position: number;
  amountCents: number;
  currency: string;
  dueAt: Date | null;
  requiredForActivation: boolean;
  status: LedgerInstallmentStatus;
}>;

export type LedgerPaymentInput = Readonly<{
  id: string;
  purchaseId: string;
  installmentId: string;
  producerId: string;
  amountCents: number;
  currency: string;
}>;

export type LedgerCorrectionInput = Readonly<{
  id: string;
  purchaseId: string;
  paymentId: string;
  producerId: string;
  sequence: number;
  previousAmountCents: number;
  newAmountCents: number;
}>;

export type LedgerWaiverInput = Readonly<{
  id: string;
  purchaseId: string;
  installmentId: string;
  producerId: string;
  amountCents: number;
}>;

export type PurchaseLedgerProjectionInput = Readonly<{
  purchase: LedgerPurchaseInput;
  installments: readonly LedgerInstallmentInput[];
  payments: readonly LedgerPaymentInput[];
  corrections: readonly LedgerCorrectionInput[];
  waivers: readonly LedgerWaiverInput[];
  pendingProofInstallmentIds?: readonly string[];
  asOf: Date;
  timeZone: string;
}>;

export type InstallmentLedgerProjection = Readonly<{
  id: string;
  position: number;
  amountCents: number;
  currency: string;
  dueAt: Date | null;
  requiredForActivation: boolean;
  status: LedgerInstallmentStatus;
  paidCents: number;
  waivedCents: number;
  remainingCents: number;
  overpaidCents: number;
}>;

export type PurchaseLedgerProjection = Readonly<{
  purchaseId: string;
  producerId: string;
  currency: string;
  installments: readonly InstallmentLedgerProjection[];
  paidCents: number;
  waivedCents: number;
  remainingCents: number;
  overpaidCents: number;
  activationSatisfied: boolean;
  activationRemainsSatisfied: boolean;
  fullyPaidForDownloads: boolean;
  settled: boolean;
}>;

function integrity(message: string): never {
  throw new PurchaseLedgerDomainError("INTEGRITY_ERROR", message);
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new PurchaseLedgerDomainError("INVALID_INPUT", `${label} must be a valid date`);
  }
  return value;
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) integrity(`${label} must be positive`);
}

function nonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) integrity(`${label} must be nonnegative`);
}

function assertScope(
  row: Readonly<{ purchaseId: string; producerId: string }>,
  purchase: LedgerPurchaseInput,
  label: string,
): void {
  if (row.purchaseId !== purchase.id || row.producerId !== purchase.producerId) {
    integrity(`${label} escaped its purchase or producer scope`);
  }
}

/**
 * Derive the complete purchase balance from immutable money history. No amount
 * is ever allocated to a sibling installment, purchase, or currency.
 */
export function projectPurchaseLedger(
  input: PurchaseLedgerProjectionInput,
): PurchaseLedgerProjection {
  const asOf = validDate(input.asOf, "asOf");
  if (!input.purchase.id.trim() || !input.purchase.producerId.trim()) {
    integrity("Purchase scope identifiers must not be empty");
  }
  if (!input.purchase.currency.trim()) integrity("Purchase currency must not be empty");

  const installments = [...input.installments].sort(
    (left, right) => left.position - right.position || left.id.localeCompare(right.id),
  );
  const installmentById = new Map<string, LedgerInstallmentInput>();
  const positions = new Set<number>();
  for (const installment of installments) {
    assertScope(installment, input.purchase, "Installment");
    positiveInteger(installment.position, "Installment position");
    positiveInteger(installment.amountCents, "Installment amount");
    if (
      installment.currency !== input.purchase.currency ||
      installmentById.has(installment.id) ||
      positions.has(installment.position)
    ) {
      integrity("Installment identity, order, or currency is inconsistent");
    }
    if (installment.dueAt !== null) validDate(installment.dueAt, "Installment due date");
    installmentById.set(installment.id, installment);
    positions.add(installment.position);
  }

  const effectivePaymentById = new Map<string, number>();
  const paymentById = new Map<string, LedgerPaymentInput>();
  for (const payment of input.payments) {
    assertScope(payment, input.purchase, "Payment");
    positiveInteger(payment.amountCents, "Payment amount");
    const installment = installmentById.get(payment.installmentId);
    if (
      !installment ||
      payment.currency !== input.purchase.currency ||
      paymentById.has(payment.id)
    ) {
      integrity("Payment identity, installment, or currency is inconsistent");
    }
    paymentById.set(payment.id, payment);
    effectivePaymentById.set(payment.id, payment.amountCents);
  }

  const corrections = [...input.corrections].sort(
    (left, right) =>
      left.paymentId.localeCompare(right.paymentId) ||
      left.sequence - right.sequence ||
      left.id.localeCompare(right.id),
  );
  const nextSequence = new Map<string, number>();
  const correctionIds = new Set<string>();
  for (const correction of corrections) {
    assertScope(correction, input.purchase, "Correction");
    const payment = paymentById.get(correction.paymentId);
    const current = effectivePaymentById.get(correction.paymentId);
    const expectedSequence = nextSequence.get(correction.paymentId) ?? 1;
    nonnegativeInteger(correction.previousAmountCents, "Previous corrected amount");
    nonnegativeInteger(correction.newAmountCents, "Corrected amount");
    if (
      !payment ||
      current === undefined ||
      correctionIds.has(correction.id) ||
      correction.sequence !== expectedSequence ||
      correction.previousAmountCents !== current ||
      correction.newAmountCents === current
    ) {
      integrity("Payment correction history is inconsistent");
    }
    correctionIds.add(correction.id);
    effectivePaymentById.set(payment.id, correction.newAmountCents);
    nextSequence.set(payment.id, expectedSequence + 1);
  }

  const paidByInstallment = new Map<string, number>();
  for (const payment of input.payments) {
    paidByInstallment.set(
      payment.installmentId,
      (paidByInstallment.get(payment.installmentId) ?? 0) +
        (effectivePaymentById.get(payment.id) ?? 0),
    );
  }

  const waivedByInstallment = new Map<string, number>();
  const waiverIds = new Set<string>();
  for (const waiver of input.waivers) {
    assertScope(waiver, input.purchase, "Waiver");
    positiveInteger(waiver.amountCents, "Waiver amount");
    const installment = installmentById.get(waiver.installmentId);
    if (!installment || waiverIds.has(waiver.id)) {
      integrity("Waiver identity or installment is inconsistent");
    }
    waiverIds.add(waiver.id);
    const aggregate = (waivedByInstallment.get(waiver.installmentId) ?? 0) + waiver.amountCents;
    if (aggregate > installment.amountCents) integrity("Waivers exceed installment debt");
    waivedByInstallment.set(waiver.installmentId, aggregate);
  }

  const pending = new Set(input.pendingProofInstallmentIds ?? []);
  for (const installmentId of pending) {
    if (!installmentById.has(installmentId)) integrity("Pending proof escaped its installment");
  }

  const projected = installments.map((installment): InstallmentLedgerProjection => {
    const paidCents = paidByInstallment.get(installment.id) ?? 0;
    const waivedCents = waivedByInstallment.get(installment.id) ?? 0;
    const canceled = installment.status === "canceled";
    const remainingCents = canceled
      ? 0
      : Math.max(installment.amountCents - paidCents - waivedCents, 0);
    const payableAfterWaiverCents = Math.max(installment.amountCents - waivedCents, 0);
    const overpaidCents = Math.max(paidCents - payableAfterWaiverCents, 0);
    let status: LedgerInstallmentStatus;
    if (canceled) status = "canceled";
    else if (paidCents >= installment.amountCents) status = "confirmed";
    else if (paidCents + waivedCents >= installment.amountCents) status = "waived";
    else if (pending.has(installment.id)) status = "awaiting_review";
    else if (
      installment.dueAt !== null &&
      remainingCents > 0 &&
      isOverdueOnLocalDate(installment.dueAt, asOf, input.timeZone)
    ) {
      status = "overdue";
    } else if (paidCents > 0 || waivedCents > 0) status = "partially_paid";
    else status = "not_paid";

    return Object.freeze({
      id: installment.id,
      position: installment.position,
      amountCents: installment.amountCents,
      currency: installment.currency,
      dueAt: installment.dueAt === null ? null : new Date(installment.dueAt),
      requiredForActivation: installment.requiredForActivation,
      status,
      paidCents,
      waivedCents,
      remainingCents,
      overpaidCents,
    });
  });

  const required = projected.filter((installment) => installment.requiredForActivation);
  const activationSatisfied =
    required.length === 0 ||
    required.every((installment) => installment.paidCents >= installment.amountCents);
  const fullyPaidForDownloads = projected.every(
    (installment) => installment.paidCents >= installment.amountCents,
  );

  return Object.freeze({
    purchaseId: input.purchase.id,
    producerId: input.purchase.producerId,
    currency: input.purchase.currency,
    installments: Object.freeze(projected),
    paidCents: projected.reduce((sum, installment) => sum + installment.paidCents, 0),
    waivedCents: projected.reduce((sum, installment) => sum + installment.waivedCents, 0),
    remainingCents: projected.reduce((sum, installment) => sum + installment.remainingCents, 0),
    overpaidCents: projected.reduce((sum, installment) => sum + installment.overpaidCents, 0),
    activationSatisfied,
    activationRemainsSatisfied: input.purchase.wasActivated || activationSatisfied,
    fullyPaidForDownloads,
    settled: projected.every(
      (installment) =>
        installment.status === "canceled" ||
        installment.paidCents + installment.waivedCents >= installment.amountCents,
    ),
  });
}
