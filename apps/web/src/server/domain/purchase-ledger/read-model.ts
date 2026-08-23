import type { PurchaseCommercialSnapshot } from "@skitza/db";

import {
  hasPaymentInstructions,
  isInstallmentPayableForInstructions,
  normalizePaymentInstructions,
  type PaymentInstructions,
} from "../payment-instructions/policy";
import {
  projectPurchaseLedger,
  PurchaseLedgerDomainError,
  type InstallmentLedgerProjection,
  type LedgerInstallmentStatus,
} from "./policy";

export type ProducerPaymentBucket = "needs_review" | "due_or_overdue" | "upcoming" | "history";
export type ArtistPaymentBucket = "waiting" | "active" | "history";
export type PaymentCollection = "active" | "history";

export type PaymentLedgerReadScope =
  | Readonly<{
      kind: "producer";
      producerId: string;
      projectId?: string;
      clientContactId?: string;
    }>
  | Readonly<{ kind: "artist"; clerkUserId: string }>;

export type PaymentReadProducerRecord = Readonly<{
  id: string;
  displayName: string | null;
  timeZone: string;
  paymentDetails: unknown;
}>;

export type PaymentReadClientRecord = Readonly<{
  id: string;
  producerId: string;
  name: string;
  clerkUserId: string | null;
  archivedAt: Date | null;
}>;

export type PaymentReadProjectRecord = Readonly<{
  id: string;
  producerId: string;
  clientContactId: string;
  title: string;
  lifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
  createdAt: Date;
}>;

export type PaymentReadPurchaseRecord = Readonly<{
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
    | "no_charge_add_on"
    | "imported_existing_work";
  lifecycleStatus: "waiting_for_payment" | "active" | "canceled";
  paymentPlanKind: "full" | "split_50_50" | "monthly" | null;
  commercialSnapshot: PurchaseCommercialSnapshot;
  snapshotDigest: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  acceptedAt: Date | null;
  commercialEstablishedAt: Date;
  activatedAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
}>;

export type PaymentReadAcceptanceRecord = Readonly<{
  id: string;
  purchaseId: string;
  producerId: string;
  clientContactId: string;
  acceptedSnapshot: PurchaseCommercialSnapshot;
  snapshotDigest: string;
  acceptedAt: Date;
}>;

export type PaymentReadImportAttestationRecord = Readonly<{
  id: string;
  purchaseId: string;
  producerId: string;
  clientContactId: string;
  importedSnapshot: PurchaseCommercialSnapshot;
  snapshotDigest: string;
  importedAt: Date;
}>;

export type PaymentReadInstallmentRecord = Readonly<{
  id: string;
  purchaseId: string;
  producerId: string;
  position: number;
  amountCents: number;
  currency: string;
  dueTrigger: "acceptance" | "producer_import" | "monthly_anniversary" | "artist_approval";
  dueAt: Date | null;
  triggeredAt: Date | null;
  requiredForActivation: boolean;
  status: LedgerInstallmentStatus;
  remindersEnabled: boolean;
}>;

export type PaymentReadPaymentRecord = Readonly<{
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

export type PaymentReadCorrectionRecord = Readonly<{
  id: string;
  purchaseId: string;
  paymentId: string;
  producerId: string;
  sequence: number;
  previousAmountCents: number;
  newAmountCents: number;
  reason: string;
  createdAt: Date;
}>;

export type PaymentReadWaiverRecord = Readonly<{
  id: string;
  purchaseId: string;
  installmentId: string;
  producerId: string;
  amountCents: number;
  reason: string;
  createdAt: Date;
}>;

export type PaymentReadProofRecord = Readonly<{
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
  status: "pending" | "confirmed" | "rejected";
  note: string | null;
  rejectionNote: string | null;
  confirmedAt: Date | null;
  rejectedAt: Date | null;
  createdAt: Date;
}>;

export type PaymentReadCancellationRecord = Readonly<{
  id: string;
  purchaseId: string;
  producerId: string;
  reason: string;
  canceledAt: Date;
}>;

export type PaymentReadPauseRecord = Readonly<{
  id: string;
  purchaseId: string;
  projectId: string;
  producerId: string;
  action: "paused" | "resumed";
  reason: string;
  changedAt: Date;
}>;

export type PaymentReadDownloadOverrideRecord = Readonly<{
  id: string;
  purchaseId: string;
  producerId: string;
  versionId: string;
  versionLabel: string;
  sequence: number;
  enabled: boolean;
  audioDeletedAt: Date | null;
  createdAt: Date;
}>;

export type PaymentLedgerReadSnapshot = Readonly<{
  scope: PaymentLedgerReadScope;
  producers: readonly PaymentReadProducerRecord[];
  clients: readonly PaymentReadClientRecord[];
  projects: readonly PaymentReadProjectRecord[];
  purchases: readonly PaymentReadPurchaseRecord[];
  acceptances: readonly PaymentReadAcceptanceRecord[];
  importAttestations: readonly PaymentReadImportAttestationRecord[];
  installments: readonly PaymentReadInstallmentRecord[];
  payments: readonly PaymentReadPaymentRecord[];
  corrections: readonly PaymentReadCorrectionRecord[];
  waivers: readonly PaymentReadWaiverRecord[];
  proofs: readonly PaymentReadProofRecord[];
  cancellations: readonly PaymentReadCancellationRecord[];
  pauseEvents: readonly PaymentReadPauseRecord[];
  downloadOverrides: readonly PaymentReadDownloadOverrideRecord[];
}>;

export interface PaymentLedgerReadRepository {
  loadSnapshot(scope: PaymentLedgerReadScope): Promise<PaymentLedgerReadSnapshot | null>;
}

export type PaymentCurrencyTotal = Readonly<{
  currency: string;
  purchaseTotalCents: number;
  dueNowCents: number;
  totalRemainingCents: number;
}>;

export type PaymentInstallmentProjection = PaymentReadInstallmentRecord &
  InstallmentLedgerProjection;

export type PaymentProjection = PaymentReadPaymentRecord &
  Readonly<{ effectiveAmountCents: number }>;

export const IMPORTED_EXISTING_WORK_NOTICE =
  "Added by producer from an existing agreement" as const;

export type PaymentPurchaseProvenance =
  | Readonly<{
      kind: "artist_acceptance";
      id: string;
      acceptedAt: Date;
      acceptedSnapshot: PurchaseCommercialSnapshot;
    }>
  | Readonly<{
      kind: "producer_import";
      id: string;
      importedAt: Date;
      importedSnapshot: PurchaseCommercialSnapshot;
      notice: typeof IMPORTED_EXISTING_WORK_NOTICE;
    }>;

export type PaymentPurchaseProjection = Readonly<{
  id: string;
  producerId: string;
  producerName: string;
  projectId: string;
  clientContactId: string;
  clientName: string;
  refNumber: string;
  sourceKind: PaymentReadPurchaseRecord["sourceKind"];
  lifecycleStatus: PaymentReadPurchaseRecord["lifecycleStatus"];
  paymentPlanKind: PaymentReadPurchaseRecord["paymentPlanKind"];
  commercialSnapshot: PurchaseCommercialSnapshot;
  provenance: PaymentPurchaseProvenance;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  commercialEstablishedAt: Date;
  activatedAt: Date | null;
  canceledAt: Date | null;
  paidCents: number;
  waivedCents: number;
  dueNowCents: number;
  totalRemainingCents: number;
  overpaidCents: number;
  fullyPaid: boolean;
  collection: PaymentCollection;
  producerBucket: ProducerPaymentBucket;
  artistBucket: ArtistPaymentBucket;
  installments: readonly PaymentInstallmentProjection[];
  nextPayment: Readonly<{
    installmentId: string;
    position: number;
    amountCents: number;
    dueAt: Date | null;
    dueTrigger: PaymentReadInstallmentRecord["dueTrigger"];
    status: LedgerInstallmentStatus;
    // The same due-now truth every producer surface sums into dueNowCents.
    // "Payable" (showPayNextPayment) is looser — a monthly installment is
    // payable early from the moment its schedule is anchored — so a surface
    // that says "due" must read this flag, not payability, or it will
    // contradict the producer's "all payments are up to date".
    dueNow: boolean;
  }> | null;
  showPayNextPayment: boolean;
  currentInstructions: PaymentInstructions | null;
  payments: readonly PaymentProjection[];
  corrections: readonly PaymentReadCorrectionRecord[];
  proofs: readonly PaymentReadProofRecord[];
  waivers: readonly PaymentReadWaiverRecord[];
  cancellation: PaymentReadCancellationRecord | null;
  pauseEvents: readonly PaymentReadPauseRecord[];
  downloadOverrides: readonly PaymentReadDownloadOverrideRecord[];
  activeDownloadOverrides: readonly Readonly<{ versionId: string; versionLabel: string }>[];
}>;

export type PaymentProjectProjection = Readonly<{
  id: string;
  producerId: string;
  clientContactId: string;
  title: string;
  lifecycleStatus: PaymentReadProjectRecord["lifecycleStatus"];
  createdAt: Date;
  totals: readonly PaymentCurrencyTotal[];
  purchases: readonly PaymentPurchaseProjection[];
}>;

export type PaymentBucketProjection = Readonly<{
  totals: readonly PaymentCurrencyTotal[];
  projects: readonly PaymentProjectProjection[];
}>;

export type PaymentReadModel = Readonly<{
  totals: readonly PaymentCurrencyTotal[];
  projects: readonly PaymentProjectProjection[];
  producerBuckets: Readonly<Record<ProducerPaymentBucket, PaymentBucketProjection>>;
  artistBuckets: Readonly<Record<ArtistPaymentBucket, PaymentBucketProjection>>;
}>;

/** Latest enabled override for each still-stored exact version. */
export function activeDownloadOverrides(
  events: readonly PaymentReadDownloadOverrideRecord[],
): readonly Readonly<{ versionId: string; versionLabel: string }>[] {
  const latestByVersion = new Map<string, PaymentReadDownloadOverrideRecord>();
  for (const event of [...events].sort(
    (left, right) =>
      right.sequence - left.sequence || right.createdAt.getTime() - left.createdAt.getTime(),
  )) {
    if (!latestByVersion.has(event.versionId)) latestByVersion.set(event.versionId, event);
  }
  return [...latestByVersion.values()]
    .filter((event) => event.enabled && event.audioDeletedAt == null)
    .map((event) => ({ versionId: event.versionId, versionLabel: event.versionLabel }));
}

function fail(code: "INVALID_INPUT" | "NOT_FOUND" | "INTEGRITY_ERROR", message: string): never {
  throw new PurchaseLedgerDomainError(code, message);
}

function validId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) fail("INVALID_INPUT", `${label} is required`);
  return normalized;
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    fail("INTEGRITY_ERROR", `${label} is invalid`);
  }
  return value;
}

function uniqueById<T extends { id: string }>(rows: readonly T[], label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    if (!row.id.trim() || result.has(row.id))
      fail("INTEGRITY_ERROR", `${label} identity is invalid`);
    result.set(row.id, row);
  }
  return result;
}

function safeAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) fail("INTEGRITY_ERROR", "Payment totals overflowed");
  return value;
}

function totalsFor(
  purchases: readonly PaymentPurchaseProjection[],
): readonly PaymentCurrencyTotal[] {
  const totals = new Map<
    string,
    { purchaseTotalCents: number; dueNowCents: number; totalRemainingCents: number }
  >();
  for (const purchase of purchases) {
    const current = totals.get(purchase.currency) ?? {
      purchaseTotalCents: 0,
      dueNowCents: 0,
      totalRemainingCents: 0,
    };
    current.purchaseTotalCents = safeAdd(current.purchaseTotalCents, purchase.totalCents);
    current.dueNowCents = safeAdd(current.dueNowCents, purchase.dueNowCents);
    current.totalRemainingCents = safeAdd(
      current.totalRemainingCents,
      purchase.totalRemainingCents,
    );
    totals.set(purchase.currency, current);
  }
  return Object.freeze(
    [...totals]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, values]) => Object.freeze({ currency, ...values })),
  );
}

function bucketFrom(
  projects: readonly PaymentProjectProjection[],
  include: (purchase: PaymentPurchaseProjection) => boolean,
): PaymentBucketProjection {
  const selected = projects
    .map((project) => {
      const purchases = project.purchases.filter(include);
      return purchases.length === 0
        ? null
        : Object.freeze({
            ...project,
            totals: totalsFor(purchases),
            purchases: Object.freeze(purchases),
          });
    })
    .filter((project): project is PaymentProjectProjection => project !== null);
  return Object.freeze({
    totals: totalsFor(selected.flatMap((project) => project.purchases)),
    projects: Object.freeze(selected),
  });
}

function correctedPaymentAmounts(
  payments: readonly PaymentReadPaymentRecord[],
  corrections: readonly PaymentReadCorrectionRecord[],
): Map<string, number> {
  const amounts = new Map(payments.map((payment) => [payment.id, payment.amountCents]));
  for (const correction of [...corrections].sort(
    (left, right) =>
      left.paymentId.localeCompare(right.paymentId) || left.sequence - right.sequence,
  )) {
    amounts.set(correction.paymentId, correction.newAmountCents);
  }
  return amounts;
}

function installmentIsDueNow(
  installment: PaymentReadInstallmentRecord,
  remainingCents: number,
  pendingProofInstallmentIds: ReadonlySet<string>,
  asOf: Date,
): boolean {
  if (remainingCents <= 0 || pendingProofInstallmentIds.has(installment.id)) return false;
  if (
    installment.status === "confirmed" ||
    installment.status === "waived" ||
    installment.status === "canceled" ||
    installment.status === "awaiting_review"
  ) {
    return false;
  }
  if (
    installment.status === "overdue" ||
    installment.dueTrigger === "acceptance" ||
    installment.dueTrigger === "producer_import"
  ) {
    return true;
  }
  if (installment.dueAt !== null && installment.dueAt.getTime() <= asOf.getTime()) return true;
  return installment.dueTrigger === "artist_approval" && installment.triggeredAt !== null;
}

function sameSnapshot(
  purchase: PaymentReadPurchaseRecord,
  provenance: Readonly<{
    snapshotDigest: string;
    snapshot: PurchaseCommercialSnapshot;
  }>,
): boolean {
  return (
    provenance.snapshotDigest === purchase.snapshotDigest &&
    JSON.stringify(provenance.snapshot) === JSON.stringify(purchase.commercialSnapshot)
  );
}

/** Build every role-shaped payment view from one immutable, read-only database snapshot. */
export function buildPaymentReadModel(
  snapshot: PaymentLedgerReadSnapshot,
  asOfValue = new Date(),
): PaymentReadModel {
  const asOf = validDate(asOfValue, "Payment read timestamp");
  const producers = uniqueById(snapshot.producers, "Producer");
  const clients = uniqueById(snapshot.clients, "Client");
  const projects = uniqueById(snapshot.projects, "Project");
  const purchases = uniqueById(snapshot.purchases, "Purchase");
  const acceptances = uniqueById(snapshot.acceptances, "Acceptance");
  const importAttestations = uniqueById(snapshot.importAttestations, "Import attestation");
  const installments = uniqueById(snapshot.installments, "Installment");
  const payments = uniqueById(snapshot.payments, "Payment");
  uniqueById(snapshot.corrections, "Correction");
  uniqueById(snapshot.waivers, "Waiver");
  const proofs = uniqueById(snapshot.proofs, "Proof");
  uniqueById(snapshot.cancellations, "Cancellation");
  uniqueById(snapshot.pauseEvents, "Pause event");
  uniqueById(snapshot.downloadOverrides, "Download override");

  if (snapshot.scope.kind === "producer") {
    if (snapshot.scope.projectId && snapshot.scope.clientContactId) {
      fail("INVALID_INPUT", "Project and client payment scopes cannot be combined");
    }
    if (!producers.has(snapshot.scope.producerId)) {
      fail("NOT_FOUND", "Payment history was not found");
    }
  } else {
    validId(snapshot.scope.clerkUserId, "Artist identity");
  }

  for (const client of clients.values()) {
    if (!producers.has(client.producerId)) fail("INTEGRITY_ERROR", "Client escaped producer scope");
    if (snapshot.scope.kind === "producer" && client.producerId !== snapshot.scope.producerId) {
      fail("INTEGRITY_ERROR", "Client escaped producer scope");
    }
    if (
      snapshot.scope.kind === "artist" &&
      (client.clerkUserId !== snapshot.scope.clerkUserId || client.archivedAt !== null)
    ) {
      fail("INTEGRITY_ERROR", "Client escaped artist ownership");
    }
  }

  for (const project of projects.values()) {
    const client = clients.get(project.clientContactId);
    if (!client || client.producerId !== project.producerId || !producers.has(project.producerId)) {
      fail("INTEGRITY_ERROR", "Project escaped client or producer scope");
    }
    validDate(project.createdAt, "Project creation date");
    if (
      snapshot.scope.kind === "producer" &&
      ((snapshot.scope.projectId && project.id !== snapshot.scope.projectId) ||
        (snapshot.scope.clientContactId &&
          project.clientContactId !== snapshot.scope.clientContactId))
    ) {
      fail("INTEGRITY_ERROR", "Project escaped the requested payment scope");
    }
  }

  const acceptanceByPurchase = new Map<string, PaymentReadAcceptanceRecord>();
  for (const acceptance of acceptances.values()) {
    if (acceptanceByPurchase.has(acceptance.purchaseId)) {
      fail("INTEGRITY_ERROR", "Purchase has duplicate acceptance history");
    }
    acceptanceByPurchase.set(acceptance.purchaseId, acceptance);
  }
  const importAttestationByPurchase = new Map<string, PaymentReadImportAttestationRecord>();
  for (const attestation of importAttestations.values()) {
    if (importAttestationByPurchase.has(attestation.purchaseId)) {
      fail("INTEGRITY_ERROR", "Purchase has duplicate import attestation history");
    }
    importAttestationByPurchase.set(attestation.purchaseId, attestation);
  }

  const installmentsByPurchase = new Map<string, PaymentReadInstallmentRecord[]>();
  for (const installment of installments.values()) {
    if (!purchases.has(installment.purchaseId)) {
      fail("INTEGRITY_ERROR", "Installment escaped the loaded purchase scope");
    }
    const rows = installmentsByPurchase.get(installment.purchaseId) ?? [];
    rows.push(installment);
    installmentsByPurchase.set(installment.purchaseId, rows);
  }
  const paymentsByPurchase = new Map<string, PaymentReadPaymentRecord[]>();
  for (const payment of payments.values()) {
    const installment = installments.get(payment.installmentId);
    if (!purchases.has(payment.purchaseId) || installment?.purchaseId !== payment.purchaseId) {
      fail("INTEGRITY_ERROR", "Payment escaped the loaded installment scope");
    }
    const rows = paymentsByPurchase.get(payment.purchaseId) ?? [];
    rows.push(payment);
    paymentsByPurchase.set(payment.purchaseId, rows);
  }
  const correctionsByPurchase = new Map<string, PaymentReadCorrectionRecord[]>();
  for (const correction of snapshot.corrections) {
    const payment = payments.get(correction.paymentId);
    if (!purchases.has(correction.purchaseId) || payment?.purchaseId !== correction.purchaseId) {
      fail("INTEGRITY_ERROR", "Correction escaped the loaded payment scope");
    }
    const rows = correctionsByPurchase.get(correction.purchaseId) ?? [];
    rows.push(correction);
    correctionsByPurchase.set(correction.purchaseId, rows);
  }
  const waiversByPurchase = new Map<string, PaymentReadWaiverRecord[]>();
  for (const waiver of snapshot.waivers) {
    const installment = installments.get(waiver.installmentId);
    if (!purchases.has(waiver.purchaseId) || installment?.purchaseId !== waiver.purchaseId) {
      fail("INTEGRITY_ERROR", "Waiver escaped the loaded installment scope");
    }
    const rows = waiversByPurchase.get(waiver.purchaseId) ?? [];
    rows.push(waiver);
    waiversByPurchase.set(waiver.purchaseId, rows);
  }
  const proofsByPurchase = new Map<string, PaymentReadProofRecord[]>();
  for (const proof of proofs.values()) {
    const installment = installments.get(proof.installmentId);
    if (!purchases.has(proof.purchaseId) || installment?.purchaseId !== proof.purchaseId) {
      fail("INTEGRITY_ERROR", "Proof escaped the loaded installment scope");
    }
    const rows = proofsByPurchase.get(proof.purchaseId) ?? [];
    rows.push(proof);
    proofsByPurchase.set(proof.purchaseId, rows);
  }
  const cancellationByPurchase = new Map<string, PaymentReadCancellationRecord>();
  for (const cancellation of snapshot.cancellations) {
    if (!purchases.has(cancellation.purchaseId)) {
      fail("INTEGRITY_ERROR", "Cancellation escaped the loaded purchase scope");
    }
    if (cancellationByPurchase.has(cancellation.purchaseId)) {
      fail("INTEGRITY_ERROR", "Purchase has duplicate cancellation history");
    }
    cancellationByPurchase.set(cancellation.purchaseId, cancellation);
  }
  const pausesByPurchase = new Map<string, PaymentReadPauseRecord[]>();
  for (const pause of snapshot.pauseEvents) {
    if (!purchases.has(pause.purchaseId)) {
      fail("INTEGRITY_ERROR", "Pause event escaped the loaded purchase scope");
    }
    const rows = pausesByPurchase.get(pause.purchaseId) ?? [];
    rows.push(pause);
    pausesByPurchase.set(pause.purchaseId, rows);
  }
  const overridesByPurchase = new Map<string, PaymentReadDownloadOverrideRecord[]>();
  for (const override of snapshot.downloadOverrides) {
    if (!purchases.has(override.purchaseId)) {
      fail("INTEGRITY_ERROR", "Download override escaped the loaded purchase scope");
    }
    const rows = overridesByPurchase.get(override.purchaseId) ?? [];
    rows.push(override);
    overridesByPurchase.set(override.purchaseId, rows);
  }

  const mappedPurchases = new Map<string, PaymentPurchaseProjection>();
  for (const purchase of purchases.values()) {
    const project = projects.get(purchase.projectId);
    const client = clients.get(purchase.clientContactId);
    const producer = producers.get(purchase.producerId);
    const acceptance = acceptanceByPurchase.get(purchase.id);
    const importAttestation = importAttestationByPurchase.get(purchase.id);
    if (
      !project ||
      !client ||
      !producer ||
      project.producerId !== purchase.producerId ||
      project.clientContactId !== purchase.clientContactId ||
      client.producerId !== purchase.producerId
    ) {
      fail("INTEGRITY_ERROR", "Purchase escaped its commercial owner scope");
    }
    let provenance: PaymentPurchaseProvenance;
    if (purchase.sourceKind === "imported_existing_work") {
      if (
        acceptance ||
        !importAttestation ||
        purchase.acceptedAt !== null ||
        importAttestation.producerId !== purchase.producerId ||
        importAttestation.clientContactId !== purchase.clientContactId ||
        importAttestation.importedAt.getTime() !== purchase.commercialEstablishedAt.getTime() ||
        !sameSnapshot(purchase, {
          snapshotDigest: importAttestation.snapshotDigest,
          snapshot: importAttestation.importedSnapshot,
        })
      ) {
        fail("INTEGRITY_ERROR", "Imported purchase is missing immutable Producer attestation");
      }
      provenance = Object.freeze({
        kind: "producer_import" as const,
        id: importAttestation.id,
        importedAt: importAttestation.importedAt,
        importedSnapshot: importAttestation.importedSnapshot,
        notice: IMPORTED_EXISTING_WORK_NOTICE,
      });
    } else {
      if (
        importAttestation ||
        !acceptance ||
        purchase.acceptedAt === null ||
        purchase.acceptedAt.getTime() !== purchase.commercialEstablishedAt.getTime() ||
        acceptance.producerId !== purchase.producerId ||
        acceptance.clientContactId !== purchase.clientContactId ||
        acceptance.acceptedAt.getTime() !== purchase.acceptedAt.getTime() ||
        !sameSnapshot(purchase, {
          snapshotDigest: acceptance.snapshotDigest,
          snapshot: acceptance.acceptedSnapshot,
        })
      ) {
        fail("INTEGRITY_ERROR", "Accepted purchase is missing immutable Artist acceptance");
      }
      provenance = Object.freeze({
        kind: "artist_acceptance" as const,
        id: acceptance.id,
        acceptedAt: acceptance.acceptedAt,
        acceptedSnapshot: acceptance.acceptedSnapshot,
      });
    }

    const purchaseInstallments = [...(installmentsByPurchase.get(purchase.id) ?? [])].sort(
      (left, right) => left.position - right.position,
    );
    const purchasePayments = paymentsByPurchase.get(purchase.id) ?? [];
    const purchaseCorrections = correctionsByPurchase.get(purchase.id) ?? [];
    const purchaseWaivers = waiversByPurchase.get(purchase.id) ?? [];
    const purchaseProofs = proofsByPurchase.get(purchase.id) ?? [];
    const pendingProofInstallmentIds = purchaseProofs
      .filter((proof) => proof.status === "pending")
      .map((proof) => proof.installmentId);
    const pendingProofInstallmentIdSet = new Set(pendingProofInstallmentIds);

    for (const row of [
      ...purchaseInstallments,
      ...purchasePayments,
      ...purchaseCorrections,
      ...purchaseWaivers,
    ]) {
      if (row.purchaseId !== purchase.id || row.producerId !== purchase.producerId) {
        fail("INTEGRITY_ERROR", "Money history escaped its purchase scope");
      }
    }
    for (const proof of purchaseProofs) {
      if (
        proof.producerId !== purchase.producerId ||
        proof.projectId !== purchase.projectId ||
        proof.clientContactId !== purchase.clientContactId ||
        !installments.has(proof.installmentId)
      ) {
        fail("INTEGRITY_ERROR", "Proof history escaped its purchase scope");
      }
    }

    const ledger = projectPurchaseLedger({
      purchase: {
        id: purchase.id,
        producerId: purchase.producerId,
        currency: purchase.currency,
        lifecycleStatus: purchase.lifecycleStatus,
        wasActivated: purchase.activatedAt !== null,
      },
      installments: purchaseInstallments.map((installment) => ({
        id: installment.id,
        purchaseId: installment.purchaseId,
        producerId: installment.producerId,
        position: installment.position,
        amountCents: installment.amountCents,
        currency: installment.currency,
        dueAt: installment.dueAt,
        requiredForActivation: installment.requiredForActivation,
        status: installment.status,
      })),
      payments: purchasePayments.map((payment) => ({
        id: payment.id,
        purchaseId: payment.purchaseId,
        installmentId: payment.installmentId,
        producerId: payment.producerId,
        amountCents: payment.amountCents,
        currency: payment.currency,
      })),
      corrections: purchaseCorrections.map((correction) => ({
        id: correction.id,
        purchaseId: correction.purchaseId,
        paymentId: correction.paymentId,
        producerId: correction.producerId,
        sequence: correction.sequence,
        previousAmountCents: correction.previousAmountCents,
        newAmountCents: correction.newAmountCents,
      })),
      waivers: purchaseWaivers.map((waiver) => ({
        id: waiver.id,
        purchaseId: waiver.purchaseId,
        installmentId: waiver.installmentId,
        producerId: waiver.producerId,
        amountCents: waiver.amountCents,
      })),
      pendingProofInstallmentIds,
      asOf,
      timeZone: producer.timeZone,
    });

    const sourceByInstallment = new Map(
      purchaseInstallments.map((installment) => [installment.id, installment]),
    );
    const mappedInstallments = ledger.installments.map((projected) => {
      const source = sourceByInstallment.get(projected.id);
      if (!source) fail("INTEGRITY_ERROR", "Projected installment was not found");
      return Object.freeze({ ...source, ...projected });
    });
    const dueNowCents = mappedInstallments.reduce(
      (sum, installment) =>
        installmentIsDueNow(
          sourceByInstallment.get(installment.id) ?? installment,
          installment.remainingCents,
          pendingProofInstallmentIdSet,
          asOf,
        )
          ? safeAdd(sum, installment.remainingCents)
          : sum,
      0,
    );
    const nextInstallment = mappedInstallments.find(
      (installment) => installment.remainingCents > 0 && installment.status !== "canceled",
    );
    const showPayNextPayment = Boolean(
      purchase.lifecycleStatus !== "canceled" &&
      nextInstallment &&
      !pendingProofInstallmentIdSet.has(nextInstallment.id) &&
      isInstallmentPayableForInstructions(
        {
          status: sourceByInstallment.get(nextInstallment.id)?.status ?? nextInstallment.status,
          dueTrigger: nextInstallment.dueTrigger,
          dueAt: nextInstallment.dueAt,
          triggeredAt: nextInstallment.triggeredAt,
        },
        asOf,
      ),
    );
    const collection: PaymentCollection =
      purchase.lifecycleStatus === "canceled" || ledger.fullyPaidForDownloads
        ? "history"
        : "active";
    const hasPendingProof = purchaseProofs.some((proof) => proof.status === "pending");
    const producerBucket: ProducerPaymentBucket =
      collection === "history"
        ? "history"
        : hasPendingProof
          ? "needs_review"
          : dueNowCents > 0
            ? "due_or_overdue"
            : "upcoming";
    const artistBucket: ArtistPaymentBucket =
      collection === "history"
        ? "history"
        : purchase.lifecycleStatus === "waiting_for_payment"
          ? "waiting"
          : "active";
    const instructions = normalizePaymentInstructions(
      (producer.paymentDetails ?? {}) as Partial<Record<keyof PaymentInstructions, string>>,
    );
    const effectiveAmounts = correctedPaymentAmounts(purchasePayments, purchaseCorrections);
    const cancellation = cancellationByPurchase.get(purchase.id) ?? null;
    if (cancellation && cancellation.producerId !== purchase.producerId) {
      fail("INTEGRITY_ERROR", "Cancellation escaped its purchase scope");
    }
    const pauseEvents = pausesByPurchase.get(purchase.id) ?? [];
    const downloadOverrides = overridesByPurchase.get(purchase.id) ?? [];
    if (
      pauseEvents.some(
        (event) =>
          event.producerId !== purchase.producerId || event.projectId !== purchase.projectId,
      ) ||
      downloadOverrides.some((event) => event.producerId !== purchase.producerId)
    ) {
      fail("INTEGRITY_ERROR", "Purchase event history escaped its scope");
    }
    const currentActiveDownloadOverrides = activeDownloadOverrides(downloadOverrides);

    mappedPurchases.set(
      purchase.id,
      Object.freeze({
        id: purchase.id,
        producerId: purchase.producerId,
        producerName: producer.displayName?.trim() || "Your producer",
        projectId: purchase.projectId,
        clientContactId: purchase.clientContactId,
        clientName: client.name,
        refNumber: purchase.refNumber,
        sourceKind: purchase.sourceKind,
        lifecycleStatus: purchase.lifecycleStatus,
        paymentPlanKind: purchase.paymentPlanKind,
        commercialSnapshot: purchase.commercialSnapshot,
        provenance,
        subtotalCents: purchase.subtotalCents,
        taxCents: purchase.taxCents,
        totalCents: purchase.totalCents,
        currency: purchase.currency,
        commercialEstablishedAt: purchase.commercialEstablishedAt,
        activatedAt: purchase.activatedAt,
        canceledAt: purchase.canceledAt,
        paidCents: ledger.paidCents,
        waivedCents: ledger.waivedCents,
        dueNowCents,
        totalRemainingCents: ledger.remainingCents,
        overpaidCents: ledger.overpaidCents,
        fullyPaid: ledger.fullyPaidForDownloads,
        collection,
        producerBucket,
        artistBucket,
        installments: Object.freeze(mappedInstallments),
        nextPayment: nextInstallment
          ? Object.freeze({
              installmentId: nextInstallment.id,
              position: nextInstallment.position,
              amountCents: nextInstallment.remainingCents,
              dueAt: nextInstallment.dueAt,
              dueTrigger: nextInstallment.dueTrigger,
              status: nextInstallment.status,
              dueNow: installmentIsDueNow(
                sourceByInstallment.get(nextInstallment.id) ?? nextInstallment,
                nextInstallment.remainingCents,
                pendingProofInstallmentIdSet,
                asOf,
              ),
            })
          : null,
        showPayNextPayment,
        currentInstructions: hasPaymentInstructions(instructions) ? instructions : null,
        payments: Object.freeze(
          [...purchasePayments]
            .map((payment) =>
              Object.freeze({
                ...payment,
                effectiveAmountCents: effectiveAmounts.get(payment.id) ?? payment.amountCents,
              }),
            )
            .sort((left, right) => right.paidAt.getTime() - left.paidAt.getTime()),
        ),
        corrections: Object.freeze(
          [...purchaseCorrections].sort(
            (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
          ),
        ),
        proofs: Object.freeze(
          [...purchaseProofs].sort(
            (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
          ),
        ),
        waivers: Object.freeze(
          [...purchaseWaivers].sort(
            (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
          ),
        ),
        cancellation,
        pauseEvents: Object.freeze(
          [...pauseEvents].sort(
            (left, right) => right.changedAt.getTime() - left.changedAt.getTime(),
          ),
        ),
        downloadOverrides: Object.freeze(
          [...downloadOverrides].sort(
            (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
          ),
        ),
        activeDownloadOverrides: Object.freeze(currentActiveDownloadOverrides),
      }),
    );
  }

  const mappedProjects = [...projects.values()]
    .map((project): PaymentProjectProjection => {
      const projectPurchases = [...mappedPurchases.values()]
        .filter((purchase) => purchase.projectId === project.id)
        .sort(
          (left, right) =>
            right.commercialEstablishedAt.getTime() - left.commercialEstablishedAt.getTime(),
        );
      return Object.freeze({
        id: project.id,
        producerId: project.producerId,
        clientContactId: project.clientContactId,
        title: project.title,
        lifecycleStatus: project.lifecycleStatus,
        createdAt: project.createdAt,
        totals: totalsFor(projectPurchases),
        purchases: Object.freeze(projectPurchases),
      });
    })
    .filter((project) => project.purchases.length > 0)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

  const producerBuckets = Object.freeze({
    needs_review: bucketFrom(
      mappedProjects,
      (purchase) => purchase.producerBucket === "needs_review",
    ),
    due_or_overdue: bucketFrom(
      mappedProjects,
      (purchase) => purchase.producerBucket === "due_or_overdue",
    ),
    upcoming: bucketFrom(mappedProjects, (purchase) => purchase.producerBucket === "upcoming"),
    history: bucketFrom(mappedProjects, (purchase) => purchase.producerBucket === "history"),
  });
  const artistBuckets = Object.freeze({
    waiting: bucketFrom(mappedProjects, (purchase) => purchase.artistBucket === "waiting"),
    active: bucketFrom(mappedProjects, (purchase) => purchase.artistBucket === "active"),
    history: bucketFrom(mappedProjects, (purchase) => purchase.artistBucket === "history"),
  });

  return Object.freeze({
    totals: totalsFor([...mappedPurchases.values()]),
    projects: Object.freeze(mappedProjects),
    producerBuckets,
    artistBuckets,
  });
}

export async function loadProducerPaymentReadModel(
  repository: PaymentLedgerReadRepository,
  input: Readonly<{
    producerId: string;
    projectId?: string;
    clientContactId?: string;
    asOf?: Date;
  }>,
): Promise<PaymentReadModel> {
  const producerId = validId(input.producerId, "Producer identity");
  if (input.projectId && input.clientContactId) {
    fail("INVALID_INPUT", "Project and client payment scopes cannot be combined");
  }
  const scope: PaymentLedgerReadScope = {
    kind: "producer",
    producerId,
    ...(input.projectId ? { projectId: validId(input.projectId, "Project identity") } : {}),
    ...(input.clientContactId
      ? { clientContactId: validId(input.clientContactId, "Client identity") }
      : {}),
  };
  const snapshot = await repository.loadSnapshot(scope);
  if (!snapshot) fail("NOT_FOUND", "Payment history was not found");
  return buildPaymentReadModel(snapshot, input.asOf ?? new Date());
}

export async function loadArtistPaymentReadModel(
  repository: PaymentLedgerReadRepository,
  input: Readonly<{ clerkUserId: string; asOf?: Date }>,
): Promise<PaymentReadModel> {
  const scope: PaymentLedgerReadScope = {
    kind: "artist",
    clerkUserId: validId(input.clerkUserId, "Artist identity"),
  };
  const snapshot = await repository.loadSnapshot(scope);
  if (!snapshot) fail("NOT_FOUND", "Payment history was not found");
  return buildPaymentReadModel(snapshot, input.asOf ?? new Date());
}
