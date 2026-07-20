import { digestCommercialSnapshot } from "../purchases/policy";
import { proofPaymentOperationDigest } from "./operation-digest";
import {
  projectPurchaseLedger,
  PurchaseLedgerDomainError,
  type LedgerCorrectionInput,
  type LedgerInstallmentInput,
  type LedgerPaymentInput,
  type LedgerWaiverInput,
  type PurchaseLedgerProjection,
} from "./policy";
import { monthlyInstallmentDates } from "./schedule";

export type PurchaseLedgerPlan = "full" | "split_50_50" | "monthly";

export type PurchaseLedgerPaymentRecord = LedgerPaymentInput &
  Readonly<{
    operationKey: string;
    operationDigest: string;
    source: "proof" | "manual";
    proofId: string | null;
    paidAt: Date;
    addedByClerkUserId: string;
    note: string | null;
  }>;

export type PurchaseLedgerCorrectionRecord = LedgerCorrectionInput &
  Readonly<{
    operationKey: string;
    operationDigest: string;
    reason: string;
    correctedByClerkUserId: string;
    createdAt: Date;
  }>;

export type PurchaseLedgerWaiverRecord = LedgerWaiverInput &
  Readonly<{
    operationKey: string;
    operationDigest: string;
    reason: string;
    waivedByClerkUserId: string;
    createdAt: Date;
  }>;

export type PurchaseCancellationRecord = Readonly<{
  id: string;
  purchaseId: string;
  producerId: string;
  operationKey: string;
  operationDigest: string;
  reason: string;
  canceledByClerkUserId: string;
  canceledAt: Date;
}>;

export type ProjectPaymentPauseEventRecord = Readonly<{
  id: string;
  purchaseId: string;
  projectId: string;
  producerId: string;
  action: "paused" | "resumed";
  operationKey: string;
  operationDigest: string;
  reason: string;
  changedByClerkUserId: string;
  changedAt: Date;
}>;

export type PurchaseLedgerSnapshot = Readonly<{
  purchase: Readonly<{
    id: string;
    producerId: string;
    projectId: string;
    clientContactId: string;
    currency: string;
    totalCents: number;
    plan: PurchaseLedgerPlan | null;
    lifecycleStatus: "waiting_for_payment" | "active" | "canceled";
    acceptedAt: Date;
    activatedAt: Date | null;
    canceledAt: Date | null;
  }>;
  project: Readonly<{
    id: string;
    producerId: string;
    clientContactId: string;
    lifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
  }>;
  producer: Readonly<{
    id: string;
    timeZone: string;
    automaticRemindersEnabled: boolean;
    displayName: string;
  }>;
  client: Readonly<{ id: string; name: string; email: string }>;
  purchaseName: string;
  refNumber: string;
  installments: readonly (LedgerInstallmentInput &
    Readonly<{
      dueTrigger: "acceptance" | "monthly_anniversary" | "artist_approval";
      triggeredAt: Date | null;
      remindersEnabled: boolean;
    }>)[];
  payments: readonly PurchaseLedgerPaymentRecord[];
  corrections: readonly PurchaseLedgerCorrectionRecord[];
  waivers: readonly PurchaseLedgerWaiverRecord[];
  pendingProofInstallmentIds: readonly string[];
  cancellation: PurchaseCancellationRecord | null;
  pauseEvents: readonly ProjectPaymentPauseEventRecord[];
}>;

export type NewPurchasePayment = Omit<PurchaseLedgerPaymentRecord, "id">;
export type NewPurchaseCorrection = Omit<PurchaseLedgerCorrectionRecord, "id">;
export type NewPurchaseWaiver = Omit<PurchaseLedgerWaiverRecord, "id">;
export type NewPurchaseCancellation = Omit<PurchaseCancellationRecord, "id">;
export type NewProjectPaymentPauseEvent = Omit<ProjectPaymentPauseEventRecord, "id">;

export interface PurchaseLedgerTransaction {
  loadSnapshot(): Promise<PurchaseLedgerSnapshot | null>;
  insertPayment(input: NewPurchasePayment): Promise<PurchaseLedgerPaymentRecord>;
  insertCorrection(input: NewPurchaseCorrection): Promise<PurchaseLedgerCorrectionRecord>;
  insertWaiver(input: NewPurchaseWaiver): Promise<PurchaseLedgerWaiverRecord>;
  insertCancellation(input: NewPurchaseCancellation): Promise<PurchaseCancellationRecord>;
  setMonthlyInstallmentDates(
    rows: readonly Readonly<{ installmentId: string; dueAt: Date; triggeredAt: Date }>[],
    changedAt: Date,
  ): Promise<number>;
  setInstallmentStatuses(
    rows: readonly Readonly<{ installmentId: string; status: LedgerInstallmentInput["status"] }>[],
    changedAt: Date,
  ): Promise<number>;
  activatePurchaseAndWaitingProject(activatedAt: Date): Promise<void>;
  setInstallmentRemindersEnabled(installmentId: string, enabled: boolean): Promise<boolean>;
  cancelFutureInstallments(installmentIds: readonly string[], canceledAt: Date): Promise<number>;
  cancelPurchase(canceledAt: Date): Promise<boolean>;
  transitionProject(
    from: "active" | "paused",
    to: "active" | "paused",
    changedAt: Date,
  ): Promise<boolean>;
  insertPauseEvent(input: NewProjectPaymentPauseEvent): Promise<ProjectPaymentPauseEventRecord>;
}

export interface PurchaseLedgerRepository {
  atomically<T>(
    scope: Readonly<{ producerId: string; purchaseId: string }>,
    work: (transaction: PurchaseLedgerTransaction) => Promise<T>,
  ): Promise<T>;
}

export type RecordConfirmedPurchasePaymentInput = Readonly<{
  producerId: string;
  purchaseId: string;
  installmentId: string;
  operationKey: string;
  source: "proof" | "manual";
  proofId?: string | null;
  amountCents: number;
  currency: string;
  paidAt: Date;
  actorId: string;
  note?: string | null;
  occurredAt?: Date;
}>;

export type PurchaseLedgerMutationResult<RecordType> = Readonly<{
  record: RecordType;
  projection: PurchaseLedgerProjection;
  created: boolean;
}>;

export type ReconciledPurchaseLedger = Readonly<{
  snapshot: PurchaseLedgerSnapshot;
  projection: PurchaseLedgerProjection;
}>;

function identifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new PurchaseLedgerDomainError("INVALID_INPUT", `${label} is required`);
  return normalized;
}

function operationKey(value: string): string {
  const normalized = identifier(value, "Operation key");
  if (normalized.length > 200) {
    throw new PurchaseLedgerDomainError(
      "INVALID_INPUT",
      "Operation key must be at most 200 characters",
    );
  }
  return normalized;
}

function text(value: string, label: string, maximum = 4_000): string {
  const normalized = value.trim();
  if (!normalized) throw new PurchaseLedgerDomainError("INVALID_INPUT", `${label} is required`);
  if (normalized.length > maximum) {
    throw new PurchaseLedgerDomainError(
      "INVALID_INPUT",
      `${label} must be at most ${String(maximum)} characters`,
    );
  }
  return normalized;
}

function date(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new PurchaseLedgerDomainError("INVALID_INPUT", `${label} must be a valid date`);
  }
  return new Date(value);
}

function positiveMoney(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PurchaseLedgerDomainError("INVALID_INPUT", `${label} must be positive whole cents`);
  }
  return value;
}

function nonnegativeMoney(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PurchaseLedgerDomainError(
      "INVALID_INPUT",
      `${label} must be nonnegative whole cents`,
    );
  }
  return value;
}

function ownedSnapshot(
  snapshot: PurchaseLedgerSnapshot | null,
  scope: Readonly<{ producerId: string; purchaseId: string }>,
): PurchaseLedgerSnapshot {
  if (
    !snapshot ||
    snapshot.purchase.id !== scope.purchaseId ||
    snapshot.purchase.producerId !== scope.producerId ||
    snapshot.project.id !== snapshot.purchase.projectId ||
    snapshot.project.producerId !== scope.producerId ||
    snapshot.project.clientContactId !== snapshot.purchase.clientContactId ||
    snapshot.producer.id !== scope.producerId ||
    snapshot.client.id !== snapshot.purchase.clientContactId
  ) {
    throw new PurchaseLedgerDomainError("NOT_FOUND", "Purchase ledger was not found");
  }
  const installmentTotal = snapshot.installments.reduce(
    (sum, installment) => sum + installment.amountCents,
    0,
  );
  const activationInstallments = snapshot.installments.filter(
    (installment) => installment.requiredForActivation,
  ).length;
  if (
    (snapshot.purchase.totalCents === 0 &&
      (snapshot.purchase.plan !== null || snapshot.installments.length !== 0)) ||
    (snapshot.purchase.totalCents > 0 &&
      (snapshot.purchase.plan === null ||
        installmentTotal !== snapshot.purchase.totalCents ||
        activationInstallments !== 1))
  ) {
    throw new PurchaseLedgerDomainError(
      "INTEGRITY_ERROR",
      "Accepted purchase and installment schedule disagree",
    );
  }
  if (
    snapshot.pauseEvents.some(
      (event) =>
        event.purchaseId !== scope.purchaseId ||
        event.projectId !== snapshot.project.id ||
        event.producerId !== scope.producerId,
    )
  ) {
    throw new PurchaseLedgerDomainError(
      "INTEGRITY_ERROR",
      "Payment pause history escaped its purchase scope",
    );
  }
  return snapshot;
}

function projection(snapshot: PurchaseLedgerSnapshot, asOf: Date): PurchaseLedgerProjection {
  return projectPurchaseLedger({
    purchase: {
      id: snapshot.purchase.id,
      producerId: snapshot.purchase.producerId,
      currency: snapshot.purchase.currency,
      lifecycleStatus: snapshot.purchase.lifecycleStatus,
      wasActivated: snapshot.purchase.activatedAt !== null,
    },
    installments: snapshot.installments,
    payments: snapshot.payments,
    corrections: snapshot.corrections,
    waivers: snapshot.waivers,
    pendingProofInstallmentIds: snapshot.pendingProofInstallmentIds,
    asOf,
    timeZone: snapshot.producer.timeZone,
  });
}

function operationConflict(): never {
  throw new PurchaseLedgerDomainError(
    "OPERATION_KEY_CONFLICT",
    "This operation key already belongs to a different ledger change",
  );
}

function assertOperationReplay(
  existing: Readonly<{ operationDigest: string }>,
  expectedDigest: string,
): void {
  if (existing.operationDigest !== expectedDigest) operationConflict();
}

function installmentFor(
  snapshot: PurchaseLedgerSnapshot,
  installmentId: string,
): PurchaseLedgerSnapshot["installments"][number] {
  const installment = snapshot.installments.find((candidate) => candidate.id === installmentId);
  if (!installment || installment.purchaseId !== snapshot.purchase.id) {
    throw new PurchaseLedgerDomainError("NOT_FOUND", "Installment was not found");
  }
  return installment;
}

function earliestPaymentAt(snapshot: PurchaseLedgerSnapshot): Date | null {
  const first = [...snapshot.payments].sort(
    (left, right) =>
      left.paidAt.getTime() - right.paidAt.getTime() || left.id.localeCompare(right.id),
  )[0];
  return first ? new Date(first.paidAt) : null;
}

async function reconcileTransaction(
  transaction: PurchaseLedgerTransaction,
  scope: Readonly<{ producerId: string; purchaseId: string }>,
  occurredAtValue: Date,
): Promise<ReconciledPurchaseLedger> {
  const occurredAt = date(occurredAtValue, "Ledger reconciliation time");
  let snapshot = ownedSnapshot(await transaction.loadSnapshot(), scope);

  if (snapshot.purchase.plan === "monthly") {
    const anchor = earliestPaymentAt(snapshot);
    const missing = snapshot.installments.filter(
      (installment) => installment.position > 1 && installment.dueAt === null,
    );
    if (anchor && missing.length > 0) {
      const dates = monthlyInstallmentDates({
        firstConfirmedAt: anchor,
        installmentCount: snapshot.installments.length,
        timeZone: snapshot.producer.timeZone,
      });
      const dueByPosition = new Map(dates.map((row) => [row.position, row.dueAt]));
      const rows = missing.map((installment) => {
        const dueAt = dueByPosition.get(installment.position);
        if (!dueAt) {
          throw new PurchaseLedgerDomainError(
            "INTEGRITY_ERROR",
            "Monthly schedule could not resolve an accepted installment",
          );
        }
        return { installmentId: installment.id, dueAt, triggeredAt: anchor };
      });
      const changed = await transaction.setMonthlyInstallmentDates(rows, occurredAt);
      if (changed !== rows.length) {
        throw new PurchaseLedgerDomainError(
          "CONFLICT",
          "Monthly schedule changed while the payment was being recorded",
        );
      }
      snapshot = ownedSnapshot(await transaction.loadSnapshot(), scope);
    }
  }

  let currentProjection = projection(snapshot, occurredAt);
  const statusChanges = currentProjection.installments
    .map((installment) => {
      const stored = snapshot.installments.find((candidate) => candidate.id === installment.id);
      return stored && stored.status !== installment.status
        ? { installmentId: installment.id, status: installment.status }
        : null;
    })
    .filter(
      (row): row is { installmentId: string; status: LedgerInstallmentInput["status"] } =>
        row !== null,
    );
  if (statusChanges.length > 0) {
    const changed = await transaction.setInstallmentStatuses(statusChanges, occurredAt);
    if (changed !== statusChanges.length) {
      throw new PurchaseLedgerDomainError(
        "CONFLICT",
        "Installment state changed while the ledger was being reconciled",
      );
    }
    snapshot = ownedSnapshot(await transaction.loadSnapshot(), scope);
    currentProjection = projection(snapshot, occurredAt);
  }

  if (
    snapshot.purchase.lifecycleStatus === "waiting_for_payment" &&
    currentProjection.activationSatisfied
  ) {
    await transaction.activatePurchaseAndWaitingProject(occurredAt);
    snapshot = ownedSnapshot(await transaction.loadSnapshot(), scope);
    currentProjection = projection(snapshot, occurredAt);
  }

  return { snapshot, projection: currentProjection };
}

export async function recordConfirmedPurchasePayment(
  repository: PurchaseLedgerRepository,
  rawInput: RecordConfirmedPurchasePaymentInput,
): Promise<PurchaseLedgerMutationResult<PurchaseLedgerPaymentRecord>> {
  const scope = {
    producerId: identifier(rawInput.producerId, "Producer id"),
    purchaseId: identifier(rawInput.purchaseId, "Purchase id"),
  };
  const installmentId = identifier(rawInput.installmentId, "Installment id");
  const key = operationKey(rawInput.operationKey);
  const amountCents = positiveMoney(rawInput.amountCents, "Payment amount");
  const currency = identifier(rawInput.currency, "Currency");
  const paidAt = date(rawInput.paidAt, "Payment date");
  const occurredAt = date(rawInput.occurredAt ?? new Date(), "Payment confirmation time");
  const actorId = identifier(rawInput.actorId, "Payment actor id");
  const proofId = rawInput.proofId ? identifier(rawInput.proofId, "Proof id") : null;
  if (rawInput.source === "proof" && proofId === null) {
    throw new PurchaseLedgerDomainError("INVALID_INPUT", "Proof payments require a proof id");
  }
  const note = rawInput.note?.trim() || null;
  const expectedDigest =
    rawInput.source === "proof" && proofId !== null
      ? proofPaymentOperationDigest({
          proofId,
          purchaseId: scope.purchaseId,
          installmentId,
          amountCents,
          currency,
        })
      : digestCommercialSnapshot({
          kind: "purchase-payment-v1",
          ...scope,
          installmentId,
          source: rawInput.source,
          proofId,
          amountCents,
          currency,
          paidAt: paidAt.toISOString(),
          actorId,
          note,
        });

  return repository.atomically(scope, async (transaction) => {
    let snapshot = ownedSnapshot(await transaction.loadSnapshot(), scope);
    const installment = installmentFor(snapshot, installmentId);
    if (currency !== snapshot.purchase.currency || installment.currency !== currency) {
      throw new PurchaseLedgerDomainError(
        "INVALID_INPUT",
        "Payment currency does not match purchase",
      );
    }
    const existing = snapshot.payments.find((payment) => payment.operationKey === key);
    if (existing) {
      assertOperationReplay(existing, expectedDigest);
      const immutablePaymentMismatch =
        existing.purchaseId !== scope.purchaseId ||
        existing.producerId !== scope.producerId ||
        existing.installmentId !== installmentId ||
        existing.source !== rawInput.source ||
        existing.proofId !== proofId ||
        existing.amountCents !== amountCents ||
        existing.currency !== currency;
      const manualAuditMismatch =
        rawInput.source === "manual" &&
        (existing.paidAt.getTime() !== paidAt.getTime() ||
          existing.addedByClerkUserId !== actorId ||
          existing.note !== note);
      if (immutablePaymentMismatch || manualAuditMismatch) {
        operationConflict();
      }
      // An operation replay returns immutable history against the current
      // projection. Later waivers or cancellation may have made this
      // installment terminal; those later transitions must not make the
      // original successful command fail on retry or rewrite its audit row.
      return { record: existing, projection: projection(snapshot, occurredAt), created: false };
    }
    if (installment.status === "canceled" || installment.status === "waived") {
      throw new PurchaseLedgerDomainError("CONFLICT", "A settled installment cannot be paid");
    }
    if (installment.position > 1 && installment.dueAt === null) {
      throw new PurchaseLedgerDomainError("CONFLICT", "This installment is not due yet");
    }
    if (proofId && snapshot.payments.some((payment) => payment.proofId === proofId)) {
      throw new PurchaseLedgerDomainError("CONFLICT", "This proof already created a payment");
    }
    const record = await transaction.insertPayment({
      ...scope,
      installmentId,
      operationKey: key,
      operationDigest: expectedDigest,
      source: rawInput.source,
      proofId,
      amountCents,
      currency,
      paidAt,
      addedByClerkUserId: actorId,
      note,
    });
    snapshot = ownedSnapshot(await transaction.loadSnapshot(), scope);
    const stored = snapshot.payments.find((payment) => payment.id === record.id);
    if (!stored || stored.operationDigest !== expectedDigest) {
      throw new PurchaseLedgerDomainError("INTEGRITY_ERROR", "Payment was not stored immutably");
    }
    const reconciled = await reconcileTransaction(transaction, scope, occurredAt);
    return { record: stored, projection: reconciled.projection, created: true };
  });
}

export type CorrectPurchasePaymentInput = Readonly<{
  producerId: string;
  purchaseId: string;
  paymentId: string;
  operationKey: string;
  newAmountCents: number;
  reason: string;
  actorId: string;
  correctedAt?: Date;
}>;

function effectivePaymentAmount(snapshot: PurchaseLedgerSnapshot, paymentId: string): number {
  const payment = snapshot.payments.find((candidate) => candidate.id === paymentId);
  if (!payment) throw new PurchaseLedgerDomainError("NOT_FOUND", "Payment was not found");
  let amount = payment.amountCents;
  const corrections = snapshot.corrections
    .filter((correction) => correction.paymentId === paymentId)
    .sort((left, right) => left.sequence - right.sequence);
  for (const correction of corrections) {
    if (correction.previousAmountCents !== amount) {
      throw new PurchaseLedgerDomainError("INTEGRITY_ERROR", "Payment correction chain is invalid");
    }
    amount = correction.newAmountCents;
  }
  return amount;
}

export async function correctPurchasePayment(
  repository: PurchaseLedgerRepository,
  rawInput: CorrectPurchasePaymentInput,
): Promise<PurchaseLedgerMutationResult<PurchaseLedgerCorrectionRecord>> {
  const scope = {
    producerId: identifier(rawInput.producerId, "Producer id"),
    purchaseId: identifier(rawInput.purchaseId, "Purchase id"),
  };
  const paymentId = identifier(rawInput.paymentId, "Payment id");
  const key = operationKey(rawInput.operationKey);
  const newAmountCents = nonnegativeMoney(rawInput.newAmountCents, "Corrected amount");
  const reason = text(rawInput.reason, "Correction reason");
  const actorId = identifier(rawInput.actorId, "Correction actor id");
  const correctedAt = date(rawInput.correctedAt ?? new Date(), "Correction time");
  const expectedDigest = digestCommercialSnapshot({
    kind: "purchase-payment-correction-v1",
    ...scope,
    paymentId,
    newAmountCents,
    reason,
    actorId,
  });

  return repository.atomically(scope, async (transaction) => {
    const snapshot = ownedSnapshot(await transaction.loadSnapshot(), scope);
    const existing = snapshot.corrections.find((correction) => correction.operationKey === key);
    if (existing) {
      assertOperationReplay(existing, expectedDigest);
      const reconciled = await reconcileTransaction(transaction, scope, correctedAt);
      return { record: existing, projection: reconciled.projection, created: false };
    }
    const payment = snapshot.payments.find((candidate) => candidate.id === paymentId);
    if (!payment) throw new PurchaseLedgerDomainError("NOT_FOUND", "Payment was not found");
    const previousAmountCents = effectivePaymentAmount(snapshot, paymentId);
    if (previousAmountCents === newAmountCents) {
      throw new PurchaseLedgerDomainError("INVALID_INPUT", "Correction must change the amount");
    }
    const sequence =
      snapshot.corrections
        .filter((correction) => correction.paymentId === paymentId)
        .reduce((maximum, correction) => Math.max(maximum, correction.sequence), 0) + 1;
    const record = await transaction.insertCorrection({
      purchaseId: scope.purchaseId,
      paymentId,
      producerId: scope.producerId,
      operationKey: key,
      operationDigest: expectedDigest,
      sequence,
      previousAmountCents,
      newAmountCents,
      reason,
      correctedByClerkUserId: actorId,
      createdAt: correctedAt,
    });
    const reconciled = await reconcileTransaction(transaction, scope, correctedAt);
    return { record, projection: reconciled.projection, created: true };
  });
}

export type WaiveInstallmentDebtInput = Readonly<{
  producerId: string;
  purchaseId: string;
  installmentId: string;
  operationKey: string;
  amountCents: number;
  reason: string;
  actorId: string;
  waivedAt?: Date;
}>;

export async function waiveInstallmentDebt(
  repository: PurchaseLedgerRepository,
  rawInput: WaiveInstallmentDebtInput,
): Promise<PurchaseLedgerMutationResult<PurchaseLedgerWaiverRecord>> {
  const scope = {
    producerId: identifier(rawInput.producerId, "Producer id"),
    purchaseId: identifier(rawInput.purchaseId, "Purchase id"),
  };
  const installmentId = identifier(rawInput.installmentId, "Installment id");
  const key = operationKey(rawInput.operationKey);
  const amountCents = positiveMoney(rawInput.amountCents, "Waiver amount");
  const reason = text(rawInput.reason, "Waiver reason");
  const actorId = identifier(rawInput.actorId, "Waiver actor id");
  const waivedAt = date(rawInput.waivedAt ?? new Date(), "Waiver time");
  const expectedDigest = digestCommercialSnapshot({
    kind: "purchase-waiver-v1",
    ...scope,
    installmentId,
    amountCents,
    reason,
    actorId,
  });

  return repository.atomically(scope, async (transaction) => {
    const snapshot = ownedSnapshot(await transaction.loadSnapshot(), scope);
    const existing = snapshot.waivers.find((waiver) => waiver.operationKey === key);
    if (existing) {
      assertOperationReplay(existing, expectedDigest);
      const reconciled = await reconcileTransaction(transaction, scope, waivedAt);
      return { record: existing, projection: reconciled.projection, created: false };
    }
    const installment = installmentFor(snapshot, installmentId);
    if (installment.status === "canceled") {
      throw new PurchaseLedgerDomainError("CONFLICT", "Canceled debt cannot be waived again");
    }
    if (installment.dueAt === null || installment.triggeredAt === null) {
      throw new PurchaseLedgerDomainError(
        "CONFLICT",
        "Debt cannot be waived before its installment is triggered",
      );
    }
    const current = projection(snapshot, waivedAt).installments.find(
      (candidate) => candidate.id === installmentId,
    );
    if (!current || amountCents > current.remainingCents) {
      throw new PurchaseLedgerDomainError("INVALID_INPUT", "Waiver exceeds remaining debt");
    }
    const record = await transaction.insertWaiver({
      purchaseId: scope.purchaseId,
      installmentId,
      producerId: scope.producerId,
      operationKey: key,
      operationDigest: expectedDigest,
      amountCents,
      reason,
      waivedByClerkUserId: actorId,
      createdAt: waivedAt,
    });
    const reconciled = await reconcileTransaction(transaction, scope, waivedAt);
    return { record, projection: reconciled.projection, created: true };
  });
}

export async function reconcilePurchaseLedger(
  repository: PurchaseLedgerRepository,
  input: Readonly<{ producerId: string; purchaseId: string; asOf?: Date }>,
): Promise<ReconciledPurchaseLedger> {
  const scope = {
    producerId: identifier(input.producerId, "Producer id"),
    purchaseId: identifier(input.purchaseId, "Purchase id"),
  };
  const asOf = date(input.asOf ?? new Date(), "Reconciliation time");
  return repository.atomically(scope, (transaction) =>
    reconcileTransaction(transaction, scope, asOf),
  );
}

export async function setInstallmentRemindersEnabled(
  repository: PurchaseLedgerRepository,
  input: Readonly<{
    producerId: string;
    purchaseId: string;
    installmentId: string;
    enabled: boolean;
  }>,
): Promise<Readonly<{ enabled: boolean; changed: boolean }>> {
  const scope = {
    producerId: identifier(input.producerId, "Producer id"),
    purchaseId: identifier(input.purchaseId, "Purchase id"),
  };
  const installmentId = identifier(input.installmentId, "Installment id");
  return repository.atomically(scope, async (transaction) => {
    const snapshot = ownedSnapshot(await transaction.loadSnapshot(), scope);
    const installment = installmentFor(snapshot, installmentId);
    if (installment.remindersEnabled === input.enabled) {
      return { enabled: input.enabled, changed: false };
    }
    if (!(await transaction.setInstallmentRemindersEnabled(installmentId, input.enabled))) {
      throw new PurchaseLedgerDomainError("CONFLICT", "Reminder preference changed concurrently");
    }
    return { enabled: input.enabled, changed: true };
  });
}

export type CancelPurchaseInput = Readonly<{
  producerId: string;
  purchaseId: string;
  operationKey: string;
  reason: string;
  actorId: string;
  canceledAt?: Date;
}>;

export type CancelPurchaseResult = PurchaseLedgerMutationResult<PurchaseCancellationRecord> &
  Readonly<{
    /** Installments newly canceled by this exact operation. Empty on an idempotent replay. */
    canceledInstallmentIds: readonly string[];
  }>;

function localDateKey(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year") ?? ""}-${values.get("month") ?? ""}-${values.get("day") ?? ""}`;
}

export async function cancelPurchase(
  repository: PurchaseLedgerRepository,
  rawInput: CancelPurchaseInput,
): Promise<CancelPurchaseResult> {
  const scope = {
    producerId: identifier(rawInput.producerId, "Producer id"),
    purchaseId: identifier(rawInput.purchaseId, "Purchase id"),
  };
  const key = operationKey(rawInput.operationKey);
  const reason = text(rawInput.reason, "Cancellation reason");
  const actorId = identifier(rawInput.actorId, "Cancellation actor id");
  const canceledAt = date(rawInput.canceledAt ?? new Date(), "Cancellation time");
  const expectedDigest = digestCommercialSnapshot({
    kind: "purchase-cancellation-v1",
    ...scope,
    reason,
    actorId,
  });

  return repository.atomically(scope, async (transaction) => {
    let snapshot = ownedSnapshot(await transaction.loadSnapshot(), scope);
    if (snapshot.cancellation) {
      if (snapshot.cancellation.operationKey !== key) operationConflict();
      assertOperationReplay(snapshot.cancellation, expectedDigest);
      const reconciled = await reconcileTransaction(transaction, scope, canceledAt);
      return {
        record: snapshot.cancellation,
        projection: reconciled.projection,
        created: false,
        canceledInstallmentIds: [],
      };
    }
    const canceledDate = localDateKey(canceledAt, snapshot.producer.timeZone);
    const cancellableStatuses: ReadonlySet<LedgerInstallmentInput["status"]> = new Set([
      "not_paid",
      "awaiting_review",
      "partially_paid",
      "overdue",
    ]);
    const projectedStatusById = new Map(
      projection(snapshot, canceledAt).installments.map((installment) => [
        installment.id,
        installment.status,
      ]),
    );
    const futureIds = snapshot.installments
      .filter(
        (installment) =>
          cancellableStatuses.has(projectedStatusById.get(installment.id) ?? installment.status) &&
          (installment.dueAt === null ||
            localDateKey(installment.dueAt, snapshot.producer.timeZone) > canceledDate),
      )
      .map((installment) => installment.id);
    if (futureIds.length > 0) {
      const changed = await transaction.cancelFutureInstallments(futureIds, canceledAt);
      if (changed !== futureIds.length) {
        throw new PurchaseLedgerDomainError("CONFLICT", "Installment changed during cancellation");
      }
    }
    if (!(await transaction.cancelPurchase(canceledAt))) {
      throw new PurchaseLedgerDomainError("CONFLICT", "Purchase changed during cancellation");
    }
    const record = await transaction.insertCancellation({
      purchaseId: scope.purchaseId,
      producerId: scope.producerId,
      operationKey: key,
      operationDigest: expectedDigest,
      reason,
      canceledByClerkUserId: actorId,
      canceledAt,
    });
    snapshot = ownedSnapshot(await transaction.loadSnapshot(), scope);
    const reconciled = await reconcileTransaction(transaction, scope, canceledAt);
    return {
      record,
      projection: reconciled.projection,
      created: true,
      canceledInstallmentIds: futureIds,
    };
  });
}

export type PaymentPauseInput = Readonly<{
  producerId: string;
  purchaseId: string;
  operationKey: string;
  reason: string;
  actorId: string;
  changedAt?: Date;
}>;

async function changePaymentPause(
  repository: PurchaseLedgerRepository,
  rawInput: PaymentPauseInput,
  action: "paused" | "resumed",
): Promise<Readonly<{ event: ProjectPaymentPauseEventRecord; changed: boolean }>> {
  const scope = {
    producerId: identifier(rawInput.producerId, "Producer id"),
    purchaseId: identifier(rawInput.purchaseId, "Purchase id"),
  };
  const key = operationKey(rawInput.operationKey);
  const reason = text(rawInput.reason, action === "paused" ? "Pause reason" : "Resume reason");
  const actorId = identifier(rawInput.actorId, "Project lifecycle actor id");
  const changedAt = date(rawInput.changedAt ?? new Date(), "Project lifecycle change time");

  return repository.atomically(scope, async (transaction) => {
    const snapshot = ownedSnapshot(await transaction.loadSnapshot(), scope);
    const expectedDigest = digestCommercialSnapshot({
      kind: "project-payment-pause-v1",
      purchaseId: scope.purchaseId,
      projectId: snapshot.project.id,
      producerId: scope.producerId,
      action,
      reason,
      actorId,
    });
    const existing = snapshot.pauseEvents.find((event) => event.operationKey === key);
    if (existing) {
      assertOperationReplay(existing, expectedDigest);
      return { event: existing, changed: false };
    }
    const currentProjection = projection(snapshot, changedAt);
    if (action === "paused") {
      if (!currentProjection.installments.some((installment) => installment.status === "overdue")) {
        throw new PurchaseLedgerDomainError("CONFLICT", "Only an overdue purchase can pause work");
      }
      if (snapshot.project.lifecycleStatus !== "active") {
        throw new PurchaseLedgerDomainError("CONFLICT", "Only an active project can be paused");
      }
    } else {
      const latestPauseEvent = [...snapshot.pauseEvents].sort(
        (left, right) =>
          right.changedAt.getTime() - left.changedAt.getTime() || right.id.localeCompare(left.id),
      )[0];
      if (snapshot.project.lifecycleStatus !== "paused" || latestPauseEvent?.action !== "paused") {
        throw new PurchaseLedgerDomainError("CONFLICT", "Only a payment-paused project can resume");
      }
    }
    const from = action === "paused" ? "active" : "paused";
    const to = action === "paused" ? "paused" : "active";
    if (!(await transaction.transitionProject(from, to, changedAt))) {
      throw new PurchaseLedgerDomainError("CONFLICT", "Project state changed concurrently");
    }
    const event = await transaction.insertPauseEvent({
      purchaseId: scope.purchaseId,
      projectId: snapshot.project.id,
      producerId: scope.producerId,
      action,
      operationKey: key,
      operationDigest: expectedDigest,
      reason,
      changedByClerkUserId: actorId,
      changedAt,
    });
    return { event, changed: true };
  });
}

export function pauseProjectForOverdueInstallment(
  repository: PurchaseLedgerRepository,
  input: PaymentPauseInput,
) {
  return changePaymentPause(repository, input, "paused");
}

export function resumePaymentPausedProject(
  repository: PurchaseLedgerRepository,
  input: PaymentPauseInput,
) {
  return changePaymentPause(repository, input, "resumed");
}
