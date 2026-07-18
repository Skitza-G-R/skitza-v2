import {
  summarizePurchaseLedger,
  type InstallmentTrigger,
  type PurchaseInstallmentStatus,
  type PurchaseLedgerSummary,
} from "../purchases/ledger";

export type ClientMoneyScope = Readonly<{
  producerId: string;
  clientContactId: string;
}>;

export type ClientMoneyClientRecord = Readonly<{
  id: string;
  producerId: string;
}>;

export type ClientMoneyProjectRecord = Readonly<{
  id: string;
  producerId: string;
  clientContactId: string;
  title: string;
  lifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
  createdAt: Date;
}>;

export type ClientMoneyPurchaseRecord = Readonly<{
  id: string;
  producerId: string;
  projectId: string;
  clientContactId: string;
  refNumber: string;
  sourceKind:
    | "store_product"
    | "private_offer"
    | "session_product"
    | "paid_add_on"
    | "no_charge_add_on";
  lifecycleStatus: "waiting_for_payment" | "active" | "canceled";
  paymentPlanKind: "full" | "split_50_50" | "monthly" | null;
  commercialSnapshot: unknown;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  acceptedAt: Date;
  activatedAt: Date | null;
  canceledAt: Date | null;
}>;

export type ClientMoneyInstallmentRecord = Readonly<{
  id: string;
  purchaseId: string;
  producerId: string;
  position: number;
  amountCents: number;
  currency: string;
  dueTrigger: InstallmentTrigger;
  dueAt: Date | null;
  triggeredAt: Date | null;
  requiredForActivation: boolean;
  status: PurchaseInstallmentStatus;
  createdAt: Date;
}>;

export type ClientMoneyPaymentRecord = Readonly<{
  id: string;
  purchaseId: string;
  installmentId: string;
  producerId: string;
  proofId: string | null;
  source: "proof" | "manual";
  amountCents: number;
  currency: string;
  paidAt: Date;
  note: string | null;
  createdAt: Date;
}>;

export type ClientMoneyCorrectionRecord = Readonly<{
  id: string;
  purchaseId: string;
  paymentId: string;
  producerId: string;
  sequence: number;
  previousAmountCents: number;
  newAmountCents: number;
  reason: string;
  correctedByClerkUserId: string;
  createdAt: Date;
}>;

export type ClientMoneyWaiverRecord = Readonly<{
  id: string;
  purchaseId: string;
  installmentId: string;
  producerId: string;
  amountCents: number;
  reason: string;
  waivedByClerkUserId: string;
  createdAt: Date;
}>;

export type ClientMoneyProofRecord = Readonly<{
  id: string;
  purchaseId: string;
  installmentId: string;
  producerId: string;
  projectId: string;
  clientContactId: string;
  replacesProofId: string | null;
  amountCents: number;
  currency: string;
  originalFileName: string | null;
  contentType: string;
  sizeBytes: number;
  status: "pending" | "confirmed" | "rejected";
  note: string | null;
  rejectionNote: string | null;
  confirmedAt: Date | null;
  rejectedAt: Date | null;
  createdAt: Date;
}>;

export type ClientMoneySnapshot = {
  client: ClientMoneyClientRecord;
  projects: ClientMoneyProjectRecord[];
  purchases: ClientMoneyPurchaseRecord[];
  installments: ClientMoneyInstallmentRecord[];
  payments: ClientMoneyPaymentRecord[];
  corrections: ClientMoneyCorrectionRecord[];
  waivers: ClientMoneyWaiverRecord[];
  proofs: ClientMoneyProofRecord[];
};

export type ClientMoneyRepository = Readonly<{
  loadSnapshot: (scope: ClientMoneyScope) => Promise<ClientMoneySnapshot | null>;
}>;

export type ClientMoneyCurrencyTotal = Readonly<{
  currency: string;
  purchasedCents: number;
  paidCents: number;
  remainingCents: number;
}>;

export type ClientMoneyCorrection = Readonly<{
  id: string;
  sequence: number;
  previousAmountCents: number;
  newAmountCents: number;
  reason: string;
  correctedAt: Date;
}>;

export type ClientMoneyPayment = Readonly<{
  id: string;
  installmentId: string;
  installmentPosition: number;
  proofId: string | null;
  source: "proof" | "manual";
  originalAmountCents: number;
  effectiveAmountCents: number;
  currency: string;
  paidAt: Date;
  note: string | null;
  createdAt: Date;
  corrections: readonly ClientMoneyCorrection[];
}>;

export type ClientMoneyProof = Readonly<{
  id: string;
  installmentId: string;
  installmentPosition: number;
  replacesProofId: string | null;
  amountCents: number;
  currency: string;
  originalFileName: string | null;
  contentType: string;
  sizeBytes: number;
  status: "pending" | "confirmed" | "rejected";
  note: string | null;
  rejectionNote: string | null;
  confirmedAt: Date | null;
  rejectedAt: Date | null;
  createdAt: Date;
}>;

export type ClientMoneyInstallment = Readonly<{
  id: string;
  position: number;
  amountCents: number;
  currency: string;
  dueTrigger: InstallmentTrigger;
  dueAt: Date | null;
  triggeredAt: Date | null;
  requiredForActivation: boolean;
  status: PurchaseInstallmentStatus;
  createdAt: Date;
}>;

export type ClientMoneyWaiver = Readonly<{
  id: string;
  installmentId: string;
  installmentPosition: number;
  amountCents: number;
  reason: string;
  waivedAt: Date;
}>;

export type ClientMoneyPurchase = Readonly<{
  id: string;
  projectId: string;
  refNumber: string;
  productOrOfferName: string;
  sourceKind: ClientMoneyPurchaseRecord["sourceKind"];
  lifecycleStatus: ClientMoneyPurchaseRecord["lifecycleStatus"];
  paymentPlanKind: ClientMoneyPurchaseRecord["paymentPlanKind"];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  acceptedAt: Date;
  activatedAt: Date | null;
  canceledAt: Date | null;
  ledger: PurchaseLedgerSummary;
  installments: readonly ClientMoneyInstallment[];
  payments: readonly ClientMoneyPayment[];
  proofs: readonly ClientMoneyProof[];
  waivers: readonly ClientMoneyWaiver[];
}>;

export type ClientMoneyProject = Readonly<{
  id: string;
  title: string;
  lifecycleStatus: ClientMoneyProjectRecord["lifecycleStatus"];
  createdAt: Date;
  totals: readonly ClientMoneyCurrencyTotal[];
  purchases: readonly ClientMoneyPurchase[];
}>;

export type ClientMoneyHistory = Readonly<{
  clientContactId: string;
  totals: readonly ClientMoneyCurrencyTotal[];
  projects: readonly ClientMoneyProject[];
}>;

export class ClientMoneyDomainError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INTEGRITY_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "ClientMoneyDomainError";
  }
}

const PROJECT_STATUSES = new Set<ClientMoneyProjectRecord["lifecycleStatus"]>([
  "waiting_for_payment",
  "active",
  "paused",
  "completed",
  "canceled",
]);
const PURCHASE_STATUSES = new Set<ClientMoneyPurchaseRecord["lifecycleStatus"]>([
  "waiting_for_payment",
  "active",
  "canceled",
]);
const PURCHASE_SOURCES = new Set<ClientMoneyPurchaseRecord["sourceKind"]>([
  "store_product",
  "private_offer",
  "session_product",
  "paid_add_on",
  "no_charge_add_on",
]);
const PAYMENT_PLANS = new Set<NonNullable<ClientMoneyPurchaseRecord["paymentPlanKind"]>>([
  "full",
  "split_50_50",
  "monthly",
]);
const INSTALLMENT_TRIGGERS = new Set<InstallmentTrigger>([
  "acceptance",
  "artist_approval",
  "monthly_anniversary",
]);
const INSTALLMENT_STATUSES = new Set<PurchaseInstallmentStatus>([
  "not_paid",
  "awaiting_review",
  "partially_paid",
  "confirmed",
  "overdue",
  "waived",
  "canceled",
]);
const PROOF_STATUSES = new Set<ClientMoneyProofRecord["status"]>([
  "pending",
  "confirmed",
  "rejected",
]);

function notFound(): never {
  throw new ClientMoneyDomainError("NOT_FOUND", "The client was not found");
}

function integrityError(): never {
  throw new ClientMoneyDomainError(
    "INTEGRITY_ERROR",
    "The client money history is inconsistent",
  );
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isNullableValidDate(value: unknown): value is Date | null {
  return value === null || isValidDate(value);
}

function isCents(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function addCents(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) integrityError();
  return result;
}

function assertUniqueId(id: string, ids: Set<string>): void {
  if (!isNonEmpty(id) || ids.has(id)) integrityError();
  ids.add(id);
}

function requiredMapValue<Key, Value>(map: ReadonlyMap<Key, Value>, key: Key): Value {
  const value = map.get(key);
  if (value === undefined) integrityError();
  return value;
}

function productName(purchase: ClientMoneyPurchaseRecord): string {
  if (
    typeof purchase.commercialSnapshot !== "object" ||
    purchase.commercialSnapshot === null
  ) {
    integrityError();
  }
  const snapshot = purchase.commercialSnapshot as Record<string, unknown>;
  const tax = snapshot.tax;
  if (
    !isNonEmpty(snapshot.productOrOfferName) ||
    snapshot.subtotalCents !== purchase.subtotalCents ||
    typeof tax !== "object" ||
    tax === null ||
    (tax as Record<string, unknown>).amountCents !== purchase.taxCents ||
    snapshot.totalCents !== purchase.totalCents ||
    snapshot.currency !== purchase.currency
  ) {
    integrityError();
  }
  return snapshot.productOrOfferName;
}

type MutableTotal = {
  purchasedCents: number;
  paidCents: number;
  remainingCents: number;
};

function totalsFor(purchases: readonly ClientMoneyPurchase[]): readonly ClientMoneyCurrencyTotal[] {
  const totals = new Map<string, MutableTotal>();
  for (const purchase of purchases) {
    const total = totals.get(purchase.currency) ?? {
      purchasedCents: 0,
      paidCents: 0,
      remainingCents: 0,
    };
    total.purchasedCents = addCents(total.purchasedCents, purchase.totalCents);
    total.paidCents = addCents(total.paidCents, purchase.ledger.paidCents);
    total.remainingCents = addCents(
      total.remainingCents,
      purchase.ledger.remainingBalanceCents,
    );
    totals.set(purchase.currency, total);
  }

  return [...totals]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([currency, total]) => ({ currency, ...total }));
}

function compareNewest(
  leftDate: Date,
  leftId: string,
  rightDate: Date,
  rightId: string,
): number {
  const byDate = rightDate.getTime() - leftDate.getTime();
  if (byDate !== 0) return byDate;
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

/**
 * Builds the producer-facing purchase ledger for one stable client id. Proofs
 * remain evidence only: only immutable purchase payment rows, after their
 * correction chains, contribute to paid totals.
 */
export async function getClientMoneyLedger(
  repository: ClientMoneyRepository,
  scope: ClientMoneyScope,
): Promise<ClientMoneyHistory> {
  if (!isNonEmpty(scope.producerId) || !isNonEmpty(scope.clientContactId)) notFound();

  const snapshot = await repository.loadSnapshot(scope);
  if (
    snapshot === null ||
    snapshot.client.id !== scope.clientContactId ||
    snapshot.client.producerId !== scope.producerId
  ) {
    notFound();
  }

  const projectIds = new Set<string>();
  const projectsById = new Map<string, ClientMoneyProjectRecord>();
  for (const project of snapshot.projects) {
    assertUniqueId(project.id, projectIds);
    if (
      project.producerId !== scope.producerId ||
      project.clientContactId !== scope.clientContactId ||
      !isNonEmpty(project.title) ||
      !PROJECT_STATUSES.has(project.lifecycleStatus) ||
      !isValidDate(project.createdAt)
    ) {
      integrityError();
    }
    projectsById.set(project.id, project);
  }

  const purchaseIds = new Set<string>();
  const purchasesById = new Map<string, ClientMoneyPurchaseRecord>();
  const purchaseNames = new Map<string, string>();
  for (const purchase of snapshot.purchases) {
    assertUniqueId(purchase.id, purchaseIds);
    if (
      purchase.producerId !== scope.producerId ||
      purchase.clientContactId !== scope.clientContactId ||
      !projectsById.has(purchase.projectId) ||
      !isNonEmpty(purchase.refNumber) ||
      !PURCHASE_SOURCES.has(purchase.sourceKind) ||
      !PURCHASE_STATUSES.has(purchase.lifecycleStatus) ||
      (purchase.paymentPlanKind !== null && !PAYMENT_PLANS.has(purchase.paymentPlanKind)) ||
      !isCents(purchase.subtotalCents) ||
      !isCents(purchase.taxCents) ||
      !isCents(purchase.totalCents) ||
      !isNonEmpty(purchase.currency) ||
      !isValidDate(purchase.acceptedAt) ||
      !isNullableValidDate(purchase.activatedAt) ||
      !isNullableValidDate(purchase.canceledAt) ||
      (purchase.totalCents === 0) !== (purchase.paymentPlanKind === null)
    ) {
      integrityError();
    }
    purchasesById.set(purchase.id, purchase);
    purchaseNames.set(purchase.id, productName(purchase));
  }

  const installmentIds = new Set<string>();
  const installmentPositions = new Map<string, Set<number>>();
  const installmentsById = new Map<string, ClientMoneyInstallmentRecord>();
  const installmentsByPurchase = new Map<string, ClientMoneyInstallmentRecord[]>();
  for (const installment of snapshot.installments) {
    assertUniqueId(installment.id, installmentIds);
    const purchase = purchasesById.get(installment.purchaseId);
    const positions = installmentPositions.get(installment.purchaseId) ?? new Set<number>();
    if (
      purchase === undefined ||
      installment.producerId !== scope.producerId ||
      !isCents(installment.position, 1) ||
      positions.has(installment.position) ||
      !isCents(installment.amountCents, 1) ||
      installment.currency !== purchase.currency ||
      !INSTALLMENT_TRIGGERS.has(installment.dueTrigger) ||
      !isNullableValidDate(installment.dueAt) ||
      !isNullableValidDate(installment.triggeredAt) ||
      typeof installment.requiredForActivation !== "boolean" ||
      !INSTALLMENT_STATUSES.has(installment.status) ||
      !isValidDate(installment.createdAt)
    ) {
      integrityError();
    }
    positions.add(installment.position);
    installmentPositions.set(installment.purchaseId, positions);
    installmentsById.set(installment.id, installment);
    const rows = installmentsByPurchase.get(installment.purchaseId) ?? [];
    rows.push(installment);
    installmentsByPurchase.set(installment.purchaseId, rows);
  }

  const proofIds = new Set<string>();
  const proofsById = new Map<string, ClientMoneyProofRecord>();
  const proofsByPurchase = new Map<string, ClientMoneyProofRecord[]>();
  for (const proof of snapshot.proofs) {
    assertUniqueId(proof.id, proofIds);
    const purchase = purchasesById.get(proof.purchaseId);
    const installment = installmentsById.get(proof.installmentId);
    if (
      purchase === undefined ||
      installment === undefined ||
      installment.purchaseId !== proof.purchaseId ||
      proof.producerId !== scope.producerId ||
      proof.projectId !== purchase.projectId ||
      proof.clientContactId !== scope.clientContactId ||
      !isCents(proof.amountCents, 1) ||
      proof.currency !== purchase.currency ||
      (proof.originalFileName !== null && !isNonEmpty(proof.originalFileName)) ||
      !isNonEmpty(proof.contentType) ||
      !isCents(proof.sizeBytes) ||
      !PROOF_STATUSES.has(proof.status) ||
      !isValidDate(proof.createdAt) ||
      !isNullableValidDate(proof.confirmedAt) ||
      !isNullableValidDate(proof.rejectedAt) ||
      (proof.status === "pending" &&
        (proof.confirmedAt !== null ||
          proof.rejectedAt !== null ||
          proof.rejectionNote !== null)) ||
      (proof.status === "confirmed" &&
        (proof.confirmedAt === null ||
          proof.rejectedAt !== null ||
          proof.rejectionNote !== null)) ||
      (proof.status === "rejected" &&
        (proof.confirmedAt !== null ||
          proof.rejectedAt === null ||
          !isNonEmpty(proof.rejectionNote)))
    ) {
      integrityError();
    }
    proofsById.set(proof.id, proof);
    const rows = proofsByPurchase.get(proof.purchaseId) ?? [];
    rows.push(proof);
    proofsByPurchase.set(proof.purchaseId, rows);
  }
  for (const proof of snapshot.proofs) {
    if (proof.replacesProofId === null) continue;
    const replaced = proofsById.get(proof.replacesProofId);
    if (
      replaced === undefined ||
      replaced.id === proof.id ||
      replaced.purchaseId !== proof.purchaseId ||
      replaced.installmentId !== proof.installmentId ||
      replaced.producerId !== proof.producerId
    ) {
      integrityError();
    }
  }

  const paymentIds = new Set<string>();
  const paymentsById = new Map<string, ClientMoneyPaymentRecord>();
  const paymentsByPurchase = new Map<string, ClientMoneyPaymentRecord[]>();
  for (const payment of snapshot.payments) {
    assertUniqueId(payment.id, paymentIds);
    const purchase = purchasesById.get(payment.purchaseId);
    const installment = installmentsById.get(payment.installmentId);
    const proof = payment.proofId === null ? null : proofsById.get(payment.proofId);
    if (
      purchase === undefined ||
      installment === undefined ||
      installment.purchaseId !== payment.purchaseId ||
      payment.producerId !== scope.producerId ||
      !isCents(payment.amountCents, 1) ||
      payment.currency !== purchase.currency ||
      !isValidDate(payment.paidAt) ||
      !isValidDate(payment.createdAt) ||
      (payment.source === "proof" &&
        (proof === null ||
          proof === undefined ||
          proof.purchaseId !== payment.purchaseId ||
          proof.installmentId !== payment.installmentId ||
          proof.status !== "confirmed" ||
          proof.amountCents !== payment.amountCents)) ||
      (payment.proofId !== null && proof === undefined)
    ) {
      integrityError();
    }
    paymentsById.set(payment.id, payment);
    const rows = paymentsByPurchase.get(payment.purchaseId) ?? [];
    rows.push(payment);
    paymentsByPurchase.set(payment.purchaseId, rows);
  }

  const correctionIds = new Set<string>();
  const correctionsByPayment = new Map<string, ClientMoneyCorrectionRecord[]>();
  const correctionsByPurchase = new Map<string, ClientMoneyCorrectionRecord[]>();
  for (const correction of snapshot.corrections) {
    assertUniqueId(correction.id, correctionIds);
    const payment = paymentsById.get(correction.paymentId);
    if (
      payment === undefined ||
      correction.purchaseId !== payment.purchaseId ||
      correction.producerId !== scope.producerId ||
      !isCents(correction.sequence, 1) ||
      !isCents(correction.previousAmountCents) ||
      !isCents(correction.newAmountCents) ||
      !isNonEmpty(correction.reason) ||
      !isNonEmpty(correction.correctedByClerkUserId) ||
      !isValidDate(correction.createdAt)
    ) {
      integrityError();
    }
    const paymentRows = correctionsByPayment.get(correction.paymentId) ?? [];
    paymentRows.push(correction);
    correctionsByPayment.set(correction.paymentId, paymentRows);
    const purchaseRows = correctionsByPurchase.get(correction.purchaseId) ?? [];
    purchaseRows.push(correction);
    correctionsByPurchase.set(correction.purchaseId, purchaseRows);
  }

  const waiverIds = new Set<string>();
  const waiversByPurchase = new Map<string, ClientMoneyWaiverRecord[]>();
  for (const waiver of snapshot.waivers) {
    assertUniqueId(waiver.id, waiverIds);
    const purchase = purchasesById.get(waiver.purchaseId);
    const installment = installmentsById.get(waiver.installmentId);
    if (
      purchase === undefined ||
      installment === undefined ||
      installment.purchaseId !== waiver.purchaseId ||
      waiver.producerId !== scope.producerId ||
      !isCents(waiver.amountCents, 1) ||
      !isNonEmpty(waiver.reason) ||
      !isNonEmpty(waiver.waivedByClerkUserId) ||
      !isValidDate(waiver.createdAt)
    ) {
      integrityError();
    }
    const rows = waiversByPurchase.get(waiver.purchaseId) ?? [];
    rows.push(waiver);
    waiversByPurchase.set(waiver.purchaseId, rows);
  }

  const mappedPurchases = new Map<string, ClientMoneyPurchase>();
  for (const purchase of snapshot.purchases) {
    const installments = [...(installmentsByPurchase.get(purchase.id) ?? [])].sort(
      (left, right) => left.position - right.position,
    );
    const payments = paymentsByPurchase.get(purchase.id) ?? [];
    const corrections = correctionsByPurchase.get(purchase.id) ?? [];
    const waivers = waiversByPurchase.get(purchase.id) ?? [];

    let ledger: PurchaseLedgerSummary;
    try {
      ledger = summarizePurchaseLedger({
        totalCents: purchase.totalCents,
        schedule: installments.map((installment) => ({
          sequence: installment.position,
          amountCents: installment.amountCents,
          trigger: installment.dueTrigger,
          status: installment.status,
        })),
        payments: payments.map((payment) => ({
          id: payment.id,
          installmentSequence: requiredMapValue(
            installmentsById,
            payment.installmentId,
          ).position,
          amountCents: payment.amountCents,
          confirmedAt: payment.paidAt,
        })),
        corrections: corrections.map((correction) => ({
          id: correction.id,
          paymentId: correction.paymentId,
          sequence: correction.sequence,
          oldAmountCents: correction.previousAmountCents,
          newAmountCents: correction.newAmountCents,
          reason: correction.reason,
          actorId: correction.correctedByClerkUserId,
          correctedAt: correction.createdAt,
        })),
        waivers: waivers.map((waiver) => ({
          id: waiver.id,
          installmentSequence: requiredMapValue(
            installmentsById,
            waiver.installmentId,
          ).position,
          amountCents: waiver.amountCents,
          reason: waiver.reason,
          actorId: waiver.waivedByClerkUserId,
          waivedAt: waiver.createdAt,
        })),
      });
    } catch {
      integrityError();
    }

    const mappedPayments = payments
      .map((payment): ClientMoneyPayment => {
        const paymentCorrections = [...(correctionsByPayment.get(payment.id) ?? [])].sort(
          (left, right) => left.sequence - right.sequence,
        );
        return {
          id: payment.id,
          installmentId: payment.installmentId,
          installmentPosition: requiredMapValue(
            installmentsById,
            payment.installmentId,
          ).position,
          proofId: payment.proofId,
          source: payment.source,
          originalAmountCents: payment.amountCents,
          effectiveAmountCents:
            paymentCorrections.at(-1)?.newAmountCents ?? payment.amountCents,
          currency: payment.currency,
          paidAt: payment.paidAt,
          note: payment.note,
          createdAt: payment.createdAt,
          corrections: paymentCorrections.map((correction) => ({
            id: correction.id,
            sequence: correction.sequence,
            previousAmountCents: correction.previousAmountCents,
            newAmountCents: correction.newAmountCents,
            reason: correction.reason,
            correctedAt: correction.createdAt,
          })),
        };
      })
      .sort((left, right) => compareNewest(left.paidAt, left.id, right.paidAt, right.id));

    const mappedProofs = [...(proofsByPurchase.get(purchase.id) ?? [])]
      .map(
        (proof): ClientMoneyProof => ({
          id: proof.id,
          installmentId: proof.installmentId,
          installmentPosition: requiredMapValue(installmentsById, proof.installmentId).position,
          replacesProofId: proof.replacesProofId,
          amountCents: proof.amountCents,
          currency: proof.currency,
          originalFileName: proof.originalFileName,
          contentType: proof.contentType,
          sizeBytes: proof.sizeBytes,
          status: proof.status,
          note: proof.note,
          rejectionNote: proof.rejectionNote,
          confirmedAt: proof.confirmedAt,
          rejectedAt: proof.rejectedAt,
          createdAt: proof.createdAt,
        }),
      )
      .sort((left, right) => compareNewest(left.createdAt, left.id, right.createdAt, right.id));

    mappedPurchases.set(purchase.id, {
      id: purchase.id,
      projectId: purchase.projectId,
      refNumber: purchase.refNumber,
      productOrOfferName: requiredMapValue(purchaseNames, purchase.id),
      sourceKind: purchase.sourceKind,
      lifecycleStatus: purchase.lifecycleStatus,
      paymentPlanKind: purchase.paymentPlanKind,
      subtotalCents: purchase.subtotalCents,
      taxCents: purchase.taxCents,
      totalCents: purchase.totalCents,
      currency: purchase.currency,
      acceptedAt: purchase.acceptedAt,
      activatedAt: purchase.activatedAt,
      canceledAt: purchase.canceledAt,
      ledger,
      installments: installments.map((installment) => ({
        id: installment.id,
        position: installment.position,
        amountCents: installment.amountCents,
        currency: installment.currency,
        dueTrigger: installment.dueTrigger,
        dueAt: installment.dueAt,
        triggeredAt: installment.triggeredAt,
        requiredForActivation: installment.requiredForActivation,
        status: installment.status,
        createdAt: installment.createdAt,
      })),
      payments: mappedPayments,
      proofs: mappedProofs,
      waivers: waivers
        .map(
          (waiver): ClientMoneyWaiver => ({
            id: waiver.id,
            installmentId: waiver.installmentId,
            installmentPosition: requiredMapValue(
              installmentsById,
              waiver.installmentId,
            ).position,
            amountCents: waiver.amountCents,
            reason: waiver.reason,
            waivedAt: waiver.createdAt,
          }),
        )
        .sort((left, right) =>
          compareNewest(left.waivedAt, left.id, right.waivedAt, right.id),
        ),
    });
  }

  const mappedProjects = snapshot.projects
    .map((project): ClientMoneyProject => {
      const purchases = snapshot.purchases
        .filter((purchase) => purchase.projectId === project.id)
        .map((purchase) => requiredMapValue(mappedPurchases, purchase.id))
        .sort((left, right) =>
          compareNewest(left.acceptedAt, left.id, right.acceptedAt, right.id),
        );
      return {
        id: project.id,
        title: project.title,
        lifecycleStatus: project.lifecycleStatus,
        createdAt: project.createdAt,
        totals: totalsFor(purchases),
        purchases,
      };
    })
    .sort((left, right) => compareNewest(left.createdAt, left.id, right.createdAt, right.id));

  return {
    clientContactId: scope.clientContactId,
    totals: totalsFor([...mappedPurchases.values()]),
    projects: mappedProjects,
  };
}

export const loadClientMoneyHistory = getClientMoneyLedger;
