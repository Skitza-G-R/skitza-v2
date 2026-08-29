import type { PaymentPlan, ProductRoyaltyTerms, PurchaseCommercialSnapshot } from "@skitza/db";

import { agreementPdfFileError } from "~/lib/agreement-pdf";

import { assertCommercialSnapshotMatchesAcceptance } from "../purchases/commercial-snapshot";
import { localCalendarDayStart } from "../purchase-ledger/schedule";
import { createInstallmentSchedule, type PurchaseInstallment } from "../purchases/ledger";
import { digestCommercialSnapshot, snapshotCommercialTerms } from "../purchases/policy";

export const ACTIVE_WORK_IMPORT_NOTICE = "Added by producer from an existing agreement" as const;
/** Frozen agreement text when the producer pasted no written terms. */
export const ACTIVE_WORK_IMPORT_NO_TERMS_TEXT =
  "No written terms were pasted. The agreement name, deliverables, rights, price, and payment plan recorded here are the frozen terms." as const;

const POSTGRES_INTEGER_MAX = 2_147_483_647;
const POSTGRES_INTEGER_MIN = -2_147_483_648;
// A payment date is a calendar day stored as UTC midnight. A day that has
// already started anywhere on Earth (UTC+14 at most) is not in the future for
// the producer; the editor applies the exact local-day check.
const LATEST_CALENDAR_DAY_GRACE_MS = 14 * 60 * 60 * 1_000;

export type ActiveWorkImportReasonCode =
  | "client_name_required"
  | "client_email_required"
  | "phone_invalid"
  | "project_title_required"
  | "agreement_name_required"
  | "deliverables_required"
  | "rights_required"
  | "amount_invalid"
  | "currency_invalid"
  | "tax_mismatch"
  | "plan_invalid"
  | "song_spaces_invalid"
  | "deadline_invalid"
  | "first_payment_due_invalid"
  | "payment_invalid"
  | "final_payment_requires_artist_approval"
  | "monthly_anchor_missing"
  | "existing_client_not_found"
  | "existing_client_reuse_required"
  | "existing_client_archived"
  | "existing_client_email_mismatch"
  | "template_not_found"
  | "proof_invalid"
  | "agreement_pdf_invalid"
  | "revision_rule_invalid"
  | "royalty_terms_invalid"
  | "session_invalid";

export type ActiveWorkImportReason = Readonly<{
  code: ActiveWorkImportReasonCode;
  field: string;
  message: string;
}>;

export type ActiveWorkImportPlan =
  | Readonly<{ kind: "full" }>
  | Readonly<{ kind: "split_50_50" }>
  | Readonly<{ kind: "monthly"; installments: number }>;

export type ActiveWorkImportPayment = Readonly<{
  operationKey: string;
  installmentPosition: number;
  amountCents: number;
  paidAt: Date;
  note: string | null;
  proofUploadToken: string | null;
}>;

/** A staged agreement PDF the producer attached while drafting. */
export type ActiveWorkImportAgreementPdfReference = Readonly<{
  uploadToken: string;
  fileName: string;
  sizeBytes: number;
}>;

export type NormalizedActiveWorkImport = Readonly<{
  existingClientId: string | null;
  templateProductId: string | null;
  clientName: string;
  clientEmail: string;
  clientPhone: string | null;
  projectTitle: string;
  deadlineAt: Date | null;
  /**
   * SK-270: the calendar day the producer typed for "When is the first payment
   * due?", as `YYYY-MM-DD`. It is deliberately NOT an instant: only the
   * producer's own time zone can turn a typed day into one, and that zone is
   * loaded where the row is written. `null` means "the import day", which is
   * what the writer falls back to. Raw draft key: `agreement.firstPaymentDueAt`.
   */
  firstPaymentDueDate: string | null;
  plan: ActiveWorkImportPlan;
  agreementPdf: ActiveWorkImportAgreementPdfReference | null;
  commercialSnapshot: PurchaseCommercialSnapshot;
  snapshotDigest: string;
  schedule: readonly PurchaseInstallment[];
  payments: readonly ActiveWorkImportPayment[];
}>;

export type ActiveWorkImportAssessment =
  | Readonly<{
      state: "ready";
      normalized: NormalizedActiveWorkImport;
    }>
  | Readonly<{
      state: "needs_info";
      reasons: readonly ActiveWorkImportReason[];
    }>;

export class ActiveWorkImportDomainError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "NOT_FOUND"
      | "CONFLICT"
      | "OPERATION_KEY_CONFLICT"
      | "INTEGRITY_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "ActiveWorkImportDomainError";
  }
}

export function activeWorkImportExistingClientReason(
  input: Readonly<{
    explicitlySelected: boolean;
    emailMatches: boolean;
    producerArchivedAt: Date | null;
  }>,
): ActiveWorkImportReason | null {
  if (input.producerArchivedAt !== null) {
    return {
      code: "existing_client_archived",
      field: "client.existingClientId",
      message: "Restore this client in Clients & Projects before adding active work.",
    };
  }
  if (!input.explicitlySelected) {
    return {
      code: "existing_client_reuse_required",
      field: "client.existingClientId",
      message: "This email is already a Client. Choose that Client to keep their saved details.",
    };
  }
  if (!input.emailMatches) {
    return {
      code: "existing_client_email_mismatch",
      field: "client.email",
      message: "The chosen client uses a different email.",
    };
  }
  return null;
}

function object(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableId(value: unknown): string | null {
  const normalized = text(value);
  return normalized || null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= POSTGRES_INTEGER_MIN &&
    value <= POSTGRES_INTEGER_MAX
    ? value
    : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean);
}

function reason(
  reasons: ActiveWorkImportReason[],
  code: ActiveWorkImportReasonCode,
  field: string,
  message: string,
): void {
  reasons.push({ code, field, message });
}

function parseAgreementPdf(
  value: unknown,
  reasons: ActiveWorkImportReason[],
): ActiveWorkImportAgreementPdfReference | null {
  if (value === null || value === undefined) return null;
  const candidate = object(value);
  const uploadToken = text(candidate?.uploadToken);
  const fileName = text(candidate?.fileName);
  const sizeBytes = integer(candidate?.sizeBytes);
  if (
    !candidate ||
    !uploadToken ||
    sizeBytes === null ||
    agreementPdfFileError({
      originalFileName: fileName,
      contentType: "application/pdf",
      sizeBytes,
    }) !== null
  ) {
    reason(
      reasons,
      "agreement_pdf_invalid",
      "agreement.agreementPdf",
      "Attach the agreement PDF again.",
    );
    return null;
  }
  return Object.freeze({ uploadToken, fileName, sizeBytes });
}

function parsePlan(
  value: unknown,
  totalCents: number | null,
  reasons: ActiveWorkImportReason[],
): ActiveWorkImportPlan | null {
  const plan = object(value);
  if (!plan || (plan.kind !== "full" && plan.kind !== "split_50_50" && plan.kind !== "monthly")) {
    reason(reasons, "plan_invalid", "agreement.plan", "Choose Full, 50/50, or Monthly.");
    return null;
  }
  if (plan.kind === "monthly") {
    const installments = integer(plan.installments);
    if (
      installments === null ||
      installments < 2 ||
      installments > 12 ||
      totalCents === null ||
      totalCents < installments
    ) {
      reason(
        reasons,
        "plan_invalid",
        "agreement.plan",
        "Monthly needs 2 to 12 payments, with at least 1 cent in each payment.",
      );
      return null;
    }
    return { kind: "monthly", installments };
  }
  if (plan.kind === "split_50_50" && (totalCents === null || totalCents < 2)) {
    reason(reasons, "plan_invalid", "agreement.plan", "50/50 needs a total of at least 2 cents.");
    return null;
  }
  return { kind: plan.kind };
}

// Session bounds mirror the private-offer session normalizer, so an imported
// agreement can freeze exactly what a Skitza-native purchase could.
const MAX_SESSION_DURATION_MIN = 24 * 60;
const MAX_SESSION_LEAD_HOURS = 365 * 24;

/**
 * Frozen booking terms of the outside agreement: how many sessions it
 * includes and their shape. Absent/null means the agreement grants no
 * bookable sessions — exactly today's snapshot, so older drafts keep their
 * digest. Invalid shapes report one plain-language reason.
 */
function parseSession(
  value: unknown,
  reasons: ActiveWorkImportReason[],
): PurchaseCommercialSnapshot["session"] {
  if (value === null || value === undefined) return null;
  const session = object(value);
  const limit = object(session?.limit);
  const count = integer(limit?.count);
  const parsedLimit =
    limit?.kind === "unlimited"
      ? ({ kind: "unlimited" } as const)
      : limit?.kind === "fixed" && count !== null && count >= 1
        ? ({ kind: "fixed", count } as const)
        : null;
  const durationMin = integer(session?.durationMin);
  const locationType = text(session?.locationType);
  const bufferMinutes = integer(session?.bufferMinutes);
  const minLeadHours = integer(session?.minLeadHours);
  if (
    !session ||
    !parsedLimit ||
    durationMin === null ||
    durationMin < 1 ||
    durationMin > MAX_SESSION_DURATION_MIN ||
    !locationType ||
    locationType.length > 100 ||
    bufferMinutes === null ||
    bufferMinutes < 0 ||
    bufferMinutes > MAX_SESSION_DURATION_MIN ||
    minLeadHours === null ||
    minLeadHours < 0 ||
    minLeadHours > MAX_SESSION_LEAD_HOURS
  ) {
    reason(
      reasons,
      "session_invalid",
      "agreement.session",
      "Check the included sessions: how many, and the session length in minutes.",
    );
    return null;
  }
  return {
    limit: parsedLimit,
    durationMin,
    locationType,
    bufferMinutes,
    minLeadHours,
  };
}

function parseRevisionRule(
  value: unknown,
): Readonly<{ value: PurchaseCommercialSnapshot["revisionRule"]; invalid: boolean }> {
  if (value === null || value === undefined) return { value: null, invalid: false };
  const rule = object(value);
  if (!rule) return { value: null, invalid: true };
  const keys = Object.keys(rule).sort().join(",");
  if (rule.kind === "unlimited" && keys === "kind") {
    return { value: { kind: "unlimited" }, invalid: false };
  }
  const count = integer(rule.count);
  return rule.kind === "fixed" && keys === "count,kind" && count !== null && count >= 0
    ? { value: { kind: "fixed", count }, invalid: false }
    : { value: null, invalid: true };
}

function exactObjectKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function royaltyPart(
  value: unknown,
  composition: boolean,
): ProductRoyaltyTerms["master"] | ProductRoyaltyTerms["composition"] | null {
  const part = object(value);
  if (!part) return null;
  if (part.mode === "none" || part.mode === "agreement") {
    return exactObjectKeys(part, ["mode"]) ? { mode: part.mode } : null;
  }
  if (part.mode !== "percentage") return null;
  const bps = integer(part.bps);
  if (bps === null || bps < 0 || bps > 10_000) return null;
  if (!composition) {
    return exactObjectKeys(part, ["mode", "bps"]) ? { mode: "percentage", bps } : null;
  }
  const allowedRoles = new Set(["composer", "lyricist", "arranger", "publisher", "other"]);
  if (part.role !== undefined && (typeof part.role !== "string" || !allowedRoles.has(part.role))) {
    return null;
  }
  if (part.collectingSociety !== undefined && typeof part.collectingSociety !== "string") {
    return null;
  }
  const allowedKeys = [
    "mode",
    "bps",
    ...(part.role === undefined ? [] : ["role"]),
    ...(part.collectingSociety === undefined ? [] : ["collectingSociety"]),
  ];
  if (!exactObjectKeys(part, allowedKeys)) return null;
  return {
    mode: "percentage",
    bps,
    ...(part.role === undefined
      ? {}
      : {
          role: part.role as "composer" | "lyricist" | "arranger" | "publisher" | "other",
        }),
    ...(part.collectingSociety === undefined ? {} : { collectingSociety: part.collectingSociety }),
  };
}

function parseRoyaltyTerms(
  value: unknown,
): Readonly<{ value: ProductRoyaltyTerms | null; invalid: boolean }> {
  if (value === null || value === undefined) return { value: null, invalid: false };
  const terms = object(value);
  if (!terms) return { value: null, invalid: true };
  const master = royaltyPart(terms.master, false) as ProductRoyaltyTerms["master"] | null;
  const composition = royaltyPart(terms.composition, true) as
    | ProductRoyaltyTerms["composition"]
    | null;
  const notes = terms.notes;
  const expectedKeys = ["master", "composition", ...(notes === undefined ? [] : ["notes"])];
  if (
    !master ||
    !composition ||
    !exactObjectKeys(terms, expectedKeys) ||
    (notes !== undefined && typeof notes !== "string")
  ) {
    return { value: null, invalid: true };
  }
  return {
    value: {
      master,
      composition,
      ...(notes === undefined ? {} : { notes }),
    },
    invalid: false,
  };
}

/**
 * The schedule and snapshot validators reject bad terms with plain `Error`
 * instances. Anything else (TypeError, RangeError, domain errors) is a
 * programming failure that must surface instead of reading as bad terms.
 */
function isTermsValidationError(error: unknown): error is Error {
  return error instanceof Error && error.constructor === Error;
}

function includedTax(subtotalCents: number, ratePct: number): number {
  const numerator = BigInt(subtotalCents) * BigInt(ratePct);
  const denominator = BigInt(100 + ratePct);
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

function addedTax(subtotalCents: number, ratePct: number): number {
  const numerator = BigInt(subtotalCents) * BigInt(ratePct);
  return Number((numerator * 2n + 100n) / 200n);
}

function utcDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed;
}

function parsePayments(
  value: unknown,
  plan: ActiveWorkImportPlan | null,
  schedule: readonly PurchaseInstallment[],
  asOf: Date,
  reasons: ActiveWorkImportReason[],
): ActiveWorkImportPayment[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    reason(reasons, "payment_invalid", "payments", "Payment history is not valid.");
    return [];
  }
  const payments: ActiveWorkImportPayment[] = [];
  const operations = new Set<string>();
  for (const [index, raw] of value.entries()) {
    const row = object(raw);
    const field = `payments.${String(index)}`;
    const operationKey = text(row?.operationKey);
    const installmentPosition = integer(row?.installmentPosition);
    const amountCents = integer(row?.amountCents);
    const paidAtValue = text(row?.paidAt);
    const paidAt = utcDateOnly(paidAtValue);
    const noteValue = row?.note;
    const note = noteValue === null || noteValue === undefined ? null : text(noteValue) || null;
    const proofUploadToken = nullableId(row?.proofUploadToken);
    const invalid =
      !operationKey ||
      operationKey.length > 200 ||
      operations.has(operationKey) ||
      installmentPosition === null ||
      installmentPosition < 1 ||
      installmentPosition > schedule.length ||
      amountCents === null ||
      amountCents <= 0 ||
      paidAt === null ||
      paidAt.getTime() > asOf.getTime() + LATEST_CALENDAR_DAY_GRACE_MS ||
      (note?.length ?? 0) > 2_000;
    if (invalid) {
      reason(
        reasons,
        "payment_invalid",
        field,
        "Check the payment, payment date, and the installment it belongs to.",
      );
      continue;
    }
    operations.add(operationKey);
    payments.push({
      operationKey,
      installmentPosition,
      amountCents,
      paidAt,
      note,
      proofUploadToken,
    });
  }
  if (
    plan?.kind === "split_50_50" &&
    payments.some((payment) => payment.installmentPosition === 2)
  ) {
    reason(
      reasons,
      "final_payment_requires_artist_approval",
      "payments",
      "The final 50% needs the Artist to approve the final version in Skitza first.",
    );
  }
  if (
    plan?.kind === "monthly" &&
    payments.some((payment) => payment.installmentPosition > 1) &&
    !payments.some((payment) => payment.installmentPosition === 1)
  ) {
    reason(
      reasons,
      "monthly_anchor_missing",
      "payments",
      "Add the first Monthly payment before later Monthly payments.",
    );
  }
  return payments;
}

/**
 * Validate a saved draft without changing it or causing any side effect.
 * Incomplete drafts return stable, plain-language Needs info reasons.
 */
export function assessActiveWorkImportDraft(
  raw: unknown,
  asOf = new Date(),
): ActiveWorkImportAssessment {
  const reasons: ActiveWorkImportReason[] = [];
  const draft = object(raw) ?? {};
  const client = object(draft.client) ?? {};
  const project = object(draft.project) ?? {};
  const agreement = object(draft.agreement) ?? {};

  const clientName = text(client.name);
  const clientEmail = text(client.email).toLowerCase();
  const clientPhone = nullableId(client.phone);
  const projectTitle = text(project.title);
  const existingClientId = nullableId(client.existingClientId);
  const templateProductId = nullableId(agreement.templateProductId);
  if (!clientName) reason(reasons, "client_name_required", "client.name", "Add the client name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
    reason(reasons, "client_email_required", "client.email", "Add a valid client email.");
  }
  if (clientPhone && clientPhone.length > 40) {
    reason(reasons, "phone_invalid", "client.phone", "Phone must be 40 characters or less.");
  }
  if (!projectTitle) {
    reason(reasons, "project_title_required", "project.title", "Add the project name.");
  }

  let deadlineAt: Date | null = null;
  const deadlineText = nullableId(project.deadlineAt);
  if (deadlineText) {
    deadlineAt = new Date(deadlineText);
    if (Number.isNaN(deadlineAt.getTime())) {
      deadlineAt = null;
      reason(reasons, "deadline_invalid", "project.deadlineAt", "Choose a valid deadline.");
    }
  }

  // SK-270: one optional wizard question — "When is the first payment due?".
  // Leaving it empty keeps the import day, so nothing is ever guessed. The
  // answer stays the calendar day the producer typed; the writer resolves it
  // against the producer's time zone.
  let firstPaymentDueDate: string | null = null;
  const firstPaymentDueText = nullableId(agreement.firstPaymentDueAt);
  if (firstPaymentDueText) {
    firstPaymentDueDate = utcDateOnly(firstPaymentDueText) === null ? null : firstPaymentDueText;
    if (firstPaymentDueDate === null) {
      reason(
        reasons,
        "first_payment_due_invalid",
        "agreement.firstPaymentDueAt",
        "Choose a valid first payment date.",
      );
    }
  }

  const name = text(agreement.name);
  const service = nullableId(agreement.service);
  const deliverables = stringList(agreement.deliverables);
  const rights = stringList(agreement.rights);
  const agreementText = text(agreement.agreementText);
  const subtotalCents = integer(agreement.subtotalCents);
  const suppliedTotalCents = integer(agreement.totalCents);
  const suppliedTaxCents = integer(agreement.taxAmountCents);
  const taxRatePct = integer(agreement.taxRatePct);
  const currency = text(agreement.currency).toUpperCase();
  const includedSongSpaces = integer(agreement.includedSongSpaces);
  const revisionRule = parseRevisionRule(agreement.revisionRule);
  const royaltyTerms = parseRoyaltyTerms(agreement.royaltyTerms);
  const agreementPdf = parseAgreementPdf(agreement.agreementPdf, reasons);
  const session = parseSession(agreement.session, reasons);

  if (!name) {
    reason(reasons, "agreement_name_required", "agreement.name", "Add a name for the agreement.");
  }
  if (deliverables.length === 0) {
    reason(
      reasons,
      "deliverables_required",
      "agreement.deliverables",
      "Add at least one deliverable.",
    );
  }
  if (rights.length === 0) {
    reason(reasons, "rights_required", "agreement.rights", "Add the agreed rights.");
  }
  if (subtotalCents === null || subtotalCents <= 0 || suppliedTotalCents === null) {
    reason(reasons, "amount_invalid", "agreement.totalCents", "Add a price greater than zero.");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    reason(reasons, "currency_invalid", "agreement.currency", "Choose a valid 3-letter currency.");
  }
  if (includedSongSpaces === null || includedSongSpaces < 1) {
    reason(
      reasons,
      "song_spaces_invalid",
      "agreement.includedSongSpaces",
      "Add at least one Song space.",
    );
  }
  if (revisionRule.invalid) {
    reason(
      reasons,
      "revision_rule_invalid",
      "agreement.revisionRule",
      "Check the agreed revision limit.",
    );
  }
  if (royaltyTerms.invalid) {
    reason(
      reasons,
      "royalty_terms_invalid",
      "agreement.royaltyTerms",
      "Check the agreed royalty terms.",
    );
  }

  const plan = parsePlan(agreement.plan, suppliedTotalCents, reasons);
  const taxMode = agreement.taxMode;
  let expectedTaxCents: number | null = null;
  let expectedTotalCents: number | null = null;
  if (
    subtotalCents !== null &&
    subtotalCents > 0 &&
    taxRatePct !== null &&
    taxRatePct >= 0 &&
    taxRatePct <= 100
  ) {
    if (taxMode === "tax_free") {
      expectedTaxCents = 0;
      expectedTotalCents = subtotalCents;
    } else if (taxMode === "tax_included") {
      expectedTaxCents = includedTax(subtotalCents, taxRatePct);
      expectedTotalCents = subtotalCents;
    } else if (taxMode === "tax_added") {
      expectedTaxCents = addedTax(subtotalCents, taxRatePct);
      expectedTotalCents = subtotalCents + expectedTaxCents;
    }
  }
  const computedAmountOverflow =
    (expectedTaxCents !== null && expectedTaxCents > POSTGRES_INTEGER_MAX) ||
    (expectedTotalCents !== null && expectedTotalCents > POSTGRES_INTEGER_MAX);
  if (computedAmountOverflow) {
    reason(
      reasons,
      "amount_invalid",
      "agreement.totalCents",
      "The price plus tax is too large. Use a smaller price.",
    );
  }
  if (
    expectedTaxCents === null ||
    expectedTotalCents === null ||
    computedAmountOverflow ||
    suppliedTaxCents !== expectedTaxCents ||
    suppliedTotalCents !== expectedTotalCents
  ) {
    reason(
      reasons,
      "tax_mismatch",
      "agreement.taxAmountCents",
      "The tax and total do not match the price and tax setting.",
    );
  }

  let schedule: readonly PurchaseInstallment[] = [];
  if (plan && suppliedTotalCents !== null && suppliedTotalCents > 0) {
    try {
      schedule = createInstallmentSchedule(plan, suppliedTotalCents).map((installment) =>
        installment.sequence === 1
          ? Object.freeze({ ...installment, trigger: "producer_import" as const })
          : installment,
      );
    } catch (error) {
      if (!isTermsValidationError(error)) throw error;
      reason(reasons, "plan_invalid", "agreement.plan", "The payment plan is not valid.");
    }
  }

  const payments = parsePayments(draft.payments, plan, schedule, asOf, reasons);
  if (
    reasons.length > 0 ||
    !plan ||
    subtotalCents === null ||
    taxRatePct === null ||
    includedSongSpaces === null ||
    (taxMode !== "tax_free" && taxMode !== "tax_included" && taxMode !== "tax_added") ||
    expectedTaxCents === null ||
    expectedTotalCents === null
  ) {
    return { state: "needs_info", reasons: Object.freeze(reasons) };
  }

  const paymentPlan: PaymentPlan =
    plan.kind === "monthly"
      ? { kind: "monthly", installments: plan.installments }
      : { kind: plan.kind };
  const commercialSnapshot: PurchaseCommercialSnapshot = {
    version: 2,
    // Session terms are part of the frozen outside agreement. When the
    // producer records included sessions, the purchase becomes bookable and
    // materialization derives its session allowance — the same shape a
    // Skitza-native session purchase freezes at acceptance.
    bookingEnabled: session !== null,
    productOrOfferName: name,
    ...(service ? { service } : {}),
    deliverables,
    lineItems: [
      {
        label: name,
        quantity: 1,
        listUnitPriceCents: subtotalCents,
        unitPriceCents: subtotalCents,
        totalCents: subtotalCents,
      },
    ],
    listSubtotalCents: subtotalCents,
    discountCents: 0,
    subtotalCents,
    tax: {
      mode: taxMode,
      ratePct: taxRatePct,
      amountCents: expectedTaxCents,
    },
    totalCents: expectedTotalCents,
    currency,
    includedSongSpaces,
    session,
    revisionRule: revisionRule.value,
    royaltyTerms: royaltyTerms.value,
    rights,
    selectedPaymentPlan: paymentPlan,
    offeredPaymentPlans: [paymentPlan],
    // Pasting the outside agreement is optional: the name, deliverables,
    // rights, price, and plan above already freeze the terms. An attached PDF
    // becomes exact snapshot metadata only when the file is finalized at
    // creation, so the mode stays "none" here.
    agreementText:
      agreementText ||
      (agreementPdf
        ? `The existing agreement is the attached PDF "${agreementPdf.fileName}".`
        : ACTIVE_WORK_IMPORT_NO_TERMS_TEXT),
    agreementMode: agreementText ? "text" : "none",
  };
  try {
    assertCommercialSnapshotMatchesAcceptance(commercialSnapshot, expectedTotalCents, plan);
  } catch (error) {
    if (!isTermsValidationError(error)) throw error;
    return {
      state: "needs_info",
      reasons: [
        {
          code: "amount_invalid",
          field: "agreement",
          message: "The agreement details do not add up. Check the price, tax, and plan.",
        },
      ],
    };
  }
  const frozen = snapshotCommercialTerms(commercialSnapshot);
  return {
    state: "ready",
    normalized: Object.freeze({
      existingClientId,
      templateProductId,
      clientName,
      clientEmail,
      clientPhone,
      projectTitle,
      deadlineAt,
      firstPaymentDueDate,
      plan,
      agreementPdf,
      commercialSnapshot: frozen.value as PurchaseCommercialSnapshot,
      snapshotDigest: frozen.digest,
      schedule: Object.freeze(schedule),
      payments: Object.freeze(payments),
    }),
  };
}

export type ActiveWorkImportAgreementPdfUploadShape = Readonly<{
  uploadId: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
}>;

/**
 * SK-270: the instant an imported purchase's first installment is due.
 *
 * Two rules live here together on purpose:
 *
 *  * A captured day is resolved in the PRODUCER's time zone, because every
 *    downstream due-date check reads the stored instant back through that
 *    same zone.
 *  * Skipping the question stores `importedAt` itself — the exact instant
 *    already written to `purchases.commercial_established_at`. That equality
 *    is the only honest signal there is that the producer never answered, and
 *    `monthlyAnchorAt` in ../purchase-ledger/service.ts reads it back to
 *    decide whether to anchor a Monthly plan on this date or on the first
 *    recorded payment. Do not "tidy" the skipped case into local midnight:
 *    that would erase the signal and re-date real payment history.
 */
export function importedFirstInstallmentDueAt(
  input: Readonly<{
    firstPaymentDueDate: string | null;
    producerTimeZone: string;
    importedAt: Date;
  }>,
): Date {
  return input.firstPaymentDueDate === null
    ? input.importedAt
    : localCalendarDayStart(input.firstPaymentDueDate, input.producerTimeZone);
}

export function activeWorkImportCreationDigest(
  normalized: NormalizedActiveWorkImport,
  proofUploads: readonly Readonly<{
    paymentOperationKey: string;
    uploadId: string;
    originalFileName: string;
    contentType: string;
    sizeBytes: number;
  }>[],
  agreementPdfUpload: ActiveWorkImportAgreementPdfUploadShape | null = null,
): string {
  return `sha256:${digestCommercialSnapshot({
    kind: "active-work-import-row-v1",
    // Rows without a PDF keep the digest they had before PDFs existed.
    ...(agreementPdfUpload ? { agreementPdfUpload } : {}),
    // Likewise, rows that keep the import day as the first due date keep the
    // digest they had before SK-270 added the question.
    ...(normalized.firstPaymentDueDate
      ? { firstPaymentDueDate: normalized.firstPaymentDueDate }
      : {}),
    client: {
      existingClientId: normalized.existingClientId,
      name: normalized.clientName,
      email: normalized.clientEmail,
      phone: normalized.clientPhone,
    },
    templateProductId: normalized.templateProductId,
    project: {
      title: normalized.projectTitle,
      deadlineAt: normalized.deadlineAt?.toISOString() ?? null,
    },
    commercialSnapshot: normalized.commercialSnapshot,
    schedule: normalized.schedule,
    payments: normalized.payments.map((payment) => ({
      operationKey: payment.operationKey,
      installmentPosition: payment.installmentPosition,
      amountCents: payment.amountCents,
      paidAt: payment.paidAt.toISOString(),
      note: payment.note,
    })),
    proofUploads,
  })}`;
}
