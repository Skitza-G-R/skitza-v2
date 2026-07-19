import type { PurchaseCommercialSnapshot } from "@skitza/db";

import { assertCommercialSnapshotMatchesAcceptance } from "./commercial-snapshot";
import {
  createInstallmentSchedule,
  summarizePurchaseLedger,
  type ConfirmedPayment,
  type DebtWaiver,
  type PaymentCorrection,
  type PurchaseInstallment,
  type PurchaseLedgerSummary,
  type PurchasePaymentPlan,
} from "./ledger";
import {
  digestCommercialSnapshot,
  nextMonotonicActivationAt,
  purchaseScopeMatches,
  snapshotCommercialTerms,
  type FrozenCommercialSnapshot,
} from "./policy";

export type PurchaseDomainErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "NOT_OWNER"
  | "OPERATION_KEY_CONFLICT"
  | "INTEGRITY_ERROR";

export class PurchaseDomainError extends Error {
  readonly code: PurchaseDomainErrorCode;

  constructor(code: PurchaseDomainErrorCode, message: string) {
    super(message);
    this.name = "PurchaseDomainError";
    this.code = code;
  }
}

export type PurchaseLifecycleStatus = "waiting_for_payment" | "active" | "canceled";
export type PurchaseProjectLifecycleStatus =
  | "waiting_for_payment"
  | "active"
  | "paused"
  | "completed"
  | "canceled";

export type PurchaseSource =
  | Readonly<{
      kind: "store_product" | "session_product";
      productId: string;
      privateOfferId: null;
      purchaseRequestId: string;
    }>
  | Readonly<{
      kind: "private_offer";
      productId: string | null;
      privateOfferId: string;
      purchaseRequestId: null;
    }>
  | Readonly<{
      kind: "paid_add_on" | "no_charge_add_on";
      productId: string | null;
      privateOfferId: string | null;
      purchaseRequestId: string | null;
    }>;

export type PurchaseSourceDescriptor = Readonly<{
  product: Readonly<{
    id: string;
    producerId: string;
  }> | null;
  privateOffer: Readonly<{
    id: string;
    producerId: string;
    clientContactId: string;
    targetProjectId: string | null;
    productId: string | null;
  }> | null;
  purchaseRequest: Readonly<{
    id: string;
    producerId: string;
    clientContactId: string;
    projectId: string | null;
    productId: string;
  }> | null;
}>;

export type AcceptedPurchase = Readonly<{
  id: string;
  producerId: string;
  projectId: string;
  clientContactId: string;
  source: PurchaseSource;
  operationKey: string;
  operationDigest: string;
  commercialSnapshot: FrozenCommercialSnapshot;
  totalCents: number;
  plan: PurchasePaymentPlan | null;
  schedule: readonly PurchaseInstallment[];
  acceptedAt: Date;
  lifecycleStatus: PurchaseLifecycleStatus;
  lifecycleChangedAt: Date;
  activatedAt: Date | null;
}>;

export type NewAcceptedPurchase = Omit<AcceptedPurchase, "id">;

export type ConfirmedPaymentRecord = ConfirmedPayment &
  Readonly<{
    purchaseId: string;
    operationKey: string;
    operationDigest: string;
  }>;

export type NewConfirmedPaymentRecord = Omit<ConfirmedPaymentRecord, "id">;

export type PurchaseAcceptanceRecord = Readonly<{
  id: string;
  purchaseId: string;
  producerId: string;
  clientContactId: string;
  acceptedByClerkUserId: string;
  commercialSnapshot: FrozenCommercialSnapshot;
  snapshotDigest: string;
  acceptedAt: Date;
}>;

export type PurchaseTargetProject = Readonly<{
  id: string;
  producerId: string;
  clientContactId: string;
  clientClerkUserId: string | null;
  lifecycleStatus: PurchaseProjectLifecycleStatus;
}>;

export type PurchaseProjectActivation = Readonly<{
  purchaseId: string;
  producerId: string;
  projectId: string;
  purchaseLifecycleStatus: PurchaseLifecycleStatus;
  purchaseLifecycleChangedAt: Date;
  purchaseActivatedAt: Date;
  projectLifecycleStatus: PurchaseProjectLifecycleStatus;
  projectLifecycleChangedAt: Date;
}>;

export type PurchaseOperationScope = Readonly<{
  producerId: string;
  clientContactId: string;
  operationKey: string;
}>;

export type PurchaseAtomicScope =
  | Readonly<{
      kind: "purchase_operation";
      producerId: string;
      clientContactId: string;
      operationKey: string;
    }>
  | Readonly<{ kind: "purchase_ledger"; purchaseId: string }>;

export interface PurchaseAtomicTransaction {
  /**
   * Load the exact target project with SELECT ... FOR UPDATE. Every project
   * lifecycle writer must take the same row lock so acceptance cannot race a
   * pause, completion, or cancellation.
   */
  getProjectForUpdate(projectId: string): Promise<PurchaseTargetProject | null>;
  /**
   * Resolve only the explicitly supplied anchors from the same transaction
   * snapshot used for the purchase insert or operation-key replay.
   */
  loadPurchaseSourceDescriptor(source: PurchaseSource): Promise<PurchaseSourceDescriptor>;
  findPurchaseByOperationKey(scope: PurchaseOperationScope): Promise<AcceptedPurchase | null>;
  insertPurchase(input: NewAcceptedPurchase): Promise<AcceptedPurchase>;
  findAcceptanceForPurchase(purchaseId: string): Promise<PurchaseAcceptanceRecord | null>;
  /**
   * Implementations must derive snapshot value, digest, ownership and time
   * directly from this exact frozen purchase object. Only the actor is supplied
   * separately because it is not a purchase column.
   */
  insertAcceptanceFromPurchase(
    purchase: AcceptedPurchase,
    acceptedByClerkUserId: string,
  ): Promise<PurchaseAcceptanceRecord>;
  getPurchaseForUpdate(purchaseId: string): Promise<AcceptedPurchase | null>;
  findPaymentByOperationKey(
    purchaseId: string,
    operationKey: string,
  ): Promise<ConfirmedPaymentRecord | null>;
  insertPayment(input: NewConfirmedPaymentRecord): Promise<ConfirmedPaymentRecord>;
  listPayments(purchaseId: string): Promise<readonly ConfirmedPaymentRecord[]>;
  listCorrections(purchaseId: string): Promise<readonly PaymentCorrection[]>;
  listWaivers(purchaseId: string): Promise<readonly DebtWaiver[]>;
  /** True only for an installment that remains due/overdue and collectible. */
  isInstallmentCollectible(purchaseId: string, installmentSequence: number): Promise<boolean>;
  /**
   * CAS purchase waiting_for_payment -> active (or preserve active) and project
   * waiting_for_payment -> active (or preserve active) in this transaction.
   * Scope every predicate by the purchase's producer/project ownership and
   * reject canceled, paused, completed, or stale rows rather than reviving them.
   */
  activatePurchaseAndProject(
    purchase: AcceptedPurchase,
    activatedAt: Date,
  ): Promise<PurchaseProjectActivation>;
}

export interface PurchaseAtomicRepository {
  /**
   * The implementation must serialize the supplied scope and commit every
   * callback write together. Database uniqueness remains the final guard.
   */
  atomically<T>(
    scope: PurchaseAtomicScope,
    work: (transaction: PurchaseAtomicTransaction) => Promise<T>,
  ): Promise<T>;
}

export type AcceptPurchaseInput = Readonly<{
  producerId: string;
  projectId: string;
  clientContactId: string;
  source: PurchaseSource;
  /**
   * The artist identity proven by an artist-authenticated orchestration
   * boundary. A producer-facing caller must never supply itself or impersonate
   * a client here, including for a no_charge_add_on acceptance.
   */
  acceptedByClerkUserId: string;
  operationKey: string;
  totalCents: number;
  plan: PurchasePaymentPlan | null;
  commercialSnapshot: PurchaseCommercialSnapshot;
  acceptedAt: Date;
}>;

export type AcceptPurchaseResult = Readonly<{
  purchase: AcceptedPurchase;
  acceptance: PurchaseAcceptanceRecord;
  created: boolean;
}>;

export type ConfirmPurchasePaymentInput = Readonly<{
  purchaseId: string;
  producerId: string;
  projectId: string;
  clientContactId: string;
  installmentSequence: number;
  operationKey: string;
  amountCents: number;
  confirmedAt: Date;
}>;

export type ConfirmPurchasePaymentResult = Readonly<{
  purchase: AcceptedPurchase;
  payment: ConfirmedPaymentRecord;
  ledger: PurchaseLedgerSummary;
  created: boolean;
}>;

function assertIdentifier(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new PurchaseDomainError("INVALID_INPUT", `${label} must not be empty`);
  }
}

function assertOperationKey(value: string): void {
  if (value.trim().length === 0 || value.length > 200) {
    throw new PurchaseDomainError(
      "INVALID_INPUT",
      "operationKey must be an opaque non-empty value of at most 200 characters",
    );
  }
}

function assertDate(value: Date, label: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new PurchaseDomainError("INVALID_INPUT", `${label} must be a valid date`);
  }
}

function clonePlan(plan: PurchasePaymentPlan | null): PurchasePaymentPlan | null {
  if (plan === null) return null;
  return plan.kind === "monthly"
    ? Object.freeze({ kind: "monthly", installments: plan.installments })
    : Object.freeze({ kind: plan.kind });
}

function sourceIdentifier(value: unknown, label: string, required: true): string;
function sourceIdentifier(value: unknown, label: string, required: false): string | null;
function sourceIdentifier(value: unknown, label: string, required: boolean): string | null {
  if (value === null && !required) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PurchaseDomainError(
      "INVALID_INPUT",
      `${label} must be ${required ? "a non-empty identifier" : "null or a non-empty identifier"}`,
    );
  }
  return value;
}

function clonePurchaseSource(source: unknown): PurchaseSource {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    throw new PurchaseDomainError("INVALID_INPUT", "source must be an explicit purchase source");
  }
  const record = source as unknown as Record<string, unknown>;
  for (const field of ["productId", "privateOfferId", "purchaseRequestId"] as const) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      throw new PurchaseDomainError("INVALID_INPUT", `source.${field} must be explicit`);
    }
  }

  switch (record.kind) {
    case "store_product":
    case "session_product": {
      if (record.privateOfferId !== null) {
        throw new PurchaseDomainError(
          "INVALID_INPUT",
          `${record.kind} provenance cannot link a private offer`,
        );
      }
      return Object.freeze({
        kind: record.kind,
        productId: sourceIdentifier(record.productId, "source.productId", true),
        privateOfferId: null,
        purchaseRequestId: sourceIdentifier(
          record.purchaseRequestId,
          "source.purchaseRequestId",
          true,
        ),
      });
    }
    case "private_offer": {
      if (record.purchaseRequestId !== null) {
        throw new PurchaseDomainError(
          "INVALID_INPUT",
          "private_offer provenance cannot link a purchase request",
        );
      }
      return Object.freeze({
        kind: "private_offer",
        productId: sourceIdentifier(record.productId, "source.productId", false),
        privateOfferId: sourceIdentifier(record.privateOfferId, "source.privateOfferId", true),
        purchaseRequestId: null,
      });
    }
    case "paid_add_on":
    case "no_charge_add_on": {
      const productId = sourceIdentifier(record.productId, "source.productId", false);
      const privateOfferId = sourceIdentifier(
        record.privateOfferId,
        "source.privateOfferId",
        false,
      );
      const purchaseRequestId = sourceIdentifier(
        record.purchaseRequestId,
        "source.purchaseRequestId",
        false,
      );
      if (productId === null && privateOfferId === null && purchaseRequestId === null) {
        throw new PurchaseDomainError(
          "INVALID_INPUT",
          `${record.kind} provenance requires at least one explicit source anchor`,
        );
      }
      return Object.freeze({
        kind: record.kind,
        productId,
        privateOfferId,
        purchaseRequestId,
      });
    }
    default:
      throw new PurchaseDomainError("INVALID_INPUT", "source.kind is not supported");
  }
}

function missingSourceAnchor(label: string): never {
  throw new PurchaseDomainError("NOT_FOUND", `${label} purchase source was not found`);
}

function sourceScopeMismatch(): never {
  throw new PurchaseDomainError(
    "NOT_OWNER",
    "Purchase source does not match the producer, client, or project target",
  );
}

function sourceProductMismatch(): never {
  throw new PurchaseDomainError(
    "INVALID_INPUT",
    "Purchase source anchors disagree about their product target",
  );
}

function assertTargetProjectCanAcceptPurchase(
  project: PurchaseTargetProject | null,
  target: Readonly<{
    producerId: string;
    projectId: string;
    clientContactId: string;
    acceptedByClerkUserId: string;
  }>,
): void {
  if (project === null) {
    throw new PurchaseDomainError("NOT_FOUND", "The target project was not found");
  }
  if (typeof project !== "object" || Array.isArray(project) || project.id !== target.projectId) {
    integrityError("The purchase repository returned the wrong target project");
  }
  if (
    project.producerId !== target.producerId ||
    project.clientContactId !== target.clientContactId
  ) {
    throw new PurchaseDomainError(
      "NOT_OWNER",
      "The target project does not belong to this producer and client",
    );
  }
  if (project.clientClerkUserId !== target.acceptedByClerkUserId) {
    throw new PurchaseDomainError(
      "NOT_OWNER",
      "The authenticated artist does not own the target project",
    );
  }
  switch (project.lifecycleStatus) {
    case "waiting_for_payment":
    case "active":
      return;
    case "paused":
    case "completed":
    case "canceled":
      throw new PurchaseDomainError(
        "INVALID_INPUT",
        `A ${project.lifecycleStatus} project cannot accept a purchase`,
      );
    default:
      integrityError("The purchase repository returned an invalid project lifecycle status");
  }
}

function assertPurchaseSourceDescriptor(
  source: PurchaseSource,
  descriptorValue: unknown,
  target: Readonly<{
    producerId: string;
    projectId: string;
    clientContactId: string;
  }>,
): void {
  if (
    descriptorValue === null ||
    typeof descriptorValue !== "object" ||
    Array.isArray(descriptorValue)
  ) {
    integrityError("The purchase repository returned an invalid source descriptor");
  }
  const descriptor = descriptorValue as PurchaseSourceDescriptor;

  if (source.productId === null) {
    if (descriptor.product !== null) {
      integrityError("The purchase repository fabricated an omitted product source");
    }
  } else {
    if (descriptor.product === null) missingSourceAnchor("Product");
    if (descriptor.product.id !== source.productId) {
      integrityError("The purchase repository returned the wrong product source");
    }
    if (descriptor.product.producerId !== target.producerId) sourceScopeMismatch();
  }

  if (source.privateOfferId === null) {
    if (descriptor.privateOffer !== null) {
      integrityError("The purchase repository fabricated an omitted private-offer source");
    }
  } else {
    if (descriptor.privateOffer === null) missingSourceAnchor("Private offer");
    if (descriptor.privateOffer.id !== source.privateOfferId) {
      integrityError("The purchase repository returned the wrong private-offer source");
    }
    if (
      descriptor.privateOffer.producerId !== target.producerId ||
      descriptor.privateOffer.clientContactId !== target.clientContactId ||
      descriptor.privateOffer.targetProjectId !== target.projectId
    ) {
      sourceScopeMismatch();
    }
  }

  if (source.purchaseRequestId === null) {
    if (descriptor.purchaseRequest !== null) {
      integrityError("The purchase repository fabricated an omitted request source");
    }
  } else {
    if (descriptor.purchaseRequest === null) missingSourceAnchor("Purchase request");
    if (descriptor.purchaseRequest.id !== source.purchaseRequestId) {
      integrityError("The purchase repository returned the wrong request source");
    }
    if (
      descriptor.purchaseRequest.producerId !== target.producerId ||
      descriptor.purchaseRequest.clientContactId !== target.clientContactId ||
      descriptor.purchaseRequest.projectId !== target.projectId
    ) {
      sourceScopeMismatch();
    }
  }

  switch (source.kind) {
    case "store_product":
    case "session_product":
      if (
        descriptor.purchaseRequest === null ||
        descriptor.purchaseRequest.productId !== source.productId
      ) {
        sourceProductMismatch();
      }
      return;
    case "private_offer":
      if (
        descriptor.privateOffer === null ||
        descriptor.privateOffer.productId !== source.productId
      ) {
        sourceProductMismatch();
      }
      return;
    case "paid_add_on":
    case "no_charge_add_on": {
      const relatedProductIds = [
        ...(descriptor.privateOffer === null ? [] : [descriptor.privateOffer.productId]),
        ...(descriptor.purchaseRequest === null ? [] : [descriptor.purchaseRequest.productId]),
      ].filter((productId): productId is string => productId !== null);
      if (
        source.productId !== null
          ? relatedProductIds.some((productId) => productId !== source.productId)
          : relatedProductIds.length > 1 &&
            relatedProductIds.some((productId) => productId !== relatedProductIds[0])
      ) {
        sourceProductMismatch();
      }
      return;
    }
  }
}

function assertPurchaseSourceAmount(source: PurchaseSource, totalCents: number): void {
  if (
    (source.kind === "store_product" ||
      source.kind === "session_product" ||
      source.kind === "paid_add_on") &&
    totalCents <= 0
  ) {
    throw new PurchaseDomainError(
      "INVALID_INPUT",
      `${source.kind} purchases require a positive total`,
    );
  }
  if (source.kind === "no_charge_add_on" && totalCents !== 0) {
    throw new PurchaseDomainError(
      "INVALID_INPUT",
      "no_charge_add_on purchases require a zero total",
    );
  }
}

function purchaseOperationDigest(input: {
  projectId: string;
  source: PurchaseSource;
  totalCents: number;
  plan: PurchasePaymentPlan | null;
  commercialSnapshotDigest: string;
}): string {
  return digestCommercialSnapshot(input);
}

function integrityError(message: string): never {
  throw new PurchaseDomainError("INTEGRITY_ERROR", message);
}

function sameDate(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

function assertFrozenSnapshotIntegrity(snapshot: FrozenCommercialSnapshot): void {
  try {
    if (
      digestCommercialSnapshot(snapshot.value) !== snapshot.digest ||
      digestCommercialSnapshot(JSON.parse(snapshot.canonicalJson) as unknown) !== snapshot.digest
    ) {
      integrityError("Stored commercial snapshot value, canonical JSON, and digest disagree");
    }
  } catch (error) {
    if (error instanceof PurchaseDomainError) throw error;
    integrityError("Stored commercial snapshot value, canonical JSON, and digest disagree");
  }
}

function assertInsertedPurchaseMatches(
  purchase: AcceptedPurchase,
  expected: NewAcceptedPurchase,
): void {
  assertIdentifier(purchase.id, "purchase id");
  assertFrozenSnapshotIntegrity(purchase.commercialSnapshot);
  if (
    purchase.producerId !== expected.producerId ||
    purchase.projectId !== expected.projectId ||
    purchase.clientContactId !== expected.clientContactId ||
    digestCommercialSnapshot(purchase.source) !== digestCommercialSnapshot(expected.source) ||
    purchase.operationKey !== expected.operationKey ||
    purchase.operationDigest !== expected.operationDigest ||
    purchase.commercialSnapshot.digest !== expected.commercialSnapshot.digest ||
    purchase.totalCents !== expected.totalCents ||
    digestCommercialSnapshot(purchase.plan) !== digestCommercialSnapshot(expected.plan) ||
    digestCommercialSnapshot(purchase.schedule) !== digestCommercialSnapshot(expected.schedule) ||
    !sameDate(purchase.acceptedAt, expected.acceptedAt) ||
    purchase.lifecycleStatus !== expected.lifecycleStatus ||
    !sameDate(purchase.lifecycleChangedAt, expected.lifecycleChangedAt) ||
    (purchase.activatedAt === null) !== (expected.activatedAt === null) ||
    (purchase.activatedAt !== null &&
      expected.activatedAt !== null &&
      !sameDate(purchase.activatedAt, expected.activatedAt))
  ) {
    integrityError("The purchase repository changed accepted commercial or lifecycle data");
  }
}

function assertAcceptanceMatchesPurchase(
  acceptance: PurchaseAcceptanceRecord,
  purchase: AcceptedPurchase,
  expectedActor?: string,
): void {
  assertFrozenSnapshotIntegrity(acceptance.commercialSnapshot);
  if (
    acceptance.purchaseId !== purchase.id ||
    acceptance.producerId !== purchase.producerId ||
    acceptance.clientContactId !== purchase.clientContactId ||
    acceptance.snapshotDigest !== purchase.commercialSnapshot.digest ||
    acceptance.commercialSnapshot.digest !== purchase.commercialSnapshot.digest ||
    acceptance.commercialSnapshot.canonicalJson !== purchase.commercialSnapshot.canonicalJson ||
    !sameDate(acceptance.acceptedAt, purchase.acceptedAt) ||
    (expectedActor !== undefined && acceptance.acceptedByClerkUserId !== expectedActor)
  ) {
    integrityError("Purchase acceptance does not match its immutable purchase snapshot");
  }
}

function paymentOperationDigest(
  input: Readonly<{
    purchaseId: string;
    installmentSequence: number;
    amountCents: number;
    confirmedAt: Date;
  }>,
): string {
  return digestCommercialSnapshot({
    purchaseId: input.purchaseId,
    installmentSequence: input.installmentSequence,
    amountCents: input.amountCents,
    confirmedAt: input.confirmedAt.toISOString(),
  });
}

function assertConfirmedPaymentMatches(
  payment: ConfirmedPaymentRecord,
  expected: NewConfirmedPaymentRecord,
): void {
  if (
    typeof payment.id !== "string" ||
    payment.id.trim().length === 0 ||
    payment.purchaseId !== expected.purchaseId ||
    payment.installmentSequence !== expected.installmentSequence ||
    payment.operationKey !== expected.operationKey ||
    payment.operationDigest !== expected.operationDigest ||
    payment.amountCents !== expected.amountCents ||
    !(payment.confirmedAt instanceof Date) ||
    Number.isNaN(payment.confirmedAt.getTime()) ||
    !sameDate(payment.confirmedAt, expected.confirmedAt)
  ) {
    integrityError("The payment repository changed immutable payment data");
  }
}

async function activatePurchaseAndProject(
  transaction: PurchaseAtomicTransaction,
  purchase: AcceptedPurchase,
  activatedAt: Date,
): Promise<AcceptedPurchase> {
  if (purchase.lifecycleStatus === "canceled") {
    throw new PurchaseDomainError("INVALID_INPUT", "A canceled purchase cannot be activated");
  }
  const activation = await transaction.activatePurchaseAndProject(purchase, activatedAt);
  assertDate(activation.purchaseActivatedAt, "purchase activation time");
  assertDate(activation.purchaseLifecycleChangedAt, "purchase lifecycle change time");
  assertDate(activation.projectLifecycleChangedAt, "project lifecycle change time");
  if (
    activation.purchaseId !== purchase.id ||
    activation.producerId !== purchase.producerId ||
    activation.projectId !== purchase.projectId ||
    activation.purchaseLifecycleStatus !== "active" ||
    activation.projectLifecycleStatus !== "active"
  ) {
    integrityError("Purchase/project activation returned a mismatched owner or inactive status");
  }
  if (purchase.lifecycleStatus === "waiting_for_payment") {
    if (
      !sameDate(activation.purchaseActivatedAt, activatedAt) ||
      !sameDate(activation.purchaseLifecycleChangedAt, activatedAt)
    ) {
      integrityError("A new purchase activation must use the atomic activation time");
    }
  } else if (
    purchase.activatedAt === null ||
    !sameDate(activation.purchaseActivatedAt, purchase.activatedAt) ||
    !sameDate(activation.purchaseLifecycleChangedAt, purchase.lifecycleChangedAt)
  ) {
    integrityError("An active purchase activation retry must preserve its original lifecycle time");
  }
  return {
    ...purchase,
    lifecycleStatus: "active",
    lifecycleChangedAt: new Date(activation.purchaseLifecycleChangedAt),
    activatedAt: new Date(activation.purchaseActivatedAt),
  };
}

export async function acceptPurchase(
  repository: PurchaseAtomicRepository,
  input: AcceptPurchaseInput,
): Promise<AcceptPurchaseResult> {
  assertIdentifier(input.producerId, "producerId");
  assertIdentifier(input.projectId, "projectId");
  assertIdentifier(input.clientContactId, "clientContactId");
  assertIdentifier(input.acceptedByClerkUserId, "acceptedByClerkUserId");
  assertOperationKey(input.operationKey);
  assertDate(input.acceptedAt, "acceptedAt");

  const plan = clonePlan(input.plan);
  const source = clonePurchaseSource(input.source);
  assertPurchaseSourceAmount(source, input.totalCents);
  let schedule: readonly PurchaseInstallment[];
  try {
    schedule = createInstallmentSchedule(plan, input.totalCents);
  } catch (error) {
    throw new PurchaseDomainError(
      "INVALID_INPUT",
      error instanceof Error ? error.message : "Invalid purchase schedule",
    );
  }
  let commercialSnapshot: FrozenCommercialSnapshot;
  try {
    assertCommercialSnapshotMatchesAcceptance(input.commercialSnapshot, input.totalCents, plan);
    commercialSnapshot = snapshotCommercialTerms(input.commercialSnapshot);
  } catch (error) {
    throw new PurchaseDomainError(
      "INVALID_INPUT",
      error instanceof Error ? error.message : "Invalid commercial snapshot",
    );
  }
  const operationDigest = purchaseOperationDigest({
    projectId: input.projectId,
    source,
    totalCents: input.totalCents,
    plan,
    commercialSnapshotDigest: commercialSnapshot.digest,
  });
  const operationScope: PurchaseOperationScope = {
    producerId: input.producerId,
    clientContactId: input.clientContactId,
    operationKey: input.operationKey,
  };

  return repository.atomically(
    { kind: "purchase_operation", ...operationScope },
    async (transaction) => {
      const targetProject = await transaction.getProjectForUpdate(input.projectId);
      assertTargetProjectCanAcceptPurchase(targetProject, input);
      const sourceDescriptor = await transaction.loadPurchaseSourceDescriptor(source);
      assertPurchaseSourceDescriptor(source, sourceDescriptor, input);
      const existing = await transaction.findPurchaseByOperationKey(operationScope);
      if (existing) {
        assertFrozenSnapshotIntegrity(existing.commercialSnapshot);
        let existingSource: PurchaseSource;
        try {
          existingSource = clonePurchaseSource(existing.source);
        } catch {
          integrityError("Stored purchase provenance is invalid");
        }
        if (
          purchaseOperationDigest({
            projectId: existing.projectId,
            source: existingSource,
            totalCents: existing.totalCents,
            plan: existing.plan,
            commercialSnapshotDigest: existing.commercialSnapshot.digest,
          }) !== existing.operationDigest
        ) {
          integrityError("Stored purchase provenance or operation digest was changed");
        }
        if (existing.operationDigest !== operationDigest) {
          throw new PurchaseDomainError(
            "OPERATION_KEY_CONFLICT",
            "This operation key already belongs to different commercial terms or a different target",
          );
        }
        const acceptance = await transaction.findAcceptanceForPurchase(existing.id);
        if (!acceptance) {
          integrityError("An accepted purchase is missing its immutable acceptance record");
        }
        assertAcceptanceMatchesPurchase(acceptance, existing, input.acceptedByClerkUserId);
        return { purchase: existing, acceptance, created: false };
      }

      const acceptedAt = new Date(input.acceptedAt);
      const isZeroTotal = input.totalCents === 0;
      const purchaseDraft: NewAcceptedPurchase = {
        producerId: input.producerId,
        projectId: input.projectId,
        clientContactId: input.clientContactId,
        source,
        operationKey: input.operationKey,
        operationDigest,
        commercialSnapshot,
        totalCents: input.totalCents,
        plan,
        schedule,
        acceptedAt,
        lifecycleStatus: isZeroTotal ? "active" : "waiting_for_payment",
        lifecycleChangedAt: acceptedAt,
        activatedAt: isZeroTotal ? acceptedAt : null,
      };
      let purchase = await transaction.insertPurchase(purchaseDraft);
      assertInsertedPurchaseMatches(purchase, purchaseDraft);
      const acceptance = await transaction.insertAcceptanceFromPurchase(
        purchase,
        input.acceptedByClerkUserId,
      );
      assertAcceptanceMatchesPurchase(acceptance, purchase, input.acceptedByClerkUserId);
      if (isZeroTotal) {
        purchase = await activatePurchaseAndProject(transaction, purchase, acceptedAt);
      }
      return { purchase, acceptance, created: true };
    },
  );
}

export async function confirmPurchasePayment(
  repository: PurchaseAtomicRepository,
  input: ConfirmPurchasePaymentInput,
): Promise<ConfirmPurchasePaymentResult> {
  assertIdentifier(input.purchaseId, "purchaseId");
  assertIdentifier(input.producerId, "producerId");
  assertIdentifier(input.projectId, "projectId");
  assertIdentifier(input.clientContactId, "clientContactId");
  assertOperationKey(input.operationKey);
  assertDate(input.confirmedAt, "confirmedAt");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new PurchaseDomainError("INVALID_INPUT", "Payment amount must be positive integer cents");
  }
  if (!Number.isSafeInteger(input.installmentSequence) || input.installmentSequence < 1) {
    throw new PurchaseDomainError(
      "INVALID_INPUT",
      "installmentSequence must be a positive integer",
    );
  }

  return repository.atomically(
    { kind: "purchase_ledger", purchaseId: input.purchaseId },
    async (transaction) => {
      const purchase = await transaction.getPurchaseForUpdate(input.purchaseId);
      if (!purchase) {
        throw new PurchaseDomainError("NOT_FOUND", "Purchase not found");
      }
      assertFrozenSnapshotIntegrity(purchase.commercialSnapshot);
      if (!purchaseScopeMatches(purchase, input)) {
        throw new PurchaseDomainError("NOT_OWNER", "Purchase scope does not match the actor");
      }
      if (
        (purchase.lifecycleStatus === "waiting_for_payment" && purchase.activatedAt !== null) ||
        (purchase.lifecycleStatus === "active" && purchase.activatedAt === null)
      ) {
        integrityError("Purchase lifecycle and activation timestamp disagree");
      }
      if (!purchase.schedule.some((row) => row.sequence === input.installmentSequence)) {
        throw new PurchaseDomainError(
          "INVALID_INPUT",
          "Payment must belong to an exact purchase installment",
        );
      }

      const operationDigest = paymentOperationDigest({
        purchaseId: purchase.id,
        installmentSequence: input.installmentSequence,
        amountCents: input.amountCents,
        confirmedAt: input.confirmedAt,
      });
      const expectedPayment: NewConfirmedPaymentRecord = {
        purchaseId: purchase.id,
        installmentSequence: input.installmentSequence,
        operationKey: input.operationKey,
        operationDigest,
        amountCents: input.amountCents,
        confirmedAt: new Date(input.confirmedAt),
      };
      const existing = await transaction.findPaymentByOperationKey(purchase.id, input.operationKey);
      let payment: ConfirmedPaymentRecord;
      let created = false;
      if (existing) {
        if (existing.operationDigest !== operationDigest) {
          throw new PurchaseDomainError(
            "OPERATION_KEY_CONFLICT",
            "This payment operation key already represents a different payment",
          );
        }
        assertConfirmedPaymentMatches(existing, expectedPayment);
        payment = existing;
      } else {
        if (
          purchase.lifecycleStatus === "canceled" &&
          !(await transaction.isInstallmentCollectible(purchase.id, input.installmentSequence))
        ) {
          throw new PurchaseDomainError(
            "INVALID_INPUT",
            "A canceled purchase can record payment only for an installment that remains due",
          );
        }
        payment = await transaction.insertPayment(expectedPayment);
        assertConfirmedPaymentMatches(payment, expectedPayment);
        created = true;
      }

      const payments = await transaction.listPayments(purchase.id);
      const corrections = await transaction.listCorrections(purchase.id);
      const waivers = await transaction.listWaivers(purchase.id);
      const ledger = summarizePurchaseLedger({
        totalCents: purchase.totalCents,
        schedule: purchase.schedule,
        payments,
        corrections,
        waivers,
      });

      const activatedAt = nextMonotonicActivationAt(
        purchase.activatedAt,
        ledger.firstInstallmentPaid,
        input.confirmedAt,
      );
      let currentPurchase = purchase;
      if (purchase.lifecycleStatus === "waiting_for_payment" && activatedAt !== null) {
        currentPurchase = await activatePurchaseAndProject(transaction, purchase, activatedAt);
      }

      return {
        purchase: currentPurchase,
        payment,
        ledger,
        created,
      };
    },
  );
}
