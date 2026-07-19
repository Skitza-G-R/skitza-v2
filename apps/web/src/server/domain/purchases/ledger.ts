export type PurchasePaymentPlan =
  | Readonly<{ kind: "full" }>
  | Readonly<{ kind: "split_50_50" }>
  | Readonly<{ kind: "monthly"; installments: number }>;

export type InstallmentTrigger = "acceptance" | "artist_approval" | "monthly_anniversary";

export type PurchaseInstallmentStatus =
  | "not_paid"
  | "awaiting_review"
  | "partially_paid"
  | "confirmed"
  | "overdue"
  | "waived"
  | "canceled";

const PURCHASE_INSTALLMENT_STATUSES: ReadonlySet<string> = new Set([
  "not_paid",
  "awaiting_review",
  "partially_paid",
  "confirmed",
  "overdue",
  "waived",
  "canceled",
]);

export type PurchaseInstallment = Readonly<{
  sequence: number;
  amountCents: number;
  trigger: InstallmentTrigger;
  status: PurchaseInstallmentStatus;
}>;

export function purchaseInstallmentDueLabel(plan: PurchasePaymentPlan, sequence: number): string {
  if (plan.kind === "full") return "Due at acceptance";
  if (plan.kind === "split_50_50") {
    return sequence === 1
      ? "50% due at acceptance"
      : "50% due when the artist approves the final version";
  }
  return sequence === 1 ? "First payment due at acceptance" : `Monthly payment ${String(sequence)}`;
}

export function purchaseInstallmentTriggerLabel(trigger: InstallmentTrigger): string {
  if (trigger === "acceptance") return "Triggered by offer acceptance";
  if (trigger === "artist_approval") return "Triggered when you approve the final version";
  return "Triggered on a monthly anniversary after acceptance";
}

export type ConfirmedPayment = Readonly<{
  id: string;
  installmentSequence: number;
  amountCents: number;
  confirmedAt: Date;
}>;

export type PaymentCorrection = Readonly<{
  id: string;
  paymentId: string;
  sequence: number;
  oldAmountCents: number;
  newAmountCents: number;
  reason: string;
  actorId: string;
  correctedAt: Date;
}>;

export type DebtWaiver = Readonly<{
  id: string;
  installmentSequence: number;
  amountCents: number;
  reason: string;
  actorId: string;
  waivedAt: Date;
}>;

export type PurchaseLedgerSummary = Readonly<{
  originalConfirmedCents: number;
  paidCents: number;
  waivedCents: number;
  appliedWaiverCents: number;
  remainingBalanceCents: number;
  overpaidCents: number;
  firstInstallmentPaid: boolean;
  fullyPaid: boolean;
  settled: boolean;
}>;

function assertIntegerCents(value: number, label: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be a safe integer of at least ${String(minimum)} cents`);
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty`);
  }
}

function assertDate(value: Date, label: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
}

function addSafeCents(left: number, right: number, label: string): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new Error(`${label} exceeds the safe integer cents range`);
  }
  return total;
}

function freezeSchedule(rows: PurchaseInstallment[]): readonly PurchaseInstallment[] {
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}

export function createInstallmentSchedule(
  plan: PurchasePaymentPlan | null,
  totalCents: number,
): readonly PurchaseInstallment[] {
  assertIntegerCents(totalCents, "totalCents", 0);

  if (plan === null) {
    if (totalCents !== 0) {
      throw new Error("A positive-total purchase must select a payment plan");
    }
    return Object.freeze([]);
  }

  switch (plan.kind) {
    case "full":
      if (totalCents === 0) {
        throw new Error("A zero-total purchase must not select a payment plan");
      }
      return freezeSchedule([
        { sequence: 1, amountCents: totalCents, trigger: "acceptance", status: "not_paid" },
      ]);

    case "split_50_50": {
      if (totalCents === 0) {
        throw new Error("A zero-total purchase must not select a payment plan");
      }
      if (totalCents < 2) {
        throw new Error("A 50/50 purchase needs at least two cents");
      }
      const second = Math.floor(totalCents / 2);
      return freezeSchedule([
        {
          sequence: 1,
          amountCents: totalCents - second,
          trigger: "acceptance",
          status: "not_paid",
        },
        {
          sequence: 2,
          amountCents: second,
          trigger: "artist_approval",
          status: "not_paid",
        },
      ]);
    }

    case "monthly": {
      if (totalCents === 0) {
        throw new Error("A zero-total purchase must not select a payment plan");
      }
      if (!Number.isInteger(plan.installments) || plan.installments < 2 || plan.installments > 12) {
        throw new Error("Monthly installments must be an integer between 2 and 12");
      }
      if (totalCents < plan.installments) {
        throw new Error("A monthly schedule cannot contain zero-cent installments");
      }
      const base = Math.floor(totalCents / plan.installments);
      const remainder = totalCents - base * plan.installments;
      return freezeSchedule(
        Array.from({ length: plan.installments }, (_, index) => ({
          sequence: index + 1,
          amountCents: base + (index === 0 ? remainder : 0),
          trigger: index === 0 ? "acceptance" : "monthly_anniversary",
          status: "not_paid",
        })),
      );
    }

    default:
      throw new Error(`Unsupported payment plan: ${JSON.stringify(plan)}`);
  }
}

export function createPaymentCorrection(input: PaymentCorrection): PaymentCorrection {
  assertNonEmpty(input.id, "correction id");
  assertNonEmpty(input.paymentId, "payment id");
  assertIntegerCents(input.sequence, "correction sequence", 1);
  assertIntegerCents(input.oldAmountCents, "correction old amount", 0);
  assertIntegerCents(input.newAmountCents, "correction new amount", 0);
  assertNonEmpty(input.reason, "correction reason");
  assertNonEmpty(input.actorId, "correction actor");
  assertDate(input.correctedAt, "correction time");
  return Object.freeze({ ...input, correctedAt: new Date(input.correctedAt) });
}

export function createDebtWaiver(input: DebtWaiver): DebtWaiver {
  assertNonEmpty(input.id, "waiver id");
  assertIntegerCents(input.amountCents, "waiver amount", 1);
  assertIntegerCents(input.installmentSequence, "waiver installment sequence", 1);
  assertNonEmpty(input.reason, "waiver reason");
  assertNonEmpty(input.actorId, "waiver actor");
  assertDate(input.waivedAt, "waiver time");
  return Object.freeze({
    ...input,
    waivedAt: new Date(input.waivedAt),
  });
}

export function summarizePurchaseLedger(
  input: Readonly<{
    totalCents: number;
    schedule: readonly PurchaseInstallment[];
    payments: readonly ConfirmedPayment[];
    corrections: readonly PaymentCorrection[];
    waivers: readonly DebtWaiver[];
  }>,
): PurchaseLedgerSummary {
  assertIntegerCents(input.totalCents, "totalCents", 0);

  const installmentSequences = new Set<number>();
  const installmentAmounts = new Map<number, number>();
  let scheduledCents = 0;
  for (const [index, installment] of input.schedule.entries()) {
    assertIntegerCents(installment.sequence, "installment sequence", 1);
    assertIntegerCents(installment.amountCents, "installment amount", 1);
    if (installment.sequence !== index + 1 || installmentSequences.has(installment.sequence)) {
      throw new Error("Installment sequences must be unique and contiguous from one");
    }
    if (!PURCHASE_INSTALLMENT_STATUSES.has(installment.status)) {
      throw new Error("Installment status is unsupported");
    }
    installmentSequences.add(installment.sequence);
    installmentAmounts.set(installment.sequence, installment.amountCents);
    scheduledCents = addSafeCents(scheduledCents, installment.amountCents, "schedule total");
  }
  if (scheduledCents !== input.totalCents) {
    throw new Error("Installment schedule must sum exactly to the purchase total");
  }
  if (input.totalCents === 0 && input.schedule.length !== 0) {
    throw new Error("A zero-total purchase cannot have installments");
  }

  const paymentAmounts = new Map<string, number>();
  const paymentInstallments = new Map<string, number>();
  let originalConfirmedCents = 0;
  for (const payment of input.payments) {
    assertNonEmpty(payment.id, "payment id");
    if (paymentAmounts.has(payment.id)) {
      throw new Error(`Duplicate payment id: ${payment.id}`);
    }
    if (!installmentSequences.has(payment.installmentSequence)) {
      throw new Error("Payment must belong to an exact purchase installment");
    }
    assertIntegerCents(payment.amountCents, "payment amount", 1);
    assertDate(payment.confirmedAt, "payment confirmation time");
    paymentAmounts.set(payment.id, payment.amountCents);
    paymentInstallments.set(payment.id, payment.installmentSequence);
    originalConfirmedCents = addSafeCents(
      originalConfirmedCents,
      payment.amountCents,
      "confirmed payment total",
    );
  }

  const correctionIds = new Set<string>();
  const lastCorrectionSequence = new Map<string, number>();
  const orderedCorrections = [...input.corrections].sort((left, right) => {
    if (left.paymentId !== right.paymentId) {
      return left.paymentId < right.paymentId ? -1 : 1;
    }
    return left.sequence - right.sequence;
  });
  for (const rawCorrection of orderedCorrections) {
    const correction = createPaymentCorrection(rawCorrection);
    if (correctionIds.has(correction.id)) {
      throw new Error(`Duplicate correction id: ${correction.id}`);
    }
    correctionIds.add(correction.id);
    const currentAmount = paymentAmounts.get(correction.paymentId);
    if (currentAmount === undefined) {
      throw new Error("Correction must reference an existing immutable payment");
    }
    const expectedSequence = (lastCorrectionSequence.get(correction.paymentId) ?? 0) + 1;
    if (correction.sequence !== expectedSequence) {
      throw new Error("Correction sequence must be contiguous for its payment");
    }
    lastCorrectionSequence.set(correction.paymentId, correction.sequence);
    if (currentAmount !== correction.oldAmountCents) {
      throw new Error("Correction old amount must match the current recorded amount");
    }
    paymentAmounts.set(correction.paymentId, correction.newAmountCents);
  }

  let paidCents = 0;
  let firstInstallmentCents = 0;
  const paidByInstallment = new Map<number, number>();
  for (const [paymentId, amountCents] of paymentAmounts) {
    paidCents = addSafeCents(paidCents, amountCents, "corrected payment total");
    const installmentSequence = paymentInstallments.get(paymentId);
    if (installmentSequence === undefined) {
      throw new Error("Payment lost its exact purchase installment");
    }
    paidByInstallment.set(
      installmentSequence,
      addSafeCents(
        paidByInstallment.get(installmentSequence) ?? 0,
        amountCents,
        "installment payment total",
      ),
    );
    if (installmentSequence === 1) {
      firstInstallmentCents = addSafeCents(
        firstInstallmentCents,
        amountCents,
        "first installment payment total",
      );
    }
  }

  let waivedCents = 0;
  const waiverIds = new Set<string>();
  const waivedByInstallment = new Map<number, number>();
  for (const rawWaiver of input.waivers) {
    const waiver = createDebtWaiver(rawWaiver);
    if (waiverIds.has(waiver.id)) {
      throw new Error(`Duplicate waiver id: ${waiver.id}`);
    }
    waiverIds.add(waiver.id);
    if (!installmentSequences.has(waiver.installmentSequence)) {
      throw new Error("Waiver must reference an exact purchase installment");
    }
    waivedByInstallment.set(
      waiver.installmentSequence,
      addSafeCents(
        waivedByInstallment.get(waiver.installmentSequence) ?? 0,
        waiver.amountCents,
        "installment waiver total",
      ),
    );
    waivedCents = addSafeCents(waivedCents, waiver.amountCents, "waiver total");
  }

  let appliedWaiverCents = 0;
  let remainingBalanceCents = 0;
  let overpaidCents = 0;
  let everyInstallmentPaid = true;
  for (const installment of input.schedule) {
    const amountCents = installmentAmounts.get(installment.sequence);
    if (amountCents === undefined) {
      throw new Error("Installment lost its immutable amount");
    }
    const paidOnInstallment = paidByInstallment.get(installment.sequence) ?? 0;
    overpaidCents = addSafeCents(
      overpaidCents,
      Math.max(0, paidOnInstallment - amountCents),
      "installment overpayment total",
    );
    if (
      installment.status === "waived" ||
      installment.status === "canceled" ||
      paidOnInstallment < amountCents
    ) {
      everyInstallmentPaid = false;
    }
    const collectibleAfterPayment =
      installment.status === "canceled" ? 0 : Math.max(0, amountCents - paidOnInstallment);
    const waivedOnInstallment = waivedByInstallment.get(installment.sequence) ?? 0;
    if (waivedOnInstallment > collectibleAfterPayment) {
      throw new Error("Waiver exceeds remaining debt on its exact installment");
    }
    appliedWaiverCents = addSafeCents(
      appliedWaiverCents,
      waivedOnInstallment,
      "applied waiver total",
    );
    remainingBalanceCents = addSafeCents(
      remainingBalanceCents,
      collectibleAfterPayment - waivedOnInstallment,
      "collectible remaining balance",
    );
  }
  const firstInstallment = input.schedule[0];
  const firstInstallmentPaid =
    input.totalCents === 0 ||
    (firstInstallment !== undefined && firstInstallmentCents >= firstInstallment.amountCents);
  const fullyPaid = input.totalCents === 0 || everyInstallmentPaid;

  return Object.freeze({
    originalConfirmedCents,
    paidCents,
    waivedCents,
    appliedWaiverCents,
    remainingBalanceCents,
    overpaidCents,
    firstInstallmentPaid,
    fullyPaid,
    settled: remainingBalanceCents === 0,
  });
}
