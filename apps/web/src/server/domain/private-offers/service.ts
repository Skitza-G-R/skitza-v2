import type { PaymentPlan, ProductRoyaltyTerms, PurchaseCommercialSnapshot } from "@skitza/db";

import { assertCommercialSnapshotMatchesAcceptance } from "../purchases/commercial-snapshot";
import {
  createInstallmentSchedule,
  purchaseInstallmentDueLabel,
  type PurchaseInstallment,
} from "../purchases/ledger";
import { digestCommercialSnapshot } from "../purchases/policy";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const DEFAULT_EXPIRY_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1_000;

type JsonRecord = Record<string, unknown>;

export type PrivateOfferStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "declined"
  | "expired"
  | "canceled";

export type PrivateOfferAction =
  | "edit"
  | "send"
  | "correct_target"
  | "accept"
  | "reject"
  | "cancel";

export type PrivateOfferTarget =
  | Readonly<{ kind: "new" }>
  | Readonly<{
      kind: "existing";
      projectId: string;
      projectName: string;
    }>;

export type PrivateOfferRoyaltyTermsInput = Readonly<{
  master:
    | Readonly<{ mode: "none" }>
    | Readonly<{ mode: "agreement" }>
    | Readonly<{ mode: "percentage"; bps: number }>;
  composition:
    | Readonly<{ mode: "none" }>
    | Readonly<{ mode: "agreement" }>
    | Readonly<{
        mode: "percentage";
        bps: number;
        role?: "composer" | "lyricist" | "arranger" | "publisher" | "other" | undefined;
        collectingSociety?: string | undefined;
      }>;
  notes?: string | undefined;
}>;

export type PrivateOfferInput = Readonly<{
  name: string;
  tagline?: string | null | undefined;
  service: string;
  deliverables: string[];
  cashPriceCents: number;
  currency: string;
  taxMode: "tax_free" | "tax_included" | "tax_added";
  taxRatePct: number;
  includedSongSpaces: number;
  session: PurchaseCommercialSnapshot["session"];
  revisionRule: PurchaseCommercialSnapshot["revisionRule"];
  royaltyTerms: PrivateOfferRoyaltyTermsInput | null;
  rights: string[];
  enabledPaymentPlans: PaymentPlan[];
  agreementText: string;
}>;

export type PrivateOfferDomainErrorCode =
  | "INVALID_INPUT"
  | "INVALID_TERMS"
  | "INVALID_TAX"
  | "PRICE_OVERFLOW"
  | "INVALID_PAYMENT_PLANS"
  | "PAYMENT_PLAN_REQUIRED"
  | "PAYMENT_PLAN_NOT_ALLOWED"
  | "PAYMENT_PLAN_NOT_OFFERED"
  | "INVALID_ROYALTY_TERMS"
  | "EXPIRED"
  | "INVALID_STATUS";

export class PrivateOfferDomainError extends Error {
  readonly code: PrivateOfferDomainErrorCode;
  readonly field: string | null;

  constructor(code: PrivateOfferDomainErrorCode, message: string, field: string | null = null) {
    super(message);
    this.name = "PrivateOfferDomainError";
    this.code = code;
    this.field = field;
  }
}

export type FinalizePrivateOfferSnapshotInput = Readonly<{
  draft: unknown;
  selectedPaymentPlan: PaymentPlan | null;
  target: PrivateOfferTarget;
}>;

export type FinalizedPrivateOfferSnapshot = Readonly<{
  snapshot: PurchaseCommercialSnapshot;
  installments: readonly PurchaseInstallment[];
  snapshotDigest: string;
}>;

function fail(
  code: PrivateOfferDomainErrorCode,
  message: string,
  field: string | null = null,
): never {
  throw new PrivateOfferDomainError(code, message, field);
}

function plainRecord(value: unknown, field: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_INPUT", `${field} must be an object`, field);
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    fail("INVALID_INPUT", `${field} must be a plain object`, field);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail("INVALID_INPUT", `${field} must use string keys only`, field);
  }
  return value as JsonRecord;
}

function assertExactKeys(
  value: JsonRecord,
  allowed: readonly string[],
  required: readonly string[],
  field: string,
  errorCode: PrivateOfferDomainErrorCode = "INVALID_INPUT",
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      fail(errorCode, `${field} contains an unsupported field: ${key}`, `${field}.${key}`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail(errorCode, `${field} is missing ${key}`, `${field}.${key}`);
    }
  }
}

function normalizeRequiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") {
    fail("INVALID_INPUT", `${field} must be text`, field);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    fail(
      "INVALID_INPUT",
      `${field} must contain between 1 and ${String(maximum)} characters`,
      field,
    );
  }
  return normalized;
}

function normalizeOptionalText(value: unknown, field: string, maximum: number): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") {
    fail("INVALID_INPUT", `${field} must be text`, field);
  }
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  if (normalized.length > maximum) {
    fail("INVALID_INPUT", `${field} must be ${String(maximum)} characters or fewer`, field);
  }
  return normalized;
}

function safeInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum = MAX_POSTGRES_INTEGER,
  errorCode: PrivateOfferDomainErrorCode = "INVALID_INPUT",
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(
      errorCode,
      `${field} must be an integer between ${String(minimum)} and ${String(maximum)}`,
      field,
    );
  }
  return value;
}

function denseArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail("INVALID_INPUT", `${field} must be an array`, field);
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) {
      fail("INVALID_INPUT", `${field} must not contain sparse entries`, field);
    }
  }
  return value;
}

function normalizeTextList(
  value: unknown,
  field: string,
  minimumItems: number,
  maximumItems: number,
  maximumItemLength: number,
): string[] {
  const entries = denseArray(value, field);
  if (entries.length < minimumItems || entries.length > maximumItems) {
    fail(
      "INVALID_INPUT",
      `${field} must contain between ${String(minimumItems)} and ${String(maximumItems)} items`,
      field,
    );
  }
  return entries.map((entry, index) =>
    normalizeRequiredText(entry, `${field}.${String(index)}`, maximumItemLength),
  );
}

function normalizeCurrency(value: unknown): string {
  if (typeof value !== "string") fail("INVALID_INPUT", "currency must be text", "currency");
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    fail("INVALID_INPUT", "currency must be a three-letter ISO code", "currency");
  }
  return currency;
}

function normalizeLimit(
  value: unknown,
  field: string,
  minimumFixed: number,
): { kind: "fixed"; count: number } | { kind: "unlimited" } {
  const limit = plainRecord(value, field);
  if (limit.kind === "unlimited") {
    assertExactKeys(limit, ["kind"], ["kind"], field);
    return { kind: "unlimited" };
  }
  if (limit.kind === "fixed") {
    assertExactKeys(limit, ["kind", "count"], ["kind", "count"], field);
    return {
      kind: "fixed",
      count: safeInteger(limit.count, `${field}.count`, minimumFixed, 1_000),
    };
  }
  fail("INVALID_INPUT", `${field}.kind is unsupported`, `${field}.kind`);
}

function normalizeSession(value: unknown): PurchaseCommercialSnapshot["session"] {
  if (value === null) return null;
  const session = plainRecord(value, "session");
  assertExactKeys(
    session,
    ["limit", "durationMin", "locationType", "bufferMinutes", "minLeadHours"],
    ["limit", "durationMin", "locationType", "bufferMinutes", "minLeadHours"],
    "session",
  );
  return {
    limit: normalizeLimit(session.limit, "session.limit", 1),
    durationMin: safeInteger(session.durationMin, "session.durationMin", 1, 24 * 60),
    locationType: normalizeRequiredText(session.locationType, "session.locationType", 100),
    bufferMinutes: safeInteger(session.bufferMinutes, "session.bufferMinutes", 0, 24 * 60),
    minLeadHours: safeInteger(session.minLeadHours, "session.minLeadHours", 0, 365 * 24),
  };
}

function normalizeRevisionRule(value: unknown): PurchaseCommercialSnapshot["revisionRule"] {
  if (value === null) return null;
  return normalizeLimit(value, "revisionRule", 0);
}

function normalizeRoyaltyPart(
  value: unknown,
  field: string,
  composition: boolean,
): ProductRoyaltyTerms["master"] | ProductRoyaltyTerms["composition"] {
  const part = plainRecord(value, field);
  if (part.mode === "none" || part.mode === "agreement") {
    assertExactKeys(part, ["mode"], ["mode"], field, "INVALID_ROYALTY_TERMS");
    return { mode: part.mode };
  }
  if (part.mode !== "percentage") {
    fail("INVALID_ROYALTY_TERMS", `${field}.mode is unsupported`, `${field}.mode`);
  }
  assertExactKeys(
    part,
    composition ? ["mode", "bps", "role", "collectingSociety"] : ["mode", "bps"],
    ["mode", "bps"],
    field,
    "INVALID_ROYALTY_TERMS",
  );
  const bps = safeInteger(part.bps, `${field}.bps`, 1, 10_000, "INVALID_ROYALTY_TERMS");
  if (!composition) return { mode: "percentage", bps };

  const roles = new Set(["composer", "lyricist", "arranger", "publisher", "other"]);
  if (part.role !== undefined && (typeof part.role !== "string" || !roles.has(part.role))) {
    fail("INVALID_ROYALTY_TERMS", `${field}.role is unsupported`, `${field}.role`);
  }
  const collectingSociety = normalizeOptionalText(
    part.collectingSociety,
    `${field}.collectingSociety`,
    200,
  );
  return {
    mode: "percentage",
    bps,
    ...(typeof part.role === "string"
      ? {
          role: part.role as "composer" | "lyricist" | "arranger" | "publisher" | "other",
        }
      : {}),
    ...(collectingSociety ? { collectingSociety } : {}),
  };
}

function normalizeRoyaltyTerms(value: unknown): ProductRoyaltyTerms | null {
  if (value === null) return null;
  const terms = plainRecord(value, "royaltyTerms");
  assertExactKeys(
    terms,
    ["master", "composition", "notes"],
    ["master", "composition"],
    "royaltyTerms",
    "INVALID_ROYALTY_TERMS",
  );
  const notes = normalizeOptionalText(terms.notes, "royaltyTerms.notes", 4_000);
  return {
    master: normalizeRoyaltyPart(
      terms.master,
      "royaltyTerms.master",
      false,
    ) as ProductRoyaltyTerms["master"],
    composition: normalizeRoyaltyPart(
      terms.composition,
      "royaltyTerms.composition",
      true,
    ) as ProductRoyaltyTerms["composition"],
    ...(notes ? { notes } : {}),
  };
}

function normalizePaymentPlan(value: unknown, field: string): PaymentPlan {
  const plan = plainRecord(value, field);
  if (plan.kind === "full" || plan.kind === "split_50_50") {
    assertExactKeys(plan, ["kind"], ["kind"], field, "INVALID_PAYMENT_PLANS");
    return { kind: plan.kind };
  }
  if (plan.kind === "monthly") {
    assertExactKeys(
      plan,
      ["kind", "installments"],
      ["kind", "installments"],
      field,
      "INVALID_PAYMENT_PLANS",
    );
    return {
      kind: "monthly",
      installments: safeInteger(
        plan.installments,
        `${field}.installments`,
        2,
        12,
        "INVALID_PAYMENT_PLANS",
      ),
    };
  }
  fail(
    "INVALID_PAYMENT_PLANS",
    "Private offers support only Full, 50/50, or Monthly payment plans",
    field,
  );
}

export function privateOfferPaymentPlanKey(plan: PaymentPlan): string {
  return plan.kind === "monthly" ? `monthly:${String(plan.installments)}` : plan.kind;
}

function normalizePaymentPlans(value: unknown): PaymentPlan[] {
  const plans = denseArray(value, "enabledPaymentPlans").map((plan, index) =>
    normalizePaymentPlan(plan, `enabledPaymentPlans.${String(index)}`),
  );
  if (plans.length > 3) {
    fail(
      "INVALID_PAYMENT_PLANS",
      "A private offer can enable at most Full, 50/50, and one Monthly plan",
      "enabledPaymentPlans",
    );
  }
  const kinds = plans.map((plan) => plan.kind);
  if (new Set(kinds).size !== kinds.length) {
    fail(
      "INVALID_PAYMENT_PLANS",
      "Each payment-plan kind may be enabled only once",
      "enabledPaymentPlans",
    );
  }
  const order: Record<PaymentPlan["kind"], number> = {
    full: 0,
    split_50_50: 1,
    monthly: 2,
  };
  return plans.sort((left, right) => order[left.kind] - order[right.kind]);
}

function roundRatio(value: number, multiplier: number, denominator: number, field: string): number {
  const numerator = BigInt(value) * BigInt(multiplier);
  const divisor = BigInt(denominator);
  const rounded = (numerator * 2n + divisor) / (divisor * 2n);
  if (rounded > BigInt(MAX_POSTGRES_INTEGER)) {
    fail("PRICE_OVERFLOW", `${field} exceeds the maximum supported amount`, field);
  }
  return Number(rounded);
}

function addMoney(left: number, right: number, field: string): number {
  const total = BigInt(left) + BigInt(right);
  if (total > BigInt(MAX_POSTGRES_INTEGER)) {
    fail("PRICE_OVERFLOW", `${field} exceeds the maximum supported amount`, field);
  }
  return Number(total);
}

function taxFor(
  subtotalCents: number,
  mode: unknown,
  rawRatePct: unknown,
): PurchaseCommercialSnapshot["tax"] & { totalCents: number } {
  if (mode !== "tax_free" && mode !== "tax_included" && mode !== "tax_added") {
    fail("INVALID_TAX", "taxMode is unsupported", "taxMode");
  }
  if (
    typeof rawRatePct !== "number" ||
    !Number.isSafeInteger(rawRatePct) ||
    rawRatePct < 0 ||
    rawRatePct > 100
  ) {
    fail("INVALID_TAX", "taxRatePct must be a whole percentage from 0 to 100", "taxRatePct");
  }
  const ratePct = rawRatePct;
  if (mode === "tax_free") {
    return { mode, ratePct, amountCents: 0, totalCents: subtotalCents };
  }
  if (mode === "tax_included") {
    return {
      mode,
      ratePct,
      amountCents: roundRatio(subtotalCents, ratePct, 100 + ratePct, "tax.amountCents"),
      totalCents: subtotalCents,
    };
  }
  const amountCents = roundRatio(subtotalCents, ratePct, 100, "tax.amountCents");
  return {
    mode,
    ratePct,
    amountCents,
    totalCents: addMoney(subtotalCents, amountCents, "totalCents"),
  };
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function mapInvalidTerms(error: unknown): never {
  if (error instanceof PrivateOfferDomainError) throw error;
  const message = error instanceof Error ? error.message : "Private-offer terms are invalid";
  fail("INVALID_TERMS", message);
}

function assertFeasiblePlans(plans: readonly PaymentPlan[], totalCents: number): void {
  for (const plan of plans) {
    try {
      createInstallmentSchedule(plan, totalCents);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payment plan is not feasible";
      fail("INVALID_PAYMENT_PLANS", message, "enabledPaymentPlans");
    }
  }
}

/**
 * Build a normalized private-offer draft. Paid drafts deliberately do not
 * select a plan yet; selection belongs to the artist's final acceptance.
 */
export function buildPrivateOfferSnapshot(input: PrivateOfferInput): PurchaseCommercialSnapshot {
  const raw = plainRecord(input, "privateOffer");
  const name = normalizeRequiredText(raw.name, "name", 200);
  const tagline = normalizeOptionalText(raw.tagline, "tagline", 300);
  const service = normalizeRequiredText(raw.service, "service", 200);
  const deliverables = normalizeTextList(raw.deliverables, "deliverables", 1, 20, 500);
  const cashPriceCents = safeInteger(raw.cashPriceCents, "cashPriceCents", 0);
  const currency = normalizeCurrency(raw.currency);
  const tax = taxFor(cashPriceCents, raw.taxMode, raw.taxRatePct);
  const includedSongSpaces = safeInteger(raw.includedSongSpaces, "includedSongSpaces", 0, 1_000);
  const session = normalizeSession(raw.session);
  const revisionRule = normalizeRevisionRule(raw.revisionRule);
  const royaltyTerms = normalizeRoyaltyTerms(raw.royaltyTerms);
  const rights = normalizeTextList(raw.rights, "rights", 1, 20, 1_000);
  const offeredPaymentPlans = normalizePaymentPlans(raw.enabledPaymentPlans);
  const agreementText = normalizeRequiredText(raw.agreementText, "agreementText", 50_000);

  if (tax.totalCents === 0 && offeredPaymentPlans.length > 0) {
    fail(
      "INVALID_PAYMENT_PLANS",
      "A zero-total private offer must not enable a payment plan",
      "enabledPaymentPlans",
    );
  }
  if (tax.totalCents > 0 && offeredPaymentPlans.length === 0) {
    fail(
      "INVALID_PAYMENT_PLANS",
      "A paid private offer must enable at least one payment plan",
      "enabledPaymentPlans",
    );
  }
  assertFeasiblePlans(offeredPaymentPlans, tax.totalCents);

  const snapshot: PurchaseCommercialSnapshot = {
    version: 1,
    productOrOfferName: name,
    ...(tagline ? { tagline } : {}),
    service,
    deliverables,
    lineItems: [
      {
        label: name,
        quantity: 1,
        listUnitPriceCents: cashPriceCents,
        unitPriceCents: cashPriceCents,
        totalCents: cashPriceCents,
      },
    ],
    listSubtotalCents: cashPriceCents,
    discountCents: 0,
    subtotalCents: cashPriceCents,
    tax: { mode: tax.mode, ratePct: tax.ratePct, amountCents: tax.amountCents },
    totalCents: tax.totalCents,
    currency,
    includedSongSpaces,
    session,
    revisionRule,
    royaltyTerms,
    rights,
    selectedPaymentPlan: null,
    offeredPaymentPlans,
    agreementText,
  };
  assertValidPrivateOfferDraft(snapshot);
  return deepFreeze(snapshot);
}

/** Validate a persisted offer draft before preview or acceptance. */
export function assertValidPrivateOfferDraft(
  snapshot: unknown,
): asserts snapshot is PurchaseCommercialSnapshot {
  try {
    const candidate = plainRecord(snapshot, "commercialDraft");
    if (candidate.selectedPaymentPlan !== null) {
      fail(
        "INVALID_TERMS",
        "A private-offer draft must not preselect the artist's payment plan",
        "selectedPaymentPlan",
      );
    }
    const totalCents = safeInteger(candidate.totalCents, "totalCents", 0);
    const plans = normalizePaymentPlans(candidate.offeredPaymentPlans);
    if (totalCents === 0) {
      if (plans.length > 0) {
        fail(
          "INVALID_TERMS",
          "A zero-total private-offer draft must not offer payment plans",
          "offeredPaymentPlans",
        );
      }
      assertCommercialSnapshotMatchesAcceptance(candidate, totalCents, null);
      return;
    }
    if (plans.length === 0) {
      fail(
        "INVALID_TERMS",
        "A paid private-offer draft must offer a payment plan",
        "offeredPaymentPlans",
      );
    }
    assertFeasiblePlans(plans, totalCents);
    for (const plan of plans) {
      assertCommercialSnapshotMatchesAcceptance(
        { ...candidate, selectedPaymentPlan: plan },
        totalCents,
        plan,
      );
    }
  } catch (error) {
    mapInvalidTerms(error);
  }
}

function normalizeTarget(target: unknown): PrivateOfferTarget {
  const candidate = plainRecord(target, "target");
  if (candidate.kind === "new") {
    assertExactKeys(candidate, ["kind"], ["kind"], "target");
    return { kind: "new" };
  }
  if (candidate.kind === "existing") {
    assertExactKeys(
      candidate,
      ["kind", "projectId", "projectName"],
      ["kind", "projectId", "projectName"],
      "target",
    );
    return {
      kind: "existing",
      projectId: normalizeRequiredText(candidate.projectId, "target.projectId", 200),
      projectName: normalizeRequiredText(candidate.projectName, "target.projectName", 500).replace(
        /\s+/g,
        " ",
      ),
    };
  }
  fail("INVALID_INPUT", "target.kind is unsupported", "target.kind");
}

function planLabel(plan: PaymentPlan | null): string {
  if (plan === null) return "None (no payment required)";
  if (plan.kind === "full") return "Full payment";
  if (plan.kind === "split_50_50") return "50/50";
  return `Monthly (${String(plan.installments)} installments)`;
}

function money(cents: number, currency: string): string {
  const value = BigInt(cents);
  return `${currency} ${String(value / 100n)}.${String(value % 100n).padStart(2, "0")}`;
}

function cloneSnapshot(
  draft: PurchaseCommercialSnapshot,
  selectedPaymentPlan: PaymentPlan | null,
  agreementText: string,
): PurchaseCommercialSnapshot {
  return {
    ...draft,
    deliverables: [...draft.deliverables],
    lineItems: draft.lineItems.map((item) => ({ ...item })),
    tax: { ...draft.tax },
    session:
      draft.session === null
        ? null
        : {
            ...draft.session,
            limit: { ...draft.session.limit },
          },
    revisionRule: draft.revisionRule === null ? null : { ...draft.revisionRule },
    royaltyTerms:
      draft.royaltyTerms === null
        ? null
        : {
            ...draft.royaltyTerms,
            master: { ...draft.royaltyTerms.master },
            composition: { ...draft.royaltyTerms.composition },
          },
    rights: [...draft.rights],
    selectedPaymentPlan: selectedPaymentPlan === null ? null : { ...selectedPaymentPlan },
    offeredPaymentPlans: draft.offeredPaymentPlans.map((plan) => ({ ...plan })),
    agreementText,
  };
}

/**
 * Select the artist's enabled plan and bind the accepted agreement to the
 * exact target choice and materialized installment amounts/triggers.
 */
export function finalizePrivateOfferSnapshot(
  input: FinalizePrivateOfferSnapshotInput,
): FinalizedPrivateOfferSnapshot {
  assertValidPrivateOfferDraft(input.draft);
  const draft = input.draft;
  const target = normalizeTarget(input.target);

  let selectedPaymentPlan: PaymentPlan | null = null;
  if (draft.totalCents === 0) {
    if (input.selectedPaymentPlan !== null) {
      fail(
        "PAYMENT_PLAN_NOT_ALLOWED",
        "A zero-total private offer must not select a payment plan",
        "selectedPaymentPlan",
      );
    }
  } else {
    if (input.selectedPaymentPlan === null) {
      fail(
        "PAYMENT_PLAN_REQUIRED",
        "Choose one of the private offer's enabled payment plans",
        "selectedPaymentPlan",
      );
    }
    selectedPaymentPlan = normalizePaymentPlan(input.selectedPaymentPlan, "selectedPaymentPlan");
    const selectedKey = privateOfferPaymentPlanKey(selectedPaymentPlan);
    if (
      !draft.offeredPaymentPlans.some(
        (offered) => privateOfferPaymentPlanKey(offered) === selectedKey,
      )
    ) {
      fail(
        "PAYMENT_PLAN_NOT_OFFERED",
        "The selected payment plan is not enabled for this private offer",
        "selectedPaymentPlan",
      );
    }
  }

  let installments: readonly PurchaseInstallment[];
  try {
    installments = createInstallmentSchedule(selectedPaymentPlan, draft.totalCents);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The payment schedule is invalid";
    fail("INVALID_PAYMENT_PLANS", message, "selectedPaymentPlan");
  }

  const targetAgreement =
    target.kind === "new"
      ? "Project target: Start a new project."
      : `Project target: ${target.projectName} (${target.projectId}).`;
  const scheduleAgreement =
    installments.length === 0
      ? ["- No payment is due; this offer is fully paid at acceptance."]
      : installments.map(
          (installment) =>
            `- ${String(installment.sequence)}. ${purchaseInstallmentDueLabel(selectedPaymentPlan as PaymentPlan, installment.sequence)}: ${money(installment.amountCents, draft.currency)} [${installment.trigger}]`,
        );
  const agreementText = [
    draft.agreementText,
    targetAgreement,
    `Selected payment plan: ${planLabel(selectedPaymentPlan)}.`,
    "Exact installment schedule:",
    ...scheduleAgreement,
  ].join("\n");
  const snapshot = cloneSnapshot(draft, selectedPaymentPlan, agreementText);
  try {
    assertCommercialSnapshotMatchesAcceptance(snapshot, snapshot.totalCents, selectedPaymentPlan);
  } catch (error) {
    mapInvalidTerms(error);
  }

  return deepFreeze({
    snapshot,
    installments: [...installments],
    snapshotDigest: digestCommercialSnapshot(snapshot),
  });
}

function validDate(value: Date, field: string): number {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    fail("INVALID_INPUT", `${field} must be a valid date`, field);
  }
  return value.getTime();
}

/** Default expiry is an exact 14-day interval from creation/send time. */
export function defaultPrivateOfferExpiry(now: Date): Date {
  const nowMs = validDate(now, "now");
  return new Date(nowMs + DEFAULT_EXPIRY_DAYS * DAY_MS);
}

/** The expiry instant itself is outside the valid acceptance window. */
export function isPrivateOfferExpired(expiresAt: Date, now: Date): boolean {
  return validDate(now, "now") >= validDate(expiresAt, "expiresAt");
}

const ALLOWED_ACTIONS: Readonly<Record<PrivateOfferStatus, ReadonlySet<PrivateOfferAction>>> = {
  draft: new Set(["edit", "send", "correct_target", "cancel"]),
  sent: new Set(["edit", "correct_target", "accept", "reject", "cancel"]),
  accepted: new Set(),
  declined: new Set(),
  expired: new Set(),
  canceled: new Set(),
};

/**
 * Enforce the lifecycle rule at the locked-row write boundary. Drafts may be
 * repaired after an old expiry; sending and every sent-offer action require a
 * strictly future expiry. Accepted and other terminal offers are immutable.
 */
export function assertPrivateOfferActionAllowed(
  input: Readonly<{
    status: PrivateOfferStatus;
    expiresAt: Date;
    action: PrivateOfferAction;
    now: Date;
  }>,
): void {
  const allowed = (
    ALLOWED_ACTIONS as Readonly<Partial<Record<string, ReadonlySet<PrivateOfferAction>>>>
  )[input.status];
  if (!allowed) fail("INVALID_STATUS", "Private-offer status is unsupported", "status");
  if (input.status === "expired") {
    fail("EXPIRED", "This private offer has expired");
  }
  if (!allowed.has(input.action)) {
    fail(
      "INVALID_STATUS",
      `A ${input.status} private offer cannot perform ${input.action}`,
      "status",
    );
  }
  if (
    (input.status === "sent" || input.action === "send") &&
    isPrivateOfferExpired(input.expiresAt, input.now)
  ) {
    fail("EXPIRED", "This private offer has expired");
  }
}
