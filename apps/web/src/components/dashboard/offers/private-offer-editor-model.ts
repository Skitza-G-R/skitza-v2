import type { PaymentPlan, ProductRoyaltyTerms, PurchaseCommercialSnapshot } from "@skitza/db";

import type { TaxMode } from "~/lib/tax-mode";
import type { PrivateOfferInput } from "~/server/domain/private-offers/service";

import type {
  PrivateOfferTemplatePricing,
  PrivateOfferTemplateProduct,
} from "./private-offer-template-types";

export type PrivateOfferCurrency = string;
export type PrivateOfferPresetId = "production" | "mix" | "master" | "blank";
export type PrivateOfferRoyaltyMode = "none" | "percentage" | "agreement";
export type PrivateOfferLimitMode = "none" | "fixed" | "unlimited";
export type PrivateOfferCompositionRole =
  | "composer"
  | "lyricist"
  | "arranger"
  | "publisher"
  | "other"
  | "";

export interface PrivateOfferComposerDraft {
  presetId: PrivateOfferPresetId | null;
  recipientKind: "existing" | "new";
  clientContactId: string;
  newRecipientName: string;
  newRecipientEmail: string;
  targetKind: "new" | "existing";
  targetProjectId: string;
  name: string;
  tagline: string;
  service: string;
  deliverables: string;
  templateQuantity: string;
  includedSongSpaces: string;
  hasSessionAllowance: boolean;
  sessionLimitMode: Exclude<PrivateOfferLimitMode, "none">;
  sessionCount: string;
  sessionDurationMin: string;
  sessionLocationType: string;
  sessionBufferMinutes: string;
  sessionMinLeadHours: string;
  cashPrice: string;
  currency: PrivateOfferCurrency;
  taxMode: TaxMode;
  taxRatePct: string;
  fullPlan: boolean;
  splitPlan: boolean;
  monthlyPlan: boolean;
  monthlyInstallments: string;
  masterMode: PrivateOfferRoyaltyMode | null;
  masterPercentage: string;
  compositionMode: PrivateOfferRoyaltyMode | null;
  compositionPercentage: string;
  compositionRole: PrivateOfferCompositionRole;
  collectingSociety: string;
  royaltyNotes: string;
  rights: string;
  revisionMode: PrivateOfferLimitMode;
  revisionCount: string;
  agreementText: string;
  expiresAtLocal: string;
  rightsNeedCompletion: boolean;
  agreementNeedsCompletion: boolean;
}

export interface PrivateOfferRecipientValue {
  recipient:
    | { kind: "existing"; clientContactId: string }
    | { kind: "new"; name: string; email: string };
  target: { kind: "new" } | { kind: "existing"; projectId: string };
}

export interface PrivateOfferProjectIdentity {
  id: string;
}

export interface PrivateOfferReviewDraft {
  recipient: PrivateOfferRecipientValue;
  terms: PrivateOfferInput;
  snapshot: PurchaseCommercialSnapshot;
}

export interface PrivateOfferValidatedDraft extends PrivateOfferReviewDraft {
  expiry: Date;
}

export type PrivateOfferDraftField =
  | "presetId"
  | "templateQuantity"
  | "clientContactId"
  | "newRecipientName"
  | "newRecipientEmail"
  | "targetProjectId"
  | "name"
  | "tagline"
  | "service"
  | "deliverables"
  | "cashPrice"
  | "currency"
  | "taxRatePct"
  | "paymentPlans"
  | "monthlyInstallments"
  | "includedSongSpaces"
  | "sessionCount"
  | "sessionDurationMin"
  | "sessionLocationType"
  | "sessionBufferMinutes"
  | "sessionMinLeadHours"
  | "revisionCount"
  | "masterMode"
  | "masterPercentage"
  | "compositionMode"
  | "compositionPercentage"
  | "collectingSociety"
  | "royaltyNotes"
  | "rights"
  | "agreementText"
  | "expiresAtLocal";

export interface PrivateOfferDraftError {
  message: string;
  step: "recipient" | "details" | "price" | "payment" | "delivery" | "rights" | "review";
  field: PrivateOfferDraftField;
}

export type DraftResult<T> = { value: T } | { error: PrivateOfferDraftError };

export const MAX_CASH_PRICE_CENTS = 2_147_483_647;
export const MAX_SERVICE_LENGTH = 200;
export const MAX_DELIVERABLES = 20;
export const MAX_DELIVERABLE_LENGTH = 500;
export const MAX_RIGHTS = 20;
export const MAX_RIGHT_LENGTH = 1_000;
export const MAX_AGREEMENT_LENGTH = 50_000;
export const MAX_TAGLINE_LENGTH = 300;
export const CURRENCIES: readonly PrivateOfferCurrency[] = ["USD", "EUR", "GBP", "ILS"];

const PRIVATE_OFFER_DRAFT_KEYS = [
  "presetId",
  "recipientKind",
  "clientContactId",
  "newRecipientName",
  "newRecipientEmail",
  "targetKind",
  "targetProjectId",
  "name",
  "tagline",
  "service",
  "deliverables",
  "templateQuantity",
  "includedSongSpaces",
  "hasSessionAllowance",
  "sessionLimitMode",
  "sessionCount",
  "sessionDurationMin",
  "sessionLocationType",
  "sessionBufferMinutes",
  "sessionMinLeadHours",
  "cashPrice",
  "currency",
  "taxMode",
  "taxRatePct",
  "fullPlan",
  "splitPlan",
  "monthlyPlan",
  "monthlyInstallments",
  "masterMode",
  "masterPercentage",
  "compositionMode",
  "compositionPercentage",
  "compositionRole",
  "collectingSociety",
  "royaltyNotes",
  "rights",
  "revisionMode",
  "revisionCount",
  "agreementText",
  "expiresAtLocal",
  "rightsNeedCompletion",
  "agreementNeedsCompletion",
] as const satisfies readonly (keyof PrivateOfferComposerDraft)[];
const LEGACY_PRIVATE_OFFER_DRAFT_KEYS = PRIVATE_OFFER_DRAFT_KEYS.filter(
  (key) => key !== "rightsNeedCompletion",
);

const PRIVATE_OFFER_DRAFT_STRING_KEYS = [
  "clientContactId",
  "newRecipientName",
  "newRecipientEmail",
  "targetProjectId",
  "name",
  "tagline",
  "service",
  "deliverables",
  "templateQuantity",
  "includedSongSpaces",
  "sessionCount",
  "sessionDurationMin",
  "sessionLocationType",
  "sessionBufferMinutes",
  "sessionMinLeadHours",
  "cashPrice",
  "currency",
  "taxRatePct",
  "monthlyInstallments",
  "masterPercentage",
  "compositionPercentage",
  "collectingSociety",
  "royaltyNotes",
  "rights",
  "revisionCount",
  "agreementText",
  "expiresAtLocal",
] as const satisfies readonly (keyof PrivateOfferComposerDraft)[];

function hasExactPrivateOfferDraftKeys(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

/**
 * Runtime drafts are account-private but still untrusted browser storage. Keep
 * this parser deliberately exact so an old, partial, or tampered record can
 * never be spread into the live editor state.
 */
export function parsePrivateOfferComposerDraftJson(
  draftJson: string,
): PrivateOfferComposerDraft | null {
  if (draftJson.length === 0 || draftJson.length > 200_000) return null;

  let value: unknown;
  try {
    value = JSON.parse(draftJson);
  } catch {
    return null;
  }
  if (hasExactPrivateOfferDraftKeys(value, LEGACY_PRIVATE_OFFER_DRAFT_KEYS)) {
    if (
      typeof value.rights !== "string" ||
      typeof value.agreementText !== "string" ||
      typeof value.agreementNeedsCompletion !== "boolean"
    ) {
      return null;
    }
    value = {
      ...value,
      rightsNeedCompletion: value.rights.trim().length === 0,
      agreementNeedsCompletion:
        value.agreementNeedsCompletion && value.agreementText.trim().length === 0,
    };
  }
  if (!hasExactPrivateOfferDraftKeys(value, PRIVATE_OFFER_DRAFT_KEYS)) return null;
  if (
    PRIVATE_OFFER_DRAFT_STRING_KEYS.some(
      (key) => typeof value[key] !== "string" || value[key].length > 100_000,
    )
  ) {
    return null;
  }
  if (
    typeof value.hasSessionAllowance !== "boolean" ||
    typeof value.fullPlan !== "boolean" ||
    typeof value.splitPlan !== "boolean" ||
    typeof value.monthlyPlan !== "boolean" ||
    typeof value.rightsNeedCompletion !== "boolean" ||
    typeof value.agreementNeedsCompletion !== "boolean" ||
    !(
      value.presetId === null ||
      isOneOf(value.presetId, ["production", "mix", "master", "blank"] as const)
    ) ||
    !isOneOf(value.recipientKind, ["existing", "new"] as const) ||
    !isOneOf(value.targetKind, ["new", "existing"] as const) ||
    !isOneOf(value.sessionLimitMode, ["fixed", "unlimited"] as const) ||
    !isOneOf(value.taxMode, ["tax_free", "tax_added", "tax_included"] as const) ||
    !(
      value.masterMode === null ||
      isOneOf(value.masterMode, ["none", "percentage", "agreement"] as const)
    ) ||
    !(
      value.compositionMode === null ||
      isOneOf(value.compositionMode, ["none", "percentage", "agreement"] as const)
    ) ||
    !isOneOf(value.compositionRole, [
      "",
      "composer",
      "lyricist",
      "arranger",
      "publisher",
      "other",
    ] as const) ||
    !isOneOf(value.revisionMode, ["none", "fixed", "unlimited"] as const)
  ) {
    return null;
  }

  return value as unknown as PrivateOfferComposerDraft;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

export function splitPrivateOfferLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function privateOfferPriceCents(value: string): number | null {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{0,2})?$/.test(trimmed)) return null;
  const [whole = "0", fraction = ""] = trimmed.split(".");
  const cents = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, "0"), 10);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function privateOfferCentsPrice(cents: number): string {
  return `${String(Math.floor(cents / 100))}.${String(cents % 100).padStart(2, "0")}`;
}

function percentageBps(value: string): number | null {
  const trimmed = value.trim();
  if (!/^(?:\d{1,3}(?:\.\d{1,2})?|\.\d{1,2})$/.test(trimmed)) return null;
  const [whole = "", fraction = ""] = trimmed.split(".");
  const bps =
    Number.parseInt(whole || "0", 10) * 100 + Number.parseInt(fraction.padEnd(2, "0") || "0", 10);
  return bps >= 1 && bps <= 10_000 ? bps : null;
}

function bpsPercentage(bps: number): string {
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return String(whole);
  if (fraction % 10 === 0) return `${String(whole)}.${String(fraction / 10)}`;
  return `${String(whole)}.${String(fraction).padStart(2, "0")}`;
}

function positiveInteger(value: string, minimum: number, maximum: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function dateToLocalInput(value: Date): string {
  const offsetMs = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function defaultPrivateOfferExpiryLocal(now = new Date()): string {
  return dateToLocalInput(new Date(now.getTime() + 14 * DAY_MS));
}

function isoToLocalInput(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? defaultPrivateOfferExpiryLocal()
    : dateToLocalInput(parsed);
}

function selectedPlanState(plans: readonly PaymentPlan[]) {
  const monthly = plans.find((plan) => plan.kind === "monthly");
  return {
    fullPlan: plans.some((plan) => plan.kind === "full"),
    splitPlan: plans.some((plan) => plan.kind === "split_50_50"),
    monthlyPlan: monthly !== undefined,
    monthlyInstallments: monthly?.kind === "monthly" ? String(monthly.installments) : "4",
  };
}

function royaltySeed(terms: PrivateOfferInput["royaltyTerms"]) {
  return {
    masterMode: terms?.master.mode ?? null,
    masterPercentage: terms?.master.mode === "percentage" ? bpsPercentage(terms.master.bps) : "",
    compositionMode: terms?.composition.mode ?? null,
    compositionPercentage:
      terms?.composition.mode === "percentage" ? bpsPercentage(terms.composition.bps) : "",
    compositionRole: terms?.composition.mode === "percentage" ? (terms.composition.role ?? "") : "",
    collectingSociety:
      terms?.composition.mode === "percentage" ? (terms.composition.collectingSociety ?? "") : "",
    royaltyNotes: terms?.notes ?? "",
  } satisfies Pick<
    PrivateOfferComposerDraft,
    | "masterMode"
    | "masterPercentage"
    | "compositionMode"
    | "compositionPercentage"
    | "compositionRole"
    | "collectingSociety"
    | "royaltyNotes"
  >;
}

function templatePrice(template: PrivateOfferTemplateProduct): {
  cashPriceCents: number | null;
  quantity: number;
} {
  if (template.pricing.kind === "hourly") {
    return { cashPriceCents: null, quantity: 0 };
  }
  if (template.pricing.kind === "fixed") {
    return {
      cashPriceCents: template.terms.cashPriceCents,
      quantity: Math.max(0, template.terms.includedSongSpaces),
    };
  }
  const quantity = Math.max(1, Math.min(1_000, Math.round(template.pricing.initialQuantity)));
  return {
    cashPriceCents: totalForTemplateQuantity(template.pricing.volumeTiers, quantity),
    quantity,
  };
}

export function totalForTemplateQuantity(
  tiers: Extract<PrivateOfferTemplatePricing, { kind: "per_song" }>["volumeTiers"],
  quantity: number,
): number | null {
  const ordered = [...tiers].sort((left, right) => left.minQty - right.minQty);
  let active = ordered[0];
  for (const tier of ordered) {
    if (quantity >= tier.minQty) active = tier;
  }
  if (!active) return null;
  const total = BigInt(quantity) * BigInt(active.pricePerUnitCents);
  return Number(total);
}

export function validatePrivateOfferTemplateQuantity(
  draft: PrivateOfferComposerDraft,
  pricing: Extract<PrivateOfferTemplatePricing, { kind: "per_song" }>,
): DraftResult<{ quantity: number; suggestedTotalCents: number | null }> {
  const quantity = positiveInteger(draft.templateQuantity, 1, 1_000);
  if (quantity === null) {
    return draftError(
      "price",
      "templateQuantity",
      "Choose a whole number of songs from 1 to 1,000.",
    );
  }
  const suggestedTotalCents = totalForTemplateQuantity(pricing.volumeTiers, quantity);
  if (
    suggestedTotalCents !== null &&
    (!Number.isSafeInteger(suggestedTotalCents) || suggestedTotalCents > MAX_CASH_PRICE_CENTS)
  ) {
    return draftError(
      "price",
      "templateQuantity",
      "This quantity makes the offer price too high. Choose fewer songs.",
    );
  }
  // Quantity chooses the copied product tier and its starting subtotal, but a
  // private offer is one independent fixed quote. The producer may edit that
  // subtotal without changing the source product or losing its provenance.
  if (positiveInteger(draft.includedSongSpaces, 1, 1_000) !== quantity) {
    return draftError(
      "price",
      "templateQuantity",
      "The song quantity no longer matches the included song spaces. Re-enter the quantity.",
    );
  }
  return { value: { quantity, suggestedTotalCents } };
}

export function seedPrivateOfferDraft(input: {
  defaultCurrency: PrivateOfferCurrency;
  taxMode: TaxMode;
  taxRatePct: number;
  lockedClientId?: string;
  initialOffer?: {
    clientContactId: string;
    targetProjectId: string | null;
    terms: PrivateOfferInput;
    expiresAt: string;
  };
  templateProduct?: PrivateOfferTemplateProduct;
}): PrivateOfferComposerDraft {
  const initial = input.initialOffer?.terms;
  const template = input.templateProduct;
  const source = initial ?? template?.terms;
  const lockedClientId = input.lockedClientId ?? input.initialOffer?.clientContactId;
  const session = source?.session ?? null;
  const revision = source?.revisionRule ?? { kind: "fixed" as const, count: 0 };
  const templatePricing = template ? templatePrice(template) : null;
  const cashPriceCents =
    initial?.cashPriceCents ?? (template ? (templatePricing?.cashPriceCents ?? null) : 0);
  const plans = selectedPlanState(
    source?.enabledPaymentPlans ?? (cashPriceCents === 0 ? [] : [{ kind: "full" }]),
  );
  const includedSongSpaces = initial?.includedSongSpaces ?? templatePricing?.quantity ?? 0;
  const currency = source ? source.currency.trim().toUpperCase() : input.defaultCurrency;

  return {
    presetId: null,
    recipientKind: "existing",
    clientContactId: lockedClientId ?? "",
    newRecipientName: "",
    newRecipientEmail: "",
    targetKind: input.initialOffer?.targetProjectId ? "existing" : "new",
    targetProjectId: input.initialOffer?.targetProjectId ?? "",
    name: source?.name ?? "",
    tagline: source?.tagline ?? "",
    service: source?.service ?? "",
    deliverables: source?.deliverables.join("\n") ?? "",
    templateQuantity: String(Math.max(1, templatePricing?.quantity ?? 1)),
    includedSongSpaces: String(includedSongSpaces),
    hasSessionAllowance: session !== null,
    sessionLimitMode: session?.limit.kind ?? "fixed",
    sessionCount: session?.limit.kind === "fixed" ? String(session.limit.count) : "1",
    sessionDurationMin: String(session?.durationMin ?? 60),
    sessionLocationType: session?.locationType ?? "studio",
    sessionBufferMinutes: String(session?.bufferMinutes ?? 0),
    sessionMinLeadHours: String(session?.minLeadHours ?? 24),
    cashPrice:
      template?.pricing.kind === "hourly" || cashPriceCents === null
        ? ""
        : privateOfferCentsPrice(cashPriceCents),
    currency,
    taxMode: source?.taxMode ?? input.taxMode,
    taxRatePct: String(source?.taxRatePct ?? input.taxRatePct),
    ...plans,
    ...royaltySeed(source?.royaltyTerms ?? null),
    ...(!source ? { masterMode: "none" as const, compositionMode: "none" as const } : {}),
    rights: source?.rights.join("\n") ?? "",
    revisionMode: source?.revisionRule === null ? "none" : revision.kind,
    revisionCount: revision.kind === "fixed" ? String(revision.count) : "0",
    agreementText: source?.agreementText ?? "",
    expiresAtLocal: input.initialOffer
      ? isoToLocalInput(input.initialOffer.expiresAt)
      : defaultPrivateOfferExpiryLocal(),
    rightsNeedCompletion: template?.rightsNeedCompletion ?? false,
    agreementNeedsCompletion: template?.agreementNeedsCompletion ?? false,
  };
}

function draftError(
  step: PrivateOfferDraftError["step"],
  field: PrivateOfferDraftField,
  message: string,
): DraftResult<never> {
  return { error: { step, field, message } };
}

export function validatePrivateOfferRecipient(
  draft: PrivateOfferComposerDraft,
  lockedClientId: string | undefined,
  projects: readonly PrivateOfferProjectIdentity[],
): DraftResult<PrivateOfferRecipientValue> {
  let recipient: PrivateOfferRecipientValue["recipient"];
  if (lockedClientId || draft.recipientKind === "existing") {
    const clientContactId = lockedClientId ?? draft.clientContactId;
    if (!clientContactId) return draftError("recipient", "clientContactId", "Choose a recipient.");
    recipient = { kind: "existing", clientContactId };
  } else {
    const name = draft.newRecipientName.trim();
    const email = draft.newRecipientEmail.trim().toLowerCase();
    if (!name) return draftError("recipient", "newRecipientName", "Add the new recipient’s name.");
    if (name.length > 160) {
      return draftError(
        "recipient",
        "newRecipientName",
        "Recipient name must be 160 characters or fewer.",
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
      return draftError("recipient", "newRecipientEmail", "Enter a valid recipient email.");
    }
    recipient = { kind: "new", name, email };
  }

  if (recipient.kind === "new" && draft.targetKind === "existing") {
    return draftError(
      "recipient",
      "targetProjectId",
      "A new recipient must start with a new project.",
    );
  }

  if (draft.targetKind === "existing") {
    if (!draft.targetProjectId) {
      return draftError(
        "recipient",
        "targetProjectId",
        "Choose an existing project or start a new project.",
      );
    }
    if (!projects.some((project) => project.id === draft.targetProjectId)) {
      return draftError(
        "recipient",
        "targetProjectId",
        "That project is no longer available for this client.",
      );
    }
    return {
      value: {
        recipient,
        target: { kind: "existing", projectId: draft.targetProjectId },
      },
    };
  }
  return { value: { recipient, target: { kind: "new" } } };
}

function validateDetails(draft: PrivateOfferComposerDraft): DraftResult<{
  name: string;
  tagline: string;
  service: string;
  deliverables: string[];
}> {
  const name = draft.name.trim();
  if (!name) return draftError("details", "name", "Add an offer title.");
  if (name.length > 200)
    return draftError("details", "name", "Offer title must be 200 characters or fewer.");
  const tagline = draft.tagline.trim();
  if (tagline.length > MAX_TAGLINE_LENGTH) {
    return draftError("details", "tagline", "Short description must be 300 characters or fewer.");
  }
  const service = draft.service.trim();
  if (!service) return draftError("details", "service", "Add the service this offer covers.");
  if (service.length > MAX_SERVICE_LENGTH) {
    return draftError("details", "service", "Service must be 200 characters or fewer.");
  }
  const deliverables = splitPrivateOfferLines(draft.deliverables);
  if (deliverables.length === 0) {
    return draftError("details", "deliverables", "Add at least one deliverable.");
  }
  if (deliverables.length > MAX_DELIVERABLES) {
    return draftError("details", "deliverables", "Add no more than 20 deliverables.");
  }
  if (deliverables.some((deliverable) => deliverable.length > MAX_DELIVERABLE_LENGTH)) {
    return draftError(
      "details",
      "deliverables",
      "Each deliverable must be 500 characters or fewer.",
    );
  }
  return { value: { name, tagline, service, deliverables } };
}

export function privateOfferTaxBreakdown(
  subtotalCents: number,
  mode: TaxMode,
  ratePct: number,
): { taxCents: number; totalCents: number } | null {
  if (
    !Number.isSafeInteger(subtotalCents) ||
    subtotalCents < 0 ||
    subtotalCents > MAX_CASH_PRICE_CENTS
  ) {
    return null;
  }
  if (!Number.isSafeInteger(ratePct) || ratePct < 0 || ratePct > 100) return null;
  const subtotal = BigInt(subtotalCents);
  const rate = BigInt(ratePct);
  const rounded = (numerator: bigint, denominator: bigint) =>
    (numerator * 2n + denominator) / (denominator * 2n);
  const tax =
    mode === "tax_free"
      ? 0n
      : mode === "tax_included"
        ? rounded(subtotal * rate, BigInt(100 + ratePct))
        : rounded(subtotal * rate, 100n);
  const total = mode === "tax_added" ? subtotal + tax : subtotal;
  if (tax > BigInt(MAX_CASH_PRICE_CENTS) || total > BigInt(MAX_CASH_PRICE_CENTS)) return null;
  return { taxCents: Number(tax), totalCents: Number(total) };
}

function validatePrice(draft: PrivateOfferComposerDraft): DraftResult<{
  cashPriceCents: number;
  taxRatePct: number;
  taxCents: number;
  totalCents: number;
}> {
  const cashPriceCents = privateOfferPriceCents(draft.cashPrice);
  if (cashPriceCents === null || cashPriceCents > MAX_CASH_PRICE_CENTS) {
    return draftError("price", "cashPrice", "Enter a valid price with up to two decimal places.");
  }
  if (!/^[A-Z]{3}$/.test(draft.currency)) {
    return draftError("price", "currency", "Enter a valid three-letter currency code.");
  }
  const taxRatePct = positiveInteger(draft.taxRatePct, 0, 100);
  if (taxRatePct === null) {
    return draftError("price", "taxRatePct", "Tax must be a whole percentage from 0 to 100.");
  }
  const tax = privateOfferTaxBreakdown(cashPriceCents, draft.taxMode, taxRatePct);
  if (!tax) {
    return draftError(
      "price",
      "cashPrice",
      "This price is too high after tax. Lower the price and try again.",
    );
  }
  return { value: { cashPriceCents, taxRatePct, ...tax } };
}

function enabledPlans(
  draft: PrivateOfferComposerDraft,
  totalCents: number,
): DraftResult<PaymentPlan[]> {
  if (totalCents === 0) return { value: [] };
  const plans: PaymentPlan[] = [];
  if (draft.fullPlan) plans.push({ kind: "full" });
  if (draft.splitPlan) plans.push({ kind: "split_50_50" });
  if (draft.monthlyPlan) {
    const installments = positiveInteger(draft.monthlyInstallments, 2, 12);
    if (installments === null) {
      return draftError(
        "payment",
        "monthlyInstallments",
        "Monthly payments must be between 2 and 12.",
      );
    }
    plans.push({ kind: "monthly", installments });
  }
  if (plans.length === 0) {
    return draftError(
      "payment",
      "paymentPlans",
      "Choose at least one payment option for a paid offer.",
    );
  }
  const maximumPayments = Math.max(
    ...plans.map((plan) =>
      plan.kind === "full" ? 1 : plan.kind === "split_50_50" ? 2 : plan.installments,
    ),
  );
  if (totalCents < maximumPayments) {
    return draftError(
      "payment",
      "monthlyInstallments",
      "Increase the price or reduce installments so every payment is at least 1 cent.",
    );
  }
  return { value: plans };
}

function validateDelivery(draft: PrivateOfferComposerDraft): DraftResult<{
  includedSongSpaces: number;
  session: PrivateOfferInput["session"];
  revisionRule: PrivateOfferInput["revisionRule"];
}> {
  const includedSongSpaces = positiveInteger(draft.includedSongSpaces, 0, 1_000);
  if (includedSongSpaces === null) {
    return draftError(
      "delivery",
      "includedSongSpaces",
      "Song spaces must be a whole number from 0 to 1,000.",
    );
  }
  let session: PrivateOfferInput["session"] = null;
  if (draft.hasSessionAllowance) {
    const durationMin = positiveInteger(draft.sessionDurationMin, 1, 1_440);
    const bufferMinutes = positiveInteger(draft.sessionBufferMinutes, 0, 1_440);
    const minLeadHours = positiveInteger(draft.sessionMinLeadHours, 0, 8_760);
    const count =
      draft.sessionLimitMode === "fixed" ? positiveInteger(draft.sessionCount, 1, 1_000) : null;
    if (durationMin === null) {
      return draftError(
        "delivery",
        "sessionDurationMin",
        "Session duration must be from 1 to 1,440 minutes.",
      );
    }
    if (bufferMinutes === null) {
      return draftError(
        "delivery",
        "sessionBufferMinutes",
        "Session buffer must be from 0 to 1,440 minutes.",
      );
    }
    if (minLeadHours === null) {
      return draftError(
        "delivery",
        "sessionMinLeadHours",
        "Session notice must be from 0 to 8,760 hours.",
      );
    }
    if (draft.sessionLimitMode === "fixed" && count === null) {
      return draftError("delivery", "sessionCount", "Session allowance must be from 1 to 1,000.");
    }
    const locationType = draft.sessionLocationType.trim();
    if (!locationType || locationType.length > 100) {
      return draftError("delivery", "sessionLocationType", "Choose a session location.");
    }
    session = {
      limit:
        draft.sessionLimitMode === "unlimited"
          ? { kind: "unlimited" }
          : { kind: "fixed", count: count ?? 1 },
      durationMin,
      locationType,
      bufferMinutes,
      minLeadHours,
    };
  }
  let revisionRule: PrivateOfferInput["revisionRule"] = null;
  if (draft.revisionMode === "unlimited") revisionRule = { kind: "unlimited" };
  if (draft.revisionMode === "fixed") {
    const count = positiveInteger(draft.revisionCount, 0, 1_000);
    if (count === null) {
      return draftError(
        "delivery",
        "revisionCount",
        "Revisions must be a whole number from 0 to 1,000.",
      );
    }
    revisionRule = { kind: "fixed", count };
  }
  return { value: { includedSongSpaces, session, revisionRule } };
}

function royaltyPart(
  mode: PrivateOfferRoyaltyMode,
  percentage: string,
): { mode: "none" } | { mode: "agreement" } | { mode: "percentage"; bps: number } | null {
  if (mode !== "percentage") return { mode };
  const bps = percentageBps(percentage);
  return bps === null ? null : { mode: "percentage", bps };
}

function validateRights(draft: PrivateOfferComposerDraft): DraftResult<{
  royaltyTerms: PrivateOfferInput["royaltyTerms"];
  rights: string[];
  agreementText: string;
}> {
  let royaltyTerms: PrivateOfferInput["royaltyTerms"] = null;
  if (draft.masterMode !== null || draft.compositionMode !== null) {
    if (draft.masterMode === null) {
      return draftError("rights", "masterMode", "Choose a master-rights option.");
    }
    if (draft.compositionMode === null) {
      return draftError("rights", "compositionMode", "Choose a composition-rights option.");
    }
    const master = royaltyPart(draft.masterMode, draft.masterPercentage);
    const compositionBase = royaltyPart(draft.compositionMode, draft.compositionPercentage);
    if (!master) {
      return draftError("rights", "masterPercentage", "Enter a master royalty from 0.01% to 100%.");
    }
    if (!compositionBase) {
      return draftError(
        "rights",
        "compositionPercentage",
        "Enter a composition royalty from 0.01% to 100%.",
      );
    }
    const composition =
      compositionBase.mode === "percentage"
        ? {
            ...compositionBase,
            ...(draft.compositionRole ? { role: draft.compositionRole } : {}),
            ...(draft.collectingSociety.trim()
              ? { collectingSociety: draft.collectingSociety.trim() }
              : {}),
          }
        : compositionBase;
    if (draft.collectingSociety.length > 200) {
      return draftError(
        "rights",
        "collectingSociety",
        "Collecting society must be 200 characters or fewer.",
      );
    }
    const notes = draft.royaltyNotes.trim();
    if (notes.length > 4_000) {
      return draftError(
        "rights",
        "royaltyNotes",
        "Royalty notes must be 4,000 characters or fewer.",
      );
    }
    royaltyTerms = { master, composition, ...(notes ? { notes } : {}) };
  }
  const rights = splitPrivateOfferLines(draft.rights);
  if (rights.length === 0) {
    return draftError("rights", "rights", "Write the rights included in this offer.");
  }
  if (draft.rightsNeedCompletion) {
    return draftError("rights", "rights", "Confirm the rights included in this offer.");
  }
  if (rights.length > MAX_RIGHTS) {
    return draftError("rights", "rights", "Add no more than 20 rights.");
  }
  if (rights.some((right) => right.length > MAX_RIGHT_LENGTH)) {
    return draftError("rights", "rights", "Each right must be 1,000 characters or fewer.");
  }
  const agreementText = draft.agreementText.trim();
  if (!agreementText || draft.agreementNeedsCompletion) {
    return draftError(
      "rights",
      "agreementText",
      "Write the exact agreement the artist will accept.",
    );
  }
  if (agreementText.length > MAX_AGREEMENT_LENGTH) {
    return draftError(
      "rights",
      "agreementText",
      "Exact agreement must be 50,000 characters or fewer.",
    );
  }
  return { value: { royaltyTerms, rights, agreementText } };
}

function expiryResult(draft: PrivateOfferComposerDraft): DraftResult<Date> {
  const expiry = new Date(draft.expiresAtLocal);
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
    return draftError("review", "expiresAtLocal", "Choose an expiry date in the future.");
  }
  return { value: expiry };
}

function buildSnapshot(input: {
  details: { name: string; tagline: string; service: string; deliverables: string[] };
  price: { cashPriceCents: number; taxRatePct: number; taxCents: number; totalCents: number };
  draft: PrivateOfferComposerDraft;
  plans: PaymentPlan[];
  delivery: {
    includedSongSpaces: number;
    session: PrivateOfferInput["session"];
    revisionRule: PrivateOfferInput["revisionRule"];
  };
  rights: {
    royaltyTerms: PrivateOfferInput["royaltyTerms"];
    rights: string[];
    agreementText: string;
  };
}): PurchaseCommercialSnapshot {
  const { details, price, draft, plans, delivery, rights } = input;
  return {
    version: 2,
    bookingEnabled: delivery.session !== null,
    productOrOfferName: details.name,
    ...(details.tagline ? { tagline: details.tagline } : {}),
    service: details.service,
    deliverables: details.deliverables,
    lineItems: [
      {
        label: details.name,
        quantity: 1,
        listUnitPriceCents: price.cashPriceCents,
        unitPriceCents: price.cashPriceCents,
        totalCents: price.cashPriceCents,
      },
    ],
    listSubtotalCents: price.cashPriceCents,
    discountCents: 0,
    subtotalCents: price.cashPriceCents,
    tax: { mode: draft.taxMode, ratePct: price.taxRatePct, amountCents: price.taxCents },
    totalCents: price.totalCents,
    currency: draft.currency,
    includedSongSpaces: delivery.includedSongSpaces,
    session: delivery.session,
    revisionRule: delivery.revisionRule,
    royaltyTerms: snapshotRoyaltyTerms(rights.royaltyTerms),
    rights: rights.rights,
    selectedPaymentPlan: null,
    offeredPaymentPlans: plans,
    agreementText: rights.agreementText,
  };
}

function snapshotRoyaltyTerms(
  terms: PrivateOfferInput["royaltyTerms"],
): ProductRoyaltyTerms | null {
  if (!terms) return null;
  const composition =
    terms.composition.mode === "percentage"
      ? {
          mode: "percentage" as const,
          bps: terms.composition.bps,
          ...(terms.composition.role ? { role: terms.composition.role } : {}),
          ...(terms.composition.collectingSociety
            ? { collectingSociety: terms.composition.collectingSociety }
            : {}),
        }
      : { mode: terms.composition.mode };
  return {
    master:
      terms.master.mode === "percentage"
        ? { mode: "percentage", bps: terms.master.bps }
        : { mode: terms.master.mode },
    composition,
    ...(terms.notes ? { notes: terms.notes } : {}),
  };
}

export function validatePrivateOfferReviewDraft(
  draft: PrivateOfferComposerDraft,
  lockedClientId: string | undefined,
  projects: readonly PrivateOfferProjectIdentity[],
): DraftResult<PrivateOfferReviewDraft> {
  const recipient = validatePrivateOfferRecipient(draft, lockedClientId, projects);
  if ("error" in recipient) return recipient;
  const details = validateDetails(draft);
  if ("error" in details) return details;
  const price = validatePrice(draft);
  if ("error" in price) return price;
  const plans = enabledPlans(draft, price.value.totalCents);
  if ("error" in plans) return plans;
  const delivery = validateDelivery(draft);
  if ("error" in delivery) return delivery;
  const rights = validateRights(draft);
  if ("error" in rights) return rights;
  const terms: PrivateOfferInput = {
    name: details.value.name,
    ...(details.value.tagline ? { tagline: details.value.tagline } : {}),
    service: details.value.service,
    deliverables: details.value.deliverables,
    cashPriceCents: price.value.cashPriceCents,
    currency: draft.currency,
    taxMode: draft.taxMode,
    taxRatePct: price.value.taxRatePct,
    includedSongSpaces: delivery.value.includedSongSpaces,
    session: delivery.value.session,
    revisionRule: delivery.value.revisionRule,
    royaltyTerms: rights.value.royaltyTerms,
    rights: rights.value.rights,
    enabledPaymentPlans: plans.value,
    agreementText: rights.value.agreementText,
  };
  return {
    value: {
      recipient: recipient.value,
      terms,
      snapshot: buildSnapshot({
        details: details.value,
        price: price.value,
        draft,
        plans: plans.value,
        delivery: delivery.value,
        rights: rights.value,
      }),
    },
  };
}

export function validatePrivateOfferDraft(
  draft: PrivateOfferComposerDraft,
  lockedClientId: string | undefined,
  projects: readonly PrivateOfferProjectIdentity[],
): DraftResult<PrivateOfferValidatedDraft> {
  const review = validatePrivateOfferReviewDraft(draft, lockedClientId, projects);
  if ("error" in review) return review;
  const expiry = expiryResult(draft);
  if ("error" in expiry) return expiry;
  return { value: { ...review.value, expiry: expiry.value } };
}

export function validatePrivateOfferStep(
  step: PrivateOfferDraftError["step"],
  draft: PrivateOfferComposerDraft,
  lockedClientId: string | undefined,
  projects: readonly PrivateOfferProjectIdentity[],
): DraftResult<unknown> {
  if (step === "recipient") return validatePrivateOfferRecipient(draft, lockedClientId, projects);
  if (step === "details") return validateDetails(draft);
  if (step === "price") return validatePrice(draft);
  if (step === "payment") {
    const price = validatePrice(draft);
    return "error" in price ? price : enabledPlans(draft, price.value.totalCents);
  }
  if (step === "delivery") return validateDelivery(draft);
  if (step === "rights") return validateRights(draft);
  return validatePrivateOfferDraft(draft, lockedClientId, projects);
}

export function privateOfferRecipientEmail(
  draft: PrivateOfferComposerDraft,
  lockedEmail: string | undefined,
  recipients: readonly Readonly<{ id: string; email: string }>[],
): string {
  if (lockedEmail) return lockedEmail;
  if (draft.recipientKind === "new") return draft.newRecipientEmail.trim().toLowerCase();
  return recipients.find((recipient) => recipient.id === draft.clientContactId)?.email ?? "";
}
